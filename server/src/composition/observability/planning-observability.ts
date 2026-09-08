import type { CompositionBlock, CompositionDocument } from '../model.js';
import type {
  CompositionDecision,
  CompositionDiagnostic,
  CompositionPlan,
  CompositionWordRange,
} from '../contracts/engine-contracts.js';
import type { FlowPlanningContext, FlowRuntime, FlowTarget } from '../contracts/flow-planning.js';
import { textOf, wordsForBlock, availableLineCount } from '../text/text-layout.js';

/**
 * @planner-target composition/observability/planning-observability.ts
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
 * @planner-target composition/observability/planning-observability.ts
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
 * @planner-target composition/observability/planning-observability.ts
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
 * @planner-target composition/observability/planning-observability.ts
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

import type {
  CompositionBlockTrace,
  CompositionPlanTrace,
  CompositionPlanningPhaseName,
  CompositionTextMetrics,
  CompositionTraceDecision,
} from '../contracts/engine-contracts.js';
import { wordCountOf } from '../text/tokenization.js';
import { plannedLines } from '../layout/plan-lines.js';

/**
 * @planner-target composition/observability/planning-observability.ts
 * @planner-responsibility Keep the current sourceWordCount implementation intact until its target seam is extracted.
 */
function sourceWordCount(block: CompositionBlock): number {
  return wordCountOf(block.text);
}

/**
 * @planner-target composition/observability/planning-observability.ts
 * @planner-responsibility Keep the current recordPlanningPhase implementation intact until its target seam is extracted.
 */
export function recordPlanningPhase(
  plan: CompositionPlan,
  name: CompositionPlanningPhaseName,
  status: 'completed' | 'failed',
  details?: Record<string, unknown>,
  iteration?: number,
): void {
  plan.trace?.phases.push({ name, status, ...(iteration === undefined ? {} : { iteration }), ...(details ? { details } : {}) });
}

/**
 * Project the executable plan into the maintainer-facing trace.
 *
 * This is deliberately a read-only reporting seam. It does not decide where
 * content goes and must stay after placement, normalization, and glyph
 * resolution have completed.
 */
/**
 * @planner-target composition/observability/planning-observability.ts
 * @planner-responsibility Keep the current tracePlan implementation intact until its target seam is extracted.
 */
export function tracePlan(document: CompositionDocument, metrics: CompositionTextMetrics, plan: CompositionPlan): void {
  const sourceBlocks = Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => ({ flowId: flow.id, block })));
  const decisionsByBlock = new Map<string, CompositionTraceDecision[]>();
  for (const decision of plan.decisions) {
    const blockId = typeof decision.blockId === 'string' ? decision.blockId : undefined;
    if (!blockId) continue;
    const details = Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'code' && key !== 'blockId'));
    const decisions = decisionsByBlock.get(blockId) ?? [];
    if (!decisions.some((item) => item.code === decision.code && JSON.stringify(item.details) === JSON.stringify(details))) {
      decisions.push({ code: decision.code, details });
    }
    decisionsByBlock.set(blockId, decisions);
  }
  const fragmentsByBlock = new Map<string, CompositionBlockTrace['fragments']>();
  /**
   * @planner-target composition/observability/planning-observability.ts
   * @planner-responsibility Keep the current addFragment implementation intact until its target seam is extracted.
   */
  const addFragment = (blockId: string, fragment: CompositionBlockTrace['fragments'][number]): void => {
    const fragments = fragmentsByBlock.get(blockId) ?? [];
    fragments.push(fragment);
    fragmentsByBlock.set(blockId, fragments);
  };
  for (const line of plannedLines(plan)) addFragment(line.blockId, { page: line.page, slotId: line.slotId, ...(line.routeIndex === undefined ? {} : { routeIndex: line.routeIndex }), startWord: line.startWord, endWord: line.endWord, text: line.text, box: { ...line.box } });
  for (const placement of plan.blockPlacements) addFragment(placement.blockId, { page: placement.page, slotId: placement.slotId, routeIndex: placement.routeIndex, box: { ...placement.box } });
  for (const placement of plan.tablePlacements) addFragment(placement.blockId, { page: placement.page, slotId: placement.slotId, routeIndex: placement.routeIndex, box: { ...placement.box } });
  const residualIds = new Set(plan.residualContent.map((residual) => residual.blockId));
  const blocks = sourceBlocks.map(({ flowId, block }) => {
    const fragments = (fragmentsByBlock.get(block.id) ?? []).sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x);
    const coveredWords = fragments.reduce((total, fragment) => total + Math.max(0, (fragment.endWord ?? fragment.startWord ?? 0) - (fragment.startWord ?? 0)), 0);
    const status: CompositionBlockTrace['status'] = fragments.length === 0 ? 'empty' : residualIds.has(block.id) ? 'residual' : coveredWords < sourceWordCount(block) ? 'partial' : 'placed';
    return { flowId, blockId: block.id, kind: block.kind, role: block.role, sourceText: textOf(block), sourceWordCount: sourceWordCount(block), status, fragments, decisions: decisionsByBlock.get(block.id) ?? [] };
  });
  const lineHeightBySlot = new Map<string, number>();
  for (const line of plannedLines(plan)) if (!lineHeightBySlot.has(line.slotId)) lineHeightBySlot.set(line.slotId, line.box.height);
  const defaultLineHeight = metrics.lineHeight('body');
  const slots = plan.slots.map((slot) => {
    const lineHeightValue = lineHeightBySlot.get(slot.id) ?? defaultLineHeight;
    const occupiedBottom = Math.max(
      slot.box.y,
      ...plannedLines(plan).filter((line) => line.slotId === slot.id).map((line) => line.box.y + line.box.height),
      ...plan.blockPlacements.filter((placement) => placement.slotId === slot.id).map((placement) => placement.box.y + placement.box.height),
      ...plan.tablePlacements.filter((placement) => placement.slotId === slot.id).map((placement) => placement.box.y + placement.box.height),
    );
    const occupiedHeight = Math.max(0, occupiedBottom - slot.box.y);
    const remainingHeight = Math.max(0, slot.box.height - occupiedHeight);
    return {
      page: slot.page,
      slotId: slot.id,
      regionId: slot.regionId,
      ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
      ...(slot.routeIndex === undefined ? {} : { routeIndex: slot.routeIndex }),
      ...(slot.allowedRoles === undefined ? {} : { allowedRoles: [...slot.allowedRoles] }),
      state: slot.state,
      box: { ...slot.box },
      lineCount: plannedLines(plan).filter((line) => line.slotId === slot.id).length,
      occupiedHeight,
      remainingHeight,
      lineHeight: lineHeightValue,
      remainingLines: availableLineCount(remainingHeight, lineHeightValue),
    };
  });
  plan.trace = {
    phases: plan.trace?.phases ?? [],
    blocks,
    slots,
    ...(plan.flowPlacements ? { flowPlacements: plan.flowPlacements } : {}),
    ...(plan.flowBarrierBoxCandidates ? { flowBarrierBoxCandidates: plan.flowBarrierBoxCandidates } : {}),
  } satisfies CompositionPlanTrace;
}
