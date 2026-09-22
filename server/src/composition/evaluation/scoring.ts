import { readRenderConfig } from '../../template/builtins.js';

import type { CompositionDocument, CompositionBlock } from '../contracts/model.js';

import type { CompositionContrastAssessment } from './contrast.js';

import type { CompositionPlan, CompositionScoreComponent } from '../contracts/engine-contracts.js';

import { allLines } from './plan-queries.js';
import { scoreListContinuity, scoreTableContinuity, scoreTinyFragments } from './structure-scoring.js';
import type { CompositionSpacingObservation } from '../contracts/engine-contracts.js';
import { rectIntersection } from '../geometry/rectangles.js';

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreConfigNumber implementation intact until its target seam is extracted.
 */
function scoreConfigNumber(key: string): number {
  const value = readRenderConfig().compositionScore[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite composition_score.${key}.`);
  return value;
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current horizontalOverlap implementation intact until its target seam is extracted.
 */
function horizontalOverlap(first: { x: number; width: number }, second: { x: number; width: number }): boolean {
  return Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x);
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current spread implementation intact until its target seam is extracted.
 */
function spread(values: number[]): number {
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current saturatingQuality implementation intact until its target seam is extracted.
 */
function saturatingQuality(signal: number, response: number): number {
  const nonNegativeSignal = Math.max(0, signal);
  return nonNegativeSignal / (nonNegativeSignal + response);
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current normalizeContrastQuality implementation intact until its target seam is extracted.
 */
function normalizeContrastQuality(ratio: number, targetRatio: number, response: number): number {
  return saturatingQuality(Math.max(0, (ratio - 1) / (targetRatio - 1)), response);
}

function spacingObservations(plan: CompositionPlan): CompositionSpacingObservation[] {
  return plan.spacing?.observations ?? [];
}

function observationContext(observation: CompositionSpacingObservation): Record<string, unknown> {
  return {
    page: observation.page,
    ...(observation.flowId === undefined ? {} : { flowId: observation.flowId }),
    ...(observation.blockId === undefined ? {} : { blockId: observation.blockId }),
    ...(observation.graphicId === undefined ? {} : { graphicId: observation.graphicId }),
    ...(observation.regionId === undefined ? {} : { regionId: observation.regionId }),
    ...(observation.slotId === undefined ? {} : { slotId: observation.slotId }),
    ...(observation.templateRef === undefined ? {} : { templateRef: observation.templateRef }),
    ...(observation.owner === undefined ? {} : { owner: observation.owner }),
    ...(observation.cause === undefined ? {} : { cause: observation.cause }),
    ...(observation.placementPolicy === undefined ? {} : { placementPolicy: observation.placementPolicy }),
  };
}

function slotContext(plan: CompositionPlan, page: number, slotId: string): Record<string, unknown> {
  const slot = plan.spacing?.slots.find((candidate) => candidate.page === page && candidate.slotId === slotId);
  if (!slot) return { page, slotId };
  return {
    page,
    slotId,
    ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
    ...(slot.regionId === undefined ? {} : { regionId: slot.regionId }),
    ...(slot.templateRef === undefined ? {} : { templateRef: slot.templateRef }),
    ...(slot.owner === undefined ? {} : { owner: slot.owner }),
    ...(slot.cause === undefined ? {} : { cause: slot.cause }),
    ...(slot.fitContent === undefined ? {} : { fitContent: slot.fitContent }),
    ...(slot.growthMaxHeight === undefined ? {} : { growthMaxHeight: slot.growthMaxHeight }),
  };
}

function insertionSlotForObservation(
  plan: CompositionPlan,
  observation: CompositionSpacingObservation,
): CompositionPlan['slots'][number] | undefined {
  const slotId = observation.slotId;
  if (slotId === undefined) return undefined;
  return plan.slots.find((slot) => slot.page === observation.page
    && (slot.id === slotId || slotId.startsWith(`${slot.id}:`)));
}

function negativeComponent(code: string, value: number, penalty: number, details: Record<string, unknown>): CompositionScoreComponent {
  return { code, value, points: -Math.max(0, value) * penalty, details };
}

/** Penalize unexplained empty material regions in otherwise occupied slots. */
export function scoreEmptyRegions(plan: CompositionPlan): CompositionScoreComponent {
  const threshold = scoreConfigNumber('emptyRegionRatioThreshold');
  const heightThreshold = scoreConfigNumber('emptyRegionHeightThresholdMm');
  const finalPage = plan.pages.length > 0 ? Math.max(...plan.pages.map((page) => page.page)) : undefined;
  const regions = (plan.spacing?.slots ?? [])
    .filter((slot) => slot.box.height >= heightThreshold
      // A terminal main-flow fragment is allowed to leave breathing room at
      // the end of the document. Empty space on earlier pages remains a
      // quality signal because it indicates a premature page break.
      && !(finalPage !== undefined && slot.page === finalPage && slot.flowId === 'main'))
    .map((slot) => {
      const envelopeArea = slot.box.width * slot.box.height;
      const ratio = slot.occupiedHeight <= 0
        ? 1
        : slot.emptyArea !== undefined
        ? slot.emptyArea / Math.max(1, envelopeArea)
        : slot.remainingHeight / Math.max(1, slot.box.height);
      return {
        ...slotContext(plan, slot.page, slot.slotId),
        ratio,
        gap: slot.gapAfter,
      };
    })
    .filter((slot) => slot.gap > heightThreshold);
  const excess = regions.reduce((sum, region) => sum + Math.max(0, region.ratio - threshold), 0);
  return negativeComponent('empty-regions', excess, scoreConfigNumber('emptyRegionPenalty'), { threshold, heightThreshold, regions });
}

/** Penalize uneven occupied heights among sibling text slots in one region. */
export function scoreSiblingColumnImbalance(plan: CompositionPlan): CompositionScoreComponent {
  const threshold = scoreConfigNumber('columnImbalanceThreshold');
  const groups = new Map<string, number[]>();
  for (const slot of plan.spacing?.slots ?? []) {
    if (slot.flowId !== 'main' || slot.occupiedHeight <= 0) continue;
    const key = `${slot.page}:${slot.regionId}`;
    groups.set(key, [...(groups.get(key) ?? []), slot.occupiedHeight]);
  }
  const records = [...groups.entries()].filter(([, heights]) => heights.length > 1).map(([key, heights]) => {
    const maximum = Math.max(...heights);
    return { key, heights, imbalance: maximum > 0 ? 1 - Math.min(...heights) / maximum : 0 };
  });
  const excess = records.reduce((sum, record) => sum + Math.max(0, record.imbalance - threshold), 0);
  return negativeComponent('sibling-column-imbalance', excess, scoreConfigNumber('columnImbalancePenalty'), { threshold, records });
}

/** Penalize asymmetric text gaps around insertion obstacles. */
export function scoreInsertionSymmetry(plan: CompositionPlan): CompositionScoreComponent {
  const tolerance = scoreConfigNumber('insertionSymmetryToleranceMm');
  const records = spacingObservations(plan)
    .filter((observation) => observation.kind === 'insertion-rhythm'
      && observation.metrics.beforeTextGap !== undefined
      && observation.metrics.afterTextGap !== undefined
      && observation.metrics.beforeTextGap > 0
      && observation.metrics.afterTextGap > 0
      && observation.metrics.textGapAsymmetry !== undefined)
    .map((observation) => ({ ...observationContext(observation), asymmetry: observation.metrics.textGapAsymmetry ?? 0 }));
  const excess = records.reduce((sum, record) => sum + Math.max(0, record.asymmetry - tolerance), 0);
  return negativeComponent('insertion-symmetry', excess, scoreConfigNumber('insertionSymmetryPenalty'), { tolerance, records });
}

/** Penalize uneven outer and inter-insertion gaps within one page region. */
export function scoreInsertionDistribution(plan: CompositionPlan): CompositionScoreComponent {
  const tolerance = scoreConfigNumber('insertionDistributionToleranceMm');
  const groups = new Map<string, { values: number[]; sources: Record<string, unknown>[] }>();
  const observations = spacingObservations(plan)
    .filter((item) => item.kind === 'insertion-rhythm')
    .sort((left, right) => left.page - right.page || (left.box?.y ?? 0) - (right.box?.y ?? 0));
  const grouped = new Map<string, typeof observations>();
  for (const observation of observations) {
    const key = `${observation.page}:${observation.regionId ?? ''}`;
    grouped.set(key, [...(grouped.get(key) ?? []), observation]);
  }
  for (const [key, pageObservations] of grouped) {
    if (pageObservations.length === 0) continue;
    // Attribution describes who chose a placement, not the slot's geometric
    // semantics. A planner-selected position in a fluid-y slot must be scored
    // with the same distribution model as the template's seed position.
    const isFluidCapability = pageObservations.every((observation) =>
      insertionSlotForObservation(plan, observation)?.placement?.mode === 'fluid-y');
    const first = pageObservations[0];
    const last = pageObservations[pageObservations.length - 1];
    const neighbourGaps = pageObservations.flatMap((observation) => [
      observation.metrics.previousInsertionGap,
      observation.metrics.nextInsertionGap,
    ]).filter((value): value is number => value !== undefined);
    const values = (isFluidCapability
      ? pageObservations.slice(0, -1).map((observation) => observation.metrics.nextInsertionGap)
      : [
        first.metrics.regionStartGap,
        last.metrics.regionEndGap,
        ...neighbourGaps,
      ]).filter((value): value is number => value !== undefined);
    if (values.length > 1) groups.set(key, {
      values,
      sources: pageObservations.map(observationContext),
    });
  }
  const records = [...groups.entries()].map(([key, group]) => {
    const mean = group.values.reduce((sum, value) => sum + value, 0) / group.values.length;
    return { key, mean, dispersion: group.values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / group.values.length, sources: group.sources };
  });
  const excess = records.reduce((sum, record) => sum + Math.max(0, record.dispersion - tolerance), 0);
  return negativeComponent('insertion-distribution', excess, scoreConfigNumber('insertionDistributionPenalty'), { tolerance, records });
}

type MainPageProgress = { start: number; end: number; center: number };

function mainPageProgress(plan: CompositionPlan): Map<number, MainPageProgress> {
  const mainLines = allLines(plan).filter((line) => line.flowId === 'main' && line.layer !== 'insertion');
  const totalWords = Math.max(1, ...mainLines.map((line) => line.endWord));
  const pages = new Map<number, MainPageProgress>();
  for (const page of new Set(mainLines.map((line) => line.page))) {
    const lines = mainLines.filter((line) => line.page === page);
    const start = Math.min(...lines.map((line) => line.startWord)) / totalWords;
    const end = Math.max(...lines.map((line) => line.endWord)) / totalWords;
    pages.set(page, { start, end, center: (start + end) / 2 });
  }
  return pages;
}

function insertionPolicyRecords(plan: CompositionPlan): Array<{
  graphic: CompositionPlan['graphicPlacements'][number];
  policy: NonNullable<CompositionPlan['graphicPlacements'][number]['placementPolicy']>;
  blockId: string;
  flowId?: string;
  regionId?: string;
}> {
  return plan.graphicPlacements.flatMap((graphic) => {
    const policy = graphic.placementPolicy;
    if (!graphic.graphicId.startsWith('insertion:') || !policy) return [];
    return [{ graphic, policy, blockId: graphic.graphicId.slice('insertion:'.length), flowId: undefined as string | undefined, regionId: undefined as string | undefined }];
  }).map((record) => ({
    ...record,
    ...(() => {
      const slot = plan.slots.find((candidate) => candidate.page === record.graphic.page
        && (candidate.id === record.graphic.slotId || record.graphic.slotId.startsWith(`${candidate.id}:`)));
      return { flowId: slot?.flowId, regionId: slot?.regionId };
    })(),
  }));
}

function policyGroupKey(record: ReturnType<typeof insertionPolicyRecords>[number]): string | undefined {
  if (!record.policy.rhythmGroup) return undefined;
  return `${record.regionId ?? ''}:${record.policy.rhythmGroup}`;
}

function progressForPage(progress: Map<number, MainPageProgress>, page: number): number {
  const measured = progress.get(page);
  if (measured) return measured.center;
  const before = [...progress.entries()]
    .filter(([candidate]) => candidate < page)
    .sort((left, right) => right[0] - left[0])[0];
  if (before) return before[1].end;
  const after = [...progress.entries()]
    .filter(([candidate]) => candidate > page)
    .sort((left, right) => left[0] - right[0])[0];
  return after?.[1].start ?? 0;
}

/** Compare insertion order with measured main-flow progress without reflowing the plan. */
export function scoreContentSpread(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const progress = mainPageProgress(plan);
  const groups = new Map<string, ReturnType<typeof insertionPolicyRecords>>();
  for (const record of insertionPolicyRecords(plan)) {
    if (record.policy.distribution !== 'spread-through-content') continue;
    const key = policyGroupKey(record);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const records: Array<Record<string, unknown>> = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const order = new Map<string, number>();
    for (const flowId of new Set(group.map((record) => record.flowId).filter((value): value is string => value !== undefined))) {
      for (const [index, block] of (document.flows[flowId]?.blocks ?? []).entries()) order.set(`${flowId}:${block.id}`, index);
    }
    const ordered = [...group].sort((left, right) => (order.get(`${left.flowId}:${left.blockId}`) ?? Number.MAX_SAFE_INTEGER) - (order.get(`${right.flowId}:${right.blockId}`) ?? Number.MAX_SAFE_INTEGER)
      || left.blockId.localeCompare(right.blockId));
    const weighted = ordered.map((record) => ({ record, weight: Math.max(1, visualLoad(plan, record.graphic).weighted) }));
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let accumulatedWeight = 0;
    weighted.forEach(({ record, weight }) => {
      const expected = (accumulatedWeight + weight / 2) / Math.max(1, totalWeight);
      const actual = progressForPage(progress, record.graphic.page);
      records.push({
        key,
        blockId: record.blockId,
        flowId: record.flowId,
        graphicId: record.graphic.graphicId,
        page: record.graphic.page,
        expectedProgress: expected,
        actualProgress: actual,
        visualLoad: weight,
        deviation: Math.abs(expected - actual),
        placementPolicy: record.policy,
      });
      accumulatedWeight += weight;
    });
  }
  const tolerance = scoreConfigNumber('contentSpreadTolerance');
  const excess = records.reduce((sum, record) => sum + Math.max(0, (record.deviation as number) - tolerance), 0);
  return negativeComponent('content-spread', excess, scoreConfigNumber('contentSpreadPenalty'), { tolerance, records });
}

interface VisualLoadMetrics {
  areaShare: number;
  verticalShare: number;
  affectedLineShare: number;
  weighted: number;
}

function visualLoad(plan: CompositionPlan, graphic: CompositionPlan['graphicPlacements'][number]): VisualLoadMetrics {
  const measured = plan.spacing?.observations?.find((observation) => observation.kind === 'insertion-rhythm'
    && observation.page === graphic.page
    && observation.graphicId === graphic.graphicId
    && observation.metrics.visualLoadAreaShare !== undefined
    && observation.metrics.visualLoadVerticalShare !== undefined
    && observation.metrics.visualLoadAffectedLineShare !== undefined
    && observation.metrics.visualLoad !== undefined);
  if (measured) return {
    areaShare: measured.metrics.visualLoadAreaShare!,
    verticalShare: measured.metrics.visualLoadVerticalShare!,
    affectedLineShare: measured.metrics.visualLoadAffectedLineShare!,
    weighted: measured.metrics.visualLoad!,
  };
  const page = plan.spacing?.pages.find((candidate) => candidate.page === graphic.page);
  const regionArea = Math.max(1, (page?.contentBox.width ?? graphic.box.width) * (page?.contentBox.height ?? graphic.box.height));
  const areaShare = (graphic.box.width * graphic.box.height) / regionArea;
  const verticalShare = graphic.box.height / Math.max(1, page?.contentBox.height ?? graphic.box.height);
  const mainLines = allLines(plan).filter((line) => line.flowId === 'main' && line.layer !== 'insertion' && line.page === graphic.page);
  const affectedLines = mainLines.filter((line) => {
    const slot = plan.slots.find((candidate) => candidate.page === line.page && (candidate.id === line.slotId || line.slotId.startsWith(`${candidate.id}:`)));
    const verticalOverlap = line.box.y < graphic.box.y + graphic.box.height
      && graphic.box.y < line.box.y + line.box.height;
    const horizontalOverlapWithLane = slot ? horizontalOverlap(slot.box, graphic.box) : horizontalOverlap(line.box, graphic.box);
    return verticalOverlap && horizontalOverlapWithLane;
  }).length;
  const textShare = mainLines.length > 0 ? affectedLines / mainLines.length : 0;
  const weighted = areaShare * scoreConfigNumber('visualLoadAreaWeight')
    + verticalShare * scoreConfigNumber('visualLoadVerticalWeight')
    + textShare * scoreConfigNumber('visualLoadTextWeight');
  return { areaShare, verticalShare, affectedLineShare: textShare, weighted };
}

/** Penalize groups that concentrate visual mass on one eligible page. */
export function scorePageLoadBalance(plan: CompositionPlan): CompositionScoreComponent {
  const byGroup = new Map<string, ReturnType<typeof insertionPolicyRecords>>();
  for (const record of insertionPolicyRecords(plan)) {
    if (record.policy.distribution !== 'spread-across-pages') continue;
    const key = policyGroupKey(record);
    if (!key) continue;
    byGroup.set(key, [...(byGroup.get(key) ?? []), record]);
  }
  const records: Array<Record<string, unknown>> = [];
  const finalPage = Math.max(0, ...plan.pages.map((page) => page.page));
  for (const [key, group] of byGroup) {
    if (group.length < 2) continue;
    const first = group[0]!;
    const firstSlot = plan.slots.find((slot) => slot.page === first.graphic.page
      && (slot.id === first.graphic.slotId || first.graphic.slotId.startsWith(`${slot.id}:`)));
    const groupFlowIds = new Set(group.map((record) => record.flowId));
    const eligiblePages = [...new Set(plan.slots
      .filter((slot) => groupFlowIds.has(slot.flowId) && slot.regionId === firstSlot?.regionId && slot.placement?.mode === 'fluid-y')
      .map((slot) => slot.page))]
      .filter((page) => page !== finalPage || allLines(plan).some((line) => line.page === page && line.flowId === 'main' && line.layer !== 'insertion'));
    if (eligiblePages.length < 2) continue;
    const loads = eligiblePages.map((page) => {
      const pageRecords = group.filter((record) => record.graphic.page === page);
      const elements = pageRecords.map((record) => ({ graphicId: record.graphic.graphicId, ...visualLoad(plan, record.graphic) }));
      return { page, load: elements.reduce((sum, item) => sum + item.weighted, 0), graphicIds: pageRecords.map((record) => record.graphic.graphicId), elements };
    });
    const target = loads.reduce((sum, item) => sum + item.load, 0) / loads.length;
    const imbalance = loads.reduce((sum, item) => sum + Math.abs(item.load - target), 0) / loads.length;
    records.push({ key, rhythmGroup: first.policy.rhythmGroup, targetLoad: target, imbalance, loads });
  }
  const tolerance = scoreConfigNumber('pageLoadBalanceTolerance');
  const excess = records.reduce((sum, record) => sum + Math.max(0, (record.imbalance as number) - tolerance), 0);
  return negativeComponent('page-load-balance', excess, scoreConfigNumber('pageLoadBalancePenalty'), { tolerance, records });
}

/** Penalize a soft source relation only when the source page is known. */
export function scoreSourceRelations(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const placementBelongsToFlow = (placement: { page: number; slotId: string }, flowId: string): boolean => {
    const slot = plan.slots.find((candidate) => candidate.page === placement.page
      && (candidate.id === placement.slotId || placement.slotId.startsWith(`${candidate.id}:`)));
    return slot?.flowId === flowId;
  };
  const pagesFor = (flowId: string, blockId: string): Set<number> => new Set([
    ...allLines(plan).filter((line) => line.flowId === flowId && line.blockId === blockId).map((line) => line.page),
    ...plan.placements.filter((placement) => placement.blockId === blockId && placementBelongsToFlow(placement, flowId)).map((placement) => placement.page),
    ...plan.blockPlacements.filter((placement) => placement.blockId === blockId && placementBelongsToFlow(placement, flowId)).map((placement) => placement.page),
    ...plan.tablePlacements.filter((placement) => placement.blockId === blockId && placementBelongsToFlow(placement, flowId)).map((placement) => placement.page),
  ]);
  const records = insertionPolicyRecords(plan).flatMap((record) => {
    const relation = record.policy.source;
    if (!relation || relation.strength !== 'prefer-same-page') return [];
    const sourcePages = pagesFor(relation.flowId, relation.blockId);
    if (sourcePages.size === 0 || sourcePages.has(record.graphic.page)) return [];
    return [{ insertionGraphicId: record.graphic.graphicId, insertionPage: record.graphic.page, sourceFlowId: relation.flowId, sourceBlockId: relation.blockId, sourcePages: [...sourcePages], placementPolicy: record.policy }];
  });
  return negativeComponent('source-relation', records.length, scoreConfigNumber('sourceRelationPreferencePenalty'), { records });
}

/** Penalize insertion gaps that deviate from the configured normal rhythm. */
export function scoreSpacingRhythm(plan: CompositionPlan): CompositionScoreComponent {
  const defaultTarget = scoreConfigNumber('spacingProfileNormalTargetMm');
  const tolerance = scoreConfigNumber('spacingProfileToleranceMm');
  const records = spacingObservations(plan).filter((observation) => observation.kind === 'insertion-rhythm').flatMap((observation) => {
    const target = observation.metrics.referenceGap ?? defaultTarget;
    // Inter-insertion distance belongs to insertion-distribution. Comparing it
    // with the ordinary text gap target would punish intentional open spacing
    // between two separate callouts as if it were a text collision.
    if (observation.metrics.beforeTextGap === undefined
      || observation.metrics.afterTextGap === undefined
      || observation.metrics.beforeTextGap <= 0
      || observation.metrics.afterTextGap <= 0) return [];
    return [
      { side: 'before', gap: observation.metrics.beforeTextGap },
      { side: 'after', gap: observation.metrics.afterTextGap },
    ].filter((entry): entry is { side: 'before' | 'after'; gap: number } => entry.gap !== undefined)
      .map(({ side, gap }) => ({
        ...observationContext(observation),
        side,
        profile: observation.profile ?? 'normal',
        target,
        gap,
        deviation: Math.abs(gap - target),
      }));
  });
  const excess = records.reduce((sum, record) => sum + Math.max(0, record.deviation - tolerance), 0);
  return negativeComponent('spacing-rhythm', excess, scoreConfigNumber('spacingProfilePenalty'), { profile: records[0]?.profile ?? 'normal', target: records[0]?.target ?? defaultTarget, tolerance, records });
}

/** Penalize text intervals that become too narrow beside an insertion. */
export function scoreNarrowTextIntervals(plan: CompositionPlan): CompositionScoreComponent {
  const minimum = scoreConfigNumber('narrowTextIntervalMinMm');
  const records = spacingObservations(plan)
    .filter((observation) => observation.kind === 'insertion-rhythm')
    .flatMap((observation) => (observation.intervals ?? []).map((interval) => ({
      ...observationContext(observation),
      width: interval.width,
      deficit: Math.max(0, minimum - interval.width),
    })))
    .filter((record) => record.deficit > 0);
  const deficit = records.reduce((sum, record) => sum + record.deficit, 0);
  return negativeComponent('narrow-text-interval', deficit, scoreConfigNumber('narrowTextIntervalPenalty'), { minimum, records });
}

/** Penalize fit-content slots that reserve a large unused envelope. */
export function scoreFitContentEnvelope(plan: CompositionPlan): CompositionScoreComponent {
  const threshold = scoreConfigNumber('fitContentUnusedRatioThreshold');
  const records = (plan.spacing?.slots ?? []).filter((slot) => {
    const envelope = plan.slots.find((candidate) => candidate.id === slot.slotId)?.growthMaxHeight;
    return envelope !== undefined && envelope > 0 && slot.occupiedHeight > 0;
  }).map((slot) => {
    const envelope = plan.slots.find((candidate) => candidate.id === slot.slotId)?.growthMaxHeight ?? slot.box.height;
    const ratio = Math.max(0, envelope - slot.occupiedHeight) / envelope;
    return {
      ...slotContext(plan, slot.page, slot.slotId),
      envelope,
      occupiedHeight: slot.occupiedHeight,
      ratio,
    };
  });
  const excess = records.reduce((sum, record) => sum + Math.max(0, record.ratio - threshold), 0);
  return negativeComponent('fit-content-envelope', excess, scoreConfigNumber('fitContentUnusedPenalty'), { threshold, records });
}

/** Penalize content that ends too close to the footer rule. */
export function scoreFooterGap(plan: CompositionPlan): CompositionScoreComponent {
  const minimum = scoreConfigNumber('footerContentGapMinMm');
  const records = (plan.spacing?.textPlacements ?? [])
    .filter((placement) => placement.flowId !== 'footer' && placement.gapToFooter !== undefined)
    .map((placement) => ({
      ...slotContext(plan, placement.page, placement.slotId),
      blockId: placement.blockId,
      gap: placement.gapToFooter ?? 0,
      deficit: Math.max(0, minimum - (placement.gapToFooter ?? 0)),
      boundary: 'footer',
      cause: 'content-near-footer',
    }))
    .filter((record) => record.deficit > 0);
  const deficit = records.reduce((sum, record) => sum + record.deficit, 0);
  return negativeComponent('footer-gap', deficit, scoreConfigNumber('footerContentGapPenalty'), { minimum, records });
}

/** Penalize decorative glyphs that intrude into a painted text line. */
export function scoreGlyphOverlap(plan: CompositionPlan): CompositionScoreComponent {
  const minimumArea = scoreConfigNumber('glyphOverlapMinAreaMm2');
  const records = [];
  for (const glyph of plan.glyphPlacements ?? []) {
    for (const line of allLines(plan)) {
      if (line.page !== glyph.page) continue;
      // A line box is a flow/placement envelope, not the painted text extent.
      // Compare with character advance cells when available so whitespace in
      // a wide text slot does not produce a false glyph-overlap penalty.
      const textCells = line.glyphSamplingBoxes?.map((sample) => sample.box) ?? [];
      for (const textCell of textCells) {
        const overlapBox = rectIntersection(glyph.box, textCell);
        if (!overlapBox) continue;
        const overlapArea = overlapBox.width * overlapBox.height;
        if (overlapArea < minimumArea) continue;
        const pagePlan = plan.pages.find((page) => page.page === glyph.page);
        records.push({
          glyphId: glyph.glyphId,
          glyphPlacementId: glyph.id,
          glyphSource: glyph.source,
          glyphText: glyph.text,
          glyphBox: { ...glyph.box },
          targetId: glyph.targetId,
          blockId: line.blockId,
          flowId: line.flowId,
          lineText: line.text,
          textCell: { ...textCell },
          textSlotId: line.slotId,
          ...(glyph.slotId === undefined ? {} : { glyphSlotId: glyph.slotId }),
          overlapBox: { ...overlapBox },
          page: glyph.page,
          slotId: line.slotId,
          ...(pagePlan ? { templateRef: pagePlan.templateRef ?? pagePlan.pageTemplateId } : {}),
          owner: glyph.source === 'authored' ? 'input' : 'planner',
          cause: glyph.source === 'authored' ? 'input-authored-glyph-offset' : 'planner-glyph-placement',
          overlapArea,
        });
      }
    }
  }
  const totalArea = records.reduce((sum, record) => sum + record.overlapArea, 0);
  return negativeComponent('glyph-overlap', totalArea, scoreConfigNumber('glyphOverlapPenalty'), { minimumArea, records });
}



/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreColumnBalance implementation intact until its target seam is extracted.
 */
export function scoreColumnBalance(plan: CompositionPlan): CompositionScoreComponent {
  const columnCount = Math.max(1, Math.floor(scoreConfigNumber('columnCount')));
  const lineCounts = new Map<string, number>();
  for (const line of allLines(plan)) {
    if (line.routeIndex === undefined) continue;
    const key = `${line.flowId}:${line.page}:${line.routeIndex}`;
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }
  const routesByFlowPage = new Map<string, Set<number>>();
  for (const placement of plan.flowPlacements ?? []) {
    if (placement.routeIndex >= columnCount) continue;
    const key = `${placement.flowId}:${placement.page}`;
    const routes = routesByFlowPage.get(key) ?? new Set<number>();
    routes.add(placement.routeIndex);
    routesByFlowPage.set(key, routes);
  }
  const pageBalances = [...routesByFlowPage.entries()].flatMap(([key, routes]) => {
    if (routes.size < 2) return [];
    const counts = [...routes].sort((left, right) => left - right).map((routeIndex) => lineCounts.get(`${key}:${routeIndex}`) ?? 0);
    const maximum = Math.max(...counts);
    return maximum > 0 ? [{ page: key, balance: Math.min(...counts) / maximum, counts }] : [];
  });
  const value = pageBalances.length > 0
    ? pageBalances.reduce((sum, page) => sum + page.balance, 0) / pageBalances.length
    : 0;
  return {
    code: 'column-balance',
    value,
    points: value * scoreConfigNumber('columnBalanceWeight'),
    details: { pages: pageBalances },
  };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreHeadingFollowingLine implementation intact until its target seam is extracted.
 */
export function scoreHeadingFollowingLine(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const headingIds = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks.filter((block: CompositionBlock) => block.kind === 'heading').map((block) => block.id)));
  const headings = allLines(plan).filter((line) => headingIds.has(line.blockId));
  const kept = new Set(headings
    .filter((heading) => allLines(plan).some((line) => line.blockId !== heading.blockId
      && line.flowId === heading.flowId
      && line.page === heading.page
      && line.slotId === heading.slotId
      && line.box.y >= heading.box.y + heading.box.height))
    .map((heading) => heading.blockId));
  return {
    code: 'heading-following-line',
    value: kept.size,
    points: kept.size * scoreConfigNumber('headingFollowingLineBonus'),
    details: { headingCount: new Set(headings.map((heading) => heading.blockId)).size, keptHeadingIds: [...kept].sort() },
  };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreParagraphFragmentation implementation intact until its target seam is extracted.
 */
export function scoreParagraphFragmentation(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const paragraphIds = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks
    .filter((block: CompositionBlock) => block.kind === 'paragraph')
    .map((block) => block.id)));
  const locations = new Map<string, Set<string>>();
  for (const line of plan.lines) {
    if (!paragraphIds.has(line.blockId)) continue;
    const blockLocations = locations.get(line.blockId) ?? new Set<string>();
    blockLocations.add(`${line.page}:${line.slotId}`);
    locations.set(line.blockId, blockLocations);
  }
  const fragmentedIds = [...locations.entries()]
    .filter(([, blockLocations]) => blockLocations.size > 1)
    .map(([blockId]) => blockId)
    .sort();
  return {
    code: 'paragraph-fragmentation',
    value: fragmentedIds.length,
    points: -fragmentedIds.length * scoreConfigNumber('paragraphFragmentationPenalty'),
    details: { fragmentedBlockIds: fragmentedIds },
  };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Score orphan fragments already detected by the spacing report.
 */
export function scoreOrphanLines(_document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const orphanFragmentLimit = Math.max(1, Math.floor(scoreConfigNumber('orphanMaxFragmentLines')));
  const orphans = spacingObservations(plan)
    .filter((observation) => observation.kind === 'orphan-fragment')
    .flatMap((observation) => {
      const blockId = observation.blockId;
      const graphicId = observation.graphicId;
      const slotId = observation.slotId;
      const fragmentLines = observation.metrics.fragmentLines;
      const startWord = observation.metrics.startWord;
      const endWord = observation.metrics.endWord;
      const gap = observation.metrics.gap;
      const lineHeight = observation.metrics.lineHeight;
      const side = observation.reasons?.includes('orphan-before-obstacle')
        ? 'before'
        : observation.reasons?.includes('orphan-after-obstacle') ? 'after' : undefined;
      if (!blockId || !graphicId || !slotId || fragmentLines === undefined
        || startWord === undefined || endWord === undefined || gap === undefined || lineHeight === undefined || !side) return [];
      const text = allLines(plan)
        .filter((line) => line.blockId === blockId
          && line.page === observation.page
          && line.slotId === slotId
          && line.startWord >= startWord
          && line.endWord <= endWord)
        .sort((left, right) => left.startWord - right.startWord)
        .map((line) => line.text)
        .join(' ');
      return [{
        ...observationContext(observation),
        blockId,
        graphicId,
        page: observation.page,
        slotId,
        text,
        fragmentLines,
        side,
        gap,
        lineHeight,
      }];
    })
    .sort((left, right) => left.page - right.page || left.slotId.localeCompare(right.slotId) || left.blockId.localeCompare(right.blockId));
  const minGap = scoreConfigNumber('orphanMinGapMm');
  return {
    code: 'orphan-lines',
    value: orphans.length,
    points: -orphans.length * scoreConfigNumber('orphanPenalty'),
    details: { maxFragmentLines: orphanFragmentLimit, minGap, orphans },
  };
}

type StreamGap = {
  slotId: string;
  before: number;
  after: number;
  imbalance: number;
};

type InsertionSpacingDetail = {
  blockId: string;
  page: number;
  obstacle?: CompositionPlan['graphicPlacements'][number]['box'];
  content: { top: number; bottom: number };
  internal: { top: number; bottom: number; imbalance: number };
  streams: StreamGap[];
  externalImbalance: number;
  crossStreamSpread: number;
};

type InsertionTextStreamDetail = {
  slotId: string;
  beforeGap?: number;
  afterGap?: number;
  beforeMass: number;
  afterMass: number;
  beforeLines: number;
  afterLines: number;
  totalLines: number;
  hasBefore: boolean;
  hasAfter: boolean;
  edgeGapDeficit: number;
  massBalance: number;
};

type InsertionTextContinuityDetail = {
  blockId: string;
  page: number;
  placementMass: number;
  textMassBefore: number;
  textMassAfter: number;
  streamCount: number;
  streamCoverage: number;
  coverageDeficit: number;
  massImbalance: number;
  crossStreamMassImbalance: number;
  streams: InsertionTextStreamDetail[];
};

type HeaderSpacingDetail = {
  page: number;
  headerBottom: number;
  firstContentTop: number;
  gap: number;
  deficit: number;
  excess: number;
  referenceGap: number;
  maximumGap: number;
  flowId?: string;
  blockId?: string;
  slotId?: string;
  templateRef?: string;
  owner?: string;
  cause?: string;
  from?: CompositionSpacingObservation['from'];
  to?: CompositionSpacingObservation['to'];
  fromBox?: CompositionSpacingObservation['fromBox'];
  toBox?: CompositionSpacingObservation['toBox'];
};

/** Measure the breathing room between repeated chrome and page content. */
export function scoreHeaderSpacing(plan: CompositionPlan): CompositionScoreComponent {
  const minimumGap = scoreConfigNumber('headerContentGapMinMm');
  const tolerance = scoreConfigNumber('spacingProfileToleranceMm');
  const defaultReferenceGap = scoreConfigNumber('spacingProfileNormalTargetMm');
  const details: HeaderSpacingDetail[] = spacingObservations(plan)
    .filter((observation) => observation.kind === 'region' && observation.cause === 'header-content-gap')
    .flatMap((observation) => {
      const headerBottom = observation.metrics.headerBottom;
      const firstContentTop = observation.metrics.firstContentTop;
      const gap = observation.metrics.headerContentGap;
      if (headerBottom === undefined || firstContentTop === undefined || gap === undefined) return [];
      const referenceGap = observation.metrics.referenceGap ?? defaultReferenceGap;
      const maximumGap = referenceGap + tolerance;
      return [{
        page: observation.page,
        headerBottom,
        firstContentTop,
        gap,
        deficit: Math.max(0, minimumGap - gap),
        excess: Math.max(0, gap - maximumGap),
        referenceGap,
        maximumGap,
        ...observationContext(observation),
        ...(observation.from === undefined ? {} : { from: observation.from }),
        ...(observation.to === undefined ? {} : { to: observation.to }),
        ...(observation.fromBox === undefined ? {} : { fromBox: observation.fromBox }),
        ...(observation.toBox === undefined ? {} : { toBox: observation.toBox }),
      }];
    });
  const deficit = details.reduce((sum, item) => sum + item.deficit, 0);
  const excess = details.reduce((sum, item) => sum + item.excess, 0);
  return {
    code: 'header-spacing',
    value: details.length > 0 ? details.reduce((sum, item) => sum + item.gap, 0) / details.length : minimumGap,
    points: -(deficit + excess) * scoreConfigNumber('headerContentGapPenalty'),
    details: { minimumGap, tolerance, pages: details },
  };
}

type MainStartDelayDetail = {
  page: number;
  slotId: string;
  allowedTop: number;
  firstLineTop: number;
  delay: number;
  blockingInsertionIds: string[];
};

/** Penalize a main flow that waits behind an avoidable insertion on a page. */
export function scoreMainStartDelay(plan: CompositionPlan): CompositionScoreComponent {
  const details: MainStartDelayDetail[] = [];
  for (const page of plan.pages) {
    const firstMainPlacements = (plan.flowPlacements ?? [])
      .filter((placement) => placement.page === page.page && placement.flowId === 'main' && placement.hasContent)
      .sort((left, right) => left.box.x - right.box.x || left.box.y - right.box.y);
    for (const mainPlacement of firstMainPlacements) {
      const lines = plan.lines
        .filter((line) => line.page === page.page && line.flowId === 'main' && line.layer !== 'insertion' && line.slotId === mainPlacement.slotId)
        .sort((left, right) => left.box.y - right.box.y);
      if (lines.length === 0) continue;
      const firstLineTop = lines[0]!.box.y;
      const delay = Math.max(0, firstLineTop - mainPlacement.box.y);
      const blockingInsertionIds = plan.graphicPlacements
        .filter((graphic) => graphic.page === page.page
          && graphic.graphicId.startsWith('insertion:')
          && graphic.box.y < firstLineTop
          && graphic.box.y + graphic.box.height > mainPlacement.box.y
          && horizontalOverlap(graphic.box, mainPlacement.box))
        .map((graphic) => graphic.graphicId);
      if (delay <= 0 || blockingInsertionIds.length === 0) continue;
      details.push({ page: page.page, slotId: mainPlacement.slotId, allowedTop: mainPlacement.box.y, firstLineTop, delay, blockingInsertionIds });
    }
  }
  const value = details.reduce((sum, detail) => sum + detail.delay, 0);
  return negativeComponent('main-start-delay', value, scoreConfigNumber('mainStartDelayPenalty'), { details });
}

/** Penalize material elements that are closer than the configured breathing room. */
export function scoreElementProximity(plan: CompositionPlan): CompositionScoreComponent {
  const minimumGap = scoreConfigNumber('spacingProfileNormalTargetMm');
  const records = spacingObservations(plan)
    .filter((observation) => observation.kind === 'element-proximity')
    .map((observation) => ({
      page: observation.page,
      from: observation.from,
      to: observation.to,
      fromBox: observation.fromBox,
      toBox: observation.toBox,
      gap: observation.metrics.gap,
      minimumGap: observation.metrics.minimumGap,
      deficit: Math.max(0, observation.metrics.deficit ?? (observation.metrics.minimumGap ?? minimumGap) - (observation.metrics.gap ?? minimumGap)),
      movementNeeded: observation.metrics.movementNeeded,
      movementBudget: observation.metrics.movementBudget,
      movementAvailable: observation.movementAvailable,
      axis: observation.axis,
      gapX: observation.metrics.gapX,
      gapY: observation.metrics.gapY,
      reasons: observation.reasons,
    }))
    .filter((record) => record.deficit > 0);
  const deficit = records.reduce((sum, record) => sum + record.deficit, 0);
  return negativeComponent('element-proximity', deficit, scoreConfigNumber('elementProximityPenalty'), { defaultMinimumGap: minimumGap, records });
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Score insertion-spacing metrics already measured by the spacing report.
 */
export function scoreInsertionSpacing(plan: CompositionPlan): CompositionScoreComponent {
  const details: InsertionSpacingDetail[] = spacingObservations(plan)
    .filter((observation) => observation.kind === 'insertion-rhythm')
    .flatMap((observation) => {
      const blockId = observation.blockId;
      const obstacle = observation.box;
      const contentTop = observation.metrics.contentTop;
      const contentBottom = observation.metrics.contentBottom;
      const internalTop = observation.metrics.contentInsetTop;
      const internalBottom = observation.metrics.contentInsetBottom;
      if (!blockId || !obstacle || contentTop === undefined || contentBottom === undefined
        || internalTop === undefined || internalBottom === undefined) return [];
      const streamIds = [...new Set(Object.keys(observation.metrics)
        .filter((key) => key.startsWith('textStreamBefore:'))
        .map((key) => key.slice('textStreamBefore:'.length)))];
      const streams = streamIds.flatMap((slotId) => {
        const before = observation.metrics[`textStreamBefore:${slotId}`];
        const after = observation.metrics[`textStreamAfter:${slotId}`];
        // A zero edge gap is scored by insertion-text-continuity together with
        // the measured line coverage. Keep this component focused on the
        // legacy positive-gap asymmetry so the same defect is not counted twice.
        if (before === undefined || after === undefined || before <= 0 || after <= 0) return [];
        return [{ slotId, before, after, imbalance: Math.abs(before - after) }];
      });
      const beforeGaps = streams.map((stream) => stream.before);
      const afterGaps = streams.map((stream) => stream.after);
      const externalImbalance = streams.length > 0
        ? streams.reduce((sum, stream) => sum + stream.imbalance, 0) / streams.length
        : 0;
      const crossStreamSpread = (spread(beforeGaps) + spread(afterGaps)) / 2;
      return [{
        ...observationContext(observation),
        blockId,
        page: observation.page,
        obstacle,
        content: { top: contentTop, bottom: contentBottom },
        internal: { top: internalTop, bottom: internalBottom, imbalance: observation.metrics.contentInsetImbalance ?? Math.abs(internalTop - internalBottom) },
        streams,
        externalImbalance,
        crossStreamSpread,
      }];
    });
  const internalImbalance = details.reduce((sum, insertion) => sum + insertion.internal.imbalance, 0);
  const externalImbalance = details.reduce((sum, insertion) => sum + insertion.externalImbalance, 0);
  const crossStreamSpread = details.reduce((sum, insertion) => sum + insertion.crossStreamSpread, 0);
  const points = -internalImbalance * scoreConfigNumber('insertionInternalSpacingPenalty')
    - externalImbalance * scoreConfigNumber('insertionExternalSpacingPenalty')
    - crossStreamSpread * scoreConfigNumber('insertionCrossStreamSpacingPenalty');
  return {
    code: 'insertion-spacing',
    value: internalImbalance + externalImbalance + crossStreamSpread,
    points,
    details: { insertions: details },
  };
}

/** Prefer distributed insertion candidates that leave usable text above and below the obstacle in every overlapping text stream. */
export function scoreInsertionTextContinuity(plan: CompositionPlan): CompositionScoreComponent {
  const minimumMass = scoreConfigNumber('insertionTextContinuityMinMassRatio');
  const edgeGapTarget = scoreConfigNumber('spacingProfileNormalTargetMm');
  const details: InsertionTextContinuityDetail[] = spacingObservations(plan)
    .filter((observation) => observation.kind === 'insertion-rhythm')
    .flatMap((observation) => {
      const blockId = observation.blockId;
      if (!blockId) return [];
      // A template/input must opt into a content/page distribution policy before
      // cross-column continuity can influence ranking. Fixed/free insertions keep
      // their existing local spacing semantics and do not acquire a hidden
      // global constraint.
      const distribution = observation.placementPolicy?.distribution;
      if (distribution !== 'spread-through-content' && distribution !== 'spread-across-pages') return [];
      const streamIds = [...new Set(Object.keys(observation.metrics)
        .filter((key) => key.startsWith('textStreamTotalLines:'))
        .map((key) => key.slice('textStreamTotalLines:'.length)))];
      const streams = streamIds.flatMap((slotId): InsertionTextStreamDetail[] => {
        const beforeGap = observation.metrics[`textStreamBefore:${slotId}`];
        const afterGap = observation.metrics[`textStreamAfter:${slotId}`];
        const totalLines = observation.metrics[`textStreamTotalLines:${slotId}`] ?? 0;
        const beforeMass = observation.metrics[`textStreamBeforeMass:${slotId}`] ?? 0;
        const afterMass = observation.metrics[`textStreamAfterMass:${slotId}`] ?? 0;
        const beforeLines = observation.metrics[`textStreamBeforeLines:${slotId}`] ?? 0;
        const afterLines = observation.metrics[`textStreamAfterLines:${slotId}`] ?? 0;
        const hasBefore = beforeMass >= minimumMass && beforeLines > 0;
        const hasAfter = afterMass >= minimumMass && afterLines > 0;
        const edgeGapDeficit = hasBefore && hasAfter
          ? [beforeGap, afterGap]
            .filter((gap): gap is number => gap !== undefined)
            .reduce((sum, gap) => sum + Math.max(0, edgeGapTarget - gap) / Math.max(edgeGapTarget, Number.EPSILON), 0)
          : 0;
        const massTotal = beforeMass + afterMass;
        return [{
          slotId,
          ...(beforeGap === undefined ? {} : { beforeGap }),
          ...(afterGap === undefined ? {} : { afterGap }),
          beforeMass,
          afterMass,
          beforeLines,
          afterLines,
          totalLines,
          hasBefore,
          hasAfter,
          edgeGapDeficit,
          massBalance: massTotal > 0 ? Math.abs(beforeMass - afterMass) / massTotal : 0,
        }];
      });
      if (streams.length === 0 || streams.every((stream) => stream.totalLines === 0)) return [];
      const coveredStreams = streams.filter((stream) => stream.hasBefore && stream.hasAfter).length;
      const coverage = coveredStreams / streams.length;
      const coverageDeficit = 1 - coverage;
      const textMassBefore = streams.reduce((sum, stream) => sum + stream.beforeMass, 0);
      const textMassAfter = streams.reduce((sum, stream) => sum + stream.afterMass, 0);
      const totalTextMass = textMassBefore + textMassAfter;
      const massImbalance = totalTextMass > 0 ? Math.abs(textMassBefore - textMassAfter) / totalTextMass : 0;
      const streamMasses = streams.map((stream) => stream.beforeMass + stream.afterMass);
      const crossStreamMassImbalance = streamMasses.length > 1
        ? spread(streamMasses) / Math.max(...streamMasses, minimumMass)
        : 0;
      const placementMass = observation.metrics.visualLoad ?? 0;
      return [{
        ...observationContext(observation),
        blockId,
        page: observation.page,
        placementMass,
        textMassBefore,
        textMassAfter,
        streamCount: streams.length,
        streamCoverage: coverage,
        coverageDeficit,
        massImbalance,
        crossStreamMassImbalance,
        streams,
      }];
    });
  const coveragePenalty = scoreConfigNumber('insertionTextContinuityCoveragePenalty');
  const massPenalty = scoreConfigNumber('insertionTextContinuityMassPenalty');
  const crossStreamPenalty = scoreConfigNumber('insertionTextContinuityCrossStreamPenalty');
  const edgeGapPenalty = scoreConfigNumber('insertionTextContinuityEdgeGapPenalty');
  const visualLoadWeight = scoreConfigNumber('insertionTextContinuityVisualLoadWeight');
  const records = details.map((detail) => ({
    ...detail,
    edgeGapDeficit: detail.streams.reduce((sum, stream) => sum + stream.edgeGapDeficit, 0),
    weightedDeficit: detail.coverageDeficit * coveragePenalty
      + detail.massImbalance * massPenalty
      + detail.crossStreamMassImbalance * crossStreamPenalty
      + detail.streams.reduce((sum, stream) => sum + stream.edgeGapDeficit, 0) * edgeGapPenalty,
    placementMassMultiplier: 1 + detail.placementMass * visualLoadWeight,
  }));
  const points = -records.reduce((sum, record) => sum + record.weightedDeficit * record.placementMassMultiplier, 0);
  return {
    code: 'insertion-text-continuity',
    value: records.reduce((sum, record) => sum + record.coverageDeficit + record.massImbalance + record.crossStreamMassImbalance + record.edgeGapDeficit, 0),
    points,
    details: { minimumMass, edgeGapTarget, coveragePenalty, massPenalty, crossStreamPenalty, edgeGapPenalty, visualLoadWeight, records },
  };
}

type ContrastGlyphResult = NonNullable<CompositionContrastAssessment['glyphResults']>[number];

type ContrastQualitySummary = {
  glyphResults: ContrastGlyphResult[];
  measured: number[];
  meanQuality: number;
  worstPointQuality: number;
};

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Summarize measured and per-glyph contrast quality.
 */
function contrastQualitySummary(
  assessments: CompositionContrastAssessment[],
  targetRatio: number,
  qualityResponse: number,
): ContrastQualitySummary {
  const glyphResults = assessments.flatMap((assessment) => assessment.glyphResults ?? []);
  const measured = assessments
    .filter((assessment) => assessment.status === 'measured' && Number.isFinite(assessment.averageRatio ?? assessment.minimumRatio))
    .map((assessment) => normalizeContrastQuality(assessment.averageRatio ?? assessment.minimumRatio ?? 1, targetRatio, qualityResponse));
  const glyphQualities = glyphResults.map((glyph) => normalizeContrastQuality(glyph.averageRatio, targetRatio, qualityResponse));
  const glyphWorstPointQualities = glyphResults.map((glyph) => normalizeContrastQuality(glyph.minimumRatio, targetRatio, qualityResponse));
  const meanQuality = glyphQualities.length > 0
    ? glyphQualities.reduce((sum, quality) => sum + quality, 0) / glyphQualities.length
    : measured.length > 0
      ? measured.reduce((sum, quality) => sum + quality, 0) / measured.length
      : 1;
  const worstPointQuality = glyphWorstPointQualities.length > 0 ? Math.min(...glyphWorstPointQualities) : meanQuality;
  return { glyphResults, measured, meanQuality, worstPointQuality };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Calculate contrast penalty terms for localized glyph defects.
 */
function contrastPenaltyFraction(
  glyphResults: ContrastGlyphResult[],
  meanQuality: number,
  worstPointQuality: number,
  qualityResponse: number,
): { affectedGlyphCount: number; affectedGlyphBreadth: number; penaltyFraction: number; severeRatio: number; affectedGlyphSaturation: number } {
  const severeRatio = scoreConfigNumber('contrastSevereRatio');
  const affectedGlyphSaturation = Math.max(1, scoreConfigNumber('contrastAffectedGlyphSaturation'));
  const affectedGlyphCount = glyphResults.filter((glyph) => glyph.minimumRatio < severeRatio).length;
  const affectedGlyphBreadth = glyphResults.length > 0
    ? saturatingQuality(affectedGlyphCount / affectedGlyphSaturation, qualityResponse)
    : 0;
  const penaltyFraction = glyphResults.length > 0
    ? scoreConfigNumber('contrastMeanQualityWeight') * (1 - meanQuality)
      + scoreConfigNumber('contrastWorstGlyphWeight') * (1 - worstPointQuality)
      + scoreConfigNumber('contrastAffectedGlyphWeight') * affectedGlyphBreadth
    : 1 - meanQuality;
  return { affectedGlyphCount, affectedGlyphBreadth, penaltyFraction, severeRatio, affectedGlyphSaturation };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreContrast implementation intact until its target seam is extracted.
 */
export function scoreContrast(assessments: CompositionContrastAssessment[]): CompositionScoreComponent {
  const targetRatio = readRenderConfig().contrast.bodyMinimum;
  const maximumPenalty = scoreConfigNumber('contrastPenalty');
  const qualityResponse = scoreConfigNumber('contrastQualityResponse');
  if (qualityResponse <= 0) throw new Error('Render configuration composition_score.contrast_quality_response must be greater than zero.');
  const quality = contrastQualitySummary(assessments, targetRatio, qualityResponse);
  const impact = contrastPenaltyFraction(quality.glyphResults, quality.meanQuality, quality.worstPointQuality, qualityResponse);
  const normalizedQuality = 1 - impact.penaltyFraction;
  const points = impact.penaltyFraction === 0 ? 0 : -maximumPenalty * impact.penaltyFraction;
  return {
    code: 'contrast',
    value: normalizedQuality,
    points,
    details: {
      assessmentCount: assessments.length,
      measuredAssessmentCount: quality.measured.length,
      glyphCount: quality.glyphResults.length,
      affectedGlyphCount: impact.affectedGlyphCount,
      affectedGlyphBreadth: impact.affectedGlyphBreadth,
      meanQuality: quality.meanQuality,
      worstPointQuality: quality.worstPointQuality,
      penaltyFraction: impact.penaltyFraction,
      scoring: quality.glyphResults.length > 0 ? 'mean-quality + worst-point + affected-glyph-breadth' : 'legacy-assessment-quality',
      severeRatio: impact.severeRatio,
      affectedGlyphSaturation: impact.affectedGlyphSaturation,
      unknownGraphicIds: assessments.filter((assessment) => assessment.status === 'unknown').map((assessment) => assessment.graphicId).filter((graphicId): graphicId is string => graphicId !== undefined),
      targetRatio,
      maximumPenalty,
      qualityResponse,
      normalization: 'mean quality uses glyph average ratios with an asymptotic response x / (x + response); localized defects use each glyph minimum sampled ratio for worst-point and affected-glyph terms; unknown measurements are neutral',
      assessments,
      pointsPolicy: 'continuous quality component; weights require visual calibration',
    },
  };
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreLegalPlan implementation intact until its target seam is extracted.
 */
export function scoreLegalPlan(document: CompositionDocument, plan: CompositionPlan, contrastAssessments: CompositionContrastAssessment[] = []): { score: number; base: number; breakdown: CompositionScoreComponent[] } {
  const breakdown = [scoreColumnBalance(plan), scoreSiblingColumnImbalance(plan), scoreEmptyRegions(plan), scoreHeadingFollowingLine(document, plan), scoreParagraphFragmentation(document, plan), scoreOrphanLines(document, plan), scoreInsertionSpacing(plan), scoreInsertionTextContinuity(plan), scoreInsertionSymmetry(plan), scoreInsertionDistribution(plan), scoreContentSpread(document, plan), scorePageLoadBalance(plan), scoreSourceRelations(document, plan), scoreSpacingRhythm(plan), scoreNarrowTextIntervals(plan), scoreFitContentEnvelope(plan), scoreHeaderSpacing(plan), scoreMainStartDelay(plan), scoreElementProximity(plan), scoreFooterGap(plan), scoreGlyphOverlap(plan), scoreListContinuity(document, plan), scoreTableContinuity(document, plan), scoreTinyFragments(document, plan), ...(contrastAssessments.length > 0 ? [scoreContrast(contrastAssessments)] : [])];
  const base = scoreConfigNumber('base');
  return {
    score: base + breakdown.reduce((sum, component) => sum + component.points, 0),
    base,
    breakdown,
  };
}
