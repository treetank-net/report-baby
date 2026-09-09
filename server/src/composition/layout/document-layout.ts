import type {
  CompositionDocument,
  CompositionFlowRoute,
  CompositionTemplate,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { placeGlyphObjects } from './glyph-objects.js';
import { registerFlowBarrierBoxCandidates, registerFlowPlacements } from './flow-space.js';
import { recordPlanningPhase, tracePlan } from '../observability/planning-observability.js';
import { diagnostic } from '../observability/planning-observability.js';
import {
  ensurePage,
  validateGrowthPolicies,
} from './page-state.js';
import type { PageState } from '../contracts/layout-state.js';
import {
  materializeGraphicPages,
} from './graphic-planning.js';
import {
  placeInsertionLayer,
  reserveInsertionObstacles,
} from './insertion-layout.js';
import { insertionBlocksForFlow } from './insertion-planning.js';
import { planFlow } from './flow-planner.js';
import type { TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';
import type {
  PlannedGraphic,
  PlannedInsertion,
} from './planner-candidates.js';
import { validateMovablePlacementBounds } from './movable-placement-validation.js';
import {
  movableGraphicFramesForPlan,
  movableInsertionFramesForPlan,
} from './movable-placement-frames.js';
import { readRenderConfig } from '../../template/builtins.js';

const DEFAULT_GEOMETRY_PRIORITY = readRenderConfig().compositionPriority.default;

/** Create an empty plan with all renderer-facing collections initialized. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current createPlan implementation intact until its target seam is extracted.
 */
export function createPlan(minimumFragmentLines?: number): CompositionPlan {
  return {
    pages: [],
    slots: [],
    placements: [],
    blockPlacements: [],
    tablePlacements: [],
    graphicPlacements: [],
    glyphPlacements: [],
    flowBarrierBoxCandidates: [],
    lines: [],
    insertionLines: [],
    decisions: [],
    diagnostics: [],
    residualContent: [],
    repeatFlowIds: [],
    trace: { phases: [], blocks: [], slots: [] },
    ...(minimumFragmentLines === undefined ? {} : { minimumFragmentLines }),
  };
}

/** Normalize line reading order after all flow layers have been materialized. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current normalizePlanReadingOrder implementation intact until its target seam is extracted.
 */
function normalizePlanReadingOrder(document: CompositionDocument, plan: CompositionPlan): void {
  const flowOrder = new Map(Object.keys(document.flows).map((flowId, index) => [flowId, index]));
  const blockOrder = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block, index) => [`${flowId}:${block.id}`, index] as const)));
  plan.lines.sort((left, right) => {
    const flowDifference = (flowOrder.get(left.flowId) ?? Number.MAX_SAFE_INTEGER) - (flowOrder.get(right.flowId) ?? Number.MAX_SAFE_INTEGER);
    if (flowDifference !== 0) return flowDifference;
    const blockDifference = (blockOrder.get(`${left.flowId}:${left.blockId}`) ?? Number.MAX_SAFE_INTEGER) - (blockOrder.get(`${right.flowId}:${right.blockId}`) ?? Number.MAX_SAFE_INTEGER);
    if (blockDifference !== 0) return blockDifference;
    return left.startWord - right.startWord || left.page - right.page || (left.routeIndex ?? Number.MAX_SAFE_INTEGER) - (right.routeIndex ?? Number.MAX_SAFE_INTEGER) || left.box.y - right.box.y || left.box.x - right.box.x;
  });
}

/** Flatten mutable page state into the renderer-neutral plan projection. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current flattenPages implementation intact until its target seam is extracted.
 */
function flattenPages(pages: PageState[], plan: CompositionPlan, template: CompositionTemplate): void {
  plan.pages = pages.map((page) => ({ page: page.page, layoutId: page.layout.id, width: page.layout.width, height: page.layout.height }));
  for (const page of pages) {
    for (const [flowId, route] of Object.entries(template.routes)) {
      const routeIds = route.slotsByLayout?.[page.layout.id] ?? route.slots;
      routeIds.forEach((id, index) => {
        const slot = page.slots.get(id);
        if (!slot || slot.routeIndex !== undefined) return;
        slot.routeIndex = index;
        if (slot.flowId === undefined) slot.flowId = flowId;
        if (slot.priority === undefined && route.priority !== undefined) slot.priority = route.priority;
      });
    }
  }
  plan.slots = pages.flatMap((page) => [...page.slots.values()]);
}

/** Tell whether a plan has any error diagnostics. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current planHasErrors implementation intact until its target seam is extracted.
 */
function planHasErrors(plan: CompositionPlan): boolean {
  return plan.diagnostics.some((item) => item.severity === 'error');
}

/** Validate insertion-flow ownership; quote keeps its stricter legacy contract. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current validateInsertionFlowContracts implementation intact until its target seam is extracted.
 */
function validateInsertionFlowContracts(document: CompositionDocument, template: CompositionTemplate, plan: CompositionPlan): void {
  if (template.routes.main?.insertionSlots?.length) {
    plan.diagnostics.push(diagnostic('error', 'MAIN_FLOW_INSERTIONS_FORBIDDEN', "The main flow cannot declare insertion slots; use a separate insertion flow.", { flowId: 'main' }));
  }
  for (const [flowId, flow] of Object.entries(document.flows)) {
    for (const block of flow.blocks) {
      if (block.role !== 'quote') continue;
      if (flowId === 'main') {
        plan.diagnostics.push(diagnostic('error', 'MAIN_FLOW_QUOTE_FORBIDDEN', `Quote block '${block.id}' must be supplied by a flow other than 'main'.`, { flowId, blockId: block.id }));
        continue;
      }
      if (template.routes[flowId]?.insertionSlots?.length) continue;
      plan.diagnostics.push(diagnostic('error', 'QUOTE_INSERTION_FLOW_REQUIRED', `Quote block '${block.id}' must belong to a flow with insertion slots.`, { flowId, blockId: block.id }));
    }
  }
}

/** Attach candidate frames and run all preflight validations for one layout pass. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current preparePlanForLayout implementation intact until its target seam is extracted.
 */
function preparePlanForLayout(
  document: CompositionDocument,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  insertionProposals: Map<string, PlannedInsertion>,
  graphicProposals: Map<string, PlannedGraphic>,
  plan: CompositionPlan,
): void {
  plan.movableInsertionFrames = movableInsertionFramesForPlan(policy.movableInsertionBounds, insertionProposals);
  plan.movableGraphicFrames = movableGraphicFramesForPlan(policy.movableGraphicBounds, graphicProposals);
  validateInsertionFlowContracts(document, template, plan);
  validateMovablePlacementBounds(insertionProposals, policy.movableInsertionBounds ?? {}, plan, 'insertion');
  validateMovablePlacementBounds(graphicProposals, policy.movableGraphicBounds ?? {}, plan, 'graphic');
  validateGrowthPolicies(template, plan);
  recordPlanningPhase(plan, 'preflight', planHasErrors(plan) ? 'failed' : 'completed', { layoutCount: template.layouts.length, flowCount: Object.keys(document.flows).length });
}

/** Create the first document page and reserve planned insertion obstacles. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current reserveDocumentObstacles implementation intact until its target seam is extracted.
 */
function reserveDocumentObstacles(
  document: CompositionDocument,
  template: CompositionTemplate,
  plan: CompositionPlan,
  insertionProposals: Map<string, PlannedInsertion>,
  graphicProposals: Map<string, PlannedGraphic>,
): PageState[] {
  const pages: PageState[] = [];
  materializeGraphicPages(document, template, pages, plan, graphicProposals);
  const firstRoute = template.routes.main ?? Object.values(template.routes)[0];
  if (firstRoute) ensurePage(pages, template, firstRoute, 1, plan.diagnostics, 'document');
  reserveInsertionObstacles(template, pages, plan, insertionProposals);
  recordPlanningPhase(plan, 'obstacle-reservation', planHasErrors(plan) ? 'failed' : 'completed', { obstacleCount: plan.graphicPlacements.filter((graphic) => graphic.graphicId.startsWith('insertion:')).length });
  return pages;
}

/** Materialize all planned insertion text before ordinary flow placement. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current placeDocumentInsertions implementation intact until its target seam is extracted.
 */
function placeDocumentInsertions(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  plan: CompositionPlan,
  pages: PageState[],
  insertionProposals: Map<string, PlannedInsertion>,
): void {
  const insertionKeys = placeInsertionLayer(document, metrics, template, plan, pages, insertionProposals);
  recordPlanningPhase(plan, 'insertion-placement', planHasErrors(plan) ? 'failed' : 'completed', { insertionCount: insertionKeys.size });
}

type DocumentFlowPlanningContext = {
  document: CompositionDocument;
  metrics: CompositionTextMetrics;
  template: CompositionTemplate;
  policy: TextCompositionPlannerPolicy;
  pages: PageState[];
  plan: CompositionPlan;
};

/** Plan a repeated flow once for every already-materialized page. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current planRepeatedFlow implementation intact until its target seam is extracted.
 */
function planRepeatedFlow(
  context: DocumentFlowPlanningContext,
  flowId: string,
  route: CompositionFlowRoute,
  fromPage = route.startPage ?? 1,
  toPage = Math.max(1, context.pages.length),
): void {
  if (!context.plan.repeatFlowIds?.includes(flowId)) context.plan.repeatFlowIds?.push(flowId);
  const preplannedInsertionBlockIds = new Set(insertionBlocksForFlow(context.template, flowId, context.document.flows[flowId]?.blocks ?? []).map((block) => block.id));
  for (let page = fromPage; page <= toPage; page += 1) {
    const blockIds = new Set((context.document.flows[flowId]?.blocks ?? []).map((block) => block.id));
    const alreadyPlanned = [
      ...context.plan.lines,
      ...(context.plan.insertionLines ?? []),
      ...context.plan.blockPlacements,
      ...context.plan.tablePlacements,
    ].some((item) => item.page === page && blockIds.has(item.blockId));
    if (alreadyPlanned) continue;
    planFlow(context.document, context.metrics, context.template, context.policy, flowId, { ...route, continuation: 'forbidden' }, context.pages, context.plan, page, preplannedInsertionBlockIds);
  }
}

/** Validate and plan one ordinary flow from its configured start page. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current planOrdinaryFlow implementation intact until its target seam is extracted.
 */
function planOrdinaryFlow(context: DocumentFlowPlanningContext, flowId: string, route: CompositionFlowRoute): void {
  if (route.startPage !== undefined && (!Number.isInteger(route.startPage) || route.startPage < 1 || route.startPage > context.template.maxPages)) {
    context.plan.diagnostics.push(diagnostic('error', 'FLOW_START_PAGE_INVALID', `Flow '${flowId}' has an invalid start page ${route.startPage}.`, { flowId }));
    return;
  }
  const preplannedInsertionBlockIds = new Set(insertionBlocksForFlow(context.template, flowId, context.document.flows[flowId]?.blocks ?? []).map((block) => block.id));
  planFlow(context.document, context.metrics, context.template, context.policy, flowId, route, context.pages, context.plan, route.startPage ?? 1, preplannedInsertionBlockIds);
}

/** Dispatch one flow to its repeated or ordinary planning path. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current planDocumentFlow implementation intact until its target seam is extracted.
 */
function planDocumentFlow(context: DocumentFlowPlanningContext, flowId: string, flow: CompositionDocument['flows'][string]): void {
  const route = context.template.routes[flowId];
  if (!route) {
    if (flow.blocks.length > 0) context.plan.diagnostics.push(diagnostic('error', 'FLOW_ROUTE_NOT_FOUND', `Flow '${flowId}' has no route in template '${context.template.layouts[0]?.id ?? ''}'.`, { flowId }));
    return;
  }
  if (route.repeat === 'each-page') {
    planRepeatedFlow(context, flowId, route);
    return;
  }
  planOrdinaryFlow(context, flowId, route);
}

/** Preserve ordinary-before-repeated ordering and plan every document flow. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current planDocumentFlows implementation intact until its target seam is extracted.
 */
function planDocumentFlows(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  pages: PageState[],
  plan: CompositionPlan,
): void {
  const context: DocumentFlowPlanningContext = { document, metrics, template, policy, pages, plan };
  const flowEntries = Object.entries(document.flows);
  const initialPageCount = Math.max(1, pages.length);
  const repeatedEntries = flowEntries.filter(([flowId]) => template.routes[flowId]?.repeat === 'each-page');
  const flowOrder = new Map(flowEntries.map(([flowId], index) => [flowId, index]));
  const geometryPriority = (flowId: string): number => template.routes[flowId]?.priority ?? DEFAULT_GEOMETRY_PRIORITY;
  const compareByGeometryPriority = ([left]: [string, CompositionDocument['flows'][string]], [right]: [string, CompositionDocument['flows'][string]]): number => {
    const priorityDifference = geometryPriority(right) - geometryPriority(left);
    return priorityDifference !== 0 ? priorityDifference : flowOrder.get(left)! - flowOrder.get(right)!;
  };
  const preMainRepeated = repeatedEntries
    .filter(([flowId]) => flowId !== 'footer')
    .sort(compareByGeometryPriority);
  for (const [flowId] of preMainRepeated) {
    const route = template.routes[flowId];
    if (route) planRepeatedFlow(context, flowId, route, route.startPage ?? 1, initialPageCount);
  }
  const ordinaryEntries = flowEntries
    .filter(([flowId]) => template.routes[flowId]?.repeat !== 'each-page')
    .sort(([left], [right]) => {
      const leftPriority = template.routes[left]?.priority;
      const rightPriority = template.routes[right]?.priority;
      if (leftPriority !== undefined || rightPriority !== undefined) {
        const priorityDifference = (rightPriority ?? DEFAULT_GEOMETRY_PRIORITY) - (leftPriority ?? DEFAULT_GEOMETRY_PRIORITY);
        if (priorityDifference !== 0) return priorityDifference;
      }
      const rank = (flowId: string): number => flowId === 'title' ? 0 : flowId === 'main' ? 2 : 1;
      return rank(left) - rank(right);
    });
  for (const [flowId, flow] of ordinaryEntries) planDocumentFlow(context, flowId, flow);
  for (const [flowId, flow] of repeatedEntries.sort(compareByGeometryPriority)) {
    const route = template.routes[flowId];
    if (!route) continue;
    if (flowId === 'footer') planRepeatedFlow(context, flowId, route);
    else planRepeatedFlow(context, flowId, route, initialPageCount + 1, Math.max(1, context.pages.length));
  }
}

/** Finalize page, flow, barrier, glyph, and trace projections after flow planning. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current finalizeDocumentPlan implementation intact until its target seam is extracted.
 */
function finalizeDocumentPlan(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
): void {
  flattenPages(pages, plan, template);
  normalizePlanReadingOrder(document, plan);
  plan.flowPlacements = registerFlowPlacements(document, plan);
  plan.flowBarrierBoxCandidates = registerFlowBarrierBoxCandidates(plan);
  placeGlyphObjects(document, metrics, plan);
  recordPlanningPhase(plan, 'flow-placement', planHasErrors(plan) ? 'failed' : 'completed', { lineCount: plan.lines.length, pageCount: plan.pages.length });
  tracePlan(document, metrics, plan);
}

/** Coordinate one complete document-layout run from preflight through finalization. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Coordinate one complete document-layout run from preflight through finalization.
 */
export function planDocumentOnce(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  insertionProposals: Map<string, PlannedInsertion>,
  graphicProposals: Map<string, PlannedGraphic>,
): CompositionPlan {
  const plan = createPlan(policy.minimumFragmentLines);
  preparePlanForLayout(document, template, policy, insertionProposals, graphicProposals, plan);
  const pages = reserveDocumentObstacles(document, template, plan, insertionProposals, graphicProposals);
  placeDocumentInsertions(document, metrics, template, plan, pages, insertionProposals);
  planDocumentFlows(document, metrics, template, policy, pages, plan);
  finalizeDocumentPlan(document, metrics, template, pages, plan);
  return plan;
}
