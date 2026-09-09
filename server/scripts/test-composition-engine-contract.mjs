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
  const { combineJsPdfCompositionBlockCapabilities, compareCompositionEvaluations, contrastRatio, createCompositionContrastProvider, createCompositionEngine, evaluateCompositionPlan, fitContainBox, imagePixelAtPoint, relativeLuminance, renderComposition, sampleCompositionContrast } = composition.default ?? composition;
  assert.deepEqual(fitContainBox({ x: 10, y: 20, width: 4, height: 3 }, 4, 1), { x: 10, y: 21, width: 4, height: 1 }, 'contain geometry must preserve image aspect ratio and center the painted box');
  const paintedBox = fitContainBox({ x: 10, y: 20, width: 4, height: 3 }, 4, 1);
  assert.equal(imagePixelAtPoint(paintedBox, 4, 1, 10, 20), undefined, 'a page point in the unused contain margin must not resolve to an image pixel');
  assert.deepEqual(imagePixelAtPoint(paintedBox, 4, 1, 11.99, 21), { x: 1, y: 0 }, 'a continuous page point inside the painted image must map to the corresponding source pixel');
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

  const structuredFlowDocument = {
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [
          { id: 'table', kind: 'table', role: 'table', table: { head: ['H'], body: [['value']] } },
          { id: 'next', kind: 'paragraph', role: 'body', text: 'next' },
        ],
      },
    },
  };
  const structuredFlowPlan = {
    pages: [{ page: 1, layoutId: 'layout', width: 100, height: 100 }],
    slots: [
      { id: 'previous', page: 1, regionId: 'content', flowId: 'main', kind: 'text', routeIndex: 0, box: { x: 0, y: 0, width: 100, height: 100 }, state: 'partial' },
      { id: 'next', page: 1, regionId: 'content', flowId: 'main', kind: 'text', routeIndex: 1, box: { x: 0, y: 0, width: 100, height: 100 }, state: 'partial' },
    ],
    placements: [],
    blockPlacements: [],
    tablePlacements: [{
      id: 'table-placement',
      blockId: 'table',
      slotId: 'previous',
      page: 1,
      routeIndex: 0,
      box: { x: 0, y: 10, width: 100, height: 80 },
      startRow: 0,
      endRow: 1,
      repeatsHeader: false,
    }],
    graphicPlacements: [],
    lines: [
      { blockId: 'table', flowId: 'main', slotId: 'previous', page: 1, routeIndex: 0, text: 'heading', box: { x: 0, y: 0, width: 100, height: 5 }, naturalWidth: 20, startWord: 0, endWord: 1 },
      { blockId: 'next', flowId: 'main', slotId: 'next', page: 1, routeIndex: 1, text: 'next', box: { x: 0, y: 0, width: 100, height: 5 }, naturalWidth: 20, startWord: 0, endWord: 1 },
    ],
    decisions: [],
    diagnostics: [],
    residualContent: [],
    minimumFragmentLines: 3,
  };
  const structuredFlowEvaluation = evaluateCompositionPlan(structuredFlowDocument, structuredFlowPlan);
  assert.equal(
    structuredFlowEvaluation.diagnostics.some((item) => item.code === 'FLOW_FRAGMENT_UNDERFILLED'),
    false,
    'a table occupying the remaining area of a route slot must not be counted as free flow capacity',
  );
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
  const coarsePlan = { ...plan, graphicPlacements: [{ id: 'coarse', graphicId: 'search', slotId: 'slot', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 1, height: 1 } }], trace: { phases: [] } };
  const improvedPlan = { ...coarsePlan, graphicPlacements: [{ ...coarsePlan.graphicPlacements[0], id: 'refined', box: { x: 1, y: 0, width: 1, height: 1 } }], trace: { phases: [] } };
  const unchangedPlan = { ...improvedPlan, trace: { phases: [] } };
  const refinementEngine = createCompositionEngine(
    {
      plan() { throw new Error('refinement planner must use candidate seams'); },
      planCandidates() { return [coarsePlan]; },
      candidateRefinementRounds: 3,
      planRefinedCandidates(_input, _metrics, selected, round) {
        assert.equal(selected, round === 1 ? coarsePlan : improvedPlan);
        return round === 1 ? [improvedPlan] : [unchangedPlan];
      },
    },
    {
      evaluate(_input, planned) {
        const score = planned.graphicPlacements[0].box.x;
        return { status: 'accepted', diagnostics: [], hardViolations: [], score, scoreBreakdown: [], residualContent: [] };
      },
    },
  );
  const refinementResult = refinementEngine.plan(document, metrics);
  assert.equal(refinementResult.plan, improvedPlan, 'a better local candidate must replace the coarse winner');
  assert.equal(refinementResult.plan.trace.candidateSearch.rounds[1].improved, true, 'trace must mark the improving refinement round');
  assert.equal(refinementResult.plan.trace.candidateSearch.rounds[2].stopReason, 'no-improvement', 'trace must stop when a refinement no longer improves the winner');
  assert.equal(refinementResult.plan.trace.candidateSearch.selectedCandidate, 1, 'trace must expose the refined winner index');
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
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.ok(Math.abs(contrastRatio([10, 10, 10], [0, 0, 0]) - 1.0607) < 0.0001, 'contrast must use the current sRGB branch point');
  const localImage = {
    width: 4,
    height: 1,
    channels: 3,
    pixels: Uint8Array.from([255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255]),
  };
  const localContrast = sampleCompositionContrast(localImage, {
    region: { x: 0, y: 0, width: 4, height: 1 },
    foreground: [0, 0, 0],
    sampleCount: 4,
  });
  assert.equal(localContrast.status, 'measured', 'local contrast must return a measured value');
  assert.equal(localContrast.minimumRatio, 1);
  assert.deepEqual(localContrast.worstSample, { x: 2, y: 0, ratio: 1 });
  const glyphImage = {
    width: 8,
    height: 4,
    channels: 3,
    pixels: Uint8Array.from(Array.from({ length: 32 }, (_, index) => {
      const x = index % 8;
      return x < 4 ? [255, 255, 255] : [0, 0, 0];
    }).flat()),
  };
  const glyphSamplingOptions = {
    region: { x: 0, y: 0, width: 8, height: 4 },
    foreground: [0, 0, 0],
    sampleCount: 1.2,
    sampleSeed: 'same-corpus',
    glyphs: [
      { box: { x: 0, y: 0, width: 4, height: 4 }, baselineY: 3 },
      { box: { x: 4, y: 0, width: 4, height: 4 }, baselineY: 3 },
    ],
  };
  const glyphContrast = sampleCompositionContrast(glyphImage, glyphSamplingOptions);
  const repeatedGlyphContrast = sampleCompositionContrast(glyphImage, glyphSamplingOptions);
  assert.equal(glyphContrast.status, 'measured', 'glyph-local contrast must return a measured value');
  assert.ok(glyphContrast.sampleCount >= 2 && glyphContrast.sampleCount <= 4, '1.2 samples must resolve to one or two samples independently per glyph');
  assert.equal(glyphContrast.sampledPoints?.length, glyphContrast.sampleCount, 'sampled point count must describe actual work');
  assert.deepEqual(glyphContrast.sampledPoints, repeatedGlyphContrast.sampledPoints, 'the same corpus seed must reproduce the same sample points');
  assert.ok(glyphContrast.sampledPoints?.some((point) => Math.abs(point.normalizedX) > 0 && Math.abs(point.normalizedX) < 1 && Math.abs(point.normalizedY) > 0 && Math.abs(point.normalizedY) < 1), 'Monte Carlo offsets must use continuous values inside the normalized glyph frame');
  assert.notDeepEqual(
    glyphContrast.sampledPoints?.filter((point) => point.glyphIndex === 0).map((point) => [point.normalizedX, point.normalizedY]),
    glyphContrast.sampledPoints?.filter((point) => point.glyphIndex === 1).map((point) => [point.normalizedX, point.normalizedY]),
    'each glyph must consume a new part of the seeded random stream',
  );
  assert.ok(glyphContrast.sampledPoints?.every((point) => point.x >= 0 && point.x < glyphImage.width && point.y >= 0 && point.y < glyphImage.height), 'glyph samples must remain inside the raster');
  assert.ok((glyphContrast.averageRatio ?? 0) < 21, 'glyph-local aggregation must see both background regions');
  const uniformGlyphImage = {
    width: 8,
    height: 4,
    channels: 3,
    pixels: Uint8Array.from(Array.from({ length: 32 }, () => [255, 255, 255]).flat()),
  };
  const perGlyphForegroundContrast = sampleCompositionContrast(uniformGlyphImage, {
    ...glyphSamplingOptions,
    sampleCount: 1,
    glyphs: [
      { ...glyphSamplingOptions.glyphs[0], foreground: [0, 0, 0] },
      { ...glyphSamplingOptions.glyphs[1], foreground: [255, 255, 255] },
    ],
  });
  assert.equal(perGlyphForegroundContrast.glyphResults?.[0]?.averageRatio, 21, 'glyph sampling must use a supplied per-glyph foreground color');
  assert.equal(perGlyphForegroundContrast.glyphResults?.[1]?.averageRatio, 1, 'glyph sampling must distinguish a light foreground from a light background');
  const shiftedGlyphContrast = sampleCompositionContrast({ ...uniformGlyphImage, width: 12, pixels: Uint8Array.from(Array.from({ length: 48 }, () => [255, 255, 255]).flat()) }, {
    ...glyphSamplingOptions,
    region: { x: 0, y: 0, width: 12, height: 4 },
    glyphs: glyphSamplingOptions.glyphs.map((glyph) => ({ ...glyph, box: { ...glyph.box, x: glyph.box.x + 2 } })),
  });
  assert.deepEqual(
    glyphContrast.sampledPoints?.map((point) => [point.normalizedX, point.normalizedY]),
    shiftedGlyphContrast.sampledPoints?.map((point) => [point.normalizedX, point.normalizedY]),
    'moving a candidate must preserve the normalized corpus sample pattern',
  );
  const oneSample = sampleCompositionContrast(uniformGlyphImage, { ...glyphSamplingOptions, sampleCount: 1 });
  const manySamples = sampleCompositionContrast(uniformGlyphImage, { ...glyphSamplingOptions, sampleCount: 20 });
  assert.equal(oneSample.averageRatio, manySamples.averageRatio, 'sample count must not multiply the normalized contrast result');
  const transparentImage = {
    width: 1,
    height: 1,
    channels: 4,
    pixels: Uint8Array.from([0, 0, 0, 128]),
  };
  assert.equal(sampleCompositionContrast(transparentImage, {
    region: { x: 0, y: 0, width: 1, height: 1 },
    foreground: [0, 0, 0],
    sampleCount: 1,
    pageBackground: [255, 255, 255],
  }).status, 'measured');
  assert.equal(sampleCompositionContrast(transparentImage, {
    region: { x: 0, y: 0, width: 1, height: 1 },
    foreground: [0, 0, 0],
    sampleCount: 1,
  }).status, 'unknown');
  assert.equal(sampleCompositionContrast(localImage, {
    region: { x: 4, y: 0, width: 1, height: 1 },
    foreground: [0, 0, 0],
    sampleCount: 1,
  }).reason, 'invalid-region');
  const contrastProvider = createCompositionContrastProvider({
    rasterImages: new Map([['photo', localImage]]),
    foreground: [0, 0, 0],
    sampleCount: 4,
    sampleSeed: 'same-corpus',
  });
  const contrastFindings = contrastProvider.assess({
    ...plan,
    lines: [{ blockId: 'body', flowId: 'main', slotId: 'text', page: 1, text: 'body', box: { x: 0, y: 0, width: 4, height: 1 }, naturalWidth: 4, startWord: 0, endWord: 1, glyphSamplingBoxes: [{ box: { x: 0, y: 0, width: 4, height: 1 }, baselineY: 1 }] }],
    graphicPlacements: [{ id: 'graphic:photo', graphicId: 'photo', assetId: 'photo', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 4, height: 1 } }],
  });
  assert.equal(contrastFindings.length, 1);
  assert.equal(contrastFindings[0].status, 'measured', 'provider must assess text over a painted asset');
  assert.equal(contrastFindings[0].graphicId, undefined, 'full-corpus contrast is page-scoped rather than duplicated once per graphic');
  assert.equal(contrastFindings[0].sampleCount, 4, 'provider must sample the configured number of points per glyph frame');
  const pageBackgroundContrastFindings = createCompositionContrastProvider({
    rasterImages: new Map(),
    foreground: [255, 255, 255],
    sampleCount: 4,
    sampleSeed: 'black-page-background',
    pageBackground: [0, 0, 0],
  }).assess({
    ...plan,
    lines: [{
      blockId: 'body',
      flowId: 'main',
      slotId: 'text',
      page: 1,
      text: 'ab',
      box: { x: 0, y: 0, width: 2, height: 2 },
      naturalWidth: 2,
      startWord: 0,
      endWord: 1,
      glyphSamplingBoxes: [
        { box: { x: 0, y: 0, width: 1, height: 2 }, baselineY: 1 },
        { box: { x: 1, y: 0, width: 1, height: 2 }, baselineY: 1 },
      ],
    }],
    graphicPlacements: [],
  });
  assert.equal(pageBackgroundContrastFindings.length, 1, 'provider must assess a page even when it has no graphics');
  assert.equal(pageBackgroundContrastFindings[0].status, 'measured', 'known page background must be measurable without a graphic');
  assert.equal(pageBackgroundContrastFindings[0].sampleCount, 8, 'every glyph cell must receive the configured sample budget');
  assert.equal(pageBackgroundContrastFindings[0].minimumRatio, 21, 'page-background samples must use the configured background color');
  assert.equal(pageBackgroundContrastFindings[0].averageRatio, 21, 'page-background contrast must cover the complete corpus');
  assert.equal(pageBackgroundContrastFindings[0].glyphResults?.length, 2, 'page-background contrast must report every glyph cell');
  const partialGraphicContrastFindings = createCompositionContrastProvider({
    rasterImages: new Map([['black-patch', { width: 1, height: 1, channels: 3, pixels: Uint8Array.from([0, 0, 0]) }]]),
    foreground: [0, 0, 0],
    sampleCount: 100,
    sampleSeed: 'partial-graphic-cell',
    pageBackground: [255, 255, 255],
  }).assess({
    ...plan,
    lines: [{
      blockId: 'body',
      flowId: 'main',
      slotId: 'text',
      page: 1,
      text: 'a',
      box: { x: 0, y: 0, width: 2, height: 2 },
      naturalWidth: 2,
      startWord: 0,
      endWord: 1,
      glyphSamplingBoxes: [{ box: { x: 0, y: 0, width: 2, height: 2 }, baselineY: 1 }],
    }],
    graphicPlacements: [{ id: 'graphic:black-patch', graphicId: 'black-patch', assetId: 'black-patch', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 1, height: 2 } }],
  });
  assert.equal(partialGraphicContrastFindings[0].sampleCount, 100, 'partial graphic sampling must keep the configured per-glyph budget');
  assert.ok((partialGraphicContrastFindings[0].averageRatio ?? 0) > 1 && (partialGraphicContrastFindings[0].averageRatio ?? 21) < 21, 'full-cell sampling must average graphic and page backgrounds');
  assert.ok(partialGraphicContrastFindings[0].glyphResults?.[0]?.minimumRatio === 1, 'a graphic covering part of a glyph cell must remain visible in its worst sample');
  const unknownContrastFindings = createCompositionContrastProvider({
    rasterImages: new Map(),
    foreground: [0, 0, 0],
    sampleCount: 4,
  }).assess({
    ...plan,
    lines: [{ blockId: 'body', flowId: 'main', slotId: 'text', page: 1, text: 'body', box: { x: 0, y: 0, width: 4, height: 1 }, naturalWidth: 4, startWord: 0, endWord: 1 }],
    graphicPlacements: [{ id: 'graphic:missing-photo', graphicId: 'missing-photo', assetId: 'missing-photo', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 4, height: 1 } }],
  });
  assert.equal(unknownContrastFindings[0].status, 'unknown', 'a missing raster must not become a contrast pass');
  assert.equal(unknownContrastFindings[0].reason, 'asset-raster-missing');
  const boundaryContrastFindings = contrastProvider.assess({
    ...plan,
    lines: [{ blockId: 'body', flowId: 'main', slotId: 'text', page: 1, text: 'body', box: { x: 0, y: 0, width: 4, height: 1 }, naturalWidth: 4, startWord: 0, endWord: 1 }],
    graphicPlacements: [{ id: 'graphic:boundary', graphicId: 'boundary', assetId: 'photo', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'around', paint: false, box: { x: 0, y: 0, width: 4, height: 1 } }],
  });
  assert.equal(boundaryContrastFindings.length, 0, 'planner-only exclusion boundaries must not be contrast-tested');
  const contrastPlan = {
    ...plan,
    slots: [{ id: 'text', page: 1, regionId: 'content', kind: 'text', box: { x: 0, y: 0, width: 4, height: 1 }, state: 'exhausted' }, { id: 'graphic', page: 1, regionId: 'hero', kind: 'graphic', box: { x: 0, y: 0, width: 4, height: 1 }, state: 'exhausted' }],
    lines: [{ blockId: 'body', flowId: 'main', slotId: 'text', page: 1, text: 'body', box: { x: 0, y: 0, width: 4, height: 1 }, naturalWidth: 4, startWord: 0, endWord: 1 }],
    graphicPlacements: [{ id: 'graphic:photo', graphicId: 'photo', assetId: 'photo', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 4, height: 1 } }],
  };
  const contrastDocument = {
    assets: [{ id: 'photo', source: 'photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [] } },
  };
  const partialGlyphPlan = {
    ...contrastPlan,
    lines: contrastPlan.lines.map((line) => ({
      ...line,
      glyphSamplingBoxes: [{ box: line.box, baselineY: line.box.y + line.box.height }],
    })),
  };
  const partialGlyphEvaluation = evaluateCompositionPlan(contrastDocument, partialGlyphPlan, {
    contrastProvider: createCompositionContrastProvider({
      rasterImages: new Map([['photo', { width: 4, height: 1, channels: 3, pixels: Uint8Array.from([0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255]) }]]),
      foreground: [0, 0, 0],
      sampleCount: 100,
      sampleSeed: 'partial-contrast-score',
    }),
  });
  const partialGlyphComponent = partialGlyphEvaluation.scoreBreakdown.find((component) => component.code === 'contrast');
  assert.equal(partialGlyphComponent?.details?.worstPointQuality, 0, 'a sampled 1:1 point must make the worst-point quality zero');
  assert.equal(partialGlyphComponent?.details?.affectedGlyphCount, 1, 'a glyph with one severely affected sample must count as affected');
  const contrastEvaluation = evaluateCompositionPlan(contrastDocument, contrastPlan, {
    contrastProvider: createCompositionContrastProvider({
      rasterImages: new Map([['photo', { width: 4, height: 1, channels: 3, pixels: Uint8Array.from(Array.from({ length: 4 }, () => [0, 0, 0]).flat()) }]]),
      foreground: [0, 0, 0],
      sampleCount: 4,
      sampleSeed: 'solid-black-background',
    }),
  });
  const contrastComponent = contrastEvaluation.scoreBreakdown.find((component) => component.code === 'contrast');
  assert.ok(contrastComponent, 'evaluation must expose contrast in the score breakdown');
  assert.ok((contrastComponent?.points ?? 0) < 0, 'poor measured contrast must lower the general plan score');
  assert.equal(contrastComponent?.value, 0, 'the contrast quality must normalize a 1:1 result to zero');
  assert.equal(contrastComponent?.details?.maximumPenalty, 6, 'the contrast penalty must come from render configuration');
  assert.equal(contrastEvaluation.diagnostics.some((diagnostic) => diagnostic.code.startsWith('CONTRAST_')), false, 'contrast quality must not create a separate pass/fail diagnostic');
  const highContrastEvaluation = evaluateCompositionPlan({
    assets: [{ id: 'photo', source: 'photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [] } },
  }, contrastPlan, {
    contrastProvider: createCompositionContrastProvider({
      rasterImages: new Map([['photo', { width: 4, height: 1, channels: 3, pixels: Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]) }]]),
      foreground: [0, 0, 0],
      sampleCount: 4,
    }),
  });
  const highContrastComponent = highContrastEvaluation.scoreBreakdown.find((component) => component.code === 'contrast');
  assert.ok((highContrastComponent?.value ?? 0) > 0 && (highContrastComponent?.value ?? 1) < 1, 'contrast quality must approach, but not reach, its upper bound');
  assert.ok((highContrastComponent?.points ?? 0) < 0, 'finite contrast must retain a measurable penalty below the asymptote');
  assert.ok(highContrastEvaluation.score > contrastEvaluation.score, 'better contrast must improve the general plan score');
  const targetContrastEvaluation = evaluateCompositionPlan({
    assets: [{ id: 'photo', source: 'photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [] } },
  }, contrastPlan, {
    contrastProvider: createCompositionContrastProvider({
      rasterImages: new Map([['photo', { width: 4, height: 1, channels: 3, pixels: Uint8Array.from([120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120]) }]]),
      foreground: [0, 0, 0],
      sampleCount: 4,
    }),
  });
  const targetContrastComponent = targetContrastEvaluation.scoreBreakdown.find((component) => component.code === 'contrast');
  assert.notEqual(targetContrastComponent?.value, highContrastComponent?.value, 'contrast values above the target must remain distinguishable');
  assert.notEqual(targetContrastComponent?.points, highContrastComponent?.points, 'contrast penalties above the target must remain distinguishable');
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
   */
  const localizedContrastPlan = (badGlyphCount) => ({
    ...contrastPlan,
    slots: contrastPlan.slots.map((slot) => ({ ...slot, box: { ...slot.box, width: 1000 } })),
    lines: [{
      blockId: 'body',
      flowId: 'main',
      slotId: 'text',
      page: 1,
      text: 'body',
      box: { x: 0, y: 0, width: 1000, height: 1 },
      naturalWidth: 1000,
      startWord: 0,
      endWord: 1,
      glyphSamplingBoxes: Array.from({ length: 1000 }, (_, index) => ({ box: { x: index, y: 0, width: 1, height: 1 }, baselineY: 1 })),
    }],
    graphicPlacements: [{ id: 'graphic:photo', graphicId: 'photo', assetId: 'photo', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 1000, height: 1 } }],
    _badGlyphCount: badGlyphCount,
  });
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a pure composition fixture helper; merge duplicate fixture builders into a shared plan-fixtures module.
   */
  const localizedImage = (badGlyphCount) => ({
    width: 1000,
    height: 1,
    channels: 3,
    pixels: Uint8Array.from(Array.from({ length: 1000 }, (_, index) => (index < badGlyphCount ? [0, 0, 0] : [255, 255, 255])).flat()),
  });
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
   */
  const localizedContrast = (badGlyphCount) => evaluateCompositionPlan(contrastDocument, localizedContrastPlan(badGlyphCount), {
    contrastProvider: createCompositionContrastProvider({ rasterImages: new Map([['photo', localizedImage(badGlyphCount)]]), foreground: [0, 0, 0], sampleCount: 1, sampleSeed: 'same-corpus' }),
  });
  const oneBadGlyphEvaluation = localizedContrast(1);
  const tenBadGlyphEvaluation = localizedContrast(10);
  assert.ok(oneBadGlyphEvaluation.score < highContrastEvaluation.score - 1, 'one severely obscured glyph must remain visible in the overall score');
  assert.ok(tenBadGlyphEvaluation.score < oneBadGlyphEvaluation.score, 'more severely obscured glyphs must worsen the overall score');
  const unknownEvaluation = evaluateCompositionPlan(contrastDocument, contrastPlan, {
    contrastProvider: createCompositionContrastProvider({
      rasterImages: new Map(),
      foreground: [0, 0, 0],
      sampleCount: 4,
    }),
  });
  const unknownComponent = unknownEvaluation.scoreBreakdown.find((component) => component.code === 'contrast');
  assert.equal(unknownComponent?.points, 0, 'unknown contrast evidence must remain neutral until calibrated');
  assert.equal(unknownEvaluation.diagnostics.some((diagnostic) => diagnostic.code.startsWith('CONTRAST_')), false, 'unknown contrast must not create a separate failure diagnostic');
  console.log(JSON.stringify({ status: 'passed', seam: 'planner-evaluator-backend-neutral' }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
