import type { PlacementRequests } from '../../contracts/input/schema.js';
import type {
  CompositionBlock,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionSlotTemplate,
  CompositionTemplate,
} from '../contracts/model.js';
import { rectsOverlap } from '../geometry/rectangles.js';
import { routeLayout } from '../layout/page-state.js';

type PlacementSlot = NonNullable<PlacementRequests['insertion_flows']>[number]['slots'][number];
type PlacementFlow = NonNullable<PlacementRequests['insertion_flows']>[number];

function requestFlows(requests: PlacementRequests): PlacementFlow[] {
  const flows = [...(requests.insertion_flows ?? [])];
  for (const insertion of requests.insertions ?? []) {
    flows.push({
      flow_id: insertion.flow_id,
      start_page: insertion.page,
      repeat: 'once',
      continuation: 'forbidden',
      slots: [{
        id: `request:${insertion.flow_id}:${insertion.block_id}:${insertion.page}`,
        frame: insertion.frame,
        kind: insertion.kind,
        allowed_block_ids: [insertion.block_id],
        sizing: insertion.sizing,
      }],
    });
  }
  return flows;
}

function requireFlow(document: { flows?: Record<string, unknown> } | undefined, flowId: string): void {
  if (flowId === 'main') throw new Error("Request-owned insertion flow cannot be 'main'; keep main reserved for the primary text.");
  if (!document?.flows?.[flowId]) throw new Error(`Insertion flow '${flowId}' is not present in the document data.`);
}

function validatePage(page: number, maxPages: number, flowId: string): void {
  if (!Number.isInteger(page) || page < 1 || page > maxPages) {
    throw new Error(`Insertion flow '${flowId}' requests page ${page}, outside the template range 1-${maxPages}.`);
  }
}

function validateFrame(slot: PlacementSlot, flowId: string): void {
  const { x, y, width, height } = slot.frame;
  if (x + width > 1 + Number.EPSILON || y > 1 + Number.EPSILON) {
    throw new Error(`Insertion slot '${slot.id}' in flow '${flowId}' lies outside the page.`);
  }
  if (typeof height === 'number' && y + height > 1 + Number.EPSILON) {
    throw new Error(`Insertion slot '${slot.id}' in flow '${flowId}' extends below the page.`);
  }
  if (slot.sizing?.mode === 'fixed' && typeof height !== 'number') {
    throw new Error(`Fixed insertion slot '${slot.id}' must provide a numeric frame.height.`);
  }
}

function pageContentBottom(layout: CompositionLayoutTemplate): number {
  const contentSlots = layout.slots.filter((slot) => slot.flowId === 'main' || slot.regionId === 'content');
  return contentSlots.reduce((bottom, slot) => Math.max(bottom, slot.box.y + slot.box.height), 0) || layout.height;
}

function physicalSlot(
  slot: PlacementSlot,
  flowId: string,
  layout: CompositionLayoutTemplate,
): CompositionSlotTemplate {
  const sizing = slot.sizing;
  const fitContent = sizing?.mode !== 'fixed' || slot.frame.height === 'auto' || slot.frame.height === undefined;
  const x = slot.frame.x * layout.width;
  const y = slot.frame.y * layout.height;
  const contentBottom = pageContentBottom(layout);
  const pageMaximum = Math.max(0, contentBottom - y);
  const requestedMaximum = sizing?.max_height === undefined || sizing.max_height === 'page'
    ? pageMaximum
    : sizing.max_height * layout.height;
  const maxHeight = Math.min(pageMaximum, requestedMaximum);
  const frameHeight = typeof slot.frame.height === 'number' ? slot.frame.height * layout.height : maxHeight;
  const height = fitContent ? maxHeight : frameHeight;
  const definition: CompositionSlotTemplate = {
    id: slot.id,
    regionId: `insertion:${flowId}`,
    flowId,
    kind: slot.kind ?? 'text',
    box: { x, y, width: slot.frame.width * layout.width, height },
    ...(slot.allowed_roles ? { allowedRoles: [...slot.allowed_roles] } : {}),
    ...(slot.allowed_block_ids ? { allowedBlockIds: [...slot.allowed_block_ids] } : {}),
    ...(slot.allowed_block_kinds ? { allowedBlockKinds: [...slot.allowed_block_kinds] } : {}),
    ...(fitContent ? { fitContent: true, grow: { axis: 'y', maxHeight, ...(sizing?.pushes ? { pushes: [...sizing.pushes] } : {}) } } : {}),
  };
  if (definition.box.height <= 0) throw new Error(`Insertion slot '${slot.id}' has no usable vertical capacity on layout '${layout.id}'.`);
  if (!fitContent && definition.box.y + definition.box.height > contentBottom + Number.EPSILON) {
    throw new Error(`Fixed insertion slot '${slot.id}' extends below the content area on layout '${layout.id}'.`);
  }
  return definition;
}

function slotPages(flow: PlacementFlow, maxPages: number, defaultStartPage: number): number[] {
  const start = flow.start_page ?? defaultStartPage;
  if (flow.repeat === 'each-page') return Array.from({ length: maxPages - start + 1 }, (_, index) => start + index);
  return [start];
}

function baseRouteForFlow(template: CompositionTemplate, flowId: string): CompositionFlowRoute {
  const existing = template.routes[flowId];
  if (existing) return existing;
  const main = template.routes.main ?? Object.values(template.routes)[0];
  if (!main) throw new Error(`Cannot create insertion flow '${flowId}' without a page route.`);
  return {
    slots: [],
    continuation: 'forbidden',
    ...(main.layouts ? { layouts: [...main.layouts] } : {}),
    ...(main.slotsByLayout ? { slotsByLayout: Object.fromEntries(Object.keys(main.slotsByLayout).map((id) => [id, []])) } : {}),
  };
}

function addRouteSlots(route: CompositionFlowRoute, slotIds: string[], template: CompositionTemplate): CompositionFlowRoute {
  const slots = [...new Set([...route.slots, ...slotIds])];
  const insertionSlots = [...new Set([...(route.insertionSlots ?? []), ...slotIds])];
  const layoutIds = route.layouts ?? (template.layouts[0] ? [template.layouts[0].id] : []);
  const slotsByLayout = Object.fromEntries(layoutIds.map((layoutId) => [layoutId, [...new Set([...(route.slotsByLayout?.[layoutId] ?? []), ...slotIds])]]));
  return { ...route, slots, insertionSlots, layouts: [...layoutIds], slotsByLayout };
}

function validateStaticOverlaps(template: CompositionTemplate, dynamic: CompositionSlotTemplate, page: number, route: CompositionFlowRoute): void {
  const layout = routeLayout(route, template, page);
  if (!layout) return;
  for (const existing of layout.slots) {
    if (existing.id === dynamic.id) continue;
    if (!rectsOverlap(existing.box, dynamic.box)) continue;
    if (existing.kind === 'graphic' || existing.reserved || (existing.flowId !== undefined && existing.flowId !== 'main')) {
      throw new Error(`Insertion slot '${dynamic.id}' overlaps protected slot '${existing.id}' on page ${page}.`);
    }
  }
}

function assignDefaultPushes(slots: PlacementSlot[]): PlacementSlot[] {
  const ids = new Set(slots.map((slot) => slot.id));
  return slots.map((slot, index) => {
    if (slot.sizing?.mode === 'fixed' || slot.sizing?.pushes || typeof slot.frame.height === 'number') return slot;
    const pushes = slots.slice(index + 1)
      .filter((candidate) => candidate.frame.y > slot.frame.y)
      .map((candidate) => candidate.id)
      .filter((id) => ids.has(id));
    return pushes.length > 0 ? {
      ...slot,
      sizing: {
        mode: slot.sizing?.mode ?? 'fit-content',
        max_height: slot.sizing?.max_height ?? 'page',
        pushes,
      },
    } : slot;
  });
}

/**
 * Apply request-owned insertion slots to a renderer-neutral template.  The
 * returned template is an immutable per-render overlay; compiled YAML remains
 * reusable and the content document remains unaware of layout geometry.
 */
export function applyDynamicInsertionRequests(
  template: CompositionTemplate,
  document: { flows?: Record<string, { blocks?: CompositionBlock[] }> },
  requests: PlacementRequests | undefined,
): CompositionTemplate {
  if (!requests) return template;
  const flows = requestFlows(requests);
  if (flows.length === 0) return template;
  const oneOffAssignments = new Set<string>();
  for (const insertion of requests.insertions ?? []) {
    const key = `${insertion.flow_id}:${insertion.block_id}`;
    if (oneOffAssignments.has(key)) throw new Error(`Block '${insertion.block_id}' in flow '${insertion.flow_id}' is assigned by more than one one-off insertion request.`);
    oneOffAssignments.add(key);
  }
  const staticIds = new Set(template.layouts.flatMap((layout) => layout.slots.map((slot) => slot.id)));
  const dynamicIds = new Set<string>();
  const overlays: Record<number, CompositionSlotTemplate[]> = Object.fromEntries(Object.entries(template.pageSlotOverlays ?? {}).map(([page, slots]) => [Number(page), [...slots]]));
  let routes = { ...template.routes };
  for (const flow of flows) {
    requireFlow(document, flow.flow_id);
    const route = routes[flow.flow_id] ?? baseRouteForFlow(template, flow.flow_id);
    const normalizedSlots = assignDefaultPushes(flow.slots);
    const defaultStartPage = route.startPage ?? 1;
    const pages = slotPages(flow, template.maxPages, defaultStartPage);
    if (pages.length === 0) validatePage(flow.start_page ?? defaultStartPage, template.maxPages, flow.flow_id);
    for (const page of pages) validatePage(page, template.maxPages, flow.flow_id);
    for (const slot of normalizedSlots) {
      validateFrame(slot, flow.flow_id);
      if (slot.allowed_block_ids) {
        const blocks = document.flows?.[flow.flow_id]?.blocks ?? [];
        const hasKnownBlock = slot.allowed_block_ids.some((allowedId) => blocks.some((block) => block.id === allowedId || block.id.startsWith(`${allowedId}:`)));
        if (!hasKnownBlock) throw new Error(`Insertion slot '${slot.id}' does not allow any block from flow '${flow.flow_id}'.`);
      }
      if (staticIds.has(slot.id) || dynamicIds.has(slot.id)) throw new Error(`Insertion slot id '${slot.id}' is already in use.`);
      dynamicIds.add(slot.id);
      const firstLayout = routeLayout(route, template, pages[0] ?? defaultStartPage) ?? template.layouts[0];
      if (!firstLayout) throw new Error(`Insertion flow '${flow.flow_id}' has no page layout.`);
      const firstDefinition = physicalSlot(slot, flow.flow_id, firstLayout);
      if (firstDefinition.grow?.pushes?.some((id) => !normalizedSlots.some((candidate) => candidate.id === id))) {
        throw new Error(`Insertion slot '${slot.id}' pushes an unknown request slot.`);
      }
      for (const page of pages) {
        const pageLayout = routeLayout(route, template, page);
        if (!pageLayout) throw new Error(`Insertion flow '${flow.flow_id}' has no layout for page ${page}.`);
        const pageDefinition = physicalSlot(slot, flow.flow_id, pageLayout);
        validateStaticOverlaps(template, pageDefinition, page, route);
        const pageSlots = overlays[page] ?? (overlays[page] = []);
        if (pageSlots.some((candidate) => candidate.id === pageDefinition.id)) throw new Error(`Insertion slot id '${pageDefinition.id}' is duplicated on page ${page}.`);
        for (const existing of pageSlots) {
          if (!rectsOverlap(existing.box, pageDefinition.box)) continue;
          const pushedByExisting = existing.grow?.pushes?.includes(pageDefinition.id) ?? false;
          const pushedByCurrent = pageDefinition.grow?.pushes?.includes(existing.id) ?? false;
          if (!pushedByExisting && !pushedByCurrent) throw new Error(`Insertion slot '${pageDefinition.id}' overlaps dynamic slot '${existing.id}' on page ${page} without a grow.pushes relation.`);
        }
        pageSlots.push(pageDefinition);
      }
    }
    routes[flow.flow_id] = {
      ...addRouteSlots(route, normalizedSlots.map((slot) => slot.id), template),
      continuation: flow.continuation ?? route.continuation,
      ...(flow.repeat === 'each-page' ? { repeat: 'each-page' as const } : {}),
      ...(flow.start_page === undefined ? {} : { startPage: flow.start_page }),
    };
  }
  return { ...template, routes, pageSlotOverlays: overlays };
}
