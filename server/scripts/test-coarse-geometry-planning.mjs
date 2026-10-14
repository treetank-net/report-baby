#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-coarse-geometry-'));
const bundle = join(temporary, 'coarse-geometry.cjs');
const insertionBundle = join(temporary, 'insertion-planning.cjs');
const compositionBundle = join(temporary, 'composition.cjs');
const configBundle = join(temporary, 'render-config.cjs');
const spacingBundle = join(temporary, 'spacing-report.cjs');
const flowSpaceBundle = join(temporary, 'flow-space.cjs');
const textDecisionBundle = join(temporary, 'text-decision.cjs');
await build({ entryPoints: ['src/composition/layout/coarse-geometry-planning.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: bundle });
await build({ entryPoints: ['src/composition/layout/insertion-planning.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: insertionBundle });
await build({ entryPoints: ['src/composition/index.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: compositionBundle });
await build({ entryPoints: ['src/template/builtins.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: configBundle });
await build({ entryPoints: ['src/composition/observability/spacing-report.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: spacingBundle });
await build({ entryPoints: ['src/composition/layout/flow-space.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: flowSpaceBundle });
await build({ entryPoints: ['src/composition/layout/flow-text-decision.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: textDecisionBundle });

try {
  const { assignCoarseInsertionProposals, planCoarseInsertionAssignments, compareCoarseEstimateToExactPlan, estimateCoarseMainGeometry, projectCoarseInsertionDisplacement, unassignedCoarseInsertionItems } = await import(bundle);
  const { seedInsertionProposals } = await import(insertionBundle);
  const { createTextCompositionEngine, createTextCompositionPlanner, evaluateCompositionPlan } = await import(compositionBundle);
  const { readRenderConfig } = await import(configBundle);
  const { attachPlanSpacingReport } = await import(spacingBundle);
  const { calculateAtomicBlockTop } = await import(flowSpaceBundle);
  const { selectTextLinesForPlacement } = await import(textDecisionBundle);
  const atomicSlot = { id: 'body', box: { x: 10, y: 10, width: 80, height: 100 } };
  const atomicObstacles = [{ page: 1, graphicId: 'insertion:quote', wrap: 'around', box: { x: 10, y: 45, width: 80, height: 20 } }];
  assert.equal(calculateAtomicBlockTop(1, atomicSlot, 'image', 40, 30, atomicObstacles), 65, 'an atomic image must move below the overlapping quote');
  assert.equal(calculateAtomicBlockTop(1, atomicSlot, 'image', 10, 30, atomicObstacles), 10, 'an atomic image that fits before the quote must retain the earlier band');
  assert.equal(calculateAtomicBlockTop(1, atomicSlot, 'image', 40, 30, [{ ...atomicObstacles[0], box: { x: 95, y: 45, width: 5, height: 20 } }]), 40, 'horizontally disjoint obstacles must not move the atomic image');
  assert.deepEqual(selectTextLinesForPlacement({ policy: { minimumLinesAtEnd: 2 } }, { wrapped: [{}], completeWrapped: [{}, {}] }, 1), [], 'a keep rule may leave no selected line; the caller must advance without committing an empty fragment');
  assert.deepEqual(selectTextLinesForPlacement({ policy: { minimumLinesAtEnd: 4 } }, { wrapped: [{}, {}], completeWrapped: [{}, {}, {}] }, 2), [], 'a negative take count must not invoke slice with a negative index');
  assert.equal(readRenderConfig().compositionSearch.coarseGeometryFirst, true, 'coarse-first production planning must be explicitly enabled in shared render configuration');
  const metrics = {
    units: 'mm',
    measureText(text) { return text.length * 2; },
    lineHeight() { return 10; },
    textPadding() { return { top: 2, bottom: 2 }; },
    textMargins() { return { before: 1, after: 1 }; },
  };
  const pageTemplate = {
    id: 'coarse-test', width: 100, height: 120,
    slots: [{ id: 'main', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } }],
  };
  const layout = (maxPages) => ({ pageTemplates: [pageTemplate], routes: { main: { slots: ['main'], continuation: 'allowed' } }, maxPages });
  const globalAssignmentLayout = {
    pageTemplates: [{ ...pageTemplate, slots: [pageTemplate.slots[0],
      { id: 'early', regionId: 'body', kind: 'text', allowedBlockIds: ['flexible'], box: { x: 10, y: 10, width: 80, height: 14 },
        placement: { mode: 'fluid-y', region: 'body', distribution: 'spread-through-content', rhythmGroup: 'global' } },
      { id: 'preferred', regionId: 'body', kind: 'text', allowedBlockIds: ['flexible', 'restricted'], box: { x: 10, y: 25, width: 80, height: 14 },
        placement: { mode: 'fluid-y', region: 'body', distribution: 'spread-through-content', rhythmGroup: 'global' } },
    ] }],
    routes: { main: { slots: ['main'], continuation: 'allowed' }, quotes: { slots: ['early', 'preferred'], insertionSlots: ['early', 'preferred'], continuation: 'forbidden' } },
    maxPages: 1,
  };
  const globalAssignmentDocument = { flows: {
    main: { blocks: [{ id: 'global-body', kind: 'paragraph', role: 'body', text: Array(180).fill('w').join(' ') }] },
    quotes: { blocks: ['flexible', 'restricted'].map((id) => ({ id, kind: 'paragraph', role: 'quote', text: 'A quote.' })) },
  } };
  const globalAssignmentEstimate = estimateCoarseMainGeometry(globalAssignmentDocument, metrics, globalAssignmentLayout);
  const globalAssignment = planCoarseInsertionAssignments(globalAssignmentDocument, metrics, globalAssignmentLayout, globalAssignmentEstimate, new Map());
  assert.deepEqual([...globalAssignment.proposals].map(([key, value]) => [key, value.slotId]), [['quotes:flexible', 'early'], ['quotes:restricted', 'preferred']],
    'whole-document selection must give the restricted later insertion its only slot instead of taking it greedily for the first insertion');
  assert.equal(globalAssignment.search.assignedRequiredCount, 2, 'coverage must outrank local attraction when a complete legal assignment exists');
  assert.equal(globalAssignment.search.exhaustive, true, 'the small capacity counterexample must compare every configuration without beam pruning');
  assert.ok(globalAssignment.search.completeLayoutsCompared > 1, 'selection must compare complete alternatives, including the locally attractive blocked configuration');
  assert.deepEqual(planCoarseInsertionAssignments(globalAssignmentDocument, metrics, globalAssignmentLayout, globalAssignmentEstimate, new Map()), globalAssignment,
    'bounded whole-document selection and its evidence must be deterministic');

  const positionLayout = structuredClone(globalAssignmentLayout);
  positionLayout.pageTemplates[0].slots = [pageTemplate.slots[0], ...['top', 'center', 'bottom'].map((id, index) => ({
    id, regionId: 'body', kind: 'text', box: { x: 10, y: [10, 50, 90][index], width: 80, height: 10 },
    placement: { mode: 'fluid-y', region: 'body', distribution: 'spread-through-content', rhythmGroup: 'position' },
  }))];
  positionLayout.routes.quotes = { slots: ['top', 'center', 'bottom'], insertionSlots: ['top', 'center', 'bottom'], continuation: 'forbidden' };
  const positionDocument = { flows: { main: globalAssignmentDocument.flows.main,
    quotes: { blocks: [{ id: 'single', kind: 'paragraph', role: 'quote', text: 'A quote.' }] } } };
  const positionEstimate = estimateCoarseMainGeometry(positionDocument, metrics, positionLayout);
  const positionAssignment = planCoarseInsertionAssignments(positionDocument, metrics, positionLayout, positionEstimate, new Map());
  assert.equal(positionAssignment.proposals.get('quotes:single').slotId, 'center',
    'slots on the same page must have distinct document progress so a single insertion gravitates toward the body center');
  assert.ok(positionAssignment.search.targets[0].actualProgress > positionEstimate.mainProgressByPage.get(1).start,
    'the selected target must report measured intra-page progress');
  assert.ok(positionAssignment.search.expandedStates >= 3, 'all eligible positions must be considered without materializing exact plans');
  assert.equal(positionAssignment.search.projectedLayoutsCompared, 3, 'each retained complete alternative must receive a cut/push comparison');
  assert.equal(positionAssignment.search.projectedAlternatives.filter(({ selected }) => selected).length, 1, 'the projection trace must identify exactly one selected assignment');

  const breakLayout = structuredClone(positionLayout);
  breakLayout.pageTemplates[0].slots = [pageTemplate.slots[0], ...[['risky', 45], ['safe', 50]].map(([id, y]) => ({
    id, regionId: 'body', kind: 'text', box: { x: 10, y, width: 80, height: 14 },
    placement: { mode: 'fluid-y', region: 'body', distribution: 'spread-through-content' },
  }))];
  breakLayout.routes.quotes = { slots: ['risky', 'safe'], insertionSlots: ['risky', 'safe'], continuation: 'forbidden' };
  const breakDocument = { flows: {
    main: { blocks: ['first', 'second'].map((id) => ({ id, kind: 'paragraph', role: 'body', text: Array(80).fill('w').join(' ') })) },
    quotes: positionDocument.flows.quotes,
  } };
  const breakEstimate = estimateCoarseMainGeometry(breakDocument, metrics, breakLayout);
  assert.equal(breakEstimate.blockMeasurements[0].unbrokenHeight, 40, 'intrinsic height must be recorded before region cuts');
  assert.ok(breakEstimate.breakSensitiveRegions.some(({ blockId, rule }) => blockId === 'first' && rule === 'paragraph-edge-lines'));
  const breakAssignment = planCoarseInsertionAssignments(breakDocument, metrics, breakLayout, breakEstimate, new Map());
  assert.equal(breakAssignment.proposals.get('quotes:single').slotId, 'safe', 'post-push comparison must avoid an insertion that creates a one-line paragraph tail');
  const riskyProjection = breakAssignment.search.projectedAlternatives.find(({ assignments }) => assignments[0].slotId === 'risky');
  assert.ok(riskyProjection.assessment.sensitiveCuts.some(({ blockId, rule }) => blockId === 'first' && rule === 'paragraph-edge-lines'), 'the losing configuration must identify the affected block and sensitive cut');
  assert.ok(riskyProjection.assessment.estimatedBreakPenalty > breakAssignment.search.projectionAssessment.estimatedBreakPenalty);
  assert.equal(breakAssignment.projected.unplacedWordCount, 0, 'avoiding the cut must preserve all authored content');

  const crossFlowLayout = structuredClone(globalAssignmentLayout);
  crossFlowLayout.routes.first = { ...crossFlowLayout.routes.quotes };
  crossFlowLayout.routes.second = { slots: ['preferred'], insertionSlots: ['preferred'], continuation: 'forbidden' };
  delete crossFlowLayout.routes.quotes;
  const crossFlowDocument = { flows: { main: globalAssignmentDocument.flows.main,
    first: { blocks: [globalAssignmentDocument.flows.quotes.blocks[0]] },
    second: { blocks: [globalAssignmentDocument.flows.quotes.blocks[1]] } } };
  const crossFlowEstimate = estimateCoarseMainGeometry(crossFlowDocument, metrics, crossFlowLayout);
  const crossFlowAssignment = planCoarseInsertionAssignments(crossFlowDocument, metrics, crossFlowLayout, crossFlowEstimate, new Map());
  assert.equal(crossFlowAssignment.proposals.get('first:flexible').slotId, 'early', 'whole-document capacity choices must include later flows');
  assert.equal(crossFlowAssignment.proposals.get('second:restricted').slotId, 'preferred', 'an earlier flow must preserve the only compatible slot of a later flow');

  const repulsionLayout = structuredClone(positionLayout);
  repulsionLayout.pageTemplates[0].slots = [pageTemplate.slots[0], ...[
    ['first-center', 50, 'first'], ['second-overlap', 51, 'second'], ['second-clear', 75, 'second'],
  ].map(([id, y, flowId]) => ({ id, regionId: 'body', flowId, kind: 'text', box: { x: 10, y, width: 80, height: 10 },
    placement: { mode: 'fluid-y', region: 'body', distribution: 'spread-through-content', rhythmGroup: flowId } }))];
  repulsionLayout.routes.first = { slots: ['first-center'], insertionSlots: ['first-center'], continuation: 'forbidden' };
  repulsionLayout.routes.second = { slots: ['second-overlap', 'second-clear'], insertionSlots: ['second-overlap', 'second-clear'], continuation: 'forbidden' };
  delete repulsionLayout.routes.quotes;
  const repulsionDocument = { flows: { main: globalAssignmentDocument.flows.main,
    first: { blocks: [{ id: 'first', kind: 'paragraph', role: 'quote', text: 'First.' }] },
    second: { blocks: [{ id: 'second', kind: 'paragraph', role: 'quote', text: 'Second.' }] } } };
  const repulsionEstimate = estimateCoarseMainGeometry(repulsionDocument, metrics, repulsionLayout);
  const repulsionAssignment = planCoarseInsertionAssignments(repulsionDocument, metrics, repulsionLayout, repulsionEstimate, new Map());
  assert.equal(repulsionAssignment.proposals.get('second:second').slotId, 'second-clear',
    'complete geometry comparison must repel overlapping insertions even when each separate group is attracted to the same center');
  assert.equal(repulsionAssignment.search.spacingDeficit, 0, 'selected geometry must expose its measured clearance result');

  const spacingMetrics = { ...metrics, blockGap(previous, next) { return previous === 'body' && next === 'body' ? 3 : 0; } };
  const spacingDocument = { flows: { main: { blocks: [
    { id: 'spacing-first', kind: 'paragraph', role: 'body', text: 'first' },
    { id: 'spacing-second', kind: 'paragraph', role: 'body', text: 'second' },
  ] } } };
  const spacingEstimate = estimateCoarseMainGeometry(spacingDocument, spacingMetrics, layout(1));
  assert.equal(spacingEstimate.contentMass[1].box.y - (spacingEstimate.contentMass[0].box.y + spacingEstimate.contentMass[0].box.height), 3, 'the coarse body estimate must preserve measured spacing between adjacent blocks in one region');
  const spacingProjection = projectCoarseInsertionDisplacement(spacingEstimate, layout(1), new Map());
  assert.equal(spacingProjection.contentMass[1].box.y - (spacingProjection.contentMass[0].box.y + spacingProjection.contentMass[0].box.height), 3, 'the obstacle projection must preserve measured spacing between adjacent blocks');
  const spacingAcrossObstacle = projectCoarseInsertionDisplacement(spacingEstimate, layout(1), new Map([
    ['quotes:gap-obstacle', { page: 1, slotId: 'main', box: { x: 10, y: 22, width: 80, height: 10 } }],
  ]));
  assert.ok(spacingAcrossObstacle.contentMass[1].box.y >= 32, 'the next block must resume after the insertion box');
  assert.equal(spacingAcrossObstacle.contentMass[1].box.y, 32, 'soft spacing halos must not be treated as hard text-flow cuts');
  const keepHeadingLayout = layout(1);
  keepHeadingLayout.headingKeepWithNextLines = 1;
  const keepHeadingDocument = { flows: { main: { blocks: [
    { id: 'keep-heading', kind: 'heading', role: 'heading', text: 'Heading' },
    { id: 'keep-body', kind: 'paragraph', role: 'body', text: 'Following line' },
  ] } } };
  const keepHeadingEstimate = estimateCoarseMainGeometry(keepHeadingDocument, spacingMetrics, keepHeadingLayout);
  const keepHeadingProjection = projectCoarseInsertionDisplacement(keepHeadingEstimate, keepHeadingLayout, new Map([
    ['quotes:keep-obstacle', { page: 1, slotId: 'main', box: { x: 10, y: 25, width: 80, height: 10 } }],
  ]));
  assert.ok(keepHeadingProjection.contentMass[0].box.y >= 35, 'a heading must move past an insertion when the heading and required following line cannot both fit before it');
  assert.ok(keepHeadingProjection.contentMass[1].box.y >= keepHeadingProjection.contentMass[0].box.y + 10, 'the required following line must remain after the moved heading');
  const longText = Array.from({ length: 150 }, (_, index) => `w${index}`).join(' ');
  const twoPageEstimate = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] } } },
    metrics,
    layout(5),
  );
  assert.equal(twoPageEstimate.terminalPage, 2, '150 short words at the configured fixture dimensions should occupy two coarse pages');
  assert.deepEqual([...new Set(twoPageEstimate.contentMass.map((mass) => mass.page))], [1, 2]);
  assert.equal(twoPageEstimate.mainProgressByPage.get(5).start, 1, 'eligible but body-empty pages must remain visible at terminal progress');
  assert.equal(twoPageEstimate.unplacedWordCount, 0);
  assert.ok(twoPageEstimate.contentMass.every((mass) => mass.uncertainty === 'text-width-estimate'));

  const orphanControlDocument = {
    flows: { main: { blocks: [{ id: 'orphan-control', kind: 'paragraph', role: 'body', text: Array.from({ length: 88 }, () => 'word').join(' ') }] } },
  };
  const orphanControlEstimate = estimateCoarseMainGeometry(orphanControlDocument, metrics, layout(5));
  const orphanControlUnconstrained = estimateCoarseMainGeometry(orphanControlDocument, metrics, layout(5), 0);
  const orphanControlPages = orphanControlEstimate.contentMass.reduce((counts, mass) => {
    counts.set(mass.page, (counts.get(mass.page) ?? 0) + (mass.lineWordCounts?.length ?? 0));
    return counts;
  }, new Map());
  const totalOrphanControlLines = orphanControlUnconstrained.contentMass.reduce((sum, mass) => sum + (mass.lineWordCounts?.length ?? 0), 0);
  const orphanControlCapacity = Math.floor(pageTemplate.slots[0].box.height / metrics.lineHeight());
  const configuredMinimumLinesAtEnd = readRenderConfig().pdf.orphanMinLines;
  let expectedFirstPageLines = Math.min(totalOrphanControlLines, orphanControlCapacity);
  const expectedRemainderLines = totalOrphanControlLines - expectedFirstPageLines;
  if (expectedRemainderLines > 0 && expectedRemainderLines < configuredMinimumLinesAtEnd) {
    expectedFirstPageLines = Math.max(0, expectedFirstPageLines - (configuredMinimumLinesAtEnd - expectedRemainderLines));
  }
  assert.deepEqual([...orphanControlPages], [[1, expectedFirstPageLines], [2, totalOrphanControlLines - expectedFirstPageLines]], 'the configured minimum continuation lines must shift lines before creating an undersized tail');

  const orphanColumnsLayout = layout(1);
  orphanColumnsLayout.pageTemplates[0] = {
    id: 'coarse-orphan-columns', width: 100, height: 120,
    slots: [
      { id: 'left', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
      { id: 'right', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
    ],
  };
  orphanColumnsLayout.routes.main = { slots: ['left', 'right'], continuation: 'allowed' };
  const orphanColumnsDocument = {
    flows: { main: { blocks: [{ id: 'orphan-columns', kind: 'paragraph', role: 'body', text: Array.from({ length: 88 }, () => 'word').join(' ') }] } },
  };
  const orphanColumnsEstimate = estimateCoarseMainGeometry(orphanColumnsDocument, metrics, orphanColumnsLayout);
  const orphanColumnsProjection = projectCoarseInsertionDisplacement(orphanColumnsEstimate, orphanColumnsLayout, new Map());
  const estimatedColumnLineCounts = ['left', 'right'].map((slotId) => orphanColumnsEstimate.contentMass
    .filter((mass) => mass.slotId === slotId)
    .reduce((sum, mass) => sum + (mass.lineWordCounts?.length ?? 0), 0));
  const projectedColumnLineCounts = ['left', 'right'].map((slotId) => orphanColumnsProjection.contentMass
    .filter((mass) => mass.slotId === slotId)
    .reduce((sum, mass) => sum + (mass.lineWordCounts?.length ?? 0), 0));
  assert.deepEqual(estimatedColumnLineCounts, [9, 2], 'coarse measurement must protect the two-line continuation across same-page columns');
  assert.deepEqual(projectedColumnLineCounts, estimatedColumnLineCounts, 'projection must not pull a protected continuation line back into spare space in the preceding column');

  const exactComparison = compareCoarseEstimateToExactPlan(
    { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] } } },
    twoPageEstimate,
    { lines: [
      { blockId: 'body', flowId: 'main', page: 1, startWord: 0, endWord: 100, box: { x: 0, y: 0, width: 80, height: 10 }, slotId: 'main' },
      { blockId: 'body', flowId: 'main', page: 2, startWord: 100, endWord: 150, box: { x: 0, y: 0, width: 80, height: 10 }, slotId: 'main' },
    ] },
  );
  assert.equal(exactComparison.exactMainTerminalPage, 2, 'exact calibration must identify the terminal page from main-flow lines');
  assert.equal(exactComparison.exactTextWordCount, 150, 'exact calibration must count the words represented by planned main-flow lines');
  assert.ok(exactComparison.pages.every((page) => Number.isFinite(page.estimatedMassUnits) && Number.isFinite(page.exactTextWords)), 'each page comparison must expose estimated mass and exact text words');
  assert.ok(exactComparison.pages.flatMap((page) => page.blocks ?? []).every((block) =>
    block.estimatedBySlot.every((slot) => Number.isFinite(slot.leftX) && Number.isFinite(slot.rightX) && slot.rightX >= slot.leftX && Number.isFinite(slot.occupiedHeight) && slot.occupiedHeight >= 0 && Number.isFinite(slot.unoccupiedEnvelopeHeight) && slot.unoccupiedEnvelopeHeight >= 0)
      && block.exactBySlot.every((slot) => Number.isFinite(slot.leftX) && Number.isFinite(slot.rightX) && slot.rightX >= slot.leftX && Number.isFinite(slot.occupiedHeight) && slot.occupiedHeight >= 0 && Number.isFinite(slot.unoccupiedEnvelopeHeight) && slot.unoccupiedEnvelopeHeight >= 0)), 'coarse and exact block maps must expose horizontal extents, occupied height and envelope slack per slot');
  const inlineText = Array.from({ length: 120 }, () => 'a').join(' ');
  const inlineDocument = { flows: { main: { blocks: [{ id: 'inline-body', kind: 'paragraph', role: 'body', text: inlineText, inlineRuns: [{ text: inlineText, marks: ['strong'] }] }] } } };
  const inlineMetrics = { ...metrics, measureText(text, _style, run) { return text.length * (run?.marks.includes('strong') ? 4 : 2); } };
  const inlineEstimate = estimateCoarseMainGeometry(inlineDocument, inlineMetrics, layout(5));
  const inlineExact = createTextCompositionEngine(layout(5), { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(inlineDocument, inlineMetrics);
  const inlineComparison = compareCoarseEstimateToExactPlan(inlineDocument, inlineEstimate, inlineExact.plan);
  assert.equal(inlineExact.evaluation.status, 'accepted', 'the inline measurement mismatch must still produce an exact legal plan');
  assert.equal(inlineEstimate.terminalPage, 2, 'the aggregate estimate must account for inline-run widths before exact materialization');
  assert.equal(inlineComparison.exactMainTerminalPage, 2, 'exact planning must lay out inline widths across the same two pages as the coarse estimate');
  assert.equal(inlineComparison.estimatedTerminalPage, inlineComparison.exactMainTerminalPage, 'coarse and exact inline-run measurements must agree on terminal-page prediction');
  assert.equal(inlineComparison.pages.reduce((sum, page) => sum + Math.abs(page.estimatedMassUnits - page.exactTextWords), 0), 0, 'coarse mass must use inline-aware line word counts when projecting across pages');
  assert.ok(inlineComparison.pages.flatMap((page) => page.blocks ?? []).filter(({ estimatedMassUnits }) => estimatedMassUnits > 0).every(({ estimatedLineCount, exactLineCount }) => Number.isInteger(estimatedLineCount) && estimatedLineCount === exactLineCount), 'inline block diagnostics must show the same coarse and exact line count by page');
  const inlineCoarseDecision = inlineExact.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
  assert.equal(inlineCoarseDecision?.baselineExactComparison.estimatedTerminalPage, 2, 'the normal plan trace must retain the inline-aware estimated terminal page');
  assert.equal(inlineCoarseDecision?.baselineExactComparison.exactMainTerminalPage, 2, 'the normal plan trace must retain the exact terminal page beside the inline-aware estimate');
  const textPredictionCorpus = [
    { id: 'paragraph-only', width: 80, blocks: [{ id: 'paragraph', kind: 'paragraph', role: 'body', text: Array.from({ length: 150 }, (_, index) => `p${index}`).join(' ') }] },
    { id: 'heading-paragraph-list', width: 80, blocks: [
      { id: 'heading', kind: 'heading', role: 'heading', text: 'A measured section heading' },
      { id: 'lead', kind: 'paragraph', role: 'body', text: Array.from({ length: 45 }, (_, index) => `lead${index}`).join(' ') },
      ...[0, 1, 2].map((item) => ({ id: `item-${item}`, kind: 'list-item', role: 'body', text: Array.from({ length: 28 }, (_, index) => `i${item}w${index}`).join(' ') })),
    ] },
    { id: 'many-short-paragraphs', width: 80, blocks: Array.from({ length: 12 }, (_, paragraph) => ({ id: `paragraph-${paragraph}`, kind: 'paragraph', role: 'body', text: Array.from({ length: 14 }, (_, index) => `p${paragraph}w${index}`).join(' ') })) },
    { id: 'narrow-paragraph-list', width: 42, blocks: [
      { id: 'narrow-paragraph', kind: 'paragraph', role: 'body', text: Array.from({ length: 90 }, (_, index) => `n${index}`).join(' ') },
      { id: 'narrow-item', kind: 'list-item', role: 'body', text: Array.from({ length: 30 }, (_, index) => `l${index}`).join(' ') },
    ] },
  ];
  const textPredictionCalibration = textPredictionCorpus.map((entry) => {
    const predictionLayout = structuredClone(layout(5));
    predictionLayout.pageTemplates[0].slots[0].box.width = entry.width;
    const predictionDocument = { flows: { main: { blocks: entry.blocks } } };
    const prediction = estimateCoarseMainGeometry(predictionDocument, metrics, predictionLayout);
    const exact = createTextCompositionEngine(predictionLayout, { maxPlanningIterations: 3, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(predictionDocument, metrics);
    assert.equal(exact.evaluation.status, 'accepted', `text-kind calibration fixture ${entry.id} must produce an exact legal plan`);
    const comparison = compareCoarseEstimateToExactPlan(predictionDocument, prediction, exact.plan);
    assert.equal(comparison.exactTextWordCount, entry.blocks.reduce((sum, block) => sum + block.text.split(/\s+/u).length, 0), `text-kind calibration fixture ${entry.id} must account for every source word exactly once`);
    const pageMassError = comparison.pages.reduce((sum, page) => sum + Math.abs(page.estimatedMassUnits - page.exactTextWords), 0);
    assert.equal(pageMassError, 0, `text-kind calibration fixture ${entry.id} must project exact measured words to each page`);
    assert.ok(comparison.pages.flatMap((page) => page.blocks ?? []).filter(({ estimatedMassUnits }) => estimatedMassUnits > 0).every(({ estimatedLineCount, exactLineCount }) => Number.isInteger(estimatedLineCount) && estimatedLineCount === exactLineCount), `text-kind calibration fixture ${entry.id} must project exact measured line counts by page and block`);
    return {
      id: entry.id,
      blockKinds: [...new Set(entry.blocks.map(({ kind }) => kind))],
      estimatedTerminalPage: comparison.estimatedTerminalPage,
      exactTerminalPage: comparison.exactMainTerminalPage,
      terminalPageError: Math.abs((comparison.estimatedTerminalPage ?? 0) - (comparison.exactMainTerminalPage ?? 0)),
      totalEstimatedMass: comparison.pages.reduce((sum, page) => sum + page.estimatedMassUnits, 0),
      exactTextWords: comparison.exactTextWordCount,
      absolutePerPageMassError: pageMassError,
      exactLineCountsByPage: [...new Set(exact.plan.lines.filter(({ flowId }) => flowId === 'main').map(({ page }) => page))]
        .sort((left, right) => left - right)
        .map((page) => ({ page, lines: exact.plan.lines.filter((line) => line.flowId === 'main' && line.page === page).length })),
      pages: comparison.pages.map(({ page, estimatedMassUnits, exactTextWords, blocks }) => ({ page, estimatedMassUnits, exactTextWords, blocks })),
    };
  });
  assert.ok(textPredictionCalibration.some(({ blockKinds }) => blockKinds.includes('heading')), 'the calibration corpus must include headings');
  assert.ok(textPredictionCalibration.some(({ blockKinds }) => blockKinds.includes('list-item')), 'the calibration corpus must include list items');
  const manyShortParagraphs = textPredictionCalibration.find(({ id }) => id === 'many-short-paragraphs');
  assert.equal(manyShortParagraphs?.terminalPageError, 0, 'short paragraphs with exact style metrics must predict the exact terminal page');
  assert.equal(manyShortParagraphs?.absolutePerPageMassError, 0, 'short paragraphs with exact style metrics must preserve exact page mass');
  const introLayout = layout(5);
  introLayout.pageTemplates[0] = { ...pageTemplate, firstPageContentTop: 35, firstPageContentSlotIds: ['main'] };
  const introEstimate = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: Array.from({ length: 180 }, (_, index) => `w${index}`).join(' ') }] } } },
    metrics,
    introLayout,
  );
  assert.equal(introEstimate.terminalPage, 3, 'the reserved intro area should preserve the body spillover as a sparse third-page fragment');
  assert.ok(introEstimate.mainProgressByPage.get(1).capacityHeight < introEstimate.mainProgressByPage.get(2).capacityHeight, 'the intro page must expose less main capacity than a full body page');
  assert.equal(introEstimate.mainProgressByPage.get(2).occupiedHeight, introEstimate.mainProgressByPage.get(2).capacityHeight, 'the full body page should absorb all content that fits before terminal spillover');
  assert.ok(introEstimate.mainProgressByPage.get(3).occupiedHeight < introEstimate.mainProgressByPage.get(3).capacityHeight, `the terminal page should retain its sparse body fragment instead of being treated as equally loaded: ${JSON.stringify(introEstimate.mainProgressByPage.get(3))}`);
  const dynamicIntroLayout = layout(5);
  dynamicIntroLayout.pageTemplates[0] = {
    ...pageTemplate,
    slots: [
      ...pageTemplate.slots,
      { id: 'intro', regionId: 'intro', flowId: 'intro', kind: 'text', box: { x: 10, y: 10, width: 80, height: 0 }, allowedRoles: ['intro'], fitContent: true, grow: { axis: 'y', maxHeight: 40, pushes: ['main'] } },
    ],
  };
  dynamicIntroLayout.routes.intro = { slots: ['intro'], continuation: 'forbidden', priority: 450 };
  const dynamicIntroEstimate = estimateCoarseMainGeometry(
    {
      flows: {
        intro: { blocks: [{ id: 'dynamic-intro', kind: 'paragraph', role: 'intro', text: longText }] },
        main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] },
      },
    },
    metrics,
    dynamicIntroLayout,
  );
  assert.equal(dynamicIntroEstimate.regions.find((region) => region.page === 1 && region.slotId === 'main').box.y, 50, 'a measured growing intro must push the first-page main rectangle by its estimated capped height');
  assert.equal(dynamicIntroEstimate.dynamicReservations[0].displacement, 40, 'the intro reservation must expose the actual capped displacement');
  const unknownDynamicIntroEstimate = estimateCoarseMainGeometry(
    {
      flows: {
        intro: { blocks: [{ id: 'unknown-intro-image', kind: 'image', role: 'intro', atomic: true }] },
        main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] },
      },
    },
    metrics,
    dynamicIntroLayout,
  );
  assert.equal(unknownDynamicIntroEstimate.dynamicReservations.length, 0, 'unknown intro image geometry must not be replaced by a guessed zero-height reservation');
  assert.ok(unknownDynamicIntroEstimate.missingMeasurements.some((measurement) => measurement.blockId === 'unknown-intro-image' && measurement.slotId === 'intro'), 'unknown dynamic intro geometry must remain explicit');
  const headingKeepLayout = layout(1);
  headingKeepLayout.headingKeepWithNextLines = 1;
  headingKeepLayout.pageTemplates[0] = {
    id: 'heading-keep', width: 100, height: 120,
    slots: [
      { id: 'short', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 10 } },
      { id: 'following', regionId: 'body', kind: 'text', box: { x: 10, y: 35, width: 80, height: 60 } },
    ],
  };
  headingKeepLayout.routes.main = { slots: ['short', 'following'], continuation: 'allowed' };
  const headingKeepEstimate = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [
      { id: 'heading', kind: 'heading', role: 'heading', text: 'Section heading' },
      { id: 'lead-paragraph', kind: 'paragraph', role: 'body', text: 'The following line stays with the heading.' },
    ] } } },
    metrics,
    headingKeepLayout,
  );
  assert.equal(headingKeepEstimate.contentMass[0].blockId, 'heading', 'heading keep fixture must begin with its heading');
  assert.equal(headingKeepEstimate.contentMass[0].slotId, 'following', 'coarse planning must keep a heading with its configured following line when the first region is too short');
  assert.ok(headingKeepEstimate.breakSensitiveRegions.some(({ rule, severity, box }) => rule === 'heading-following-lines' && severity === 'hard' && box.height === 20), 'a protected heading band must include its required following height');
  const blockKeepColumnsLayout = layout(1);
  blockKeepColumnsLayout.pageTemplates[0] = {
    id: 'coarse-block-keep-columns', width: 100, height: 120,
    slots: [
      { id: 'left', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 25 } },
      { id: 'right', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
    ],
  };
  blockKeepColumnsLayout.routes.main = { slots: ['left', 'right'], continuation: 'allowed' };
  blockKeepColumnsLayout.headingKeepWithNextLines = 0;
  const blockKeepColumnsEstimate = estimateCoarseMainGeometry({
    flows: { main: { blocks: [
      { id: 'column-lead', kind: 'paragraph', role: 'body', text: 'Lead' },
      { id: 'local-keep-heading', kind: 'heading', role: 'heading', keepWithNextLines: 3, text: 'Heading' },
      { id: 'local-keep-body', kind: 'paragraph', role: 'body', text: Array.from({ length: 24 }, () => 'word').join(' ') },
    ] } },
  }, metrics, blockKeepColumnsLayout);
  assert.equal(blockKeepColumnsEstimate.contentMass.find((mass) => mass.blockId === 'local-keep-heading')?.slotId, 'right', 'block-level keepWithNextLines must move a heading and its required continuation together when the template default is zero');
  const coarseTableLayout = layout(2);
  coarseTableLayout.pageTemplates[0] = {
    id: 'coarse-table-reflow', width: 100, height: 120,
    slots: [{ id: 'main', regionId: 'body', kind: 'text', allowedBlockKinds: ['paragraph', 'table'], box: { x: 10, y: 10, width: 80, height: 100 } }],
  };
  const coarseTableDocument = { flows: { main: { blocks: [
    { id: 'table-lead', kind: 'paragraph', role: 'body', text: Array.from({ length: 40 }, () => 'word').join(' ') },
    { id: 'measured-table', kind: 'table', role: 'table', table: { head: ['Column'], body: [['Row one'], ['Row two']] } },
  ] } } };
  const coarseTableMetrics = { ...metrics, measureTable(block, _box, startRow) { return { height: 60, endRow: block.table.body.length > startRow ? block.table.body.length : startRow }; } };
  const coarseTableEstimate = estimateCoarseMainGeometry(coarseTableDocument, coarseTableMetrics, coarseTableLayout);
  assert.equal(coarseTableEstimate.terminalPage, 1, 'row-count height estimation must keep the lead and two-row table in the first coarse page');
  const exactTableResult = createTextCompositionEngine(coarseTableLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(coarseTableDocument, coarseTableMetrics);
  assert.equal(exactTableResult.evaluation.status, 'accepted', `exact table displacement must remain legal: ${JSON.stringify(exactTableResult.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })))}`);
  const exactTablePlacement = exactTableResult.plan.tablePlacements.find(({ blockId }) => blockId === 'measured-table');
  assert.equal(exactTablePlacement?.page, 2, `renderer-neutral exact table measurement must push an oversized table to the next body page: ${JSON.stringify({ evaluation: exactTableResult.evaluation.status, diagnostics: exactTableResult.plan.diagnostics.map(({ code, message, blockId, page, slotId, details }) => ({ code, message, blockId, page, slotId, details })), decisions: exactTableResult.plan.decisions.map(({ code, blockId, page, slotId }) => ({ code, blockId, page, slotId })), pages: exactTableResult.plan.pages.map(({ page }) => page), tablePlacements: exactTableResult.plan.tablePlacements })}`);
  const exactTableComparison = compareCoarseEstimateToExactPlan(coarseTableDocument, coarseTableEstimate, exactTableResult.plan);
  assert.equal(exactTableComparison.estimatedTerminalPage, 1);
  assert.equal(exactTableComparison.exactMainTerminalPage, 2, 'coarse/exact calibration must include a terminal main page containing a structured placement without text lines');
  const missingAtomicMeasurement = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [{ id: 'unmeasured-image', kind: 'image', role: 'body' }] } } },
    metrics,
    layout(1),
  );
  assert.equal(missingAtomicMeasurement.contentMass.length, 0, 'missing atomic measurements must not create fabricated geometry');
  assert.deepEqual(missingAtomicMeasurement.missingMeasurements, [{ blockId: 'unmeasured-image', page: 1, slotId: 'main', reason: 'atomic-block-height-metric-unavailable' }]);
  const insertionProjected = projectCoarseInsertionDisplacement(twoPageEstimate, layout(5), new Map([
    ['quotes:quote-1', { page: 1, slotId: 'main', box: { x: 10, y: 30, width: 40, height: 20 } }],
  ]));
  assert.ok(insertionProjected.displacedWordCount > 0, 'an insertion must displace aggregate main-flow mass');
  assert.ok(insertionProjected.contentMass.every((mass) => mass.page !== 1 || mass.box.y + mass.box.height <= 30 || mass.box.y >= 50), 'projected main rectangles must not overlap the insertion span');
  assert.ok(insertionProjected.contentMass.some((mass) => mass.page === 1 && mass.box.y >= 50), 'main mass should reuse same-page space below the insertion box before spilling forward');
  const repeatedProjection = projectCoarseInsertionDisplacement(twoPageEstimate, layout(5), new Map([
    ['quotes:quote-1', { page: 1, slotId: 'main', box: { x: 10, y: 30, width: 40, height: 20 } }],
  ]));
  assert.deepEqual(repeatedProjection.contentMass, insertionProjected.contentMass, 'the same projection must produce deterministic aggregate rectangles');
  const obstacleLayout = layout(2);
  obstacleLayout.pageTemplates[0] = {
    ...pageTemplate,
    slots: [...pageTemplate.slots, { id: 'fixed-header', regionId: 'body', flowId: 'header', kind: 'text', spacingProfile: 'open', box: { x: 10, y: 30, width: 80, height: 20 } }],
  };
  const obstacleProjection = projectCoarseInsertionDisplacement(
    estimateCoarseMainGeometry({ flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] } } }, metrics, obstacleLayout),
    obstacleLayout,
    new Map(),
  );
  assert.ok(obstacleProjection.contentMass.every((mass) => mass.page !== 1 || mass.box.y + mass.box.height <= 30 || mass.box.y >= 50), 'fixed chrome must remain an obstacle during the coarse push');
  const afterObstacleMass = obstacleProjection.contentMass.filter((mass) => mass.page === 1 && mass.box.y >= 50);
  assert.ok(afterObstacleMass.length > 0, 'the fixed obstacle fixture must leave projected body mass after the obstacle');
  assert.ok(afterObstacleMass.some((mass) => mass.box.y === 50), 'soft spacing halos must remain available to the flow estimate instead of consuming hard capacity');

  const bottomObstacleLayout = structuredClone(obstacleLayout);
  bottomObstacleLayout.pageTemplates[0].slots = bottomObstacleLayout.pageTemplates[0].slots.map((slot) => slot.id === 'fixed-header'
    ? { ...slot, box: { ...slot.box, y: 20, height: 90 } }
    : slot);
  bottomObstacleLayout.pageTemplates[0].id = 'bottom-obstacle-page';
  bottomObstacleLayout.pageTemplates.push(structuredClone(pageTemplate));
  bottomObstacleLayout.pageTemplates[1].id = 'clear-spill-page';
  bottomObstacleLayout.pageTemplateAssignments = [
    { from: 1, to: 1, templateRef: 'obstacle', pageTemplateId: 'bottom-obstacle-page' },
    { from: 2, to: 2, templateRef: 'clear', pageTemplateId: 'clear-spill-page' },
  ];
  const bottomObstacleText = longText.split(/\s+/u).slice(0, 100).join(' ');
  const bottomObstacleDocument = { flows: { main: { blocks: [{ id: 'bottom-obstacle-body', kind: 'paragraph', role: 'body', text: bottomObstacleText }] } } };
  const bottomObstacleEstimate = estimateCoarseMainGeometry(bottomObstacleDocument, metrics, bottomObstacleLayout);
  const bottomObstacleProjection = projectCoarseInsertionDisplacement(bottomObstacleEstimate, bottomObstacleLayout, new Map());
  const bottomObstacleProjectedMass = bottomObstacleProjection.contentMass;
  assert.ok(bottomObstacleProjectedMass.some(({ page }) => page === 2), 'mass blocked near the bottom of page one must spill into page two');
  assert.equal(bottomObstacleProjectedMass.reduce((sum, mass) => sum + mass.lineWordCounts.reduce((lineSum, words) => lineSum + words, 0), 0), bottomObstacleText.split(/\s+/u).length, `forward spillover must preserve every estimated main-flow word: ${JSON.stringify({ source: bottomObstacleEstimate.contentMass.map(({ page, lineWordCounts }) => ({ page, count: lineWordCounts.reduce((sum, words) => sum + words, 0) })), projected: bottomObstacleProjectedMass.map(({ page, lineWordCounts }) => ({ page, count: lineWordCounts.reduce((sum, words) => sum + words, 0) })), unplaced: bottomObstacleProjection.unplacedWordCount })}`);
  assert.ok(bottomObstacleProjectedMass.every((mass) => mass.page !== 1 || mass.box.y + mass.box.height <= 20 || mass.box.y >= 110), 'projected spillover must leave no body rectangle intersecting the fixed bottom obstacle');
  assert.equal(bottomObstacleProjection.unplacedWordCount, 0, 'the two-page route must have enough downstream capacity for the displaced body mass');

  const chromeBoundaryLayout = layout(1);
  chromeBoundaryLayout.pageTemplates[0] = {
    id: 'chrome-boundary', width: 100, height: 120,
    slots: [
      { id: 'main', regionId: 'body', kind: 'text', box: { x: 10, y: 20, width: 80, height: 80 } },
      { id: 'header', regionId: 'header', flowId: 'header', kind: 'text', box: { x: 10, y: 10, width: 80, height: 10 } },
      { id: 'footer', regionId: 'footer', flowId: 'footer', kind: 'text', box: { x: 10, y: 100, width: 80, height: 10 } },
    ],
  };
  const chromeBoundaryDocument = { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Body content fits between fixed header and footer.' }] } } };
  const chromeBoundaryEstimate = estimateCoarseMainGeometry(chromeBoundaryDocument, metrics, chromeBoundaryLayout);
  const chromeBoundaryProjection = projectCoarseInsertionDisplacement(chromeBoundaryEstimate, chromeBoundaryLayout, new Map());
  assert.deepEqual(chromeBoundaryEstimate.regions.map(({ box }) => box), [{ x: 10, y: 20, width: 80, height: 80 }], 'the resolved main slot must retain page margins around fixed header/footer bands');
  assert.ok(chromeBoundaryProjection.contentMass.every(({ box }) => box.x >= 10 && box.x + box.width <= 90 && box.y >= 20 && box.y + box.height <= 100), 'coarse mass must remain inside the margin-bounded body between fixed header and footer');
  assert.equal(chromeBoundaryProjection.unplacedWordCount, 0, 'the boundary fixture must fit without pushing mass into fixed chrome');

  const orphanLayout = {
    maxPages: 5,
    pageTemplates: [{ id: 'coarse-orphan', width: 100, height: 120, slots: [
      { id: 'main', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
      { id: 'quote', regionId: 'body', flowId: 'quotes', kind: 'text', allowedRoles: ['quote'], box: { x: 10, y: 25, width: 80, height: 15 }, fitContent: true, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-through-content' } },
    ] }],
    routes: { main: { slots: ['main'], continuation: 'allowed' }, quotes: { slots: ['quote'], insertionSlots: ['quote'], continuation: 'forbidden' } },
  };
  const orphanDocument = {
    flows: {
      main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'One short beginning. ' + 'Many continuing words fill the rest of the page. '.repeat(12) }] },
      quotes: { blocks: [{ id: 'q', kind: 'paragraph', role: 'quote', text: 'A full width quote.' }] },
    },
  };
  const orphanEstimate = estimateCoarseMainGeometry(orphanDocument, metrics, orphanLayout);
  const orphanAssignments = assignCoarseInsertionProposals(orphanDocument, metrics, orphanLayout, orphanEstimate, new Map());
  const orphanProjection = projectCoarseInsertionDisplacement(orphanEstimate, orphanLayout, orphanAssignments);
  assert.ok(orphanEstimate.mainProgressByPage.has(orphanAssignments.get('quotes:q')?.page), 'the global assignment must keep the insertion on a page carrying unobstructed body mass');
  assert.equal(orphanEstimate.unplacedWordCount, 0, 'the unobstructed estimate must fit the body mass in its available page range');
  assert.equal(orphanProjection.unplacedWordCount, 0, 'the coarse cut and forward push must still fit the body mass in its available page range');
  const orphanExactResult = createTextCompositionEngine(orphanLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(orphanDocument, metrics);
  const orphanGeometry = {
    width: 100, height: 120, margin: 10,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    columns: { count: 1, gutter: 0, widths: [80] },
    content: { x: 10, top: 10, width: 80, bottom: 110 },
    segments: [{ x: 10, top: 10, width: 80, bottom: 110 }],
    bands: {}, flowObstacles: [], blockFrames: {}, flow: { align: 'left', hyphenate: false }, dynamicFlow: false,
  };
  attachPlanSpacingReport(orphanExactResult.plan, orphanDocument, metrics, orphanGeometry);
  const orphanExactEvaluation = evaluateCompositionPlan(orphanDocument, orphanExactResult.plan);
  const rewardedGravityDeficit = orphanExactEvaluation.scoreBreakdown.find(({ code }) => code === 'content-spread');
  assert.ok(rewardedGravityDeficit.points > 0 && rewardedGravityDeficit.value > 0, 'the frozen fixture must include a positive net gravity score with an observable residual deviation');
  assert.ok(orphanExactEvaluation.suggestions.some(({ code }) => code === 'INSERTION_CONTENT_SPREAD_IMBALANCE'), 'a positive net reward must not hide measured gravity defects from normal suggestions');
  assert.ok(!orphanExactEvaluation.passedMetrics.some(({ code }) => code === 'content-spread'), 'a rewarded component with a measured defect must not be reported as fully passed');
  const forcedOrphanLayout = structuredClone(orphanLayout);
  forcedOrphanLayout.pageTemplates.push({ ...pageTemplate, id: 'orphan-continuation' });
  forcedOrphanLayout.pageTemplateAssignments = [
    { from: 1, to: 1, templateRef: 'orphan-first', pageTemplateId: 'coarse-orphan' },
    { from: 2, templateRef: 'orphan-following', pageTemplateId: 'orphan-continuation' },
  ];
  const forcedOrphanResult = createTextCompositionEngine(forcedOrphanLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(orphanDocument, metrics);
  attachPlanSpacingReport(forcedOrphanResult.plan, orphanDocument, metrics, orphanGeometry);
  const forcedOrphanEvaluation = evaluateCompositionPlan(orphanDocument, forcedOrphanResult.plan);
  const orphanObservation = forcedOrphanResult.plan.spacing.observations.find(({ kind }) => kind === 'orphan-fragment');
  const orphanScore = forcedOrphanEvaluation.scoreBreakdown.find(({ code }) => code === 'orphan-lines');
  assert.equal(forcedOrphanEvaluation.status, 'accepted', 'a template-constrained exact plan must remain legal while exposing a measurable orphan-quality defect');
  assert.equal(orphanObservation?.blockId, 'body', 'exact line geometry must identify the paragraph isolated by the insertion');
  assert.equal(orphanObservation?.metrics.fragmentLines, 1, 'the fixture must create a one-line orphan under the configured threshold');
  assert.equal(orphanScore?.value, 1, 'exact scoring must retain the orphan detected from measured line and insertion rectangles');
  assert.equal(orphanScore?.details.orphans[0]?.side, 'before', 'the exact diagnostic must identify the isolated pre-insertion fragment');
  assert.ok(orphanExactResult.plan.decisions.some(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED'), 'the normal runtime must expose the coarse-first baseline decision');
  const orphanProjectionComparison = compareCoarseEstimateToExactPlan(orphanDocument, orphanProjection, orphanExactResult.plan);
  assert.equal(orphanProjectionComparison.exactMainTerminalPage, orphanProjection.terminalPage, `the projected post-insertion body extent must match exact reflow in the orphan fixture: ${JSON.stringify({ estimate: orphanProjection.terminalPage, pages: orphanProjection.contentMass.map(({ page, startWord, endWord, box, lineWordCounts }) => ({ page, startWord, endWord, box, lineWordCounts })), exactPages: [...new Set(orphanExactResult.plan.lines.filter(({ flowId }) => flowId === 'main').map(({ page }) => page))] })}`);
  assert.equal(orphanProjectionComparison.pages.reduce((sum, page) => sum + page.estimatedMassUnits, 0), orphanProjectionComparison.exactTextWordCount, 'line-aware obstacle projection must preserve total main-flow word mass');

  const rollbackPolicy = { coarseGeometryFirst: false, maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } };
  const rollbackPlanner = createTextCompositionPlanner(orphanLayout, rollbackPolicy);
  assert.equal(rollbackPlanner.planBaselineWithSignature, undefined, 'the rollback mode must route the engine through the existing legacy candidate planner');
  const rollbackResult = createTextCompositionEngine(orphanLayout, rollbackPolicy).plan(orphanDocument, metrics);
  assert.equal(rollbackResult.evaluation.status, 'accepted', 'the configuration rollback must still produce an exact legal plan');
  assert.ok(!rollbackResult.plan.decisions.some(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED'), 'the legacy rollback must not report that a coarse baseline was selected');
  assert.equal(rollbackResult.plan.trace?.candidateSearch?.fullPlanRecalculations, 1, 'the rollback baseline must use the same exact full-plan evaluation accounting');
  const coarseQuotePlacement = orphanExactResult.plan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:q');
  const rollbackQuotePlacement = rollbackResult.plan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:q');
  assert.ok(coarseQuotePlacement && rollbackQuotePlacement, 'both planning paths must retain the authored insertion');
  const exactBodyTerminalPage = Math.max(...orphanExactResult.plan.lines.filter(({ flowId }) => flowId === 'main').map(({ page }) => page));
  assert.ok(orphanEstimate.mainProgressByPage.has(coarseQuotePlacement.page), 'coarse assignment must place the insertion on a page carrying the predicted body flow');
  assert.ok(rollbackQuotePlacement.page > exactBodyTerminalPage, 'the legacy seed path must expose its insertion-only terminal page on this frozen regression fixture');
  attachPlanSpacingReport(rollbackResult.plan, orphanDocument, metrics, orphanGeometry);
  const rollbackEvaluation = evaluateCompositionPlan(orphanDocument, rollbackResult.plan);
  assert.equal(rollbackEvaluation.status, 'accepted', 'the legacy insertion-only page must remain a legal comparison baseline');
  assert.ok(orphanExactEvaluation.score > rollbackEvaluation.score, `a body-associated insertion must outrank the insertion-only page on this frozen legal pair: ${JSON.stringify({ coarse: orphanExactEvaluation.score, detached: rollbackEvaluation.score })}`);
  const legacyEmptyRegions = rollbackEvaluation.scoreBreakdown.find(({ code }) => code === 'empty-regions');
  assert.ok(legacyEmptyRegions?.details.regions.some(({ page, slotId }) => page === rollbackQuotePlacement.page && slotId.endsWith(':main')), 'an insertion-only terminal page must remain visible as an empty main region in exact scoring');

  const collidedExactPlan = structuredClone(orphanExactResult.plan);
  const wrappingGraphic = collidedExactPlan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:q');
  assert.ok(wrappingGraphic, 'the exact collision probe requires the coarse-seeded wrapping insertion');
  collidedExactPlan.lines.find((line) => line.page === wrappingGraphic.page).box.y = wrappingGraphic.box.y + 1;
  attachPlanSpacingReport(collidedExactPlan, orphanDocument, metrics, orphanGeometry);
  const collidedEvaluation = evaluateCompositionPlan(orphanDocument, collidedExactPlan);
  assert.ok(collidedEvaluation.hardViolations.some(({ code }) => code === 'LINE_GRAPHIC_OVERLAP'), 'exact geometry validation must reject a line that enters the wrapping insertion even though the coarse aggregate rectangles were feasible');
  const marginCollidedPlan = structuredClone(orphanExactResult.plan);
  marginCollidedPlan.lines[0].box.x = 0;
  attachPlanSpacingReport(marginCollidedPlan, orphanDocument, metrics, orphanGeometry);
  const marginCollidedEvaluation = evaluateCompositionPlan(orphanDocument, marginCollidedPlan);
  assert.ok(marginCollidedEvaluation.hardViolations.some(({ code }) => code === 'LINE_OUTSIDE_SLOT'), 'exact legality must reject a planned line crossing the page margin even when the coarse seed was feasible');

  const columnLayout = layout(1);
  columnLayout.pageTemplates[0] = {
    id: 'coarse-columns', width: 100, height: 120,
    slots: [
      { id: 'left', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 35, height: 100 } },
      { id: 'right', regionId: 'body', kind: 'text', box: { x: 55, y: 10, width: 35, height: 100 } },
      { id: 'left-obstacle', regionId: 'chrome', kind: 'graphic', reserved: true, box: { x: 10, y: 30, width: 25, height: 20 } },
    ],
  };
  columnLayout.routes.main = { slots: ['left', 'right'], continuation: 'allowed' };
  const columnEstimate = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] } } },
    metrics,
    columnLayout,
  );
  const columnProjection = projectCoarseInsertionDisplacement(columnEstimate, columnLayout, new Map());
  const leftMass = columnProjection.contentMass.filter((mass) => mass.slotId === 'left');
  const rightMass = columnProjection.contentMass.filter((mass) => mass.slotId === 'right');
  assert.ok(leftMass.every((mass) => mass.box.y + mass.box.height <= 30 || mass.box.y >= 50), 'a fixed obstacle must cut the intersecting column lane');
  assert.ok(rightMass.some((mass) => mass.box.y < 30), 'a partial-width obstacle must leave the independent right column available');

  const fivePageEstimate = estimateCoarseMainGeometry(
    { flows: { main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText.repeat(7) }] } } },
    metrics,
    layout(5),
  );
  assert.equal(fivePageEstimate.terminalPage, 5, 'long main flow should spill through five available coarse pages');
  assert.ok(fivePageEstimate.mainProgressByPage.get(1).center < fivePageEstimate.mainProgressByPage.get(5).center);
  assert.ok(fivePageEstimate.unplacedWordCount > 0, 'overflow beyond the configured page range must remain explicit');

  const insertionLayout = {
    pageTemplates: [{
      id: 'insertion-test', width: 100, height: 120,
      slots: ['quote-top', 'quote-middle', 'quote-bottom'].map((id, index) => ({
        id, regionId: 'body', flowId: 'quotes', kind: 'text', allowedRoles: ['quote'],
        box: { x: 10, y: [20, 50, 80][index], width: 80, height: 15 },
        placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 3, distribution: 'spread-through-content', rhythmGroup: 'editorial' },
      })),
    }],
    routes: {
      main: { slots: ['main'], continuation: 'allowed' },
      quotes: { slots: ['quote-top', 'quote-middle', 'quote-bottom'], insertionSlots: ['quote-top', 'quote-middle', 'quote-bottom'], continuation: 'allowed' },
    },
    maxPages: 5,
  };
  insertionLayout.pageTemplates[0].slots.push(pageTemplate.slots[0]);
  const sourceRelationLayout = structuredClone(insertionLayout);
  sourceRelationLayout.placementPolicies = { flows: { quotes: { source: { flowId: 'main', blockId: 'source-body', strength: 'require-same-page' } } } };
  const sourceRelationDocument = {
    flows: {
      main: { blocks: [{ id: 'source-body', kind: 'paragraph', role: 'body', text: 'The source block owns this short insertion.' }] },
      quotes: { blocks: [{ id: 'source-quote', kind: 'paragraph', role: 'quote', text: 'Keep me with my source.' }] },
    },
  };
  const sourceRelationEstimate = estimateCoarseMainGeometry(sourceRelationDocument, metrics, sourceRelationLayout);
  const sourceRelationMassPages = new Set(sourceRelationEstimate.contentMass.filter(({ blockId }) => blockId === 'source-body').map(({ page }) => page));
  const sourceRelationAssignments = assignCoarseInsertionProposals(sourceRelationDocument, metrics, sourceRelationLayout, sourceRelationEstimate, new Map());
  assert.equal(sourceRelationAssignments.get('quotes:source-quote')?.page, 1, 'hard source relations must constrain coarse choices to the source block page');
  const sourceRelationExact = createTextCompositionEngine(sourceRelationLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(sourceRelationDocument, metrics);
  assert.equal(sourceRelationExact.evaluation.status, 'accepted', 'exact evaluation remains authoritative for a coarse candidate that satisfies its hard source relation');
  assert.ok(sourceRelationMassPages.has(sourceRelationExact.plan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:source-quote')?.page), 'the exact insertion must stay on an exact source page');
  const impossibleSourceLayout = structuredClone(sourceRelationLayout);
  impossibleSourceLayout.routes.quotes.startPage = 2;
  const impossibleSourceEstimate = estimateCoarseMainGeometry(sourceRelationDocument, metrics, impossibleSourceLayout);
  const impossibleSourceAssignments = assignCoarseInsertionProposals(sourceRelationDocument, metrics, impossibleSourceLayout, impossibleSourceEstimate, new Map());
  assert.equal(impossibleSourceAssignments.size, 0, 'a hard source relation with no compatible page must not fall back to an aesthetically close incompatible slot');
  assert.deepEqual(unassignedCoarseInsertionItems(sourceRelationDocument, impossibleSourceLayout, impossibleSourceAssignments, impossibleSourceEstimate).map(({ blockId, reason }) => ({ blockId, reason })), [{ blockId: 'source-quote', reason: 'source-relation-conflict' }]);
  const impossibleSourceExact = createTextCompositionEngine(impossibleSourceLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(sourceRelationDocument, metrics);
  assert.equal(impossibleSourceExact.evaluation.status, 'rejected', 'exact legality must reject an insertion with no page satisfying its hard source relation');
  assert.equal(impossibleSourceExact.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED')?.unassignedInsertionCount, 1, 'the exact plan must expose the hard source conflict that coarse assignment could not solve');
  for (const distribution of ['free', 'clustered', 'spread-through-content', 'spread-across-pages']) {
    const incompatibleSourceLayout = structuredClone(impossibleSourceLayout);
    incompatibleSourceLayout.pageTemplates[0].slots = incompatibleSourceLayout.pageTemplates[0].slots.map((slot) => slot.placement?.mode === 'fluid-y'
      ? { ...slot, placement: { ...slot.placement, distribution } }
      : slot);
    const incompatibleSourceEstimate = estimateCoarseMainGeometry(sourceRelationDocument, metrics, incompatibleSourceLayout);
    const incompatibleSourceAssignments = assignCoarseInsertionProposals(sourceRelationDocument, metrics, incompatibleSourceLayout, incompatibleSourceEstimate, new Map());
    assert.equal(incompatibleSourceAssignments.size, 0, `${distribution} must honor a hard same-page source relation before aesthetic ranking`);
    assert.deepEqual(unassignedCoarseInsertionItems(sourceRelationDocument, incompatibleSourceLayout, incompatibleSourceAssignments, incompatibleSourceEstimate).map(({ blockId, reason }) => ({ blockId, reason })), [{ blockId: 'source-quote', reason: 'source-relation-conflict' }], `${distribution} must preserve the source incompatibility as the assignment reason`);
    const incompatibleSourceExact = createTextCompositionEngine(incompatibleSourceLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(sourceRelationDocument, metrics);
    assert.equal(incompatibleSourceExact.evaluation.status, 'rejected', `${distribution} must preserve a hard source conflict for exact legality evaluation`);
  }
  const quotesOverTwoPages = {
    flows: {
      main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText }] },
      quotes: { blocks: Array.from({ length: 5 }, (_, index) => ({ id: `quote-${index + 1}`, kind: 'paragraph', role: 'quote', text: `Quote ${index + 1}.` })) },
    },
  };
  const forbiddenContinuationLayout = structuredClone(insertionLayout);
  forbiddenContinuationLayout.maxPages = 2;
  forbiddenContinuationLayout.pageTemplates[0].slots = forbiddenContinuationLayout.pageTemplates[0].slots.filter((slot) => slot.id !== 'quote-bottom');
  forbiddenContinuationLayout.routes.quotes.continuation = 'forbidden';
  const forbiddenContinuationDocument = structuredClone(quotesOverTwoPages);
  forbiddenContinuationDocument.flows.quotes.blocks = forbiddenContinuationDocument.flows.quotes.blocks.slice(0, 3);
  const forbiddenContinuationEstimate = estimateCoarseMainGeometry(forbiddenContinuationDocument, metrics, forbiddenContinuationLayout);
  const forbiddenContinuationAssignments = assignCoarseInsertionProposals(forbiddenContinuationDocument, metrics, forbiddenContinuationLayout, forbiddenContinuationEstimate, new Map());
  assert.equal(forbiddenContinuationAssignments.size, 2, 'a non-repeating forbidden-continuation flow must keep only its legal first-page insertion prefix when that page runs out of slots');
  const forbiddenAnchorPage = [...forbiddenContinuationAssignments.values()][0].page;
  assert.ok([...forbiddenContinuationAssignments.values()].every(({ page }) => page === forbiddenAnchorPage), 'a forbidden-continuation insertion flow must keep all assigned blocks on its selected anchor page');
  const forbiddenContinuationUnassigned = unassignedCoarseInsertionItems(forbiddenContinuationDocument, forbiddenContinuationLayout, forbiddenContinuationAssignments, forbiddenContinuationEstimate);
  assert.equal(forbiddenContinuationUnassigned.length, 1, 'capacity blocked by the continuation rule must preserve the remaining authored insertion as unassigned evidence');
  assert.equal(forbiddenContinuationUnassigned[0].reason, forbiddenAnchorPage === 1 ? 'continuation-policy-conflict' : 'capacity-or-order-conflict', 'the decision must distinguish blocked future continuation from exhausted capacity on the last eligible page');
  assert.deepEqual(forbiddenContinuationUnassigned[0].continuationPolicyConflict, forbiddenAnchorPage === 1 ? { anchorPage: forbiddenAnchorPage, candidatePages: [1, 2] } : undefined, 'continuation evidence must be emitted only when a later candidate page exists');
  const forbiddenContinuationExact = createTextCompositionEngine(forbiddenContinuationLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(forbiddenContinuationDocument, metrics);
  assert.equal(forbiddenContinuationExact.evaluation.status, 'rejected', 'exact evaluation must reject required insertion content that cannot continue within its single-page route');
  for (const distribution of ['free', 'clustered', 'spread-through-content', 'spread-across-pages']) {
    const boundedRouteLayout = structuredClone(forbiddenContinuationLayout);
    boundedRouteLayout.pageTemplates[0].slots = boundedRouteLayout.pageTemplates[0].slots.map((slot) => slot.placement?.mode === 'fluid-y'
      ? { ...slot, placement: { ...slot.placement, distribution } }
      : slot);
    const boundedRouteEstimate = estimateCoarseMainGeometry(forbiddenContinuationDocument, metrics, boundedRouteLayout);
    const boundedRouteAssignments = assignCoarseInsertionProposals(forbiddenContinuationDocument, metrics, boundedRouteLayout, boundedRouteEstimate, new Map());
    assert.equal(boundedRouteAssignments.size, 2, `${distribution} must retain the legal page-local prefix when forbidden continuation exhausts capacity`);
    assert.equal(new Set([...boundedRouteAssignments.values()].map(({ page }) => page)).size, 1, `${distribution} must not spill a forbidden route onto another page`);
    const boundedAnchorPage = [...boundedRouteAssignments.values()][0].page;
    assert.deepEqual(unassignedCoarseInsertionItems(forbiddenContinuationDocument, boundedRouteLayout, boundedRouteAssignments, boundedRouteEstimate).map(({ blockId, reason }) => ({ blockId, reason })), [{ blockId: 'quote-3', reason: boundedAnchorPage === 1 ? 'continuation-policy-conflict' : 'capacity-or-order-conflict' }], `${distribution} must identify the constraint blocking the authored suffix`);
    const boundedRouteExact = createTextCompositionEngine(boundedRouteLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(forbiddenContinuationDocument, metrics);
    assert.equal(boundedRouteExact.evaluation.status, 'rejected', `${distribution} must preserve exact rejection for the unplaced required suffix`);
  }
  const sourceContinuationLayout = structuredClone(sourceRelationLayout);
  sourceContinuationLayout.pageTemplates[0].slots = sourceContinuationLayout.pageTemplates[0].slots.filter((slot) => slot.id !== 'quote-middle' && slot.id !== 'quote-bottom');
  sourceContinuationLayout.routes.quotes.continuation = 'forbidden';
  const sourceContinuationDocument = {
    flows: {
      main: { blocks: [{ id: 'source-body', kind: 'paragraph', role: 'body', text: longText }] },
      quotes: { blocks: [
        { id: 'source-quote-1', kind: 'paragraph', role: 'quote', text: 'The first quote belongs to the source.' },
        { id: 'source-quote-2', kind: 'paragraph', role: 'quote', text: 'The second quote belongs to the source too.' },
      ] },
    },
  };
  const sourceContinuationEstimate = estimateCoarseMainGeometry(sourceContinuationDocument, metrics, sourceContinuationLayout);
  const sourceContinuationAssignments = assignCoarseInsertionProposals(sourceContinuationDocument, metrics, sourceContinuationLayout, sourceContinuationEstimate, new Map());
  assert.equal(sourceContinuationAssignments.size, 1, 'same-source eligibility must not override a forbidden continuation when only one slot is available on the anchor page');
  const sourceContinuationAnchorPage = [...sourceContinuationAssignments.values()][0].page;
  assert.ok(sourceContinuationEstimate.contentMass.some(({ blockId, page }) => blockId === 'source-body' && page === sourceContinuationAnchorPage), 'the selected anchor must contain its required source');
  const sourceContinuationUnassigned = unassignedCoarseInsertionItems(sourceContinuationDocument, sourceContinuationLayout, sourceContinuationAssignments, sourceContinuationEstimate);
  assert.equal(sourceContinuationUnassigned.length, 1, 'exactly the quote beyond page-local capacity should remain unassigned');
  assert.equal(sourceContinuationUnassigned[0].blockId, 'source-quote-2');
  assert.equal(sourceContinuationUnassigned[0].reason, 'continuation-policy-conflict', 'coarse evidence must distinguish continuation exhaustion from an impossible same-page source relation');
  assert.equal(sourceContinuationUnassigned[0].sourceRelationConflict, undefined, 'the same-page relation is feasible on earlier route pages and must not be misreported as the failure');
  assert.deepEqual(sourceContinuationUnassigned[0].continuationPolicyConflict, { anchorPage: sourceContinuationAnchorPage, candidatePages: [1, 2, 3, 4, 5] }, 'continuation evidence must report the selected anchor and complete route candidate range');
  const sourceContinuationExact = createTextCompositionEngine(sourceContinuationLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(sourceContinuationDocument, metrics);
  assert.equal(sourceContinuationExact.evaluation.status, 'rejected', 'exact evaluation remains authoritative when source compatibility does not make forbidden continuation legal');
  const repeatedContinuationLayout = structuredClone(forbiddenContinuationLayout);
  repeatedContinuationLayout.routes.quotes.repeat = 'each-page';
  const repeatedContinuationDocument = structuredClone(forbiddenContinuationDocument);
  repeatedContinuationDocument.flows.main.blocks[0].text = 'Short main content leaves two legal page-local insertion instances.';
  const repeatedContinuationEstimate = estimateCoarseMainGeometry(repeatedContinuationDocument, metrics, repeatedContinuationLayout);
  const repeatedContinuationAssignments = assignCoarseInsertionProposals(repeatedContinuationDocument, metrics, repeatedContinuationLayout, repeatedContinuationEstimate, new Map());
  assert.equal(repeatedContinuationAssignments.size, 3, 'an explicitly repeated flow may distribute its authored insertion blocks across its page-local instances');
  const repeatedContinuationOrderedAssignments = repeatedContinuationDocument.flows.quotes.blocks
    .map(({ id }) => repeatedContinuationAssignments.get(`quotes:${id}`));
  assert.ok(repeatedContinuationOrderedAssignments.every(Boolean), 'each authored repeated-flow block must have a page-local assignment');
  assert.ok(repeatedContinuationOrderedAssignments.every((assignment, index) => index === 0
    || assignment.page >= repeatedContinuationOrderedAssignments[index - 1].page), 'repeat-each-page capacity must preserve authored order across page instances');
  assert.ok(new Set(repeatedContinuationOrderedAssignments.map(({ page }) => page)).size > 1, 'repeat-each-page slots must allow the required authored suffix to continue on another eligible page');
  const repeatedContinuationExact = createTextCompositionEngine(repeatedContinuationLayout, {
    maxPlanningIterations: 2,
    searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 },
  }).plan(repeatedContinuationDocument, metrics);
  assert.equal(repeatedContinuationExact.evaluation.status, 'accepted', `the repeat-each-page exception must remain exactly legal with continuation forbidden: ${JSON.stringify(repeatedContinuationExact.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })))}`);
  const repeatedContinuationExactAssignments = new Map((repeatedContinuationExact.plan.insertionLines ?? []).map(({ blockId, page }) => [blockId, page]));
  assert.equal(repeatedContinuationExactAssignments.size, repeatedContinuationDocument.flows.quotes.blocks.length, 'exact materialization must retain every repeated-flow insertion');
  assert.deepEqual([...repeatedContinuationExactAssignments], repeatedContinuationOrderedAssignments.map(({ blockId, page }) => [blockId, page]), 'exact planning must preserve the coarse repeated-page assignment and authored order');
  const quoteSeed = seedInsertionProposals(quotesOverTwoPages, insertionLayout, metrics);
  const coarseQuoteProgress = estimateCoarseMainGeometry(quotesOverTwoPages, metrics, insertionLayout);
  const groupedQuotes = assignCoarseInsertionProposals(quotesOverTwoPages, metrics, insertionLayout, coarseQuoteProgress, new Map());
  assert.equal(groupedQuotes.size, 5, 'all five authored quotes must retain a legal coarse assignment');
  assert.ok([...groupedQuotes.values()].every((proposal) => proposal.page <= 2), `five quotes must follow the two-page unobstructed main estimate: seed=${JSON.stringify([...quoteSeed.values()])}; grouped=${JSON.stringify([...groupedQuotes.values()])}; progress=${JSON.stringify([...coarseQuoteProgress.mainProgressByPage.values()])}`);
  const exactTwoPageResult = createTextCompositionEngine(insertionLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(quotesOverTwoPages, metrics);
  const exactTwoPageCoarseDecision = exactTwoPageResult.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
  assert.equal(exactTwoPageCoarseDecision?.baselineExactMaterializationCount, 2, 'the bounded two-page baseline should expose its initial and stabilization materializations separately from candidate evaluation');
  assert.ok(!exactTwoPageResult.plan.diagnostics.some(({ code }) => code === 'PLANNER_DID_NOT_STABILIZE'), 'the two-page baseline fixture must reach exact stabilization within its bound');
  assert.equal(exactTwoPageResult.plan.trace?.candidateSearch?.fullPlanRecalculations, 1, 'the engine should evaluate the one materialized baseline exactly once');
  const exactQuotePages = new Map((exactTwoPageResult.plan.insertionLines ?? []).map((line) => [line.blockId, line.page]));
  assert.equal(exactQuotePages.size, 5, `the exact materialized plan must retain all five quotes: ${JSON.stringify({ status: exactTwoPageResult.evaluation.status, diagnostics: exactTwoPageResult.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })), quotePages: [...exactQuotePages] })}`);
  assert.equal(exactTwoPageResult.evaluation.status, 'accepted', 'coarse distribution must preserve legality while spreading five quotes');
  assert.ok([...exactQuotePages.values()].every((page) => page <= 2), `exact quote assignments must remain within the two-page body instead of manufacturing insertion-only pages: ${JSON.stringify([...exactQuotePages])}`);
  assert.deepEqual([...exactQuotePages].sort(([left], [right]) => left.localeCompare(right)), [...groupedQuotes].map(([key, proposal]) => [key.slice('quotes:'.length), proposal.page]).sort(([left], [right]) => left.localeCompare(right)), 'exact materialization must preserve the coarse assignment for every five-over-two quote');
  const legacyTwoPageRecords = createTextCompositionPlanner(insertionLayout, { maxPlanningIterations: 2, searchBudget: { maxInitialCandidates: 1 } })
    .planCandidatesWithSignatures(quotesOverTwoPages, metrics);
  assert.equal(legacyTwoPageRecords.length, 2, 'the frozen legacy baseline should materialize two stabilized exact candidates when bounded to one insertion seed');
  const legacyTwoPagePlan = legacyTwoPageRecords.at(-1)?.plan;
  assert.equal(legacyTwoPagePlan?.decisions.find(({ code }) => code === 'PLANNER_STABILIZED')?.iteration, 2, 'the legacy exact fixture must include its bounded stabilization pass');
  assert.ok(!legacyTwoPagePlan?.diagnostics.some(({ code }) => code === 'PLANNER_DID_NOT_STABILIZE'), 'the legacy exact fixture must stabilize within its bound');
  const legacyTwoPageAssignments = new Map((legacyTwoPagePlan?.insertionLines ?? []).map((line) => [line.blockId, line.page]));
  assert.equal(legacyTwoPageAssignments.size, 5, 'the frozen legacy exact path must place every five-over-two quote for comparison');
  assert.equal(new Set(legacyTwoPageAssignments.values()).size, 2, 'the stabilized legacy exact path should distribute five quotes over the two-page body');
  assert.equal(new Set(exactQuotePages.values()).size, 2, 'post-push coarse selection must retain the same two-page capacity while being free to improve the legacy arrangement');

  const constrainedInsertionLayout = structuredClone(insertionLayout);
  constrainedInsertionLayout.pageTemplates[0].slots = constrainedInsertionLayout.pageTemplates[0].slots.filter((slot) => !['quote-middle', 'quote-bottom'].includes(slot.id));
  constrainedInsertionLayout.maxPages = 2;
  const constrainedAssignments = assignCoarseInsertionProposals(
    quotesOverTwoPages,
    metrics,
    constrainedInsertionLayout,
    estimateCoarseMainGeometry(quotesOverTwoPages, metrics, constrainedInsertionLayout),
    new Map(),
  );
  const constrainedGaps = unassignedCoarseInsertionItems(quotesOverTwoPages, constrainedInsertionLayout, constrainedAssignments);
  assert.equal(constrainedAssignments.size, 2, 'the estimator should use available capacity instead of dropping the whole over-capacity group');
  assert.equal(constrainedGaps.length, 3, 'every unassigned authored insertion must remain explicit');
  assert.ok(constrainedGaps.every((gap) => gap.reason === 'capacity-or-order-conflict' && gap.legalCandidateCount === 2), 'capacity exhaustion must retain the legal candidate count and reason');
  const constrainedExactResult = createTextCompositionEngine(constrainedInsertionLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(quotesOverTwoPages, metrics);
  assert.equal(constrainedExactResult.evaluation.status, 'rejected', 'exact evaluation must reject a coarse seed that cannot fit every required insertion');
  assert.ok(constrainedExactResult.evaluation.hardViolations.length > 0 || constrainedExactResult.evaluation.residualContent.length > 0, 'an aesthetically plausible coarse assignment must not hide exact capacity violations');
  assert.equal(constrainedExactResult.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED')?.unassignedInsertionCount, 3, 'exact diagnostics must retain the coarse capacity shortfall count');

  const mixedLoadLayout = structuredClone(insertionLayout);
  mixedLoadLayout.pageTemplates[0].slots = [
    { id: 'quote-a', regionId: 'body', flowId: 'mixed', kind: 'text', box: { x: 10, y: 20, width: 80, height: 15 }, allowedRoles: ['quote'], fitContent: true, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 3, distribution: 'spread-through-content', rhythmGroup: 'editorial' } },
    { id: 'image', regionId: 'body', flowId: 'mixed', kind: 'block', box: { x: 10, y: 50, width: 80, height: 15 }, allowedRoles: ['image'], allowedBlockKinds: ['image'], fitContent: true, grow: { axis: 'y', maxHeight: 35 }, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 3, distribution: 'spread-through-content', rhythmGroup: 'editorial' } },
    { id: 'quote-b', regionId: 'body', flowId: 'mixed', kind: 'text', box: { x: 10, y: 80, width: 80, height: 15 }, allowedRoles: ['quote'], fitContent: true, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 3, distribution: 'spread-through-content', rhythmGroup: 'editorial' } },
    pageTemplate.slots[0],
  ];
  mixedLoadLayout.routes.mixed = { slots: ['quote-a', 'image', 'quote-b'], insertionSlots: ['quote-a', 'image', 'quote-b'], continuation: 'allowed' };
  const mixedLoadDocument = {
    flows: {
      main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText.repeat(3) }] },
      mixed: { blocks: [
        { id: 'large-image', kind: 'image', role: 'image', atomic: true },
        { id: 'short-quote-a', kind: 'paragraph', role: 'quote', text: 'A brief quote.' },
        { id: 'short-quote-b', kind: 'paragraph', role: 'quote', text: 'Another brief quote.' },
      ] },
    },
  };
  const mixedLoadMetrics = { ...metrics, measureBlock(block) { return { height: block.kind === 'image' ? 30 : 5 }; } };
  const mixedLoadEstimate = estimateCoarseMainGeometry(mixedLoadDocument, mixedLoadMetrics, mixedLoadLayout);
  const mixedLoadAssignments = assignCoarseInsertionProposals(mixedLoadDocument, mixedLoadMetrics, mixedLoadLayout, mixedLoadEstimate, new Map());
  const imagePlacement = mixedLoadAssignments.get('mixed:large-image');
  const quotePlacements = ['mixed:short-quote-a', 'mixed:short-quote-b'].map((key) => mixedLoadAssignments.get(key));
  assert.ok(imagePlacement && quotePlacements.every(Boolean), `a mixed image/quote rhythm group must assign every item when legal capacity exists: assignments=${JSON.stringify([...mixedLoadAssignments])}; gaps=${JSON.stringify(unassignedCoarseInsertionItems(mixedLoadDocument, mixedLoadLayout, mixedLoadAssignments))}`);
  assert.ok(imagePlacement.box.height > Math.max(...quotePlacements.map((placement) => placement.box.height)), 'the coarse visual load must preserve the measured image height relative to short quotes');
  assert.equal(new Set([...mixedLoadAssignments.values()].map((proposal) => proposal.page)).size, 3, `mixed visual load should distribute three items across three document progress points when capacity allows: ${JSON.stringify([...mixedLoadAssignments])}; progress=${JSON.stringify([...mixedLoadEstimate.mainProgressByPage.values()])}`);

  const quotesOverFivePages = {
    flows: {
      main: { blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: longText.repeat(7) }] },
      quotes: { blocks: [1, 2].map((index) => ({ id: `quote-${index}`, kind: 'paragraph', role: 'quote', text: `Quote ${index}.` })) },
    },
  };
  const fivePageQuoteProgress = estimateCoarseMainGeometry(quotesOverFivePages, metrics, insertionLayout);
  const twoQuoteSeed = seedInsertionProposals(quotesOverFivePages, insertionLayout, metrics);
  const distributedTwoQuotes = assignCoarseInsertionProposals(quotesOverFivePages, metrics, insertionLayout, fivePageQuoteProgress, new Map());
  assert.equal(new Set([...distributedTwoQuotes.values()].map((proposal) => proposal.page)).size, 2, 'two quotes should use distinct points in a five-page main flow');
  for (const distribution of ['free', 'clustered', 'spread-through-content', 'spread-across-pages']) {
    const distributionLayout = structuredClone(insertionLayout);
    distributionLayout.pageTemplates[0].slots = distributionLayout.pageTemplates[0].slots.map((slot) => slot.placement
      ? { ...slot, placement: { ...slot.placement, distribution } }
      : slot);
    const distributionEstimate = estimateCoarseMainGeometry(quotesOverFivePages, metrics, distributionLayout);
    const distributionAssignments = assignCoarseInsertionProposals(quotesOverFivePages, metrics, distributionLayout, distributionEstimate, new Map());
    const assignments = [...distributionAssignments.values()];
    assert.equal(assignments.length, 2, `${distribution} must assign every authored insertion when legal capacity exists`);
    assert.equal(new Set(assignments.map(({ slotId, page }) => `${page}:${slotId}`)).size, 2, `${distribution} must not overbook one page-local slot`);
    assert.ok(assignments.every(({ page }) => distributionEstimate.mainProgressByPage.has(page)), `${distribution} must prefer pages carrying main-flow mass`);
    if (distribution === 'free' || distribution === 'clustered') {
      assert.equal(new Set(assignments.map(({ page }) => page)).size, 1, `${distribution} must preserve its page-local grouping preference`);
    } else {
      assert.equal(new Set(assignments.map(({ page }) => page)).size, 2, `${distribution} must spread ordered blocks over distinct main-flow pages`);
    }
  }

  const transitionInsertionLayout = {
    pageTemplates: [
      { id: 'transition-first', width: 100, height: 140, slots: [
        { id: 'main', regionId: 'body', flowId: 'main', kind: 'text', box: { x: 10, y: 10, width: 80, height: 120 } },
        { id: 'quote-first', regionId: 'body', flowId: 'quotes', kind: 'text', allowedRoles: ['quote'], box: { x: 10, y: 25, width: 80, height: 20 }, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-across-pages' } },
      ] },
      { id: 'transition-following', width: 100, height: 140, slots: [
        { id: 'main', regionId: 'body', flowId: 'main', kind: 'text', box: { x: 10, y: 10, width: 80, height: 120 } },
        { id: 'quote-second', regionId: 'body', flowId: 'quotes', kind: 'text', allowedRoles: ['quote'], box: { x: 10, y: 45, width: 80, height: 20 }, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-across-pages' } },
        { id: 'quote-third', regionId: 'body', flowId: 'quotes', kind: 'text', allowedRoles: ['quote'], box: { x: 10, y: 75, width: 80, height: 20 }, placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-across-pages' } },
      ] },
    ],
    pageTemplateAssignments: [
      { from: 1, to: 1, templateRef: 'transition-first', pageTemplateId: 'transition-first' },
      { from: 2, templateRef: 'transition-following', pageTemplateId: 'transition-following' },
    ],
    routes: {
      main: { slots: ['main'], continuation: 'allowed' },
      quotes: { slots: ['quote-first', 'quote-second', 'quote-third'], insertionSlots: ['quote-first', 'quote-second', 'quote-third'], continuation: 'allowed' },
    },
    maxPages: 2,
  };
  const transitionInsertionDocument = {
    flows: {
      main: { blocks: [{ id: 'transition-body', kind: 'paragraph', role: 'body', text: longText.split(' ').slice(0, 130).join(' ') }] },
      quotes: { blocks: Array.from({ length: 3 }, (_, index) => ({ id: `transition-quote-${index + 1}`, kind: 'paragraph', role: 'quote', text: `Transition quote ${index + 1}.` })) },
    },
  };
  for (const distribution of ['free', 'clustered', 'spread-through-content', 'spread-across-pages']) {
    const distributionTransitionLayout = structuredClone(transitionInsertionLayout);
    distributionTransitionLayout.pageTemplates = distributionTransitionLayout.pageTemplates.map((pageTemplate) => ({
      ...pageTemplate,
      slots: pageTemplate.slots.map((slot) => slot.placement
        ? { ...slot, placement: { ...slot.placement, distribution } }
        : slot),
    }));
    const transitionEstimate = estimateCoarseMainGeometry(transitionInsertionDocument, metrics, distributionTransitionLayout);
    const transitionAssignments = assignCoarseInsertionProposals(transitionInsertionDocument, metrics, distributionTransitionLayout, transitionEstimate, new Map());
    assert.equal(transitionAssignments.size, 3, `${distribution} must use the capacity declared by each page-template variant`);
    const orderedTransitionAssignments = transitionInsertionDocument.flows.quotes.blocks.map(({ id }) => transitionAssignments.get(`quotes:${id}`));
    assert.ok(orderedTransitionAssignments.every(Boolean), `${distribution} must assign every quote across the template transition`);
    assert.ok(orderedTransitionAssignments.every((assignment, index) => index === 0 || assignment.page >= orderedTransitionAssignments[index - 1].page), `${distribution} must preserve authored order across page-template capacity changes`);
    assert.equal(new Set(orderedTransitionAssignments.map(({ page, slotId }) => `${page}:${slotId}`)).size, 3, `${distribution} must not reuse a page-local slot`);
    assert.deepEqual(unassignedCoarseInsertionItems(transitionInsertionDocument, distributionTransitionLayout, transitionAssignments, transitionEstimate), [], `${distribution} must not report a false capacity shortfall across the route transition`);
    const transitionExact = createTextCompositionEngine(distributionTransitionLayout, {
      maxPlanningIterations: 2,
      searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 },
    }).plan(transitionInsertionDocument, metrics);
    assert.equal(transitionExact.evaluation.status, 'accepted', `${distribution} exact planning must preserve insertion legality across the page-template transition: ${JSON.stringify(transitionExact.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })))}`);
    assert.equal(transitionExact.plan.insertionLines.length, 3, `${distribution} exact materialization must preserve all authored transition insertions`);
    if (distribution === 'spread-across-pages') {
      assert.deepEqual(orderedTransitionAssignments.map(({ page, slotId }) => [page, slotId]), [[1, 'quote-first'], [2, 'quote-second'], [2, 'quote-third']], 'spread-across-pages must use the later template slots when the first page reaches capacity');
    }
  }

  const legalPrefixLayout = {
    pageTemplates: [
      {
        id: 'prefix-page-one', width: 100, height: 120,
        slots: [
          { id: 'main', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
          { id: 'quote-only', regionId: 'body', flowId: 'quotes', kind: 'text', box: { x: 10, y: 20, width: 80, height: 15 }, allowedRoles: ['quote'], placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-through-content', rhythmGroup: 'heterogeneous' } },
        ],
      },
      {
        id: 'prefix-page-two', width: 100, height: 120,
        slots: [
          { id: 'main', regionId: 'body', kind: 'text', box: { x: 10, y: 10, width: 80, height: 100 } },
          { id: 'image-only', regionId: 'body', flowId: 'quotes', kind: 'block', box: { x: 10, y: 20, width: 80, height: 30 }, allowedRoles: ['image'], allowedBlockKinds: ['image'], placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 1, distribution: 'spread-through-content', rhythmGroup: 'heterogeneous' } },
        ],
      },
    ],
    pageTemplateAssignments: [
      { from: 1, to: 1, templateRef: 'prefix-one', pageTemplateId: 'prefix-page-one' },
      { from: 2, to: 2, templateRef: 'prefix-two', pageTemplateId: 'prefix-page-two' },
    ],
    routes: {
      main: { slots: ['main'], continuation: 'allowed' },
      quotes: { slots: ['quote-only', 'image-only'], insertionSlots: ['quote-only', 'image-only'], continuation: 'forbidden' },
    },
    maxPages: 2,
  };
  const legalPrefixDocument = {
    flows: {
      main: { blocks: [{ id: 'prefix-body', kind: 'paragraph', role: 'body', text: longText }] },
      quotes: { blocks: [
        { id: 'prefix-quote', kind: 'paragraph', role: 'quote', text: 'Legal first item.' },
        { id: 'blocked-image', kind: 'image', role: 'image', atomic: true },
      ] },
    },
  };
  const legalPrefixEstimate = estimateCoarseMainGeometry(legalPrefixDocument, metrics, legalPrefixLayout);
  const legalPrefixAssignments = assignCoarseInsertionProposals(legalPrefixDocument, metrics, legalPrefixLayout, legalPrefixEstimate, new Map());
  assert.deepEqual([...legalPrefixAssignments].map(([key, proposal]) => [key, proposal.page, proposal.slotId]), [['quotes:prefix-quote', 1, 'quote-only']], 'a blocked heterogeneous suffix must not discard the already assigned legal prefix');
  assert.deepEqual(unassignedCoarseInsertionItems(legalPrefixDocument, legalPrefixLayout, legalPrefixAssignments, legalPrefixEstimate).map(({ blockId, reason, legalCandidateCount }) => ({ blockId, reason, legalCandidateCount })), [{ blockId: 'blocked-image', reason: 'continuation-policy-conflict', legalCandidateCount: 1 }], 'the heterogeneous suffix must retain a precise continuation-policy capacity explanation');
  const exactFivePageResult = createTextCompositionEngine(insertionLayout, { maxPlanningIterations: 2, searchBudget: { maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }).plan(quotesOverFivePages, metrics);
  const exactFivePageCoarseDecision = exactFivePageResult.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
  const assignmentSearch = exactFivePageCoarseDecision?.assignmentSearch;
  assert.ok(assignmentSearch && Number.isInteger(assignmentSearch.expandedStates) && Number.isInteger(assignmentSearch.completeLayoutsCompared),
    'public baseline diagnostics must expose whole-layout search counts');
  assert.equal(assignmentSearch.beamWidth, readRenderConfig().compositionSearch.coarseAssignmentBeamWidth, 'the search bound must come from shared YAML configuration');
  assert.ok(assignmentSearch.completeLayoutsCompared <= assignmentSearch.beamWidth, 'retained complete layouts must remain within the configured bound');
  assert.ok(assignmentSearch.prunedStates > 0 && assignmentSearch.exhaustive === false, 'a bounded search must disclose discarded alternatives rather than claiming a proven global optimum');
  assert.ok(assignmentSearch.targets.every(({ targetProgress, actualProgress, contentProgress, visualLoad }) =>
    [targetProgress, actualProgress, contentProgress, visualLoad].every(Number.isFinite)), 'selected targets must expose measured progress and visual mass');
  assert.equal(exactFivePageCoarseDecision?.baselineExactMaterializationCount, 2, 'the bounded five-page baseline should expose its initial and stabilization materializations separately from candidate evaluation');
  assert.ok((exactFivePageCoarseDecision?.exactAssignmentMismatchCount ?? 0) > 0, 'the fixture must expose and retain exact stabilization proposals that would otherwise discard the coarse global distribution');
  assert.ok(!exactFivePageResult.plan.diagnostics.some(({ code }) => code === 'PLANNER_DID_NOT_STABILIZE'), 'the five-page baseline fixture must reach exact stabilization within its bound');
  assert.equal(exactFivePageResult.plan.trace?.candidateSearch?.fullPlanRecalculations, 1, 'the engine should evaluate the one materialized five-page baseline exactly once');
  const exactTwoQuotePages = new Map((exactFivePageResult.plan.insertionLines ?? []).map((line) => [line.blockId, line.page]));
  assert.equal(exactTwoQuotePages.size, 2, `the exact plan must preserve both authored quotes: ${JSON.stringify({ status: exactFivePageResult.evaluation.status, diagnostics: exactFivePageResult.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })), quotePages: [...exactTwoQuotePages] })}`);
  assert.equal(new Set(exactTwoQuotePages.values()).size, 2, `exact quotes must be spread over distinct main-flow pages: ${JSON.stringify([...exactTwoQuotePages])}`);
  assert.deepEqual([...exactTwoQuotePages].sort(([left], [right]) => left.localeCompare(right)), [...distributedTwoQuotes].map(([key, proposal]) => [key.slice('quotes:'.length), proposal.page]).sort(([left], [right]) => left.localeCompare(right)), 'exact materialization must preserve the coarse progress assignments for both five-page quotes');
  const selectedFivePagePlan = exactFivePageResult.plan;
  const selectedQuoteOne = selectedFivePagePlan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:quote-1');
  const selectedQuoteTwo = selectedFivePagePlan.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:quote-2');
  assert.ok(selectedQuoteOne && selectedQuoteTwo, 'repair audit needs the selected coarse-seeded insertion frames');
  const selectedPlacementIdentity = (plan, graphicId) => {
    const placement = plan.graphicPlacements.find((candidate) => candidate.graphicId === graphicId);
    assert.ok(placement, `repair candidate must retain ${graphicId}`);
    return { page: placement.page, slotId: placement.slotId };
  };
  const correctionIncumbent = structuredClone(selectedFivePagePlan);
  const incumbentQuoteTwo = correctionIncumbent.graphicPlacements.find(({ graphicId }) => graphicId === 'insertion:quote-2');
  assert.ok(incumbentQuoteTwo, 'the correction incumbent fixture needs the second selected insertion');
  const alternativeSelectedSlot = correctionIncumbent.slots.find((slot) => slot.flowId === 'quotes' && slot.page !== incumbentQuoteTwo.page);
  assert.ok(alternativeSelectedSlot, 'the correction incumbent fixture needs another page-local quote capability');
  incumbentQuoteTwo.page = alternativeSelectedSlot.page;
  incumbentQuoteTwo.slotId = alternativeSelectedSlot.id;
  incumbentQuoteTwo.box = { ...alternativeSelectedSlot.box };

  const correctionPlanner = createTextCompositionPlanner(insertionLayout, { maxPlanningIterations: 2 });
  const correctionRecords = correctionPlanner.planLegalityCorrectionsWithSignatures(
    quotesOverFivePages,
    metrics,
    correctionIncumbent,
    { status: 'rejected', hardViolations: [{ code: 'INSERTION_OVERFLOW', flowId: 'quotes', blockId: 'quote-1' }] },
    1,
    4,
  );
  assert.ok(correctionRecords.length > 0, 'a hard insertion diagnostic with an available alternative must generate a bounded exact correction');
  assert.ok(correctionRecords.every(({ repairProposalIds }) => repairProposalIds?.includes('legality:insertion-correction:quotes:quote-1')), 'every legality correction must name the affected coarse-seeded insertion');
  assert.ok(correctionRecords.every(({ plan }) => {
    assert.deepEqual(selectedPlacementIdentity(plan, 'insertion:quote-2'), selectedPlacementIdentity(correctionIncumbent, 'insertion:quote-2'));
    return true;
  }), 'legality correction must preserve an unrelated placement changed from the original coarse assignment');

  const refinementBounds = { x: 10, y: 10, width: 80, height: 100 };
  const refinementPlanner = createTextCompositionPlanner(insertionLayout, {
    maxPlanningIterations: 2,
    movableInsertionBounds: { 'quotes:quote-1': { bounds: refinementBounds, candidateCount: 1, refinementRounds: 1 } },
    searchBudget: { maxCandidatesPerRefinement: 4, maxRefinementRounds: 1 },
  });
  const moveRepair = {
    id: 'coarse-incumbent-move',
    placement: { id: selectedQuoteOne.id, kind: 'graphic', page: selectedQuoteOne.page, flowId: 'quotes', blockId: 'quote-1', slotId: selectedQuoteOne.slotId, graphicId: selectedQuoteOne.graphicId },
    action: 'move', axis: 'y', direction: 'down', distance: 1,
    sourceCode: 'coarse-incumbent-fixture', estimatedPoints: 1, estimateKind: 'local-geometry',
    legalCapability: 'declared-movable-frame', legalBounds: refinementBounds,
  };
  const refinementIncumbent = structuredClone(correctionIncumbent);
  const refinementRecords = refinementPlanner.planQualityRepairsWithSignatures(
    quotesOverFivePages,
    metrics,
    refinementIncumbent,
    { repairProposals: [moveRepair] },
    1,
    4,
  );
  const movedSelectedIncumbent = refinementRecords.find(({ repairProposalIds }) => repairProposalIds?.includes(moveRepair.id));
  assert.ok(movedSelectedIncumbent, 'the evaluator-directed movement must materialize from the selected coarse-seeded incumbent');
  assert.deepEqual(selectedPlacementIdentity(movedSelectedIncumbent.plan, 'insertion:quote-1'), selectedPlacementIdentity(refinementIncumbent, 'insertion:quote-1'), 'same-frame refinement must preserve the moved insertion page and slot');
  assert.deepEqual(selectedPlacementIdentity(movedSelectedIncumbent.plan, 'insertion:quote-2'), selectedPlacementIdentity(refinementIncumbent, 'insertion:quote-2'), 'evaluator-directed repair must preserve unrelated selected page/slot assignments');
  assert.ok(refinementRecords.every(({ plan }) => JSON.stringify(selectedPlacementIdentity(plan, 'insertion:quote-2')) === JSON.stringify(selectedPlacementIdentity(refinementIncumbent, 'insertion:quote-2'))), 'configured local refinements must also preserve unrelated selected placements instead of restoring the coarse seed');

  const legacyFivePageRecords = createTextCompositionPlanner(insertionLayout, { maxPlanningIterations: 2, searchBudget: { maxInitialCandidates: 1 } })
    .planCandidatesWithSignatures(quotesOverFivePages, metrics);
  assert.equal(legacyFivePageRecords.length, 2, 'the frozen legacy five-page baseline should materialize two stabilized exact candidates when bounded to one insertion seed');
  const legacyFivePagePlan = legacyFivePageRecords.at(-1)?.plan;
  assert.equal(legacyFivePagePlan?.decisions.find(({ code }) => code === 'PLANNER_STABILIZED')?.iteration, 2, 'the legacy five-page fixture must include its bounded stabilization pass');
  assert.ok(!legacyFivePagePlan?.diagnostics.some(({ code }) => code === 'PLANNER_DID_NOT_STABILIZE'), 'the legacy five-page fixture must stabilize within its bound');
  const legacyFivePageAssignments = new Map((legacyFivePagePlan?.insertionLines ?? []).map((line) => [line.blockId, line.page]));
  assert.equal(legacyFivePageAssignments.size, 2, 'the frozen legacy exact path must retain both five-page quotes for comparison');
  assert.equal(new Set(legacyFivePageAssignments.values()).size, 1, `the stabilized legacy baseline clusters the two quotes on one page: ${JSON.stringify([...legacyFivePageAssignments])}`);
  assert.equal(new Set(exactTwoQuotePages.values()).size, 2, 'coarse-first exact planning should distribute the two quotes across distinct pages of the five-page body');

  console.log(JSON.stringify({ status: 'passed', twoPageTerminal: twoPageEstimate.terminalPage, fivePageTerminal: fivePageEstimate.terminalPage, overflowWords: fivePageEstimate.unplacedWordCount, introPageCapacities: [...introEstimate.mainProgressByPage.values()].map(({ page, occupiedHeight, capacityHeight }) => ({ page, occupiedHeight, capacityHeight })), exactCalibration: { terminalPage: exactComparison.exactMainTerminalPage, words: exactComparison.exactTextWordCount, pages: exactComparison.pages.length }, textPredictionCalibration, coarseVsRollback: { exactBodyTerminalPage, coarseInsertionPage: coarseQuotePlacement.page, legacyInsertionOnlyPage: rollbackQuotePlacement.page, coarseExactScore: orphanExactEvaluation.score, legacyExactScore: rollbackEvaluation.score, coarsePenalties: orphanExactEvaluation.scoreBreakdown.filter(({ points }) => points < 0).map(({ code, points }) => ({ code, points })), legacyPenalties: rollbackEvaluation.scoreBreakdown.filter(({ points }) => points < 0).map(({ code, points }) => ({ code, points })), legacyInsertionOnlyEmptyRegionCount: legacyEmptyRegions?.value, coarseEvaluatedCandidates: orphanExactResult.plan.trace?.candidateSearch?.fullPlanRecalculations, legacyEvaluatedCandidates: rollbackResult.plan.trace?.candidateSearch?.fullPlanRecalculations, insertionProjection: { estimatedTerminalPage: orphanProjectionComparison.estimatedTerminalPage, exactTerminalPage: orphanProjectionComparison.exactMainTerminalPage, absolutePerPageMassError: orphanProjectionComparison.pages.reduce((sum, page) => sum + Math.abs(page.estimatedMassUnits - page.exactTextWords), 0) } }, legacyAssignments: { fiveQuotes: [...new Set(legacyTwoPageAssignments.values())], twoQuotes: [...new Set(legacyFivePageAssignments.values())], materializedExactCandidates: legacyFivePageRecords.length }, fiveQuotesAssignedPages: [...new Set([...groupedQuotes.values()].map((proposal) => proposal.page))], exactFiveQuotePages: [...new Set(exactQuotePages.values())], twoQuotesAssignedPages: [...new Set([...distributedTwoQuotes.values()].map((proposal) => proposal.page))], exactTwoQuotePages: [...new Set(exactTwoQuotePages.values())], exactBaseline: { twoPageMaterializations: exactTwoPageCoarseDecision?.baselineExactMaterializationCount, fivePageMaterializations: exactFivePageCoarseDecision?.baselineExactMaterializationCount, fivePageAssignmentMismatchesRetained: exactFivePageCoarseDecision?.exactAssignmentMismatchCount, fullPlanEvaluations: exactFivePageResult.plan.trace?.candidateSearch?.fullPlanRecalculations }, constrainedAssignments: constrainedAssignments.size, constrainedUnassigned: constrainedGaps.length, mixedLoadAssignments: [...mixedLoadAssignments].map(([key, proposal]) => ({ key, page: proposal.page, height: proposal.box.height })) }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
