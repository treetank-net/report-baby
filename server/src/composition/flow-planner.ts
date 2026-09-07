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

/**
 * Flow-level planning owns authored block order, route progression, and the
 * cursor that walks a flow through already-created document pages. Page
 * creation remains a document-level operation (`ensurePage`) until the
 * document orchestration is extracted in a later step.
 */
interface FlowCursor {
  blockIndex: number;
  startWord: number;
  startRow: number;
  page: number;
  routeIndex: number;
  resumeY?: number;
  resumeSlotId?: string;
}

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

function reservedSlotCollidesWithSlot(
  pageState: PageState,
  slot: CompositionSlot,
  box: CompositionRect,
): boolean {
  return pageState.layout.slots.some((candidate) => candidate.reserved === true
    && candidate.id !== slot.id
    && rectsOverlap(box, candidate.box));
}

function slotCollidesWithPlacedBlock(pageState: PageState, slotId: string, plan: CompositionPlan, flowId?: string): boolean {
  const slot = pageState.slots.get(slotId);
  const box = slot?.box;
  if (!slot || !box) return false;
  return flowLineCollidesWithSlot(pageState, slot, box, plan, flowId)
    || blockPlacementCollidesWithSlot(pageState, slot, box, plan)
    || tablePlacementCollidesWithSlot(pageState, slot, box, plan)
    || reservedSlotCollidesWithSlot(pageState, slot, box);
}

function slotBox(pageState: PageState, definition: CompositionSlotTemplate): CompositionRect {
  return pageState.slots.get(definition.id)?.box ?? definition.box;
}

function insertionCurrentBottom(
  layout: CompositionLayoutTemplate,
  pageState: PageState,
  plan: CompositionPlan,
  routeSlotIds: string[],
  routeIndex: number,
  document: CompositionDocument,
): number {
  const currentDefinition = layout.slots.find((slot) => slot.id === routeSlotIds[routeIndex]);
  const currentSlot = currentDefinition ? pageState.slots.get(currentDefinition.id) : undefined;
  return currentSlot
    ? contentStartBottom(pageState, plan, currentSlot, document)
    : Number.NEGATIVE_INFINITY;
}

function insertionCandidates(
  layout: CompositionLayoutTemplate,
  pageState: PageState,
  plan: CompositionPlan,
  insertionIds: string[],
): CompositionSlotTemplate[] {
  const occupied = [
    ...plan.lines,
    ...plan.blockPlacements,
    ...plan.tablePlacements,
  ].filter((item) => item.page === pageState.page);
  return insertionIds
    .map((id) => layout.slots.find((slot) => slot.id === id))
    .filter((slot): slot is CompositionSlotTemplate => slot !== undefined)
    .filter((slot) => slot.allowedRoles?.includes('quote') && pageState.slots.get(slot.id)?.state === 'open')
    .filter((slot) => !insertionOverlapsOccupiedSlot(slot, occupied))
    .sort((left, right) => left.box.y - right.box.y);
}

function insertionOverlapsOccupiedSlot(
  slot: CompositionSlotTemplate,
  occupied: Array<{ box: CompositionRect }>,
): boolean {
  return occupied.some((item) => rectsOverlap(item.box, slot.box));
}

function insertionSlotFor(
  route: CompositionFlowRoute,
  layout: CompositionLayoutTemplate,
  pageState: PageState,
  plan: CompositionPlan,
  routeSlotIds: string[],
  routeIndex: number,
  document: CompositionDocument,
): CompositionSlotTemplate | undefined {
  const insertionIds = route.insertionSlots ?? [];
  if (insertionIds.length === 0) return undefined;
  const currentBottom = insertionCurrentBottom(layout, pageState, plan, routeSlotIds, routeIndex, document);
  const candidates = insertionCandidates(layout, pageState, plan, insertionIds);
  return candidates.find((slot) => slot.box.y + 0.001 >= currentBottom);
}

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

function resizeGrownSlot(slot: CompositionSlot, delta: number): void {
  slot.box.height += delta;
}

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

function movePushedSlots(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  delta: number,
): void {
  for (const pushedId of definition.grow?.pushes ?? []) {
    resizePushedTextSlot(pageState, pushedId, delta);
  }
}

function recordSlotGrowth(
  plan: CompositionPlan,
  slot: CompositionSlot,
  delta: number,
  flowId: string,
  blockId: string,
  pushedSlots: string[],
): void {
  plan.decisions.push({
    code: 'SLOT_GROWN',
    flowId,
    blockId,
    slotId: slot.id,
    delta,
    pushedSlots,
  });
}

function growSlot(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  requiredBottom: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  const delta = growthDelta(slot, definition, requiredBottom);
  if (delta <= 0) return;
  resizeGrownSlot(slot, delta);
  movePushedSlots(pageState, definition, delta);
  recordSlotGrowth(plan, slot, delta, flowId, blockId, definition.grow?.pushes ?? []);
}

export function flowingTextBottom(plan: CompositionPlan, slotId: string, fallback: number, document: CompositionDocument): number {
  const wrappedImages = wrappedImageIds(document);
  const lineBottom = flowingLineBottom(plan, slotId, fallback);
  const blockBottom = flowingBlockBottom(plan, slotId, lineBottom, wrappedImages);
  return flowingTableBottom(plan, slotId, blockBottom);
}

function wrappedImageIds(document: CompositionDocument): Set<string> {
  return new Set(Object.values(document.flows).flatMap((flow) => flow.blocks)
    .filter((block) => block.kind === 'image' && (block.image?.wrap === 'left' || block.image?.wrap === 'right'))
    .map((block) => block.id));
}

function flowingLineBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.lines
    .filter((line) => line.slotId === slotId && line.layer !== 'insertion')
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
}

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

function flowingTableBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), fallback);
}

function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

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

function occupiedSlotMap(pageState: PageState): Map<string, CompositionSlot> {
  return new Map<string, CompositionSlot>(
    [...pageState.slots.values()].map((slot) => [slot.id, slot]),
  );
}

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

function previousBlockInOverlappingSlots(
  pageState: PageState,
  plan: CompositionPlan,
  targetSlot: CompositionSlot,
  document: CompositionDocument,
): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = overlappingPlacementCandidates(pageState, plan, targetSlot);
  return blockFromLastPlacement(candidates, blocks);
}

function previousBlockInSlot(plan: CompositionPlan, slotId: string, currentBlockId: string, document: CompositionDocument): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = [
    ...plan.placements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.blockPlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.tablePlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
  ].sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
  return candidates.at(-1) ? blocks.get(candidates.at(-1)!.blockId) : undefined;
}

function overlappingPlacementCandidates(
  pageState: PageState,
  plan: CompositionPlan,
  targetSlot: CompositionSlot,
): Array<{ blockId: string; box: CompositionRect }> {
  return [
    ...plan.lines,
    ...plan.blockPlacements,
    ...plan.tablePlacements,
  ].filter((item) => {
    if (item.page !== pageState.page || item.slotId === targetSlot.id) return false;
    if ('layer' in item && item.layer === 'insertion') return false;
    const source = pageState.slots.get(item.slotId);
    return source?.flowId === targetSlot.flowId
      && source !== undefined
      && source.box.y < rectBottom(targetSlot.box)
      && horizontalOverlap(source.box, targetSlot.box);
  }).sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
}

function blockFromLastPlacement(
  placements: Array<{ blockId: string }>,
  blocks: Map<string, CompositionBlock>,
): CompositionBlock | undefined {
  const last = placements.at(-1);
  return last ? blocks.get(last.blockId) : undefined;
}

function collapseUnusedInsertions(
  pageState: PageState,
  routeSlotIds: string[],
  fromRouteIndex: number,
  toRouteIndex: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  for (let index = fromRouteIndex; index < toRouteIndex; index += 1) {
    const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[index]);
    const insertion = definition ? pageState.slots.get(definition.id) : undefined;
    collapseInsertion(pageState, definition, insertion, index, plan, flowId, blockId, 'no-insertion-content-on-page');
  }
}

function collapseInsertionBeforeContinuation(
  pageState: PageState,
  routeSlotIds: string[],
  routeIndex: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[routeIndex]);
  const insertion = definition ? pageState.slots.get(definition.id) : undefined;
  collapseInsertion(pageState, definition, insertion, routeIndex, plan, flowId, blockId, 'continuation-needs-uninterrupted-column');
}

function collapseInsertion(
  pageState: PageState,
  definition: CompositionSlotTemplate | undefined,
  insertion: CompositionSlot | undefined,
  routeIndex: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
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
  plan.decisions.push({
    code: 'OPTIONAL_INSERTION_COLLAPSED',
    flowId,
    blockId,
    page: pageState.page,
    routeIndex,
    delta,
    reason,
  });
}

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

interface FlowPlanningContext {
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

interface FlowRuntime {
  cursor: FlowCursor;
  deferredQuote?: DeferredQuote;
  activeDeferredQuote?: ActiveDeferredQuote;
  lastLegalSlotId?: string;
}

interface SelectedFlowSlot {
  definition: CompositionSlotTemplate;
  routeIndex: number;
}

interface FlowTarget {
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

function currentFlowBlock(context: FlowPlanningContext, runtime: FlowRuntime): CompositionBlock {
  return context.blocks[runtime.cursor.blockIndex];
}

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

function rejectFlowForPageLimit(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const block = currentFlowBlock(context, runtime);
  context.plan.diagnostics.push(diagnostic('error', 'MAX_PAGES_EXCEEDED', `Flow '${context.flowId}' exceeded the template page limit.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
  recordFlowResidual(context, runtime, 'max-pages');
}

function rejectFlowContinuation(context: FlowPlanningContext, runtime: FlowRuntime): void {
  const block = currentFlowBlock(context, runtime);
  context.plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${context.flowId}' cannot continue beyond its first page.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
  recordFlowResidual(context, runtime, 'flow-continuation-forbidden');
}

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

function ensureCurrentFlowPage(context: FlowPlanningContext, runtime: FlowRuntime): PageState | undefined {
  return ensurePage(context.pages, context.template, context.route, runtime.cursor.page, context.plan.diagnostics, context.flowId);
}

function holdFlowForPreplannedInsertion(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
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
  runtime.cursor.page = precedingInsertionPage;
  runtime.cursor.routeIndex = 0;
  runtime.cursor.resumeY = undefined;
  context.plan.decisions.push({ code: 'FLOW_HELD_FOR_PREPLANNED_INSERTION', flowId: context.flowId, blockId: block.id, page: currentPage.page, reason: 'successor-must-not-pass-earlier-insertion', details: { insertionPage: precedingInsertionPage } });
  return true;
}

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
  context.plan.decisions.push({ code: 'INSERTION_REPOSITIONED_PLACED', flowId: context.flowId, blockId: context.blocks[runtime.cursor.blockIndex].id, page: runtime.cursor.page, routeIndex: runtime.cursor.routeIndex, reason: 'earlier-route-segment-was-empty' });
}

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
  context.plan.decisions.push({ code: 'DEFERRED_INSERTION_PLACED', flowId: context.flowId, blockId: context.blocks[runtime.cursor.blockIndex].id, page: runtime.cursor.page, reason: 'next-page-insertion-slot' });
}

function plannedInsertionForBlock(
  context: FlowPlanningContext,
  block: CompositionBlock,
): PlannedInsertion | undefined {
  return block.role === 'quote'
    ? context.insertionProposals.get(insertionKey(context.flowId, block.id))
    : undefined;
}

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

function insertionDefinitionForBlock(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  availableRouteSlots: string[],
  plannedInsertion: PlannedInsertion | undefined,
): CompositionSlotTemplate | undefined {
  const block = currentFlowBlock(context, runtime);
  if (block.role !== 'quote') return undefined;
  if (plannedInsertion && currentPage.page === plannedInsertion.page) {
    return currentPage.layout.slots.find((slot) => slot.id === plannedInsertion.slotId && slot.allowedRoles?.includes('quote'));
  }
  return insertionSlotFor(context.route, currentPage.layout, currentPage, context.plan, availableRouteSlots, runtime.cursor.routeIndex, context.document);
}

function advanceForMissingInsertion(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
): boolean {
  const block = currentFlowBlock(context, runtime);
  if (context.route.continuation !== 'allowed' || runtime.cursor.page >= context.template.maxPages) return false;
  runtime.cursor.page += 1;
  runtime.cursor.routeIndex = 0;
  context.plan.decisions.push({ code: 'INSERTION_PUSHED_TO_NEXT_PAGE', flowId: context.flowId, blockId: block.id, page: currentPage.page, reason: 'no-insertion-slot-after-current-flow-position' });
  return true;
}

function hasInsertionSlotOnNextPage(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  block: CompositionBlock,
): boolean {
  const nextLayout = routeLayout(context.route, context.template, runtime.cursor.page + 1);
  const nextSlotIds = nextLayout ? routeSlots(context.route, nextLayout) : [];
  return nextLayout !== undefined && hasRoleEligibleSlot(nextLayout, nextSlotIds, 0, context.flowId, block);
}

function deferInsertionToNextPage(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
): boolean {
  const block = currentFlowBlock(context, runtime);
  if (block.role !== 'quote' || context.route.continuation !== 'allowed' || runtime.cursor.page !== context.startPage || runtime.deferredQuote) return false;
  if (!hasInsertionSlotOnNextPage(context, runtime, block)) return false;
  runtime.deferredQuote = { blockIndex: runtime.cursor.blockIndex, deferredPage: runtime.cursor.page };
  runtime.cursor.blockIndex += 1;
  runtime.cursor.startWord = 0;
  runtime.cursor.startRow = 0;
  runtime.cursor.routeIndex = 0;
  context.plan.decisions.push({ code: 'INSERTION_DEFERRED', flowId: context.flowId, blockId: block.id, page: runtime.cursor.page, reason: 'insertion-slot-only-on-continuation' });
  return true;
}

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
      context.plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_PAGE', flowId: context.flowId, blockId: block.id, page: currentPage.page, reason: 'no-eligible-slot-on-page' });
      advanceCursor(runtime.cursor, availableRouteSlots);
      return { kind: 'continue' };
    }
  }
  context.plan.diagnostics.push(diagnostic('error', 'FLOW_SLOT_NOT_FOUND', `Flow '${context.flowId}' cannot use route slot '${availableRouteSlots[runtime.cursor.routeIndex] ?? ''}'.`, { flowId: context.flowId, page: currentPage.page }));
  recordFlowResidual(context, runtime, 'no-legal-slot');
  return { kind: 'stop' };
}

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
  collapseInsertionBeforeContinuation(currentPage, availableRouteSlots, insertionIndex, context.plan, context.flowId, block.id);
  return slotFor(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots);
}

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
  const insertionDefinition = insertionDefinitionForBlock(context, runtime, currentPage, availableRouteSlots, plannedInsertion);
  if (block.role === 'quote' && (context.route.insertionSlots?.length ?? 0) > 0 && !insertionDefinition) {
    if (advanceForMissingInsertion(context, runtime, currentPage)) return { kind: 'continue' };
    context.plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Flow '${context.flowId}' cannot place insertion '${block.id}' after the current flow position.`, { flowId: context.flowId, blockId: block.id, page: currentPage.page }));
    recordFlowResidual(context, runtime, 'insertion-slot-not-found');
    return { kind: 'stop' };
  }
  const selectedSlot = selectFlowSlot(context, runtime, currentPage, availableRouteSlots, block, insertionDefinition);
  if (!selectedSlot || (selectedSlot.definition.kind !== 'text' && selectedSlot.definition.kind !== 'block')) {
    return resolveUnavailableFlowSlot(context, runtime, currentPage, availableRouteSlots, selectedSlot);
  }
  const routeStartIndex = runtime.cursor.routeIndex;
  runtime.cursor.routeIndex = selectedSlot.routeIndex;
  const continuousInsertion = block.role === 'quote' && (context.route.insertionSlots?.includes(selectedSlot.definition.id) ?? false);
  if (block.role !== 'quote') {
    collapseUnusedInsertions(currentPage, availableRouteSlots, routeStartIndex, selectedSlot.routeIndex, context.plan, context.flowId, block.id);
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
    plan.decisions.push({ code: 'TEXT_SLOT_COLLISION_PUSHED', flowId, blockId: block.id, slotId: definition.id, page: currentPage.page, reason: 'slot-overlaps-placed-block' });
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
    growSlot: (requiredBottom) => growSlot(currentPage, definition, requiredBottom, plan, flowId, block.id),
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
  const crossSlotPrevious = crossSlotBottom > localBottom
    ? previousBlockInOverlappingSlots(currentPage, plan, slot, document)
    : undefined;
  const crossSlotGap = crossSlotPrevious ? metrics.blockGap?.(styleFor(crossSlotPrevious), styleFor(block)) ?? 0 : 0;
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
    plan.decisions.push({
      code: 'FLOW_BARRIER_BOXES_CONSUMED',
      flowId,
      blockId: block.id,
      slotId: slot.id,
      page: currentPage.page,
      details: { candidateIds: flowBarrierBoxCandidates.map((candidate) => candidate.id) },
    });
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
      plan.decisions.push({ code: 'BLOCK_GAP_COMPRESSED', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, from: blockGap, to: 0, reason: 'keep-heading-whole-without-empty-column' });
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

function headingExceedsAvailableLines(
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): boolean {
  return prepared.isHeadingBlock && prepared.completeWrapped.length > currentAvailableLines;
}

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

function keepClusterExceedsAvailableLines(
  prepared: PreparedTextPlacement,
  keepRequired: number,
  currentAvailableLines: number,
  usedLines: number,
): boolean {
  return prepared.isHeadingBlock && keepRequired > currentAvailableLines && usedLines > 0;
}

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

type TextLineSelection =
  | { kind: 'advance-for-minimum-start'; attemptedLines: number }
  | { kind: 'reject-minimum-fragment' }
  | { kind: 'advance-for-orphan-adjustment'; attemptedLines: number }
  | { kind: 'advance-for-heading-remainder' }
  | { kind: 'ready'; lines: ReturnType<typeof wrapBlock> };

function selectTextLinesForPlacement(
  context: FlowPlanningContext,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
  usedLines: number,
): TextLineSelection {
  const { policy } = context;
  const { isHeadingBlock, wrapped, completeWrapped } = prepared;
  let take = Math.min(currentAvailableLines, wrapped.length);
  let remainder = completeWrapped.length - take;
  if (remainder > 0 && policy.minimumLinesAtEnd !== undefined && remainder < policy.minimumLinesAtEnd) {
    take -= policy.minimumLinesAtEnd - remainder;
    remainder = completeWrapped.length - take;
  }
  if (remainder > 0 && !isHeadingBlock && policy.minimumLinesAtStart !== undefined && take < policy.minimumLinesAtStart) {
    if (usedLines > 0) return { kind: 'advance-for-minimum-start', attemptedLines: take };
    return { kind: 'reject-minimum-fragment' };
  }
  if (take <= 0) return { kind: 'advance-for-orphan-adjustment', attemptedLines: take };
  if (isHeadingBlock && remainder > 0) return { kind: 'advance-for-heading-remainder' };
  return { kind: 'ready', lines: wrapped.slice(0, take) };
}

function placeInsertionObstacleAfterQuote(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
): void {
  if (!target.continuousInsertion) return;
  const { currentPage, block } = target;
  const { cursor } = runtime;
  const { flowId, plan } = context;
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
  plan.decisions.push({ code: 'FLOW_INSERTION_OBSTACLE_PLACED', flowId, blockId: block.id, page: currentPage.page, slotId: slot.id, box: { ...slot.box } });
  cursor.resumeY = Math.max(cursor.resumeY ?? Number.NEGATIVE_INFINITY, rectBottom(slot.box));
  cursor.resumeSlotId = slot.id;
}

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
    plan.decisions.push({ code: 'BLOCK_PLACED', flowId, blockId: block.id, slotId: slot.id });
  } else {
    cursor.startWord = consumedEnd;
    plan.decisions.push({ code: 'BLOCK_CONTINUED', flowId, blockId: block.id, slotId: slot.id });
  }
  return { consumedEnd, completed };
}

type InsertionBoundaryResolution =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'ready' };

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
  plan.decisions.push({ code: 'FLOW_RESUMED_BELOW_INSERTION', flowId, blockId: block.id, page: currentPage.page, slotId: target.definition.id, consumedEnd, obstacleY: boundary.box.y, obstacleBottom: cursor.resumeY });
  return { kind: 'continue' };
}

function advanceFlowAfterTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  selected: ReturnType<typeof wrapBlock>,
  consumedEnd: number,
  currentBox: CompositionRect,
  currentAvailableLines: number,
): void {
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block, selectedSlot, continuousInsertion } = target;
  const { blocks, document, flowId, metrics, plan, route } = context;
  if (consumedEnd >= wordsForBlock(block).length && cursor.blockIndex >= blocks.length) return;
  const nextBlock = blocks[cursor.blockIndex];
  // Keep the current column alive for an authored insertion that follows
  // this block. An insertion is an obstacle in the same continuous route,
  // not a reason to finish the page before we have tried its next legal band.
  const nextInsertionFitsCurrentPage = nextBlock?.role === 'quote'
    && insertionSlotFor(route, currentPage.layout, currentPage, plan, availableRouteSlots, cursor.routeIndex, document) !== undefined;
  // A completed block does not end the continuous flow. Re-enter the
  // placement loop so the next authored block gets the remaining vertical
  // band in this same slot; only an unfinished block must advance now.
  // Treating `selected.length === currentAvailableLines` as a reason to
  // advance was the source of false holes: that count describes the
  // current block's starting capacity, not the remaining capacity after
  // its last line (and it ignores the next block's actual line-height and
  // gap).
  if (!continuousInsertion && !nextInsertionFitsCurrentPage && consumedEnd < wordsForBlock(block).length) {
    const nextLeading = nextBlock ? lineHeight(metrics, nextBlock) : undefined;
    const nextBlockGap = nextBlock ? metrics.blockGap?.(styleFor(block), styleFor(nextBlock)) ?? 0 : 0;
    const lastLineBottom = selected.at(-1)
      ? prepared.initialBox.y + (selected.at(-1)!.lineOffset + 1) * prepared.leading
      : prepared.initialBox.y;
    const nextBlockAvailableLines = nextLeading === undefined
      ? undefined
      : availableLineCount(rectBottom(currentBox) - lastLineBottom - nextBlockGap, nextLeading);
    plan.decisions.push({
      code: 'FLOW_SEGMENT_ADVANCED',
      flowId,
      blockId: block.id,
      page: currentPage.page,
      slotId: prepared.slot.id,
      routeIndex: selectedSlot.routeIndex,
      details: { selectedLines: selected.length, currentAvailableLines, consumedEnd, totalWords: wordsForBlock(block).length },
    });
    const transition = plan.decisions.at(-1)!;
    if (nextBlock && nextLeading !== undefined) {
      transition.details = {
        ...(transition.details as Record<string, unknown>),
        nextBlockId: nextBlock.id,
        nextBlockAvailableLines,
        nextBlockLineHeight: nextLeading,
        nextBlockGap,
      };
    }
    const pageBeforeAdvance = cursor.page;
    advanceCursor(cursor, availableRouteSlots);
    if (cursor.page > pageBeforeAdvance && cursor.blockIndex < blocks.length) {
      plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_PAGE', flowId, blockId: blocks[cursor.blockIndex].id, page: cursor.page, reason: 'previous-slot-exhausted' });
    }
  }
}

type TextBlockAttemptResult =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'done' };

function completeEmptyTextBlock(runtime: FlowRuntime): void {
  runtime.cursor.blockIndex += 1;
  runtime.cursor.startWord = 0;
}

function advanceTextBlockWhenNoLinesFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
): void {
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan } = context;
  const { leading, slot, initialBox, startLineOffset, blockGap } = prepared;
  plan.decisions.push({
    code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
    flowId,
    blockId: block.id,
    slotId: slot.id,
    page: currentPage.page,
    reason: 'no-available-text-band',
    details: {
      availableLines: availableLineCount(rectBottom(initialBox) - (initialBox.y + startLineOffset * leading), leading),
      lineHeight: leading,
      blockGap,
      startLineOffset,
    },
  });
  advanceCursor(cursor, availableRouteSlots);
}

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
  growSlot(currentPage, definition, requiredBottom, context.plan, context.flowId, block.id);
}

function pushHeadingWhenWholeHeadingDoesNotFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): boolean {
  if (!headingExceedsAvailableLines(prepared, currentAvailableLines)) return false;
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan } = context;
  plan.decisions.push({
    code: 'HEADING_PUSHED_TO_NEXT_SLOT',
    flowId,
    blockId: block.id,
    slotId: prepared.slot.id,
    reason: 'keep-heading-together',
    details: {
      requiredLines: prepared.completeWrapped.length,
      availableLines: currentAvailableLines,
      startLineOffset: prepared.startLineOffset,
      blockGap: prepared.blockGap,
    },
  });
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

function recordListItemSplitDecision(
  context: FlowPlanningContext,
  target: FlowTarget,
  decision: ListItemKeepDecision | undefined,
): void {
  if (decision?.kind !== 'split') return;
  const { block } = target;
  context.plan.decisions.push({
    code: 'LIST_ITEM_SPLIT_TO_AVOID_HOLE',
    flowId: context.flowId,
    blockId: block.id,
    slotId: target.selectedSlot.definition.id,
    page: target.currentPage.page,
    reason: 'available-fragment-meets-minimum-and-whole-item-would-leave-hole',
    details: {
      availableLines: decision.availableLines,
      minimumFragmentLines: decision.minimumFragmentLines,
      completeLines: decision.completeLines,
    },
  });
}

function pushListItemWhenMinimumFragmentWouldBeBroken(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  decision: ListItemKeepDecision | undefined,
): boolean {
  if (decision?.kind !== 'push') return false;
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block } = target;
  context.plan.decisions.push({
    code: 'LIST_ITEM_PUSHED_TO_NEXT_SLOT',
    flowId: context.flowId,
    blockId: block.id,
    slotId: target.selectedSlot.definition.id,
    page: currentPage.page,
    reason: 'keep-list-item-together-below-minimum-fragment',
  });
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

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
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan } = context;
  if (decision.kind === 'resume-below-obstacle') {
    cursor.resumeY = decision.resumeY;
    cursor.resumeSlotId = prepared.slot.id;
    plan.decisions.push({
      code: 'HEADING_CLUSTER_PUSHED_BELOW_OBSTACLE',
      flowId,
      blockId: block.id,
      slotId: prepared.slot.id,
      page: currentPage.page,
      reason: 'keep-heading-and-lead-together',
      details: {
        obstacleId: decision.obstacleId,
        resumeY: decision.resumeY,
        requiredClusterLines: decision.requiredClusterLines,
        availableAfterObstacle: decision.availableAfterObstacle,
      },
    });
    return { kind: 'continue' };
  }
  plan.decisions.push({
    code: 'HEADING_CLUSTER_PUSHED_TO_NEXT_SLOT',
    flowId,
    blockId: block.id,
    slotId: prepared.slot.id,
    page: currentPage.page,
    reason: 'keep-heading-and-lead-together',
    details: {
      obstacleId: decision.obstacleId,
      requiredClusterLines: decision.requiredClusterLines,
      availableAfterObstacle: decision.availableAfterObstacle,
    },
  });
  advanceCursor(cursor, availableRouteSlots);
  return { kind: 'continue' };
}

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
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan } = context;
  plan.decisions.push({
    code: 'KEEP_CLUSTER_PUSHED',
    flowId,
    blockId: block.id,
    from: prepared.slot.id,
    slotId: prepared.slot.id,
    page: currentPage.page,
    reason: 'insufficient-local-capacity',
    details: { requiredLines: keepRequired, availableLines: currentAvailableLines },
  });
  advanceCursor(cursor, availableRouteSlots);
  return true;
}

function recordRelaxedKeepCluster(
  context: FlowPlanningContext,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  keepRequired: number,
  currentAvailableLines: number,
): void {
  if (!keepClusterCanBeRelaxed(prepared, target.block, keepRequired, currentAvailableLines)) return;
  context.plan.decisions.push({
    code: 'KEEP_CLUSTER_RELAXED',
    flowId: context.flowId,
    blockId: target.block.id,
    from: prepared.slot.id,
    reason: 'whole-block-fits-but-following-block-does-not',
  });
}

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
  plan.decisions.push({
    code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
    flowId,
    blockId: block.id,
    slotId: prepared.slot.id,
    page: currentPage.page,
    reason: 'next-block-spacing-or-line-height-does-not-fit',
    details: {
      availableLines: currentAvailableLines,
      lineHeight: prepared.leading,
      blockGap: prepared.blockGap,
      startLineOffset: prepared.startLineOffset,
    },
  });
  if (route.continuation === 'forbidden' && cursor.routeIndex >= availableRouteSlots.length - 1) {
    plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${flowId}' cannot continue beyond its available slots on page ${currentPage.page}.`, { flowId, blockId: block.id, page: currentPage.page, slotId: prepared.slot.id }));
    addResidual(plan.residualContent, flowId, block, cursor.startWord, runtime.lastLegalSlotId, 'flow-continuation-forbidden');
    return { kind: 'stop' };
  }
  advanceCursor(cursor, availableRouteSlots);
  return { kind: 'continue' };
}

function resolveTextLineSelectionFailure(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
  lineSelection: TextLineSelection,
): TextBlockAttemptResult | undefined {
  if (lineSelection.kind === 'ready') return undefined;
  const { cursor } = runtime;
  const { currentPage, availableRouteSlots, block } = target;
  const { flowId, plan, policy } = context;
  if (lineSelection.kind === 'advance-for-minimum-start') {
    plan.decisions.push({
      code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
      flowId,
      blockId: block.id,
      slotId: prepared.slot.id,
      page: currentPage.page,
      reason: 'minimum-fragment-start-would-be-violated',
      details: {
        availableLines: currentAvailableLines,
        attemptedLines: lineSelection.attemptedLines,
        minimumFragmentLines: policy.minimumLinesAtStart,
        lineHeight: prepared.leading,
        blockGap: prepared.blockGap,
        startLineOffset: prepared.startLineOffset + prepared.blockGap / prepared.leading,
      },
    });
    advanceCursor(cursor, availableRouteSlots);
    return { kind: 'continue' };
  }
  if (lineSelection.kind === 'reject-minimum-fragment') {
    plan.diagnostics.push(diagnostic('error', 'MINIMUM_FRAGMENT_UNSATISFIED', `Flow '${flowId}' cannot satisfy the minimum fragment size for '${block.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: prepared.slot.id }));
    addResidual(plan.residualContent, flowId, block, cursor.startWord, runtime.lastLegalSlotId, 'minimum-fragment');
    return { kind: 'stop' };
  }
  if (lineSelection.kind === 'advance-for-orphan-adjustment') {
    plan.decisions.push({
      code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
      flowId,
      blockId: block.id,
      slotId: prepared.slot.id,
      page: currentPage.page,
      reason: 'minimum-fragment-orphan-adjustment-left-no-lines',
      details: {
        availableLines: currentAvailableLines,
        attemptedLines: lineSelection.attemptedLines,
        lineHeight: prepared.leading,
        blockGap: prepared.blockGap,
        startLineOffset: prepared.startLineOffset + prepared.blockGap / prepared.leading,
      },
    });
    advanceCursor(cursor, availableRouteSlots);
    return { kind: 'continue' };
  }
  plan.decisions.push({
    code: 'HEADING_PUSHED_TO_NEXT_SLOT',
    flowId,
    blockId: block.id,
    slotId: prepared.slot.id,
    reason: 'keep-heading-together',
    details: {
      requiredLines: prepared.completeWrapped.length,
      availableLines: currentAvailableLines,
      startLineOffset: prepared.startLineOffset,
      blockGap: prepared.blockGap,
    },
  });
  advanceCursor(cursor, availableRouteSlots);
  return { kind: 'continue' };
}

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
    if (wordsForBlock(block).length === 0) {
      completeEmptyTextBlock(runtime);
      return { kind: 'continue' };
    }
    advanceTextBlockWhenNoLinesFit(context, runtime, target, prepared);
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
  const lineSelection = selectTextLinesForPlacement(context, prepared, currentAvailableLines, usedLines);
  if (lineSelection.kind !== 'ready') {
    return resolveTextLineSelectionFailure(context, runtime, target, prepared, currentAvailableLines, lineSelection)
      ?? { kind: 'stop' };
  }
  const selected = lineSelection.lines;
  const { consumedEnd } = commitSelectedTextLines(context, runtime, target, prepared, selected);
  const insertionBoundaryResolution = resolveInsertionBoundaryAfterText(context, runtime, target, prepared, consumedEnd);
  if (insertionBoundaryResolution.kind === 'stop') return { kind: 'stop' };
  if (insertionBoundaryResolution.kind === 'continue') return { kind: 'continue' };
  advanceFlowAfterTextPlacement(context, runtime, target, prepared, selected, consumedEnd, currentBox, currentAvailableLines);
  return { kind: 'done' };
}

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
    if (holdFlowForPreplannedInsertion(context, runtime, currentPage)) continue;
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
