import type { CompositionBlock } from './model.js';
import type {
  CompositionDecision,
  CompositionDiagnostic,
  CompositionPlan,
  CompositionWordRange,
} from './engine.js';
import type { FlowPlanningContext, FlowRuntime, FlowTarget } from './contracts/flow-planning.js';
import { wordsForBlock } from './text-measurement.js';

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Build one diagnostic record without changing planner state.
 */
export function diagnostic(
  severity: CompositionDiagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<CompositionDiagnostic> = {},
): CompositionDiagnostic {
  return { severity, code, message, ...extra };
}

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Record the unplaced word range for one text block.
 */
export function addResidual(
  residualContent: CompositionPlan['residualContent'],
  flowId: string,
  block: CompositionBlock,
  startWord: number,
  lastLegalSlotId: string | undefined,
  reason: string,
): void {
  const end = wordsForBlock(block).length;
  if (startWord >= end) return;
  const consumed: CompositionWordRange = { start: 0, end: startWord };
  const remaining: CompositionWordRange = { start: startWord, end };
  residualContent.push({ flowId, blockId: block.id, reason, consumed, remaining, ...(lastLegalSlotId ? { lastLegalSlotId } : {}) });
}

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Record the unplaced row range for one table block.
 */
export function addTableResidual(
  residualContent: CompositionPlan['residualContent'],
  flowId: string,
  block: CompositionBlock,
  startRow: number,
  lastLegalSlotId: string | undefined,
  reason: string,
): void {
  const end = block.table?.body.length ?? 0;
  if (startRow >= end) return;
  residualContent.push({ flowId, blockId: block.id, reason, remainingRows: { start: startRow, end }, ...(lastLegalSlotId ? { lastLegalSlotId } : {}) });
}

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
