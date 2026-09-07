import type { CompositionDecision } from './engine.js';
import type { FlowPlanningContext, FlowRuntime, FlowTarget } from './flow-planner.js';

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Build one decision from the planner objects already in scope and append it in order.
 */
export function recordFlowDecision(
  context: FlowPlanningContext,
  eventName: string,
  runtime?: FlowRuntime,
  target?: FlowTarget,
  reason?: string,
): CompositionDecision {
  const decision: CompositionDecision = { code: eventName };
  if (context.flowId !== undefined) decision.flowId = context.flowId;
  const block = target?.block
    ?? (runtime ? context.blocks[runtime.cursor.blockIndex] : undefined);
  if (block !== undefined) decision.blockId = block.id;
  const page = target?.currentPage.page ?? runtime?.cursor.page;
  if (page !== undefined) decision.page = page;
  const slotId = target?.definition.id;
  if (slotId !== undefined) decision.slotId = slotId;
  const routeIndex = target?.selectedSlot.routeIndex ?? runtime?.cursor.routeIndex;
  if (routeIndex !== undefined) decision.routeIndex = routeIndex;
  if (reason !== undefined) decision.reason = reason;
  context.plan.decisions.push(decision);
  return decision;
}
