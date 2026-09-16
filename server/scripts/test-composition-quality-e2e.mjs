#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';

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
  primitives: join(temporary, 'rendering/primitives.cjs'),
  template: join(temporary, 'template/contracts.cjs'),
  geometry: join(temporary, 'template/geometry.cjs'),
};

async function buildPlanningBundles() {
  await build({
    entryPoints: [
      'src/composition/report-composition-entrypoint.ts',
      'src/composition/index.ts',
      'src/composition/adapters/pdf/backend.ts',
      'src/interfaces/mcp/responses.ts',
      'src/rendering/primitives.ts',
      'src/template/contracts.ts',
      'src/template/geometry.ts',
    ],
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
  delete result.slots['quote-a'];
  delete result.slots['quote-b'];
  delete result.slots['quote-c'];
  result.slots['quote-capability'] = {
    type: 'text',
    region: 'body',
    frame: { x: 0.081, y: 0.34, width: 0.838, height: 0.36 },
    role: 'quote',
    fit_content: true,
    placement: { mode: 'fluid-y', region: 'body', max_instances_per_page: 2, distribution: 'balanced' },
  };
  result.flows.quotes.slots = ['quote-capability'];
  result.flows.quotes.insertion_slots = ['quote-capability'];
  return result;
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
    const measuredBottom = Math.max(
      page.bands.header.y + page.bands.header.height,
      ...headerLines.map((line) => line.box.y + line.box.height),
    );
    assert.equal(observation.metrics.headerBottom, measuredBottom, 'dynamic header spacing must start below whichever is lower: the reserved band or the measured header content');
    assert.equal(observation.metrics.headerContentGap, observation.metrics.firstContentTop - measuredBottom, 'header spacing must be derived from measured chrome and first-material boxes');
    assert.ok(observation.fromBox.y <= page.bands.header.y, 'header-gap evidence must include the reserved header band');
    assert.ok(observation.fromBox.y + observation.fromBox.height >= measuredBottom, 'header-gap evidence must include any header content extending below its reserved band');
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
    'spacing-rhythm',
    'narrow-text-interval',
    'fit-content-envelope',
    'header-spacing',
    'insertion-spacing',
    'footer-gap',
    'main-start-delay',
    'element-proximity',
    'glyph-overlap',
    'orphan-lines',
  ];
  const scoreCodes = new Set(result.evaluation.scoreBreakdown.map((component) => component.code));
  for (const code of expectedQualityCodes) assert.ok(scoreCodes.has(code), `evaluation must include quality component ${code}`);
  for (const suggestion of result.evaluation.suggestions ?? []) {
    assert.ok(suggestion.evidence, `suggestion ${suggestion.code} must include measured evidence`);
    assert.ok(Array.isArray(suggestion.remedies) && suggestion.remedies.length > 0, `suggestion ${suggestion.code} must include remediation`);
    assert.ok(suggestion.why, `suggestion ${suggestion.code} must explain the violation`);
  }
}

await buildPlanningBundles();

try {
  const { planReportComposition, compositionPdfBackendOptionsFromRenderConfig, compositionStylesFromRenderConfig } = await import(bundles.adapter);
  const { renderComposition, evaluateCompositionPlan, compareCompositionEvaluations } = await import(bundles.backend);
  const { createJsPdfTextBackend } = await import(bundles.pdfBackend);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-inset-two-column/template.yml'), 'utf8'));
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const dynamicSource = qualitySource(source);
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
    { family: 'DejaVu', maxPages: 6, styles },
  );
  reportTiming('seed planning + evaluation', seedStartedAt, {
    planningTimeMs: seedResult.plan.trace?.candidateSearch?.planningTimeMs,
    candidates: seedResult.plan.trace?.candidateSearch?.evaluatedCandidates,
  });
  const movementWindow = geometry.height * renderConfig.composition_search.movable_window_ratio;
  const movableInsertionBounds = Object.fromEntries(seedResult.plan.graphicPlacements
    .filter((placement) => placement.graphicId === 'insertion:quote-market')
    .map((placement) => {
      const minimumY = Math.max(geometry.content.top, placement.box.y - movementWindow);
      const maximumY = Math.min(geometry.content.bottom - placement.box.height, placement.box.y + movementWindow);
      return [`quotes:${placement.graphicId.slice('insertion:'.length)}`, {
        bounds: {
          x: placement.box.x,
          y: minimumY,
          width: placement.box.width,
          height: maximumY - minimumY + placement.box.height,
        },
        axis: 'y',
        preferred: { y: placement.box.y },
        candidateCount: renderConfig.composition_search.movable_candidate_count,
        refinementRounds: renderConfig.composition_search.movable_refinement_rounds,
        refinementCandidateCount: Math.min(2, renderConfig.composition_search.movable_refinement_candidate_count),
      }];
    }));
  const optimizedStartedAt = performance.now();
  const result = planReportComposition(
    pdf,
    compiled,
    geometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles, policy: { movableInsertionBounds } },
  );
  reportTiming('optimized planning + evaluation loop', optimizedStartedAt, {
    planningTimeMs: result.plan.trace?.candidateSearch?.planningTimeMs,
    rounds: result.plan.trace?.candidateSearch?.rounds.map(({ round, generatedCandidates, evaluatedCandidates, stopReason }) => ({ round, generatedCandidates, evaluatedCandidates, stopReason })),
    candidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
  });
  assert.ok(result.evaluation.score >= seedResult.evaluation.score, `optional movement candidates must retain the unmoved seed plan so a move cannot force a lower-scoring result: ${JSON.stringify({ optimizedScore: result.evaluation.score, seedScore: seedResult.evaluation.score, selected: result.plan.trace?.candidateSearch?.selectedCandidate, seedComponents: seedResult.evaluation.scoreBreakdown.map(({ code, points }) => [code, points]) })}`);
  assert.ok((result.plan.trace?.candidateSearch?.generatedCandidates ?? 0) > (seedResult.plan.trace?.candidateSearch?.generatedCandidates ?? 0), 'the declared quote movement window must generate additional complete-plan candidates');
  const tightQuoteSource = qualitySource(source);
  tightQuoteSource.id = 'pages/editorial-inset-tight-quote-quality-check';
  tightQuoteSource.slots['quote-capability'].frame = { ...tightQuoteSource.slots['quote-capability'].frame, y: 0.255, height: 0.24 };
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
  assert.ok(Math.abs(tightMainDelay) === 0, 'a quote below the first main line must not count as delaying main flow');
  const footerGapScore = result.evaluation.scoreBreakdown.find((component) => component.code === 'footer-gap');
  assert.ok(Math.abs(footerGapScore?.points ?? 0) === 0, 'the editorial content frame must preserve the configured minimum distance from the footer');
  const selectedTemplate = compareCompositionEvaluations(result.evaluation, tightQuoteResult.evaluation) <= 0 ? result : tightQuoteResult;
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
  assert.equal(typeof result.evaluation.scoreBase, 'number', 'legal evaluation must expose the configured score base');
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
  assert.equal(publicQuality.scoreBase, selectedTemplate.evaluation.scoreBase, 'the public quality summary must expose the score base');
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
  const headerBandBottom = source.page.reserved_bands.header.y + source.page.reserved_bands.header.height;
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
  const quoteSlots = selectedTemplate.plan.slots.filter((slot) => slot.id.includes('quote-capability#'));
  assert.ok(quoteSlots.length > 0, 'fluid insertion capability must materialize page-local slot instances in the actual plan');
  assert.ok(quoteSlots.every((slot) => slot.id.includes('#1') || slot.id.includes('#2')), 'fluid capability must stay bounded to its declared per-page capacity');
  assert.ok(selectedTemplate.plan.insertionLines?.length >= 4, 'the real editorial fixture must place all authored quote insertions');
  assert.ok((selectedTemplate.plan.trace?.candidateSearch?.generatedCandidates ?? 0) >= 2, 'a dynamic intro must produce an earliest-slot and an optional skip-first insertion candidate');
  assertSpacingEvidence(selectedTemplate);
  const proximityPlan = structuredClone(selectedTemplate.plan);
  proximityPlan.spacing.observations.push({
    kind: 'element-proximity',
    page: 1,
    from: { kind: 'block', id: 'intro-lead', flowId: 'intro', blockId: 'intro-lead', slotId: '1:intro' },
    to: { kind: 'graphic', id: 'insertion:quote-near-intro', flowId: 'quotes', blockId: 'quote-near-intro', slotId: '1:quote-capability#1' },
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
  assert.equal(artifact.subarray(0, 5).toString(), '%PDF-', 'the representative composition must render as a PDF');
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
    observations: selectedTemplate.plan.spacing?.observations.length ?? 0,
    qualityAlternatives: [result, tightQuoteResult].map((candidate) => ({
      template: candidate.template.id,
      score: candidate.evaluation.score,
      status: candidate.evaluation.status,
      qualitySignals: candidate.evaluation.scoreBreakdown
        .filter((component) => ['main-start-delay', 'empty-regions', 'glyph-overlap', 'insertion-symmetry', 'insertion-distribution', 'spacing-rhythm'].includes(component.code))
        .map(({ code, points }) => ({ code, points })),
      firstPageHeaderLines: candidate.plan.lines
        .filter((line) => line.page === 1 && line.flowId === 'header')
        .map(({ blockId, text, box }) => ({ blockId, text, box })),
    })),
    selectedTemplate: selectedTemplate.template.id,
    ...(comparisonArtifactPath === undefined ? {} : { comparisonArtifactPath }),
    scoreBreakdown: selectedTemplate.evaluation.scoreBreakdown.map(({ code, value, points }) => ({ code, value, points })),
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
        repairProposals: round.repairProposals?.map(({ id, code, placement, action }) => ({ id, code, placement, action })),
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
