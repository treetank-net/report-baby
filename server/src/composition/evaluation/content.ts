import type { CompositionBlock, CompositionDocument } from '../model.js';

import type { CompositionDiagnostic, CompositionPlan, CompositionSlot } from '../contracts/engine-contracts.js';

import { allLines, firstVisualPlacement, slotFor, visualOrderRegressed, type VisualPlacementKey } from './plan-queries.js';
import { fitsInside, geometryTolerance } from './legality-geometry.js';
import { pushEvaluationError } from './diagnostics.js';
import { wordCountOf } from '../text/tokenization.js';

export type FlowPlacementSummary = {
  flowId: string;
  page: number;
  slotId: string;
  routeIndex: number;
  state: CompositionSlot['state'];
  hasContent: boolean;
  blockedBy: string[];
};

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Collect flow/slot keys that contain any planned material.
 */
export function collectFallbackFlowContent(document: CompositionDocument, plan: CompositionPlan): Set<string> {
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  const fallbackContent = new Set<string>();
  for (const line of allLines(plan)) fallbackContent.add(line.flowId + ':' + line.slotId);
  for (const placement of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    const flowId = 'flowId' in placement ? placement.flowId : blockFlowIds.get(placement.blockId);
    if (flowId) fallbackContent.add(flowId + ':' + placement.slotId);
  }
  return fallbackContent;
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Build the fallback flow-placement registry from text slots.
 */
export function buildFlowPlacementRegistry(document: CompositionDocument, plan: CompositionPlan): FlowPlacementSummary[] {
  const fallbackContent = collectFallbackFlowContent(document, plan);
  return plan.flowPlacements?.map((placement) => ({
    flowId: placement.flowId,
    page: placement.page,
    slotId: placement.slotId,
    routeIndex: placement.routeIndex,
    state: placement.state,
    hasContent: placement.hasContent,
    blockedBy: placement.blockedBy,
  })) ?? plan.slots
    .filter((slot): slot is CompositionSlot & { flowId: string; routeIndex: number } => slot.flowId !== undefined && slot.routeIndex !== undefined && slot.kind === 'text')
    .map((slot) => ({
      flowId: slot.flowId,
      page: slot.page,
      slotId: slot.id,
      routeIndex: slot.routeIndex,
      state: slot.state,
      hasContent: fallbackContent.has(slot.flowId + ':' + slot.id),
      blockedBy: plan.graphicPlacements.filter((graphic) => graphic.page === slot.page && graphic.wrap === 'around' && fitsInside(slot.box, graphic.box)).map((graphic) => graphic.graphicId),
    }));
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Report empty flow placements between occupied route positions.
 */
export function validateEmptyFlowPlacements(registry: FlowPlacementSummary[], diagnostics: CompositionDiagnostic[]): void {
  for (const flowId of new Set(registry.map((placement) => placement.flowId))) {
    const placements = registry.filter((placement) => placement.flowId === flowId).sort((left, right) => left.page - right.page || left.routeIndex - right.routeIndex);
    const occupied = placements.filter((placement) => placement.hasContent);
    if (occupied.length < 2) continue;
    const firstOccupied = placements.indexOf(occupied[0]);
    const lastOccupied = placements.lastIndexOf(occupied.at(-1)!);
    for (const empty of placements.slice(firstOccupied, lastOccupied + 1).filter((placement) => !placement.hasContent && placement.state !== 'exhausted' && placement.blockedBy.length === 0)) {
      const beforeEmpty = placements.slice(0, placements.indexOf(empty));
      const preceding = [...beforeEmpty].reverse().find((placement) => placement.hasContent);
      const following = placements.slice(placements.indexOf(empty) + 1).find((placement) => placement.hasContent);
      if (!preceding || !following) continue;
      pushEvaluationError(diagnostics, 'EMPTY_FLOW_PLACEMENT', 'Flow ' + flowId + ' leaves placement ' + empty.slotId + ' empty between occupied placements.', {
        flowId,
        page: empty.page,
        slotId: empty.slotId,
        details: {
          precedingSlotId: preceding.slotId,
          precedingPage: preceding.page,
          followingSlotId: following.slotId,
          followingPage: following.page,
          routeIndex: empty.routeIndex,
        },
      });
    }
  }
}



/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Index source blocks once for all content validators.
 */
export function sourceBlocksForDocument(document: CompositionDocument): Map<string, CompositionBlock> {
  return new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateFlowBlockOrder implementation intact until its target seam is extracted.
 */
export function validateFlowBlockOrder(flow: CompositionDocument['flows'][string], plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  let previous: { blockId: string; key: VisualPlacementKey } | undefined;
  for (const block of flow.blocks) {
    const key = firstVisualPlacement(plan, block.id);
    if (!key) continue;
    if (previous && visualOrderRegressed(key, previous.key)) pushEvaluationError(diagnostics, 'CONTENT_ORDER_VIOLATION', 'Block ' + block.id + ' is visually placed before preceding block ' + previous.blockId + ' in flow ' + flow.id + '.', { flowId: flow.id, blockId: block.id, previousBlockId: previous.blockId, actual: key, previous: previous.key });
    previous = { blockId: block.id, key };
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateFlowFragmentOrder implementation intact until its target seam is extracted.
 */
export function validateFlowFragmentOrder(flow: CompositionDocument['flows'][string], plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const flowingBlockIds = new Set(flow.blocks.filter((block) => block.kind !== 'table').map((block) => block.id));
  for (const blockId of flowingBlockIds) {
    const fragments = allLines(plan)
      .filter((line) => line.flowId === flow.id && line.blockId === blockId && line.routeIndex !== undefined)
      .sort((left, right) => left.startWord - right.startWord || left.page - right.page || (left.routeIndex ?? 0) - (right.routeIndex ?? 0));
    for (let index = 1; index < fragments.length; index += 1) {
      const previousFragment = fragments[index - 1];
      const fragment = fragments[index];
      if (previousFragment.page !== fragment.page || fragment.routeIndex === previousFragment.routeIndex || (fragment.routeIndex ?? 0) < (previousFragment.routeIndex ?? 0)) continue;
      const previousSlot = slotFor(plan, previousFragment.slotId);
      if (!previousSlot) continue;
      const previousBottom = previousFragment.box.y + previousFragment.box.height;
      const slotBottom = previousSlot.box.y + previousSlot.box.height;
      if (slotBottom - previousBottom > previousFragment.box.height * 2 + geometryTolerance(previousBottom, slotBottom)) {
        pushEvaluationError(diagnostics, 'FLOW_COLUMN_ADVANCE_EARLY', 'Block ' + blockId + ' continues into a later route segment before the preceding segment is exhausted.', {
          flowId: flow.id,
          blockId,
          page: fragment.page,
          slotId: fragment.slotId,
          details: { previousSlotId: previousFragment.slotId, previousRouteIndex: previousFragment.routeIndex, routeIndex: fragment.routeIndex, previousBottom, previousSlotBottom: slotBottom },
        });
      }
    }
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateFlowQuoteOrder implementation intact until its target seam is extracted.
 */
export function validateFlowQuoteOrder(flow: CompositionDocument['flows'][string], plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  let previousQuote: { blockId: string; key: VisualPlacementKey } | undefined;
  for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
    const key = firstVisualPlacement(plan, block.id);
    if (!key) continue;
    if (previousQuote && visualOrderRegressed(key, previousQuote.key)) pushEvaluationError(diagnostics, 'QUOTE_ORDER_VIOLATION', 'Quote ' + block.id + ' is visually placed before preceding quote ' + previousQuote.blockId + ' in flow ' + flow.id + '.', { flowId: flow.id, blockId: block.id, previousBlockId: previousQuote.blockId, actual: key, previous: previousQuote.key });
    previousQuote = { blockId: block.id, key };
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current occupiedRouteIndexesByPage implementation intact until its target seam is extracted.
 */
export function occupiedRouteIndexesByPage(flow: CompositionDocument['flows'][string], plan: CompositionPlan): Map<number, Set<number>> {
  const blockIds = new Set(flow.blocks.map((block) => block.id));
  const occupied = new Map<number, Set<number>>();
  for (const item of [
    ...allLines(plan).filter((line) => blockIds.has(line.blockId)),
    ...plan.blockPlacements.filter((placement) => blockIds.has(placement.blockId)),
    ...plan.tablePlacements.filter((placement) => blockIds.has(placement.blockId)),
  ]) {
    if (item.routeIndex === undefined) continue;
    occupied.set(item.page, new Set([...(occupied.get(item.page) ?? []), item.routeIndex]));
  }
  return occupied;
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateFlowRouteGaps implementation intact until its target seam is extracted.
 */
export function validateFlowRouteGaps(flow: CompositionDocument['flows'][string], plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const [page, indexes] of occupiedRouteIndexesByPage(flow, plan)) {
    if (page === 1 || plan.blockPlacements.some((placement) => placement.page === page) || plan.tablePlacements.some((placement) => placement.page === page)) continue;
    const ordered = [...indexes].sort((left, right) => left - right);
    if (ordered.length < 2) continue;
    for (let index = ordered[0] + 1; index < ordered.at(-1)!; index += 1) {
      if (!indexes.has(index)) diagnostics.push({ severity: 'error', code: 'ROUTE_SEGMENT_GAP', message: 'Flow ' + flow.id + ' leaves route segment ' + index + ' empty before later content on page ' + page + '.', flowId: flow.id, page, details: { routeIndex: index, occupiedRouteIndexes: ordered } });
    }
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateFlowVisualOrder implementation intact until its target seam is extracted.
 */
export function validateFlowVisualOrder(document: CompositionDocument, plan: CompositionPlan, repeatedFlows: Set<string>, diagnostics: CompositionDiagnostic[]): void {
  for (const flow of Object.values(document.flows)) {
    if (repeatedFlows.has(flow.id)) continue;
    validateFlowBlockOrder(flow, plan, diagnostics);
    validateFlowFragmentOrder(flow, plan, diagnostics);
    validateFlowQuoteOrder(flow, plan, diagnostics);
    validateFlowRouteGaps(flow, plan, diagnostics);
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateUnplacedTables implementation intact until its target seam is extracted.
 */
export function validateUnplacedTables(document: CompositionDocument, seenTableRows: Map<string, number>, diagnostics: CompositionDiagnostic[]): void {
  for (const flow of Object.values(document.flows)) {
    for (const block of flow.blocks) {
      if (block.kind !== 'table' || !block.table || block.table.body.length === 0) continue;
      const placedUntil = seenTableRows.get(block.id) ?? 0;
      if (placedUntil !== block.table.body.length) pushEvaluationError(diagnostics, 'TABLE_NOT_FULLY_PLACED', 'Table ' + block.id + ' has ' + (block.table.body.length - placedUntil) + ' unplaced row(s).', { flowId: flow.id, blockId: block.id, placedUntil, rowCount: block.table.body.length });
    }
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateUnplacedAtomicBlocks implementation intact until its target seam is extracted.
 */
export function validateUnplacedAtomicBlocks(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const flow of Object.values(document.flows)) {
    for (const block of flow.blocks) {
      if (!block.atomic) continue;
      if (plan.blockPlacements.every((placement) => placement.blockId !== block.id)) pushEvaluationError(diagnostics, 'ATOMIC_BLOCK_NOT_FULLY_PLACED', 'Atomic block ' + block.id + ' has no planned placement.', { blockId: block.id, flowId: flow.id });
    }
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateResidualContent implementation intact until its target seam is extracted.
 */
export function validateResidualContent(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const residual of plan.residualContent) pushEvaluationError(diagnostics, 'RESIDUAL_CONTENT', 'Flow ' + residual.flowId + ' still contains content from ' + residual.blockId + '.', { flowId: residual.flowId, blockId: residual.blockId, remaining: residual.remaining ?? null, remainingRows: residual.remainingRows ?? null });
}

type ContentRange = { start: number; end: number };

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current contentRangesForBlock implementation intact until its target seam is extracted.
 */
export function contentRangesForBlock(plan: CompositionPlan, flowId: string, blockId: string, page?: number): ContentRange[] {
  return allLines(plan).filter((line) => line.flowId === flowId && line.blockId === blockId && (page === undefined || line.page === page)).map((line) => ({ start: line.startWord, end: line.endWord })).sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateRepeatedBlockCoverage implementation intact until its target seam is extracted.
 */
export function validateRepeatedBlockCoverage(flowId: string, block: CompositionBlock, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const wordCount = wordCountOf(block.text);
  const pages = [...new Set(allLines(plan).filter((line) => line.flowId === flowId && line.blockId === block.id).map((line) => line.page))];
  for (const page of pages) {
    const pageRanges = contentRangesForBlock(plan, flowId, block.id, page);
    let pageExpected = 0;
    for (const range of pageRanges) {
      if (range.start !== pageExpected) {
        pushEvaluationError(diagnostics, 'CONTENT_COVERAGE_GAP', 'Repeated block ' + block.id + ' in flow ' + flowId + ' is not covered continuously on page ' + page + '.', { flowId, blockId: block.id, page, expected: pageExpected, actual: range });
        break;
      }
      pageExpected = range.end;
    }
    if (pageExpected !== wordCount) pushEvaluationError(diagnostics, 'CONTENT_COVERAGE_GAP', 'Repeated block ' + block.id + ' in flow ' + flowId + ' is incomplete on page ' + page + '.', { flowId, blockId: block.id, page, expected: wordCount, actual: pageExpected });
  }
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateOrdinaryBlockCoverage implementation intact until its target seam is extracted.
 */
export function validateOrdinaryBlockCoverage(flowId: string, block: CompositionBlock, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const wordCount = wordCountOf(block.text);
  const ranges = contentRangesForBlock(plan, flowId, block.id);
  let expected = 0;
  for (const range of ranges) {
    if (range.start !== expected) {
      pushEvaluationError(diagnostics, 'CONTENT_COVERAGE_GAP', 'Block ' + block.id + ' in flow ' + flowId + ' is not covered continuously.', { flowId, blockId: block.id, expected, actual: range });
      break;
    }
    if (range.end <= range.start || range.end > wordCount) {
      pushEvaluationError(diagnostics, 'CONTENT_RANGE_INVALID', 'Block ' + block.id + ' in flow ' + flowId + ' has an invalid planned word range.', { flowId, blockId: block.id, range, wordCount });
      break;
    }
    expected = range.end;
  }
  if (expected !== wordCount) pushEvaluationError(diagnostics, 'CONTENT_NOT_FULLY_PLACED', 'Block ' + block.id + ' in flow ' + flowId + ' has ' + (wordCount - expected) + ' unplaced word(s).', { flowId, blockId: block.id, placedUntil: expected, wordCount });
}

/**
 * @planner-target composition/evaluation/content.ts
 * @planner-responsibility Keep the current validateContentCoverage implementation intact until its target seam is extracted.
 */
export function validateContentCoverage(document: CompositionDocument, plan: CompositionPlan, repeatedFlows: Set<string>, diagnostics: CompositionDiagnostic[]): void {
  for (const [flowId, flow] of Object.entries(document.flows)) {
    for (const block of flow.blocks) {
      if (wordCountOf(block.text) === 0) continue;
      if (repeatedFlows.has(flowId)) validateRepeatedBlockCoverage(flowId, block, plan, diagnostics);
      else validateOrdinaryBlockCoverage(flowId, block, plan, diagnostics);
    }
  }
}
