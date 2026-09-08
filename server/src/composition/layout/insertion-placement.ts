import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionTemplate,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionSlot,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { diagnostic, addResidual, recordPlanDecision } from '../observability/planning-observability.js';
import { ensurePage, routeLayout } from './page-state.js';
import type { PageState } from '../contracts/layout-state.js';
import { placeLines } from '../text/text-layout.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { measureInsertionText, type InsertionTextMeasurement } from './insertion-measurement.js';
import type { CompositionSlotTemplate } from '../contracts/model.js';

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
  const decision = recordPlanDecision(plan, 'INSERTION_OBSTACLE_RESERVED');
  decision.flowId = proposal.flowId;
  decision.blockId = proposal.blockId;
  decision.page = proposal.page;
  decision.slotId = slot.id;
  decision.box = { ...slot.box };
}

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
        const decision = recordPlanDecision(plan, 'INSERTION_SLOT_COLLAPSED');
        decision.flowId = flowId;
        decision.page = page.page;
        decision.slotId = slot.id;
        decision.reason = 'no-authored-insertion-assigned-to-page';
      }
    }
  }
}

/** Reserve planned insertion obstacles and collapse unused slots. */
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

function fitInsertionSlotContent(
  plan: CompositionPlan,
  target: InsertionBlockTarget,
  block: CompositionBlock,
  measurement: InsertionTextMeasurement,
): void {
  const { definition, slot, page, proposal } = target;
  if (!definition.fitContent || measurement.lines.length === 0) return;
  const contentHeight = (measurement.lines.at(-1)!.lineOffset + 1) * measurement.leading;
  const maxHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : slot.box.height;
  const fittedHeight = Math.min(maxHeight, measurement.padding.top + contentHeight + measurement.padding.bottom);
  slot.box.height = fittedHeight;
  const decision = recordPlanDecision(plan, 'INSERTION_SLOT_FIT_CONTENT');
  decision.flowId = proposal.flowId;
  decision.blockId = block.id;
  decision.page = page.page;
  decision.slotId = slot.id;
  decision.fromHeight = proposal.box.height;
  decision.toHeight = fittedHeight;
  decision.contentHeight = contentHeight;
  decision.maxHeight = maxHeight;
}

function synchronizeInsertionObstacle(plan: CompositionPlan, target: InsertionBlockTarget, block: CompositionBlock): void {
  const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === target.page.page);
  if (obstacle) obstacle.box = { ...target.slot.box };
}

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
  const measurement = measureInsertionText(metrics, target.definition, target.slot.box, block);
  if (measurement.consumed < measurement.wordCount) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_OVERFLOW', `Insertion '${block.id}' does not fit in its measured obstacle box.`, { flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id, details: { consumed: measurement.consumed, wordCount: measurement.wordCount, box: { ...target.slot.box } } }));
    addResidual(plan.residualContent, flowId, block, measurement.consumed, target.slot.id, 'insertion-overflow');
    return undefined;
  }
  fitInsertionSlotContent(plan, target, block, measurement);
  placeLines(target.page, target.definition, block, metrics, flowId, undefined, measurement.lines, measurement.leading, plan.placements, plan.insertionLines ?? (plan.insertionLines = []), 'insertion', measurement.padding);
  target.slot.state = 'exhausted';
  synchronizeInsertionObstacle(plan, target, block);
  const decision = recordPlanDecision(plan, 'INSERTION_LAYER_PLACED');
  decision.flowId = flowId;
  decision.blockId = block.id;
  decision.page = target.page.page;
  decision.slotId = target.slot.id;
  decision.lineCount = measurement.lines.length;
  decision.box = { ...target.slot.box };
  return target.key;
}

/** Materialize all planned insertion text before ordinary flow placement. */
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
