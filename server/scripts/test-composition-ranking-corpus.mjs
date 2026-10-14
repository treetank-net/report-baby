#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { rankingFixtureBuilders } from './lib/composition-ranking-fixtures.mjs';

const corpusPath = join(process.cwd(), 'scripts/fixtures/composition-ranking-corpus.yml');
const corpus = parse(await readFile(corpusPath, 'utf8'));
assert.ok(Array.isArray(corpus) && corpus.length >= 4, 'ranking corpus must contain the reviewed calibration families');
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-ranking-corpus-'));
const bundlePath = join(temporary, 'composition.cjs');
const spacingBundlePath = join(temporary, 'spacing-report.cjs');
await build({ entryPoints: [join(process.cwd(), 'src/composition/index.ts')], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: bundlePath });
await build({ entryPoints: [join(process.cwd(), 'src/composition/observability/spacing-report.ts')], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: spacingBundlePath });
const composition = await import(bundlePath);
const spacing = await import(spacingBundlePath);
const { compareCompositionEvaluations, createCompositionEngine, createTextCompositionEngine, createTextCompositionPlanner, evaluateCompositionPlan } = composition;
const attachPlanSpacingReport = spacing.attachPlanSpacingReport ?? spacing.default.attachPlanSpacingReport;
const builders = rankingFixtureBuilders();
const document = { flows: { main: { id: 'main', continuation: 'forbidden', blocks: [] } } };
const evaluated = new Map();
const oracleEvidence = [];

function reachabilityMetrics() {
  return {
    units: 'mm',
    measureText(text) { return text.length; },
    lineHeight() { return 5; },
    textPadding() { return { top: 0, bottom: 0 }; },
    textMargins() { return { before: 0, after: 0 }; },
  };
}

function reachabilityGeometry(height = 120) {
  return {
    width: 100,
    height,
    margin: 5,
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
    columns: { count: 2, gutter: 10, widths: [40, 40] },
    content: { x: 5, top: 5, width: 90, bottom: height - 5 },
    segments: [{ x: 5, top: 5, width: 40, bottom: height - 5 }, { x: 55, top: 5, width: 40, bottom: height - 5 }],
    bands: {},
    flowObstacles: [],
    blockFrames: {},
    flow: { align: 'left', hyphenate: false },
    dynamicFlow: false,
  };
}

function movableQuoteReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-quote', width: 100, height: 120, slots: [
      { id: 'left', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 110 }, allowedRoles: ['body'] },
      { id: 'right', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 110 }, allowedRoles: ['body'] },
      { id: 'quote-a', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 30, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
      { id: 'quote-b', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 80, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
    ] }],
    routes: {
      main: { slots: ['left', 'right'], continuation: 'forbidden' },
      quotes: { slots: ['quote-a', 'quote-b'], insertionSlots: ['quote-a', 'quote-b'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Main text '.repeat(45) }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [
        { id: 'quote-a', kind: 'paragraph', role: 'quote', text: 'First quote keeps the surrounding rhythm.' },
        { id: 'quote-b', kind: 'paragraph', role: 'quote', text: 'Second quote keeps the surrounding rhythm.' },
      ] },
    },
  };
  const policy = {
    maxPlanningIterations: 2,
    coarseExactCandidateCount: 1,
    movableInsertionBounds: {
      'quotes:quote-a': { bounds: { x: 5, y: 20, width: 90, height: 50 }, axis: 'y', candidateCount: 3, refinementRounds: 1, refinementCandidateCount: 2 },
      'quotes:quote-b': { bounds: { x: 5, y: 50, width: 90, height: 55 }, axis: 'y', candidateCount: 3, refinementRounds: 1, refinementCandidateCount: 2 },
    },
  };
  const metrics = reachabilityMetrics();
  const geometry = reachabilityGeometry();
  const engine = createTextCompositionEngine(template, policy, {
    beforeEvaluate(_input, plan) { attachPlanSpacingReport(plan, document, metrics, geometry); },
  });
  const result = engine.plan(document, metrics);
  const baseline = result.plan.trace?.candidateSearch?.rounds?.[0];
  const rounds = result.plan.trace?.candidateSearch?.rounds ?? [];
  const selected = result.plan.graphicPlacements
    .filter((placement) => placement.graphicId.startsWith('insertion:'))
    .sort((left, right) => left.box.y - right.box.y)
    .map((placement) => ({ blockId: placement.graphicId.slice('insertion:'.length), y: placement.box.y }));
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(baseline?.uniqueCandidates, 1, 'reachability must start from one baseline');
  assert.ok((result.plan.trace?.candidateSearch?.evaluatedCandidates ?? 0) > 1, 'reachability must evaluate at least one complete repair candidate');
  const pageRound = rounds.find((round) => round.scope?.kind === 'page' && round.scope.page === 1);
  assert.ok(pageRound, 'stage G must record a page-local refinement pass');
  assert.ok((pageRound?.generatedCandidates ?? 0) > 0, 'the real text planner must materialize a scoped page repair candidate');
  assert.equal(selected.length, 2, 'reachability must preserve both authored quote blocks');
  assert.ok(
    selected[0].y > 30 || selected[1].y < 80,
    `planner must reach a better insertion neighborhood: ${JSON.stringify({
      selected,
      score: result.evaluation.score,
      baselineScore: baseline?.bestScore,
      evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    })}`,
  );
  assert.ok(result.evaluation.score > (baseline?.bestScore ?? result.evaluation.score), 'reachable repair must improve the baseline score');
  return {
    case: 'quote-movement-improves-distribution',
    corpusCase: 'quote-movement-avoids-orphan',
    status: result.evaluation.status,
    score: result.evaluation.score,
    baselineScore: result.plan.trace?.candidateSearch?.rounds?.[0]?.bestScore,
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    selected,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

function pageLocalRefinementReachability() {
  const planFor = (state) => ({
    marker: state,
    pages: [{ page: 1, pageTemplateId: 'page-local', width: 100, height: 100 }, { page: 2, pageTemplateId: 'page-local', width: 100, height: 100 }],
    slots: [],
    placements: [],
    blockPlacements: [],
    tablePlacements: [],
    graphicPlacements: [
      { id: 'g1', graphicId: 'g1', page: 1, slotId: '1:graphic', box: { x: 10, y: 10, width: 20, height: 20 } },
      { id: 'g2', graphicId: 'g2', page: 2, slotId: '2:graphic', box: { x: 10, y: 10, width: 20, height: 20 } },
    ],
    lines: [],
    decisions: [],
    diagnostics: [],
    residualContent: [],
    trace: { phases: [], blocks: [], slots: [] },
  });
  const proposalFor = (graphicId, page) => ({
    id: `page-local:${graphicId}`,
    placement: { id: graphicId, kind: 'graphic', page, graphicId },
    action: 'move',
    axis: 'y',
    direction: 'down',
    distance: 1,
    sourceCode: 'page-local-fixture',
    estimatedPoints: 1,
    estimateKind: 'local-geometry',
    legalCapability: 'declared-movable-frame',
    legalBounds: { x: 10, y: 10, width: 20, height: 30 },
  });
  const scopes = [];
  const planner = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 0, maxCandidatesPerRefinement: 2, maxFullPlanRecalculations: 5, maxPageLocalRefinementRounds: 1 },
    candidateRefinementRounds: 0,
    planBaselineWithSignature() { return { signature: 'baseline', plan: planFor('baseline') }; },
    plan() { return planFor('baseline'); },
    planQualityRepairsWithSignatures(_document, _metrics, _selected, _evaluation, _round, _remaining, scope) {
      scopes.push(scope);
      if (scope?.kind !== 'page') return [];
      const page = scope.page;
      const marker = `page-${page}`;
      const graphicId = `g${page}`;
      return [{
        signature: marker,
        repairProposalIds: [`page-local:${graphicId}`],
        plan: planFor(marker),
      }];
    },
  };
  const evaluator = {
    evaluate(_document, plan) {
      const page = plan.marker === 'page-1' ? 1 : plan.marker === 'page-2' ? 2 : undefined;
      return {
        status: 'accepted',
        diagnostics: [],
        hardViolations: [],
        score: page ?? 0,
        scoreBase: 0,
        scoreBreakdown: [],
        placementScores: [],
        ...(page === undefined ? { repairProposals: [proposalFor('g1', 1), proposalFor('g2', 2)] } : {}),
        passedMetrics: [],
        residualContent: [],
      };
    },
  };
  const result = createCompositionEngine(planner, evaluator).plan(document, reachabilityMetrics());
  assert.deepEqual(scopes, [{ kind: 'page', page: 1 }, { kind: 'page', page: 2 }], 'stage G must process pages in order from the carried incumbent');
  assert.equal(result.plan.marker, 'page-2', 'the next page must start from the accepted complete incumbent');
  assert.equal(result.evaluation.score, 2);

  const rejectedScopes = [];
  const rejectingPlanner = {
    ...planner,
    planQualityRepairsWithSignatures(_document, _metrics, _selected, _evaluation, _round, _remaining, scope) {
      rejectedScopes.push(scope);
      return scope?.kind === 'page' && scope.page === 1
        ? [{ signature: 'illegal-page-1', repairProposalIds: ['page-local:g1'], plan: planFor('illegal-page-1') }]
        : [];
    },
  };
  const rejectingEvaluator = {
    evaluate(_document, plan) {
      if (plan.marker === 'illegal-page-1') {
        return {
          status: 'rejected',
          diagnostics: [{ severity: 'error', code: 'LATER_PAGE_OVERFLOW', message: 'Page 2 became illegal after page 1 reflow.', page: 2 }],
          hardViolations: [{ severity: 'error', code: 'LATER_PAGE_OVERFLOW', message: 'Page 2 became illegal after page 1 reflow.', page: 2 }],
          score: 0,
          scoreBreakdown: [],
          placementScores: [],
          passedMetrics: [],
          residualContent: [],
        };
      }
      return evaluator.evaluate(_document, plan);
    },
  };
  const rejected = createCompositionEngine(rejectingPlanner, rejectingEvaluator).plan(document, reachabilityMetrics());
  assert.deepEqual(rejectedScopes, [{ kind: 'page', page: 1 }, { kind: 'page', page: 2 }], 'later pages must still be visited after a rejected local candidate');
  assert.equal(rejected.plan.marker, 'baseline', 'an illegal full reflow must never replace the incumbent');
  assert.ok(rejected.plan.trace?.candidateSearch?.rounds.some((round) => round.scope?.kind === 'page' && round.candidateResults?.some((candidate) => candidate.legal === false)), 'the trace must expose the rejected complete page candidate');
  return {
    case: 'page-local-refinement-preserves-full-plan-legality',
    status: result.evaluation.status,
    scopes,
    rejectedScopes,
    selectedMarker: result.plan.marker,
    rejectedMarker: rejected.plan.marker,
  };
}

function coupledMoveReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'coupled-repair', width: 100, height: 120, slots: [
      { id: 'left', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 110 }, allowedRoles: ['body'] },
      { id: 'right', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 110 }, allowedRoles: ['body'] },
      { id: 'quote-a', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 30, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
      { id: 'quote-b', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 80, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
    ] }],
    routes: {
      main: { slots: ['left', 'right'], continuation: 'forbidden' },
      quotes: { slots: ['quote-a', 'quote-b'], insertionSlots: ['quote-a', 'quote-b'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Main text '.repeat(45) }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [
        { id: 'quote-a', kind: 'paragraph', role: 'quote', text: 'First coupled repair quote.' },
        { id: 'quote-b', kind: 'paragraph', role: 'quote', text: 'Second coupled repair quote.' },
      ] },
    },
  };
  const policy = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 8, maxFullPlanRecalculations: 8, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
    movableInsertionBounds: {
      'quotes:quote-a': { bounds: { x: 5, y: 20, width: 90, height: 50 }, axis: 'y', candidateCount: 1, refinementRounds: 0 },
      'quotes:quote-b': { bounds: { x: 5, y: 50, width: 90, height: 55 }, axis: 'y', candidateCount: 1, refinementRounds: 0 },
    },
  };
  const planner = createTextCompositionPlanner(template, policy);
  let baselinePositions;
  const score = (plan) => {
    const positions = Object.fromEntries(['quote-a', 'quote-b'].map((blockId) => [
      blockId,
      plan.graphicPlacements.find((placement) => placement.graphicId === `insertion:${blockId}`)?.box.y,
    ]));
    baselinePositions ??= positions;
    const movedA = positions['quote-a'] !== baselinePositions['quote-a'];
    const movedB = positions['quote-b'] !== baselinePositions['quote-b'];
    return movedA && movedB ? 10 : movedA || movedB ? -1 : 0;
  };
  const evaluator = {
    evaluate(_input, plan) {
      const repairProposals = ['quote-a', 'quote-b'].map((blockId) => {
        const placement = plan.graphicPlacements.find((candidate) => candidate.graphicId === `insertion:${blockId}`);
        assert.ok(placement, `coupled fixture must place ${blockId}`);
        return {
          id: `coupled-move:${blockId}`,
          placement: { id: placement.id, kind: 'graphic', page: placement.page, flowId: 'quotes', blockId, slotId: placement.slotId, graphicId: placement.graphicId },
          action: 'move',
          axis: 'y',
          direction: blockId === 'quote-a' ? 'down' : 'up',
          distance: 10,
          sourceCode: 'coupled-fixture',
          estimatedPoints: 1,
          estimateKind: 'local-geometry',
          legalCapability: 'declared-movable-frame',
          legalBounds: policy.movableInsertionBounds[`quotes:${blockId}`].bounds,
        };
      });
      const isBaseline = score(plan) === 0 && plan.graphicPlacements.every((placement) => {
        if (!placement.graphicId.startsWith('insertion:')) return true;
        return placement.box.y === baselinePositions[placement.graphicId.slice('insertion:'.length)];
      });
      return {
        status: 'accepted',
        diagnostics: [],
        hardViolations: [],
        score: score(plan),
        scoreBase: 0,
        scoreBreakdown: [],
        placementScores: [],
        ...(isBaseline ? { repairProposals } : {}),
        passedMetrics: [],
        residualContent: [],
      };
    },
  };
  const result = createCompositionEngine(planner, evaluator).plan(document, reachabilityMetrics());
  const rounds = result.plan.trace?.candidateSearch?.rounds ?? [];
  const candidateResults = rounds.flatMap((round) => round.candidateResults ?? []);
  const coupledCandidate = candidateResults.find((candidate) => (candidate.repairProposalIds?.length ?? 0) === 2);
  assert.equal(result.evaluation.status, 'accepted');
  assert.equal(result.evaluation.score, 10, JSON.stringify({ result: result.evaluation, rounds }));
  assert.ok((result.plan.trace?.candidateSearch?.evaluatedCandidates ?? 0) <= policy.searchBudget.maxFullPlanRecalculations, 'coupled repairs must remain inside the complete-plan budget');
  assert.ok(coupledCandidate, `planner must materialize a coupled repair candidate: ${JSON.stringify({ rounds })}`);
  assert.ok(candidateResults.some((candidate) => candidate.score === -1), 'coupled fixture must prove that each single repair is insufficient');
  return {
    case: 'coupled-move-beats-single-repairs',
    status: result.evaluation.status,
    score: result.evaluation.score,
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    coupledProposalIds: coupledCandidate?.repairProposalIds,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

function productionCoupledMoveReachability() {
  const yA = 20;
  const yB = 45;
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'production-coupled', width: 100, height: 180, slots: [
      { id: 'left', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 170 }, allowedRoles: ['body'] },
      { id: 'right', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 170 }, allowedRoles: ['body'] },
      { id: 'quote-a', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: yA, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
      { id: 'quote-b', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: yB, width: 90, height: 10 }, allowedRoles: ['quote'], fitContent: true },
    ] }],
    routes: {
      main: { slots: ['left', 'right'], continuation: 'forbidden' },
      quotes: { slots: ['quote-a', 'quote-b'], insertionSlots: ['quote-a', 'quote-b'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Main text '.repeat(65) }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [
        { id: 'quote-a', kind: 'paragraph', role: 'quote', text: 'First quote keeps the surrounding rhythm.' },
        { id: 'quote-b', kind: 'paragraph', role: 'quote', text: 'Second quote keeps the surrounding rhythm.' },
      ] },
    },
  };
  const policy = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 8, maxFullPlanRecalculations: 8, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
    movableInsertionBounds: {
      'quotes:quote-a': { bounds: { x: 5, y: 15, width: 90, height: 75 }, axis: 'y', candidateCount: 3, refinementRounds: 1, refinementCandidateCount: 3 },
      'quotes:quote-b': { bounds: { x: 5, y: 35, width: 90, height: 125 }, axis: 'y', candidateCount: 3, refinementRounds: 1, refinementCandidateCount: 3 },
    },
  };
  const metrics = reachabilityMetrics();
  const geometry = reachabilityGeometry(180);
  const engine = createTextCompositionEngine(template, policy, {
    beforeEvaluate(_input, plan) { attachPlanSpacingReport(plan, document, metrics, geometry); },
  });
  const result = engine.plan(document, metrics);
  const rounds = result.plan.trace?.candidateSearch?.rounds ?? [];
  const candidateResults = rounds.flatMap((round) => round.candidateResults ?? []);
  const pair = candidateResults.find((candidate) => (candidate.repairProposalIds?.length ?? 0) > 1);
  const singles = candidateResults.filter((candidate) => (candidate.repairProposalIds?.length ?? 0) === 1);
  const baselineScore = rounds[0]?.bestScore;
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify({ evaluation: result.evaluation, rounds }));
  assert.equal(baselineScore, 63, `the natural terminal-column exemption must preserve the coupled fixture baseline: ${JSON.stringify({ baselineScore, rounds })}`);
  assert.equal(result.evaluation.score, 83, `the natural terminal-column exemption must preserve the coupled fixture winner: ${JSON.stringify({ score: result.evaluation.score, rounds })}`);
  assert.ok(pair && pair.score === 83, `production evaluator must expose the coupled winner: ${JSON.stringify({ pair, rounds })}`);
  assert.ok(singles.length > 0 && singles.every((candidate) => (candidate.score ?? Number.NEGATIVE_INFINITY) < pair.score), `each individual production repair must remain below the pair: ${JSON.stringify({ singles, pair })}`);
  assert.ok((result.plan.trace?.candidateSearch?.evaluatedCandidates ?? 0) <= policy.searchBudget.maxFullPlanRecalculations, 'production coupled repairs must remain inside the complete-plan budget');
  return {
    case: 'production-coupled-distribution-repair',
    corpusCase: 'conflicting-insertion-rhythm',
    status: result.evaluation.status,
    baselineScore,
    score: result.evaluation.score,
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    coupledProposalIds: pair?.repairProposalIds,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

function stableTieReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-tie', width: 100, height: 120, slots: [
      { id: 'body', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 110 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 30, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['body'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'tie-body', kind: 'paragraph', role: 'body', text: 'Tie body.' }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'tie-quote', kind: 'paragraph', role: 'quote', text: 'Tie quote.' }] },
    },
  };
  const policy = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 2, maxFullPlanRecalculations: 2, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
    movableInsertionBounds: {
      'quotes:tie-quote': { bounds: { x: 5, y: 20, width: 90, height: 50 }, axis: 'y', candidateCount: 1, refinementRounds: 1, refinementCandidateCount: 1 },
    },
  };
  const planner = createTextCompositionPlanner(template, policy);
  const evaluator = {
    evaluate(_input, plan) {
      const placement = plan.graphicPlacements.find((candidate) => candidate.graphicId === 'insertion:tie-quote');
      assert.ok(placement, 'tie fixture must place its insertion');
      const baseline = placement.box.y === 30;
      return {
        status: 'accepted',
        diagnostics: [],
        hardViolations: [],
        score: 100,
        scoreBase: 100,
        scoreBreakdown: [],
        placementScores: [],
        ...(baseline ? { repairProposals: [{
          id: 'tie-move',
          placement: { id: placement.id, kind: 'graphic', page: placement.page, flowId: 'quotes', blockId: 'tie-quote', slotId: placement.slotId, graphicId: placement.graphicId },
          action: 'move',
          axis: 'y',
          direction: 'down',
          distance: 10,
          sourceCode: 'tie-fixture',
          estimatedPoints: 0,
          estimateKind: 'local-geometry',
          legalCapability: 'declared-movable-frame',
          legalBounds: policy.movableInsertionBounds['quotes:tie-quote'].bounds,
        }] } : {}),
        passedMetrics: [],
        residualContent: [],
      };
    },
  };
  const result = createCompositionEngine(planner, evaluator).plan(document, reachabilityMetrics());
  const search = result.plan.trace?.candidateSearch;
  assert.equal(result.evaluation.status, 'accepted');
  assert.equal(result.evaluation.score, 100);
  assert.equal(search?.selectedCandidate, 0, `equal-score refinement must preserve the baseline: ${JSON.stringify(search)}`);
  assert.ok((search?.evaluatedCandidates ?? 0) > 1, 'tie fixture must evaluate the equal-score alternative');
  return {
    case: 'stable-order-preserves-equal-score-baseline',
    corpusCase: 'exact-tie-stable-order',
    status: result.evaluation.status,
    score: result.evaluation.score,
    evaluatedCandidates: search?.evaluatedCandidates,
    selectedCandidate: search?.selectedCandidate,
    stopReason: search?.stopReason,
  };
}

function legalFirstReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-legality-precedence', width: 100, height: 120, slots: [
      { id: 'body', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 110 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 30, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['body'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'precedence-body', kind: 'paragraph', role: 'body', text: 'Precedence body.' }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'precedence-quote', kind: 'paragraph', role: 'quote', text: 'An attractive but illegal alternative.' }] },
    },
  };
  const policy = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 2, maxFullPlanRecalculations: 2, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
    movableInsertionBounds: {
      'quotes:precedence-quote': { bounds: { x: 5, y: 20, width: 90, height: 50 }, axis: 'y', candidateCount: 1, refinementRounds: 1, refinementCandidateCount: 1 },
    },
  };
  const planner = createTextCompositionPlanner(template, policy);
  const evaluator = {
    evaluate(_input, plan) {
      const placement = plan.graphicPlacements.find((candidate) => candidate.graphicId === 'insertion:precedence-quote');
      assert.ok(placement, 'legal-first fixture must place its insertion');
      const baseline = placement.box.y === 30;
      return baseline ? {
        status: 'accepted',
        diagnostics: [],
        hardViolations: [],
        score: 100,
        scoreBase: 100,
        scoreBreakdown: [],
        placementScores: [],
        repairProposals: [{
          id: 'attractive-illegal-move',
          placement: { id: placement.id, kind: 'graphic', page: placement.page, flowId: 'quotes', blockId: 'precedence-quote', slotId: placement.slotId, graphicId: placement.graphicId },
          action: 'move',
          axis: 'y',
          direction: 'down',
          distance: 10,
          sourceCode: 'legality-precedence-fixture',
          estimatedPoints: 100,
          estimateKind: 'local-geometry',
          legalCapability: 'declared-movable-frame',
          legalBounds: policy.movableInsertionBounds['quotes:precedence-quote'].bounds,
        }],
        passedMetrics: [],
        residualContent: [],
      } : {
        status: 'rejected',
        diagnostics: [{ severity: 'error', code: 'ATTRACTIVE_CANDIDATE_ILLEGAL', message: 'fixture alternative is illegal' }],
        hardViolations: [{ severity: 'error', code: 'ATTRACTIVE_CANDIDATE_ILLEGAL', message: 'fixture alternative is illegal' }],
        score: 1000,
        scoreBreakdown: [],
        passedMetrics: [],
        residualContent: [],
      };
    },
  };
  const result = createCompositionEngine(planner, evaluator).plan(document, reachabilityMetrics());
  const search = result.plan.trace?.candidateSearch;
  assert.equal(result.evaluation.status, 'accepted');
  assert.equal(result.evaluation.score, 100);
  assert.equal(search?.selectedCandidate, 0, `legal candidate must beat an attractive illegal alternative: ${JSON.stringify(search)}`);
  assert.ok((search?.evaluatedCandidates ?? 0) > 1, 'legal-first fixture must evaluate the attractive alternative');
  return {
    case: 'legal-first-rejects-attractive-illegal-alternative',
    corpusCase: 'illegal-aesthetic-candidate',
    status: result.evaluation.status,
    score: result.evaluation.score,
    evaluatedCandidates: search?.evaluatedCandidates,
    selectedCandidate: search?.selectedCandidate,
    stopReason: search?.stopReason,
  };
}

function movableGraphicReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-graphic', width: 100, height: 180, slots: [
      { id: 'left', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 80 }, allowedRoles: ['body'] },
      { id: 'right', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 80 }, allowedRoles: ['body'] },
      { id: 'graphic', regionId: 'art', kind: 'graphic', box: { x: 5, y: 35, width: 90, height: 15 } },
    ] }],
    routes: { main: { slots: ['left', 'right'], continuation: 'forbidden' } },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'graphic-body', kind: 'paragraph', role: 'body', text: 'Graphic balance text '.repeat(35) }] },
    },
    graphics: [{ id: 'ranking-graphic', slotId: 'graphic', shape: 'rectangle', wrap: 'around', page: 1, size: { width: 20, height: 10 } }],
  };
  const policy = {
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 8, maxFullPlanRecalculations: 8, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
    movableGraphicBounds: {
      'ranking-graphic': { bounds: { x: 5, y: 35, width: 90, height: 15 }, axis: 'x', candidateCount: 4, refinementRounds: 1, refinementCandidateCount: 3 },
    },
  };
  const engine = createTextCompositionEngine(template, policy);
  const result = engine.plan(document, reachabilityMetrics());
  const baseline = result.plan.trace?.candidateSearch?.rounds?.[0];
  const selected = result.plan.graphicPlacements.find((placement) => placement.graphicId === 'ranking-graphic');
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.ok((result.plan.trace?.candidateSearch?.evaluatedCandidates ?? 0) > 1, `graphic reachability must evaluate bounded movement candidates: ${JSON.stringify(result.plan.trace?.candidateSearch)}`);
  assert.ok(selected && selected.box.x > 5, `planner must reach a non-baseline graphic position: ${JSON.stringify({ selected, baseline: baseline?.bestScore, score: result.evaluation.score })}`);
  return {
    case: 'image-movement-improves-columns',
    corpusCase: 'image-balances-columns',
    status: result.evaluation.status,
    score: result.evaluation.score,
    baselineScore: baseline?.bestScore,
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    selected: selected ? { x: selected.box.x, y: selected.box.y } : undefined,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

function fitContentReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-fit-content', width: 100, height: 100, slots: [
      { id: 'body', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 90 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 40, width: 90, height: 30 }, allowedRoles: ['quote'], fitContent: true, grow: { axis: 'y', maxHeight: 40 } },
    ] }],
    routes: {
      main: { slots: ['body'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'fit-body', kind: 'paragraph', role: 'body', text: 'Fit content body '.repeat(30) }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'fit-quote', kind: 'paragraph', role: 'quote', text: 'A short fit-content quote.' }] },
    },
  };
  const result = createTextCompositionEngine(template).plan(document, reachabilityMetrics());
  const slot = result.plan.slots.find((candidate) => candidate.id === '1:quote');
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.ok(slot && slot.box.height < 30, `fit-content winner must shrink the authored envelope: ${JSON.stringify({ slot, score: result.evaluation.score })}`);
  return {
    case: 'fit-content-reaches-compact-envelope',
    corpusCase: 'fit-content-envelope-waste',
    status: result.evaluation.status,
    score: result.evaluation.score,
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    selected: slot ? { height: slot.box.height } : undefined,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

function insertionLegalityReachability() {
  const template = {
    maxPages: 1,
    pageTemplates: [{ id: 'ranking-legality', width: 100, height: 120, slots: [
      { id: 'body', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 110 }, allowedRoles: ['body'] },
      { id: 'undersized', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 20, width: 90, height: 2 }, allowedRoles: ['quote'] },
      { id: 'recoverable', regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 5, y: 60, width: 90, height: 45 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['body'], continuation: 'forbidden' },
      quotes: { slots: ['undersized', 'recoverable'], insertionSlots: ['undersized', 'recoverable'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'legality-body', kind: 'paragraph', role: 'body', text: 'Legality recovery body.' }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'recoverable-quote', kind: 'paragraph', role: 'quote', text: 'This authored insertion must use the later compatible slot after the first capability overflows.' }] },
    },
  };
  const policy = {
    maxPlanningIterations: 1,
    searchBudget: { maxInitialCandidates: 1, maxRefinementRounds: 1, maxCandidatesPerRefinement: 4, maxFullPlanRecalculations: 4, minimumGeometryStepMm: 1, movableRefinementRounds: 0 },
  };
  const engine = createTextCompositionEngine(template, policy);
  const result = engine.plan(document, reachabilityMetrics());
  const rounds = result.plan.trace?.candidateSearch?.rounds ?? [];
  const baseline = rounds[0];
  const selected = result.plan.insertionLines?.find((line) => line.blockId === 'recoverable-quote');
  assert.equal(baseline?.legalCandidates, 0, `legality fixture must start with an illegal baseline: ${JSON.stringify({ baseline, diagnostics: result.plan.diagnostics })}`);
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify({ evaluation: result.evaluation, rounds }));
  assert.equal(selected?.slotId, '1:recoverable', `legality recovery must select the later compatible slot: ${JSON.stringify({ selected, rounds })}`);
  assert.ok(rounds.some((round) => round.candidateResults?.some((candidate) => candidate.repairProposalIds?.some((id) => id.includes('legality:insertion-correction')))), 'legality recovery must expose the affected insertion correction in the search trace');
  return {
    case: 'illegal-insertion-recovers-to-compatible-slot',
    status: result.evaluation.status,
    score: result.evaluation.score,
    baselineDiagnostics: baseline?.candidateResults?.flatMap((candidate) => candidate.diagnostics?.map(({ code }) => code) ?? []) ?? [],
    evaluatedCandidates: result.plan.trace?.candidateSearch?.evaluatedCandidates,
    selected: selected ? { slotId: selected.slotId, page: selected.page } : undefined,
    stopReason: result.plan.trace?.candidateSearch?.stopReason,
  };
}

const reachabilityEvidence = [movableQuoteReachability(), pageLocalRefinementReachability(), coupledMoveReachability(), productionCoupledMoveReachability(), stableTieReachability(), legalFirstReachability(), movableGraphicReachability(), fitContentReachability(), insertionLegalityReachability()];
const coveredCorpusCases = new Set(reachabilityEvidence.flatMap(({ corpusCase }) => corpusCase ? [corpusCase] : []));
for (const entry of corpus) assert.ok(coveredCorpusCases.has(entry.id), `${entry.id}: ranking winner must have a planner-level reachability or precedence fixture`);
for (const entry of corpus) {
  assert.match(entry.id, /^[a-z0-9-]+$/u);
  assert.equal(entry.variants.length, entry.legal.length, `${entry.id}: each variant needs a legality expectation`);
  assert.ok(entry.order.every((variant) => entry.variants.includes(variant)), `${entry.id}: order must reference declared variants`);
  const legalVariants = entry.variants.filter((_variant, index) => entry.legal[index]);
  assert.deepEqual(new Set(entry.order), new Set(legalVariants), `${entry.id}: illegal candidates cannot appear in the approved order`);
  assert.ok(entry.reasons.length > 0, `${entry.id}: reviewed ranking needs explicit quality reasons`);
  const builder = builders[entry.fixture];
  assert.equal(typeof builder, 'function', `${entry.id}: fixture builder must exist`);
  const variants = builder();
  const evaluations = entry.variants.map((variant, index) => {
    const plan = variants[variant];
    assert.ok(plan, `${entry.id}: fixture is missing variant '${variant}'`);
    const evaluation = evaluateCompositionPlan(document, plan);
    if (!entry.legal[index]) assert.equal(evaluation.status, 'rejected', `${entry.id}/${variant}: illegal fixture must be rejected`);
    if (entry.legal[index]) assert.notEqual(evaluation.status, 'rejected', `${entry.id}/${variant}: legal fixture must be accepted`);
    evaluated.set(`${entry.id}/${variant}`, evaluation);
    return evaluation;
  });
  for (let index = 0; index < entry.order.length - 1; index += 1) {
    const left = evaluated.get(`${entry.id}/${entry.order[index]}`);
    const right = evaluated.get(`${entry.id}/${entry.order[index + 1]}`);
    assert.ok(compareCompositionEvaluations(left, right) <= 0, `${entry.id}: approved order is not produced by the evaluator`);
  }
  const oracleWinner = entry.order[0];
  const winnerEvaluation = evaluated.get(`${entry.id}/${oracleWinner}`);
  oracleEvidence.push({
    id: entry.id,
    winner: oracleWinner,
    status: winnerEvaluation.status,
    score: winnerEvaluation.score,
    legalVariants: legalVariants.length,
    comparedVariants: entry.variants.length,
    variants: entry.variants.map((variant) => {
      const evaluation = evaluated.get(`${entry.id}/${variant}`);
      return {
        variant,
        status: evaluation.status,
        score: evaluation.score,
        penalties: evaluation.scoreBreakdown.filter(({ points }) => points < 0).map(({ code, points }) => ({ code, points })),
      };
    }),
  });
}
await rm(temporary, { recursive: true, force: true });
console.log(JSON.stringify({
  status: 'passed',
  cases: corpus.length,
  variants: corpus.reduce((sum, entry) => sum + entry.variants.length, 0),
  oracleEvidence,
  reachabilityEvidence,
}, null, 2));
