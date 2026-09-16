import { readRenderConfig } from '../../template/builtins.js';

import type { CompositionDocument, CompositionBlock } from '../contracts/model.js';

import type { CompositionContrastAssessment } from './contrast.js';

import type { CompositionLine, CompositionPlan, CompositionScoreComponent } from '../contracts/engine-contracts.js';

import { allLines } from './plan-queries.js';
import { scoreListContinuity, scoreTableContinuity, scoreTinyFragments } from './structure-scoring.js';
import type { CompositionSpacingObservation } from '../contracts/engine-contracts.js';

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
    const isFluidCapability = pageObservations.every((observation) => observation.cause === 'template-fluid-insertion-capability');
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
      const overlapWidth = Math.min(glyph.box.x + glyph.box.width, line.box.x + line.box.width) - Math.max(glyph.box.x, line.box.x);
      const overlapHeight = Math.min(glyph.box.y + glyph.box.height, line.box.y + line.box.height) - Math.max(glyph.box.y, line.box.y);
      const overlapArea = Math.max(0, overlapWidth) * Math.max(0, overlapHeight);
      if (overlapArea < minimumArea) continue;
        const pagePlan = plan.pages.find((page) => page.page === glyph.page);
        records.push({
          glyphId: glyph.glyphId,
          glyphPlacementId: glyph.id,
          glyphSource: glyph.source,
          targetId: glyph.targetId,
          blockId: line.blockId,
          flowId: line.flowId,
          page: glyph.page,
          slotId: glyph.slotId ?? line.slotId,
          ...(pagePlan ? { templateRef: pagePlan.templateRef ?? pagePlan.pageTemplateId } : {}),
          owner: glyph.source === 'authored' ? 'input' : 'planner',
          cause: glyph.source === 'authored' ? 'input-authored-glyph-offset' : 'planner-glyph-placement',
          overlapArea,
        });
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

type OrphanLineDetail = {
  blockId: string;
  page: number;
  slotId: string;
  text: string;
  fragmentLines: number;
  side: 'before' | 'after';
  gap: number;
  graphicId: string;
  lineHeight: number;
};

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Find orphan fragments for one paragraph.
 */
function orphanDetailsForBlock(
  blockId: string,
  lines: CompositionLine[],
  plan: CompositionPlan,
  orphanFragmentLimit: number,
): OrphanLineDetail[] {
  if (lines.length < 2) return [];
  const orderedLines = [...lines].sort((left, right) => left.endWord - right.endWord);
  return orderedLines.flatMap((line, index) => {
    if (index === 0) return [];
    const previousLine = orderedLines[index - 1];
    if (line.page !== previousLine.page || line.slotId !== previousLine.slotId) return [];
    const gap = line.box.y - (previousLine.box.y + previousLine.box.height);
    if (gap < scoreConfigNumber('orphanMinGapMm')) return [];
    const blockingGraphic = plan.graphicPlacements.find((graphic) => graphic.page === line.page
      && graphic.slotId !== line.slotId
      && graphic.wrap === 'around'
      && graphic.box.y <= line.box.y
      && graphic.box.y + graphic.box.height >= previousLine.box.y + previousLine.box.height
      && horizontalOverlap(graphic.box, line.box));
    if (!blockingGraphic) return [];
    const beforeLines = index;
    const afterLines = orderedLines.length - index;
    const isolatedSide = beforeLines <= orphanFragmentLimit ? 'before' : afterLines <= orphanFragmentLimit ? 'after' : undefined;
    if (!isolatedSide) return [];
    const isolatedLines = isolatedSide === 'before' ? orderedLines.slice(0, index) : orderedLines.slice(index);
    const isolatedLine = isolatedSide === 'before' ? isolatedLines[0] : isolatedLines.at(-1)!;
    return [{
      blockId,
      page: isolatedLine.page,
      slotId: isolatedLine.slotId,
      text: isolatedLine.text,
      fragmentLines: isolatedLines.length,
      side: isolatedSide,
      gap,
      graphicId: blockingGraphic.graphicId,
      lineHeight: isolatedLine.box.height,
    }];
  });
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Group paragraph lines before orphan scoring.
 */
function paragraphLinesForOrphanScoring(
  document: CompositionDocument,
  plan: CompositionPlan,
): Map<string, CompositionLine[]> {
  const paragraphs = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks
    .filter((block: CompositionBlock) => block.kind === 'paragraph' && typeof block.text === 'string')
    .map((block) => block.id)));
  const linesByBlock = new Map<string, CompositionLine[]>();
  for (const line of plan.lines) {
    if (!paragraphs.has(line.blockId)) continue;
    linesByBlock.set(line.blockId, [...(linesByBlock.get(line.blockId) ?? []), line]);
  }
  return linesByBlock;
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreOrphanLines implementation intact until its target seam is extracted.
 */
export function scoreOrphanLines(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const orphanFragmentLimit = Math.max(1, Math.floor(scoreConfigNumber('orphanMaxFragmentLines')));
  const orphans = [...paragraphLinesForOrphanScoring(document, plan).entries()]
    .flatMap(([blockId, lines]) => orphanDetailsForBlock(blockId, lines, plan, orphanFragmentLimit))
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
  obstacle: CompositionLine['box'];
  content: { top: number; bottom: number };
  internal: { top: number; bottom: number; imbalance: number };
  streams: StreamGap[];
  externalImbalance: number;
  crossStreamSpread: number;
};

type HeaderSpacingDetail = {
  page: number;
  headerBottom: number;
  firstContentTop: number;
  gap: number;
  deficit: number;
};

/** Measure the breathing room between repeated chrome and page content. */
export function scoreHeaderSpacing(plan: CompositionPlan): CompositionScoreComponent {
  const minimumGap = scoreConfigNumber('headerContentGapMinMm');
  const details: HeaderSpacingDetail[] = [];
  for (const page of plan.pages) {
    const headerLines = plan.lines.filter((line) => line.page === page.page && line.flowId === 'header');
    const contentLines = plan.lines.filter((line) => line.page === page.page && line.flowId !== 'header' && line.layer !== 'insertion');
    if (headerLines.length === 0 || contentLines.length === 0) continue;
    const headerBottom = Math.max(...headerLines.map((line) => line.box.y + line.box.height));
    const firstContentTop = Math.min(...contentLines.map((line) => line.box.y));
    const gap = firstContentTop - headerBottom;
    details.push({ page: page.page, headerBottom, firstContentTop, gap, deficit: Math.max(0, minimumGap - gap) });
  }
  const deficit = details.reduce((sum, item) => sum + item.deficit, 0);
  return {
    code: 'header-spacing',
    value: details.length > 0 ? details.reduce((sum, item) => sum + item.gap, 0) / details.length : minimumGap,
    points: -deficit * scoreConfigNumber('headerContentGapPenalty'),
    details: { minimumGap, pages: details },
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
 * @planner-responsibility Calculate spacing details for one insertion block.
 */
function insertionSpacingDetail(lines: CompositionLine[], plan: CompositionPlan, ordinaryLines: CompositionLine[]): InsertionSpacingDetail[] {
  const firstLine = lines[0];
  const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:' + firstLine.blockId && graphic.page === firstLine.page);
  if (!obstacle) return [];
  const contentTop = Math.min(...lines.map((line) => line.box.y));
  const contentBottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
  const internalTop = contentTop - obstacle.box.y;
  const internalBottom = obstacle.box.y + obstacle.box.height - contentBottom;
  const overlappingSlots = plan.slots.filter((slot) => slot.page === obstacle.page
    && slot.id !== obstacle.slotId
    && slot.kind === 'text'
    && horizontalOverlap(slot.box, obstacle.box));
  const streamGaps = overlappingSlots.flatMap((slot) => {
    const linesInSlot = ordinaryLines.filter((line) => line.page === obstacle.page && line.slotId === slot.id);
    const previous = linesInSlot
      .filter((line) => line.box.y + line.box.height <= obstacle.box.y)
      .sort((left, right) => (right.box.y + right.box.height) - (left.box.y + left.box.height))[0];
    const next = linesInSlot
      .filter((line) => line.box.y >= obstacle.box.y + obstacle.box.height)
      .sort((left, right) => left.box.y - right.box.y)[0];
    if (!previous || !next) return [];
    const before = obstacle.box.y - (previous.box.y + previous.box.height);
    const after = next.box.y - (obstacle.box.y + obstacle.box.height);
    if (before <= 0 || after <= 0) return [];
    return [{ slotId: slot.id, before, after, imbalance: Math.abs(before - after) }];
  });
  const externalImbalance = streamGaps.length > 0
    ? streamGaps.reduce((sum, gap) => sum + gap.imbalance, 0) / streamGaps.length
    : 0;
  const beforeGaps = streamGaps.map((gap) => gap.before);
  const afterGaps = streamGaps.map((gap) => gap.after);
  const crossStreamSpread = (spread(beforeGaps) + spread(afterGaps)) / 2;
  return [{
    ...slotContext(plan, obstacle.page, obstacle.slotId),
    blockId: firstLine.blockId,
    page: obstacle.page,
    obstacle: { ...obstacle.box },
    content: { top: contentTop, bottom: contentBottom },
    internal: { top: internalTop, bottom: internalBottom, imbalance: Math.abs(internalTop - internalBottom) },
    streams: streamGaps,
    externalImbalance,
    crossStreamSpread,
  }];
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Group insertion lines by block, page, and slot.
 */
function insertionLinesByPlacement(plan: CompositionPlan): Map<string, CompositionLine[]> {
  const insertions = new Map<string, CompositionLine[]>();
  for (const line of plan.insertionLines ?? []) {
    const key = line.blockId + ':' + line.page + ':' + line.slotId;
    insertions.set(key, [...(insertions.get(key) ?? []), line]);
  }
  return insertions;
}

/**
 * @planner-target composition/evaluation/scoring.ts
 * @planner-responsibility Keep the current scoreInsertionSpacing implementation intact until its target seam is extracted.
 */
export function scoreInsertionSpacing(plan: CompositionPlan): CompositionScoreComponent {
  const ordinaryLines = plan.lines.filter((line) => line.layer !== 'insertion');
  const details = [...insertionLinesByPlacement(plan).values()]
    .flatMap((lines) => insertionSpacingDetail(lines, plan, ordinaryLines));
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
  const breakdown = [scoreColumnBalance(plan), scoreSiblingColumnImbalance(plan), scoreEmptyRegions(plan), scoreHeadingFollowingLine(document, plan), scoreParagraphFragmentation(document, plan), scoreOrphanLines(document, plan), scoreInsertionSpacing(plan), scoreInsertionSymmetry(plan), scoreInsertionDistribution(plan), scoreSpacingRhythm(plan), scoreNarrowTextIntervals(plan), scoreFitContentEnvelope(plan), scoreHeaderSpacing(plan), scoreMainStartDelay(plan), scoreElementProximity(plan), scoreFooterGap(plan), scoreGlyphOverlap(plan), scoreListContinuity(document, plan), scoreTableContinuity(document, plan), scoreTinyFragments(document, plan), ...(contrastAssessments.length > 0 ? [scoreContrast(contrastAssessments)] : [])];
  const base = scoreConfigNumber('base');
  return {
    score: base + breakdown.reduce((sum, component) => sum + component.points, 0),
    base,
    breakdown,
  };
}
