import type { CompositionPlan, CompositionSlot } from '../contracts/engine-contracts.js';

/** Find a materialized slot by its page-qualified identifier. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current slotFor implementation intact until its target seam is extracted.
 */
export function slotFor(plan: CompositionPlan, slotId: string): CompositionSlot | undefined {
  return plan.slots.find((slot) => slot.id === slotId);
}

/** Return ordinary and insertion lines through one read-only projection. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current allLines implementation intact until its target seam is extracted.
 */
export function allLines(plan: CompositionPlan): CompositionPlan['lines'] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

/** Determine whether planner decisions explain a missing usable fragment. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
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

/** Resolve a placed item to its source flow. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current itemFlowIdForPlacedItem implementation intact until its target seam is extracted.
 */
export function itemFlowIdForPlacedItem(
  item: CompositionPlan['lines'][number] | CompositionPlan['blockPlacements'][number] | CompositionPlan['tablePlacements'][number],
  blockFlowIds: Map<string, string>,
): string | undefined {
  return 'flowId' in item ? item.flowId : blockFlowIds.get(item.blockId);
}

export type VisualPlacementKey = [number, number, number, number];

/** Convert a placement with a route position to visual order coordinates. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current visualPlacementKey implementation intact until its target seam is extracted.
 */
export function visualPlacementKey(item: { page: number; routeIndex?: number; box: { x: number; y: number } }): VisualPlacementKey | undefined {
  return item.routeIndex === undefined ? undefined : [item.page, item.routeIndex, item.box.y, item.box.x];
}

/** Find the first visual placement of a source block. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current firstVisualPlacement implementation intact until its target seam is extracted.
 */
export function firstVisualPlacement(plan: CompositionPlan, blockId: string): VisualPlacementKey | undefined {
  const candidates = [
    ...allLines(plan).filter((line) => line.blockId === blockId),
    ...plan.blockPlacements.filter((placement) => placement.blockId === blockId),
    ...plan.tablePlacements.filter((placement) => placement.blockId === blockId),
  ].map(visualPlacementKey).filter((key): key is VisualPlacementKey => key !== undefined);
  return candidates.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3])[0];
}

/** Compare two visual placement keys for semantic order regression. */
/**
 * @planner-target composition/evaluation/plan-queries.ts
 * @planner-responsibility Keep the current visualOrderRegressed implementation intact until its target seam is extracted.
 */
export function visualOrderRegressed(current: VisualPlacementKey, previous: VisualPlacementKey): boolean {
  return current[0] < previous[0]
    || (current[0] === previous[0] && current[1] < previous[1])
    || (current[0] === previous[0] && current[1] === previous[1] && (current[2] < previous[2]
      || (current[2] === previous[2] && current[3] < previous[3])));
}
