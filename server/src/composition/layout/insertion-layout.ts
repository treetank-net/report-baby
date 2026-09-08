import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from '../model.js';
import type {
  CompositionPlan,
  CompositionSlot,
  CompositionTextMetrics,
} from '../engine.js';
import { diagnostic, addResidual } from '../planning-records.js';
import { ensurePage, routeLayout } from './page-state.js';
import { rectBottom } from '../geometry/rectangles.js';
import type { PageState } from '../contracts/layout-state.js';
import { lineHeight, textPadding, wrapBlock, wordsForBlock } from '../text/text-measurement.js';
import { placeLines } from '../text/text-placement.js';
import type { PlannedInsertion } from '../text-planner-candidates.js';

type InsertionTextMeasurement = {
  leading: number;
  padding: { top: number; bottom: number };
  lines: ReturnType<typeof wrapBlock>;
  wordCount: number;
  consumed: number;
};

/** Measure insertion text once so proposal fitting and placement share the same calculator. */
/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Keep the current measureInsertionText implementation intact until its target seam is extracted.
 */
function measureInsertionText(
  metrics: CompositionTextMetrics,
  definition: CompositionSlotTemplate,
  box: CompositionRect,
  block: CompositionBlock,
): InsertionTextMeasurement {
  const leading = lineHeight(metrics, block);
  const padding = textPadding(metrics, block);
  const measurementBox = definition.fitContent && definition.grow?.axis === 'y'
    ? { ...box, height: Math.max(box.height, definition.grow.maxHeight) }
    : box;
  const contentBox = {
    ...measurementBox,
    y: measurementBox.y + padding.top,
    height: Math.max(0, measurementBox.height - padding.top - padding.bottom),
  };
  const lines = wrapBlock(metrics, block, 0, contentBox, 0, rectBottom(contentBox), [], leading);
  return {
    leading,
    padding,
    lines,
    wordCount: wordsForBlock(block).length,
    consumed: lines.at(-1)?.endWord ?? 0,
  };
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Fit one insertion proposal to its measured content.
 */
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

type InsertionSlotCandidate = {
  page: number;
  slotId: string;
  box: CompositionRect;
};

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Enumerate quote-eligible insertion slots in reading order.
 */
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

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Reconstruct insertion proposals from a previous plan.
 */
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

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Seed hard insertion proposals in reading order.
 */
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

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Reserve one insertion obstacle before ordinary flow placement.
 */
function reserveInsertionObstacle(
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  proposal: PlannedInsertion,
): void {
  const route = template.routes[proposal.flowId] ?? template.routes.main;
  if (!route) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_ROUTE_NOT_FOUND', `Insertion '${proposal.blockId}' has no route.`, { flowId: proposal.flowId, blockId: proposal.blockId }));
    return;
  }
  const page = ensurePage(pages, template, route, proposal.page, plan.diagnostics, proposal.flowId);
  if (!page) return;
  const definition = page.layout.slots.find((slot) => slot.id === proposal.slotId && slot.allowedRoles?.includes('quote'));
  const slot = definition ? page.slots.get(definition.id) : undefined;
  if (!definition || !slot) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Insertion '${proposal.blockId}' cannot reserve slot '${proposal.slotId}'.`, { flowId: proposal.flowId, blockId: proposal.blockId, page: proposal.page, slotId: proposal.slotId }));
    return;
  }
  slot.box = { ...proposal.box };
  plan.graphicPlacements.push({
    id: `graphic:insertion:${proposal.blockId}`,
    graphicId: `insertion:${proposal.blockId}`,
    slotId: slot.id,
    page: proposal.page,
    shape: 'rectangle',
    wrap: 'around',
    paint: false,
    box: { ...slot.box },
  });
  plan.decisions.push({ code: 'INSERTION_OBSTACLE_RESERVED', flowId: proposal.flowId, blockId: proposal.blockId, page: proposal.page, slotId: slot.id, box: { ...slot.box } });
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Collapse open insertion slots without an authored proposal.
 */
function collapseUnassignedInsertionSlots(
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  proposals: Map<string, PlannedInsertion>,
): void {
  for (const page of pages) {
    for (const [flowId, route] of Object.entries(template.routes)) {
      if (!route.insertionSlots?.length) continue;
      const plannedSlotIds = new Set([...proposals.values()]
        .filter((proposal) => proposal.flowId === flowId && proposal.page === page.page)
        .map((proposal) => proposal.slotId));
      for (const insertionId of route.insertionSlots) {
        if (plannedSlotIds.has(insertionId)) continue;
        const slot = page.slots.get(insertionId);
        if (!slot || slot.state !== 'open') continue;
        slot.state = 'exhausted';
        plan.decisions.push({ code: 'INSERTION_SLOT_COLLAPSED', flowId, page: page.page, slotId: slot.id, reason: 'no-authored-insertion-assigned-to-page' });
      }
    }
  }
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Reserve planned insertion obstacles and collapse unused slots.
 */
export function reserveInsertionObstacles(
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  proposals: Map<string, PlannedInsertion>,
): void {
  for (const proposal of proposals.values()) reserveInsertionObstacle(template, pages, plan, proposal);
  collapseUnassignedInsertionSlots(template, pages, plan, proposals);
}

type InsertionBlockTarget = {
  key: string;
  proposal: PlannedInsertion;
  page: PageState;
  definition: CompositionSlotTemplate;
  slot: CompositionSlot;
};

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Resolve the planned page slot for one authored insertion.
 */
function resolveInsertionBlockTarget(
  template: CompositionTemplate,
  plan: CompositionPlan,
  pages: PageState[],
  proposals: Map<string, PlannedInsertion>,
  route: CompositionFlowRoute,
  flowId: string,
  block: CompositionBlock,
): InsertionBlockTarget | undefined {
  const key = insertionKey(flowId, block.id);
  const proposal = proposals.get(key);
  if (!proposal) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_PLAN_MISSING', `Insertion '${block.id}' has no planned obstacle slot.`, { flowId, blockId: block.id }));
    addResidual(plan.residualContent, flowId, block, 0, undefined, 'insertion-plan-missing');
    return undefined;
  }
  const page = ensurePage(pages, template, route, proposal.page, plan.diagnostics, flowId);
  const definition = page?.layout.slots.find((slot) => slot.id === proposal.slotId && slot.allowedRoles?.includes('quote'));
  const slot = definition && page ? page.slots.get(definition.id) : undefined;
  if (!page || !definition || !slot) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Insertion '${block.id}' cannot place its planned slot '${proposal.slotId}'.`, { flowId, blockId: block.id, page: proposal.page, slotId: proposal.slotId }));
    addResidual(plan.residualContent, flowId, block, 0, undefined, 'insertion-slot-not-found');
    return undefined;
  }
  return { key, proposal, page, definition, slot };
}

type MeasuredInsertionBlock = InsertionTextMeasurement;

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Measure one insertion against its reserved obstacle box.
 */
function measureInsertionBlock(
  metrics: CompositionTextMetrics,
  target: InsertionBlockTarget,
  block: CompositionBlock,
): MeasuredInsertionBlock {
  return measureInsertionText(metrics, target.definition, target.slot.box, block);
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Apply fit-content sizing to a measured insertion slot.
 */
function fitInsertionSlotContent(
  plan: CompositionPlan,
  target: InsertionBlockTarget,
  block: CompositionBlock,
  measurement: MeasuredInsertionBlock,
): void {
  const { definition, slot, page, proposal } = target;
  if (!definition.fitContent || measurement.lines.length === 0) return;
  const contentHeight = (measurement.lines.at(-1)!.lineOffset + 1) * measurement.leading;
  const maxHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : slot.box.height;
  const fittedHeight = Math.min(maxHeight, measurement.padding.top + contentHeight + measurement.padding.bottom);
  slot.box.height = fittedHeight;
  plan.decisions.push({ code: 'INSERTION_SLOT_FIT_CONTENT', flowId: proposal.flowId, blockId: block.id, page: page.page, slotId: slot.id, fromHeight: proposal.box.height, toHeight: fittedHeight, contentHeight, maxHeight });
}

/** Synchronize an insertion obstacle after fit-content sizing. */
/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Keep the current synchronizeInsertionObstacle implementation intact until its target seam is extracted.
 */
function synchronizeInsertionObstacle(plan: CompositionPlan, target: InsertionBlockTarget, block: CompositionBlock): void {
  const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === target.page.page);
  if (obstacle) obstacle.box = { ...target.slot.box };
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Validate, measure, and materialize one planned insertion block.
 */
function placeInsertionBlock(
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  plan: CompositionPlan,
  pages: PageState[],
  proposals: Map<string, PlannedInsertion>,
  route: CompositionFlowRoute,
  flowId: string,
  block: CompositionBlock,
): string | undefined {
  const target = resolveInsertionBlockTarget(template, plan, pages, proposals, route, flowId, block);
  if (!target) return undefined;
  const measurement = measureInsertionBlock(metrics, target, block);
  if (measurement.consumed < measurement.wordCount) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_OVERFLOW', `Insertion '${block.id}' does not fit in its measured obstacle box.`, { flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id, details: { consumed: measurement.consumed, wordCount: measurement.wordCount, box: { ...target.slot.box } } }));
    addResidual(plan.residualContent, flowId, block, measurement.consumed, target.slot.id, 'insertion-overflow');
    return undefined;
  }
  fitInsertionSlotContent(plan, target, block, measurement);
  placeLines(target.page, target.definition, block, metrics, flowId, undefined, measurement.lines, measurement.leading, plan.placements, plan.insertionLines ?? (plan.insertionLines = []), 'insertion', measurement.padding);
  target.slot.state = 'exhausted';
  synchronizeInsertionObstacle(plan, target, block);
  plan.decisions.push({ code: 'INSERTION_LAYER_PLACED', flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id, lineCount: measurement.lines.length, box: { ...target.slot.box } });
  return target.key;
}

/**
 * @planner-target composition/layout/insertion-layout.ts
 * @planner-responsibility Materialize all planned insertion text before ordinary flow placement.
 */
export function placeInsertionLayer(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  plan: CompositionPlan,
  pages: PageState[],
  proposals: Map<string, PlannedInsertion>,
): Set<string> {
  const placed = new Set<string>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
      const key = placeInsertionBlock(metrics, template, plan, pages, proposals, route, flowId, block);
      if (key) placed.add(key);
    }
  }
  return placed;
}

/** Build the stable key shared by insertion proposals and authored blocks. */
export function insertionKey(flowId: string, blockId: string): string {
  return `${flowId}:${blockId}`;
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
