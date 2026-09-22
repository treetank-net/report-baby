import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionLayout,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionSlot,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { diagnostic, addResidual, addTableResidual, recordPlanDecision } from '../observability/planning-observability.js';
import { ensurePage, routeLayout } from './page-state.js';
import type { PageState } from '../contracts/layout-state.js';
import { placeLines } from '../text/text-layout.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { insertionBlocksForFlow, insertionSlotAcceptsBlock } from './insertion-planning.js';
import { insertionContentHeight, insertionContentIsComplete, measureInsertionContent, type InsertionContentMeasurement } from './insertion-measurement.js';
import { placeAtomicBlock, placeTableFragment } from './structured-block-placement.js';
import type { CompositionSlotTemplate } from '../contracts/model.js';
import { resolvePlacementPolicy } from './placement-policy.js';

function reserveInsertionObstacle(
  template: CompositionLayout,
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
  const definition = page.layout.slots.find((slot) => slot.id === proposal.slotId);
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
  template: CompositionLayout,
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
  template: CompositionLayout,
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
  template: CompositionLayout,
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
    const explicitOmission = block.allowOmission === true && plan.decisions.some((decision) => decision.code === 'OPTIONAL_INSERTION_OMITTED'
      && decision.flowId === flowId
      && decision.blockId === block.id);
    if (explicitOmission) return undefined;
    plan.diagnostics.push(diagnostic('error', 'INSERTION_PLAN_MISSING', `Insertion '${block.id}' has no planned obstacle slot.`, { flowId, blockId: block.id }));
    addResidual(plan.residualContent, flowId, block, 0, undefined, 'insertion-plan-missing');
    return undefined;
  }
  const page = ensurePage(pages, template, route, proposal.page, plan.diagnostics, flowId);
  const definition = page?.layout.slots.find((slot) => slot.id === proposal.slotId && insertionSlotAcceptsBlock(slot, flowId, block));
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
  measurement: InsertionContentMeasurement,
  contentHeight: number,
): void {
  const { definition, slot, page, proposal } = target;
  if (!definition.fitContent) return;
  if (contentHeight <= 0) return;
  const maxHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : slot.box.height;
  const fittedHeight = Math.min(maxHeight, contentHeight);
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
  template: CompositionLayout,
  plan: CompositionPlan,
  pages: PageState[],
  proposals: Map<string, PlannedInsertion>,
  route: CompositionFlowRoute,
  flowId: string,
  block: CompositionBlock,
): string | undefined {
  const target = resolveInsertionBlockTarget(template, plan, pages, proposals, route, flowId, block);
  if (!target) return undefined;
  let measurement: InsertionContentMeasurement | undefined;
  try {
    measurement = measureInsertionContent(metrics, target.definition, target.slot.box, block);
  } catch (cause) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_MEASUREMENT_FAILED', `Measurement failed for insertion '${block.id}': ${cause instanceof Error ? cause.message : String(cause)}`, { flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id }));
    return undefined;
  }
  if (!measurement) {
    plan.diagnostics.push(diagnostic('error', 'INSERTION_MEASUREMENT_UNAVAILABLE', `No renderer-neutral measurement is available for insertion '${block.id}'.`, { flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id }));
    addResidual(plan.residualContent, flowId, block, 0, target.slot.id, 'insertion-measurement-unavailable');
    return undefined;
  }
  const contentHeight = insertionContentHeight(measurement);
  if (!Number.isFinite(contentHeight) || contentHeight <= 0 || !insertionContentIsComplete(measurement, block)) {
    const textMeasurement = measurement.kind === 'text' ? measurement.text : undefined;
    plan.diagnostics.push(diagnostic('error', 'INSERTION_OVERFLOW', `Insertion '${block.id}' does not fit in its measured obstacle box.`, { flowId, blockId: block.id, page: target.page.page, slotId: target.slot.id, details: { consumed: textMeasurement?.consumed, wordCount: textMeasurement?.wordCount, endRow: measurement.kind === 'table' ? measurement.table.endRow : undefined, rowCount: block.table?.body.length, box: { ...target.slot.box } } }));
    if (measurement.kind === 'table') addTableResidual(plan.residualContent, flowId, block, measurement.table.endRow, target.slot.id, 'insertion-overflow');
    else addResidual(plan.residualContent, flowId, block, textMeasurement?.consumed ?? 0, target.slot.id, 'insertion-overflow');
    return undefined;
  }
  fitInsertionSlotContent(plan, target, block, measurement, contentHeight);
  if (measurement.kind === 'text') {
    placeLines(target.page, target.definition, block, metrics, flowId, undefined, measurement.text.lines, measurement.text.leading, plan.placements, plan.insertionLines ?? (plan.insertionLines = []), 'insertion', measurement.text.padding);
  } else if (measurement.kind === 'table') {
    placeTableFragment(target.page, target.definition, block, measurement.table, 0, false, target.slot.routeIndex, plan.tablePlacements, target.slot.box.y);
  } else {
    placeAtomicBlock(target.page, target.definition, block, measurement.block, target.slot.routeIndex, plan.blockPlacements, plan.graphicPlacements, target.slot.box.y);
  }
  target.slot.state = 'exhausted';
  synchronizeInsertionObstacle(plan, target, block);
  const decision = recordPlanDecision(plan, 'INSERTION_LAYER_PLACED');
  decision.flowId = flowId;
  decision.blockId = block.id;
  decision.page = target.page.page;
  decision.slotId = target.slot.id;
  decision.lineCount = measurement.kind === 'text' ? measurement.text.lines.length : undefined;
  decision.kind = measurement.kind;
  decision.box = { ...target.slot.box };
  const resolvedPolicy = resolvePlacementPolicy(template, flowId, block, target.definition);
  const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${block.id}`
    && graphic.page === target.page.page);
  if (obstacle) obstacle.placementPolicy = resolvedPolicy;
  decision.distribution = resolvedPolicy.distribution;
  if (resolvedPolicy.rhythmGroup !== undefined) decision.rhythmGroup = resolvedPolicy.rhythmGroup;
  decision.distributionSource = resolvedPolicy.distributionSource;
  if (resolvedPolicy.rhythmGroupSource !== undefined) decision.rhythmGroupSource = resolvedPolicy.rhythmGroupSource;
  if (resolvedPolicy.sourceRelationSource !== undefined) decision.sourceRelationSource = resolvedPolicy.sourceRelationSource;
  if (resolvedPolicy.source !== undefined) decision.source = { ...resolvedPolicy.source };
  return target.key;
}

/** Materialize all planned insertion blocks before ordinary flow placement. */
export function placeInsertionLayer(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  plan: CompositionPlan,
  pages: PageState[],
  proposals: Map<string, PlannedInsertion>,
): Set<string> {
  const placed = new Set<string>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    for (const block of insertionBlocksForFlow(template, flowId, flow.blocks)) {
      const key = placeInsertionBlock(metrics, template, plan, pages, proposals, route, flowId, block);
      if (key) placed.add(key);
    }
  }
  return placed;
}
