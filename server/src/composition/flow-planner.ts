import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionPlan,
  CompositionSlot,
  CompositionTextMetrics,
} from './engine.js';
import {
  addResidual,
  addTableResidual,
  diagnostic,
  ensurePage,
  rectBottom,
  rectsOverlap,
  lineHeight,
  placeGraphicsForPage,
  placeLines,
  routeLayout,
  routeSlots,
  styleFor,
  textPadding,
  wrapBlock,
  wordsForBlock,
} from './text-planner.js';
import type {
  PageState,
  TextCompositionPlannerPolicy,
} from './text-planner.js';
import { flowBarrierBoxCandidatesForSlot } from './flow-barriers.js';
import { hasRoleEligibleSlot, slotFor } from './route-slots.js';
import { insertionKey, nextInsertionBoundary, nextInsertionProposal } from './insertion-order.js';
import { obstructionAcrossLineBands } from './text-wrapping.js';
import { availableLineCount } from './line-capacity.js';
import { placeStructuredBlock } from './structured-block-placement.js';
import type { PlannedInsertion } from './text-planner-candidates.js';
import { recordFlowDecision } from './planning-records.js';

/**
 * Flow-level planning owns authored block order, route progression, and the
 * cursor that walks a flow through already-created document pages. Page
 * creation remains a document-level operation (`ensurePage`) until the
 * document orchestration is extracted in a later step.
 */
export interface FlowCursor {
  blockIndex: number;
  startWord: number;
  startRow: number;
  page: number;
  routeIndex: number;
  resumeY?: number;
  resumeSlotId?: string;
}

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

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current slotCollidesWithPlacedBlock implementation intact until its target seam is extracted.
 */
function slotCollidesWithPlacedBlock(pageState: PageState, slotId: string, plan: CompositionPlan, flowId?: string): boolean {
  const slot = pageState.slots.get(slotId);
  const box = slot?.box;
  if (!slot || !box) return false;
  return flowLineCollidesWithSlot(pageState, slot, box, plan, flowId)
    || blockPlacementCollidesWithSlot(pageState, slot, box, plan)
    || tablePlacementCollidesWithSlot(pageState, slot, box, plan)
    || reservedSlotCollidesWithSlot(pageState, slot, box);
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current slotBox implementation intact until its target seam is extracted.
 */
function slotBox(pageState: PageState, definition: CompositionSlotTemplate): CompositionRect {
  return pageState.slots.get(definition.id)?.box ?? definition.box;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current growthDelta implementation intact until its target seam is extracted.
 */
function growthDelta(
  slot: CompositionSlot,
  definition: CompositionSlotTemplate,
  requiredBottom: number,
): number {
  const growth = definition.grow;
  if (!growth || growth.axis !== 'y') return 0;
  const maxBottom = definition.box.y + growth.maxHeight;
  const nextBottom = Math.min(maxBottom, Math.max(rectBottom(slot.box), requiredBottom));
  return nextBottom - rectBottom(slot.box);
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current resizeGrownSlot implementation intact until its target seam is extracted.
 */
function resizeGrownSlot(slot: CompositionSlot, delta: number): void {
  slot.box.height += delta;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current resizePushedTextSlot implementation intact until its target seam is extracted.
 */
function resizePushedTextSlot(
  pageState: PageState,
  pushedId: string,
  delta: number,
): void {
  const pushed = pageState.slots.get(pushedId);
  if (!pushed) return;
  pushed.box.y += delta;
  // Atomic/block slots have an intrinsic measured size. Moving one must not
  // silently make it shorter than the backend can render; only text slots
  // are elastic after a preceding box grows.
  const pushedDefinition = pageState.layout.slots.find((candidate) => candidate.id === pushedId);
  if (pushedDefinition?.kind !== 'text') return;
  pushed.box.height = Math.max(0, pushed.box.height - delta);
  if (pushed.box.height === 0) pushed.state = 'exhausted';
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current movePushedSlots implementation intact until its target seam is extracted.
 */
function movePushedSlots(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  delta: number,
): void {
  for (const pushedId of definition.grow?.pushes ?? []) {
    resizePushedTextSlot(pageState, pushedId, delta);
  }
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current recordSlotGrowth implementation intact until its target seam is extracted.
 */
function recordSlotGrowth(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): void {
  recordFlowDecision(context, 'SLOT_GROWN', runtime, target);
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Apply one legal slot-growth operation and move affected slots.
 */
function growSlot(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  requiredBottom: number,
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  const delta = growthDelta(slot, definition, requiredBottom);
  if (delta <= 0) return;
  resizeGrownSlot(slot, delta);
  movePushedSlots(pageState, definition, delta);
  recordSlotGrowth(context, runtime, target);
}

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingTextBottom implementation intact until its target seam is extracted.
 */
export function flowingTextBottom(plan: CompositionPlan, slotId: string, fallback: number, document: CompositionDocument): number {
  const wrappedImages = wrappedImageIds(document);
  const lineBottom = flowingLineBottom(plan, slotId, fallback);
  const blockBottom = flowingBlockBottom(plan, slotId, lineBottom, wrappedImages);
  return flowingTableBottom(plan, slotId, blockBottom);
}

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current wrappedImageIds implementation intact until its target seam is extracted.
 */
function wrappedImageIds(document: CompositionDocument): Set<string> {
  return new Set(Object.values(document.flows).flatMap((flow) => flow.blocks)
    .filter((block) => block.kind === 'image' && (block.image?.wrap === 'left' || block.image?.wrap === 'right'))
    .map((block) => block.id));
}

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingLineBottom implementation intact until its target seam is extracted.
 */
function flowingLineBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.lines
    .filter((line) => line.slotId === slotId && line.layer !== 'insertion')
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
}

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

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current flowingTableBottom implementation intact until its target seam is extracted.
 */
function flowingTableBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), fallback);
}

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current horizontalOverlap implementation intact until its target seam is extracted.
 */
function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

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

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current occupiedSlotMap implementation intact until its target seam is extracted.
 */
function occupiedSlotMap(pageState: PageState): Map<string, CompositionSlot> {
  return new Map<string, CompositionSlot>(
    [...pageState.slots.values()].map((slot) => [slot.id, slot]),
  );
}

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

/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current previousBlockInSlot implementation intact until its target seam is extracted.
 */
function previousBlockInSlot(plan: CompositionPlan, slotId: string, currentBlockId: string, document: CompositionDocument): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = [
    ...plan.placements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.blockPlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.tablePlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
  ].sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
  return candidates.at(-1) ? blocks.get(candidates.at(-1)!.blockId) : undefined;
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current collapseUnusedInsertions implementation intact until its target seam is extracted.
 */
function collapseUnusedInsertions(
  pageState: PageState,
  routeSlotIds: string[],
  fromRouteIndex: number,
  toRouteIndex: number,
  context: FlowPlanningContext,
  runtime: FlowRuntime,
): void {
  for (let index = fromRouteIndex; index < toRouteIndex; index += 1) {
    const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[index]);
    const insertion = definition ? pageState.slots.get(definition.id) : undefined;
    collapseInsertion(pageState, definition, insertion, context, runtime, 'no-insertion-content-on-page');
  }
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current collapseInsertionBeforeContinuation implementation intact until its target seam is extracted.
 */
function collapseInsertionBeforeContinuation(
  pageState: PageState,
  routeSlotIds: string[],
  routeIndex: number,
  context: FlowPlanningContext,
  runtime: FlowRuntime,
): void {
  const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[routeIndex]);
  const insertion = definition ? pageState.slots.get(definition.id) : undefined;
  collapseInsertion(pageState, definition, insertion, context, runtime, 'continuation-needs-uninterrupted-column');
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current collapseInsertion implementation intact until its target seam is extracted.
 */
function collapseInsertion(
  pageState: PageState,
  definition: CompositionSlotTemplate | undefined,
  insertion: CompositionSlot | undefined,
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  reason: string,
): void {
  if (!definition?.allowedRoles?.includes('quote') || !insertion || insertion.state !== 'open') return;
  const delta = insertion.box.height;
  if (delta <= 0) {
    insertion.state = 'exhausted';
    return;
  }
  // An insertion is an obstacle in the existing column geometry. The text
  // stream is split around that obstacle; moving later boxes would turn the
  // two columns into independently positioned blocks and can pull a right
  // column above the left-column content.
  insertion.state = 'exhausted';
  recordFlowDecision(context, 'OPTIONAL_INSERTION_COLLAPSED', runtime, undefined, reason);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current advanceCursor implementation intact until its target seam is extracted.
 */
function advanceCursor(
  cursor: FlowCursor,
  routeSlotsForPage: string[],
): void {
  cursor.routeIndex += 1;
  cursor.resumeY = undefined;
  cursor.resumeSlotId = undefined;
  if (cursor.routeIndex >= routeSlotsForPage.length) {
    cursor.routeIndex = 0;
    cursor.page += 1;
    cursor.resumeY = undefined;
  }
}

/**
 * Return the first free y-coordinate for structured content in a flow slot.
 * The calculation includes content already placed in overlapping slots of
 * the same flow, so a table or atomic block cannot overlap an earlier band.
 */
/**
 * @planner-target composition/flow-occupancy.ts
 * @planner-responsibility Keep the current contentStartBottom implementation intact until its target seam is extracted.
 */
function contentStartBottom(
  pageState: PageState,
  plan: CompositionPlan,
  slot: CompositionSlot,
  document: CompositionDocument,
): number {
  const local = flowingTextBottom(plan, slot.id, slot.box.y, document);
  return occupiedBottomInOverlappingSlots(pageState, plan, slot, local);
}

type DeferredQuote = {
  blockIndex: number;
  deferredPage: number;
  routeIndex?: number;
};

type ActiveDeferredQuote = {
  blockIndex: number;
  blockId: string;
  resume: {
    blockIndex: number;
    startWord: number;
    startRow: number;
  };
};

export interface FlowPlanningContext {
  document: CompositionDocument;
  metrics: CompositionTextMetrics;
  template: CompositionTemplate;
  policy: TextCompositionPlannerPolicy;
  flowId: string;
  route: CompositionFlowRoute;
  pages: PageState[];
  plan: CompositionPlan;
  startPage: number;
  insertionProposals: Map<string, PlannedInsertion>;
  skipPreplannedInsertions: boolean;
  authoredBlocks: CompositionBlock[];
  blocks: CompositionBlock[];
  authoredIndexOf: (blockId: string) => number;
  geometryTolerance: number;
}

export interface FlowRuntime {
  cursor: FlowCursor;
  deferredQuote?: DeferredQuote;
  activeDeferredQuote?: ActiveDeferredQuote;
  lastLegalSlotId?: string;
}

export interface SelectedFlowSlot {
  definition: CompositionSlotTemplate;
  routeIndex: number;
}

export interface FlowTarget {
  currentPage: PageState;
  availableRouteSlots: string[];
  block: CompositionBlock;
  selectedSlot: SelectedFlowSlot;
  definition: CompositionSlotTemplate;
  continuousInsertion: boolean;
}

type FlowTargetResolution =
  | { kind: 'ready'; target: FlowTarget }
  | { kind: 'continue' }
  | { kind: 'stop' };

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current createFlowPlanningContext implementation intact until its target seam is extracted.
 */
function createFlowPlanningContext(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  flowId: string,
  route: CompositionFlowRoute,
  pages: PageState[],
  plan: CompositionPlan,
  startPage: number,
  insertionProposals: Map<string, PlannedInsertion>,
  skipPreplannedInsertions: boolean,
): FlowPlanningContext | undefined {
  const flow = document.flows[flowId];
  if (!flow) return undefined;
  const authoredBlocks = flow.blocks;
  const blocks = skipPreplannedInsertions
    ? authoredBlocks.filter((block) => block.role !== 'quote')
    : authoredBlocks;
  return {
    document,
    metrics,
    template,
    policy,
    flowId,
    route,
    pages,
    plan,
    startPage,
    insertionProposals,
    skipPreplannedInsertions,
    authoredBlocks,
    blocks,
    authoredIndexOf: (blockId) => authoredBlocks.findIndex((candidate) => candidate.id === blockId),
    geometryTolerance: policy.geometryTolerance ?? 0,
  };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current createFlowRuntime implementation intact until its target seam is extracted.
 */
function createFlowRuntime(context: FlowPlanningContext): FlowRuntime {
  return {
    cursor: {
      blockIndex: 0,
      startWord: 0,
      startRow: 0,
      page: context.startPage,
      routeIndex: 0,
    },
  };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current currentFlowBlock implementation intact until its target seam is extracted.
 */
function currentFlowBlock(context: FlowPlanningContext, runtime: FlowRuntime): CompositionBlock {
  return context.blocks[runtime.cursor.blockIndex];
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current recordFlowResidual implementation intact until its target seam is extracted.
 */
function recordFlowResidual(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  reason: string,
): void {
  const block = currentFlowBlock(context, runtime);
  if (block.kind === 'table') {
    addTableResidual(context.plan.residualContent, context.flowId, block, runtime.cursor.startRow, runtime.lastLegalSlotId, reason);
    return;
  }
  addResidual(context.plan.residualContent, context.flowId, block, runtime.cursor.startWord, runtime.lastLegalSlotId, reason);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current rejectFlowForPageLimit implementation intact until its target seam is extracted.
 */
function rejectFlowForPageLimit(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const block = currentFlowBlock(context, runtime);
  context.plan.diagnostics.push(diagnostic('error', 'MAX_PAGES_EXCEEDED', `Flow '${context.flowId}' exceeded the template page limit.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
  recordFlowResidual(context, runtime, 'max-pages');
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current rejectFlowContinuation implementation intact until its target seam is extracted.
 */
function rejectFlowContinuation(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const block = currentFlowBlock(context, runtime);
  context.plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${context.flowId}' cannot continue beyond its first page.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
  recordFlowResidual(context, runtime, 'flow-continuation-forbidden');
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current flowReachedTerminalPage implementation intact until its target seam is extracted.
 */
function flowReachedTerminalPage(context: FlowPlanningContext, runtime: FlowRuntime): boolean {
  if (runtime.cursor.page > context.template.maxPages) {
    rejectFlowForPageLimit(context, runtime);
    return true;
  }
  if (runtime.cursor.page > context.startPage && context.route.continuation === 'forbidden') {
    rejectFlowContinuation(context, runtime);
    return true;
  }
  return false;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current ensureCurrentFlowPage implementation intact until its target seam is extracted.
 */
function ensureCurrentFlowPage(context: FlowPlanningContext, runtime: FlowRuntime): PageState | undefined {
  return ensurePage(context.pages, context.template, context.route, runtime.cursor.page, context.plan.diagnostics, context.flowId);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current holdFlowForPreplannedInsertion implementation intact until its target seam is extracted.
 */
function holdFlowForPreplannedInsertion(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
): boolean {
  const block = currentFlowBlock(context, runtime);
  const authoredIndex = context.authoredIndexOf(block.id);
  const precedingInsertionPage = context.authoredBlocks
    .slice(0, authoredIndex)
    .filter((candidate) => candidate.role === 'quote')
    .map((candidate) => context.insertionProposals.get(insertionKey(context.flowId, candidate.id))?.page)
    .filter((page): page is number => page !== undefined)
    .sort((left, right) => right - left)[0];
  if (precedingInsertionPage === undefined || runtime.cursor.page >= precedingInsertionPage) return false;
  recordFlowDecision(context, 'FLOW_HELD_FOR_PREPLANNED_INSERTION', runtime, undefined, 'successor-must-not-pass-earlier-insertion');
  runtime.cursor.page = precedingInsertionPage;
  runtime.cursor.routeIndex = 0;
  runtime.cursor.resumeY = undefined;
  return true;
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current restoreDeferredQuoteOnCurrentPage implementation intact until its target seam is extracted.
 */
function restoreDeferredQuoteOnCurrentPage(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const deferred = runtime.deferredQuote;
  if (!deferred || runtime.activeDeferredQuote || runtime.cursor.page !== deferred.deferredPage || deferred.routeIndex === undefined || runtime.cursor.routeIndex < deferred.routeIndex) return;
  runtime.activeDeferredQuote = {
    blockIndex: deferred.blockIndex,
    blockId: context.blocks[deferred.blockIndex].id,
    resume: { blockIndex: runtime.cursor.blockIndex, startWord: runtime.cursor.startWord, startRow: runtime.cursor.startRow },
  };
  runtime.cursor.blockIndex = deferred.blockIndex;
  runtime.cursor.startWord = 0;
  runtime.cursor.startRow = 0;
  runtime.cursor.routeIndex = deferred.routeIndex;
  recordFlowDecision(context, 'INSERTION_REPOSITIONED_PLACED', runtime, undefined, 'earlier-route-segment-was-empty');
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current restoreDeferredQuoteOnNextPage implementation intact until its target seam is extracted.
 */
function restoreDeferredQuoteOnNextPage(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const deferred = runtime.deferredQuote;
  if (!deferred || runtime.activeDeferredQuote || runtime.cursor.page <= deferred.deferredPage) return;
  runtime.activeDeferredQuote = {
    blockIndex: deferred.blockIndex,
    blockId: context.blocks[deferred.blockIndex].id,
    resume: { blockIndex: runtime.cursor.blockIndex, startWord: runtime.cursor.startWord, startRow: runtime.cursor.startRow },
  };
  runtime.cursor.blockIndex = deferred.blockIndex;
  runtime.cursor.startWord = 0;
  runtime.cursor.startRow = 0;
  runtime.cursor.routeIndex = 0;
  recordFlowDecision(context, 'DEFERRED_INSERTION_PLACED', runtime, undefined, 'next-page-insertion-slot');
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current plannedInsertionForBlock implementation intact until its target seam is extracted.
 */
function plannedInsertionForBlock(
  context: FlowPlanningContext,
  block: CompositionBlock,
): PlannedInsertion | undefined {
  return block.role === 'quote'
    ? context.insertionProposals.get(insertionKey(context.flowId, block.id))
    : undefined;
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current insertionPassedItsPlannedPage implementation intact until its target seam is extracted.
 */
function insertionPassedItsPlannedPage(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  plannedInsertion: PlannedInsertion | undefined,
): boolean {
  if (!plannedInsertion || currentPage.page <= plannedInsertion.page) return false;
  const block = currentFlowBlock(context, runtime);
  context.plan.diagnostics.push(diagnostic('error', 'INSERTION_PLAN_PASSED', `Insertion '${block.id}' passed its stabilized page ${plannedInsertion.page}.`, { flowId: context.flowId, blockId: block.id, page: currentPage.page, details: { plannedPage: plannedInsertion.page, plannedSlotId: plannedInsertion.slotId } }));
  recordFlowResidual(context, runtime, 'insertion-plan-passed');
  return true;
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current insertionDefinitionForBlock implementation intact until its target seam is extracted.
 */
function insertionDefinitionForBlock(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  plannedInsertion: PlannedInsertion | undefined,
): CompositionSlotTemplate | undefined {
  const block = currentFlowBlock(context, runtime);
  if (block.role !== 'quote') return undefined;
  if (plannedInsertion && currentPage.page === plannedInsertion.page) {
    return currentPage.layout.slots.find((slot) => slot.id === plannedInsertion.slotId && slot.allowedRoles?.includes('quote'));
  }
  return undefined;
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current hasInsertionSlotOnNextPage implementation intact until its target seam is extracted.
 */
function hasInsertionSlotOnNextPage(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  block: CompositionBlock,
): boolean {
  const nextLayout = routeLayout(context.route, context.template, runtime.cursor.page + 1);
  const nextSlotIds = nextLayout ? routeSlots(context.route, nextLayout) : [];
  return nextLayout !== undefined && hasRoleEligibleSlot(nextLayout, nextSlotIds, 0, context.flowId, block);
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current deferInsertionToNextPage implementation intact until its target seam is extracted.
 */
function deferInsertionToNextPage(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
): boolean {
  const block = currentFlowBlock(context, runtime);
  if (block.role !== 'quote' || context.route.continuation !== 'allowed' || runtime.cursor.page !== context.startPage || runtime.deferredQuote) return false;
  if (!hasInsertionSlotOnNextPage(context, runtime, block)) return false;
  recordFlowDecision(context, 'INSERTION_DEFERRED', runtime, undefined, 'insertion-slot-only-on-continuation');
  runtime.deferredQuote = { blockIndex: runtime.cursor.blockIndex, deferredPage: runtime.cursor.page };
  runtime.cursor.blockIndex += 1;
  runtime.cursor.startWord = 0;
  runtime.cursor.startRow = 0;
  runtime.cursor.routeIndex = 0;
  return true;
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current resolveUnavailableFlowSlot implementation intact until its target seam is extracted.
 */
function resolveUnavailableFlowSlot(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  availableRouteSlots: string[],
  selectedSlot: SelectedFlowSlot | undefined,
): FlowTargetResolution {
  const block = currentFlowBlock(context, runtime);
  if (selectedSlot === undefined && !hasRoleEligibleSlot(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots)) {
    if (deferInsertionToNextPage(context, runtime)) return { kind: 'continue' };
    if (context.route.continuation === 'allowed') {
      recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_PAGE', runtime, undefined, 'no-eligible-slot-on-page');
      advanceCursor(runtime.cursor, availableRouteSlots);
      return { kind: 'continue' };
    }
  }
  context.plan.diagnostics.push(diagnostic('error', 'FLOW_SLOT_NOT_FOUND', `Flow '${context.flowId}' cannot use route slot '${availableRouteSlots[runtime.cursor.routeIndex] ?? ''}'.`, { flowId: context.flowId, page: currentPage.page }));
  recordFlowResidual(context, runtime, 'no-legal-slot');
  return { kind: 'stop' };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current selectFlowSlot implementation intact until its target seam is extracted.
 */
function selectFlowSlot(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  availableRouteSlots: string[],
  block: CompositionBlock,
  insertionDefinition: CompositionSlotTemplate | undefined,
): SelectedFlowSlot | undefined {
  const selectedSlot = insertionDefinition
    ? { definition: insertionDefinition, routeIndex: runtime.cursor.routeIndex }
    : slotFor(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots);
  if (block.role === 'quote' || runtime.cursor.startWord === 0 || !selectedSlot) return selectedSlot;
  const insertionIndex = availableRouteSlots.findIndex((slotId, index) => index >= runtime.cursor.routeIndex
    && index < selectedSlot.routeIndex
    && currentPage.layout.slots.some((slot) => slot.id === slotId && slot.allowedRoles?.includes('quote'))
    && currentPage.slots.get(slotId)?.state === 'open');
  if (insertionIndex < 0) return selectedSlot;
  collapseInsertionBeforeContinuation(currentPage, availableRouteSlots, insertionIndex, context, runtime);
  return slotFor(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Resolve the legal slot and page target for the next flow block.
 */
function resolveFlowTarget(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
): FlowTargetResolution {
  placeGraphicsForPage(context.document, currentPage, context.plan);
  const availableRouteSlots = routeSlots(context.route, currentPage.layout);
  const block = currentFlowBlock(context, runtime);
  const plannedInsertion = plannedInsertionForBlock(context, block);
  if (insertionPassedItsPlannedPage(context, runtime, currentPage, plannedInsertion)) return { kind: 'stop' };
  const insertionDefinition = insertionDefinitionForBlock(context, runtime, currentPage, plannedInsertion);
  const selectedSlot = selectFlowSlot(context, runtime, currentPage, availableRouteSlots, block, insertionDefinition);
  if (!selectedSlot || (selectedSlot.definition.kind !== 'text' && selectedSlot.definition.kind !== 'block')) {
    return resolveUnavailableFlowSlot(context, runtime, currentPage, availableRouteSlots, selectedSlot);
  }
  const routeStartIndex = runtime.cursor.routeIndex;
  runtime.cursor.routeIndex = selectedSlot.routeIndex;
  const continuousInsertion = block.role === 'quote' && (context.route.insertionSlots?.includes(selectedSlot.definition.id) ?? false);
  if (block.role !== 'quote') {
    collapseUnusedInsertions(currentPage, availableRouteSlots, routeStartIndex, selectedSlot.routeIndex, context, runtime);
  }
  return {
    kind: 'ready',
    target: {
      currentPage,
      availableRouteSlots,
      block,
      selectedSlot,
      definition: selectedSlot.definition,
      continuousInsertion,
    },
  };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Dispatch non-text block placement after collision and asset checks.
 */
function handleNonTextFlowPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): boolean {
  const { currentPage, availableRouteSlots, block, selectedSlot, definition } = target;
  const { cursor } = runtime;
  const { document, metrics, geometryTolerance, plan, flowId } = context;
  // Header/footer text deliberately shares its chrome band with the
  // reserved lockup. The lockup is a paint reservation, not a competing
  // content block, so it must not push the auxiliary flow to another page.
  if (flowId !== 'title' && flowId !== 'header' && flowId !== 'footer' && slotCollidesWithPlacedBlock(currentPage, definition.id, plan, flowId)) {
    recordFlowDecision(context, 'TEXT_SLOT_COLLISION_PUSHED', runtime, target, 'slot-overlaps-placed-block');
    advanceCursor(cursor, availableRouteSlots);
    return true;
  }
  if (block.assetIds && block.assetIds.length > 0) {
    plan.diagnostics.push(diagnostic('error', 'UNSUPPORTED_INLINE_ASSET', `Text planner cannot place inline asset(s) from '${block.id}' without an asset-to-slot mapping.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { assetIds: block.assetIds } }));
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    return true;
  }
  return placeStructuredBlock({
    pageState: currentPage,
    definition,
    block,
    flowId,
    routeIndex: selectedSlot.routeIndex,
    plan,
    cursor,
    blocksLength: context.blocks.length,
    availableRouteSlots,
    metrics,
    geometryTolerance,
    previousBlockInSlot: (slotId, blockId) => previousBlockInSlot(plan, slotId, blockId, document),
    contentStartBottom: (slot) => contentStartBottom(currentPage, plan, slot, document),
    advanceCursor,
    growSlot: (requiredBottom) => growSlot(currentPage, definition, requiredBottom, context, runtime, target),
  });
}

interface PreparedTextPlacement {
  leading: number;
  slot: CompositionSlot;
  initialBox: CompositionRect;
  insertionBoundary: number | undefined;
  startLineOffset: number;
  pageGraphics: CompositionPlan['graphicPlacements'];
  flowBarrierBoxCandidates: ReturnType<typeof flowBarrierBoxCandidatesForSlot>;
  blockGap: number;
  isHeadingBlock: boolean;
  wrapped: ReturnType<typeof wrapBlock>;
  completeWrapped: ReturnType<typeof wrapBlock>;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Build the read-only inputs for one text-placement attempt.
 */
function prepareTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): PreparedTextPlacement {
  const { currentPage, block, definition } = target;
  const { cursor } = runtime;
  const { authoredBlocks, authoredIndexOf, document, flowId, geometryTolerance, insertionProposals, metrics, plan, policy, route } = context;
  const leading = lineHeight(metrics, block);
  const slot = currentPage.slots.get(definition.id)!;
  const initialBox = slotBox(currentPage, definition);
  const growthBottom = definition.grow?.axis === 'y'
    ? definition.box.y + definition.grow.maxHeight
    : rectBottom(initialBox);
  const insertionBoundary = block.role === 'quote'
    ? undefined
    : nextInsertionBoundary(route, authoredBlocks, authoredIndexOf(block.id), currentPage.page, insertionProposals, flowId, cursor.resumeY);
  const textBottom = insertionBoundary === undefined
    ? growthBottom
    : Math.min(growthBottom, insertionBoundary);
  const localBottom = flowingTextBottom(plan, slot.id, initialBox.y, document);
  const crossSlotBottom = occupiedBottomInOverlappingSlots(currentPage, plan, slot, localBottom);
  const crossSlotGap = 0;
  const previousInsertion = authoredBlocks
    .slice(0, authoredIndexOf(block.id))
    .filter((candidate) => candidate.role === 'quote')
    .map((candidate) => insertionProposals.get(insertionKey(flowId, candidate.id)))
    .filter((proposal): proposal is PlannedInsertion => proposal !== undefined && proposal.page === currentPage.page)
    .sort((left, right) => right.box.y - left.box.y)[0];
  const previousInsertionBottom = previousInsertion ? previousInsertion.box.y + previousInsertion.box.height : undefined;
  const insertionIsBeforeCurrentColumn = previousInsertion !== undefined
    && initialBox.x + initialBox.width / 2 <= previousInsertion.box.x + previousInsertion.box.width / 2;
  const usedBottom = Math.max(
    localBottom,
    crossSlotBottom,
    ...(insertionIsBeforeCurrentColumn && previousInsertionBottom !== undefined ? [previousInsertionBottom] : []),
    cursor.resumeSlotId === slot.id ? cursor.resumeY ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY,
  ) + crossSlotGap;
  const startLineOffset = Math.max(0, (usedBottom - initialBox.y) / leading);
  const pageGraphics = plan.graphicPlacements.filter((graphic) => graphic.page === currentPage.page && graphic.graphicId !== `insertion:${block.id}`);
  const flowBarrierBoxCandidates = block.role === 'quote'
    ? []
    : flowBarrierBoxCandidatesForSlot(currentPage.page, slot, flowId, plan.graphicPlacements);
  if (flowBarrierBoxCandidates.length > 0) {
    recordFlowDecision(context, 'FLOW_BARRIER_BOXES_CONSUMED', runtime, target);
  }
  const previous = cursor.startWord === 0 ? previousBlockInSlot(plan, slot.id, block.id, document) : undefined;
  // A resume boundary created by an obstacle is already the start of a new
  // legal content segment. The previous authored block is separated from
  // this heading by that barrier, so its margin-before must not be added a
  // second time after resumeY.
  const resumedAfterFlowBarrier = cursor.resumeSlotId === slot.id
    && cursor.resumeY !== undefined
    && cursor.resumeY > localBottom + geometryTolerance;
  let blockGap = resumedAfterFlowBarrier
    ? 0
    : previous ? metrics.blockGap?.(styleFor(previous), styleFor(block)) ?? 0 : 0;
  const isHeadingBlock = block.kind === 'heading' || block.role === 'heading' || block.role === 'title';
  let wrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset + blockGap / leading, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  let completeWrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset + blockGap / leading, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  // If only the inter-block gap prevents a whole heading from fitting in
  // the remaining physical lines, use the configured gap as a soft value
  // and compress it to zero for this boundary. Keeping a heading whole is
  // more important than creating a four-line hole at the end of a column;
  // ordinary body-to-body spacing remains unchanged.
  const availableWithoutGap = availableLineCount(rectBottom(initialBox) - (initialBox.y + startLineOffset * leading), leading);
  if (isHeadingBlock && blockGap > 0 && wrapped.length < completeWrapped.length) {
    const noGapWrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
    const noGapComplete = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
    if (noGapComplete.length <= availableWithoutGap && noGapWrapped.length === noGapComplete.length) {
      recordFlowDecision(context, 'BLOCK_GAP_COMPRESSED', runtime, target, 'keep-heading-whole-without-empty-column');
      blockGap = 0;
      wrapped = noGapWrapped;
      completeWrapped = noGapComplete;
    }
  }
  return { leading, slot, initialBox, insertionBoundary, startLineOffset, pageGraphics, flowBarrierBoxCandidates, blockGap, isHeadingBlock, wrapped, completeWrapped };
}

type ListItemKeepDecision =
  | { kind: 'push'; minimumFragmentLines: number; completeLines: number; availableLines: number }
  | { kind: 'split'; minimumFragmentLines: number; completeLines: number; availableLines: number };

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current headingExceedsAvailableLines implementation intact until its target seam is extracted.
 */
function headingExceedsAvailableLines(
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): boolean {
  return prepared.isHeadingBlock && prepared.completeWrapped.length > currentAvailableLines;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current evaluateListItemKeepTogether implementation intact until its target seam is extracted.
 */
function evaluateListItemKeepTogether(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
  usedLines: number,
): ListItemKeepDecision | undefined {
  const { block } = target;
  const { cursor } = runtime;
  const { geometryTolerance, metrics, policy } = context;
  const { leading, initialBox, pageGraphics, flowBarrierBoxCandidates } = prepared;
  if (block.kind !== 'list-item' || !policy.keepListItemsTogether || cursor.startWord !== 0) return undefined;
  const complete = wrapBlock(metrics, block, 0, initialBox, 0, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  const slotCapacity = availableLineCount(rectBottom(initialBox) - initialBox.y, leading);
  if (complete.length <= currentAvailableLines || complete.length > slotCapacity || usedLines <= 0) return undefined;
  const minimumFragmentLines = policy.minimumFragmentLines ?? 1;
  return currentAvailableLines < minimumFragmentLines
    ? { kind: 'push', minimumFragmentLines, completeLines: complete.length, availableLines: currentAvailableLines }
    : { kind: 'split', minimumFragmentLines, completeLines: complete.length, availableLines: currentAvailableLines };
}

type HeadingClusterObstacleDecision =
  | { kind: 'resume-below-obstacle'; obstacleId: string; resumeY: number; requiredClusterLines: number; availableAfterObstacle: number }
  | { kind: 'push-to-next-slot'; obstacleId: string; requiredClusterLines: number; availableAfterObstacle: number };

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current evaluateHeadingClusterObstacle implementation intact until its target seam is extracted.
 */
function evaluateHeadingClusterObstacle(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentBox: CompositionRect,
): HeadingClusterObstacleDecision | undefined {
  const { cursor } = runtime;
  const { block } = target;
  const { blocks, geometryTolerance, metrics, policy } = context;
  const { leading, initialBox, pageGraphics, blockGap, startLineOffset } = prepared;
  const next = blocks[cursor.blockIndex + 1];
  const keepLines = block.keepWithNextLines
    ?? (block.kind === 'heading' ? policy.headingKeepWithNextLines ?? 0 : 0);
  if (!prepared.isHeadingBlock || keepLines <= 0 || !next) return undefined;
  const nextLeading = lineHeight(metrics, next);
  const headingStartOffset = startLineOffset + blockGap / leading;
  // Probe the cluster without obstacles first. Using the wrapped result
  // from the real page here is insufficient: wrapBlock can skip lines
  // under an obstacle, making a quote that cuts through the lead look
  // like a normal gap instead of a violation of the keep rule.
  const headingProbe = wrapBlock(metrics, block, cursor.startWord, initialBox, headingStartOffset, Number.POSITIVE_INFINITY, [], leading, policy.minimumWrapWidth);
  const headingBottom = headingProbe.length > 0
    ? initialBox.y + (headingProbe.at(-1)!.lineOffset + 1) * leading
    : initialBox.y + headingStartOffset * leading;
  const nextProbeStart = (headingBottom + blockGap - currentBox.y) / nextLeading;
  const leadProbe = wrapBlock(metrics, next, 0, currentBox, nextProbeStart, Number.POSITIVE_INFINITY, [], nextLeading, policy.minimumWrapWidth);
  if (leadProbe.length < keepLines) return undefined;
  const clusterObstacle = obstructionAcrossLineBands(
    [{ lines: headingProbe, lineHeight: leading }, { lines: leadProbe.slice(0, keepLines), lineHeight: nextLeading }],
    initialBox,
    initialBox.y,
    pageGraphics,
    geometryTolerance,
  );
  if (!clusterObstacle) return undefined;
  const requiredClusterLines = headingProbe.length + keepLines;
  const resumeY = Math.max(cursor.resumeY ?? initialBox.y, rectBottom(clusterObstacle.box));
  const availableAfterObstacle = availableLineCount(rectBottom(currentBox) - resumeY, leading);
  if (availableAfterObstacle >= requiredClusterLines) {
    return { kind: 'resume-below-obstacle', obstacleId: clusterObstacle.graphicId, resumeY, requiredClusterLines, availableAfterObstacle };
  }
  return { kind: 'push-to-next-slot', obstacleId: clusterObstacle.graphicId, requiredClusterLines, availableAfterObstacle };
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current keepClusterExceedsAvailableLines implementation intact until its target seam is extracted.
 */
function keepClusterExceedsAvailableLines(
  prepared: PreparedTextPlacement,
  keepRequired: number,
  currentAvailableLines: number,
  usedLines: number,
): boolean {
  return prepared.isHeadingBlock && keepRequired > currentAvailableLines && usedLines > 0;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current keepClusterCanBeRelaxed implementation intact until its target seam is extracted.
 */
function keepClusterCanBeRelaxed(
  prepared: PreparedTextPlacement,
  block: CompositionBlock,
  keepRequired: number,
  currentAvailableLines: number,
): boolean {
  return !prepared.isHeadingBlock
    && keepRequired > currentAvailableLines
    && block.keepWithNextLines !== undefined
    && prepared.wrapped.length <= currentAvailableLines;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Choose the lines that fit the current slot and keep rules.
 */
function selectTextLinesForPlacement(
  context: FlowPlanningContext,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): ReturnType<typeof wrapBlock> {
  const { policy } = context;
  const { wrapped, completeWrapped } = prepared;
  let take = Math.min(currentAvailableLines, wrapped.length);
  let remainder = completeWrapped.length - take;
  if (remainder > 0 && policy.minimumLinesAtEnd !== undefined && remainder < policy.minimumLinesAtEnd) {
    take -= policy.minimumLinesAtEnd - remainder;
    remainder = completeWrapped.length - take;
  }
  return wrapped.slice(0, take);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current placeInsertionObstacleAfterQuote implementation intact until its target seam is extracted.
 */
function placeInsertionObstacleAfterQuote(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
): void {
  if (!target.continuousInsertion) return;
  const { currentPage, block } = target;
  const { cursor } = runtime;
  const { plan } = context;
  const { slot } = prepared;
  if (plan.graphicPlacements.some((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === currentPage.page)) return;
  plan.graphicPlacements.push({
    id: `graphic:insertion:${block.id}`,
    graphicId: `insertion:${block.id}`,
    slotId: slot.id,
    page: currentPage.page,
    shape: 'rectangle',
    wrap: 'around',
    paint: false,
    box: { ...slot.box },
  });
  recordFlowDecision(context, 'FLOW_INSERTION_OBSTACLE_PLACED', runtime, target);
  cursor.resumeY = Math.max(cursor.resumeY ?? Number.NEGATIVE_INFINITY, rectBottom(slot.box));
  cursor.resumeSlotId = slot.id;
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current resumeDeferredQuoteAfterPlacement implementation intact until its target seam is extracted.
 */
function resumeDeferredQuoteAfterPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): void {
  const { block } = target;
  const deferred = runtime.activeDeferredQuote;
  if (deferred?.blockId !== block.id) return;
  const { cursor } = runtime;
  runtime.activeDeferredQuote = undefined;
  runtime.deferredQuote = undefined;
  cursor.blockIndex = deferred.resume.blockIndex;
  cursor.startWord = deferred.resume.startWord;
  cursor.startRow = deferred.resume.startRow;
  cursor.routeIndex = target.selectedSlot.routeIndex + 1;
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Materialize selected lines and update the flow cursor.
 */
function commitSelectedTextLines(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  selected: ReturnType<typeof wrapBlock>,
): { consumedEnd: number; completed: boolean } {
  const { currentPage, block, selectedSlot, definition } = target;
  const { cursor } = runtime;
  const { flowId, metrics, plan } = context;
  const { leading, slot } = prepared;
  placeLines(currentPage, definition, block, metrics, flowId, target.continuousInsertion ? undefined : selectedSlot.routeIndex, selected, leading, plan.placements, plan.lines);
  runtime.lastLegalSlotId = slot.id;
  const consumedEnd = selected.at(-1)!.endWord;
  const completed = consumedEnd >= wordsForBlock(block).length;
  if (completed) {
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    if (block.role === 'quote') {
      slot.state = 'exhausted';
      placeInsertionObstacleAfterQuote(context, runtime, target, prepared);
      resumeDeferredQuoteAfterPlacement(context, runtime, target);
    }
    recordFlowDecision(context, 'BLOCK_PLACED', runtime, target);
  } else {
    cursor.startWord = consumedEnd;
    recordFlowDecision(context, 'BLOCK_CONTINUED', runtime, target);
  }
  return { consumedEnd, completed };
}

type InsertionBoundaryResolution =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'ready' };

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current resolveInsertionBoundaryAfterText implementation intact until its target seam is extracted.
 */
function resolveInsertionBoundaryAfterText(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  consumedEnd: number,
): InsertionBoundaryResolution {
  if (prepared.insertionBoundary === undefined || consumedEnd >= wordsForBlock(target.block).length) return { kind: 'ready' };
  const { currentPage, block } = target;
  const { cursor } = runtime;
  const { authoredBlocks, authoredIndexOf, flowId, insertionProposals, plan, route } = context;
  const boundary = nextInsertionProposal(route, authoredBlocks, authoredIndexOf(block.id), currentPage.page, insertionProposals, flowId, cursor.resumeY);
  if (!boundary) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_PRECEDENCE_CONFLICT', `Insertion boundary for the next quote leaves authored block '${block.id}' unfinished above it.`, { flowId, blockId: block.id, page: currentPage.page, slotId: target.definition.id, details: { insertionBoundary: prepared.insertionBoundary, consumedEnd, totalWords: wordsForBlock(block).length } }));
    addResidual(plan.residualContent, flowId, block, consumedEnd, target.definition.id, 'insertion-precedence-conflict');
    return { kind: 'stop' };
  }
  cursor.startWord = consumedEnd;
  cursor.resumeY = boundary.box.y + boundary.box.height;
  cursor.resumeSlotId = target.definition.id;
  recordFlowDecision(context, 'FLOW_RESUMED_BELOW_INSERTION', runtime, target);
  return { kind: 'continue' };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Decide whether the flow continues on this page or moves forward.
 */
function advanceFlowAfterTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  consumedEnd: number,
): void {
  const { cursor } = runtime;
  const { availableRouteSlots, block, continuousInsertion } = target;
  const { blocks } = context;
  if (consumedEnd >= wordsForBlock(block).length && cursor.blockIndex >= blocks.length) return;
  if (!continuousInsertion && consumedEnd < wordsForBlock(block).length) {
    recordFlowDecision(context, 'FLOW_SEGMENT_ADVANCED', runtime, target);
    const pageBeforeAdvance = cursor.page;
    advanceCursor(cursor, availableRouteSlots);
    if (cursor.page > pageBeforeAdvance && cursor.blockIndex < blocks.length) {
      recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_PAGE', runtime, undefined, 'previous-slot-exhausted');
    }
  }
}

type TextBlockAttemptResult =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'done' };

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current advanceTextBlockWhenNoLinesFit implementation intact until its target seam is extracted.
 */
function advanceTextBlockWhenNoLinesFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): void {
  const { cursor } = runtime;
  recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_SLOT', runtime, target, 'no-available-text-band');
  const { availableRouteSlots } = target;
  advanceCursor(cursor, availableRouteSlots);
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current growTextSlotForInitialPlacement implementation intact until its target seam is extracted.
 */
function growTextSlotForInitialPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
): void {
  const { cursor } = runtime;
  const { currentPage, block, definition } = target;
  if (definition.grow?.axis !== 'y' || cursor.startWord !== 0) return;
  const requiredBottom = prepared.initialBox.y + (prepared.wrapped.at(-1)!.lineOffset + 1) * prepared.leading;
  growSlot(currentPage, definition, requiredBottom, context, runtime, target);
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current pushHeadingWhenWholeHeadingDoesNotFit implementation intact until its target seam is extracted.
 */
function pushHeadingWhenWholeHeadingDoesNotFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): boolean {
  if (!headingExceedsAvailableLines(prepared, currentAvailableLines)) return false;
  const { cursor } = runtime;
  const { availableRouteSlots } = target;
  recordFlowDecision(context, 'HEADING_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-heading-together');
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current recordListItemSplitDecision implementation intact until its target seam is extracted.
 */
function recordListItemSplitDecision(
  context: FlowPlanningContext,
  target: FlowTarget,
  decision: ListItemKeepDecision | undefined,
): void {
  if (decision?.kind !== 'split') return;
  recordFlowDecision(context, 'LIST_ITEM_SPLIT_TO_AVOID_HOLE', undefined, target, 'available-fragment-meets-minimum-and-whole-item-would-leave-hole');
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current pushListItemWhenMinimumFragmentWouldBeBroken implementation intact until its target seam is extracted.
 */
function pushListItemWhenMinimumFragmentWouldBeBroken(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  decision: ListItemKeepDecision | undefined,
): boolean {
  if (decision?.kind !== 'push') return false;
  const { cursor } = runtime;
  const { availableRouteSlots } = target;
  recordFlowDecision(context, 'LIST_ITEM_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-list-item-together-below-minimum-fragment');
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current handleHeadingClusterObstacleBeforeTextPlacement implementation intact until its target seam is extracted.
 */
function handleHeadingClusterObstacleBeforeTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentBox: CompositionRect,
): TextBlockAttemptResult | undefined {
  const decision = evaluateHeadingClusterObstacle(context, runtime, target, prepared, currentBox);
  if (!decision) return undefined;
  const { cursor } = runtime;
  const { availableRouteSlots } = target;
  if (decision.kind === 'resume-below-obstacle') {
    cursor.resumeY = decision.resumeY;
    cursor.resumeSlotId = prepared.slot.id;
    recordFlowDecision(context, 'HEADING_CLUSTER_PUSHED_BELOW_OBSTACLE', runtime, target, 'keep-heading-and-lead-together');
    return { kind: 'continue' };
  }
  recordFlowDecision(context, 'HEADING_CLUSTER_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-heading-and-lead-together');
  advanceCursor(cursor, availableRouteSlots);
  return { kind: 'continue' };
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current pushKeepClusterWhenItCannotFit implementation intact until its target seam is extracted.
 */
function pushKeepClusterWhenItCannotFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  keepRequired: number,
  currentAvailableLines: number,
  usedLines: number,
): boolean {
  if (!keepClusterExceedsAvailableLines(prepared, keepRequired, currentAvailableLines, usedLines)) return false;
  const { cursor } = runtime;
  const { availableRouteSlots } = target;
  recordFlowDecision(context, 'KEEP_CLUSTER_PUSHED', runtime, target, 'insufficient-local-capacity');
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current recordRelaxedKeepCluster implementation intact until its target seam is extracted.
 */
function recordRelaxedKeepCluster(
  context: FlowPlanningContext,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  keepRequired: number,
  currentAvailableLines: number,
): void {
  if (!keepClusterCanBeRelaxed(prepared, target.block, keepRequired, currentAvailableLines)) return;
  recordFlowDecision(context, 'KEEP_CLUSTER_RELAXED', undefined, target, 'whole-block-fits-but-following-block-does-not');
}

/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current advanceTextBlockWhenNoCapacity implementation intact until its target seam is extracted.
 */
function advanceTextBlockWhenNoCapacity(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): TextBlockAttemptResult | undefined {
  if (currentAvailableLines > 0) return undefined;
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan, route } = context;
  runtime.lastLegalSlotId = prepared.slot.id;
  recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_SLOT', runtime, target, 'next-block-spacing-or-line-height-does-not-fit');
  if (route.continuation === 'forbidden' && cursor.routeIndex >= availableRouteSlots.length - 1) {
    plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${flowId}' cannot continue beyond its available slots on page ${currentPage.page}.`, { flowId, blockId: block.id, page: currentPage.page, slotId: prepared.slot.id }));
    addResidual(plan.residualContent, flowId, block, cursor.startWord, runtime.lastLegalSlotId, 'flow-continuation-forbidden');
    return { kind: 'stop' };
  }
  advanceCursor(cursor, availableRouteSlots);
  return { kind: 'continue' };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current planTextBlockAttempt implementation intact until its target seam is extracted.
 */
function planTextBlockAttempt(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): TextBlockAttemptResult {
  const { cursor } = runtime;
  const { currentPage, block, definition } = target;
  const { blocks, geometryTolerance, metrics, policy } = context;
  const prepared = prepareTextPlacement(context, runtime, target);
  if (prepared.wrapped.length === 0) {
    advanceTextBlockWhenNoLinesFit(context, runtime, target);
    return { kind: 'continue' };
  }
  growTextSlotForInitialPlacement(context, runtime, target, prepared);
  const currentBox = slotBox(currentPage, definition);
  // The inter-block gap is part of the next block's occupied band. Omitting
  // it here made the planner claim that a third line was available while the
  // wrapped block (which starts after that gap) could only place two.
  const blockStartOffset = prepared.startLineOffset + prepared.blockGap / prepared.leading;
  const currentAvailableLines = availableLineCount(rectBottom(currentBox) - (currentBox.y + blockStartOffset * prepared.leading), prepared.leading);
  const usedLines = prepared.startLineOffset;
  if (pushHeadingWhenWholeHeadingDoesNotFit(context, runtime, target, prepared, currentAvailableLines)) {
    return { kind: 'continue' };
  }
  const listKeepDecision = evaluateListItemKeepTogether(context, runtime, target, prepared, currentAvailableLines, usedLines);
  if (pushListItemWhenMinimumFragmentWouldBeBroken(context, runtime, target, listKeepDecision)) {
    return { kind: 'continue' };
  }
  recordListItemSplitDecision(context, target, listKeepDecision);
  const next = blocks[cursor.blockIndex + 1];
  const keepLines = block.keepWithNextLines
    ?? (block.kind === 'heading' ? policy.headingKeepWithNextLines ?? 0 : 0);
  const nextLeading = next ? lineHeight(metrics, next) : prepared.leading;
  const nextWrapped = next ? wrapBlock(
    metrics,
    next,
    0,
    currentBox,
    0,
    rectBottom(currentBox),
    prepared.pageGraphics,
    nextLeading,
    policy.minimumWrapWidth,
    next.role === 'quote' ? [] : prepared.flowBarrierBoxCandidates,
    geometryTolerance,
  ) : [];
  const headingClusterResult = handleHeadingClusterObstacleBeforeTextPlacement(context, runtime, target, prepared, currentBox);
  if (headingClusterResult) return headingClusterResult;
  const keepRequired = keepLines > 0 && cursor.startWord === 0
    ? prepared.completeWrapped.length + Math.min(keepLines, nextWrapped.length)
    : 0;
  if (pushKeepClusterWhenItCannotFit(context, runtime, target, prepared, keepRequired, currentAvailableLines, usedLines)) {
    return { kind: 'continue' };
  }
  recordRelaxedKeepCluster(context, target, prepared, keepRequired, currentAvailableLines);
  const noCapacityResult = advanceTextBlockWhenNoCapacity(context, runtime, target, prepared, currentAvailableLines);
  if (noCapacityResult) return noCapacityResult;
  const selected = selectTextLinesForPlacement(context, prepared, currentAvailableLines);
  const { consumedEnd } = commitSelectedTextLines(context, runtime, target, prepared, selected);
  const insertionBoundaryResolution = resolveInsertionBoundaryAfterText(context, runtime, target, prepared, consumedEnd);
  if (insertionBoundaryResolution.kind === 'stop') return { kind: 'stop' };
  if (insertionBoundaryResolution.kind === 'continue') return { kind: 'continue' };
  advanceFlowAfterTextPlacement(context, runtime, target, consumedEnd);
  return { kind: 'done' };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Keep the current planFlow implementation intact until its target seam is extracted.
 */
export function planFlow(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  flowId: string,
  route: CompositionFlowRoute,
  pages: PageState[],
  plan: CompositionPlan,
  startPage = 1,
  insertionProposals: Map<string, PlannedInsertion> = new Map(),
  skipPreplannedInsertions = false,
): void {
  const context = createFlowPlanningContext(document, metrics, template, policy, flowId, route, pages, plan, startPage, insertionProposals, skipPreplannedInsertions);
  if (!context) return;
  const runtime = createFlowRuntime(context);
  const { cursor } = runtime;
  const { blocks } = context;
  while (cursor.blockIndex < blocks.length) {
    if (flowReachedTerminalPage(context, runtime)) return;
    const currentPage = ensureCurrentFlowPage(context, runtime);
    if (!currentPage) return;
    if (holdFlowForPreplannedInsertion(context, runtime)) continue;
    restoreDeferredQuoteOnCurrentPage(context, runtime);
    restoreDeferredQuoteOnNextPage(context, runtime);
    const resolution = resolveFlowTarget(context, runtime, currentPage);
    if (resolution.kind === 'stop') return;
    if (resolution.kind === 'continue') continue;
    if (handleNonTextFlowPlacement(context, runtime, resolution.target)) continue;
    const textAttempt = planTextBlockAttempt(context, runtime, resolution.target);
    if (textAttempt.kind === 'stop') return;
    continue;
  }
}
