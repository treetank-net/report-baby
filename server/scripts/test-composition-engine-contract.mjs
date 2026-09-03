import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-engine-'));
const bundle = join(temporary, 'composition-engine.cjs');
const build = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`composition engine contract bundle failed: ${build.stderr || build.stdout}`);

try {
  const composition = await import(bundle);
  const { combineJsPdfCompositionBlockCapabilities, compareCompositionEvaluations, createCompositionEngine, renderComposition } = composition.default ?? composition;
  const document = { flows: { main: { id: 'main', blocks: [], continuation: 'allowed' } } };
  const plan = {
    pages: [],
    slots: [],
    placements: [],
    blockPlacements: [],
    tablePlacements: [],
    graphicPlacements: [],
    lines: [],
    decisions: [],
    diagnostics: [],
    residualContent: [],
  };
  let metricsSeen;
  let evaluationCalls = 0;
  const engine = createCompositionEngine(
    {
      plan(input, metrics) {
        assert.equal(input, document);
        metricsSeen = metrics;
        return plan;
      },
    },
    {
      evaluate(input, planned) {
        evaluationCalls += 1;
        assert.equal(input, document);
        assert.equal(planned, plan);
        return { status: 'accepted', diagnostics: [], residualContent: [] };
      },
    },
  );
  const metrics = { units: 'mm', measureText: () => 1, lineHeight: () => 4 };
  const result = engine.plan(document, metrics);
  assert.equal(metricsSeen, metrics);
  assert.equal(result.plan, plan);
  assert.equal(result.evaluation.status, 'accepted');
  assert.equal(evaluationCalls, 1, 'the composition engine must evaluate one plan exactly once');
  const candidatePlans = [
    { ...plan, trace: { phases: [] } },
    { ...plan, trace: { phases: [] } },
    { ...plan, trace: { phases: [] } },
  ];
  const candidateEvaluations = [
    { status: 'rejected', diagnostics: [{ code: 'synthetic', severity: 'error' }], hardViolations: [{ code: 'synthetic', severity: 'error' }], score: 999, scoreBreakdown: [], residualContent: [] },
    { status: 'accepted', diagnostics: [], hardViolations: [], score: 101, scoreBreakdown: [], residualContent: [] },
    { status: 'accepted', diagnostics: [], hardViolations: [], score: 102, scoreBreakdown: [], residualContent: [] },
  ];
  let candidateEvaluationCalls = 0;
  const candidateEngine = createCompositionEngine(
    {
      plan() { throw new Error('candidate planner must use planCandidates'); },
      planCandidates() { return candidatePlans; },
    },
    {
      evaluate(input, planned) {
        assert.equal(input, document);
        const index = candidatePlans.indexOf(planned);
        assert.notEqual(index, -1);
        candidateEvaluationCalls += 1;
        return candidateEvaluations[index];
      },
    },
  );
  const candidateResult = candidateEngine.plan(document, metrics);
  assert.equal(candidateResult.plan, candidatePlans[2], 'candidate engine must choose the highest-scoring legal plan');
  assert.equal(candidateResult.evaluation, candidateEvaluations[2]);
  assert.equal(candidateEvaluationCalls, candidatePlans.length, 'each candidate must be evaluated exactly once');
  assert.ok(compareCompositionEvaluations(candidateEvaluations[2], candidateEvaluations[0]) < 0);
  assert.deepEqual(candidateResult.plan.trace.phases.at(-1), {
    name: 'evaluation',
    status: 'completed',
    details: {
      diagnosticCount: 0,
      errorCount: 0,
      candidates: [
        { index: 0, status: 'rejected', score: 999, scoreBreakdown: [], hardViolationCount: 1, reflowPasses: 0, refinementRound: 0, insertionPlacements: [] },
        { index: 1, status: 'accepted', score: 101, scoreBreakdown: [], hardViolationCount: 0, reflowPasses: 0, refinementRound: 0, insertionPlacements: [] },
        { index: 2, status: 'accepted', score: 102, scoreBreakdown: [], hardViolationCount: 0, reflowPasses: 0, refinementRound: 0, insertionPlacements: [] },
      ],
      selectedCandidate: 2,
    },
  });
  const capabilityCalls = [];
  const capabilities = combineJsPdfCompositionBlockCapabilities({
    image: {
      measureBlock(block) { capabilityCalls.push(block.kind); return { height: 10 }; },
      renderer() {},
    },
    metric: {
      measureBlock(block) { capabilityCalls.push(block.kind); return { height: 20 }; },
      renderer() {},
    },
  });
  assert.deepEqual([
    capabilities.measureBlock({ kind: 'image', id: 'image', role: 'body', atomic: true }, { x: 0, y: 0, width: 10, height: 10 }),
    capabilities.measureBlock({ kind: 'metric', id: 'metric', role: 'metric', atomic: true }, { x: 0, y: 0, width: 10, height: 10 }),
  ], [{ height: 10 }, { height: 20 }]);
  assert.deepEqual(capabilityCalls, ['image', 'metric']);
  assert.equal(typeof capabilities.blockRenderers.image, 'function');
  assert.equal(typeof capabilities.blockRenderers.metric, 'function');
  const artifact = renderComposition(document, result, {
    render(input, planned) {
      assert.equal(input, document);
      assert.equal(planned, plan);
      return 'artifact';
    },
  });
  assert.equal(artifact, 'artifact');
  assert.throws(
    () => renderComposition(document, { ...result, evaluation: { status: 'rejected', diagnostics: [], residualContent: [] } }, { render: () => 'must not render' }),
    /rejected and cannot be rendered/u,
  );
  console.log(JSON.stringify({ status: 'passed', seam: 'planner-evaluator-backend-neutral' }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
