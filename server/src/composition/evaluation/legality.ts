import type { CompositionBlock, CompositionDocument } from '../contracts/model.js';

import type { CompositionDiagnostic, CompositionPlan, CompositionSlot } from '../contracts/engine-contracts.js';

import {
  allLines,
  itemFlowIdForPlacedItem,
  plannerFoundNoUsableLine,
  slotFor,
} from './plan-queries.js';
import { fitsInside, geometryTolerance, lineEntersGraphic, overlaps, usableLinesAfter } from './legality-geometry.js';
import { pushEvaluationError } from './diagnostics.js';

import {
  buildFlowPlacementRegistry,
  validateEmptyFlowPlacements,
  validateUnplacedAtomicBlocks,
  validateUnplacedTables,
} from './content.js';

type UnderfilledFlowItem = {
  blockId: string;
  slotId: string;
  page: number;
  routeIndex?: number;
  flowId?: string;
  box: { x: number; y: number; width: number; height: number };
  startWord?: number;
};



/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate declared flow placements and fallback empty-slot continuity.
 */
export function checkEmptyFlowPlacements(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  if (plan.flowPlacements) {
    for (const placement of plan.flowPlacements) {
      validateDeclaredFlowPlacement(placement, plan, blockFlowIds, diagnostics);
    }
  }
  validateEmptyFlowPlacements(buildFlowPlacementRegistry(document, plan), diagnostics);
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate one declared flow placement and its content projection.
 */
export function validateDeclaredFlowPlacement(
  placement: NonNullable<CompositionPlan['flowPlacements']>[number],
  plan: CompositionPlan,
  blockFlowIds: Map<string, string>,
  diagnostics: CompositionDiagnostic[],
): void {
  const slot = slotFor(plan, placement.slotId);
  if (!slot) {
    pushEvaluationError(diagnostics, 'FLOW_PLACEMENT_TARGET_MISSING', 'Flow placement ' + placement.id + ' targets missing slot ' + placement.slotId + '.', { flowId: placement.flowId, page: placement.page, slotId: placement.slotId });
  } else if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) {
    pushEvaluationError(diagnostics, 'FLOW_PLACEMENT_OUTSIDE_SLOT', 'Flow placement ' + placement.id + ' leaves slot ' + slot.id + '.', { flowId: placement.flowId, page: placement.page, slotId: placement.slotId });
  }
  const lines = allLines(plan).filter((line) => line.flowId === placement.flowId && line.slotId === placement.slotId);
  const actualBlockIds = new Set(lines.map((line) => line.blockId));
  for (const item of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    const flowId = 'flowId' in item ? item.flowId : blockFlowIds.get(item.blockId);
    if (flowId === placement.flowId && item.slotId === placement.slotId) actualBlockIds.add(item.blockId);
  }
  const expectedBlockIds = [...actualBlockIds].sort();
  const declaredBlockIds = [...new Set(placement.blockIds)].sort();
  if (placement.hasContent !== (expectedBlockIds.length > 0)
    || placement.lineCount !== lines.length
    || JSON.stringify(declaredBlockIds) !== JSON.stringify(expectedBlockIds)) {
    pushEvaluationError(diagnostics, 'FLOW_PLACEMENT_CONTENT_MISMATCH', 'Flow placement ' + placement.id + ' does not match the content actually assigned to its slot.', {
      flowId: placement.flowId,
      page: placement.page,
      slotId: placement.slotId,
      details: {
        declared: { hasContent: placement.hasContent, lineCount: placement.lineCount, blockIds: declaredBlockIds },
        actual: { hasContent: expectedBlockIds.length > 0, lineCount: lines.length, blockIds: expectedBlockIds },
      },
    });
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current checkFlowBarrierBoxCandidates implementation intact until its target seam is extracted.
 */
export function checkFlowBarrierBoxCandidates(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const candidate of plan.flowBarrierBoxCandidates ?? []) {
    if (candidate.box.width <= 0 || candidate.box.height <= 0) {
      pushEvaluationError(diagnostics,
        'FLOW_BARRIER_CANDIDATE_INVALID',
        `Flow barrier candidate '${candidate.id}' has no usable geometry.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId },
      );
      continue;
    }
    const placement = plan.flowPlacements?.find((item) => item.id === candidate.placementId && item.page === candidate.page);
    if (!placement) {
      pushEvaluationError(diagnostics,
        'FLOW_BARRIER_CANDIDATE_PLACEMENT_MISSING',
        `Flow barrier candidate '${candidate.id}' references missing placement '${candidate.placementId}'.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId },
      );
    } else if (!fitsInside(candidate.box, placement.box)) {
      pushEvaluationError(diagnostics,
        'FLOW_BARRIER_CANDIDATE_OUTSIDE_PLACEMENT',
        `Flow barrier candidate '${candidate.id}' leaves flow placement '${placement.id}'.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: placement.slotId },
      );
    }
    for (const sourceId of [candidate.previousSourceId, candidate.nextSourceId].filter((value): value is string => value !== undefined)) {
      const source = plan.graphicPlacements.find((graphic) => graphic.page === candidate.page && (graphic.graphicId === sourceId || graphic.id === sourceId));
      if (!source) {
        pushEvaluationError(diagnostics,
          'FLOW_BARRIER_CANDIDATE_SOURCE_MISSING',
          `Flow barrier candidate '${candidate.id}' references missing obstacle '${sourceId}'.`,
          { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId, details: { sourceId } },
        );
      } else if (source.wrap !== 'around') {
        pushEvaluationError(diagnostics,
          'FLOW_BARRIER_CANDIDATE_SOURCE_NOT_WRAPPING',
          `Flow barrier candidate '${candidate.id}' references non-wrapping obstacle '${sourceId}'.`,
          { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId, details: { sourceId } },
        );
      }
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current checkEarlyRouteTransitions implementation intact until its target seam is extracted.
 */
export function checkEarlyRouteTransitions(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const minimum = plan.minimumFragmentLines;
  if (minimum === undefined || !Number.isInteger(minimum) || minimum <= 0) return;
  const byFlowAndPage = new Map<string, CompositionPlan['lines']>();
  const sourceBlocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  for (const line of allLines(plan)) {
    if (line.routeIndex === undefined) continue;
    const key = `${line.flowId}:${line.page}`;
    byFlowAndPage.set(key, [...(byFlowAndPage.get(key) ?? []), line]);
  }
  for (const [key, lines] of byFlowAndPage) {
    const ordered = [...lines].sort((left, right) => (left.routeIndex ?? 0) - (right.routeIndex ?? 0) || left.box.y - right.box.y || left.box.x - right.box.x);
    const routeGroups = new Map<number, CompositionPlan['lines']>();
    for (const line of ordered) routeGroups.set(line.routeIndex!, [...(routeGroups.get(line.routeIndex!) ?? []), line]);
    const routeIndexes = [...routeGroups.keys()].sort((left, right) => left - right);
    for (let index = 1; index < routeIndexes.length; index += 1) {
      const previousLines = routeGroups.get(routeIndexes[index - 1])!;
      const nextLines = routeGroups.get(routeIndexes[index])!;
      const previous = [...previousLines].sort((left, right) => left.box.y - right.box.y).at(-1)!;
      const slot = slotFor(plan, previous.slotId);
      if (!slot || slot.regionId !== 'content') continue;
      const previousBlock = sourceBlocks.get(previous.blockId);
      if (previousBlock?.role === 'intro' || previousBlock?.role === 'title' || previousBlock?.role === 'subtitle') continue;
      const nextLineHeight = nextLines.find((line) => line.box.height > 0)?.box.height ?? previous.box.height;
      const usable = usableLinesAfter(previous, slot, plan.graphicPlacements, nextLineHeight);
      if (plannerFoundNoUsableLine(plan, nextLines[0].blockId, previous.slotId, minimum)) continue;
      if (usable < minimum) continue;
      pushEvaluationError(diagnostics,
        'FLOW_FRAGMENT_UNDERFILLED',
        `Flow '${key.split(':')[0]}' advanced to route segment ${routeIndexes[index]} while ${usable} usable line(s) remained in '${previous.slotId}'.`,
        {
          flowId: key.split(':')[0],
          page: previous.page,
          slotId: previous.slotId,
          details: {
            previousRouteIndex: routeIndexes[index - 1],
            nextRouteIndex: routeIndexes[index],
            nextSlotId: nextLines[0].slotId,
            usableLines: usable,
            minimumFragmentLines: minimum,
          },
        },
      );
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current blockMatchesSlot implementation intact until its target seam is extracted.
 */
export function blockMatchesSlot(block: CompositionDocument['flows'][string]['blocks'][number], slot: CompositionSlot): boolean {
  if (slot.allowedRoles && !slot.allowedRoles.includes(block.role)) return false;
  if (slot.allowedBlockKinds && !slot.allowedBlockKinds.includes(block.kind)) return false;
  if (slot.allowedBlockIds && !slot.allowedBlockIds.some((id) => block.id === id || block.id.startsWith(`${id}:`))) return false;
  if (slot.kind === 'block' && !block.atomic && block.kind !== 'table') return false;
  if (block.kind === 'table' && slot.kind !== 'block') return false;
  if ((block.kind === 'metric' || block.kind === 'chart') && slot.kind !== 'block') return false;
  if (slot.kind === 'graphic') return false;
  return true;
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Collect all material that can advance a flow.
 */
export function underfilledFlowItems(document: CompositionDocument, plan: CompositionPlan): UnderfilledFlowItem[] {
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  return [
    ...allLines(plan).map((line) => ({ ...line, flowId: line.flowId })),
    ...plan.blockPlacements.map((placement) => ({ ...placement, flowId: blockFlowIds.get(placement.blockId) })),
    ...plan.tablePlacements.map((placement) => ({ ...placement, flowId: blockFlowIds.get(placement.blockId) })),
  ];
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Find the next authored block that can occupy a slot.
 */
export function nextAuthoredBlockForSlot(
  flow: CompositionDocument['flows'][string],
  slot: CompositionSlot,
  flowItems: UnderfilledFlowItem[],
  blockIndexes: Map<string, number>,
  slotItems: UnderfilledFlowItem[],
): CompositionBlock | undefined {
  const laterItems = flowItems.filter((item) => item.page > slot.page || (item.page === slot.page && (item.routeIndex ?? Number.NEGATIVE_INFINITY) > slot.routeIndex!));
  const firstLaterIndex = laterItems
    .map((item) => blockIndexes.get(item.blockId))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => left - right)[0];
  const hasEarlierFlowMaterial = firstLaterIndex !== undefined && flowItems.some((item) => {
    const index = blockIndexes.get(item.blockId);
    return index !== undefined && index < firstLaterIndex;
  });
  if (!hasEarlierFlowMaterial) return undefined;
  const authoredItems = slotItems.length > 0
    ? slotItems
    : flowItems.filter((item) => item.page < slot.page || (item.page === slot.page && (item.routeIndex ?? Number.NEGATIVE_INFINITY) < slot.routeIndex!));
  const lastAuthoredIndex = authoredItems
    .map((item) => blockIndexes.get(item.blockId))
    .filter((index): index is number => index !== undefined)
    .sort((left, right) => right - left)[0] ?? -1;
  return flow.blocks.find((block, index) => index > lastAuthoredIndex && blockMatchesSlot(block, slot) && block.role !== 'quote');
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Decide whether an empty slot is fully blocked by a wrapping obstacle.
 */
export function slotIsFullyCoveredByObstacle(slot: CompositionSlot, plan: CompositionPlan): boolean {
  return plan.graphicPlacements.some((graphic) => graphic.page === slot.page
    && graphic.wrap === 'around'
    && fitsInside(slot.box, graphic.box));
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Report an empty text slot skipped before later flow material.
 */
export function validateEmptyFlowSlot(
  flow: CompositionDocument['flows'][string],
  slot: CompositionSlot,
  page: { page: number },
  laterItems: UnderfilledFlowItem[],
  nextAuthoredBlock: CompositionBlock,
  minimum: number,
  diagnostics: CompositionDiagnostic[],
): void {
  const nextLine = laterItems.find((item) => item.box.height > 0);
  const lineHeight = nextLine?.box.height ?? slot.box.height;
  const availableLines = Math.floor(slot.box.height / lineHeight);
  if (availableLines < minimum) return;
  pushEvaluationError(diagnostics, 'EMPTY_FLOW_SLOT', 'Flow ' + flow.id + ' skips empty slot ' + slot.id + ' while later content is placed (next authored block: ' + (nextAuthoredBlock.id || 'unknown') + ').', {
    flowId: flow.id,
    page: page.page,
    slotId: slot.id,
    details: {
      routeIndex: slot.routeIndex,
      availableLines,
      minimumFragmentLines: minimum,
      nextSlotId: laterItems[0].slotId,
      nextPage: laterItems[0].page,
    },
  });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Report usable capacity left in a partially filled text slot.
 */
export function validateUnderfilledFlowSlot(
  flow: CompositionDocument['flows'][string],
  slot: CompositionSlot,
  laterItems: UnderfilledFlowItem[],
  last: UnderfilledFlowItem,
  nextAuthoredBlock: CompositionBlock,
  plan: CompositionPlan,
  minimum: number,
  diagnostics: CompositionDiagnostic[],
): void {
  if (last.flowId === undefined || last.startWord === undefined) return;
  const nextLineHeight = laterItems.find((item) => item.box.height > 0)?.box.height ?? last.box.height;
  const usable = usableLinesAfter(last as CompositionPlan['lines'][number], slot, plan.graphicPlacements, nextLineHeight);
  if (plannerFoundNoUsableLine(plan, nextAuthoredBlock.id, slot.id, minimum) || usable < minimum) return;
  pushEvaluationError(diagnostics, 'FLOW_SLOT_UNDERFILLED', 'Flow ' + flow.id + ' leaves ' + usable + ' usable line(s) in ' + slot.id + ' before later content.', {
    flowId: flow.id,
    page: slot.page,
    slotId: slot.id,
    details: {
      routeIndex: slot.routeIndex,
      usableLines: usable,
      minimumFragmentLines: minimum,
      nextSlotId: laterItems[0].slotId,
      nextPage: laterItems[0].page,
    },
  });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Check one text slot for illegal empty or underfilled continuation.
 */
export function validateFlowSlotContinuity(
  flow: CompositionDocument['flows'][string],
  page: { page: number },
  slot: CompositionSlot,
  flowItems: UnderfilledFlowItem[],
  blockIndexes: Map<string, number>,
  plan: CompositionPlan,
  minimum: number,
  diagnostics: CompositionDiagnostic[],
): void {
  if (slot.allowedRoles?.includes('quote')) return;
  const laterItems = flowItems.filter((item) => item.page > page.page || (item.page === page.page && (item.routeIndex ?? Number.NEGATIVE_INFINITY) > slot.routeIndex!));
  if (laterItems.length === 0) return;
  const hasEligibleLaterBlock = laterItems.some((item) => {
    const block = flow.blocks.find((candidate) => candidate.id === item.blockId);
    return block !== undefined && blockMatchesSlot(block, slot);
  });
  if (!hasEligibleLaterBlock) return;
  const slotItems = flowItems.filter((item) => item.slotId === slot.id);
  const nextAuthoredBlock = nextAuthoredBlockForSlot(flow, slot, flowItems, blockIndexes, slotItems);
  if (!nextAuthoredBlock || slotIsFullyCoveredByObstacle(slot, plan)) return;
  if (slotItems.length === 0) {
    validateEmptyFlowSlot(flow, slot, page, laterItems, nextAuthoredBlock, minimum, diagnostics);
    return;
  }
  const last = [...slotItems].sort((left, right) => left.box.y - right.box.y).at(-1)!;
  validateUnderfilledFlowSlot(flow, slot, laterItems, last, nextAuthoredBlock, plan, minimum, diagnostics);
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate empty and underfilled text slots across all flows and pages.
 */
export function checkEmptyAndUnderfilledSlots(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const minimum = plan.minimumFragmentLines ?? 1;
  if (!Number.isInteger(minimum) || minimum <= 0) return;
  const items = underfilledFlowItems(document, plan);
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (plan.repeatFlowIds?.includes(flowId)) continue;
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    const flowItems = items.filter((item) => item.flowId === flowId);
    for (const page of plan.pages) {
      const pageSlots = plan.slots.filter((slot) => slot.page === page.page && slot.flowId === flowId && slot.routeIndex !== undefined && slot.kind === 'text');
      for (const slot of pageSlots) validateFlowSlotContinuity(flow, page, slot, flowItems, blockIndexes, plan, minimum, diagnostics);
    }
  }
}

type InsertionQuoteGeometry = {
  page: number;
  box: { x: number; y: number; width: number; height: number };
};

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Resolve the physical obstacle geometry for one insertion quote.
 */
function insertionQuoteGeometry(
  quoteLines: CompositionPlan['lines'],
  quoteGraphic: CompositionPlan['graphicPlacements'][number],
): InsertionQuoteGeometry {
  const quoteBox = quoteGraphic.box ?? quoteLines.reduce((box, line) => ({
    x: Math.min(box.x, line.box.x),
    y: Math.min(box.y, line.box.y),
    width: Math.max(box.x + box.width, line.box.x + line.box.width) - Math.min(box.x, line.box.x),
    height: Math.max(box.y + box.height, line.box.y + line.box.height) - Math.min(box.y, line.box.y),
  }), { ...quoteLines[0].box });
  return { page: quoteGraphic.page ?? quoteLines[0].page, box: quoteBox };
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Report source content that appears after its insertion obstacle.
 */
function validateInsertionPredecessorOrder(
  flowId: string,
  quoteId: string,
  geometry: InsertionQuoteGeometry,
  predecessors: Array<{ blockId: string; page: number; slotId: string; box: { x: number; y: number; width: number; height: number } }>,
  diagnostics: CompositionDiagnostic[],
): void {
  const predecessorAfterQuote = predecessors.find((item) => item.page > geometry.page || (item.page === geometry.page && item.box.y >= geometry.box.y + geometry.box.height));
  if (!predecessorAfterQuote) return;
  pushEvaluationError(diagnostics, 'INSERTION_SOURCE_ORDER_VIOLATION', 'Content preceding insertion ' + quoteId + ' is placed after its obstacle.', {
    flowId,
    blockId: quoteId,
    page: geometry.page,
    details: {
      predecessorBlockId: predecessorAfterQuote.blockId,
      predecessorPage: predecessorAfterQuote.page,
      predecessorY: predecessorAfterQuote.box.y,
      obstacleY: geometry.box.y,
      obstacleBottom: geometry.box.y + geometry.box.height,
    },
  });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Report source content that appears before its insertion obstacle.
 */
function validateInsertionSuccessorOrder(
  flowId: string,
  quoteId: string,
  geometry: InsertionQuoteGeometry,
  successors: Array<{ blockId: string; page: number; slotId: string; box: { x: number; y: number; width: number; height: number } }>,
  plan: CompositionPlan,
  diagnostics: CompositionDiagnostic[],
): void {
  const successorBeforeQuote = successors.find((item) => {
    if (item.page < geometry.page) return true;
    if (item.page !== geometry.page || item.box.y >= geometry.box.y) return false;
    const itemSlot = slotFor(plan, item.slotId);
    const laterColumn = itemSlot?.routeIndex !== undefined
      && item.box.x >= geometry.box.x + geometry.box.width / 2;
    return !laterColumn;
  });
  if (!successorBeforeQuote) return;
  pushEvaluationError(diagnostics, 'INSERTION_SOURCE_ORDER_VIOLATION', 'Content following insertion ' + quoteId + ' is placed before its obstacle.', {
    flowId,
    blockId: quoteId,
    page: geometry.page,
    details: {
      successorBlockId: successorBeforeQuote.blockId,
      successorPage: successorBeforeQuote.page,
      successorY: successorBeforeQuote.box.y,
      obstacleY: geometry.box.y,
    },
  });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate predecessor and successor ordering for one insertion quote.
 */
function validateQuoteInsertionOrder(
  flowId: string,
  quote: CompositionBlock,
  quoteIndex: number,
  plan: CompositionPlan,
  placedItems: Array<CompositionPlan['lines'][number] | CompositionPlan['blockPlacements'][number] | CompositionPlan['tablePlacements'][number]>,
  blockFlowIds: Map<string, string>,
  blockIndexes: Map<string, number>,
  diagnostics: CompositionDiagnostic[],
): void {
  const quoteLines = allLines(plan).filter((line) => line.flowId === flowId && line.blockId === quote.id);
  if (quoteLines.length === 0) return;
  const quoteGraphic = plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:' + quote.id);
  if (!quoteGraphic) return;
  const geometry = insertionQuoteGeometry(quoteLines, quoteGraphic);
  const predecessors = placedItems.filter((item) => itemFlowIdForPlacedItem(item, blockFlowIds) === flowId && (blockIndexes.get(item.blockId) ?? Number.POSITIVE_INFINITY) < quoteIndex);
  const successors = placedItems.filter((item) => itemFlowIdForPlacedItem(item, blockFlowIds) === flowId && (blockIndexes.get(item.blockId) ?? Number.NEGATIVE_INFINITY) > quoteIndex);
  validateInsertionPredecessorOrder(flowId, quote.id, geometry, predecessors, diagnostics);
  validateInsertionSuccessorOrder(flowId, quote.id, geometry, successors, plan, diagnostics);
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate insertion source order for every quote in every flow.
 */
export function checkInsertionSourceOrder(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const placedItems = [...allLines(plan), ...plan.blockPlacements, ...plan.tablePlacements];
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    for (const [quoteIndex, quote] of flow.blocks.entries()) {
      if (quote.role === 'quote') validateQuoteInsertionOrder(flowId, quote, quoteIndex, plan, placedItems, blockFlowIds, blockIndexes, diagnostics);
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Add document-level warnings to evaluator diagnostics.
 */
export function appendDocumentDiagnostics(document: CompositionDocument, diagnostics: CompositionDiagnostic[]): void {
  for (const message of document.diagnostics ?? []) {
    diagnostics.push({ severity: 'warning', code: 'DOCUMENT_DIAGNOSTIC', message });
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate every text line target, content range identity, and slot bounds.
 */
export function validateLineTargets(plan: CompositionPlan, repeatedFlows: Set<string>, diagnostics: CompositionDiagnostic[]): void {
  const seenLines = new Set<string>();
  for (const line of allLines(plan)) {
    const slot = slotFor(plan, line.slotId);
    if (!slot) {
      pushEvaluationError(diagnostics, 'LINE_TARGET_MISSING', 'Line for ' + line.blockId + ' targets missing slot ' + line.slotId + '.', { blockId: line.blockId, slotId: line.slotId });
      continue;
    }
    const key = line.flowId + ':' + line.blockId + ':' + line.startWord + ':' + line.endWord + (repeatedFlows.has(line.flowId) ? ':' + line.page : '');
    if (seenLines.has(key)) pushEvaluationError(diagnostics, 'DUPLICATE_CONTENT', 'Content range ' + key + ' was placed more than once.', { blockId: line.blockId, slotId: line.slotId });
    seenLines.add(key);
    if (line.page !== slot.page || !fitsInside(line.box, slot.box)) pushEvaluationError(diagnostics, 'LINE_OUTSIDE_SLOT', 'Line for ' + line.blockId + ' leaves slot ' + slot.id + '.', { blockId: line.blockId, slotId: slot.id, page: line.page });
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Detect overlapping text lines in a single slot.
 */
export function validateLineSlotOverlaps(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const planned = allLines(plan);
  for (let index = 0; index < planned.length; index += 1) {
    const line = planned[index];
    for (let other = index + 1; other < planned.length; other += 1) {
      const candidate = planned[other];
      if (line.page === candidate.page && line.slotId === candidate.slotId && overlaps(line.box, candidate.box)) pushEvaluationError(diagnostics, 'LINE_OVERLAP', 'Lines for ' + line.blockId + ' and ' + candidate.blockId + ' overlap in slot ' + line.slotId + '.', { slotId: line.slotId, page: line.page, firstBlockId: line.blockId, secondBlockId: candidate.blockId });
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Detect text lines entering wrapping graphic obstacles.
 */
export function validateLineGraphicOverlaps(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const line of allLines(plan)) {
    for (const graphic of plan.graphicPlacements) {
      if (graphic.page === line.page && graphic.slotId !== line.slotId && graphic.wrap === 'around' && lineEntersGraphic(line, graphic)) pushEvaluationError(diagnostics, 'LINE_GRAPHIC_OVERLAP', 'Line for ' + line.blockId + ' enters wrapping graphic ' + graphic.graphicId + '.', { blockId: line.blockId, graphicId: graphic.graphicId, slotId: line.slotId, page: line.page });
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Validate ordinary placement targets and bounds.
 */
export function validateBlockPlacementTargets(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const placement of plan.placements) {
    const slot = slotFor(plan, placement.slotId);
    if (!slot) {
      pushEvaluationError(diagnostics, 'PLACEMENT_TARGET_MISSING', 'Placement for ' + placement.blockId + ' targets missing slot ' + placement.slotId + '.', { blockId: placement.blockId, slotId: placement.slotId });
      continue;
    }
    if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) pushEvaluationError(diagnostics, 'PLACEMENT_OUTSIDE_SLOT', 'Placement for ' + placement.blockId + ' leaves slot ' + slot.id + '.', { blockId: placement.blockId, slotId: slot.id, page: placement.page });
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateTablePlacement implementation intact until its target seam is extracted.
 */
export function validateTablePlacement(placement: CompositionPlan['tablePlacements'][number], sourceBlocks: Map<string, CompositionBlock>, plan: CompositionPlan, seenTableRows: Map<string, number>, diagnostics: CompositionDiagnostic[]): void {
  const source = sourceBlocks.get(placement.blockId);
  const table = source?.kind === 'table' ? source.table : undefined;
  if (!source) pushEvaluationError(diagnostics, 'TABLE_SOURCE_MISSING', 'Table placement ' + placement.blockId + ' has no source block.', { blockId: placement.blockId, slotId: placement.slotId });
  else if (source.kind !== 'table' || !table) pushEvaluationError(diagnostics, 'TABLE_KIND_MISMATCH', 'Placement ' + placement.blockId + ' does not reference a table block.', { blockId: placement.blockId, slotId: placement.slotId });
  const slot = slotFor(plan, placement.slotId);
  if (!slot) pushEvaluationError(diagnostics, 'TABLE_PLACEMENT_TARGET_MISSING', 'Table placement ' + placement.blockId + ' targets missing slot ' + placement.slotId + '.', { blockId: placement.blockId, slotId: placement.slotId });
  else if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) pushEvaluationError(diagnostics, 'TABLE_PLACEMENT_OUTSIDE_SLOT', 'Table placement ' + placement.blockId + ' leaves slot ' + slot.id + '.', { blockId: placement.blockId, slotId: slot.id, page: placement.page });
  const rowCount = table?.body.length ?? 0;
  if (!Number.isInteger(placement.startRow) || !Number.isInteger(placement.endRow) || placement.startRow < 0 || placement.endRow <= placement.startRow || placement.endRow > rowCount) {
    pushEvaluationError(diagnostics, 'TABLE_ROW_RANGE_INVALID', 'Table placement ' + placement.blockId + ' has an invalid row range.', { blockId: placement.blockId, startRow: placement.startRow, endRow: placement.endRow, rowCount });
  } else {
    const expected = seenTableRows.get(placement.blockId) ?? 0;
    if (placement.startRow !== expected) pushEvaluationError(diagnostics, 'TABLE_ROW_COVERAGE_GAP', 'Table ' + placement.blockId + ' is not covered continuously by row fragments.', { blockId: placement.blockId, expected, actual: { start: placement.startRow, end: placement.endRow } });
    seenTableRows.set(placement.blockId, Math.max(expected, placement.endRow));
  }
  for (const line of allLines(plan)) if (line.page === placement.page && overlaps(line.box, placement.box)) pushEvaluationError(diagnostics, 'TABLE_TEXT_OVERLAP', 'Table ' + placement.blockId + ' overlaps text for ' + line.blockId + '.', { blockId: placement.blockId, secondBlockId: line.blockId, page: placement.page, slotId: placement.slotId });
  for (const other of plan.blockPlacements) if (other.page === placement.page && overlaps(other.box, placement.box)) pushEvaluationError(diagnostics, 'TABLE_BLOCK_OVERLAP', 'Table ' + placement.blockId + ' overlaps block ' + other.blockId + '.', { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateTableOverlaps implementation intact until its target seam is extracted.
 */
export function validateTableOverlaps(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const placement of plan.tablePlacements ?? []) {
    for (const other of plan.tablePlacements ?? []) {
      if (other === placement) break;
      if (other.page === placement.page && overlaps(other.box, placement.box)) pushEvaluationError(diagnostics, 'TABLE_OVERLAP', 'Table fragments ' + other.blockId + ' and ' + placement.blockId + ' overlap.', { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page });
    }
  }
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateTablePlacements implementation intact until its target seam is extracted.
 */
export function validateTablePlacements(document: CompositionDocument, plan: CompositionPlan, sourceBlocks: Map<string, CompositionBlock>, diagnostics: CompositionDiagnostic[]): void {
  const seenTableRows = new Map<string, number>();
  for (const placement of plan.tablePlacements ?? []) validateTablePlacement(placement, sourceBlocks, plan, seenTableRows, diagnostics);
  validateTableOverlaps(plan, diagnostics);
  validateUnplacedTables(document, seenTableRows, diagnostics);
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateAtomicPlacement implementation intact until its target seam is extracted.
 */
export function validateAtomicPlacement(placement: CompositionPlan['blockPlacements'][number], sourceBlocks: Map<string, CompositionBlock>, document: CompositionDocument, plan: CompositionPlan, seenAtomicBlocks: Set<string>, diagnostics: CompositionDiagnostic[]): void {
  const source = sourceBlocks.get(placement.blockId);
  if (!source) pushEvaluationError(diagnostics, 'BLOCK_SOURCE_MISSING', 'Atomic block placement ' + placement.blockId + ' has no source block.', { blockId: placement.blockId, slotId: placement.slotId });
  else {
    if (!source.atomic) pushEvaluationError(diagnostics, 'NON_ATOMIC_BLOCK_PLACED', 'Block ' + placement.blockId + ' is placed atomically but is not marked atomic.', { blockId: placement.blockId, slotId: placement.slotId });
    if (source.kind !== placement.kind) pushEvaluationError(diagnostics, 'BLOCK_KIND_MISMATCH', 'Placement for ' + placement.blockId + ' has kind ' + placement.kind + ', but its source kind is ' + source.kind + '.', { blockId: placement.blockId, slotId: placement.slotId });
    if (source.kind === 'image' && (!source.image || !document.assets?.some((asset) => asset.id === source.image?.assetId))) pushEvaluationError(diagnostics, 'IMAGE_ASSET_NOT_FOUND', 'Image block ' + placement.blockId + ' references a missing asset.', { blockId: placement.blockId, slotId: placement.slotId, details: { assetId: source.image?.assetId } });
  }
  if (seenAtomicBlocks.has(placement.blockId)) pushEvaluationError(diagnostics, 'DUPLICATE_BLOCK_PLACEMENT', 'Atomic block ' + placement.blockId + ' was placed more than once.', { blockId: placement.blockId, slotId: placement.slotId });
  seenAtomicBlocks.add(placement.blockId);
  const slot = slotFor(plan, placement.slotId);
  if (!slot) {
    pushEvaluationError(diagnostics, 'BLOCK_PLACEMENT_TARGET_MISSING', 'Atomic block ' + placement.blockId + ' targets missing slot ' + placement.slotId + '.', { blockId: placement.blockId, slotId: placement.slotId });
    return;
  }
  if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) pushEvaluationError(diagnostics, 'BLOCK_PLACEMENT_OUTSIDE_SLOT', 'Atomic block ' + placement.blockId + ' leaves slot ' + slot.id + '.', { blockId: placement.blockId, slotId: slot.id, page: placement.page });
  const wrappedImage = source?.kind === 'image' && (source.image?.wrap === 'left' || source.image?.wrap === 'right');
  for (const line of allLines(plan)) if (!wrappedImage && line.page === placement.page && overlaps(line.box, placement.box)) pushEvaluationError(diagnostics, 'BLOCK_TEXT_OVERLAP', 'Atomic block ' + placement.blockId + ' overlaps text for ' + line.blockId + '.', { blockId: placement.blockId, secondBlockId: line.blockId, page: placement.page, slotId: placement.slotId });
  for (const other of plan.blockPlacements) if (other !== placement && other.page === placement.page && overlaps(other.box, placement.box)) pushEvaluationError(diagnostics, 'BLOCK_OVERLAP', 'Atomic blocks ' + other.blockId + ' and ' + placement.blockId + ' overlap.', { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page });
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateAtomicPlacements implementation intact until its target seam is extracted.
 */
export function validateAtomicPlacements(document: CompositionDocument, plan: CompositionPlan, sourceBlocks: Map<string, CompositionBlock>, diagnostics: CompositionDiagnostic[]): void {
  const seenAtomicBlocks = new Set<string>();
  for (const placement of plan.blockPlacements) validateAtomicPlacement(placement, sourceBlocks, document, plan, seenAtomicBlocks, diagnostics);
  validateUnplacedAtomicBlocks(document, plan, diagnostics);
}

/**
 * @planner-target composition/evaluation/legality.ts
 * @planner-responsibility Keep the current validateGraphicPlacements implementation intact until its target seam is extracted.
 */
export function validateGraphicPlacements(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const graphic of plan.graphicPlacements) {
    if (graphic.assetId !== undefined && !document.assets?.some((asset) => asset.id === graphic.assetId)) pushEvaluationError(diagnostics, 'GRAPHIC_ASSET_NOT_FOUND', 'Graphic ' + graphic.graphicId + ' references missing asset ' + graphic.assetId + '.', { graphicId: graphic.graphicId, assetId: graphic.assetId });
    const slot = slotFor(plan, graphic.slotId);
    if (!slot) {
      pushEvaluationError(diagnostics, 'GRAPHIC_TARGET_MISSING', 'Graphic ' + graphic.graphicId + ' targets missing slot ' + graphic.slotId + '.', { graphicId: graphic.graphicId, slotId: graphic.slotId });
      continue;
    }
    if (graphic.page !== slot.page || !fitsInside(graphic.box, slot.box)) pushEvaluationError(diagnostics, 'GRAPHIC_OUTSIDE_SLOT', 'Graphic ' + graphic.graphicId + ' leaves slot ' + slot.id + '.', { graphicId: graphic.graphicId, slotId: slot.id, page: graphic.page });
  }
}
