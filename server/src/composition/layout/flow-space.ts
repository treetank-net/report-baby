import type {
  CompositionBlock,
  CompositionDocument,
  CompositionRect,
} from '../contracts/model.js';
import type {
  CompositionFlowBarrierBoxCandidate,
  CompositionFlowPlacement,
  CompositionGraphicPlacement,
  CompositionPlan,
  CompositionSlot,
} from '../contracts/engine-contracts.js';
import type { PageState } from '../contracts/layout-state.js';
import { rectBottom, rectsOverlap } from '../geometry/rectangles.js';
import { plannedLines } from './plan-lines.js';

/** Return whether a flowing text line occupies the candidate slot's box. */
/**
 * @planner-target composition/layout/flow-space.ts
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

/**
 * Return whether a block was deliberately materialized as an insertion obstacle.
 * Its exclusion geometry is handled by flow-barrier candidates, so the generic
 * structured-block collision guard must not treat it as an accidental overlap.
 */
function isPlannedInsertionPlacement(plan: CompositionPlan, blockId: string, page: number): boolean {
  return plan.graphicPlacements.some((graphic) => graphic.page === page && graphic.graphicId === `insertion:${blockId}`);
}

/** Return whether a structured block occupies the candidate slot's box. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current blockPlacementCollidesWithSlot implementation intact until its target seam is extracted.
 */
function blockPlacementCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
  plan: CompositionPlan,
): boolean {
  return plan.blockPlacements.some((placement) => placement.page === pageState.page
    && !isPlannedInsertionPlacement(plan, placement.blockId, placement.page)
    && placement.slotId !== slot.id
    && rectsOverlap(box, placement.box));
}

/** Return whether a table occupies the candidate slot's box. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current tablePlacementCollidesWithSlot implementation intact until its target seam is extracted.
 */
function tablePlacementCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
  plan: CompositionPlan,
): boolean {
  return plan.tablePlacements.some((placement) => placement.page === pageState.page
    && !isPlannedInsertionPlacement(plan, placement.blockId, placement.page)
    && placement.slotId !== slot.id
    && rectsOverlap(box, placement.box));
}

/** Return whether a reserved layout slot occupies the candidate slot's box. */
/**
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current wrappedImageIds implementation intact until its target seam is extracted.
 */
function wrappedImageIds(document: CompositionDocument): Set<string> {
  return new Set(Object.values(document.flows).flatMap((flow) => flow.blocks)
    .filter((block) => block.kind === 'image' && (block.image?.wrap === 'left' || block.image?.wrap === 'right'))
    .map((block) => block.id));
}

/** Return the lowest flowing line in one slot. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current flowingLineBottom implementation intact until its target seam is extracted.
 */
function flowingLineBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.lines
    .filter((line) => line.slotId === slotId && line.layer !== 'insertion')
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
}

/** Return the lowest non-wrapped structured block in one slot. */
/**
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current flowingTableBottom implementation intact until its target seam is extracted.
 */
function flowingTableBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), fallback);
}

/** Test horizontal overlap using the planner's floating-point tolerance. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current horizontalOverlap implementation intact until its target seam is extracted.
 */
function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

/** Return the lowest content crossing the target slot from the same flow. */
/**
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current occupiedSlotMap implementation intact until its target seam is extracted.
 */
function occupiedSlotMap(pageState: PageState): Map<string, CompositionSlot> {
  return new Map<string, CompositionSlot>(
    [...pageState.slots.values()].map((slot) => [slot.id, slot]),
  );
}

/** Measure one planned item when it crosses the target slot's vertical band. */
/**
 * @planner-target composition/layout/flow-space.ts
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
  // Role-constrained slots are independently addressed regions (for example
  // title, subtitle, and eyebrow). Their boxes may intentionally touch or
  // overlap, but content in one must not push content in another.
  if ((source.allowedRoles?.length ?? 0) > 0 && (targetSlot.allowedRoles?.length ?? 0) > 0) return fallback;
  if (source.box.y >= rectBottom(targetSlot.box)) return fallback;
  if (!horizontalOverlap(source.box, targetSlot.box)) return fallback;
  return item.box.y + item.box.height;
}

/** Resolve the authored block immediately preceding a placement in a slot. */
/**
 * @planner-target composition/layout/flow-space.ts
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
 * @planner-target composition/layout/flow-space.ts
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

/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current coversFlowWidth implementation intact until its target seam is extracted.
 */
function coversFlowWidth(flow: CompositionRect, graphic: CompositionRect): boolean {
  return graphic.x <= flow.x && graphic.x + graphic.width >= flow.x + flow.width;
}

/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current blockFlowIds implementation intact until its target seam is extracted.
 */
function blockFlowIds(document: CompositionDocument): Map<string, string> {
  return new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block: CompositionBlock) => [block.id, flowId] as const)));
}

function addFlowContent(
  contentBySlot: Map<string, Set<string>>,
  flowId: string | undefined,
  slotId: string,
  blockId: string,
): void {
  if (!flowId) return;
  const key = `${flowId}:${slotId}`;
  const blockIds = contentBySlot.get(key) ?? new Set<string>();
  blockIds.add(blockId);
  contentBySlot.set(key, blockIds);
}

/** Build the renderer-neutral flow-to-slot projection used by tracing and evaluation. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current registerFlowPlacements implementation intact until its target seam is extracted.
 */
export function registerFlowPlacements(document: CompositionDocument, plan: CompositionPlan): CompositionFlowPlacement[] {
  const flowIdsByBlock = blockFlowIds(document);
  const contentBySlot = new Map<string, Set<string>>();
  const linesBySlot = new Map<string, number>();
  for (const line of plannedLines(plan)) {
    addFlowContent(contentBySlot, line.flowId, line.slotId, line.blockId);
    linesBySlot.set(line.slotId, (linesBySlot.get(line.slotId) ?? 0) + 1);
  }
  for (const placement of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    addFlowContent(contentBySlot, flowIdsByBlock.get(placement.blockId), placement.slotId, placement.blockId);
  }
  return plan.slots
    .filter((slot): slot is CompositionSlot & { flowId: string; routeIndex: number } => slot.flowId !== undefined && slot.routeIndex !== undefined && slot.kind === 'text')
    .map((slot) => {
      const key = `${slot.flowId}:${slot.id}`;
      const blockIds = [...(contentBySlot.get(key) ?? new Set<string>())];
      const blockedBy = plan.graphicPlacements
        .filter((graphic) => graphic.page === slot.page && graphic.wrap === 'around'
          && graphic.box.x <= slot.box.x
          && graphic.box.y <= slot.box.y
          && rectBottom(graphic.box) >= rectBottom(slot.box)
          && graphic.box.x + graphic.box.width >= slot.box.x + slot.box.width)
        .map((graphic) => graphic.graphicId);
      return {
        id: `flow-placement:${slot.id}`,
        flowId: slot.flowId,
        page: slot.page,
        slotId: slot.id,
        routeIndex: slot.routeIndex,
        box: { ...slot.box },
        state: slot.state,
        hasContent: blockIds.length > 0,
        blockIds,
        lineCount: linesBySlot.get(slot.id) ?? 0,
        blockedBy,
      };
    })
    .sort((left, right) => left.page - right.page || left.routeIndex - right.routeIndex || left.slotId.localeCompare(right.slotId));
}

/** Split a text-flow placement at each overlapping wrap graphic. */
/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current splitFlowBarrierBoxCandidates implementation intact until its target seam is extracted.
 */
export function splitFlowBarrierBoxCandidates(
  textPlacements: Array<Pick<CompositionFlowPlacement, 'id' | 'flowId' | 'page' | 'slotId' | 'box'>>,
  graphics: CompositionGraphicPlacement[],
): CompositionFlowBarrierBoxCandidate[] {
  const barriers = graphics.filter((candidate) => candidate.wrap === 'around');
  const candidates: CompositionFlowBarrierBoxCandidate[] = [];
  for (const placement of textPlacements) {
    const placementBottom = rectBottom(placement.box);
    const boundaries = barriers
      .filter((candidate) => candidate.page === placement.page && candidate.slotId !== placement.slotId && horizontalOverlap(placement.box, candidate.box) && rectsOverlap(placement.box, candidate.box))
      .filter((candidate) => coversFlowWidth(placement.box, candidate.box))
      .sort((left, right) => left.box.y - right.box.y || left.graphicId.localeCompare(right.graphicId));
    if (boundaries.length === 0) continue;
    let segmentTop = placement.box.y;
    let previousSourceId: string | undefined;
    for (const boundary of boundaries) {
      const boundaryTop = Math.max(placement.box.y, Math.min(placementBottom, boundary.box.y));
      if (boundaryTop > segmentTop) {
        candidates.push({
          id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:${boundary.graphicId}`,
          flowId: placement.flowId,
          ...(previousSourceId === undefined ? {} : { previousSourceId }),
          nextSourceId: boundary.graphicId,
          placementId: placement.id,
          page: placement.page,
          box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: boundaryTop - segmentTop },
        });
      }
      segmentTop = Math.max(segmentTop, Math.min(placementBottom, rectBottom(boundary.box)));
      previousSourceId = boundary.graphicId;
    }
    if (placementBottom > segmentTop) {
      candidates.push({
        id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:flow-end`,
        flowId: placement.flowId,
        ...(previousSourceId === undefined ? {} : { previousSourceId }),
        placementId: placement.id,
        page: placement.page,
        box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: placementBottom - segmentTop },
      });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.flowId.localeCompare(right.flowId) || left.placementId.localeCompare(right.placementId) || (left.nextSourceId ?? '').localeCompare(right.nextSourceId ?? ''));
}

/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current flowBarrierBoxCandidatesForSlot implementation intact until its target seam is extracted.
 */
export function flowBarrierBoxCandidatesForSlot(
  page: number,
  slot: CompositionSlot,
  flowId: string,
  graphics: CompositionGraphicPlacement[],
): CompositionFlowBarrierBoxCandidate[] {
  if (slot.kind !== 'text') return [];
  return splitFlowBarrierBoxCandidates([{
    id: `flow-placement:${slot.id}`,
    flowId,
    page,
    slotId: slot.id,
    box: { ...slot.box },
  }], graphics);
}

/**
 * @planner-target composition/layout/flow-space.ts
 * @planner-responsibility Keep the current registerFlowBarrierBoxCandidates implementation intact until its target seam is extracted.
 */
export function registerFlowBarrierBoxCandidates(plan: CompositionPlan): CompositionFlowBarrierBoxCandidate[] {
  const textPlacements = (plan.flowPlacements ?? []).filter((placement) => placement.flowId !== undefined);
  return splitFlowBarrierBoxCandidates(textPlacements, plan.graphicPlacements);
}
