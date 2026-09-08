import { readRenderConfig } from '../../builtin-template-source.js';

import type { CompositionDocument, CompositionBlock } from '../model.js';

import type { CompositionContrastAssessment } from './contrast.js';

import type { CompositionLine, CompositionPlan, CompositionScoreComponent } from '../contracts/engine-contracts.js';

import { allLines } from './plan-queries.js';

function scoreConfigNumber(key: string): number {
  const value = readRenderConfig().compositionScore[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite composition_score.${key}.`);
  return value;
}

function horizontalOverlap(first: { x: number; width: number }, second: { x: number; width: number }): boolean {
  return Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x);
}

function spread(values: number[]): number {
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

function saturatingQuality(signal: number, response: number): number {
  const nonNegativeSignal = Math.max(0, signal);
  return nonNegativeSignal / (nonNegativeSignal + response);
}

function normalizeContrastQuality(ratio: number, targetRatio: number, response: number): number {
  return saturatingQuality(Math.max(0, (ratio - 1) / (targetRatio - 1)), response);
}



/**
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
};

/**
 * @planner-target composition/evaluation-scoring.ts
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
    }];
  });
}

/**
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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

/**
 * @planner-target composition/evaluation-scoring.ts
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
    return [{ slotId: slot.id, before, after, imbalance: Math.abs(before - after) }];
  });
  const externalImbalance = streamGaps.length > 0
    ? streamGaps.reduce((sum, gap) => sum + gap.imbalance, 0) / streamGaps.length
    : 0;
  const beforeGaps = streamGaps.map((gap) => gap.before);
  const afterGaps = streamGaps.map((gap) => gap.after);
  const crossStreamSpread = (spread(beforeGaps) + spread(afterGaps)) / 2;
  return [{
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
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
 * @planner-target composition/evaluation-scoring.ts
 * @planner-responsibility Keep the current scoreLegalPlan implementation intact until its target seam is extracted.
 */
export function scoreLegalPlan(document: CompositionDocument, plan: CompositionPlan, contrastAssessments: CompositionContrastAssessment[] = []): { score: number; breakdown: CompositionScoreComponent[] } {
  const breakdown = [scoreColumnBalance(plan), scoreHeadingFollowingLine(document, plan), scoreParagraphFragmentation(document, plan), scoreOrphanLines(document, plan), scoreInsertionSpacing(plan), ...(contrastAssessments.length > 0 ? [scoreContrast(contrastAssessments)] : [])];
  return {
    score: scoreConfigNumber('base') + breakdown.reduce((sum, component) => sum + component.points, 0),
    breakdown,
  };
}
