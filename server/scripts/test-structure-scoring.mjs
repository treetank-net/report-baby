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
const spacingReportBundlePath = join(temporary, 'spacing-report.cjs');
const scoringBundlePath = join(temporary, 'scoring.cjs');

try {
  await build({
    entryPoints: [join(root, 'src/composition/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundlePath,
  });
  await build({
    entryPoints: [join(root, 'src/composition/observability/spacing-report.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: spacingReportBundlePath,
  });
  await build({
    entryPoints: [join(root, 'src/composition/evaluation/scoring.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: scoringBundlePath,
  });
  const bundled = await import(bundlePath);
  const composition = bundled.default ?? bundled;
  const spacingReportModule = await import(spacingReportBundlePath);
  const attachPlanSpacingReport = spacingReportModule.attachPlanSpacingReport ?? spacingReportModule.default.attachPlanSpacingReport;
  const scoringBundle = await import(scoringBundlePath);
  const scoring = scoringBundle.default ?? scoringBundle;
  const { scoreInsertionSpacing, scoreInsertionTextContinuity, scoreHeaderSpacing, scoreMainStartDelay } = scoring;
  const { scoreListContinuity, scoreTableContinuity, scoreTinyFragments, scoreParagraphFragmentation, scoreInsertionSymmetry, scoreInsertionDistribution, scoreContentSpread, scoreSpacingRhythm, scorePageLoadBalance, scoreMainPageOccupancyBalance, scoreNarrowTextIntervals, scoreFooterGap, scoreGlyphOverlap, scoreElementProximity, elementProximityReports, scoreOrphanLines, attributeCompositionScore, compositionRepairProposals, scoreSiblingColumnImbalance, scoreEmptyRegions, scoreFitContentEnvelope, rectUnionArea } = composition;
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

  const gravityBlocks = ['quote-1', 'quote-2', 'quote-3', 'quote-4'].map((id) => ({ id, kind: 'paragraph', role: 'quote', text: 'Measured insertion.' }));
  const gravityDocument = { flows: { main: { id: 'main', blocks: [{ id: 'main-body', kind: 'paragraph', role: 'body', text: Array(100).fill('word').join(' ') }] }, quotes: { id: 'quotes', blocks: gravityBlocks } } };
  const gravityProgressLines = [
    [0, 12, 0], [13, 25, 20], [26, 37, 40], [38, 50, 60],
    [51, 62, 80], [63, 75, 100], [76, 87, 120], [88, 100, 140],
  ].map(([startWord, endWord, y], index) => ({
    ...line('main-body', 1, 'main-slot', startWord, endWord),
    box: { x: 10, y, width: 80, height: 5 },
  }));
  const gravityPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    slots: [
      { id: 'main-slot', page: 1, regionId: 'body', flowId: 'main', kind: 'text', box: { x: 10, y: 0, width: 80, height: 150 }, state: 'partial' },
      ...gravityBlocks.map((block, index) => ({ id: `quote-${index + 1}`, page: 1, regionId: 'body', flowId: 'quotes', kind: 'text', placement: { mode: 'fluid-y' }, box: { x: 10, y: 0, width: 80, height: 5 }, state: 'open' })),
    ],
    lines: gravityProgressLines,
    graphicPlacements: gravityBlocks.map((block, index) => ({
      id: `graphic:${block.id}`,
      graphicId: `insertion:${block.id}`,
      slotId: `quote-${index + 1}`,
      page: 1,
      shape: 'rectangle',
      wrap: 'around',
      box: { x: 10, y: [10, 50, 90, 130][index], width: 80, height: 5 },
      placementPolicy: { distribution: 'spread-through-content', rhythmGroup: 'editorial-material' },
    })),
  };
  const alignedGravity = scoreContentSpread(gravityDocument, gravityPlan);
  assert.equal(alignedGravity.points, renderConfig.composition_score.content_spread_reward, 'exact insertion positions interpolated between neighboring line word ranges must earn the full gravity reward');
  assert.deepEqual(alignedGravity.details.records.map((record) => record.actualProgress), [0.125, 0.375, 0.625, 0.875], 'gravity evidence must use each insertion box position, not only its page center');
  const displacedGravityPlan = structuredClone(gravityPlan);
  displacedGravityPlan.graphicPlacements[0].box.y = 100;
  assert.ok(scoreContentSpread(gravityDocument, displacedGravityPlan).points < alignedGravity.points, 'moving one insertion away from its weighted body-progress target must reduce gravity points');
  const tolerantGravityPlan = structuredClone(gravityPlan);
  tolerantGravityPlan.graphicPlacements[0].box.y = 40;
  assert.equal(scoreContentSpread(gravityDocument, tolerantGravityPlan).points, alignedGravity.points, 'positions inside the gravity tolerance must receive the full bounded reward');

  const singleGravityDocument = { flows: { ...gravityDocument.flows, quotes: { id: 'quotes', blocks: [gravityBlocks[0]] } } };
  const singleGravityPlan = structuredClone(gravityPlan);
  singleGravityPlan.graphicPlacements = [{ ...singleGravityPlan.graphicPlacements[0], box: { x: 10, y: 70, width: 80, height: 5 }, placementPolicy: { distribution: 'spread-through-content' } }];
  const singleGravity = scoreContentSpread(singleGravityDocument, singleGravityPlan);
  assert.equal(singleGravity.points, renderConfig.composition_score.content_spread_reward, 'one centered insertion without an explicit rhythm group must earn gravity points');
  assert.equal(singleGravity.details.records[0].expectedProgress, 0.5);
  const detachedGravityPlan = structuredClone(singleGravityPlan);
  detachedGravityPlan.pages.push({ page: 2 });
  detachedGravityPlan.slots.find(({ id }) => id === 'quote-1').page = 2;
  detachedGravityPlan.graphicPlacements[0].page = 2;
  const detachedGravity = scoreContentSpread(singleGravityDocument, detachedGravityPlan);
  assert.ok(detachedGravity.points < 0, 'moving the only distributed insertion beyond main content must incur measured gravity deviation');
  assert.equal(detachedGravity.details.records[0].mainTextOnPage, false);
  assert.equal(scoreContentSpread(singleGravityDocument, { ...singleGravityPlan, lines: [] }).details.records.length, 0, 'missing main progress must not be replaced with a fabricated target measurement');

  const weightedGravityDocument = { flows: { ...gravityDocument.flows, quotes: { id: 'quotes', blocks: [gravityBlocks[0], gravityBlocks[2]] } } };
  const weightedGravityPlan = { ...gravityPlan, graphicPlacements: [gravityPlan.graphicPlacements[0], gravityPlan.graphicPlacements[2]], spacing: {
    pages: [], slots: [], textPlacements: [], observations: [0, 2].map((index, ordinal) => ({ kind: 'insertion-rhythm', page: 1, graphicId: gravityPlan.graphicPlacements[index].graphicId,
      metrics: { visualLoadAreaShare: [0.1, 0.3][ordinal], visualLoadVerticalShare: [0.1, 0.3][ordinal], visualLoadAffectedLineShare: 0, visualLoad: [0.1, 0.3][ordinal] } })),
  } };
  const weightedGravity = scoreContentSpread(weightedGravityDocument, weightedGravityPlan);
  assert.deepEqual(weightedGravity.details.records.map(({ visualLoad }) => visualLoad), [0.1, 0.3], 'measured relative loads must retain their proportions below one');
  assert.deepEqual(weightedGravity.details.records.map(({ expectedProgress }) => expectedProgress), [0.125, 0.625], 'targets must follow cumulative insertion mass rather than equal item count');
  assert.equal(weightedGravity.points, renderConfig.composition_score.content_spread_reward);

  const delayedMainPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    flowPlacements: [{ page: 1, flowId: 'main', slotId: 'main-slot', hasContent: true, box: { x: 10, y: 10, width: 80, height: 80 } }],
    lines: [{ ...line('main-copy', 1, 'main-slot'), box: { x: 10, y: 25, width: 80, height: 5 } }],
    graphicPlacements: [{ page: 1, graphicId: 'insertion:quote', box: { x: 10, y: 10, width: 80, height: 12 } }],
  };
  const mainDelay = scoreMainStartDelay(delayedMainPlan);
  assert.equal(mainDelay.details.details[0].delay, 15, 'main-start delay must be measured from the flow slot to its first painted line');
  assert.equal(mainDelay.points, -15 * renderConfig.composition_score.main_start_delay_penalty, 'an insertion that blocks the first main line must apply the configured plan penalty');

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
        { kind: 'insertion-rhythm', page: 1, flowId: 'quotes', blockId: 'quote-copy', graphicId: 'insertion:quote-copy', slotId: 'quote', regionId: 'main', box: { x: 10, y: 45, width: 80, height: 8 }, metrics: { beforeTextGap: 2, afterTextGap: 7, textGapAsymmetry: 5, regionStartGap: 35, regionEndGap: 37, previousInsertionGap: 4, nextInsertionGap: 12, contentTop: 47, contentBottom: 51, contentInsetTop: 2, contentInsetBottom: 2, contentInsetImbalance: 0, 'textStreamBefore:column-a': 2, 'textStreamAfter:column-a': 8, 'textStreamBefore:column-b': 4, 'textStreamAfter:column-b': 6 }, intervals: [{ x: 10, width: 12 }] },
        { kind: 'element-proximity', page: 1, from: { kind: 'block', id: 'intro', flowId: 'intro', blockId: 'intro', slotId: 'intro' }, to: { kind: 'graphic', id: 'insertion:quote', slotId: 'quote' }, metrics: { gap: 1, minimumGap: 4, deficit: 3, movementNeeded: 3, movementBudget: 8 }, movementAvailable: true, reasons: ['elements-too-close'] },
        { kind: 'region', page: 1, flowId: 'header', regionId: 'chrome', cause: 'header-content-gap', metrics: { headerBottom: 10, firstContentTop: 12, headerContentGap: 2 }, reasons: ['chrome', 'header-content-gap'] },
      ],
    },
  };
  assert.ok(scoreInsertionSymmetry(spacingPlan).points < 0);
  assert.ok(scoreInsertionDistribution(spacingPlan).points < 0);
  assert.ok(scoreSpacingRhythm(spacingPlan).details.records.some((record) => record.deviation > renderConfig.composition_score.spacing_profile_tolerance_mm), 'the spacing fixture must retain an exact out-of-target finding even when bounded target rewards affect its net points');
  assert.ok(scoreNarrowTextIntervals(spacingPlan).points < 0);
  assert.ok(scoreElementProximity(spacingPlan).points < 0, 'an intro and insertion below the breathing-room threshold must be penalized');
  const insertionSpacing = scoreInsertionSpacing(spacingPlan);
  assert.equal(insertionSpacing.details.insertions[0].internal.imbalance, 0, 'insertion inset scoring must consume measured spacing-report metrics');
  assert.equal(insertionSpacing.details.insertions[0].externalImbalance, 4, 'stream gap imbalance must be scored from the shared observation');
  assert.equal(insertionSpacing.details.insertions[0].crossStreamSpread, 2, 'cross-stream spread must be scored from the shared observation');
  const zeroEdgeContinuityPlan = {
    ...basePlan,
    spacing: {
      ...spacingPlan.spacing,
      observations: [{
        kind: 'insertion-rhythm',
        page: 1,
        flowId: 'quotes',
        blockId: 'quote-copy',
        graphicId: 'insertion:quote-copy',
        slotId: 'quote',
        regionId: 'main',
        box: { x: 10, y: 45, width: 80, height: 8 },
        placementPolicy: { distribution: 'spread-through-content', distributionSource: 'template' },
        metrics: {
          contentTop: 47,
          contentBottom: 51,
          contentInsetTop: 2,
          contentInsetBottom: 2,
          'textStreamBefore:column-a': 4,
          'textStreamAfter:column-a': 0,
          'textStreamBeforeMass:column-a': 0.3,
          'textStreamAfterMass:column-a': 0.4,
          'textStreamBeforeLines:column-a': 6,
          'textStreamAfterLines:column-a': 8,
          'textStreamTotalLines:column-a': 14,
        },
      }],
    },
  };
  const zeroEdgeContinuity = scoreInsertionTextContinuity(zeroEdgeContinuityPlan);
  assert.ok(zeroEdgeContinuity.points < 0, 'a distributed insertion touching following text must lose quality points');
  assert.equal(zeroEdgeContinuity.details.records[0].streams[0].afterGap, 0, 'an exact zero edge gap must remain in continuity evidence');
  assert.ok(zeroEdgeContinuity.details.records[0].edgeGapDeficit > 0, 'an exact zero edge gap must produce a normalized deficit');
  const balancedContinuityPlan = structuredClone(zeroEdgeContinuityPlan);
  const balancedStreamMetrics = balancedContinuityPlan.spacing.observations[0].metrics;
  balancedStreamMetrics['textStreamBefore:column-a'] = renderConfig.composition_score.spacing_profile_normal_target_mm;
  balancedStreamMetrics['textStreamAfter:column-a'] = renderConfig.composition_score.spacing_profile_normal_target_mm;
  balancedStreamMetrics['textStreamBeforeMass:column-a'] = balancedStreamMetrics['textStreamAfterMass:column-a'];
  const balancedContinuity = scoreInsertionTextContinuity(balancedContinuityPlan);
  assert.equal(balancedContinuity.points, renderConfig.composition_score.insertion_text_continuity_reward, 'balanced measured text participation with usable gaps must earn a bounded reward');
  const repeatedContinuityPlan = structuredClone(balancedContinuityPlan);
  repeatedContinuityPlan.spacing.observations.push({ ...repeatedContinuityPlan.spacing.observations[0], page: 2, blockId: 'second-quote' });
  assert.equal(scoreInsertionTextContinuity(repeatedContinuityPlan).points, balancedContinuity.points, 'more measured insertions/pages must not multiply the continuity reward');
  const detachedContinuityPlan = structuredClone(balancedContinuityPlan);
  detachedContinuityPlan.lines = [line('main-body', 1, 'main-slot')];
  detachedContinuityPlan.spacing.observations[0].page = 2;
  const detachedMetrics = detachedContinuityPlan.spacing.observations[0].metrics;
  for (const key of ['BeforeMass', 'AfterMass', 'BeforeLines', 'AfterLines', 'TotalLines']) detachedMetrics[`textStream${key}:column-a`] = 0;
  delete detachedMetrics['textStreamBefore:column-a'];
  delete detachedMetrics['textStreamAfter:column-a'];
  const detachedContinuity = scoreInsertionTextContinuity(detachedContinuityPlan);
  assert.ok(detachedContinuity.points < 0, 'measured zero text around a distributed insertion must not escape continuity scoring');
  assert.equal(detachedContinuity.details.targetFitReward, 0);
  assert.equal(detachedContinuity.details.records[0].coverageDeficit, 1);
  assert.equal('massImbalance' in detachedContinuity.details.records[0], false, 'unmeasurable balance on an empty page remains absent');
  assert.equal('massBalance' in detachedContinuity.details.records[0].streams[0], false);
  const partiallyMeasuredContinuityPlan = structuredClone(balancedContinuityPlan);
  partiallyMeasuredContinuityPlan.spacing.observations[0].metrics['textStreamTotalLines:column-b'] = 10;
  const partiallyMeasuredContinuity = scoreInsertionTextContinuity(partiallyMeasuredContinuityPlan);
  assert.equal(partiallyMeasuredContinuity.details.targetFitReward, 0, 'one known good stream must not earn a full continuity reward while another declared stream is unmeasured');
  assert.equal(partiallyMeasuredContinuity.details.records[0].streamMeasurementComplete, false);
  const missingContinuityPlan = structuredClone(detachedContinuityPlan);
  delete missingContinuityPlan.spacing.observations[0].metrics['textStreamBeforeMass:column-a'];
  assert.equal(scoreInsertionTextContinuity(missingContinuityPlan).details.records.length, 0, 'missing stream measurements must not be treated as measured zero text');
  detachedContinuityPlan.spacing.observations[0].placementPolicy.distribution = 'free';
  assert.equal(Math.abs(scoreInsertionTextContinuity(detachedContinuityPlan).points), 0, 'an explicitly free dedicated insertion page must remain outside distribution continuity scoring');
  const headerSpacing = scoreHeaderSpacing(spacingPlan);
  assert.equal(headerSpacing.details.pages[0].headerBottom, 10, 'header spacing must consume report-owned geometry');
  assert.equal(headerSpacing.details.pages[0].gap, 2, 'header spacing must use the shared gap measurement');
  assert.equal(headerSpacing.points, -4, 'the configured header threshold must still score the measured deficit');
  const headerGapExcess = renderConfig.composition_score.spacing_profile_tolerance_mm;
  const headerGapReference = renderConfig.composition_score.spacing_profile_normal_target_mm;
  const largeHeaderGapPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    lines: [
      { ...line('header-copy', 1, '1:header-slot'), flowId: 'header', slotId: '1:header-slot' },
      { ...line('body-copy', 1, '1:content-slot'), flowId: 'main', slotId: '1:content-slot', box: { x: 10, y: 70, width: 80, height: 5 } },
    ],
    slots: [
      { id: '1:header-slot', page: 1, regionId: 'chrome', flowId: 'header', kind: 'text', box: { x: 10, y: 5, width: 80, height: 10 }, state: 'partial' },
      { id: '1:content-slot', page: 1, regionId: 'main', flowId: 'main', kind: 'text', box: { x: 10, y: 20, width: 80, height: 80 }, state: 'partial' },
    ],
    spacing: {
      pages: [], slots: [], textPlacements: [],
      observations: [{
        kind: 'region', page: 1, flowId: 'main', blockId: 'body-copy', slotId: '1:content-slot', templateRef: 'large-header-gap', owner: 'chrome', cause: 'header-content-gap', profile: 'normal',
        from: { kind: 'block', id: 'header-copy', blockId: 'header-copy', flowId: 'header', slotId: '1:header-slot' },
        to: { kind: 'block', id: 'body-copy', blockId: 'body-copy', flowId: 'main', slotId: '1:content-slot' },
        fromBox: { x: 10, y: 5, width: 80, height: 10 }, toBox: { x: 10, y: 70, width: 80, height: 5 },
        metrics: { headerBottom: 15, firstContentTop: 70, headerContentGap: headerGapReference + (headerGapExcess * 2), referenceGap: headerGapReference },
      }],
    },
  };
  const largeHeaderSpacing = scoreHeaderSpacing(largeHeaderGapPlan);
  assert.equal(largeHeaderSpacing.details.pages[0].excess, headerGapExcess, 'a chrome-to-content gap beyond the profile tolerance must expose its measured excess');
  assert.equal(largeHeaderSpacing.points, -headerGapExcess * renderConfig.composition_score.header_content_gap_penalty, 'large header whitespace must carry a configurable penalty');
  const headerGapDocument = { flows: {
    header: { id: 'header', blocks: [{ id: 'header-copy', kind: 'paragraph', role: 'header', text: 'Header copy.' }] },
    main: { id: 'main', blocks: [{ id: 'body-copy', kind: 'paragraph', role: 'body', text: 'Main copy.' }] },
  } };
  const headerGapAttribution = attributeCompositionScore(headerGapDocument, largeHeaderGapPlan, [largeHeaderSpacing]);
  assert.deepEqual(headerGapAttribution.map((entry) => entry.placement.blockId).sort(), ['body-copy', 'header-copy'], 'header-gap loss must be attributed to the two elements that define the measured gap');
  assert.equal(headerGapAttribution.reduce((sum, entry) => sum + entry.points, 0), largeHeaderSpacing.points, 'header-gap attribution must conserve its whole-plan penalty');
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
  for (const kind of ['image', 'table']) {
    const materialPlan = structuredClone(proximityPlan);
    const placement = { id: `${kind}:quote-1`, blockId: 'quote-1', kind, page: 1, slotId: '1:quotes', box: { ...materialPlan.graphicPlacements[0].box } };
    materialPlan[kind === 'table' ? 'tablePlacements' : 'blockPlacements'] = [placement];
    const materialDocument = structuredClone(proximityDocument);
    materialDocument.flows.quotes.blocks[0].kind = kind;
    assert.deepEqual(elementProximityReports(materialPlan, materialDocument), tooClose, 'an atomic/table insertion and its enclosing graphic must be one proximity subject, preserving real neighboring deficits');
    materialPlan.graphicPlacements = [];
    const standalone = elementProximityReports(materialPlan, materialDocument);
    assert.equal(standalone.length, 1, 'an ordinary structured block without an insertion proxy must remain measurable');
    assert.equal(standalone[0].to.kind, 'block');
  }
  const wellSpacedPairPlan = structuredClone(proximityPlan);
  wellSpacedPairPlan.graphicPlacements[0].box.y = 30 + renderConfig.composition_score.spacing_profile_normal_target_mm;
  const wellSpacedPairs = elementProximityReports(wellSpacedPairPlan, proximityDocument);
  const pairRewardPlan = { ...wellSpacedPairPlan, spacing: { pages: [], slots: [], textPlacements: [], observations: wellSpacedPairs } };
  assert.equal(wellSpacedPairs[0].adjacent, true);
  assert.equal(wellSpacedPairs[0].metrics.deficit, 0);
  assert.deepEqual(wellSpacedPairs[0].reasons, [], 'a well-spaced pair must not carry a violation reason');
  const wellSpacedPairScore = scoreElementProximity(pairRewardPlan);
  assert.equal(wellSpacedPairScore.points, renderConfig.composition_score.element_proximity_reward, 'measured neighboring boxes at the selected profile gap must earn positive points');
  assert.deepEqual(wellSpacedPairScore.details.rewardRecords[0].fromBox, wellSpacedPairs[0].fromBox);
  const withinPairTolerance = structuredClone(pairRewardPlan);
  withinPairTolerance.spacing.observations[0].metrics.gap += renderConfig.composition_score.spacing_profile_tolerance_mm;
  assert.equal(scoreElementProximity(withinPairTolerance).points, wellSpacedPairScore.points, 'the acceptable spacing interval must earn full reward');
  pairRewardPlan.spacing.observations.push({ ...wellSpacedPairs[0], page: 2 });
  assert.equal(scoreElementProximity(pairRewardPlan).points, wellSpacedPairScore.points, 'adding an equally good measured pair/page must not multiply reward');
  const interveningPairPlan = structuredClone(wellSpacedPairPlan);
  interveningPairPlan.graphicPlacements[0].box.y = 80;
  interveningPairPlan.graphicPlacements.push({ ...interveningPairPlan.graphicPlacements[0], id: 'graphic:middle', graphicId: 'insertion:middle', box: { x: 10, y: 50, width: 80, height: 8 } });
  const interveningPairs = elementProximityReports(interveningPairPlan, proximityDocument);
  assert.equal(interveningPairs.find(({ from, to }) => from.id === 'intro-copy' && to.id === 'insertion:quote-1').adjacent, false, 'a box between two subjects must prevent scoring their distance as a local neighbor reward');
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
    lines: [{
      ...line('paragraph', 1, 'text-1'),
      glyphSamplingBoxes: [{ box: { x: 10, y: 10, width: 20, height: 5 }, baselineY: 14 }],
    }],
    glyphPlacements: [{ id: 'glyph-placement:quote:1', glyphId: 'quote', targetType: 'block', targetId: 'paragraph', page: 1, slotId: 'text-1', text: '”', styleName: 'quote-mark', source: 'generated', anchor: 'text-end', box: { x: 10, y: 10, width: 5, height: 5 }, baselineY: 14 }],
  };
  const overlappingGlyphScore = scoreGlyphOverlap(overlappingGlyph);
  assert.ok(overlappingGlyphScore.points < 0, 'glyphs intruding into painted character cells must be penalized');
  assert.ok(overlappingGlyphScore.details.records[0].overlapBox, 'glyph overlap evidence must include the measured intersection box');
  overlappingGlyph.glyphPlacements[0].box.x = 100;
  assert.equal(Math.abs(scoreGlyphOverlap(overlappingGlyph).points), 0, 'glyphs outside painted character cells must not be penalized');
  const glyphInUnusedLineEnvelope = {
    ...basePlan,
    lines: [{
      ...line('paragraph', 1, 'text-1'),
      glyphSamplingBoxes: [{ box: { x: 10, y: 10, width: 20, height: 5 }, baselineY: 14 }],
    }],
    glyphPlacements: [{ id: 'glyph-placement:quote:2', glyphId: 'quote', targetType: 'block', targetId: 'paragraph', page: 1, slotId: 'text-1', text: '”', styleName: 'quote-mark', source: 'generated', anchor: 'text-end', box: { x: 80, y: 10, width: 5, height: 5 }, baselineY: 14 }],
  };
  assert.equal(Math.abs(scoreGlyphOverlap(glyphInUnusedLineEnvelope).points), 0, 'an offset glyph in unused slot width must not be mistaken for a text overlap');
  const balancedSpacingPlan = structuredClone(spacingPlan);
  balancedSpacingPlan.spacing.observations[0] = {
    ...balancedSpacingPlan.spacing.observations[0],
    profile: 'compact',
    metrics: { beforeTextGap: 4, afterTextGap: 4, textGapAsymmetry: 0, regionStartGap: 4, regionEndGap: 4, referenceGap: 4 },
  };
  assert.equal(scoreInsertionSymmetry(balancedSpacingPlan).points, renderConfig.composition_score.insertion_symmetry_reward, 'symmetric measured text gaps must earn the configured bounded reward');
  assert.equal(scoreSpacingRhythm(balancedSpacingPlan).points, renderConfig.composition_score.spacing_profile_reward, 'gaps at the resolved compact target must earn the configured bounded reward');
  const offTargetSpacingPlan = structuredClone(balancedSpacingPlan);
  offTargetSpacingPlan.spacing.observations[0].metrics = { beforeTextGap: 10, afterTextGap: 10, regionStartGap: 10, regionEndGap: 10, referenceGap: 4 };
  assert.ok(scoreSpacingRhythm(offTargetSpacingPlan).points < scoreSpacingRhythm(balancedSpacingPlan).points, 'spacing deviations must reduce the target-fit reward and apply the existing penalty beyond tolerance');

  const occupancyPlan = {
    ...basePlan,
    lines: [1, 2, 3, 4, 5].map((page) => line(`main-${page}`, page, `main-${page}`)),
    spacing: {
      pages: [],
      slots: [2, 3, 4].map((page) => ({ page, slotId: `main-${page}`, regionId: 'body', flowId: 'main', box: { x: 0, y: 0, width: 100, height: 100 }, occupiedHeight: renderConfig.composition_score.main_page_occupancy_target * 100, remainingHeight: 100 - (renderConfig.composition_score.main_page_occupancy_target * 100), gapBefore: 0, gapAfter: 25 })).concat([{ page: 5, slotId: 'main-5', regionId: 'body', flowId: 'main', box: { x: 0, y: 0, width: 100, height: 100 }, occupiedHeight: 5, remainingHeight: 95, gapBefore: 0, gapAfter: 90 }]),
      textPlacements: [],
      observations: [],
    },
  };
  const balancedOccupancy = scoreMainPageOccupancyBalance(occupancyPlan);
  assert.equal(balancedOccupancy.points, renderConfig.composition_score.main_page_occupancy_reward, 'a natural terminal fragment must preserve the full interior-page reward');
  assert.equal(balancedOccupancy.details.terminalPenalty, 0, 'terminal density alone is not evidence of an avoidable layout defect');
  assert.equal(balancedOccupancy.details.terminalPage.reason, 'natural-terminal-main-flow');
  assert.equal(balancedOccupancy.details.terminalPage.occupancy, 0.05, 'terminal-page ink density must be exposed as score evidence');
  const sparseInteriorPlan = structuredClone(occupancyPlan);
  sparseInteriorPlan.spacing.slots[1].occupiedHeight = (renderConfig.composition_score.main_page_occupancy_target - renderConfig.composition_score.main_page_occupancy_tolerance * 1.5) * 100;
  assert.ok(scoreMainPageOccupancyBalance(sparseInteriorPlan).points < scoreMainPageOccupancyBalance(occupancyPlan).points, 'a sparse interior page must reduce the planned-ink distribution reward');

  const balancedPageLoadPlan = {
    ...basePlan,
    pages: [1, 2, 3, 4].map((page) => ({ page })),
    lines: [2, 3].flatMap((page) => [0, 1, 2, 3].map((index) => ({ ...line(`main-${page}-${index}`, page, `main-${page}`), startWord: index, endWord: index + 1 }))),
    slots: [2, 3].map((page) => ({ id: `quote-slot-${page}`, page, regionId: 'body', flowId: 'quotes', kind: 'text', placement: { mode: 'fluid-y' }, box: { x: 10, y: 40, width: 80, height: 12 }, state: 'open' })),
    graphicPlacements: [2, 3].map((page) => ({ id: `graphic:${page}`, graphicId: `insertion:quote-${page}`, slotId: `quote-slot-${page}`, page, shape: 'rectangle', wrap: 'around', box: { x: 10, y: 40, width: 80, height: 12 }, placementPolicy: { distribution: 'spread-across-pages', rhythmGroup: 'materials' } })),
  };
  assert.equal(scorePageLoadBalance(balancedPageLoadPlan).points, renderConfig.composition_score.page_load_balance_reward, 'equal measured insertion loads across eligible pages must earn the configured reward');
  const detachedPageLoadPlan = structuredClone(balancedPageLoadPlan);
  detachedPageLoadPlan.slots.push({ ...detachedPageLoadPlan.slots[0], id: 'quote-slot-4', page: 4 });
  detachedPageLoadPlan.graphicPlacements = detachedPageLoadPlan.graphicPlacements.map((graphic) => ({ ...graphic, page: 4, slotId: 'quote-slot-4' }));
  const detachedPageLoad = scorePageLoadBalance(detachedPageLoadPlan);
  assert.equal(detachedPageLoad.details.targetFitReward, 0, 'moving all insertion mass beyond the body must not earn full reward for two equally empty body pages');
  assert.deepEqual(detachedPageLoad.details.records[0].unassociatedGraphicIds, detachedPageLoadPlan.graphicPlacements.map(({ graphicId }) => graphicId));
  const imbalancedPageLoadPlan = structuredClone(balancedPageLoadPlan);
  imbalancedPageLoadPlan.graphicPlacements.push({ ...imbalancedPageLoadPlan.graphicPlacements[0], id: 'graphic:extra', graphicId: 'insertion:extra', slotId: 'quote-slot-2' });
  assert.ok(scorePageLoadBalance(imbalancedPageLoadPlan).points < scorePageLoadBalance(balancedPageLoadPlan).points, 'an imbalanced visual load must earn fewer points and can incur the existing penalty');
  const boundaryInsertionPlan = structuredClone(spacingPlan);
  boundaryInsertionPlan.spacing.observations[0] = {
    ...boundaryInsertionPlan.spacing.observations[0],
    cause: 'template-fluid-insertion-capability',
    metrics: { beforeTextGap: 0.5, afterTextGap: 0, regionStartGap: 35, regionEndGap: 37, nextInsertionGap: 12, referenceGap: 6 },
  };
  boundaryInsertionPlan.slots = [
    { id: 'quote', page: 1, regionId: 'main', kind: 'text', placement: { mode: 'fluid-y', region: 'main', maxInstancesPerPage: 2 }, box: { x: 10, y: 45, width: 80, height: 8 }, state: 'open' },
    { id: 'quote-next', page: 1, regionId: 'main', kind: 'text', placement: { mode: 'fluid-y', region: 'main', maxInstancesPerPage: 2 }, box: { x: 10, y: 65, width: 80, height: 8 }, state: 'open' },
  ];
  boundaryInsertionPlan.spacing.observations.push({
    ...boundaryInsertionPlan.spacing.observations[0],
    blockId: 'quote-next',
    graphicId: 'insertion:quote-next',
    slotId: 'quote-next',
    box: { x: 10, y: 65, width: 80, height: 8 },
    metrics: { beforeTextGap: 0, afterTextGap: 0.5, regionStartGap: 55, regionEndGap: 17, previousInsertionGap: 12, nextInsertionGap: 12, referenceGap: 6 },
  });
  assert.equal(Math.abs(scoreInsertionSymmetry(boundaryInsertionPlan).points), 0, 'a boundary insertion without text on both sides must not be scored as asymmetric');
  assert.equal(Math.abs(scoreSpacingRhythm(boundaryInsertionPlan).points), 0, 'a boundary insertion without text on both sides must not be scored against ordinary text rhythm');
  assert.equal(Math.abs(scoreInsertionDistribution(boundaryInsertionPlan).points), 0, 'fluid capability distribution must not use the whole content envelope as an outer gap');
  const evenInsertionDistributionPlan = structuredClone(boundaryInsertionPlan);
  evenInsertionDistributionPlan.slots = evenInsertionDistributionPlan.slots.map(({ placement, ...slot }) => slot);
  evenInsertionDistributionPlan.spacing.observations = evenInsertionDistributionPlan.spacing.observations.map((observation) => ({
    ...observation,
    metrics: { regionStartGap: 20, regionEndGap: 20, previousInsertionGap: 20, nextInsertionGap: 20 },
  }));
  assert.equal(scoreInsertionDistribution(evenInsertionDistributionPlan).points, renderConfig.composition_score.insertion_distribution_reward, 'even measured insertion gaps must earn the configured bounded reward');
  const plannerOwnedBoundaryPlan = structuredClone(boundaryInsertionPlan);
  plannerOwnedBoundaryPlan.spacing.observations = plannerOwnedBoundaryPlan.spacing.observations.map((observation) => ({
    ...observation,
    owner: 'planner',
    cause: 'planner-selected-insertion-position',
  }));
  assert.equal(
    scoreInsertionDistribution(plannerOwnedBoundaryPlan).points,
    scoreInsertionDistribution(boundaryInsertionPlan).points,
    'planner attribution must not change insertion-distribution scoring for identical fluid-slot geometry',
  );
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
      { id: 'quote-slot-later', page: 1, regionId: 'body', flowId: 'quotes', kind: 'text', box: { x: 10, y: 70, width: 80, height: 20 }, state: 'open' },
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
  const proximityRelocation = proximityRepairs.find((proposal) => proposal.action === 'relocate');
  assert.ok(proximityRelocation, 'a same-page proximity conflict must also propose a compatible free insertion capability');
  assert.equal(proximityRelocation.placement.graphicId, 'insertion:quote-copy');
  assert.equal(proximityRelocation.destination.slotId, 'quote-slot-later');
  assert.equal(proximityRelocation.legalCapability, 'compatible-slot');
  assert.equal(proximityRelocation.estimateKind, 'relocation');
  assert.equal(proximityRelocation.evidencePlacementId, proximityAttribution.find((entry) => entry.placement.blockId === 'intro-copy')?.placement.id);
  assert.ok(proximityOmission, 'an explicitly optional insertion with a negative attribution may also be evaluated as omitted');
  assert.equal(proximityOmission.legalCapability, 'input-allows-omission');
  assert.ok(proximityOmission.estimatedPoints > 0);
  assert.equal(proximityOmission.estimateKind, 'optional-omission');

  const movableGlyphPlan = structuredClone(repairPlan);
  movableGlyphPlan.lines.find((candidate) => candidate.flowId === 'main').glyphSamplingBoxes = [
    { box: { x: 10, y: 10, width: 5, height: 5 }, baselineY: 14 },
  ];
  movableGlyphPlan.glyphPlacements = [{
    id: 'glyph-placement:quote-open:1', glyphId: 'quote-open', targetType: 'block', targetId: 'quote-copy',
    flowId: 'quotes', page: 1, slotId: 'quote-slot', text: '“', styleName: 'quote-mark', source: 'authored',
    anchor: 'text-start', box: { x: 10, y: 14, width: 5, height: 5 }, baselineY: 18,
  }];
  const movableGlyphComponent = scoreGlyphOverlap(movableGlyphPlan);
  const movableGlyphAttribution = attributeCompositionScore(repairDocument, movableGlyphPlan, [movableGlyphComponent]);
  const glyphOverlapRepairs = compositionRepairProposals(repairDocument, movableGlyphPlan, [movableGlyphComponent], movableGlyphAttribution);
  const glyphOverlapRepair = glyphOverlapRepairs.find((proposal) => proposal.sourceCode === 'glyph-overlap' && proposal.direction === 'down');
  assert.ok(glyphOverlapRepair, `an overlapping quote glyph must propose moving its insertion when that insertion has a declared movement frame: ${JSON.stringify({ component: movableGlyphComponent, attribution: movableGlyphAttribution, proposals: glyphOverlapRepairs })}`);
  assert.equal(glyphOverlapRepair.placement.graphicId, 'insertion:quote-copy');
  assert.equal(glyphOverlapRepair.distance, 1.5, 'glyph repair should move just past the measured overlap, plus the configured minimum geometry step');
  assert.equal(glyphOverlapRepair.overlapArea, 5, 'glyph repair must expose the measured external overlap area');
  assert.equal(glyphOverlapRepair.estimatedPoints, 20, 'glyph repair estimate must use the configured area penalty and measured recovered area');
  assert.equal(glyphOverlapRepair.evidencePlacementId, movableGlyphAttribution.find((entry) => entry.placement.blockId === 'orphan-paragraph')?.placement.id, 'glyph repair must identify the text placement that it overlaps');
  const combinedRepairComponents = [scoreElementProximity(movableGlyphPlan), movableGlyphComponent];
  const combinedRepairAttribution = attributeCompositionScore(repairDocument, movableGlyphPlan, combinedRepairComponents);
  const prioritizedRepairs = compositionRepairProposals(repairDocument, movableGlyphPlan, combinedRepairComponents, combinedRepairAttribution);
  assert.ok(prioritizedRepairs[0].estimatedPoints >= prioritizedRepairs[1].estimatedPoints, 'the bounded refinement list must prioritize the largest estimated local improvements across quality domains');
  assert.equal(prioritizedRepairs[0].sourceCode, 'glyph-overlap', 'a severe glyph collision must not be starved behind a lower-value repair from an earlier scorer');
  const fixedGlyphPlan = structuredClone(movableGlyphPlan);
  delete fixedGlyphPlan.movableInsertionFrames;
  const fixedGlyphAttribution = attributeCompositionScore(repairDocument, fixedGlyphPlan, [scoreGlyphOverlap(fixedGlyphPlan)]);
  assert.equal(compositionRepairProposals(repairDocument, fixedGlyphPlan, [scoreGlyphOverlap(fixedGlyphPlan)], fixedGlyphAttribution).some((proposal) => proposal.sourceCode === 'glyph-overlap'), false, 'authored glyphs must stay fixed unless their target insertion has a declared legal movement frame');

  const insertionSymmetry = scoreInsertionSymmetry(repairPlan);
  const spacingRhythm = scoreSpacingRhythm(repairPlan);
  const insertionAttribution = attributeCompositionScore(repairDocument, repairPlan, [insertionSymmetry, spacingRhythm]);
  const insertionRepairs = compositionRepairProposals(repairDocument, repairPlan, [insertionSymmetry, spacingRhythm], insertionAttribution);
  const symmetryRepair = insertionRepairs.find((proposal) => proposal.sourceCode === 'insertion-symmetry' && proposal.action === 'move' && proposal.direction === 'down');
  assert.ok(symmetryRepair, 'a movable insertion with asymmetric text gaps must receive an evaluator repair proposal');
  assert.equal(symmetryRepair.placement.blockId, 'quote-copy');
  assert.equal(symmetryRepair.direction, 'down', 'the quote must move away from its closer preceding text to balance both gaps');
  assert.equal(symmetryRepair.distance, 4);
  assert.equal(symmetryRepair.estimatedPoints, 6, 'the local symmetry estimate must represent the exact capped component recovery before reflow');
  const rhythmRepair = insertionRepairs.find((proposal) => proposal.sourceCode === 'spacing-rhythm' && proposal.action === 'move' && proposal.direction === 'down' && proposal.measuredGap === 2);
  assert.ok(rhythmRepair, 'a movable insertion with an off-profile text gap must receive an evaluator repair proposal');
  assert.equal(rhythmRepair.direction, 'down', 'an undersized before-gap should propose moving the insertion down');
  assert.equal(rhythmRepair.measuredGap, 2);
  assert.equal(rhythmRepair.targetGap, 6);

  const distributionDocument = structuredClone(repairDocument);
  distributionDocument.flows.quotes.blocks.push({ id: 'quote-copy-2', kind: 'paragraph', role: 'quote', text: 'A second short quote.' });
  const distributionPlan = structuredClone(repairPlan);
  distributionPlan.slots.push({ id: 'quote-slot-2', page: 1, regionId: 'body', flowId: 'quotes', kind: 'text', box: { x: 10, y: 45, width: 80, height: 20 }, state: 'open' });
  distributionPlan.graphicPlacements.push({ id: 'graphic:insertion:quote-copy-2', graphicId: 'insertion:quote-copy-2', slotId: 'quote-slot-2', page: 1, shape: 'rectangle', wrap: 'around', box: { x: 10, y: 50, width: 80, height: 8 } });
  distributionPlan.movableInsertionFrames.push({ id: 'quotes:quote-copy-2', flowId: 'quotes', blockId: 'quote-copy-2', page: 1, box: { x: 10, y: 5, width: 80, height: 60 }, axis: 'y', candidateCount: 5 });
  distributionPlan.spacing.observations = [
    { kind: 'insertion-rhythm', page: 1, regionId: 'body', flowId: 'quotes', blockId: 'quote-copy', graphicId: 'insertion:quote-copy', slotId: 'quote-slot', box: { x: 10, y: 16, width: 80, height: 8 }, metrics: { regionStartGap: 5, nextInsertionGap: 30 } },
    { kind: 'insertion-rhythm', page: 1, regionId: 'body', flowId: 'quotes', blockId: 'quote-copy-2', graphicId: 'insertion:quote-copy-2', slotId: 'quote-slot-2', box: { x: 10, y: 50, width: 80, height: 8 }, metrics: { previousInsertionGap: 30, regionEndGap: 5 } },
  ];
  const distributionComponent = scoreInsertionDistribution(distributionPlan);
  const distributionAttribution = attributeCompositionScore(distributionDocument, distributionPlan, [distributionComponent]);
  const distributionRepairs = compositionRepairProposals(distributionDocument, distributionPlan, [distributionComponent], distributionAttribution);
  assert.ok(distributionComponent.points < 0, 'uneven insertion gaps must produce a distribution penalty');
  const distributionMoves = distributionRepairs.filter((proposal) => proposal.sourceCode === 'insertion-distribution' && proposal.action === 'move');
  assert.ok(distributionMoves.length >= 2, `each movable edge insertion should receive a local distribution correction: ${JSON.stringify({ component: distributionComponent, proposals: distributionRepairs })}`);
  assert.ok(distributionMoves.some((proposal) => proposal.direction === 'down') && distributionMoves.some((proposal) => proposal.direction === 'up'), 'distribution correction must consider the direction that equalizes each adjacent gap pair');
  assert.ok(distributionMoves.every((proposal) => proposal.estimatedPoints > 0 && proposal.legalCapability === 'declared-movable-frame'), 'distribution corrections must expose positive bounded local estimates');

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
  const naturalFragmentation = scoreParagraphFragmentation(fragmentationDocument, { ...fragmentationPlan, graphicPlacements: [] });
  assert.equal(Math.abs(naturalFragmentation.points), 0, 'a natural column transition must not acquire an obstacle-fragmentation cost');
  assert.deepEqual(naturalFragmentation.details.naturalFragmentedBlockIds, ['fragmented-copy']);
  const boundedScore = scoring.scoreLegalPlan(fragmentationDocument, fragmentationPlan);
  const expectedCeiling = renderConfig.composition_score.base + renderConfig.composition_score.column_balance_weight
    + ['insertion_text_continuity_reward', 'insertion_symmetry_reward', 'insertion_distribution_reward', 'content_spread_reward', 'page_load_balance_reward', 'main_page_occupancy_reward', 'spacing_profile_reward', 'element_proximity_reward'].reduce((sum, key) => sum + renderConfig.composition_score[key], 0);
  assert.equal(boundedScore.scoreUpperBound, expectedCeiling, 'the document ceiling must be derived from all configured bounded rewards');
  assert.ok(boundedScore.measuredRewardUpperBound <= boundedScore.scoreUpperBound);
  assert.equal(boundedScore.breakdown.find(({ code }) => code === 'content-spread').rewardEvidence, 'not-applicable');
  assert.equal(boundedScore.breakdown.find(({ code }) => code === 'content-spread').ceilingGap, undefined, 'unavailable evidence must not invent recoverable points');
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
  const geometry = {
    width: 100, height: 100, margin: 0,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    columns: { count: 1, gutter: 0, widths: [100] },
    content: { x: 0, top: 0, width: 100, bottom: 100 },
    segments: [{ x: 0, top: 0, width: 100, bottom: 100 }],
    bands: {}, flowObstacles: [], blockFrames: {},
    flow: { align: 'left', hyphenate: false }, dynamicFlow: true,
  };
  attachPlanSpacingReport(repairPlan, repairDocument, {
    units: 'mm',
    measureText: (text) => text.length,
    lineHeight: () => 5,
  }, geometry);
  const terminalGapDocument = {
    flows: {
      main: { id: 'main', blocks: [{ id: 'terminal-body', kind: 'paragraph', role: 'body', text: 'Body text before the insertion.' }] },
      quotes: { id: 'quotes', blocks: [{ id: 'terminal-quote', kind: 'paragraph', role: 'quote', text: 'A terminal quote.' }] },
      footer: { id: 'footer', blocks: [{ id: 'terminal-footer', kind: 'paragraph', role: 'footer', text: 'Footer label.' }] },
    },
  };
  const terminalGapPlan = {
    ...basePlan,
    pages: [{ page: 1 }],
    slots: [
      { id: 'terminal-main-slot', page: 1, regionId: 'body', flowId: 'main', kind: 'text', box: { x: 10, y: 10, width: 80, height: 80 }, state: 'partial' },
      { id: 'terminal-quote-slot', page: 1, regionId: 'body', flowId: 'quotes', kind: 'text', box: { x: 10, y: 30, width: 80, height: 30 }, state: 'partial' },
      { id: 'terminal-footer-slot', page: 1, regionId: 'chrome', flowId: 'footer', kind: 'text', box: { x: 10, y: 90, width: 80, height: 8 }, state: 'partial' },
    ],
    lines: [
      { ...line('terminal-body', 1, 'terminal-main-slot'), flowId: 'main', box: { x: 10, y: 20, width: 80, height: 5 } },
      { ...line('terminal-footer', 1, 'terminal-footer-slot'), flowId: 'footer', box: { x: 10, y: 95, width: 80, height: 5 } },
    ],
    graphicPlacements: [{ id: 'graphic:insertion:terminal-quote', graphicId: 'insertion:terminal-quote', slotId: 'terminal-quote-slot', page: 1, shape: 'rectangle', wrap: 'around', box: { x: 10, y: 40, width: 80, height: 10 } }],
  };
  attachPlanSpacingReport(terminalGapPlan, terminalGapDocument, {
    units: 'mm',
    measureText: (text) => text.length,
    lineHeight: () => 5,
  }, geometry);
  const terminalGapObservation = terminalGapPlan.spacing.observations
    .find((observation) => observation.kind === 'insertion-rhythm');
  assert.equal(terminalGapObservation?.metrics.beforeTextGap, 15, 'the measured insertion gap must use body text in the same region');
  assert.equal(terminalGapObservation?.metrics.afterTextGap, undefined, 'footer chrome must not be mistaken for text following a terminal insertion');
  assert.equal(terminalGapObservation?.metrics.textGapAsymmetry, undefined, 'a terminal insertion with no following body text has no two-sided symmetry measurement');
  assert.equal(scoreSpacingRhythm(terminalGapPlan).points, 0, 'a terminal insertion without body text on both sides must not be scored against text rhythm');
  assert.equal(scoreInsertionSymmetry(terminalGapPlan).points, 0, 'a terminal insertion without body text on both sides must not receive an asymmetry penalty');
  const reportedOrphans = repairPlan.spacing.observations.filter((observation) => observation.kind === 'orphan-fragment');
  assert.equal(reportedOrphans.length, 2, 'the shared spacing report must identify each isolated fragment at a wrap obstacle');
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
  assert.ok(orphanRepairs.filter((proposal) => proposal.action === 'relocate').every((proposal) => proposal.estimateKind === 'relocation'), 'slot relocation estimates must remain distinct from line-step orphan movement estimates');
  console.log(JSON.stringify({ status: 'passed', listSplit: listSplit.value, tableSplit: tableSplit.value, tinyFragments: tiny.value, qualityComponents: 6 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
