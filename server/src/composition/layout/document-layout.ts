import type {
  CompositionDocument,
  CompositionFlowRoute,
  CompositionTemplate,
} from '../model.js';
import type {
  CompositionMovableGraphicFrame,
  CompositionMovableInsertionFrame,
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
import { planFlow } from './flow-planner.js';
import type { MovablePlacementBounds, TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';
import type {
  PlannedGraphic,
  PlannedInsertion,
} from './planner-candidates.js';

/** Validate one family of movable placement frames and emit its diagnostics. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current validateMovableBounds implementation intact until its target seam is extracted.
 */
function validateMovableBounds(
  proposals: Map<string, { box: { x: number; y: number; width: number; height: number } }>,
  policies: Record<string, MovablePlacementBounds>,
  plan: CompositionPlan,
  kind: 'insertion' | 'graphic',
): void {
  for (const [key, movable] of Object.entries(policies)) {
    const proposal = proposals.get(key);
    if (!proposal) {
      plan.diagnostics.push(diagnostic(
        'error',
        `MOVABLE_${kind.toUpperCase()}_TARGET_NOT_FOUND`,
        `Movable ${kind} policy '${key}' does not match a planned ${kind}.`,
        { details: { key } },
      ));
      continue;
    }
    const { bounds } = movable;
    const validNumbers = [bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite);
    const validShape = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    const containsMeasuredBox = Boolean(bounds && proposal.box.width <= bounds.width && proposal.box.height <= bounds.height);
    if (!validNumbers || !validShape || !containsMeasuredBox || !Number.isInteger(movable.candidateCount) || movable.candidateCount < 1) {
      const noun = kind === 'insertion' ? 'insertion' : 'graphic';
      plan.diagnostics.push(diagnostic(
        'error',
        `MOVABLE_${kind.toUpperCase()}_BOUNDS_INVALID`,
        `Movable ${kind} frame '${key}' cannot contain its measured ${noun} box or candidate count.`,
        { details: { key, bounds, measuredBox: proposal.box, candidateCount: movable.candidateCount } },
      ));
    }
  }
}

/** Validate movable insertion frames. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current validateMovableInsertionBounds implementation intact until its target seam is extracted.
 */
function validateMovableInsertionBounds(
  insertionProposals: Map<string, PlannedInsertion>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  validateMovableBounds(insertionProposals, policy.movableInsertionBounds ?? {}, plan, 'insertion');
}

/** Validate movable graphic frames. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current validateMovableGraphicBounds implementation intact until its target seam is extracted.
 */
function validateMovableGraphicBounds(
  graphicProposals: Map<string, PlannedGraphic>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  validateMovableBounds(graphicProposals, policy.movableGraphicBounds ?? {}, plan, 'graphic');
}

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

/** Materialize movable insertion frames from policy and proposals. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current movableInsertionFramesForPlan implementation intact until its target seam is extracted.
 */
function movableInsertionFramesForPlan(
  policy: TextCompositionPlannerPolicy,
  insertionProposals: Map<string, PlannedInsertion>,
): CompositionMovableInsertionFrame[] {
  return Object.entries(policy.movableInsertionBounds ?? {}).flatMap(([key, movable]) => {
    const proposal = insertionProposals.get(key);
    if (!proposal) return [];
    return [{
      id: key,
      flowId: proposal.flowId,
      blockId: proposal.blockId,
      page: proposal.page,
      box: { ...movable.bounds },
      axis: movable.axis ?? 'y',
      candidateCount: movable.candidateCount,
    } satisfies CompositionMovableInsertionFrame];
  });
}

/** Materialize movable graphic frames from policy and proposals. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current movableGraphicFramesForPlan implementation intact until its target seam is extracted.
 */
function movableGraphicFramesForPlan(
  policy: TextCompositionPlannerPolicy,
  graphicProposals: Map<string, PlannedGraphic>,
): CompositionMovableGraphicFrame[] {
  return Object.entries(policy.movableGraphicBounds ?? {}).flatMap(([key, movable]) => {
    const proposal = graphicProposals.get(key);
    if (!proposal) return [];
    return [{
      id: key,
      graphicId: proposal.graphicId,
      page: proposal.page,
      box: { ...movable.bounds },
      axis: movable.axis ?? 'y',
      candidateCount: movable.candidateCount,
    } satisfies CompositionMovableGraphicFrame];
  });
}

/** Reject quote blocks that are not owned by a non-main insertion flow. */
/**
 * @planner-target composition/layout/document-layout.ts
 * @planner-responsibility Keep the current validateQuoteFlowContracts implementation intact until its target seam is extracted.
 */
function validateQuoteFlowContracts(document: CompositionDocument, template: CompositionTemplate, plan: CompositionPlan): void {
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
  plan.movableInsertionFrames = movableInsertionFramesForPlan(policy, insertionProposals);
  plan.movableGraphicFrames = movableGraphicFramesForPlan(policy, graphicProposals);
  validateQuoteFlowContracts(document, template, plan);
  validateMovableInsertionBounds(insertionProposals, policy, plan);
  validateMovableGraphicBounds(graphicProposals, policy, plan);
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
function planRepeatedFlow(context: DocumentFlowPlanningContext, flowId: string, route: CompositionFlowRoute): void {
  context.plan.repeatFlowIds?.push(flowId);
  const pageCount = Math.max(1, context.pages.length);
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= pageCount; page += 1) {
    planFlow(context.document, context.metrics, context.template, context.policy, flowId, { ...route, continuation: 'forbidden' }, context.pages, context.plan, page);
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
  planFlow(context.document, context.metrics, context.template, context.policy, flowId, route, context.pages, context.plan, route.startPage ?? 1, Boolean(route.insertionSlots?.length));
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
  const orderedFlowEntries = [
    ...flowEntries.filter(([flowId]) => template.routes[flowId]?.repeat !== 'each-page'),
    ...flowEntries.filter(([flowId]) => template.routes[flowId]?.repeat === 'each-page'),
  ];
  for (const [flowId, flow] of orderedFlowEntries) planDocumentFlow(context, flowId, flow);
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
