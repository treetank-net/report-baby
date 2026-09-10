#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';
import {
  assertEditorialTemplateContract,
  assertExactNumberSet,
  assertFlowBarrierBoxCandidates,
  assertFlowPlacementRegistryMatchesPlan,
  assertNoEmptyContinuationColumn,
  assertNoInternalRouteGaps,
  assertOrdinaryLinesRespectFlowBarrierBoxCandidates,
  assertPhysicalReadingOrder,
  assertQuoteFlowOwnership,
  numberedTokens,
  numbers,
} from './lib/editorial-numbered-plan-assertions.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-editorial-plan-'));
const bundles = {
  adapter: join(temporary, 'composition/report-composition-entrypoint.cjs'),
  backend: join(temporary, 'composition/index.cjs'),
  primitives: join(temporary, 'rendering/primitives.cjs'),
  template: join(temporary, 'template/contracts.cjs'),
  geometry: join(temporary, 'template/geometry.cjs'),
};

/**
 * @test-decision merge-shared-bundle
 * @test-action Build the renderer-neutral planning dependencies once; this test does not render or write a PDF artifact.
 */
async function buildPlanningBundles() {
  await build({
    entryPoints: [
      'src/composition/report-composition-entrypoint.ts',
      'src/composition/index.ts',
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

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep one stable style seam for plan measurement; style geometry comes from the render configuration, not test literals.
 */
function editorialStyles(compositionStylesFromRenderConfig) {
  return compositionStylesFromRenderConfig({
    foreground: [25, 51, 79],
    muted: [88, 106, 131],
    primary: [42, 110, 166],
    quote: [232, 117, 61],
  });
}

/**
 * @test-decision plan-assertion
 * @test-action Keep candidate-search assertions here because they exercise the real editorial template; detailed evaluator unit cases belong to engine tests.
 */
function assertMovableQuoteCandidateSearch(result, fixedResult, geometry, renderConfig, planReportComposition, newPdf, compiled, fixture, styles) {
  const fixedQuote = fixedResult.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-market');
  assert.ok(fixedQuote, 'editorial fixture must expose the quote selected for movable-position search');
  const movableQuoteWindow = geometry.height * renderConfig.composition_search.movable_quote_window_ratio;
  const movableQuotePolicy = {
    movableInsertionBounds: {
      'quotes:quote-market': {
        bounds: {
          x: fixedQuote.box.x,
          y: fixedQuote.box.y - movableQuoteWindow,
          width: fixedQuote.box.width,
          height: fixedQuote.box.height + (2 * movableQuoteWindow),
        },
        axis: 'y',
        preferred: { y: fixedQuote.box.y },
        // The engine contract owns the full coarse/refinement matrix. The
        // real-editorial integration only needs two legal alternatives to
        // prove that the template route carries candidate search correctly.
        candidateCount: Math.min(2, renderConfig.composition_search.movable_quote_candidate_count),
        refinementRounds: 0,
        refinementCandidateCount: 0,
      },
    },
  };
  const movableResult = planReportComposition(
    newPdf('portrait', [geometry.width, geometry.height]),
    compiled,
    geometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 12, policy: movableQuotePolicy, styles },
  );
  const evaluationPhase = movableResult.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  const candidates = evaluationPhase?.details?.candidates ?? [];
  const searchTrace = movableResult.plan.trace?.candidateSearch;
  assert.equal(movableResult.evaluation.status, 'accepted', JSON.stringify(movableResult.evaluation));
  assert.ok(candidates.length >= 2, 'real editorial candidate search must evaluate more than the fixed placement');
  assert.ok((searchTrace?.generatedCandidates ?? 0) >= candidates.length, 'editorial candidate trace must account for every generated candidate');
  assert.equal(searchTrace?.evaluatedCandidates, candidates.length, 'editorial candidate trace must account for every evaluated candidate');
  assert.ok(Number.isFinite(searchTrace?.planningTimeMs) && searchTrace.planningTimeMs >= 0, 'editorial candidate trace must expose observed planning time');
  assert.equal(searchTrace?.selectedCandidate, evaluationPhase?.details?.selectedCandidate, 'editorial trace and evaluation must identify the same winner');
  assert.ok(candidates.every((candidate) => candidate.status === 'accepted'), 'movable quote candidates must remain legal');
  assert.ok(new Set(candidates.map((candidate) => candidate.score)).size > 1, 'movable quote search must distinguish candidate quality');
  const selectedCandidate = candidates.find((candidate) => candidate.index === evaluationPhase.details.selectedCandidate);
  assert.ok(selectedCandidate?.status === 'accepted', 'real editorial candidate search must select a legal candidate');
  assert.ok(Number.isFinite(movableResult.evaluation.score), 'real editorial candidate search must produce a finite score');
  const movableQuote = movableResult.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-market');
  assert.ok(movableQuote, 'movable quote result must retain the quote placement');
  assert.ok(Math.abs(movableQuote.box.y - fixedQuote.box.y) <= movableQuoteWindow + renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm, 'selected movable quote must remain inside its configured micro-window');
  if (movableResult.evaluation.score === fixedResult.evaluation.score) assert.ok(Math.abs(movableQuote.box.y - fixedQuote.box.y) <= renderConfig.pdf.composition_geometry_tolerance, 'a score tie must preserve the preferred fixed quote position');
  return movableResult;
}

/**
 * @test-decision plan-assertion
 * @test-action Keep legal-plan invariants and cross-flow placement checks in the fast plan test; invalid evaluator mutation cases remain covered by engine contracts.
 */
function assertEditorialPlan(result, fixture, renderConfig) {
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.residualContent.length, 0, JSON.stringify(result.plan.residualContent));
  assert.deepEqual(result.evaluation.hardViolations, [], 'accepted editorial must expose no hard violations');
  assert.ok(Number.isFinite(result.evaluation.score), 'accepted editorial must expose a finite score');
  assert.ok(result.evaluation.scoreBreakdown.some((component) => component.code === 'column-balance'), 'editorial score must explain column balance');
  assert.ok(result.evaluation.scoreBreakdown.some((component) => component.code === 'heading-following-line'), 'editorial score must explain heading following text');
  const traceBeforeReevaluation = structuredClone(result.plan.trace);
  const firstReevaluation = result.evaluateCompositionPlan(result.document, result.plan);
  const secondReevaluation = result.evaluateCompositionPlan(result.document, result.plan);
  assert.deepEqual(secondReevaluation, firstReevaluation, 'evaluating the same plan twice must be deterministic');
  assert.deepEqual(result.plan.trace, traceBeforeReevaluation, 'evaluation must not mutate the plan trace');
  const incompleteTraceBlocks = (result.plan.trace?.blocks ?? []).filter((block) => block.status !== 'placed');
  assert.deepEqual(incompleteTraceBlocks, [], `every authored block must be present in the final plan: ${JSON.stringify(incompleteTraceBlocks)}`);
  const mainFlowPlacements = (result.plan.flowPlacements ?? []).filter((placement) => placement.flowId === 'main');
  assert.ok(mainFlowPlacements.length > 0, 'plan must register every main-flow placement, including empty capacity');
  const headerSlots = result.plan.slots.filter((slot) => slot.flowId === 'header');
  assert.ok(headerSlots.length > 0 && headerSlots.every((slot) => slot.fitContent === true), 'editorial header must remain a fit-content slot');
  assert.ok((result.plan.flowPlacements ?? []).some((placement) => placement.flowId === 'header' && placement.hasContent), 'editorial header flow must be planned with content');
  assert.ok(mainFlowPlacements.every((placement, index, placements) => index === 0
    || placement.page > placements[index - 1].page
    || placement.page === placements[index - 1].page && placement.routeIndex > placements[index - 1].routeIndex), 'flow placements must be registered in page and route order');
  const illegalEmptyPlacements = [];
  for (const flowId of new Set((result.plan.flowPlacements ?? []).map((placement) => placement.flowId))) {
    const placements = (result.plan.flowPlacements ?? []).filter((placement) => placement.flowId === flowId);
    const occupied = placements.flatMap((placement, index) => placement.hasContent ? [index] : []);
    if (occupied.length < 2) continue;
    for (const placement of placements.slice(occupied[0], occupied.at(-1) + 1)) {
      if (!placement.hasContent && placement.state !== 'exhausted' && placement.blockedBy.length === 0) illegalEmptyPlacements.push(placement.slotId);
    }
  }
  assert.deepEqual(illegalEmptyPlacements, [], `accepted plan must not contain an unblocked empty placement between content: ${JSON.stringify(illegalEmptyPlacements)}`);
  assertFlowPlacementRegistryMatchesPlan(result);
  assertFlowBarrierBoxCandidates(result);
  assertOrdinaryLinesRespectFlowBarrierBoxCandidates(result);
  assertNoInternalRouteGaps(result);
  assertNoEmptyContinuationColumn(result);
  assertQuoteFlowOwnership(result, fixture, renderConfig);
  assertPhysicalReadingOrder(result, fixture);
  assertExactNumberSet(numbers(numberedTokens(result.plan.lines.concat(result.plan.insertionLines ?? []).map((line) => line.text).join(' '), fixture.tokenPrefixes)), Array.from({ length: fixture.totalMainWords }, (_, index) => index + 1), 'planner must retain every numbered word exactly once');
  assert.ok(result.plan.decisions.some((decision) => decision.code === 'PLANNER_PASS_COMPLETED'), 'editorial fixture must record its obstacle-planning pass');
  const evaluationPhase = result.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  assert.ok(evaluationPhase?.details?.candidates?.length >= 1, 'editorial fixture must record evaluated planner candidates');
  const continuationRight = result.plan.slots.find((slot) => slot.id === '2:continuation:segment-2');
  const firstDriverLine = result.plan.lines.find((line) => line.page === 2 && line.blockId === 'body-drivers-1');
  assert.ok(continuationRight && firstDriverLine, 'fixture must create both continuation columns and place the drivers block on the continuation page');
  assert.ok(Number.isInteger(firstDriverLine.routeIndex) && firstDriverLine.slotId.includes(':segment-'), 'the drivers block must enter through the main flow route, not by a separate block placement');
  const dieselObstacle = result.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-diesel');
  const rightColumnBeforeDieselQuote = result.plan.lines.some((line) => line.page === 3
    && line.flowId === 'main'
    && line.routeIndex === 1
    && dieselObstacle
    && line.box.y + line.box.height <= dieselObstacle.box.y + renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm);
  assert.ok(rightColumnBeforeDieselQuote, 'the second column must use the available band above the diesel quote instead of inheriting the first column resumeY');
  const physicalLineOrder = new Map();
  for (const line of [...result.plan.lines, ...(result.plan.insertionLines ?? [])].filter((candidate) => candidate.flowId === 'main' || candidate.flowId === 'quotes')) {
    const group = physicalLineOrder.get(line.blockId) ?? [];
    group.push(line);
    physicalLineOrder.set(line.blockId, group);
  }
  for (const [blockId, lines] of physicalLineOrder) {
    const orderedLines = [...lines].sort((left, right) => left.page - right.page || (left.routeIndex ?? Number.MAX_SAFE_INTEGER) - (right.routeIndex ?? Number.MAX_SAFE_INTEGER) || left.box.y - right.box.y || left.box.x - right.box.x);
    let nextWord = 0;
    for (const line of orderedLines) {
      assert.equal(line.startWord, nextWord, `block ${blockId} must advance its words in physical column order`);
      nextWord = line.endWord;
    }
  }
}

await buildPlanningBundles();

try {
  const { planReportComposition, compositionStylesFromRenderConfig } = await import(bundles.adapter);
  const { evaluateCompositionPlan } = await import(bundles.backend);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-inset-two-column/template.yml'), 'utf8'));
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);
  const styles = editorialStyles(compositionStylesFromRenderConfig);
  const fixture = createEditorialNumberedFixture({
    quoteMarkGap: renderConfig.pdf.quote_mark_gap,
    quoteMarkOffsetX: renderConfig.pdf.quote_mark_offset_x,
    quoteMarkOffsetY: renderConfig.pdf.quote_mark_offset_y,
  });
  assert.ok(fixture.totalMainWords >= 1000, `fixture must contain at least 1000 main-flow words, got ${fixture.totalMainWords}`);
  assert.equal(fixture.sourceShape.filter((block) => block.role === 'quote').length, 4, 'fixture must retain all four authored quote insertions');
  const result = planReportComposition(newPdf('portrait', [geometry.width, geometry.height]), compiled, geometry, fixture.input, { family: 'DejaVu', maxPages: 12, styles });
  const planApi = { ...result, evaluateCompositionPlan };
  assertEditorialTemplateContract(result);
  assertEditorialPlan(planApi, fixture, renderConfig);

  const shortIntroResult = planReportComposition(newPdf('portrait', [geometry.width, geometry.height]), compiled, geometry, {
    flows: {
      intro: { continuation: 'forbidden', blocks: [{ id: 'intro', type: 'text', role: 'intro', text: 'A short intro.' }] },
      main: { continuation: 'allowed', blocks: [{ id: 'body', type: 'text', role: 'body', text: 'The main flow follows the intro.' }] },
    },
  }, { family: 'DejaVu', maxPages: 2, styles });
  assert.equal(shortIntroResult.evaluation.status, 'accepted', JSON.stringify(shortIntroResult.evaluation));
  const shortIntroSlot = shortIntroResult.plan.slots.find((slot) => slot.id === '1:intro');
  const shortIntroLine = shortIntroResult.plan.lines.find((line) => line.flowId === 'intro' && line.blockId === 'intro');
  assert.ok(shortIntroSlot && shortIntroLine, 'separate intro flow must place its text in the intro slot');
  assert.ok(shortIntroSlot.box.height < compiled.slots.intro.frame.height * geometry.height, 'fit-content intro must shrink below its declared frame height');
  assert.ok(Math.abs((shortIntroSlot.box.y + shortIntroSlot.box.height) - (shortIntroLine.box.y + shortIntroLine.box.height)) < 0.001, 'fit-content intro height must follow its final line box');

  const movableResult = assertMovableQuoteCandidateSearch(result, result, geometry, renderConfig, planReportComposition, newPdf, compiled, fixture, styles);
  assert.equal(movableResult.plan.lines.some((line) => line.flowId === 'quotes'), false, 'movable quote search must keep quote text outside ordinary flow');
  console.log(JSON.stringify({
    status: 'passed',
    mode: 'plan-only',
    pages: result.plan.pages.length,
    mainWords: fixture.totalMainWords,
    quotes: fixture.sourceShape.filter((block) => block.role === 'quote').length,
    lines: result.plan.lines.length,
    candidateCount: movableResult.plan.trace?.candidateSearch?.evaluatedCandidates ?? 0,
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
