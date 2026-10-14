#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';
import { decodePpm, inkProfileInBox, inspectPdfInk } from './lib/pdf-ink-occupancy.mjs';

const root = process.cwd();
const timingEnabled = process.env.REPORT_BABY_TEST_TIMING === '1';
const timingStartedAt = performance.now();
function reportTiming(label, startedAt, details = {}) {
  if (!timingEnabled) return;
  console.error(`[test-composition-quality-e2e] ${label}: ${(performance.now() - startedAt).toFixed(0)}ms`, details);
}
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-quality-e2e-'));
const bundles = {
  adapter: join(temporary, 'composition/report-composition-entrypoint.cjs'),
  backend: join(temporary, 'composition/index.cjs'),
  pdfBackend: join(temporary, 'composition/adapters/pdf/backend.cjs'),
  responses: join(temporary, 'interfaces/mcp/responses.cjs'),
  textEngine: join(temporary, 'composition/adapters/text-engine.cjs'),
  spacing: join(temporary, 'composition/observability/spacing-report.cjs'),
  primitives: join(temporary, 'rendering/primitives.cjs'),
  template: join(temporary, 'template/contracts.cjs'),
  geometry: join(temporary, 'template/geometry.cjs'),
  coarseGeometry: join(temporary, 'composition/layout/coarse-geometry-planning.cjs'),
};

async function buildPlanningBundles() {
  const entryPoints = [
    'src/composition/report-composition-entrypoint.ts',
    'src/composition/index.ts',
    'src/composition/adapters/pdf/backend.ts',
    'src/interfaces/mcp/responses.ts',
    'src/rendering/primitives.ts',
    'src/template/contracts.ts',
    'src/template/geometry.ts',
    'src/composition/layout/coarse-geometry-planning.ts',
  ];
  if (process.env.COMPOSITION_QUALITY_ORACLE === '1' || process.env.COMPOSITION_QUALITY_COMPARE_LEGACY === '1') entryPoints.push(
    'src/composition/adapters/text-engine.ts',
    'src/composition/observability/spacing-report.ts',
  );
  await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir: temporary,
    outExtension: { '.js': '.cjs' },
    loader: { '.wasm': 'binary', '.ttf': 'binary' },
  });
}

function qualitySource(source) {
  const result = structuredClone(source);
  result.regions = { body: { ...result.slots.content.frame } };
  const quoteSlotId = Object.keys(result.slots).find((slotId) => result.slots[slotId]?.role === 'quote');
  if (!quoteSlotId) throw new Error('quality fixture requires a reusable quote capability');
  result.slots[quoteSlotId] = {
    ...result.slots[quoteSlotId],
    type: 'text',
    region: 'body',
    frame: { x: 0.081, y: 0.34, width: 0.838, height: 0.36 },
    role: 'quote',
    fit_content: true,
    placement: { mode: 'fluid-y', region: 'body', max_instances_per_page: 2, distribution: 'spread-through-content', rhythm_group: 'editorial-material' },
  };
  result.flows.quotes.slots = [quoteSlotId];
  result.flows.quotes.insertion_slots = [quoteSlotId];
  return result;
}

function dynamicChromeQualitySource(source) {
  const result = structuredClone(source);
  result.slots['quote-pool'] = {
    type: 'text',
    frame: { ...result.slots.content.frame },
    role: 'quote',
    fit_content: true,
  };
  result.flows.quotes = { slots: ['quote-pool'], insertion_slots: ['quote-pool'], priority: 400, start_page: 2, continuation: 'allowed' };
  result.id = 'pages/editorial-dynamic-chrome-quality-check';
  return qualitySource(result);
}

function assertSpacingEvidence(result) {
  const spacing = result.plan.spacing;
  assert.ok(spacing, 'an end-to-end plan must expose renderer-neutral spacing evidence');
  assert.equal(spacing.pages.length, result.plan.pages.length, 'spacing report must cover every planned page');
  assert.equal(spacing.slots.length, result.plan.slots.length, 'spacing report must cover every materialized slot');
  assert.ok(spacing.observations.some((observation) => observation.kind === 'region'), 'spacing report must expose region observations');
  assert.ok(spacing.observations.some((observation) => observation.kind === 'region'
    && observation.cause === 'header-content-gap'
    && Number.isFinite(observation.metrics.headerContentGap)), 'header/content gap must be measured once in the spacing report');
  for (const observation of spacing.observations.filter((candidate) => candidate.kind === 'region' && candidate.cause === 'header-content-gap')) {
    const page = spacing.pages.find((candidate) => candidate.page === observation.page);
    const headerLines = result.plan.lines.filter((line) => line.page === observation.page && line.flowId === 'header');
    const reservedHeaderBand = page.bands.header;
    const measuredBottom = Math.max(
      reservedHeaderBand ? reservedHeaderBand.y + reservedHeaderBand.height : 0,
      ...headerLines.map((line) => line.box.y + line.box.height),
    );
    assert.equal(observation.metrics.headerBottom, measuredBottom, 'dynamic header spacing must start below whichever is lower: the reserved band or the measured header content');
    assert.equal(observation.metrics.headerContentGap, observation.metrics.firstContentTop - measuredBottom, 'header spacing must be derived from measured chrome and first-material boxes');
    if (reservedHeaderBand) {
      assert.ok(observation.fromBox.y <= reservedHeaderBand.y, 'header-gap evidence must include the reserved header band');
      assert.ok(observation.fromBox.y + observation.fromBox.height >= measuredBottom, 'header-gap evidence must include any header content extending below its reserved band');
    }
  }
  const insertionPlacements = result.plan.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:'));
  const insertionObservations = spacing.observations.filter((observation) => observation.kind === 'insertion-rhythm');
  assert.equal(insertionObservations.length, insertionPlacements.length, 'every insertion obstacle must have rhythm evidence');
  for (const observation of insertionObservations) {
    assert.ok(observation.owner && observation.cause, 'insertion rhythm must identify its responsible layer and cause');
    assert.ok(observation.flowId && observation.blockId && observation.graphicId, 'insertion rhythm must identify its exact content placement for score attribution');
    assert.ok(observation.templateRef, 'insertion rhythm must identify the supplying template');
    assert.ok(Number.isFinite(observation.metrics.referenceGap), 'insertion rhythm must expose a numeric reference gap');
    assert.ok(Number.isFinite(observation.metrics.contentInsetTop) && Number.isFinite(observation.metrics.contentInsetBottom), 'insertion content inset must be measured once for spacing scoring');
    assert.ok(observation.profile === 'normal' || observation.profile === 'compact' || observation.profile === 'open', 'insertion rhythm must expose a known profile');
    assert.ok(observation.placementPolicy?.distribution, 'insertion rhythm must expose its resolved placement distribution');
  }
  for (const slot of spacing.slots) {
    assert.ok(slot.owner && slot.cause, `slot ${slot.slotId} must identify its responsible layer and cause`);
    assert.ok(slot.templateRef, `slot ${slot.slotId} must identify the supplying template`);
    const area = slot.box.width * slot.box.height;
    assert.ok(Number.isFinite(slot.occupiedArea) && Number.isFinite(slot.emptyArea), `slot ${slot.slotId} must expose numeric area evidence`);
    assert.ok(Math.abs(slot.occupiedArea + slot.emptyArea - area) < 1e-6, `slot ${slot.slotId} area evidence must partition its envelope`);
  }
  const expectedQualityCodes = [
    'sibling-column-imbalance',
    'empty-regions',
    'insertion-symmetry',
    'insertion-distribution',
    'content-spread',
    'page-load-balance',
    'main-page-occupancy-balance',
    'source-relation',
    'spacing-rhythm',
    'narrow-text-interval',
    'fit-content-envelope',
    'header-spacing',
    'insertion-spacing',
    'insertion-text-continuity',
    'footer-gap',
    'main-start-delay',
    'element-proximity',
    'glyph-overlap',
    'orphan-lines',
  ];
  const scoreCodes = new Set(result.evaluation.scoreBreakdown.map((component) => component.code));
  for (const code of expectedQualityCodes) assert.ok(scoreCodes.has(code), `evaluation must include quality component ${code}`);
  for (const code of ['content-spread', 'page-load-balance', 'spacing-rhythm']) {
    const component = result.evaluation.scoreBreakdown.find((candidate) => candidate.code === code);
    assert.ok(Number.isFinite(component?.details?.targetFitReward), `${code} must expose its bounded exact-target reward when evidence is present or absent`);
  }
  assert.ok(result.evaluation.scoreBreakdown.find((candidate) => candidate.code === 'content-spread')?.details?.targetFitReward > 0, 'a gravity group partly inside its target tolerance must earn a positive bounded reward');
  const occupancyComponent = result.evaluation.scoreBreakdown.find((candidate) => candidate.code === 'main-page-occupancy-balance');
  assert.ok(Number.isFinite(occupancyComponent?.details?.targetFitReward), 'main-page occupancy must expose its bounded planned-ink reward');
  assert.equal(occupancyComponent?.details?.terminalPenalty, 0, 'the accepted natural terminal page must not receive a density-only penalty');
  if (occupancyComponent?.details?.terminalPage) {
    assert.ok(Number.isFinite(occupancyComponent.details.terminalPage.occupancy), 'terminal-page underfill evidence must include a measured occupancy ratio');
  }
  for (const suggestion of result.evaluation.suggestions ?? []) {
    assert.ok(suggestion.evidence, `suggestion ${suggestion.code} must include measured evidence`);
    assert.ok(Array.isArray(suggestion.remedies) && suggestion.remedies.length > 0, `suggestion ${suggestion.code} must include remediation`);
    assert.ok(suggestion.why, `suggestion ${suggestion.code} must explain the violation`);
  }
}

await buildPlanningBundles();

try {
  const { planReportComposition, compositionPdfBackendOptionsFromRenderConfig, compositionStylesFromRenderConfig } = await import(bundles.adapter);
  const { renderComposition, evaluateCompositionPlan, compareCompositionEvaluations, createTextCompositionEngine, createTextCompositionPlanner } = await import(bundles.backend);
  const { createJsPdfTextBackend } = await import(bundles.pdfBackend);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const { estimateCoarseMainGeometry, projectCoarseInsertionDisplacement } = await import(bundles.coarseGeometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-dynamic-inset-two-column/template.yml'), 'utf8'));
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const rasterSide = renderConfig.quality.pdf_pixel_qa.rectangle_inset_px * 2 + 2;
  const whiteRaster = decodePpm(Buffer.concat([Buffer.from(`P6\n${rasterSide} ${rasterSide}\n255\n`), Buffer.alloc(rasterSide * rasterSide * 3, 255)]));
  assert.ok(whiteRaster.pixels.every((value) => value === 255), 'the PPM delimiter must not enter the pixel data');
  const whiteProfile = inkProfileInBox(whiteRaster, { x: 0, y: 0, width: rasterSide, height: rasterSide }, { width: rasterSide, height: rasterSide }, renderConfig.quality.pdf_pixel_qa);
  assert.equal(whiteProfile.status, 'empty', 'a blank raster must not pass the line-ink gate');
  const binaryWhitespaceRaster = decodePpm(Buffer.concat([Buffer.from('P6\n1 1\n255\n'), Buffer.from([10, 32, 13])]));
  assert.deepEqual([...binaryWhitespaceRaster.pixels], [10, 32, 13], 'binary whitespace samples must remain intact after consuming the header delimiter');
  const dynamicSource = qualitySource(source);
  const quoteSlotId = Object.keys(dynamicSource.slots).find((slotId) => dynamicSource.slots[slotId]?.role === 'quote');
  if (!quoteSlotId) throw new Error('quality fixture requires a reusable quote capability');
  const compiled = compileTemplateSource(dynamicSource);
  const geometry = pageGeometryFromTemplate(compiled);
  const fixture = createEditorialNumberedFixture({
    quoteMarkGap: renderConfig.pdf.quote_mark_gap,
    quoteMarkOffsetX: renderConfig.pdf.quote_mark_offset_x,
    quoteMarkOffsetY: renderConfig.pdf.quote_mark_offset_y,
    quoteMarkCloseOffsetY: renderConfig.pdf.quote_mark_close_offset_y,
  });
  const styles = compositionStylesFromRenderConfig({
    foreground: [25, 51, 79],
    muted: [88, 106, 131],
    primary: [42, 110, 166],
    quote: [232, 117, 61],
  });
  const pdf = newPdf('portrait', [geometry.width, geometry.height]);
  const seedStartedAt = performance.now();
  const seedResult = planReportComposition(
    pdf,
    compiled,
    geometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles, policy: { searchBudget: { maxRefinementRounds: 0, maxFullPlanRecalculations: 1 } } },
  );
  reportTiming('seed planning + evaluation', seedStartedAt, {
    planningTimeMs: seedResult.plan.trace?.candidateSearch?.planningTimeMs,
    candidates: seedResult.plan.trace?.candidateSearch?.evaluatedCandidates,
  });
  const optimizedStartedAt = performance.now();
  const result = planReportComposition(
    pdf,
    compiled,
    geometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles },
  );
  reportTiming('optimized planning + evaluation loop', optimizedStartedAt, {
    planningTimeMs: result.plan.trace?.candidateSearch?.planningTimeMs,
    rounds: result.plan.trace?.candidateSearch?.rounds.map(({ round, generatedCandidates, evaluatedCandidates, stopReason }) => ({ round, generatedCandidates, evaluatedCandidates, stopReason })),
    candidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
  });
  // A coarse seed can already equal the best complete exact candidate; keep
  // the no-regression contract here and assert strict repair improvements in
  // the dedicated ranking corpus where a reachable defect is guaranteed.
  assert.ok(result.evaluation.score >= seedResult.evaluation.score, `optional movement candidates must retain the unmoved seed plan so a move cannot force a lower-scoring result: ${JSON.stringify({ optimizedScore: result.evaluation.score, seedScore: seedResult.evaluation.score, selected: result.plan.trace?.candidateSearch?.selectedCandidate, seedComponents: seedResult.evaluation.scoreBreakdown.map(({ code, points }) => [code, points]) })}`);
  assert.ok((result.plan.trace?.candidateSearch?.generatedCandidates ?? 0) > (seedResult.plan.trace?.candidateSearch?.generatedCandidates ?? 0), 'fluid quote capabilities must generate additional complete-plan movement candidates without per-block test wiring');
  const candidateSearch = result.plan.trace?.candidateSearch;
  const fullPlanRecalculationBudget = renderConfig.composition_search.max_full_plan_recalculations;
  assert.ok(Number.isInteger(fullPlanRecalculationBudget) && fullPlanRecalculationBudget > 0, 'the complete-plan calculation budget must come from shared render configuration');
  assert.ok((candidateSearch?.fullPlanRecalculations ?? 0) <= fullPlanRecalculationBudget,
    `the representative coarse-first run must stay within the configured full-plan evaluation budget: ${JSON.stringify({ actual: candidateSearch?.fullPlanRecalculations, budget: fullPlanRecalculationBudget })}`);
  const baselineSearchRound = candidateSearch?.rounds.find(({ round }) => round === 0);
  assert.ok(baselineSearchRound?.evaluatedCandidates > 1 && baselineSearchRound.evaluatedCandidates <= renderConfig.composition_search.coarse_exact_candidate_count, 'the engine must compare a bounded set of complete coarse seeds before local refinements');
  const evaluatedRepairResults = (candidateSearch?.rounds ?? [])
    .filter(({ round }) => round > 0)
    .flatMap((round) => (round.candidateResults ?? []).map((candidate) => ({ round, candidate })));
  assert.ok(evaluatedRepairResults.length > 0, 'the representative candidate search must exercise measured post-baseline repairs');
  assert.ok(evaluatedRepairResults.every(({ round, candidate }) => {
    const roundRepairIds = new Set((round.repairProposals ?? []).map(({ id }) => id));
    return candidate.repairProposalIds?.length > 0
      && candidate.repairProposalIds.every((id) => roundRepairIds.has(id));
  }), 'every evaluated post-baseline candidate must identify the exact evaluator repair that caused it');
  const coarseSeedDecision = result.plan.decisions.find((decision) => decision.code === 'COARSE_GEOMETRY_SEED_SELECTED');
  assert.ok(coarseSeedDecision, `the selected exact plan must retain the coarse seed evidence after stabilization: ${result.plan.decisions.map((decision) => decision.code).filter((code) => code.includes('COARSE') || code.includes('PLANNER'))}`);
  assert.ok(Array.isArray(coarseSeedDecision.progressByPage) && Array.isArray(coarseSeedDecision.unobstructedProgressByPage), 'coarse diagnostics must distinguish unobstructed and insertion-projected main progress');
  assert.ok(Array.isArray(coarseSeedDecision.insertionAssignments), 'coarse diagnostics must identify selected insertion rectangles');
  assert.ok(coarseSeedDecision.coarseBlockMeasurements.length > 0 && coarseSeedDecision.coarseBreakSensitiveRegions.some(({ rule }) => rule === 'heading-following-lines'), 'normal diagnostics must expose intrinsic block heights and protected heading bands');
  assert.ok(coarseSeedDecision.assignmentSearch.projectedLayoutsCompared > 1, 'the normal seed must compare complete alternatives after cut/push projection');
  assert.ok(Array.isArray(coarseSeedDecision.coarseMainRegions) && Array.isArray(coarseSeedDecision.dynamicReservations), 'coarse diagnostics must expose resolved main rectangles and measured dynamic intro reservations');
  const baselineExactComparison = coarseSeedDecision.baselineExactComparison;
  const terminalPageErrorTolerance = renderConfig.composition_search.coarse_page_prediction_error_tolerance_pages;
  assert.ok(Number.isFinite(terminalPageErrorTolerance) && terminalPageErrorTolerance >= 0, 'the representative coarse terminal-page tolerance must come from shared render configuration');
  assert.ok(baselineExactComparison && Array.isArray(baselineExactComparison.pages), 'the coarse seed trace must compare its predicted page mass with exact baseline text lines');
  assert.ok(Number.isFinite(baselineExactComparison.estimatedTerminalPage) && Number.isFinite(baselineExactComparison.exactMainTerminalPage), 'the estimate and exact baseline must each report their terminal main page when measurable');
  assert.ok(Math.abs(baselineExactComparison.estimatedTerminalPage - baselineExactComparison.exactMainTerminalPage) <= terminalPageErrorTolerance, `the frozen representative fixture must stay within the configured terminal-page prediction tolerance: ${JSON.stringify({ estimated: baselineExactComparison.estimatedTerminalPage, exact: baselineExactComparison.exactMainTerminalPage, tolerance: terminalPageErrorTolerance, pageMass: baselineExactComparison.pages.map(({ page, estimatedMassUnits, exactTextWords }) => ({ page, estimatedMassUnits, exactTextWords })), insertionAssignments: coarseSeedDecision.insertionAssignments.map(({ flowId, blockId, page, slotId }) => ({ flowId, blockId, page, slotId })) })}`);
  assert.ok(baselineExactComparison.exactTextWordCount > 0 && baselineExactComparison.pages.every((page) => Number.isFinite(page.estimatedMassUnits) && Number.isFinite(page.exactTextWords) && (Array.isArray(page.blocks) || (page.estimatedMassUnits === 0 && page.exactTextWords === 0))), 'per-page comparison must report measured coarse units, exact line word counts and block attribution where mass exists');
  assert.ok(baselineExactComparison.pages.flatMap((page) => page.blocks ?? []).every((block) =>
    (block.estimatedMassUnits === 0 || Number.isInteger(block.estimatedLineCount))
      && (block.exactTextWords === 0 || Number.isInteger(block.exactLineCount))), 'text block attribution must expose estimated and exact line counts by page');
  assert.ok(baselineExactComparison.pages.flatMap((page) => page.blocks ?? []).every((block) =>
    block.estimatedBySlot.every((slot) => Number.isFinite(slot.leftX) && Number.isFinite(slot.rightX) && slot.rightX >= slot.leftX && Number.isFinite(slot.topY) && Number.isFinite(slot.bottomY) && Number.isFinite(slot.occupiedHeight) && slot.occupiedHeight >= 0 && Number.isFinite(slot.unoccupiedEnvelopeHeight) && slot.unoccupiedEnvelopeHeight >= 0)
      && block.exactBySlot.every((slot) => Number.isFinite(slot.leftX) && Number.isFinite(slot.rightX) && slot.rightX >= slot.leftX && Number.isFinite(slot.topY) && Number.isFinite(slot.bottomY) && Number.isFinite(slot.occupiedHeight) && slot.occupiedHeight >= 0 && Number.isFinite(slot.unoccupiedEnvelopeHeight) && slot.unoccupiedEnvelopeHeight >= 0)), 'text block attribution must expose estimated and exact extents, occupied height and envelope slack by slot');
  const selectedExactComparison = coarseSeedDecision.selectedExactComparison;
  const unobstructedEstimate = estimateCoarseMainGeometry(result.document, result.metrics, result.template, renderConfig.pdf.orphan_min_lines);
  const coarseInsertionMap = new Map(coarseSeedDecision.insertionAssignments.map(({ flowId, blockId, page, slotId, box }) => [
    `${flowId}:${blockId}`,
    { page, slotId, box },
  ]));
  const projectedEstimate = projectCoarseInsertionDisplacement(unobstructedEstimate, result.template, coarseInsertionMap);
  const diagnosticFragments = (geometryEstimate) => geometryEstimate.contentMass
    .filter(({ blockId }) => blockId === 'body-market-1')
    .map(({ page, slotId, startWord, endWord, lineWordCounts }) => ({
      page, slotId, wordCount: endWord - startWord, lineCount: lineWordCounts?.length ?? 0,
    }));
  assert.ok(selectedExactComparison && Array.isArray(selectedExactComparison.pages), 'the selected exact plan must retain a fresh comparison against the original coarse estimate');
  assert.ok(Number.isFinite(selectedExactComparison.exactMainTerminalPage) && selectedExactComparison.exactTextWordCount > 0, 'the selected comparison must report its exact main terminal page and placed text mass');
  assert.ok(Math.abs(selectedExactComparison.estimatedTerminalPage - selectedExactComparison.exactMainTerminalPage) <= terminalPageErrorTolerance, `the selected representative plan must stay within the configured terminal-page prediction tolerance: ${JSON.stringify({ estimated: selectedExactComparison.estimatedTerminalPage, exact: selectedExactComparison.exactMainTerminalPage, tolerance: terminalPageErrorTolerance })}`);
  assert.ok(selectedExactComparison.pages.every(({ estimatedMassUnits, exactTextWords }) => estimatedMassUnits === exactTextWords), `the frozen representative fixture must preserve exact text mass per page after heading keep rules and insertion projection: ${JSON.stringify(selectedExactComparison.pages.map(({ page, estimatedMassUnits, exactTextWords }) => ({ page, estimatedMassUnits, exactTextWords })))}`);

  let oracleEvidence;
  let terminalInsertionOraclePlan;
  if (process.env.COMPOSITION_QUALITY_ORACLE === '1') {
    const textEngineModule = await import(bundles.textEngine);
    const { plannerPolicyFromRenderConfig } = textEngineModule.default ?? textEngineModule;
    const spacingModule = await import(bundles.spacing);
    const { attachPlanSpacingReport } = spacingModule.default ?? spacingModule;
    const oraclePolicy = plannerPolicyFromRenderConfig();
    const oraclePlanner = createTextCompositionPlanner(result.template, oraclePolicy);
    const oracleRecords = oraclePlanner.planCandidatesWithSignatures(result.document, result.metrics);
    const oracleEvaluations = oracleRecords.map(({ plan }) => {
      attachPlanSpacingReport(plan, result.document, result.metrics, geometry);
      return evaluateCompositionPlan(result.document, plan);
    });
    const terminalInsertionAlternatives = oracleRecords.flatMap(({ signature, plan }, index) => {
      const evaluation = oracleEvaluations[index];
      if (evaluation.status === 'rejected') return [];
      const mainLines = plan.lines.filter((line) => line.flowId === 'main' && line.layer !== 'insertion');
      const terminalMainPage = Math.max(0, ...mainLines.map(({ page }) => page));
      if (terminalMainPage <= 0) return [];
      const terminalInsertions = plan.graphicPlacements
        .filter((graphic) => graphic.page === terminalMainPage && graphic.graphicId.startsWith('insertion:'))
        .map(({ graphicId, box }) => ({ graphicId, box }));
      if (terminalInsertions.length === 0) return [];
      const component = (code) => evaluation.scoreBreakdown.find((candidate) => candidate.code === code);
      const occupancy = component('main-page-occupancy-balance');
      const pageLoad = component('page-load-balance');
      return [{
        signature,
        score: evaluation.score,
        terminalMainPage,
        terminalMainLineCount: mainLines.filter(({ page }) => page === terminalMainPage).length,
        terminalMainTextWords: mainLines.filter(({ page }) => page === terminalMainPage)
          .reduce((sum, line) => sum + Math.max(0, line.endWord - line.startWord), 0),
        terminalInsertions,
        ...(occupancy?.details.terminalPage === undefined ? {} : {
          terminalOccupancy: occupancy.details.terminalPage.occupancy,
          terminalOccupancyPenalty: occupancy.details.terminalPage.penalty,
        }),
        terminalPageLoad: pageLoad?.details.records.flatMap((record) => record.loads)
          .filter((load) => load.page === terminalMainPage)
          .map(({ page, load, graphicIds }) => ({ page, load, graphicIds })) ?? [],
        qualityPoints: evaluation.scoreBreakdown
          .filter(({ code }) => ['content-spread', 'empty-regions', 'insertion-text-continuity', 'main-page-occupancy-balance', 'orphan-lines', 'page-load-balance'].includes(code))
          .map(({ code, points }) => ({ code, points })),
        allScoreComponents: evaluation.scoreBreakdown.map(({ code, value, points }) => ({ code, value, points })),
        terminalSpacingEvidence: evaluation.scoreBreakdown
          .filter(({ code }) => ['spacing-rhythm', 'insertion-symmetry', 'insertion-text-continuity'].includes(code))
          .map(({ code, details }) => ({
            code,
            records: details.records?.filter((record) => record.page === terminalMainPage) ?? [],
          })),
      }];
    }).sort((left, right) => right.score - left.score);
    terminalInsertionOraclePlan = oracleRecords.find(({ signature }) =>
      signature === terminalInsertionAlternatives[0]?.signature)?.plan;
    const oracleCandidateSummaries = oracleRecords.flatMap(({ signature, plan }, index) => {
      const evaluation = oracleEvaluations[index];
      if (evaluation.status === 'rejected') return [];
      const mainLines = plan.lines.filter((line) => line.flowId === 'main' && line.layer !== 'insertion');
      const mainPages = [...new Set(mainLines.map(({ page }) => page))].sort((left, right) => left - right);
      const terminalMainPage = mainPages.at(-1);
      const terminalPage = evaluation.scoreBreakdown
        .find((candidate) => candidate.code === 'main-page-occupancy-balance')?.details.terminalPage;
      return [{
        signature,
        score: evaluation.score,
        totalPages: plan.pages.length,
        mainPages: mainPages.map((page) => {
          const lines = mainLines.filter((line) => line.page === page);
          return {
            page,
            lineCount: lines.length,
            wordCount: lines.reduce((sum, line) => sum + Math.max(0, line.endWord - line.startWord), 0),
          };
        }),
        terminalMainPage,
        terminalOccupancy: terminalPage?.occupancy,
        terminalPenalty: terminalPage?.penalty,
        insertionPages: [...new Set(plan.graphicPlacements
          .filter(({ graphicId }) => graphicId.startsWith('insertion:'))
          .map(({ page }) => page))].sort((left, right) => left - right),
      }];
    }).sort((left, right) => right.score - left.score);
    let oracleWinner = 0;
    for (let index = 1; index < oracleEvaluations.length; index += 1) {
      if (compareCompositionEvaluations(oracleEvaluations[index], oracleEvaluations[oracleWinner]) < 0) oracleWinner = index;
    }
    const oracleEvaluation = oracleEvaluations[oracleWinner];
    assert.equal(result.evaluation.status, oracleEvaluation.status, 'incremental quality search must preserve the exhaustive oracle legality');
    assert.ok(compareCompositionEvaluations(result.evaluation, oracleEvaluation) <= 0, `incremental quality search must not score below the exhaustive oracle: ${JSON.stringify({ incremental: result.evaluation.score, oracle: oracleEvaluation.score, oracleSignature: oracleRecords[oracleWinner]?.signature })}`);
    oracleEvidence = {
      oracleGeneratedCandidates: oracleRecords.length,
      oracleEvaluatedCandidates: oracleEvaluations.length,
      oracleLegalCandidates: oracleEvaluations.filter((evaluation) => evaluation.status !== 'rejected').length,
      oracleWinner: oracleRecords[oracleWinner]?.signature,
      oracleScore: oracleEvaluation.score,
      terminalInsertionAlternativeCount: terminalInsertionAlternatives.length,
      bestTerminalInsertionAlternatives: terminalInsertionAlternatives.slice(0, 5),
      bestExactPlanSummaries: oracleCandidateSummaries.slice(0, 10),
      incrementalWinner: result.plan.trace?.candidateSearch?.selectedProposalSignature,
      incrementalScore: result.evaluation.score,
      incrementalEvaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    };
    console.error(`[test-composition-quality-e2e] eager candidate oracle: ${JSON.stringify(oracleEvidence)}`);
  }
  const relocationProposal = result.plan.trace?.candidateSearch?.rounds
    .flatMap((round) => round.repairProposals ?? [])
    .find((proposal) => proposal.action === 'relocate');
  assert.ok(relocationProposal, 'a quality defect with a compatible fluid insertion slot must expose a relocation proposal');
  assert.ok(relocationProposal?.destination?.page && relocationProposal.destination.slotId && relocationProposal.destination.box, 'relocation proposals must expose a complete destination geometry');
  const relocationAttempt = result.plan.trace?.candidateSearch?.rounds
    .flatMap((round) => round.repairAttempts ?? [])
    .find((attempt) => attempt.proposalId === relocationProposal?.id);
  assert.equal(relocationAttempt?.status, 'evaluated', 'a relocation proposal must be materialized and completely evaluated before it can influence selection');
  const tightQuoteSource = qualitySource(source);
  tightQuoteSource.id = 'pages/editorial-inset-tight-quote-quality-check';
  tightQuoteSource.slots[quoteSlotId].frame = { ...tightQuoteSource.slots[quoteSlotId].frame, y: 0.255, height: 0.24 };
  const tightQuoteTemplate = compileTemplateSource(tightQuoteSource);
  const tightQuoteGeometry = pageGeometryFromTemplate(tightQuoteTemplate);
  const tightStartedAt = performance.now();
  const tightQuoteResult = planReportComposition(
    pdf,
    tightQuoteTemplate,
    tightQuoteGeometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles },
  );
  reportTiming('comparison planning + evaluation', tightStartedAt, {
    planningTimeMs: tightQuoteResult.plan.trace?.candidateSearch?.planningTimeMs,
    candidates: tightQuoteResult.plan.trace?.candidateSearch?.evaluatedCandidates,
  });
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(tightQuoteResult.evaluation.status, 'accepted', JSON.stringify(tightQuoteResult.evaluation));
  assert.deepEqual(result.plan.residualContent, []);
  assert.deepEqual(tightQuoteResult.plan.residualContent, []);
  const baselineMainDelay = result.evaluation.scoreBreakdown.find((component) => component.code === 'main-start-delay')?.points ?? 0;
  const tightMainDelay = tightQuoteResult.evaluation.scoreBreakdown.find((component) => component.code === 'main-start-delay')?.points ?? 0;
  assert.ok(Math.abs(baselineMainDelay) === 0, 'the content-first template must let main flow start at the top of its declared body placement');
  assert.ok(Number.isFinite(tightMainDelay), 'the dynamic quote comparison must expose a measurable main-start delay');
  const tightMainDelayEvidence = tightQuoteResult.evaluation.scoreBreakdown
    .find((component) => component.code === 'main-start-delay')?.details?.details ?? [];
  assert.ok(Math.abs(tightMainDelay) === 0 || tightMainDelayEvidence.some((record) => record.blockingInsertionIds?.length > 0), 'the dynamic quote comparison must attribute any non-zero main-start delay to the blocking insertion');
  const footerGapScore = result.evaluation.scoreBreakdown.find((component) => component.code === 'footer-gap');
  assert.ok(Number.isFinite(footerGapScore?.points), 'the editorial content frame must expose a measurable footer-gap score');
  const selectedTemplate = compareCompositionEvaluations(result.evaluation, tightQuoteResult.evaluation) <= 0 ? result : tightQuoteResult;
  const dynamicChromeSource = dynamicChromeQualitySource(parse(await readFile(join(root, 'templates/pages/editorial-dynamic-chrome/template.yml'), 'utf8')));
  const dynamicChromeTemplate = compileTemplateSource(dynamicChromeSource);
  const dynamicChromeGeometry = pageGeometryFromTemplate(dynamicChromeTemplate);
  const dynamicChromeInput = structuredClone(fixture.input);
  dynamicChromeInput.flows.main.blocks = [...dynamicChromeInput.flows.intro.blocks, ...dynamicChromeInput.flows.main.blocks];
  delete dynamicChromeInput.flows.intro;
  const dynamicChromeResult = planReportComposition(
    newPdf('portrait', [dynamicChromeGeometry.width, dynamicChromeGeometry.height]),
    dynamicChromeTemplate,
    dynamicChromeGeometry,
    dynamicChromeInput,
    { family: 'DejaVu', maxPages: renderConfig.pdf.composition_max_pages, styles },
  );
  assert.equal(dynamicChromeResult.evaluation.status, 'accepted', JSON.stringify(dynamicChromeResult.evaluation.hardViolations.map(({ code, flowId, message, details }) => ({ code, flowId, message, details }))));
  assert.deepEqual(dynamicChromeResult.plan.residualContent, [], 'the independent dynamic-chrome fixture must preserve all authored content');
  const dynamicChromeProgress = dynamicChromeResult.evaluation.scoreBreakdown.find((component) => component.code === 'content-spread');
  const dynamicChromeOccupancy = dynamicChromeResult.evaluation.scoreBreakdown.find((component) => component.code === 'main-page-occupancy-balance');
  assert.ok(dynamicChromeProgress?.details?.records?.length > 0 && dynamicChromeProgress.details.targetFitReward > 0, 'the independent dynamic-chrome plan must measure and reward insertion gravity fit');
  assert.ok(dynamicChromeOccupancy?.details?.measuredInteriorPageCount > 1 && dynamicChromeOccupancy.details.targetFitReward > 0, 'the independent dynamic-chrome plan must reward measured occupancy across several exact interior pages');
  const dynamicChromePdf = newPdf('portrait', [dynamicChromeGeometry.width, dynamicChromeGeometry.height]);
  const dynamicChromeArtifact = renderComposition(dynamicChromeResult.document, dynamicChromeResult, createJsPdfTextBackend(
    dynamicChromePdf,
    'DejaVu',
    styles,
    compositionPdfBackendOptionsFromRenderConfig(),
  ));
  const dynamicChromeArtifactPath = '/tmp/report-baby-composition-quality-dynamic-chrome.pdf';
  await writeFile(dynamicChromeArtifactPath, dynamicChromeArtifact);
  const dynamicChromeInk = await inspectPdfInk({
    artifactPath: dynamicChromeArtifactPath,
    pages: dynamicChromeResult.plan.pages,
    lines: dynamicChromeResult.plan.lines.map((line) => ({ page: line.page, id: line.blockId, slotId: line.slotId, box: line.box })),
    slots: dynamicChromeResult.plan.slots.map((slot) => ({ page: slot.page, id: slot.id, box: slot.box })),
    pageSize: { width: dynamicChromeGeometry.width, height: dynamicChromeGeometry.height },
    qa: renderConfig.quality.pdf_pixel_qa,
  });
  assert.ok(dynamicChromeInk.lineChecks.length > 0 && dynamicChromeInk.lineChecks.every(({ status }) => status === 'occupied'), 'the independent dynamic-chrome PDF must render ink inside each exact planned line box');
  assert.equal(selectedTemplate.evaluation.score, Math.max(result.evaluation.score, tightQuoteResult.evaluation.score), 'a caller comparing legal template alternatives must select the higher-scoring candidate');
  const plannedLines = [...selectedTemplate.plan.lines, ...(selectedTemplate.plan.insertionLines ?? [])];
  for (const glyph of selectedTemplate.plan.glyphPlacements ?? []) {
    if (glyph.anchor !== 'text-start' && glyph.anchor !== 'text-end') continue;
    const targetLines = plannedLines.filter((line) => line.page === glyph.page && line.blockId === glyph.targetId)
      .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
    const targetLine = glyph.anchor === 'text-start' ? targetLines[0] : targetLines.at(-1);
    const cells = targetLine?.glyphSamplingBoxes?.map((sample) => sample.box) ?? [];
    if (!targetLine || cells.length === 0) continue;
    const textLeft = Math.min(...cells.map((box) => box.x));
    const textRight = Math.max(...cells.map((box) => box.x + box.width));
    if (glyph.anchor === 'text-start') {
      assert.ok(glyph.box.x + glyph.box.width <= textLeft + 0.001, `opening glyph ${glyph.glyphId} must be anchored outside the first painted character`);
    } else {
      assert.ok(glyph.box.x >= textRight - 0.001, `closing glyph ${glyph.glyphId} must be anchored outside the last painted character`);
    }
  }
  assert.deepEqual(result.plan.residualContent, [], JSON.stringify(result.plan.residualContent));
  const quotePages = selectedTemplate.plan.graphicPlacements
    .filter((placement) => placement.graphicId.startsWith('insertion:'))
    .sort((left, right) => left.page - right.page)
    .map((placement) => placement.page);
  assert.equal(quotePages.length, 4, 'the selected dynamic capability must retain every authored quote');
  assert.ok(quotePages[0] >= 2, 'the dynamic quote capability must respect its page-start policy');
  assert.ok(new Set(quotePages).size >= 3, 'the selected dynamic capability must distribute quotes across pages');
  const scoredQuoteRelocations = selectedTemplate.plan.trace?.candidateSearch?.rounds
    .flatMap((round) => round.candidateResults ?? [])
    .filter((candidate) => candidate.repairProposalIds?.some((id) => id.includes('quotes:')) && Number.isFinite(candidate.scoreDelta)) ?? [];
  assert.ok(scoredQuoteRelocations.length > 0, 'the evaluator must record score deltas for generated dynamic quote relocation candidates');
  const continuity = selectedTemplate.evaluation.scoreBreakdown.find((component) => component.code === 'insertion-text-continuity');
  const autumnContinuity = continuity?.details?.records?.find((record) => record.blockId === 'quote-autumn');
  assert.ok(autumnContinuity && autumnContinuity.streamCount >= 1, 'the selected dynamic quote must expose text-continuity evidence');
  assert.ok(autumnContinuity.streams?.some((stream) => stream.hasBefore || stream.hasAfter), 'the selected dynamic quote must retain usable text adjacency evidence');
  assert.ok(Number.isFinite(autumnContinuity.crossStreamMassImbalance), 'the selected dynamic quote must expose cross-stream mass evidence');
  assert.ok(autumnContinuity.streams?.some((stream) => stream.afterGap === 0 && stream.edgeGapDeficit > 0), 'the spacing report must preserve an exact zero text edge so the evaluator can penalize a quote that touches following text');
  assert.equal(typeof result.evaluation.scoreBase, 'number', 'legal evaluation must expose the configured score base');
  assert.ok(result.evaluation.scoreUpperBound >= result.evaluation.score && result.evaluation.measuredRewardUpperBound <= result.evaluation.scoreUpperBound, 'public scoring bounds must be ceilings, not claimed attainable optima');
  assert.ok(Array.isArray(result.evaluation.placementScores), 'legal evaluation must expose score contributions by material placement');
  const attributedPoints = result.evaluation.placementScores.reduce((sum, placement) => sum + placement.points, 0);
  const attributionTolerance = Number.EPSILON * Math.max(1, Math.abs(result.evaluation.score)) * result.evaluation.placementScores.length * 4;
  assert.ok(Math.abs(result.evaluation.scoreBase + attributedPoints - result.evaluation.score) <= attributionTolerance, 'base plus placement contributions must conserve the plan score');
  for (const component of result.evaluation.scoreBreakdown) {
    const componentAttribution = result.evaluation.placementScores.flatMap((placement) => placement.contributions)
      .filter((contribution) => contribution.code === component.code)
      .reduce((sum, contribution) => sum + contribution.points, 0);
    assert.ok(Math.abs(componentAttribution - component.points) <= attributionTolerance, `component ${component.code} must be attributed exactly once`);
  }
  assert.ok(Array.isArray(result.evaluation.repairProposals), 'legal evaluation must expose machine-readable repair proposals');
  const { compositionQualitySummary, compositionQualityText } = await import(bundles.responses);
  const publicQuality = compositionQualitySummary(selectedTemplate.evaluation, selectedTemplate.plan);
  const seedPublicQuality = compositionQualitySummary(seedResult.evaluation, seedResult.plan);
  if (seedResult.plan.decisions.some((decision) => decision.code === 'PLACEMENT_GRAVITY_RELAXED')) {
    assert.ok(seedPublicQuality.placementGravity && typeof seedPublicQuality.placementGravity.iterations === 'number', 'the public quality summary must expose the cheap gravity trace whenever the baseline seed uses gravity');
  }
  assert.equal(publicQuality.scoreBase, selectedTemplate.evaluation.scoreBase, 'the public quality summary must expose the score base');
  assert.equal(publicQuality.scoreUpperBound, selectedTemplate.evaluation.scoreUpperBound, 'MCP quality must expose the configured algebraic ceiling');
  assert.equal(publicQuality.measuredRewardUpperBound, selectedTemplate.evaluation.measuredRewardUpperBound, 'MCP quality must preserve the evidence-based ceiling separately');
  const publicGravityBound = publicQuality.qualityComponents.find(({ code }) => code === 'content-spread');
  assert.equal(publicGravityBound.rewardCeiling, renderConfig.composition_score.content_spread_reward);
  assert.equal(publicGravityBound.rewardEvidence, 'measured');
  assert.ok(Number.isFinite(publicGravityBound.ceilingGap));
  assert.ok(Array.isArray(publicQuality.qualityComponents), 'the public quality summary must expose all measured score components');
  for (const code of ['content-spread', 'page-load-balance', 'source-relation', 'insertion-text-continuity']) {
    const component = publicQuality.qualityComponents.find((candidate) => candidate.code === code);
    assert.ok(component?.details, `the public quality summary must expose evidence details for ${code}`);
  }
  assert.equal(typeof publicQuality.highestImpactFinding?.kind, 'string', 'the public quality summary must identify the highest-impact unresolved finding');
  assert.equal(typeof publicQuality.highestImpactFinding?.code, 'string', 'the highest-impact finding must identify its source code');
  const planTimingNames = new Set((selectedTemplate.plan.trace?.timings ?? []).map(({ name }) => name));
  for (const name of ['document-materialization', 'contrast-assessment', 'legality-evaluation', 'spacing-evidence', 'scoring-and-repair-proposals']) {
    assert.ok(planTimingNames.has(name), `the selected plan trace must expose ${name} timing`);
  }
  assert.deepEqual(publicQuality.placementScores, selectedTemplate.evaluation.placementScores, 'the public quality summary must expose per-placement contributions');
  assert.deepEqual(publicQuality.repairProposals, selectedTemplate.evaluation.repairProposals, 'the public quality summary must expose evaluator repair proposals');
  assert.deepEqual(publicQuality.candidateSearch, selectedTemplate.plan.trace?.candidateSearch, 'the public quality summary must expose the complete-plan candidate trace');
  const rejectedRepairDiagnostics = publicQuality.candidateSearch.rounds
    .flatMap((round) => round.candidateResults ?? [])
    .filter((candidate) => !candidate.legal)
    .flatMap((candidate) => candidate.diagnostics ?? []);
  const refinementRound = publicQuality.candidateSearch.rounds.find((round) => round.round === 1);
  assert.ok(refinementRound, 'the configured movement policy must produce a recorded refinement round');
  assert.ok(refinementRound.generatedCandidates > 0 && (refinementRound.candidateResults?.length ?? 0) > 0, 'the configured movement policy must expose complete refinement outcomes');
  for (const diagnostic of rejectedRepairDiagnostics) {
    assert.ok(diagnostic.why && diagnostic.remedies?.length, `the public candidate trace must explain why ${diagnostic.code} rejected a repair and how to address it`);
    if (diagnostic.code === 'FLOW_SLOT_UNDERFILLED' || diagnostic.code === 'FLOW_FRAGMENT_UNDERFILLED') {
      assert.match(diagnostic.message, /before block .+, exceeding the underfilled threshold/u, 'underfilled diagnostics must name the next authored block and the tested threshold');
      assert.ok(Number.isFinite(diagnostic.details.details.underfilledThresholdLines), 'underfilled diagnostics must expose their line threshold');
      assert.ok(Number.isFinite(diagnostic.details.details.usableLines), 'underfilled diagnostics must expose measured usable capacity');
    }
    if (diagnostic.code === 'LINE_OVERLAP') {
      assert.ok(diagnostic.details.firstBox && diagnostic.details.secondBox, 'line-overlap diagnostics must expose both measured boxes');
      assert.ok(Number.isFinite(diagnostic.details.tolerance), 'line-overlap diagnostics must expose the geometry tolerance');
    }
    if (diagnostic.code === 'LINE_GRAPHIC_OVERLAP') {
      assert.ok(diagnostic.details.lineBox && diagnostic.details.graphicBox, 'line-graphic diagnostics must expose both measured boxes');
      assert.ok(Array.isArray(diagnostic.details.intersections), 'line-graphic diagnostics must expose measured intersections');
    }
  }
  const glyphOverlapComponent = selectedTemplate.evaluation.scoreBreakdown.find((component) => component.code === 'glyph-overlap');
  assert.equal(glyphOverlapComponent?.value, 0, 'font-specific quote-mark outlines must not report the false text collision previously caused by whole-font ascender/descender bounds');
  const glyphOverlapSuggestion = publicQuality.suggestions.find((suggestion) => suggestion.code === 'GLYPH_TEXT_OVERLAP');
  assert.equal(glyphOverlapSuggestion, undefined, 'the public quality summary must not report a glyph collision when the measured glyph outline clears all text cells');
  const largeHeaderGapSuggestion = publicQuality.suggestions.find((suggestion) => suggestion.code === 'HEADER_GAP_TOO_LARGE');
  assert.equal(largeHeaderGapSuggestion, undefined, 'the corrected editorial template must no longer report its previous excessive chrome-to-content gap');
  const excessiveGapSource = qualitySource(source);
  const pageHeight = source.page.height;
  const headerBand = source.page.reserved_bands?.header ?? source.slots.header.frame;
  const headerBandBottom = headerBand.y + (headerBand.height ?? 0);
  const targetGap = renderConfig.composition_score.spacing_profile_normal_target_mm
    + renderConfig.composition_score.spacing_profile_tolerance_mm + 1;
  const contentFrame = excessiveGapSource.slots.content.frame;
  const footerTop = excessiveGapSource.slots.footer.frame.y;
  contentFrame.y = headerBandBottom + (targetGap / pageHeight);
  contentFrame.height = footerTop - contentFrame.y;
  excessiveGapSource.regions.body = { ...contentFrame };
  excessiveGapSource.id = 'pages/editorial-inset-excessive-header-gap-quality-check';
  const excessiveGapTemplate = compileTemplateSource(excessiveGapSource);
  const excessiveGapGeometry = pageGeometryFromTemplate(excessiveGapTemplate);
  const excessiveGapResult = planReportComposition(
    pdf,
    excessiveGapTemplate,
    excessiveGapGeometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles },
  );
  assert.equal(excessiveGapResult.evaluation.status, 'accepted', JSON.stringify(excessiveGapResult.evaluation));
  const excessiveGapPublicQuality = compositionQualitySummary(excessiveGapResult.evaluation, excessiveGapResult.plan);
  const excessiveGapSuggestion = excessiveGapPublicQuality.suggestions.find((suggestion) => suggestion.code === 'HEADER_GAP_TOO_LARGE');
  assert.ok(excessiveGapSuggestion?.evidence?.pages?.some((record) => record.cause === 'header-content-gap'
    && record.excess > 0 && record.fromBox && record.toBox && record.templateRef), 'the ordinary public quality summary must identify an excessive chrome-to-content gap, its template and both measured boxes');
  assert.match(compositionQualityText(selectedTemplate.evaluation, selectedTemplate.plan), /"candidateSearch"/u, 'human-facing MCP quality text must expose the same candidate trace as structured output');
  const quoteSlots = selectedTemplate.plan.slots.filter((slot) => slot.id.includes(`${quoteSlotId}#`));
  assert.ok(quoteSlots.length > 0, 'fluid insertion capability must materialize page-local slot instances in the actual plan');
  assert.ok(quoteSlots.every((slot) => slot.id.includes('#1') || slot.id.includes('#2')), 'fluid capability must stay bounded to its declared per-page capacity');
  assert.ok(selectedTemplate.plan.insertionLines?.length >= 4, 'the real editorial fixture must place all authored quote insertions');
  assert.ok((selectedTemplate.plan.trace?.candidateSearch?.generatedCandidates ?? 0) >= 1, 'a dynamic insertion capability must produce at least one legal seed candidate');
  assertSpacingEvidence(selectedTemplate);
  const proximityPlan = structuredClone(selectedTemplate.plan);
  proximityPlan.spacing.observations.push({
    kind: 'element-proximity',
    page: 1,
    from: { kind: 'block', id: 'intro-lead', flowId: 'intro', blockId: 'intro-lead', slotId: '1:intro' },
    to: { kind: 'graphic', id: 'insertion:quote-near-intro', flowId: 'quotes', blockId: 'quote-near-intro', slotId: `1:${quoteSlotId}#1` },
    fromBox: { x: 20, y: 40, width: 170, height: 18 },
    toBox: { x: 20, y: 59, width: 170, height: 12 },
    metrics: { gap: 1, minimumGap: 6, deficit: 5, movementNeeded: 5, movementBudget: 8 },
    movementAvailable: true,
    reasons: ['elements-too-close'],
  });
  const proximityEvaluation = evaluateCompositionPlan(selectedTemplate.document, proximityPlan);
  const proximitySuggestion = proximityEvaluation.suggestions?.find((suggestion) => suggestion.code === 'ELEMENTS_TOO_CLOSE');
  assert.ok(proximitySuggestion, 'a measured pairwise gap must become a public evaluator suggestion');
  const proximityEvidence = proximitySuggestion.evidence.records.find((record) => record.from?.id === 'intro-lead' && record.to?.blockId === 'quote-near-intro');
  assert.ok(proximityEvidence, 'the public suggestion must include the authored intro/insertion pair');
  assert.equal(proximityEvidence.fromBox.y, 40, 'the public suggestion must expose measured geometry');
  assert.equal(proximityEvidence.to.blockId, 'quote-near-intro', 'the public suggestion must name both source elements');
  const renderPdf = newPdf('portrait', [geometry.width, geometry.height]);
  const renderStartedAt = performance.now();
  const artifact = renderComposition(selectedTemplate.document, selectedTemplate, createJsPdfTextBackend(
    renderPdf,
    'DejaVu',
    styles,
    compositionPdfBackendOptionsFromRenderConfig(),
  ));
  reportTiming('selected PDF rendering', renderStartedAt, { bytes: artifact.length, pages: selectedTemplate.plan.pages.length });
  reportTiming('complete quality scenario', timingStartedAt, { pages: result.plan.pages.length });
  const artifactPath = '/tmp/report-baby-composition-quality-e2e.pdf';
  await writeFile(artifactPath, artifact);
  await writeFile('/tmp/report-baby-composition-quality-e2e.json', `${JSON.stringify({ compositionPlan: selectedTemplate.plan, compositionEvaluation: selectedTemplate.evaluation }, null, 2)}\n`);
  assert.equal(artifact.subarray(0, 5).toString(), '%PDF-', 'the representative composition must render as a PDF');
  let terminalInsertionOracleArtifactPath;
  let terminalInsertionOracleInk;
  if (terminalInsertionOraclePlan) {
    const terminalOraclePdf = newPdf('portrait', [geometry.width, geometry.height]);
    const terminalOracleArtifact = renderComposition(result.document, {
      ...result,
      plan: terminalInsertionOraclePlan,
    }, createJsPdfTextBackend(
      terminalOraclePdf,
      'DejaVu',
      styles,
      compositionPdfBackendOptionsFromRenderConfig(),
    ));
    terminalInsertionOracleArtifactPath = '/tmp/report-baby-composition-quality-e2e-terminal-insertion-oracle.pdf';
    await writeFile(terminalInsertionOracleArtifactPath, terminalOracleArtifact);
    assert.equal(terminalOracleArtifact.subarray(0, 5).toString(), '%PDF-', 'the best legal terminal-insertion alternative must render as a PDF');
    terminalInsertionOracleInk = await inspectPdfInk({
      artifactPath: terminalInsertionOracleArtifactPath,
      pages: terminalInsertionOraclePlan.pages,
      lines: terminalInsertionOraclePlan.lines.map((line) => ({ page: line.page, id: line.blockId, slotId: line.slotId, box: line.box })),
      slots: terminalInsertionOraclePlan.slots.map((slot) => ({ page: slot.page, id: slot.id, box: slot.box })),
      pageSize: { width: geometry.width, height: geometry.height },
      qa: renderConfig.quality.pdf_pixel_qa,
    });
    assert.ok(terminalInsertionOracleInk.lineChecks.length > 0
      && terminalInsertionOracleInk.lineChecks.every(({ status }) => status === 'occupied'),
    'the best legal terminal-insertion alternative must rasterize ink inside every exact main/insertion line box');
  }
  let legacyComparisonEvidence;
  if (process.env.COMPOSITION_QUALITY_COMPARE_LEGACY === '1') {
    const textEngineModule = await import(bundles.textEngine);
    const { plannerPolicyFromRenderConfig } = textEngineModule.default ?? textEngineModule;
    const spacingModule = await import(bundles.spacing);
    const { attachPlanSpacingReport } = spacingModule.default ?? spacingModule;
    const basePolicy = plannerPolicyFromRenderConfig();
    const rollbackPolicy = {
      ...basePolicy,
      coarseGeometryFirst: false,
      searchBudget: {
        ...basePolicy.searchBudget,
        maxInitialCandidates: 1,
        maxRefinementRounds: 0,
        maxPageLocalRefinementRounds: 0,
        maxFullPlanRecalculations: 1,
      },
    };
    const legacyResult = createTextCompositionEngine(result.template, rollbackPolicy).plan(result.document, result.metrics);
    attachPlanSpacingReport(legacyResult.plan, result.document, result.metrics, geometry);
    const legacyEvaluation = evaluateCompositionPlan(result.document, legacyResult.plan);
    assert.equal(legacyEvaluation.status, 'accepted', `the configured legacy rollback baseline must be exactly legal: ${JSON.stringify(legacyEvaluation.hardViolations.map(({ code }) => code))}`);
    const legacyPdf = newPdf('portrait', [geometry.width, geometry.height]);
    const legacyArtifact = renderComposition(result.document, legacyResult, createJsPdfTextBackend(
      legacyPdf,
      'DejaVu',
      styles,
      compositionPdfBackendOptionsFromRenderConfig(),
    ));
    const legacyArtifactPath = '/tmp/report-baby-composition-quality-e2e-legacy.pdf';
    await writeFile(legacyArtifactPath, legacyArtifact);
    assert.equal(legacyArtifact.subarray(0, 5).toString(), '%PDF-', 'the legacy rollback baseline must render as a PDF');
    const rasterEvidenceFor = (artifactPath, plan) => inspectPdfInk({
      artifactPath,
      pages: plan.pages,
      lines: plan.lines.map((line) => ({ page: line.page, id: line.blockId, slotId: line.slotId, box: line.box })),
      slots: plan.slots.map((slot) => ({ page: slot.page, id: slot.id, box: slot.box })),
      pageSize: { width: geometry.width, height: geometry.height },
      qa: renderConfig.quality.pdf_pixel_qa,
    });
    const [coarseInk, legacyInk] = await Promise.all([
      rasterEvidenceFor(artifactPath, selectedTemplate.plan),
      rasterEvidenceFor(legacyArtifactPath, legacyResult.plan),
    ]);
    assert.ok(coarseInk.lineChecks.length > 0 && coarseInk.lineChecks.every(({ status }) => status === 'occupied'), 'coarse-selected representative PDF must render ink inside each exact planned line box');
    assert.ok(legacyInk.lineChecks.length > 0 && legacyInk.lineChecks.every(({ status }) => status === 'occupied'), 'legacy rollback representative PDF must render ink inside each exact planned line box');
    const coarseMainPages = [...new Set(selectedTemplate.plan.lines.filter(({ flowId, layer }) => flowId === 'main' && layer !== 'insertion').map(({ page }) => page))];
    const legacyMainPages = [...new Set(legacyResult.plan.lines.filter(({ flowId, layer }) => flowId === 'main' && layer !== 'insertion').map(({ page }) => page))];
    const coarseInsertionPages = [...new Set(selectedTemplate.plan.graphicPlacements.filter(({ graphicId }) => graphicId.startsWith('insertion:')).map(({ page }) => page))];
    const legacyInsertionPages = [...new Set(legacyResult.plan.graphicPlacements.filter(({ graphicId }) => graphicId.startsWith('insertion:')).map(({ page }) => page))];
    assert.ok(selectedTemplate.plan.pages.length < legacyResult.plan.pages.length, `the coarse plan must avoid insertion-only spill pages on the frozen representative input: ${JSON.stringify({ coarsePages: selectedTemplate.plan.pages.length, legacyPages: legacyResult.plan.pages.length })}`);
    assert.ok(selectedTemplate.evaluation.score > legacyEvaluation.score, `the exact evaluator must prefer the coarse plan on the frozen representative input: ${JSON.stringify({ coarseScore: selectedTemplate.evaluation.score, legacyScore: legacyEvaluation.score })}`);
    assert.ok(coarseInsertionPages.every((page) => coarseMainPages.includes(page)), `every coarse insertion must share a page with main content: ${JSON.stringify({ coarseInsertionPages, coarseMainPages })}`);
    assert.ok(legacyInsertionPages.some((page) => !legacyMainPages.includes(page)), `the frozen legacy path must retain its measured insertion-only page regression: ${JSON.stringify({ legacyInsertionPages, legacyMainPages })}`);
    legacyComparisonEvidence = {
      coarse: {
        pages: selectedTemplate.plan.pages.length,
        mainPages: coarseMainPages,
        insertionPages: coarseInsertionPages,
        score: selectedTemplate.evaluation.score,
      generatedCandidates: selectedTemplate.plan.trace?.candidateSearch?.generatedCandidates,
      phaseTimings: selectedTemplate.plan.trace?.candidateSearch?.phaseTimings,
      fullPlanRecalculations: selectedTemplate.plan.trace?.candidateSearch?.fullPlanRecalculations,
      searchRounds: selectedTemplate.plan.trace?.candidateSearch?.rounds.map((round) => ({
        round: round.round,
        scope: round.scope,
        generatedCandidates: round.generatedCandidates,
        evaluatedCandidates: round.evaluatedCandidates,
        stopReason: round.stopReason,
        candidateRepairIds: round.candidateResults?.map(({ repairProposalIds }) => repairProposalIds ?? []),
      })),
      exactBaselineMaterializations: coarseSeedDecision.baselineExactMaterializationCount,
        renderedLineChecks: coarseInk.lineChecks.length,
        occupiedLineChecks: coarseInk.lineChecks.filter(({ status }) => status === 'occupied').length,
      },
      legacy: {
        pages: legacyResult.plan.pages.length,
        mainPages: legacyMainPages,
        insertionPages: legacyInsertionPages,
        score: legacyEvaluation.score,
        generatedCandidates: legacyResult.plan.trace?.candidateSearch?.generatedCandidates,
        phaseTimings: legacyResult.plan.trace?.candidateSearch?.phaseTimings,
        fullPlanRecalculations: legacyResult.plan.trace?.candidateSearch?.fullPlanRecalculations,
        searchRounds: legacyResult.plan.trace?.candidateSearch?.rounds.map((round) => ({
          round: round.round,
          scope: round.scope,
          generatedCandidates: round.generatedCandidates,
          evaluatedCandidates: round.evaluatedCandidates,
          stopReason: round.stopReason,
          candidateRepairIds: round.candidateResults?.map(({ repairProposalIds }) => repairProposalIds ?? []),
        })),
        renderedLineChecks: legacyInk.lineChecks.length,
        occupiedLineChecks: legacyInk.lineChecks.filter(({ status }) => status === 'occupied').length,
      },
      legacyArtifactPath,
    };
  }
  let comparisonArtifactPath;
  if (process.env.COMPOSITION_QUALITY_COMPARE_ARTIFACTS === '1') {
    const comparisonPdf = newPdf('portrait', [tightQuoteGeometry.width, tightQuoteGeometry.height]);
    const comparisonArtifact = renderComposition(tightQuoteResult.document, tightQuoteResult, createJsPdfTextBackend(
      comparisonPdf,
      'DejaVu',
      styles,
      compositionPdfBackendOptionsFromRenderConfig(),
    ));
    comparisonArtifactPath = '/tmp/report-baby-composition-quality-e2e-tight-quotes.pdf';
    await writeFile(comparisonArtifactPath, comparisonArtifact);
    assert.equal(comparisonArtifact.subarray(0, 5).toString(), '%PDF-', 'the legal comparison alternative must also render as a PDF');
  }
  console.log(JSON.stringify({
    status: 'passed',
    mode: 'plan-and-representative-artifact',
    pages: result.plan.pages.length,
    insertionSlots: quoteSlots.length,
    insertionLines: selectedTemplate.plan.insertionLines?.length ?? 0,
    insertionGeometry: {
      coarseAssignments: coarseSeedDecision.insertionAssignments,
      exactGraphics: result.plan.graphicPlacements
        .filter(({ graphicId }) => graphicId.startsWith('insertion:'))
        .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box })),
    },
    columnSplitDiagnostic: {
      blockId: 'body-market-1',
      configuredMinimumLinesAtEnd: renderConfig.pdf.orphan_min_lines,
      unobstructedCoarseFragments: diagnosticFragments(unobstructedEstimate),
      projectedCoarseFragments: diagnosticFragments(projectedEstimate),
      exactFragments: [...selectedTemplate.plan.lines
        .filter(({ blockId }) => blockId === 'body-market-1')
        .reduce((fragments, line) => {
          const key = `${line.page}:${line.slotId}`;
          const fragment = fragments.get(key) ?? { page: line.page, slotId: line.slotId, lines: 0, words: 0, topY: line.box.y, bottomY: line.box.y + line.box.height };
          fragment.lines += 1;
          fragment.words += line.endWord - line.startWord;
          fragment.topY = Math.min(fragment.topY, line.box.y);
          fragment.bottomY = Math.max(fragment.bottomY, line.box.y + line.box.height);
          fragments.set(key, fragment);
          return fragments;
        }, new Map()).values()],
      pageOneWrappingGraphics: selectedTemplate.plan.graphicPlacements
        .filter(({ page, wrap }) => page === 1 && wrap === 'around')
        .map(({ graphicId, slotId, box }) => ({ graphicId, slotId, box })),
    },
    observations: selectedTemplate.plan.spacing?.observations.length ?? 0,
    coarseCalibration: {
      baseline: {
        estimatedTerminalPage: baselineExactComparison.estimatedTerminalPage,
        exactMainTerminalPage: baselineExactComparison.exactMainTerminalPage,
        exactTextWordCount: baselineExactComparison.exactTextWordCount,
      },
      selected: {
        estimatedTerminalPage: selectedExactComparison.estimatedTerminalPage,
        exactMainTerminalPage: selectedExactComparison.exactMainTerminalPage,
        exactTextWordCount: selectedExactComparison.exactTextWordCount,
        unrepresentedNonTextMassBlockCount: selectedExactComparison.unrepresentedNonTextMassBlockCount,
        dynamicReservations: coarseSeedDecision.dynamicReservations,
        pageMass: selectedExactComparison.pages.map(({ page, estimatedMassUnits, exactTextWords, blocks }) => ({
          page,
          estimatedMassUnits,
          exactTextWords,
          blocks: blocks?.map(({ blockId, estimatedMassUnits: estimatedWords, exactTextWords: exactWords, estimatedLineCount, exactLineCount, estimatedBySlot, exactBySlot }) => ({
            blockId,
            estimatedWords,
            exactWords,
            ...(estimatedLineCount === undefined ? {} : { estimatedLineCount }),
            ...(exactLineCount === undefined ? {} : { exactLineCount }),
            estimatedBySlot,
            exactBySlot,
          })),
        })),
      },
    },
    qualityAlternatives: [result, tightQuoteResult].map((candidate) => ({
      template: candidate.template.id,
      score: candidate.evaluation.score,
      status: candidate.evaluation.status,
      qualitySignals: candidate.evaluation.scoreBreakdown
        .filter((component) => ['main-start-delay', 'empty-regions', 'glyph-overlap', 'insertion-symmetry', 'insertion-distribution', 'content-spread', 'page-load-balance', 'main-page-occupancy-balance', 'spacing-rhythm'].includes(component.code))
        .map(({ code, points }) => ({ code, points })),
      firstPageHeaderLines: candidate.plan.lines
        .filter((line) => line.page === 1 && line.flowId === 'header')
        .map(({ blockId, text, box }) => ({ blockId, text, box })),
    })),
    selectedTemplate: selectedTemplate.template.id,
    ...(comparisonArtifactPath === undefined ? {} : { comparisonArtifactPath }),
    ...(terminalInsertionOracleArtifactPath === undefined ? {} : {
      terminalInsertionOracleArtifactPath,
      terminalInsertionOracleInk: {
        lineChecks: terminalInsertionOracleInk.lineChecks.length,
        occupiedLineChecks: terminalInsertionOracleInk.lineChecks.filter(({ status }) => status === 'occupied').length,
        terminalPageLineCount: terminalInsertionOraclePlan.lines.filter(({ page, flowId, layer }) => page === Math.max(...terminalInsertionOraclePlan.pages.map(({ page: candidatePage }) => candidatePage)) && flowId === 'main' && layer !== 'insertion').length,
      },
    }),
    ...(legacyComparisonEvidence === undefined ? {} : { legacyComparisonEvidence }),
    dynamicChromeEvidence: {
      template: dynamicChromeResult.template.id,
      pages: dynamicChromeResult.plan.pages.length,
      score: dynamicChromeResult.evaluation.score,
      contentSpreadReward: dynamicChromeProgress.details.targetFitReward,
      occupancyReward: dynamicChromeOccupancy.details.targetFitReward,
      terminalPage: dynamicChromeOccupancy.details.terminalPage,
      terminalPenalty: dynamicChromeOccupancy.details.terminalPenalty,
      interiorPages: dynamicChromeOccupancy.details.pages,
      renderedLineChecks: dynamicChromeInk.lineChecks.length,
      occupiedLineChecks: dynamicChromeInk.lineChecks.filter(({ status }) => status === 'occupied').length,
      artifactPath: dynamicChromeArtifactPath,
    },
    scoreBase: selectedTemplate.evaluation.scoreBase,
    scoreUpperBound: selectedTemplate.evaluation.scoreUpperBound,
    measuredRewardUpperBound: selectedTemplate.evaluation.measuredRewardUpperBound,
    scoreBreakdown: selectedTemplate.evaluation.scoreBreakdown.map(({ code, value, points, details }) => ({
      code,
      value,
      points,
      ...(typeof details.targetFitReward === 'number' ? { targetFitReward: details.targetFitReward } : {}),
      ...(code === 'content-spread' ? { gravityTargets: details.records.map(({ blockId, expectedProgress, actualProgress, visualLoad, deviation }) => ({ blockId, expectedProgress, actualProgress, visualLoad, deviation })) } : {}),
      ...(code === 'spacing-rhythm' ? { spacingTargets: details.records.map(({ page, blockId, side, target, gap, deviation }) => ({ page, blockId, side, target, gap, deviation })) } : {}),
      ...(code === 'main-page-occupancy-balance' ? { occupancyPages: details.pages, terminalPage: details.terminalPage, terminalPenalty: details.terminalPenalty } : {}),
    })),
    glyphOverlapEvidence: selectedTemplate.evaluation.scoreBreakdown
      .find((component) => component.code === 'glyph-overlap')?.details.records.map((record) => ({
        page: record.page,
        glyph: record.glyphId,
        glyphPlacementId: record.glyphPlacementId,
        targetId: record.targetId,
        textBlockId: record.blockId,
        textSlotId: record.textSlotId,
        glyphBox: record.glyphBox,
        textCell: record.textCell,
        overlapBox: record.overlapBox,
        overlapArea: record.overlapArea,
      })) ?? [],
    candidateSearch: selectedTemplate.plan.trace?.candidateSearch && {
      selectedCandidate: selectedTemplate.plan.trace.candidateSearch.selectedCandidate,
      generatedCandidates: selectedTemplate.plan.trace.candidateSearch.generatedCandidates,
      evaluatedCandidates: selectedTemplate.plan.trace.candidateSearch.evaluatedCandidates,
      rounds: selectedTemplate.plan.trace.candidateSearch.rounds.map((round) => ({
        round: round.round,
        generatedCandidates: round.generatedCandidates,
        evaluatedCandidates: round.evaluatedCandidates,
        legalCandidates: round.legalCandidates,
        bestScore: round.bestScore,
        improved: round.improved,
        stopReason: round.stopReason,
        repairProposals: round.repairProposals?.map(({ id, code, placement, action, destination }) => ({ id, code, placement, action, ...(destination === undefined ? {} : { destination }) })),
        repairAttempts: round.repairAttempts?.map(({ proposalId, status, testedDistance, scoreDelta }) => ({ proposalId, status, testedDistance, scoreDelta })),
        candidateResults: round.candidateResults?.map(({ legal, score, scoreDelta, repairProposalIds, diagnostics }) => ({
          legal,
          score,
          scoreDelta,
          repairProposalIds,
          diagnostics: diagnostics?.map(({ severity, code, message, flowId, blockId, page, slotId, details, remedies }) => ({ severity, code, message, flowId, blockId, page, slotId, details, remedies })),
        })),
      })),
    },
    ...(oracleEvidence === undefined ? {} : { oracleEvidence }),
    refinementInputs: {
      movableInsertionFrames: selectedTemplate.plan.movableInsertionFrames?.map(({ blockId, flowId, page, box, axis }) => ({ blockId, flowId, page, box, axis })),
      repairProposals: selectedTemplate.evaluation.repairProposals?.map(({ id, sourceCode, placement, action, axis, direction, distance, estimatedPoints }) => ({ id, sourceCode, placement, action, axis, direction, distance, estimatedPoints })),
    },
    suggestions: selectedTemplate.evaluation.suggestions?.map(({ code, why, remedies }) => ({ code, why, remedies })) ?? [],
    artifactPath,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
