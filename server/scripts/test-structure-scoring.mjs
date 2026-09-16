import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-structure-scoring-'));
const bundlePath = join(temporary, 'composition.cjs');

try {
  await build({
    entryPoints: [join(root, 'src/composition/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundlePath,
  });
  const bundled = await import(bundlePath);
  const composition = bundled.default ?? bundled;
  const { scoreListContinuity, scoreTableContinuity, scoreTinyFragments, scoreInsertionSymmetry, scoreInsertionDistribution, scoreSpacingRhythm, scoreNarrowTextIntervals, scoreFooterGap, scoreGlyphOverlap, scoreElementProximity, elementProximityReports, scoreSiblingColumnImbalance, scoreEmptyRegions, scoreFitContentEnvelope, rectUnionArea } = composition;
  assert.equal(rectUnionArea([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 0, width: 10, height: 10 }]), 150, 'overlapping geometry must be counted once');
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-rationale Keep as a shared plan fixture; geometry is supplied by the plan and needs no PDF render.
   */
  const line = (blockId, page, slotId, startWord = 0, endWord = 1, routeIndex = 0) => ({
    blockId,
    flowId: 'main',
    slotId,
    page,
    text: blockId,
    box: { x: 10, y: 10, width: 80, height: 5 },
    routeIndex,
    naturalWidth: 20,
    startWord,
    endWord,
  });
  const document = {
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [
          { id: 'list-1', kind: 'list-item', role: 'body', text: 'first' },
          { id: 'list-2', kind: 'list-item', role: 'body', text: 'second' },
          { id: 'paragraph', kind: 'paragraph', role: 'body', text: 'paragraph' },
          { id: 'table-1', kind: 'table', role: 'table', table: { head: ['A'], body: [['one'], ['two'], ['three']] } },
        ],
      },
    },
  };
  const basePlan = { pages: [], slots: [], placements: [], blockPlacements: [], tablePlacements: [], graphicPlacements: [], lines: [], insertionLines: [], decisions: [], diagnostics: [], residualContent: [] };

  const listSplit = scoreListContinuity(document, {
    ...basePlan,
    lines: [line('list-1', 1, 'text-1'), line('list-2', 2, 'text-2')],
  });
  assert.equal(listSplit.code, 'list-continuity');
  assert.equal(listSplit.value, 1, 'a list crossing a page must expose one continuity event');
  assert.ok(listSplit.points < 0, 'list continuity events must be soft penalties');

  const listItemSplit = scoreListContinuity(document, {
    ...basePlan,
    lines: [line('list-1', 1, 'text-1'), line('list-1', 2, 'text-2'), line('list-2', 2, 'text-2')],
  });
  assert.equal(listItemSplit.details.itemFragmentations, 1, 'a list item crossing pages must be identified separately');

  const tableSplit = scoreTableContinuity(document, {
    ...basePlan,
    tablePlacements: [
      { id: 'table:1', blockId: 'table-1', slotId: 'table-1', page: 1, box: { x: 10, y: 10, width: 80, height: 20 }, startRow: 0, endRow: 2, repeatsHeader: false },
      { id: 'table:2', blockId: 'table-1', slotId: 'table-2', page: 2, box: { x: 10, y: 10, width: 80, height: 12 }, startRow: 2, endRow: 3, repeatsHeader: true },
    ],
  });
  assert.equal(tableSplit.code, 'table-continuity');
  assert.equal(tableSplit.details.fragments, 1);
  assert.equal(tableSplit.details.pageSplits, 1);
  assert.equal(tableSplit.details.widowFragments, 1, 'a repeated header with one row must be a widow warning');
  assert.ok(tableSplit.points < 0);

  const tiny = scoreTinyFragments(document, {
    ...basePlan,
    lines: [line('paragraph', 1, 'text-1'), line('paragraph', 2, 'text-2'), line('list-1', 2, 'text-2')],
  });
  assert.equal(tiny.code, 'tiny-fragments');
  assert.equal(tiny.value, 2, 'one-line first and last fragments must both be reported');
  assert.ok(tiny.points < 0);

  const clean = scoreListContinuity(document, { ...basePlan, lines: [line('list-1', 1, 'text-1'), line('list-2', 1, 'text-1')] });
  assert.equal(clean.value, 0, 'a list staying in one fragmentainer must not be penalized');
  const spacingPlan = {
    ...basePlan,
    spacing: {
      pages: [],
      slots: [
        { page: 1, slotId: 'main-a', regionId: 'main', flowId: 'main', box: { x: 10, y: 10, width: 40, height: 80 }, occupiedHeight: 60, remainingHeight: 20, gapBefore: 0, gapAfter: 20 },
        { page: 1, slotId: 'main-b', regionId: 'main', flowId: 'main', box: { x: 55, y: 10, width: 40, height: 80 }, occupiedHeight: 40, remainingHeight: 40, gapBefore: 0, gapAfter: 40 },
      ],
      textPlacements: [{ blockId: 'paragraph', flowId: 'main', page: 1, slotId: 'main-a', box: { x: 10, y: 10, width: 40, height: 60 }, slotBox: { x: 10, y: 10, width: 40, height: 80 }, lineCount: 12, spacing: { styleName: 'body', lineHeight: 5, padding: { top: 0, bottom: 0 }, margin: { top: 0, bottom: 0 } }, gapBefore: 0, gapAfter: 20, gapToFooter: 3 }],
      observations: [
        { kind: 'insertion-rhythm', page: 1, slotId: 'quote', regionId: 'main', box: { x: 10, y: 45, width: 80, height: 8 }, metrics: { beforeTextGap: 2, afterTextGap: 7, textGapAsymmetry: 5, regionStartGap: 35, regionEndGap: 37, previousInsertionGap: 4, nextInsertionGap: 12 }, intervals: [{ x: 10, width: 12 }] },
        { kind: 'element-proximity', page: 1, from: { kind: 'block', id: 'intro', flowId: 'intro', blockId: 'intro', slotId: 'intro' }, to: { kind: 'graphic', id: 'insertion:quote', slotId: 'quote' }, metrics: { gap: 1, minimumGap: 4, deficit: 3, movementNeeded: 3, movementBudget: 8 }, movementAvailable: true, reasons: ['elements-too-close'] },
      ],
    },
  };
  assert.ok(scoreInsertionSymmetry(spacingPlan).points < 0);
  assert.ok(scoreInsertionDistribution(spacingPlan).points < 0);
  assert.ok(scoreSpacingRhythm(spacingPlan).points < 0);
  assert.ok(scoreNarrowTextIntervals(spacingPlan).points < 0);
  assert.ok(scoreElementProximity(spacingPlan).points < 0, 'an intro and insertion below the breathing-room threshold must be penalized');
  const proximityDocument = {
    flows: {
      intro: { id: 'intro', blocks: [{ id: 'intro-copy', kind: 'paragraph', role: 'intro', text: 'Lead copy.' }] },
      quotes: { id: 'quotes', blocks: [{ id: 'quote-1', kind: 'paragraph', role: 'quote', text: 'Quote copy.' }] },
    },
  };
  const proximityPlan = {
    ...basePlan,
    slots: [
      { id: '1:intro', page: 1, regionId: 'intro', flowId: 'intro', kind: 'text', spacingProfile: 'normal', box: { x: 10, y: 10, width: 80, height: 20 }, state: 'partial' },
      { id: '1:quotes', page: 1, regionId: 'quotes', flowId: 'quotes', kind: 'text', spacingProfile: 'normal', placement: { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 2 }, box: { x: 10, y: 32, width: 80, height: 20 }, state: 'partial' },
    ],
    lines: [{ ...line('intro-copy', 1, '1:intro'), flowId: 'intro', box: { x: 10, y: 10, width: 80, height: 20 } }],
    graphicPlacements: [{ id: 'graphic:insertion:quote-1', graphicId: 'insertion:quote-1', slotId: '1:quotes', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 10, y: 32, width: 80, height: 8 } }],
  };
  const tooClose = elementProximityReports(proximityPlan, proximityDocument);
  assert.equal(tooClose.length, 1, 'an intro and same-page insertion below the spacing target must produce one pairwise observation');
  assert.equal(tooClose[0].from.flowId, 'intro');
  assert.equal(tooClose[0].to.blockId, 'quote-1');
  assert.equal(tooClose[0].metrics.gap, 2);
  assert.equal(tooClose[0].metrics.minimumGap, 6, 'the pair must use the selected spacing profile target');
  assert.equal(tooClose[0].metrics.deficit, 4);
  assert.equal(tooClose[0].movementAvailable, false, 'a fluid-y capacity does not make each materialized instance freely movable');
  proximityPlan.movableInsertionFrames = [{ id: 'quotes:quote-1', flowId: 'quotes', blockId: 'quote-1', page: 1, box: { x: 10, y: 0, width: 80, height: 60 }, axis: 'y', candidateCount: 3 }];
  assert.equal(elementProximityReports(proximityPlan, proximityDocument)[0].movementAvailable, true, 'a declared movable frame must be exposed in the observation');
  assert.ok(tooClose[0].metrics.movementNeeded <= tooClose[0].metrics.movementBudget);
  proximityPlan.graphicPlacements[0].box.y = 10;
  assert.ok(elementProximityReports(proximityPlan, proximityDocument)[0].metrics.movementNeeded > elementProximityReports(proximityPlan, proximityDocument)[0].metrics.movementBudget, 'a large overlap must expose that moving it exceeds the configured movement budget');
  proximityPlan.graphicPlacements[0].page = 2;
  proximityPlan.slots[1].page = 2;
  assert.equal(elementProximityReports(proximityPlan, proximityDocument).length, 0, 'proximity must never compare elements across different pages');
  assert.ok(scoreFooterGap(spacingPlan).points < 0);
  const overlappingGlyph = {
    ...basePlan,
    lines: [line('paragraph', 1, 'text-1')],
    glyphPlacements: [{ id: 'glyph-placement:quote:1', glyphId: 'quote', targetType: 'block', targetId: 'paragraph', page: 1, slotId: 'text-1', text: '”', styleName: 'quote-mark', source: 'generated', anchor: 'text-end', box: { x: 10, y: 10, width: 5, height: 5 }, baselineY: 14 }],
  };
  assert.ok(scoreGlyphOverlap(overlappingGlyph).points < 0, 'glyphs intruding into text must be penalized');
  overlappingGlyph.glyphPlacements[0].box.x = 100;
  assert.equal(Math.abs(scoreGlyphOverlap(overlappingGlyph).points), 0, 'glyphs outside text must not be penalized');
  const balancedSpacingPlan = structuredClone(spacingPlan);
  balancedSpacingPlan.spacing.observations[0] = {
    ...balancedSpacingPlan.spacing.observations[0],
    profile: 'compact',
    metrics: { beforeTextGap: 4, afterTextGap: 4, regionStartGap: 4, regionEndGap: 4, referenceGap: 4 },
  };
  assert.ok(Math.abs(scoreSpacingRhythm(balancedSpacingPlan).points) === 0, 'a compact profile must use its compact reference gap');
  const boundaryInsertionPlan = structuredClone(spacingPlan);
  boundaryInsertionPlan.spacing.observations[0] = {
    ...boundaryInsertionPlan.spacing.observations[0],
    cause: 'template-fluid-insertion-capability',
    metrics: { beforeTextGap: 0.5, afterTextGap: 0, regionStartGap: 35, regionEndGap: 37, nextInsertionGap: 12, referenceGap: 6 },
  };
  assert.equal(Math.abs(scoreInsertionSymmetry(boundaryInsertionPlan).points), 0, 'a boundary insertion without text on both sides must not be scored as asymmetric');
  assert.equal(Math.abs(scoreSpacingRhythm(boundaryInsertionPlan).points), 0, 'a boundary insertion without text on both sides must not be scored against ordinary text rhythm');
  assert.equal(Math.abs(scoreInsertionDistribution(boundaryInsertionPlan).points), 0, 'fluid capability distribution must not use the whole content envelope as an outer gap');
  const columnPlan = {
    ...basePlan,
    spacing: {
      pages: [],
      slots: [
        { page: 1, slotId: 'left', regionId: 'main', flowId: 'main', box: { x: 0, y: 0, width: 40, height: 100 }, occupiedHeight: 90, remainingHeight: 10, gapBefore: 0, gapAfter: 10 },
        { page: 1, slotId: 'right', regionId: 'main', flowId: 'main', box: { x: 50, y: 0, width: 40, height: 100 }, occupiedHeight: 30, remainingHeight: 70, gapBefore: 0, gapAfter: 70 },
      ],
      textPlacements: [],
      observations: [],
    },
    slots: [{ id: 'left', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 0, y: 0, width: 40, height: 100 }, growthMaxHeight: 100, state: 'partial' }, { id: 'right', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 50, y: 0, width: 40, height: 100 }, growthMaxHeight: 100, state: 'partial' }],
  };
  assert.ok(scoreSiblingColumnImbalance(columnPlan).points < 0, 'uneven sibling columns must be penalized');
  assert.ok(scoreEmptyRegions(columnPlan).points < 0, 'large unexplained empty regions must be penalized');
  assert.ok(scoreFitContentEnvelope(columnPlan).points < 0, 'unused fit-content envelope must be penalized');
  const terminalPage = {
    ...basePlan,
    pages: [{ page: 1 }, { page: 2 }],
    spacing: {
      pages: [],
      slots: [{ page: 2, slotId: 'terminal-main', regionId: 'main', flowId: 'main', box: { x: 0, y: 0, width: 40, height: 100 }, occupiedHeight: 10, remainingHeight: 90, gapBefore: 0, gapAfter: 90 }],
      textPlacements: [],
      observations: [],
    },
  };
  assert.equal(Math.abs(scoreEmptyRegions(terminalPage).points), 0, 'natural underfill on the terminal main-flow page must not be penalized');
  terminalPage.spacing.slots[0].page = 1;
  assert.ok(scoreEmptyRegions(terminalPage).points < 0, 'underfill before the terminal page must remain a quality penalty');
  console.log(JSON.stringify({ status: 'passed', listSplit: listSplit.value, tableSplit: tableSplit.value, tinyFragments: tiny.value, qualityComponents: 6 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
