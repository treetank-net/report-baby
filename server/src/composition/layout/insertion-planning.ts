import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionLayout,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { routeLayout } from './page-state.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { insertionContentHeight, insertionContentIsComplete, measureInsertionContent } from './insertion-measurement.js';
import { isAtomicBlock } from './page-state.js';
import { rectsOverlap } from '../geometry/rectangles.js';

type InsertionSlotCandidate = {
  page: number;
  slotId: string;
  box: CompositionRect;
};

function insertionProposalCanFollow(previous: PlannedInsertion | undefined, candidate: PlannedInsertion): boolean {
  if (!previous || candidate.page !== previous.page) return true;
  return !rectsOverlap(previous.box, candidate.box);
}

function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

/**
 * An insertion slot is an explicit content seam.  Its role/kind/id filters
 * decide which non-main blocks may enter it; the route itself decides that
 * the block is painted as an obstacle rather than as an ordinary flow.
 */
export function insertionSlotAcceptsBlock(
  definition: CompositionLayout['pageTemplates'][number]['slots'][number],
  flowId: string,
  block: CompositionBlock,
): boolean {
  if (definition.kind === 'graphic' || definition.reserved) return false;
  if (definition.flowId !== undefined && definition.flowId !== flowId) return false;
  if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) return false;
  if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) return false;
  if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) return false;
  if (definition.kind === 'block') return isAtomicBlock(block) || block.kind === 'table';
  return true;
}

function insertionSlotDefinitions(
  template: CompositionLayout,
  route: CompositionFlowRoute,
): CompositionLayout['pageTemplates'][number]['slots'] {
  const definitions = new Map<string, CompositionLayout['pageTemplates'][number]['slots'][number]>();
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    for (const slotId of route.insertionSlots ?? []) {
      const slot = layout?.slots.find((candidate) => candidate.id === slotId);
      if (slot) definitions.set(slot.id, slot);
    }
  }
  return [...definitions.values()];
}

/** Return blocks explicitly claimed by insertion slots in a named flow. */
export function insertionBlocksForFlow(
  template: CompositionLayout,
  flowId: string,
  blocks: CompositionBlock[],
): CompositionBlock[] {
  if (flowId === 'main') return [];
  const route = template.routes[flowId];
  if (!route?.insertionSlots?.length) return [];
  const definitions = insertionSlotDefinitions(template, route);
  return blocks.filter((block) => definitions.some((definition) => insertionSlotAcceptsBlock(definition, flowId, block)));
}

function insertionSlotCandidates(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  block?: CompositionBlock,
): InsertionSlotCandidate[] {
  if (!route.insertionSlots?.length) return [];
  const candidates: InsertionSlotCandidate[] = [];
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    if (!layout) continue;
    for (const slotId of route.insertionSlots) {
      const slot = layout.slots.find((candidate) => candidate.id === slotId && (block === undefined || insertionSlotAcceptsBlock(candidate, flowId, block)));
      if (slot) candidates.push({ page, slotId, box: { ...slot.box } });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x || left.slotId.localeCompare(right.slotId));
}

function candidateSupportsBlock(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  candidate: InsertionSlotCandidate,
  block: CompositionBlock,
): boolean {
  const layout = routeLayout(route, template, candidate.page);
  const definition = layout?.slots.find((slot) => slot.id === candidate.slotId);
  return definition !== undefined && insertionSlotAcceptsBlock(definition, flowId, block);
}

function fitInsertionProposal(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  proposal: PlannedInsertion,
): PlannedInsertion {
  const flow = document.flows[proposal.flowId];
  const block = flow?.blocks.find((candidate) => candidate.id === proposal.blockId);
  const route = template.routes[proposal.flowId];
  const layout = route ? routeLayout(route, template, proposal.page) : undefined;
  if (!block) return proposal;
  const definition = layout?.slots.find((candidate) => candidate.id === proposal.slotId && insertionSlotAcceptsBlock(candidate, proposal.flowId, block));
  if (!definition?.fitContent) return proposal;
  let measurement: ReturnType<typeof measureInsertionContent>;
  try {
    measurement = measureInsertionContent(metrics, definition, proposal.box, block);
  } catch {
    return proposal;
  }
  if (!measurement || insertionContentHeight(measurement) <= 0 || (measurement.kind === 'table' && !insertionContentIsComplete(measurement, block))) return proposal;
  const contentHeight = insertionContentHeight(measurement);
  const maximumHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : proposal.box.height;
  return {
    ...proposal,
    box: {
      ...proposal.box,
      height: Math.min(maximumHeight, contentHeight),
    },
  };
}

/** Reconstruct insertion proposals from a previous plan. */
export function insertionProposalsFromPlan(
  document: CompositionDocument,
  template: CompositionLayout,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const insertionBlocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    const candidates = insertionSlotCandidates(template, route, flowId);
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    const placedItems = [
      ...plan.lines.filter((line) => line.flowId === flowId && line.layer !== 'insertion'),
      ...plan.blockPlacements.filter((placement) => blockIndexes.has(placement.blockId)),
      ...plan.tablePlacements.filter((placement) => blockIndexes.has(placement.blockId)),
    ];
    let previousCandidateIndex = -1;
    let previousProposal: PlannedInsertion | undefined;
    for (const block of insertionBlocks) {
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
      const placed = line
        ?? plan.blockPlacements
          .filter((candidate) => candidate.blockId === block.id)
          .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0]
        ?? plan.tablePlacements
          .filter((candidate) => candidate.blockId === block.id)
          .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0];
      const currentIndex = placed
        ? candidates.findIndex((candidate) => candidate.page === placed.page && candidate.slotId === placed.slotId.replace(/^\d+:/u, '') && candidateSupportsBlock(template, route, flowId, candidate, block))
        : -1;
      const earliestIndex = Math.max(previousCandidateIndex + 1, currentIndex, 0);
      let selectedIndex = -1;
      let selected: PlannedInsertion | undefined;
      for (let index = earliestIndex; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (!candidateSupportsBlock(template, route, flowId, candidate, block)) continue;
        if (predecessorBottom && !(candidate.page > predecessorBottom.page || (candidate.page === predecessorBottom.page && candidate.box.y >= predecessorBottom.bottom - Number.EPSILON))) continue;
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        if (!insertionProposalCanFollow(previousProposal, proposal)) continue;
        selectedIndex = index;
        selected = proposal;
        break;
      }
      if (selectedIndex < 0 || !selected) continue;
      proposals.set(insertionKey(flowId, block.id), selected);
      previousCandidateIndex = selectedIndex;
      previousProposal = selected;
    }
  }
  return proposals;
}

/** Seed hard insertion proposals in authored reading order. */
export function seedInsertionProposals(
  document: CompositionDocument,
  template: CompositionLayout,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const insertionBlocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    const candidates = insertionSlotCandidates(template, route, flowId);
    let previousCandidateIndex = -1;
    let previousProposal: PlannedInsertion | undefined;
    insertionBlocks.forEach((block) => {
      let selectedIndex = -1;
      let selectedProposal: PlannedInsertion | undefined;
      for (let index = previousCandidateIndex + 1; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (!candidateSupportsBlock(template, route, flowId, candidate, block)) continue;
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        if (!insertionProposalCanFollow(previousProposal, proposal)) continue;
        selectedIndex = index;
        selectedProposal = proposal;
        break;
      }
      if (selectedIndex < 0 || !selectedProposal) return;
      proposals.set(insertionKey(flowId, block.id), selectedProposal);
      previousCandidateIndex = selectedIndex;
      previousProposal = selectedProposal;
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
