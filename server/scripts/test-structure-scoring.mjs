import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
const configuredOrphanPenalty = renderConfig.composition_score.orphan_penalty;
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
  const { scoreListContinuity, scoreTableContinuity, scoreTinyFragments, scoreParagraphFragmentation, scoreInsertionSymmetry, scoreInsertionDistribution, scoreSpacingRhythm, scoreNarrowTextIntervals, scoreFooterGap, scoreGlyphOverlap, scoreElementProximity, elementProximityReports, scoreOrphanLines, attributeCompositionScore, compositionRepairProposals, scoreSiblingColumnImbalance, scoreEmptyRegions, scoreFitContentEnvelope, rectUnionArea } = composition;
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
  assert.equal(tooClose[0].axis, 'y', 'overlapping horizontal ranges must report their vertical breathing-room axis');
  assert.equal(tooClose[0].metrics.gapY, 2);
  assert.equal(tooClose[0].movementAvailable, false, 'a fluid-y capacity does not make each materialized instance freely movable');
  proximityPlan.movableInsertionFrames = [{ id: 'quotes:quote-1', flowId: 'quotes', blockId: 'quote-1', page: 1, box: { x: 10, y: 0, width: 80, height: 60 }, axis: 'y', candidateCount: 3 }];
  assert.equal(elementProximityReports(proximityPlan, proximityDocument)[0].movementAvailable, true, 'a declared movable frame must be exposed in the observation');
  assert.ok(tooClose[0].metrics.movementNeeded <= tooClose[0].metrics.movementBudget);
  proximityPlan.graphicPlacements[0].box.y = 10;
  assert.ok(elementProximityReports(proximityPlan, proximityDocument)[0].metrics.movementNeeded > elementProximityReports(proximityPlan, proximityDocument)[0].metrics.movementBudget, 'a large overlap must expose that moving it exceeds the configured movement budget');
  proximityPlan.graphicPlacements[0].page = 2;
  proximityPlan.slots[1].page = 2;
  assert.equal(elementProximityReports(proximityPlan, proximityDocument).length, 0, 'proximity must never compare elements across different pages');
  proximityPlan.graphicPlacements[0].page = 1;
  proximityPlan.slots[1].page = 1;
  proximityPlan.graphicPlacements[0].box = { x: 92, y: 12, width: 10, height: 8 };
  const sideBySide = elementProximityReports(proximityPlan, proximityDocument);
  assert.equal(sideBySide.length, 1, 'overlapping vertical ranges must expose an actionable horizontal gap');
  assert.equal(sideBySide[0].axis, 'x');
  assert.equal(sideBySide[0].metrics.gapX, 2);
  assert.equal(sideBySide[0].movementAvailable, false, 'a vertical movement frame cannot claim horizontal repair capability');
  proximityPlan.movableInsertionFrames = [{ ...proximityPlan.movableInsertionFrames[0], axis: 'x' }];
  assert.equal(elementProximityReports(proximityPlan, proximityDocument)[0].movementAvailable, true, 'a matching horizontal frame must be exposed as a legal repair axis');
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
  const emptyRegionPlan = { ...columnPlan, lines: [line('paragraph', 1, 'left')] };
  const emptyRegionScore = scoreEmptyRegions(emptyRegionPlan);
  const emptyRegionAttribution = attributeCompositionScore(document, emptyRegionPlan, [emptyRegionScore]);
  assert.equal(emptyRegionAttribution.reduce((sum, entry) => sum + entry.points, 0), emptyRegionScore.points, 'region whitespace penalties must be allocated to participating placements without losing points');
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

  const repairDocument = {
    flows: {
      intro: { id: 'intro', blocks: [{ id: 'intro-copy', kind: 'paragraph', role: 'intro', text: 'A short lead.' }] },
      quotes: { id: 'quotes', blocks: [{ id: 'quote-copy', kind: 'paragraph', role: 'quote', text: 'A short quote.', allowOmission: true }] },
      main: { id: 'main', blocks: [{ id: 'orphan-paragraph', kind: 'paragraph', role: 'body', text: 'A paragraph split by an image.' }] },
    },
  };
  const repairPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    slots: [
      { id: 'intro-slot', page: 1, regionId: 'intro', flowId: 'intro', kind: 'text', box: { x: 10, y: 5, width: 80, height: 20 }, state: 'partial' },
      { id: 'quote-slot', page: 1, regionId: 'body', flowId: 'quotes', kind: 'text', box: { x: 10, y: 5, width: 80, height: 60 }, state: 'partial' },
      { id: 'main-slot', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 10, y: 5, width: 80, height: 70 }, state: 'partial' },
    ],
    lines: [
      { ...line('intro-copy', 1, 'intro-slot'), flowId: 'intro', box: { x: 10, y: 10, width: 80, height: 5 } },
      { ...line('orphan-paragraph', 1, 'main-slot', 0, 4), flowId: 'main', box: { x: 10, y: 10, width: 80, height: 5 } },
      { ...line('orphan-paragraph', 1, 'main-slot', 4, 8), flowId: 'main', box: { x: 10, y: 25, width: 80, height: 5 } },
      { ...line('orphan-paragraph', 1, 'main-slot', 8, 12), flowId: 'main', box: { x: 10, y: 32, width: 80, height: 5 } },
    ],
    graphicPlacements: [{ id: 'graphic:insertion:quote-copy', graphicId: 'insertion:quote-copy', slotId: 'quote-slot', page: 1, shape: 'rectangle', wrap: 'around', box: { x: 10, y: 16, width: 80, height: 8 } }],
    movableInsertionFrames: [{ id: 'quotes:quote-copy', flowId: 'quotes', blockId: 'quote-copy', page: 1, box: { x: 10, y: 5, width: 80, height: 60 }, axis: 'y', candidateCount: 5 }],
    spacing: {
      pages: [], slots: [], textPlacements: [],
      observations: [{
        kind: 'element-proximity', page: 1, axis: 'y',
        from: { kind: 'block', id: 'intro-copy', blockId: 'intro-copy', flowId: 'intro', slotId: 'intro-slot' },
        to: { kind: 'graphic', id: 'insertion:quote-copy', blockId: 'quote-copy', flowId: 'quotes', slotId: 'quote-slot' },
        fromBox: { x: 10, y: 10, width: 80, height: 5 }, toBox: { x: 10, y: 16, width: 80, height: 8 },
        metrics: { gap: 1, gapX: -80, gapY: 1, minimumGap: 6, deficit: 5, movementNeeded: 5, movementBudget: 8 },
        movementAvailable: true,
      }, {
        kind: 'insertion-rhythm', page: 1, flowId: 'quotes', blockId: 'quote-copy', graphicId: 'insertion:quote-copy', slotId: 'quote-slot',
        metrics: { beforeTextGap: 2, afterTextGap: 10, textGapAsymmetry: 8, referenceGap: 6 },
      }],
    },
  };
  const proximityComponent = scoreElementProximity(repairPlan);
  const proximityAttribution = attributeCompositionScore(repairDocument, repairPlan, [proximityComponent]);
  assert.equal(proximityAttribution.reduce((sum, item) => sum + item.points, 0), proximityComponent.points, 'pairwise proximity points must be conserved while attributed to both endpoints');
  const proximityRepairs = compositionRepairProposals(repairDocument, repairPlan, [proximityComponent], proximityAttribution);
  const proximityMove = proximityRepairs.find((proposal) => proposal.action === 'move');
  const proximityOmission = proximityRepairs.find((proposal) => proposal.action === 'omit');
  assert.ok(proximityMove, 'one explicitly movable endpoint must receive a bounded proximity repair');
  assert.equal(proximityMove.placement.graphicId, 'insertion:quote-copy');
  assert.equal(proximityMove.direction, 'down', 'the quote should move away from the lead text');
  assert.equal(proximityMove.distance, 5);
  assert.equal(proximityMove.estimatedPoints, 5, 'isolated linear proximity improvement is estimated from the measured gap');
  assert.equal(proximityMove.legalCapability, 'declared-movable-frame');
  assert.deepEqual(proximityMove.legalBounds, { x: 10, y: 5, width: 80, height: 60 });
  assert.ok(proximityOmission, 'an explicitly optional insertion with a negative attribution may also be evaluated as omitted');
  assert.equal(proximityOmission.legalCapability, 'input-allows-omission');
  assert.ok(proximityOmission.estimatedPoints > 0);
  assert.equal(proximityOmission.estimateKind, 'optional-omission');

  const insertionSymmetry = scoreInsertionSymmetry(repairPlan);
  const spacingRhythm = scoreSpacingRhythm(repairPlan);
  const insertionAttribution = attributeCompositionScore(repairDocument, repairPlan, [insertionSymmetry, spacingRhythm]);
  const insertionRepairs = compositionRepairProposals(repairDocument, repairPlan, [insertionSymmetry, spacingRhythm], insertionAttribution);
  const symmetryRepair = insertionRepairs.find((proposal) => proposal.sourceCode === 'insertion-symmetry');
  assert.ok(symmetryRepair, 'a movable insertion with asymmetric text gaps must receive an evaluator repair proposal');
  assert.equal(symmetryRepair.placement.blockId, 'quote-copy');
  assert.equal(symmetryRepair.direction, 'down', 'the quote must move away from its closer preceding text to balance both gaps');
  assert.equal(symmetryRepair.distance, 4);
  assert.equal(symmetryRepair.estimatedPoints, 6, 'the local symmetry estimate must represent the exact capped component recovery before reflow');
  const rhythmRepair = insertionRepairs.find((proposal) => proposal.sourceCode === 'spacing-rhythm');
  assert.ok(rhythmRepair, 'a movable insertion with an off-profile text gap must receive an evaluator repair proposal');
  assert.equal(rhythmRepair.direction, 'down', 'an undersized before-gap should propose moving the insertion down');
  assert.equal(rhythmRepair.measuredGap, 2);
  assert.equal(rhythmRepair.targetGap, 6);

  const fragmentationDocument = {
    flows: {
      main: { id: 'main', blocks: [{ id: 'fragmented-copy', kind: 'paragraph', role: 'body', text: 'A paragraph crosses a wrapping insertion.' }] },
      quotes: { id: 'quotes', blocks: [{ id: 'fragmenting-quote', kind: 'paragraph', role: 'quote', text: 'A wrapped insertion splits the paragraph.' }] },
    },
  };
  const fragmentationPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    slots: [
      { id: 'fragment-left', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 10, y: 15, width: 30, height: 40 }, state: 'partial' },
      { id: 'fragment-right', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 60, y: 15, width: 30, height: 40 }, state: 'partial' },
      { id: 'fragment-quote', page: 1, regionId: 'quotes', flowId: 'quotes', kind: 'text', box: { x: 40, y: 15, width: 20, height: 15 }, state: 'partial' },
    ],
    lines: [
      { ...line('fragmented-copy', 1, 'fragment-left', 0, 4), flowId: 'main', box: { x: 10, y: 20, width: 30, height: 5 } },
      { ...line('fragmented-copy', 1, 'fragment-right', 4, 8), flowId: 'main', box: { x: 60, y: 20, width: 30, height: 5 } },
    ],
    graphicPlacements: [{ id: 'graphic:fragmenting-quote', graphicId: 'insertion:fragmenting-quote', slotId: 'fragment-quote', page: 1, shape: 'rectangle', wrap: 'around', box: { x: 40, y: 15, width: 20, height: 15 } }],
    movableInsertionFrames: [{ id: 'quotes:fragmenting-quote', flowId: 'quotes', blockId: 'fragmenting-quote', page: 1, box: { x: 40, y: 5, width: 20, height: 60 }, axis: 'y', candidateCount: 5 }],
  };
  const fragmentationComponent = scoreParagraphFragmentation(fragmentationDocument, fragmentationPlan);
  const fragmentationAttribution = attributeCompositionScore(fragmentationDocument, fragmentationPlan, [fragmentationComponent]);
  const fragmentationRepairs = compositionRepairProposals(fragmentationDocument, fragmentationPlan, [fragmentationComponent], fragmentationAttribution);
  assert.equal(fragmentationComponent.value, 1, 'the split paragraph must be scored as one fragmentation');
  assert.ok(fragmentationRepairs.length > 0 && fragmentationRepairs.every((proposal) => proposal.estimateKind === 'fragmentation-recovery' && proposal.estimatedPoints === renderConfig.composition_score.paragraph_fragmentation_penalty && proposal.lineHeight === 5), `a movable insertion separating text intervals must receive labeled line-step fragmentation probes: ${JSON.stringify({ details: fragmentationComponent.details, attributed: fragmentationAttribution, proposals: fragmentationRepairs })}`);
  assert.deepEqual(new Set(fragmentationRepairs.map((proposal) => proposal.direction)), new Set(['up', 'down']), 'fragmentation proposals must consider both legal directions');

  repairPlan.graphicPlacements[0].wrap = 'around';
  repairPlan.graphicPlacements[0].box = { x: 10, y: 15, width: 20, height: 10 };
  repairPlan.slots[2].box = { x: 10, y: 5, width: 80, height: 70 };
  repairDocument.flows.main.blocks.push({ id: 'second-orphan-paragraph', kind: 'paragraph', role: 'body', text: 'A second paragraph has another isolated line.' });
  repairPlan.slots.push({ id: 'second-obstacle-slot', page: 1, regionId: 'art', flowId: 'main', kind: 'graphic', box: { x: 10, y: 60, width: 20, height: 15 }, state: 'open' });
  repairPlan.lines.push(
    { ...line('second-orphan-paragraph', 1, 'main-slot', 0, 4), flowId: 'main', box: { x: 10, y: 55, width: 80, height: 5 } },
    { ...line('second-orphan-paragraph', 1, 'main-slot', 4, 8), flowId: 'main', box: { x: 10, y: 70, width: 80, height: 5 } },
  );
  repairPlan.graphicPlacements.push({ id: 'graphic:second-obstacle', graphicId: 'second-obstacle', slotId: 'second-obstacle-slot', page: 1, shape: 'rectangle', wrap: 'around', box: { x: 10, y: 60, width: 20, height: 10 } });
  const orphanComponent = scoreOrphanLines(repairDocument, repairPlan);
  assert.equal(orphanComponent.value, 2, 'two blocked paragraphs should be measured as two orphan fragments');
  assert.equal(orphanComponent.points, -orphanComponent.value * configuredOrphanPenalty, 'orphan weight must scale with the configured per-orphan penalty');
  const orphanAttribution = attributeCompositionScore(repairDocument, repairPlan, [orphanComponent]);
  assert.equal(orphanAttribution.reduce((sum, item) => sum + item.points, 0), orphanComponent.points, 'orphan penalties must be conserved across paragraph and blocking image placements');
  const orphanRepairs = compositionRepairProposals(repairDocument, repairPlan, [orphanComponent], orphanAttribution);
  assert.ok(orphanRepairs.length > 0, `a vertically movable blocking image should receive line-height orphan probes: ${JSON.stringify({ details: orphanComponent.details, attribution: orphanAttribution })}`);
  const orphanMoveRepairs = orphanRepairs.filter((proposal) => proposal.estimateKind === 'orphan-recovery');
  assert.ok(orphanMoveRepairs.length > 0 && orphanMoveRepairs.every((proposal) => proposal.orphanCount === 1 && proposal.lineHeight === 5 && proposal.estimatedPoints === configuredOrphanPenalty), 'orphan probes must expose the configured per-orphan recovery as an estimate');
  assert.ok(orphanMoveRepairs.every((proposal) => Number.isInteger(proposal.distance / proposal.lineHeight)), 'orphan movement probes must remain in whole measured-line increments across refinement rounds');
  console.log(JSON.stringify({ status: 'passed', listSplit: listSplit.value, tableSplit: tableSplit.value, tinyFragments: tiny.value, qualityComponents: 6 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
