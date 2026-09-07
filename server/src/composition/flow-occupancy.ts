import type {
  CompositionBlock,
  CompositionDocument,
  CompositionRect,
} from './model.js';
import type {
  CompositionPlan,
  CompositionSlot,
} from './engine.js';
import type { PageState } from './page-management.js';
import { rectBottom, rectsOverlap } from './page-management.js';

/** Return whether a flowing text line occupies the candidate slot's box. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowLineCollidesWithSlot implementation intact until its target seam is extracted.
 */
function flowLineCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
  plan: CompositionPlan,
  flowId?: string,
): boolean {
  return plan.lines.some((line) => line.layer !== 'insertion'
    && line.page === pageState.page
    && line.slotId !== slot.id
    && line.flowId !== flowId
    && rectsOverlap(box, line.box));
}

/** Return whether a structured block occupies the candidate slot's box. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current blockPlacementCollidesWithSlot implementation intact until its target seam is extracted.
 */
function blockPlacementCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
  plan: CompositionPlan,
): boolean {
  return plan.blockPlacements.some((placement) => placement.page === pageState.page
    && placement.slotId !== slot.id
    && rectsOverlap(box, placement.box));
}

/** Return whether a table occupies the candidate slot's box. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current tablePlacementCollidesWithSlot implementation intact until its target seam is extracted.
 */
function tablePlacementCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
  plan: CompositionPlan,
): boolean {
  return plan.tablePlacements.some((placement) => placement.page === pageState.page
    && placement.slotId !== slot.id
    && rectsOverlap(box, placement.box));
}

/** Return whether a reserved layout slot occupies the candidate slot's box. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current reservedSlotCollidesWithSlot implementation intact until its target seam is extracted.
 */
function reservedSlotCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
): boolean {
  return pageState.layout.slots.some((candidate) => candidate.reserved === true
    && candidate.id !== slot.id
    && rectsOverlap(box, candidate.box));
}

/** Return whether any already-planned content blocks a slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current slotCollidesWithPlacedBlock implementation intact until its target seam is extracted.
 */
export function slotCollidesWithPlacedBlock(
  pageState: PageState,
  slotId: string,
  plan: CompositionPlan,
  flowId?: string,
): boolean {
  const slot = pageState.slots.get(slotId);
  const box = slot?.box;
  if (!slot || !box) return false;
  return flowLineCollidesWithSlot(pageState, slot, box, plan, flowId)
    || blockPlacementCollidesWithSlot(pageState, slot, box, plan)
    || tablePlacementCollidesWithSlot(pageState, slot, box, plan)
    || reservedSlotCollidesWithSlot(pageState, slot, box);
}

/** Return the lowest occupied point of flowing content in one slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingTextBottom implementation intact until its target seam is extracted.
 */
export function flowingTextBottom(
  plan: CompositionPlan,
  slotId: string,
  fallback: number,
  document: CompositionDocument,
): number {
  const wrappedImages = wrappedImageIds(document);
  const lineBottom = flowingLineBottom(plan, slotId, fallback);
  const blockBottom = flowingBlockBottom(plan, slotId, lineBottom, wrappedImages);
  return flowingTableBottom(plan, slotId, blockBottom);
}

/** Find authored images that intentionally wrap flowing text. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current wrappedImageIds implementation intact until its target seam is extracted.
 */
function wrappedImageIds(document: CompositionDocument): Set<string> {
  return new Set(Object.values(document.flows).flatMap((flow) => flow.blocks)
    .filter((block) => block.kind === 'image' && (block.image?.wrap === 'left' || block.image?.wrap === 'right'))
    .map((block) => block.id));
}

/** Return the lowest flowing line in one slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingLineBottom implementation intact until its target seam is extracted.
 */
function flowingLineBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.lines
    .filter((line) => line.slotId === slotId && line.layer !== 'insertion')
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
}

/** Return the lowest non-wrapped structured block in one slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingBlockBottom implementation intact until its target seam is extracted.
 */
function flowingBlockBottom(
  plan: CompositionPlan,
  slotId: string,
  fallback: number,
  wrappedImages: Set<string>,
): number {
  return plan.blockPlacements
    .filter((placement) => placement.slotId === slotId && !wrappedImages.has(placement.blockId))
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), fallback);
}

/** Return the lowest table in one slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingTableBottom implementation intact until its target seam is extracted.
 */
function flowingTableBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), fallback);
}

/** Test horizontal overlap using the planner's floating-point tolerance. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current horizontalOverlap implementation intact until its target seam is extracted.
 */
function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

/** Return the lowest content crossing the target slot from the same flow. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current occupiedBottomInOverlappingSlots implementation intact until its target seam is extracted.
 */
export function occupiedBottomInOverlappingSlots(
  pageState: PageState,
  plan: CompositionPlan,
  targetSlot: CompositionSlot,
  fallback: number,
): number {
  const occupiedSlots = occupiedSlotMap(pageState);
  return Math.max(
    fallback,
    ...plan.lines.map((item) => overlappingItemBottom(item, pageState, targetSlot, occupiedSlots, fallback)),
    ...plan.blockPlacements.map((item) => overlappingItemBottom(item, pageState, targetSlot, occupiedSlots, fallback)),
    ...plan.tablePlacements.map((item) => overlappingItemBottom(item, pageState, targetSlot, occupiedSlots, fallback)),
  );
}

/** Index mutable page slots by their local identifier. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current occupiedSlotMap implementation intact until its target seam is extracted.
 */
function occupiedSlotMap(pageState: PageState): Map<string, CompositionSlot> {
  return new Map<string, CompositionSlot>(
    [...pageState.slots.values()].map((slot) => [slot.id, slot]),
  );
}

/** Measure one planned item when it crosses the target slot's vertical band. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current overlappingItemBottom implementation intact until its target seam is extracted.
 */
function overlappingItemBottom(
  item: { page: number; slotId: string; box: CompositionRect; layer?: string },
  pageState: PageState,
  targetSlot: CompositionSlot,
  occupiedSlots: Map<string, CompositionSlot>,
  fallback: number,
): number {
  if (item.page !== pageState.page || item.slotId === targetSlot.id) return fallback;
  if (item.layer === 'insertion') return fallback;
  const source = occupiedSlots.get(item.slotId);
  if (!source || source.flowId !== targetSlot.flowId) return fallback;
  if (source.box.y >= rectBottom(targetSlot.box)) return fallback;
  if (!horizontalOverlap(source.box, targetSlot.box)) return fallback;
  return item.box.y + item.box.height;
}

/** Resolve the authored block immediately preceding a placement in a slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current previousBlockInSlot implementation intact until its target seam is extracted.
 */
export function previousBlockInSlot(
  plan: CompositionPlan,
  slotId: string,
  currentBlockId: string,
  document: CompositionDocument,
): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = [
    ...plan.placements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.blockPlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.tablePlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
  ].sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
  return candidates.at(-1) ? blocks.get(candidates.at(-1)!.blockId) : undefined;
}

/** Find the first legal y-coordinate for structured content in a flow slot. */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current contentStartBottom implementation intact until its target seam is extracted.
 */
export function contentStartBottom(
  pageState: PageState,
  plan: CompositionPlan,
  slot: CompositionSlot,
  document: CompositionDocument,
): number {
  const local = flowingTextBottom(plan, slot.id, slot.box.y, document);
  return occupiedBottomInOverlappingSlots(pageState, plan, slot, local);
}
