import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionTemplate,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { routeLayout } from './page-state.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { measureInsertionText } from './insertion-measurement.js';

type InsertionSlotCandidate = {
  page: number;
  slotId: string;
  box: CompositionRect;
};

function insertionSlotCandidates(
  template: CompositionTemplate,
  route: CompositionFlowRoute,
): InsertionSlotCandidate[] {
  if (!route.insertionSlots?.length) return [];
  const candidates: InsertionSlotCandidate[] = [];
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    if (!layout) continue;
    for (const slotId of route.insertionSlots) {
      const slot = layout.slots.find((candidate) => candidate.id === slotId && candidate.allowedRoles?.includes('quote'));
      if (slot) candidates.push({ page, slotId, box: { ...slot.box } });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x);
}

function fitInsertionProposal(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  proposal: PlannedInsertion,
): PlannedInsertion {
  const flow = document.flows[proposal.flowId];
  const block = flow?.blocks.find((candidate) => candidate.id === proposal.blockId);
  const route = template.routes[proposal.flowId];
  const layout = route ? routeLayout(route, template, proposal.page) : undefined;
  const definition = layout?.slots.find((candidate) => candidate.id === proposal.slotId && candidate.allowedRoles?.includes('quote'));
  if (!block || !definition?.fitContent) return proposal;
  const measurement = measureInsertionText(metrics, definition, proposal.box, block);
  if (measurement.lines.length === 0) return proposal;
  const contentHeight = (measurement.lines.at(-1)!.lineOffset + 1) * measurement.leading;
  const maximumHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : proposal.box.height;
  return {
    ...proposal,
    box: {
      ...proposal.box,
      height: Math.min(maximumHeight, measurement.padding.top + contentHeight + measurement.padding.bottom),
    },
  };
}

/** Reconstruct insertion proposals from a previous plan. */
export function insertionProposalsFromPlan(
  document: CompositionDocument,
  template: CompositionTemplate,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const candidates = insertionSlotCandidates(template, route);
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    const placedItems = [
      ...plan.lines.filter((line) => line.flowId === flowId && line.layer !== 'insertion'),
      ...plan.blockPlacements.filter((placement) => blockIndexes.has(placement.blockId)),
      ...plan.tablePlacements.filter((placement) => blockIndexes.has(placement.blockId)),
    ];
    let previousCandidateIndex = -1;
    for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
      const quoteIndex = blockIndexes.get(block.id) ?? Number.POSITIVE_INFINITY;
      const line = plan.lines
        .filter((candidate) => candidate.flowId === flowId && candidate.blockId === block.id)
        .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0];
      const predecessorBottom = placedItems
        .filter((item) => (blockIndexes.get(item.blockId) ?? Number.POSITIVE_INFINITY) < quoteIndex)
        .reduce<{ page: number; bottom: number } | undefined>((latest, item) => {
          const bottom = item.box.y + item.box.height;
          if (!latest || item.page > latest.page || (item.page === latest.page && bottom > latest.bottom)) return { page: item.page, bottom };
          return latest;
        }, undefined);
      const currentIndex = line
        ? candidates.findIndex((candidate) => candidate.page === line.page && candidate.slotId === line.slotId.replace(/^\d+:/u, ''))
        : -1;
      const earliestIndex = Math.max(previousCandidateIndex + 1, currentIndex, 0);
      const selectedIndex = candidates.findIndex((candidate, index) => index >= earliestIndex
        && (!predecessorBottom || candidate.page > predecessorBottom.page || (candidate.page === predecessorBottom.page && candidate.box.y >= predecessorBottom.bottom - Number.EPSILON)));
      const selected = selectedIndex >= 0 ? candidates[selectedIndex] : undefined;
      if (!selected) continue;
      proposals.set(insertionKey(flowId, block.id), fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...selected }));
      previousCandidateIndex = selectedIndex;
    }
  }
  return proposals;
}

/** Seed hard insertion proposals in authored reading order. */
export function seedInsertionProposals(
  document: CompositionDocument,
  template: CompositionTemplate,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const candidates = insertionSlotCandidates(template, route);
    const quoteBlocks = flow.blocks.filter((block) => block.role === 'quote');
    quoteBlocks.forEach((block, index) => {
      const candidate = candidates[index];
      if (!candidate) return;
      proposals.set(insertionKey(flowId, block.id), fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate }));
    });
  }
  return proposals;
}

/** Find the next planned insertion that must remain below current text. */
export function nextInsertionProposal(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): PlannedInsertion | undefined {
  if ((flow.insertionSlots?.length ?? 0) === 0) return undefined;
  return blocks
    .slice(blockIndex + 1)
    .filter((block) => block.role === 'quote')
    .map((block) => proposals.get(insertionKey(flowId, block.id)))
    .filter((proposal): proposal is PlannedInsertion => proposal !== undefined && proposal.page === page && proposal.box.y > afterY + Number.EPSILON)
    .sort((left, right) => left.box.y - right.box.y)[0];
}

/** Return the next insertion's vertical boundary, if one exists. */
export function nextInsertionBoundary(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): number | undefined {
  return nextInsertionProposal(flow, blocks, blockIndex, page, proposals, flowId, afterY)?.box.y;
}
