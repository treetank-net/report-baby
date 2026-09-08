import type {
  CompositionBlock,
  CompositionDocument,
} from './model.js';
import type {
  CompositionBlockTrace,
  CompositionLine,
  CompositionPlan,
  CompositionPlanTrace,
  CompositionPlanningPhaseName,
  CompositionTextMetrics,
  CompositionTraceDecision,
} from './contracts/engine-contracts.js';
import { availableLineCount } from './text/text-layout.js';
import { wordsOf } from './text/tokenization.js';

function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

function plannedLines(plan: CompositionPlan): CompositionLine[] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function sourceWordCount(block: CompositionBlock): number {
  return wordsOf(textOf(block)).length;
}

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
