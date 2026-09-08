import type {
  CompositionBlock,
  CompositionRect,
} from './model.js';
import type { CompositionPlan } from './engine.js';
import {
  flowBarrierBoxCandidatesForSlot,
} from './flow-barriers.js';
import type {
  FlowPlanningContext,
  FlowRuntime,
  FlowTarget,
  PreparedTextPlacement,
} from './contracts/flow-planning.js';
import {
  flowingTextBottom,
  occupiedBottomInOverlappingSlots,
  previousBlockInSlot,
} from './flow-occupancy.js';
import { advanceCursor } from './flow-cursor.js';
import { growSlot } from './slot-growth.js';
import { availableLineCount } from './text/line-capacity.js';
import { obstructionAcrossLineBands } from './text/text-wrapping.js';
import { lineHeight, styleFor, wrapBlock } from './text/text-measurement.js';
import { rectBottom, slotBox } from './page-management.js';
import { addResidual, diagnostic, recordFlowDecision } from './planning-records.js';

/** Decide whether the current block is a heading that cannot fit whole. */
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

type ListItemKeepDecision =
  | { kind: 'push'; minimumFragmentLines: number; completeLines: number; availableLines: number }
  | { kind: 'split'; minimumFragmentLines: number; completeLines: number; availableLines: number };

/** Evaluate whether a list item must remain together or may be split. */
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

type HeadingClusterProbes = {
  headingProbe: ReturnType<typeof wrapBlock>;
  leadProbe: ReturnType<typeof wrapBlock>;
  keepLines: number;
  nextLeading: number;
};

/** Probe a heading and its kept lead without page obstacles. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current headingClusterProbes implementation intact until its target seam is extracted.
 */
function headingClusterProbes(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentBox: CompositionRect,
): HeadingClusterProbes | undefined {
  const next = context.blocks[runtime.cursor.blockIndex + 1];
  const keepLines = target.block.keepWithNextLines
    ?? (target.block.kind === 'heading' ? context.policy.headingKeepWithNextLines ?? 0 : 0);
  if (!prepared.isHeadingBlock || keepLines <= 0 || !next) return undefined;
  const nextLeading = lineHeight(context.metrics, next);
  const headingStartOffset = prepared.startLineOffset + prepared.blockGap / prepared.leading;
  const headingProbe = wrapBlock(context.metrics, target.block, runtime.cursor.startWord, prepared.initialBox, headingStartOffset, Number.POSITIVE_INFINITY, [], prepared.leading, context.policy.minimumWrapWidth);
  const headingBottom = headingProbe.length > 0
    ? prepared.initialBox.y + (headingProbe.at(-1)!.lineOffset + 1) * prepared.leading
    : prepared.initialBox.y + headingStartOffset * prepared.leading;
  const nextProbeStart = (headingBottom + prepared.blockGap - currentBox.y) / nextLeading;
  const leadProbe = wrapBlock(context.metrics, next, 0, currentBox, nextProbeStart, Number.POSITIVE_INFINITY, [], nextLeading, context.policy.minimumWrapWidth);
  return { headingProbe, leadProbe, keepLines, nextLeading };
}

/** Check whether an obstacle breaks a heading/lead keep cluster. */
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
  const { geometryTolerance } = context;
  const { leading, initialBox, pageGraphics } = prepared;
  const probes = headingClusterProbes(context, runtime, target, prepared, currentBox);
  if (!probes || probes.leadProbe.length < probes.keepLines) return undefined;
  const clusterObstacle = obstructionAcrossLineBands(
    [{ lines: probes.headingProbe, lineHeight: leading }, { lines: probes.leadProbe.slice(0, probes.keepLines), lineHeight: probes.nextLeading }],
    initialBox,
    initialBox.y,
    pageGraphics,
    geometryTolerance,
  );
  if (!clusterObstacle) return undefined;
  const requiredClusterLines = probes.headingProbe.length + probes.keepLines;
  const resumeY = Math.max(cursor.resumeY ?? initialBox.y, rectBottom(clusterObstacle.box));
  const availableAfterObstacle = availableLineCount(rectBottom(currentBox) - resumeY, leading);
  if (availableAfterObstacle >= requiredClusterLines) {
    return { kind: 'resume-below-obstacle', obstacleId: clusterObstacle.graphicId, resumeY, requiredClusterLines, availableAfterObstacle };
  }
  return { kind: 'push-to-next-slot', obstacleId: clusterObstacle.graphicId, requiredClusterLines, availableAfterObstacle };
}

/** Check whether a heading keep cluster exceeds the current segment. */
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

/** Check whether a non-heading keep cluster can be relaxed. */
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

/** Calculate the first available line offset and local occupancy. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current textPlacementStartLineOffset implementation intact until its target seam is extracted.
 */
function textPlacementStartLineOffset(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  slot: PreparedTextPlacement['slot'],
  initialBox: CompositionRect,
  leading: number,
): { startLineOffset: number; localBottom: number } {
  const localBottom = flowingTextBottom(context.plan, slot.id, initialBox.y, context.document);
  const crossSlotBottom = occupiedBottomInOverlappingSlots(target.currentPage, context.plan, slot, localBottom);
  const usedBottom = Math.max(
    localBottom,
    crossSlotBottom,
    runtime.cursor.resumeSlotId === slot.id ? runtime.cursor.resumeY ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY,
  );
  return { startLineOffset: Math.max(0, (usedBottom - initialBox.y) / leading), localBottom };
}

/** Collect graphics and flow barriers visible to one text placement. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current textPlacementObstacles implementation intact until its target seam is extracted.
 */
function textPlacementObstacles(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  slot: PreparedTextPlacement['slot'],
): {
  pageGraphics: CompositionPlan['graphicPlacements'];
  flowBarrierBoxCandidates: PreparedTextPlacement['flowBarrierBoxCandidates'];
} {
  const pageGraphics = context.plan.graphicPlacements.filter((graphic) => graphic.page === target.currentPage.page && graphic.graphicId !== `insertion:${target.block.id}`);
  const flowBarrierBoxCandidates = flowBarrierBoxCandidatesForSlot(target.currentPage.page, slot, context.flowId, context.plan.graphicPlacements);
  if (flowBarrierBoxCandidates.length > 0) {
    recordFlowDecision(context, 'FLOW_BARRIER_BOXES_CONSUMED', runtime, target);
  }
  return { pageGraphics, flowBarrierBoxCandidates };
}

/** Calculate the configured gap before the current text block. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current textPlacementBlockGap implementation intact until its target seam is extracted.
 */
function textPlacementBlockGap(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  slot: PreparedTextPlacement['slot'],
  localBottom: number,
): number {
  const previous = runtime.cursor.startWord === 0
    ? previousBlockInSlot(context.plan, slot.id, target.block.id, context.document)
    : undefined;
  const resumedAfterFlowBarrier = runtime.cursor.resumeSlotId === slot.id
    && runtime.cursor.resumeY !== undefined
    && runtime.cursor.resumeY > localBottom + context.geometryTolerance;
  return resumedAfterFlowBarrier
    ? 0
    : previous ? context.metrics.blockGap?.(styleFor(previous), styleFor(target.block)) ?? 0 : 0;
}

/** Wrap the current block with and without its configured gap. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current wrapTextPlacement implementation intact until its target seam is extracted.
 */
function wrapTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  initialBox: CompositionRect,
  startLineOffset: number,
  textBottom: number,
  pageGraphics: CompositionPlan['graphicPlacements'],
  flowBarrierBoxCandidates: PreparedTextPlacement['flowBarrierBoxCandidates'],
  leading: number,
  blockGap: number,
): { wrapped: ReturnType<typeof wrapBlock>; completeWrapped: ReturnType<typeof wrapBlock> } {
  const { metrics, policy, geometryTolerance } = context;
  const { block } = target;
  const wrapped = wrapBlock(metrics, block, runtime.cursor.startWord, initialBox, startLineOffset + blockGap / leading, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  const completeWrapped = wrapBlock(metrics, block, runtime.cursor.startWord, initialBox, startLineOffset + blockGap / leading, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  return { wrapped, completeWrapped };
}

/** Compress a heading gap only when the complete heading remains legal. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current compressHeadingGapIfNeeded implementation intact until its target seam is extracted.
 */
function compressHeadingGapIfNeeded(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  initialBox: CompositionRect,
  startLineOffset: number,
  textBottom: number,
  pageGraphics: CompositionPlan['graphicPlacements'],
  flowBarrierBoxCandidates: PreparedTextPlacement['flowBarrierBoxCandidates'],
  leading: number,
  blockGap: number,
  wrapped: ReturnType<typeof wrapBlock>,
  completeWrapped: ReturnType<typeof wrapBlock>,
): { blockGap: number; wrapped: ReturnType<typeof wrapBlock>; completeWrapped: ReturnType<typeof wrapBlock> } {
  const { metrics, policy, geometryTolerance } = context;
  const isHeadingBlock = target.block.kind === 'heading' || target.block.role === 'heading' || target.block.role === 'title';
  const availableWithoutGap = availableLineCount(rectBottom(initialBox) - (initialBox.y + startLineOffset * leading), leading);
  if (!isHeadingBlock || blockGap <= 0 || wrapped.length >= completeWrapped.length) return { blockGap, wrapped, completeWrapped };
  const noGapWrapped = wrapBlock(metrics, target.block, runtime.cursor.startWord, initialBox, startLineOffset, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  const noGapComplete = wrapBlock(metrics, target.block, runtime.cursor.startWord, initialBox, startLineOffset, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
  if (noGapComplete.length > availableWithoutGap || noGapWrapped.length !== noGapComplete.length) return { blockGap, wrapped, completeWrapped };
  recordFlowDecision(context, 'BLOCK_GAP_COMPRESSED', runtime, target, 'keep-heading-whole-without-empty-column');
  return { blockGap: 0, wrapped: noGapWrapped, completeWrapped: noGapComplete };
}

/** Build the read-only inputs for one text-placement attempt. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Build the read-only inputs for one text-placement attempt.
 */
export function prepareTextPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): PreparedTextPlacement {
  const { currentPage, block, definition } = target;
  const { metrics } = context;
  const leading = lineHeight(metrics, block);
  const slot = currentPage.slots.get(definition.id)!;
  const initialBox = slotBox(currentPage, definition);
  const textBottom = definition.grow?.axis === 'y'
    ? definition.box.y + definition.grow.maxHeight
    : rectBottom(initialBox);
  const start = textPlacementStartLineOffset(context, runtime, target, slot, initialBox, leading);
  const blockGap = textPlacementBlockGap(context, runtime, target, slot, start.localBottom);
  const isHeadingBlock = block.kind === 'heading' || block.role === 'heading' || block.role === 'title';
  const { pageGraphics, flowBarrierBoxCandidates } = textPlacementObstacles(context, runtime, target, slot);
  const wraps = wrapTextPlacement(context, runtime, target, initialBox, start.startLineOffset, textBottom, pageGraphics, flowBarrierBoxCandidates, leading, blockGap);
  const compressed = compressHeadingGapIfNeeded(context, runtime, target, initialBox, start.startLineOffset, textBottom, pageGraphics, flowBarrierBoxCandidates, leading, blockGap, wraps.wrapped, wraps.completeWrapped);
  return { leading, slot, initialBox, startLineOffset: start.startLineOffset, pageGraphics, flowBarrierBoxCandidates, blockGap: compressed.blockGap, isHeadingBlock, wrapped: compressed.wrapped, completeWrapped: compressed.completeWrapped };
}

/** Select the lines that fit the current slot and configured keep rules. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Choose the lines that fit the current slot and keep rules.
 */
export function selectTextLinesForPlacement(
  context: FlowPlanningContext,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): ReturnType<typeof wrapBlock> {
  const { policy } = context;
  const { wrapped, completeWrapped } = prepared;
  let take = Math.min(currentAvailableLines, wrapped.length);
  const remainder = completeWrapped.length - take;
  if (remainder > 0 && policy.minimumLinesAtEnd !== undefined && remainder < policy.minimumLinesAtEnd) {
    take -= policy.minimumLinesAtEnd - remainder;
  }
  return wrapped.slice(0, take);
}

/** Move the current block when wrapping found no legal line band. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current advanceTextBlockWhenNoLinesFit implementation intact until its target seam is extracted.
 */
export function advanceTextBlockWhenNoLinesFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
): void {
  const { cursor } = runtime;
  recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_SLOT', runtime, target, 'no-available-text-band');
  advanceCursor(cursor, target.availableRouteSlots);
}

/** Grow a text slot when its complete first placement needs more height. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current growTextSlotForInitialPlacement implementation intact until its target seam is extracted.
 */
export function growTextSlotForInitialPlacement(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
): void {
  const { cursor } = runtime;
  const { definition } = target;
  if (definition.grow?.axis !== 'y' || cursor.startWord !== 0 || prepared.wrapped.length === 0) return;
  const requiredBottom = prepared.initialBox.y + (prepared.wrapped.at(-1)!.lineOffset + 1) * prepared.leading;
  growSlot(context, runtime, target, requiredBottom);
}

/** Push a heading when the complete heading cannot fit in the current segment. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current pushHeadingWhenWholeHeadingDoesNotFit implementation intact until its target seam is extracted.
 */
export function pushHeadingWhenWholeHeadingDoesNotFit(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentAvailableLines: number,
): boolean {
  if (!headingExceedsAvailableLines(prepared, currentAvailableLines)) return false;
  recordFlowDecision(context, 'HEADING_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-heading-together');
  advanceCursor(runtime.cursor, target.availableRouteSlots);
  return true;
}

/** Record that a list item was split to avoid an undersized trailing hole. */
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

/** Push a list item when the remaining fragment would be below its minimum. */
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
  recordFlowDecision(context, 'LIST_ITEM_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-list-item-together-below-minimum-fragment');
  advanceCursor(runtime.cursor, target.availableRouteSlots);
  return true;
}

/** Resolve an obstacle that intersects a heading and its kept lead. */
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
  if (decision.kind === 'resume-below-obstacle') {
    runtime.cursor.resumeY = decision.resumeY;
    runtime.cursor.resumeSlotId = prepared.slot.id;
    recordFlowDecision(context, 'HEADING_CLUSTER_PUSHED_BELOW_OBSTACLE', runtime, target, 'keep-heading-and-lead-together');
    return { kind: 'continue' };
  }
  recordFlowDecision(context, 'HEADING_CLUSTER_PUSHED_TO_NEXT_SLOT', runtime, target, 'keep-heading-and-lead-together');
  advanceCursor(runtime.cursor, target.availableRouteSlots);
  return { kind: 'continue' };
}

/** Push a heading keep cluster when its required lines exceed local capacity. */
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
  recordFlowDecision(context, 'KEEP_CLUSTER_PUSHED', runtime, target, 'insufficient-local-capacity');
  advanceCursor(runtime.cursor, target.availableRouteSlots);
  return true;
}

/** Record that a non-heading keep cluster was relaxed. */
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

/** Move to the next slot or reject a forbidden continuation when no lines fit. */
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
  const { currentPage, block } = target;
  const { flowId, plan, route } = context;
  runtime.lastLegalSlotId = prepared.slot.id;
  recordFlowDecision(context, 'BLOCK_PUSHED_TO_NEXT_SLOT', runtime, target, 'next-block-spacing-or-line-height-does-not-fit');
  if (route.continuation === 'forbidden' && cursor.routeIndex >= target.availableRouteSlots.length - 1) {
    plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${flowId}' cannot continue beyond its available slots on page ${currentPage.page}.`, { flowId, blockId: block.id, page: currentPage.page, slotId: prepared.slot.id }));
    addResidual(plan.residualContent, flowId, block, cursor.startWord, runtime.lastLegalSlotId, 'flow-continuation-forbidden');
    return { kind: 'stop' };
  }
  advanceCursor(cursor, target.availableRouteSlots);
  return { kind: 'continue' };
}

type TextPlacementCapacity = {
  currentBox: CompositionRect;
  currentAvailableLines: number;
  usedLines: number;
};

/** Calculate available and already-used lines for the current text segment. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current textPlacementCapacity implementation intact until its target seam is extracted.
 */
export function textPlacementCapacity(target: FlowTarget, prepared: PreparedTextPlacement): TextPlacementCapacity {
  const currentBox = slotBox(target.currentPage, target.definition);
  const blockStartOffset = prepared.startLineOffset + prepared.blockGap / prepared.leading;
  const currentAvailableLines = availableLineCount(rectBottom(currentBox) - (currentBox.y + blockStartOffset * prepared.leading), prepared.leading);
  return { currentBox, currentAvailableLines, usedLines: prepared.startLineOffset };
}

type NextBlockKeepProbe = {
  keepLines: number;
  nextWrapped: ReturnType<typeof wrapBlock>;
};

/** Measure the next authored block needed by keep-with-next rules. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current nextBlockKeepProbe implementation intact until its target seam is extracted.
 */
function nextBlockKeepProbe(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  currentBox: CompositionRect,
): NextBlockKeepProbe {
  const { block } = target;
  const next = context.blocks[runtime.cursor.blockIndex + 1];
  const keepLines = block.keepWithNextLines
    ?? (block.kind === 'heading' ? context.policy.headingKeepWithNextLines ?? 0 : 0);
  if (!next) return { keepLines, nextWrapped: [] };
  const nextLeading = lineHeight(context.metrics, next);
  const nextWrapped = wrapBlock(context.metrics, next, 0, currentBox, 0, rectBottom(currentBox), prepared.pageGraphics, nextLeading, context.policy.minimumWrapWidth, prepared.flowBarrierBoxCandidates, context.geometryTolerance);
  return { keepLines, nextWrapped };
}

/** Apply all text keep, obstacle, and capacity decisions before placement. */
/**
 * @planner-target composition/flow-text-decision.ts
 * @planner-responsibility Keep the current applyTextPlacementDecisionRules implementation intact until its target seam is extracted.
 */
export function applyTextPlacementDecisionRules(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  prepared: PreparedTextPlacement,
  capacity: TextPlacementCapacity,
): TextBlockAttemptResult | undefined {
  const { currentAvailableLines, usedLines, currentBox } = capacity;
  if (pushHeadingWhenWholeHeadingDoesNotFit(context, runtime, target, prepared, currentAvailableLines)) return { kind: 'continue' };
  const listKeepDecision = evaluateListItemKeepTogether(context, runtime, target, prepared, currentAvailableLines, usedLines);
  if (pushListItemWhenMinimumFragmentWouldBeBroken(context, runtime, target, listKeepDecision)) return { kind: 'continue' };
  recordListItemSplitDecision(context, target, listKeepDecision);
  const keepProbe = nextBlockKeepProbe(context, runtime, target, prepared, currentBox);
  const headingClusterResult = handleHeadingClusterObstacleBeforeTextPlacement(context, runtime, target, prepared, currentBox);
  if (headingClusterResult) return headingClusterResult;
  const keepRequired = keepProbe.keepLines > 0 && runtime.cursor.startWord === 0
    ? prepared.completeWrapped.length + Math.min(keepProbe.keepLines, keepProbe.nextWrapped.length)
    : 0;
  if (pushKeepClusterWhenItCannotFit(context, runtime, target, prepared, keepRequired, currentAvailableLines, usedLines)) return { kind: 'continue' };
  recordRelaxedKeepCluster(context, target, prepared, keepRequired, currentAvailableLines);
  return advanceTextBlockWhenNoCapacity(context, runtime, target, prepared, currentAvailableLines);
}

export type TextBlockAttemptResult =
  | { kind: 'continue' }
  | { kind: 'stop' }
  | { kind: 'done' };

export type { TextPlacementCapacity };
