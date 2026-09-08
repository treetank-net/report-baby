import { readRenderConfig } from '../../builtin-template-source.js';

import type { CompositionDiagnostic, CompositionPlan, CompositionSlot } from '../engine.js';

import { graphicIntervalsForLine } from '../geometry/visual-geometry.js';



/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current error implementation intact until its target seam is extracted.
 */
export function error(code: string, message: string, details: Record<string, unknown> = {}): CompositionDiagnostic {
  return { severity: 'error', code, message, ...(Object.keys(details).length ? { details } : {}) };
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Append one structured evaluator error.
 */
export function pushEvaluationError(
  diagnostics: CompositionDiagnostic[],
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  diagnostics.push(error(code, message, details));
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current slotFor implementation intact until its target seam is extracted.
 */
export function slotFor(plan: CompositionPlan, slotId: string): CompositionSlot | undefined {
  return plan.slots.find((slot) => slot.id === slotId);
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current allLines implementation intact until its target seam is extracted.
 */
export function allLines(plan: CompositionPlan): CompositionPlan['lines'] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current scoreConfigNumber implementation intact until its target seam is extracted.
 */
export function scoreConfigNumber(key: string): number {
  const value = readRenderConfig().compositionScore[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite composition_score.${key}.`);
  return value;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current geometryTolerance implementation intact until its target seam is extracted.
 */
export function geometryTolerance(...values: number[]): number {
  return Number.EPSILON * Math.max(1, ...values.map((value) => Math.abs(value))) * 64;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current fitsInside implementation intact until its target seam is extracted.
 */
export function fitsInside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  const tolerance = geometryTolerance(inner.x, inner.y, inner.width, inner.height, outer.x, outer.y, outer.width, outer.height);
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current overlaps implementation intact until its target seam is extracted.
 */
export function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const horizontal = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const scale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(a.width), Math.abs(a.height), Math.abs(b.x), Math.abs(b.y), Math.abs(b.width), Math.abs(b.height));
  const precision = Number.EPSILON * scale * 32;
  return horizontal > precision && vertical > precision;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current lineEntersGraphic implementation intact until its target seam is extracted.
 */
export function lineEntersGraphic(line: CompositionPlan['lines'][number], graphic: CompositionPlan['graphicPlacements'][number]): boolean {
  return graphicIntervalsForLine(graphic, line.box.y, line.box.height).some((interval) => {
    const overlap = Math.min(line.box.x + line.box.width, interval.end) - Math.max(line.box.x, interval.start);
    const scale = Math.max(1, Math.abs(line.box.x), Math.abs(line.box.width), Math.abs(interval.start), Math.abs(interval.end));
    return overlap > Number.EPSILON * scale * 32;
  });
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current usableLinesAfter implementation intact until its target seam is extracted.
 */
export function usableLinesAfter(
  line: CompositionPlan['lines'][number],
  slot: CompositionSlot,
  graphics: CompositionPlan['graphicPlacements'],
  nextLineHeight = line.box.height,
): number {
  const lineHeight = nextLineHeight;
  if (lineHeight <= 0) return 0;
  let usable = 0;
  for (let y = line.box.y + lineHeight; y + lineHeight <= slot.box.y + slot.box.height + geometryTolerance(y, slot.box.y + slot.box.height); y += lineHeight) {
    const available = graphics.some((graphic) => graphic.page === line.page
      && graphic.slotId !== slot.id
      && graphic.wrap === 'around'
      && lineEntersGraphic({ ...line, box: { ...line.box, y } }, graphic));
    if (!available) usable += 1;
  }
  return usable;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current plannerFoundNoUsableLine implementation intact until its target seam is extracted.
 */
export function plannerFoundNoUsableLine(
  plan: CompositionPlan,
  blockId: string,
  slotId: string,
  minimum: number,
): boolean {
  const capacityDecision = plan.decisions.find((decision) => decision.code === 'BLOCK_PUSHED_TO_NEXT_SLOT'
    && decision.blockId === blockId
    && decision.slotId === slotId);
  const capacityDetails = capacityDecision?.details as { availableLines?: unknown; attemptedLines?: unknown } | undefined;
  const availableLines = capacityDetails?.availableLines;
  if (typeof availableLines === 'number' && availableLines < minimum) return true;
  if (typeof capacityDetails?.attemptedLines === 'number' && capacityDetails.attemptedLines < minimum) return true;
  if (plan.decisions.some((decision) => decision.code === 'LIST_ITEM_PUSHED_TO_NEXT_SLOT'
    && decision.blockId === blockId
    && decision.slotId === slotId
    && decision.reason === 'keep-list-item-together-below-minimum-fragment')) return true;
  if (plan.decisions.some((decision) => decision.code === 'KEEP_CLUSTER_PUSHED'
    && decision.blockId === blockId
    && (decision.slotId === slotId || decision.from === slotId)
    && decision.reason === 'insufficient-local-capacity')) return true;
  return plan.decisions.some((decision) => {
    if (decision.code !== 'FLOW_SEGMENT_ADVANCED' || decision.slotId !== slotId) return false;
    const details = decision.details as { nextBlockId?: unknown; nextBlockAvailableLines?: unknown } | undefined;
    return details?.nextBlockId === blockId
      && typeof details.nextBlockAvailableLines === 'number'
      && details.nextBlockAvailableLines < minimum;
  });
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Keep the current horizontalOverlap implementation intact until its target seam is extracted.
 */
export function horizontalOverlap(first: { x: number; width: number }, second: { x: number; width: number }): boolean {
  return Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x);
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Measure the spread between numeric samples.
 */
export function spread(values: number[]): number {
  return values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Convert a non-negative quality signal to a bounded score.
 */
export function saturatingQuality(signal: number, response: number): number {
  const nonNegativeSignal = Math.max(0, signal);
  return nonNegativeSignal / (nonNegativeSignal + response);
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Normalize a contrast ratio against its target threshold.
 */
export function normalizeContrastQuality(ratio: number, targetRatio: number, response: number): number {
  return saturatingQuality(Math.max(0, (ratio - 1) / (targetRatio - 1)), response);
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Resolve a placed item to its source flow.
 */
export function itemFlowIdForPlacedItem(
  item: CompositionPlan['lines'][number] | CompositionPlan['blockPlacements'][number] | CompositionPlan['tablePlacements'][number],
  blockFlowIds: Map<string, string>,
): string | undefined {
  return 'flowId' in item ? item.flowId : blockFlowIds.get(item.blockId);
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Convert a placement with a route position to visual order coordinates.
 */
export function visualPlacementKey(item: { page: number; routeIndex?: number; box: { x: number; y: number } }): VisualPlacementKey | undefined {
  return item.routeIndex === undefined ? undefined : [item.page, item.routeIndex, item.box.y, item.box.x];
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Find the first visual placement of a source block.
 */
export function firstVisualPlacement(plan: CompositionPlan, blockId: string): VisualPlacementKey | undefined {
  const candidates = [
    ...allLines(plan).filter((line) => line.blockId === blockId),
    ...plan.blockPlacements.filter((placement) => placement.blockId === blockId),
    ...plan.tablePlacements.filter((placement) => placement.blockId === blockId),
  ].map(visualPlacementKey).filter((key): key is VisualPlacementKey => key !== undefined);
  return candidates.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3])[0];
}

/**
 * @planner-target composition/evaluation-support.ts
 * @planner-responsibility Compare two visual placement keys for semantic order regression.
 */
export function visualOrderRegressed(current: VisualPlacementKey, previous: VisualPlacementKey): boolean {
  return current[0] < previous[0]
    || (current[0] === previous[0] && current[1] < previous[1])
    || (current[0] === previous[0] && current[1] === previous[1] && (current[2] < previous[2]
      || (current[2] === previous[2] && current[3] < previous[3])));
}

export type VisualPlacementKey = [number, number, number, number];
