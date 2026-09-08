import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionPlan,
  CompositionTextMetrics,
} from './engine.js';
import { placeGraphicsForPage } from './graphic-planning.js';
import type { TextCompositionPlannerPolicy } from './planner-policy.js';
import type { PageState } from './contracts/layout-state.js';
import { advanceCursor } from './layout/page-state.js';
import type {
  FlowPlanningContext,
  FlowRuntime,
  FlowTarget,
  PreparedTextPlacement,
  SelectedFlowSlot,
} from './contracts/flow-planning.js';
import {
  advanceTextBlockWhenNoLinesFit,
  applyTextPlacementDecisionRules,
  growTextSlotForInitialPlacement,
  prepareTextPlacement,
  selectTextLinesForPlacement,
  textPlacementCapacity,
} from './flow-text-decision.js';
import { hasRoleEligibleSlot, slotFor } from './layout/page-state.js';
import { wordsForBlock } from './text/text-measurement.js';
import type { wrapBlock } from './text/text-measurement.js';
import { ensurePage, routeSlots } from './layout/page-state.js';
import { placeLines } from './text/text-placement.js';
import { slotCollidesWithPlacedBlock } from './layout/flow-occupancy.js';
import { placeStructuredBlock } from './structured-block-placement.js';
import { addResidual, addTableResidual, diagnostic, recordFlowDecision } from './planning-records.js';

export type {
  FlowPlanningContext,
  FlowRuntime,
  FlowTarget,
  SelectedFlowSlot,
} from './contracts/flow-planning.js';

type FlowTargetResolution =
  | { kind: 'ready'; target: FlowTarget }
  | { kind: 'continue' }
  | { kind: 'stop' };

type FlowTargetUnavailableResolution = Exclude<FlowTargetResolution, { kind: 'ready' }>;

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
  skipPreplannedInsertionBlocks: boolean,
): FlowPlanningContext | undefined {
  const flow = document.flows[flowId];
  if (!flow) return undefined;
  const authoredBlocks = flow.blocks;
  const blocks = skipPreplannedInsertionBlocks
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
    blocks,
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
 * @planner-responsibility Keep the current recordFlowResidual implementation intact until its target seam is extracted.
 */
function recordFlowResidual(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  reason: string,
): void {
  const block = context.blocks[runtime.cursor.blockIndex];
  if (block.kind === 'table') {
    addTableResidual(context.plan.residualContent, context.flowId, block, runtime.cursor.startRow, runtime.lastLegalSlotId, reason);
    return;
  }
  addResidual(context.plan.residualContent, context.flowId, block, runtime.cursor.startWord, runtime.lastLegalSlotId, reason);
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Reject a flow at a page boundary that violates its configured contract.
 */
function flowReachedTerminalPage(context: FlowPlanningContext, runtime: FlowRuntime): boolean {
  if (runtime.cursor.page > context.template.maxPages) {
    const block = context.blocks[runtime.cursor.blockIndex];
    context.plan.diagnostics.push(diagnostic('error', 'MAX_PAGES_EXCEEDED', `Flow '${context.flowId}' exceeded the template page limit.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
    recordFlowResidual(context, runtime, 'max-pages');
    return true;
  }
  if (runtime.cursor.page > context.startPage && context.route.continuation === 'forbidden') {
    const block = context.blocks[runtime.cursor.blockIndex];
    context.plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${context.flowId}' cannot continue beyond its first page.`, { flowId: context.flowId, blockId: block.id, page: runtime.cursor.page }));
    recordFlowResidual(context, runtime, 'flow-continuation-forbidden');
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
 * @planner-responsibility Keep the current resolveUnavailableFlowSlot implementation intact until its target seam is extracted.
 */
function resolveUnavailableFlowSlot(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  availableRouteSlots: string[],
  selectedSlot: SelectedFlowSlot | undefined,
): FlowTargetUnavailableResolution {
  const block = context.blocks[runtime.cursor.blockIndex];
  if (selectedSlot === undefined && !hasRoleEligibleSlot(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots)) {
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

type FlowTargetSelectionResolution =
  | { kind: 'ready'; target: FlowTarget }
  | { kind: 'continue' }
  | { kind: 'stop' };

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Build the immutable target record after a legal slot has been selected.
 */
function createFlowTarget(
  context: FlowPlanningContext,
  currentPage: PageState,
  availableRouteSlots: string[],
  block: CompositionBlock,
  selectedSlot: SelectedFlowSlot,
): FlowTarget {
  return {
    currentPage,
    availableRouteSlots,
    block,
    selectedSlot,
    definition: selectedSlot.definition,
  };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Select and validate the legal target slot for the current flow block.
 */
function selectFlowTarget(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  currentPage: PageState,
  availableRouteSlots: string[],
): FlowTargetSelectionResolution {
  const block = context.blocks[runtime.cursor.blockIndex];
  const selectedSlot = slotFor(currentPage.layout, availableRouteSlots, runtime.cursor.routeIndex, context.flowId, block, currentPage.slots);
  if (!selectedSlot || (selectedSlot.definition.kind !== 'text' && selectedSlot.definition.kind !== 'block')) {
    return resolveUnavailableFlowSlot(context, runtime, currentPage, availableRouteSlots, selectedSlot);
  }
  return {
    kind: 'ready',
    target: createFlowTarget(context, currentPage, availableRouteSlots, block, selectedSlot),
  };
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
  const selection = selectFlowTarget(context, runtime, currentPage, availableRouteSlots);
  if (selection.kind !== 'ready') return selection;
  runtime.cursor.routeIndex = selection.target.selectedSlot.routeIndex;
  return { kind: 'ready', target: selection.target };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Push a non-text block when its target slot is already occupied.
 */
function pushNonTextBlockForCollision(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): boolean {
  const { currentPage, availableRouteSlots, definition } = target;
  const { cursor } = runtime;
  // Header/footer text deliberately shares its chrome band with the
  // reserved lockup. The lockup is a paint reservation, not a competing
  // content block, so it must not push the auxiliary flow to another page.
  if (context.flowId !== 'title' && context.flowId !== 'header' && context.flowId !== 'footer' && slotCollidesWithPlacedBlock(currentPage, definition.id, context.plan, context.flowId)) {
    recordFlowDecision(context, 'TEXT_SLOT_COLLISION_PUSHED', runtime, target, 'slot-overlaps-placed-block');
    advanceCursor(cursor, availableRouteSlots);
    return true;
  }
  return false;
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Reject an inline asset that has no asset-to-slot mapping.
 */
function skipUnsupportedInlineAsset(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): boolean {
  const { currentPage, block, definition } = target;
  if (!block.assetIds || block.assetIds.length === 0) return false;
  context.plan.diagnostics.push(diagnostic('error', 'UNSUPPORTED_INLINE_ASSET', `Text planner cannot place inline asset(s) from '${block.id}' without an asset-to-slot mapping.`, { flowId: context.flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { assetIds: block.assetIds } }));
  runtime.cursor.blockIndex += 1;
  runtime.cursor.startWord = 0;
  return true;
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
  if (pushNonTextBlockForCollision(context, runtime, target)) return true;
  if (skipUnsupportedInlineAsset(context, runtime, target)) return true;
  return placeStructuredBlock(context, runtime, target);
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
): { completed: boolean } {
  const { currentPage, block, selectedSlot, definition } = target;
  const { cursor } = runtime;
  const { flowId, metrics, plan } = context;
  const { leading, slot } = prepared;
  placeLines(currentPage, definition, block, metrics, flowId, selectedSlot.routeIndex, selected, leading, plan.placements, plan.lines);
  runtime.lastLegalSlotId = slot.id;
  const consumedEnd = selected.at(-1)!.endWord;
  const completed = consumedEnd >= wordsForBlock(block).length;
  if (completed) {
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    recordFlowDecision(context, 'BLOCK_PLACED', runtime, target);
  } else {
    cursor.startWord = consumedEnd;
    recordFlowDecision(context, 'BLOCK_CONTINUED', runtime, target);
  }
  return { completed };
}

/**
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Decide whether the flow continues on this page or moves forward.
 */
function advanceFlowAfterTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  completed: boolean,
): void {
  const { cursor } = runtime;
  const { availableRouteSlots } = target;
  const { blocks } = context;
  if (completed && cursor.blockIndex >= blocks.length) return;
  if (!completed) {
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
 * @planner-target composition/flow-planner.ts
 * @planner-responsibility Coordinate one text-placement attempt through prepared inputs, decisions, placement, and cursor advancement.
 */
function planTextBlockAttempt(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): TextBlockAttemptResult {
  const prepared = prepareTextPlacement(context, runtime, target);
  if (prepared.wrapped.length === 0) {
    advanceTextBlockWhenNoLinesFit(context, runtime, target);
    return { kind: 'continue' };
  }
  growTextSlotForInitialPlacement(context, runtime, target, prepared);
  const capacity = textPlacementCapacity(target, prepared);
  const decision = applyTextPlacementDecisionRules(context, runtime, target, prepared, capacity);
  if (decision) return decision;
  const selected = selectTextLinesForPlacement(context, prepared, capacity.currentAvailableLines);
  const { completed } = commitSelectedTextLines(context, runtime, target, prepared, selected);
  advanceFlowAfterTextPlacement(context, runtime, target, completed);
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
  skipPreplannedInsertionBlocks = false,
): void {
  const context = createFlowPlanningContext(document, metrics, template, policy, flowId, route, pages, plan, startPage, skipPreplannedInsertionBlocks);
  if (!context) return;
  const runtime = createFlowRuntime(context);
  const { cursor } = runtime;
  const { blocks } = context;
  while (cursor.blockIndex < blocks.length) {
    if (flowReachedTerminalPage(context, runtime)) return;
    const currentPage = ensureCurrentFlowPage(context, runtime);
    if (!currentPage) return;
    const resolution = resolveFlowTarget(context, runtime, currentPage);
    if (resolution.kind === 'stop') return;
    if (resolution.kind === 'continue') continue;
    if (handleNonTextFlowPlacement(context, runtime, resolution.target)) continue;
    const textAttempt = planTextBlockAttempt(context, runtime, resolution.target);
    if (textAttempt.kind === 'stop') return;
    continue;
  }
}
