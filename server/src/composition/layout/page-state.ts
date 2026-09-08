import type {
  CompositionBlock,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from '../contracts/model.js';
import type {
  CompositionDiagnostic,
  CompositionPlan,
  CompositionSlot,
} from '../contracts/engine-contracts.js';
import type { PageState } from '../contracts/layout-state.js';
import type { FlowPlanningContext, FlowRuntime, FlowTarget } from '../contracts/flow-planning.js';
import type { FlowCursor } from '../contracts/layout-state.js';
import { rectBottom, rectsOverlap } from '../geometry/rectangles.js';
import { diagnostic, recordFlowDecision } from '../observability/planning-observability.js';
export type { PageState } from '../contracts/layout-state.js';

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Find one compiled layout by identifier.
 */
function layoutById(template: CompositionTemplate, id: string): CompositionLayoutTemplate | undefined {
  return template.layouts.find((layout) => layout.id === id);
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Resolve the layout assigned to one flow page.
 */
export function routeLayout(route: CompositionFlowRoute, template: CompositionTemplate, page: number): CompositionLayoutTemplate | undefined {
  const layoutId = route.layouts?.[Math.min(page - 1, route.layouts.length - 1)] ?? template.layouts[0]?.id;
  const baseLayout = layoutId ? layoutById(template, layoutId) : undefined;
  if (!baseLayout) return undefined;
  const overlays = template.pageSlotOverlays?.[page];
  if (!overlays || overlays.length === 0) return baseLayout;
  const existingIds = new Set(baseLayout.slots.map((slot) => slot.id));
  return {
    ...baseLayout,
    slots: [...baseLayout.slots, ...overlays.filter((slot) => !existingIds.has(slot.id))],
  };
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Resolve the route slot identifiers for one layout.
 */
export function routeSlots(route: CompositionFlowRoute, layout: CompositionLayoutTemplate): string[] {
  return route.slotsByLayout?.[layout.id] ?? route.slots;
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Build the page-qualified identifier for one slot.
 */
export function slotId(page: number, id: string): string {
  return `${page}:${id}`;
}

/** Resolve a mutable slot box, falling back to the compiled definition. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current slotBox implementation intact until its target seam is extracted.
 */
export function slotBox(pageState: PageState, definition: CompositionSlotTemplate): CompositionRect {
  return pageState.slots.get(definition.id)?.box ?? definition.box;
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Materialize the mutable slots for one compiled layout.
 */
function newPage(page: number, layout: CompositionLayoutTemplate): PageState {
  const slots = new Map<string, CompositionSlot>();
  for (const definition of layout.slots) {
    slots.set(definition.id, {
      id: slotId(page, definition.id),
      page,
      regionId: definition.regionId,
      ...(definition.flowId === undefined ? {} : { flowId: definition.flowId }),
      kind: definition.kind,
      ...(definition.allowedRoles === undefined ? {} : { allowedRoles: [...definition.allowedRoles] }),
      ...(definition.allowedBlockIds === undefined ? {} : { allowedBlockIds: [...definition.allowedBlockIds] }),
      ...(definition.allowedBlockKinds === undefined ? {} : { allowedBlockKinds: [...definition.allowedBlockKinds] }),
      box: { ...definition.box },
      state: 'open',
    });
  }
  return { page, layout, slots };
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Ensure that all pages through the requested page exist.
 */
export function ensurePage(
  pages: PageState[],
  template: CompositionTemplate,
  route: CompositionFlowRoute,
  page: number,
  diagnostics: CompositionDiagnostic[],
  flowId: string,
): PageState | undefined {
  while (pages.length < page) {
    const nextPage = pages.length + 1;
    const layout = routeLayout(route, template, nextPage);
    if (!layout) {
      diagnostics.push(diagnostic('error', 'LAYOUT_NOT_FOUND', `Flow '${flowId}' has no layout for page ${nextPage}.`, { flowId, page: nextPage }));
      return undefined;
    }
    pages.push(newPage(nextPage, layout));
  }
  return pages[page - 1];
}

export { rectBottom, rectsOverlap } from '../geometry/rectangles.js';

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Validate all configured vertical slot-growth targets.
 */
export function validateGrowthPolicies(template: CompositionTemplate, plan: CompositionPlan): void {
  const checked = new Set<string>();
  const validateLayout = (layout: CompositionLayoutTemplate, page?: number): void => {
    const key = `${page ?? 'template'}:${layout.id}`;
    if (checked.has(key)) return;
    checked.add(key);
    const slotIds = new Set(layout.slots.map((slot) => slot.id));
    for (const slot of layout.slots) {
      const growth = slot.grow;
      if (!growth) continue;
      if (growth.axis !== 'y' || !Number.isFinite(growth.maxHeight) || growth.maxHeight < slot.box.height) {
        plan.diagnostics.push(diagnostic('error', 'GROW_POLICY_INVALID', `Slot '${slot.id}' has an invalid vertical growth limit.`, { slotId: slot.id, details: { layoutId: layout.id, page } }));
      }
      for (const pushedId of growth.pushes ?? []) {
        if (!slotIds.has(pushedId) || pushedId === slot.id) {
          plan.diagnostics.push(diagnostic('error', 'GROW_TARGET_NOT_FOUND', `Slot '${slot.id}' cannot push '${pushedId}' in layout '${layout.id}'.`, { slotId: slot.id, details: { pushedId, layoutId: layout.id, page } }));
        }
      }
    }
  };
  for (const layout of template.layouts) validateLayout(layout);
  for (const page of Object.keys(template.pageSlotOverlays ?? {}).map(Number).filter(Number.isInteger)) {
    const route = template.routes.main ?? Object.values(template.routes)[0];
    const layout = route ? routeLayout(route, template, page) : undefined;
    if (layout) validateLayout(layout, page);
  }
}

/** Return whether a block requires an atomic/block slot. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current isAtomicBlock implementation intact until its target seam is extracted.
 */
export function isAtomicBlock(block: CompositionBlock): boolean {
  return block.atomic === true || block.kind === 'metric' || block.kind === 'chart';
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current requiresBlockSlot implementation intact until its target seam is extracted.
 */
function requiresBlockSlot(block: CompositionBlock): boolean {
  return isAtomicBlock(block) && (block.kind !== 'image' || block.role === 'chart' || block.role === 'metric');
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current blockMatchesAllowedId implementation intact until its target seam is extracted.
 */
function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current routeHasBlockSlot implementation intact until its target seam is extracted.
 */
function routeHasBlockSlot(layout: CompositionLayoutTemplate, slotIds: string[]): boolean {
  return slotIds.some((id) => layout.slots.some((slot) => slot.id === id && slot.kind === 'block'));
}

/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current slotMatchesBlock implementation intact until its target seam is extracted.
 */
function slotMatchesBlock(
  definition: CompositionSlotTemplate,
  hasBlockSlot: boolean,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): boolean {
  if (definition.flowId !== undefined && definition.flowId !== flowId) return false;
  if (definition.allowedRoles?.includes('quote') && slots?.get(definition.id)?.state === 'exhausted') return false;
  if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) return false;
  if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) return false;
  if (definition.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') return false;
  if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) return false;
  if (definition.kind === 'text' && hasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !definition.allowedBlockKinds?.includes(block.kind)) return false;
  return true;
}

/** Select the first compatible slot without changing page or plan state. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current slotFor implementation intact until its target seam is extracted.
 */
export function slotFor(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): { definition: CompositionSlotTemplate; routeIndex: number } | undefined {
  const hasBlockSlot = routeHasBlockSlot(layout, slotIds);
  for (let index = routeIndex; index < slotIds.length; index += 1) {
    const definition = layout.slots.find((slot) => slot.id === slotIds[index]);
    if (definition && slotMatchesBlock(definition, hasBlockSlot, flowId, block, slots)) return { definition, routeIndex: index };
  }
  return undefined;
}

/** Report whether a compatible slot remains from a route position onward. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current hasRoleEligibleSlot implementation intact until its target seam is extracted.
 */
export function hasRoleEligibleSlot(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): boolean {
  const hasBlockSlot = routeHasBlockSlot(layout, slotIds);
  return slotIds.slice(routeIndex).some((id) => layout.slots.some((slot) => {
    return slot.id === id && slotMatchesBlock(slot, hasBlockSlot, flowId, block, slots);
  }));
}

/** Advance to the next route slot, wrapping to the next page when necessary. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Keep the current advanceCursor implementation intact until its target seam is extracted.
 */
export function advanceCursor(cursor: FlowCursor, routeSlotsForPage: string[]): void {
  cursor.routeIndex += 1;
  cursor.resumeY = undefined;
  cursor.resumeSlotId = undefined;
  if (cursor.routeIndex >= routeSlotsForPage.length) {
    cursor.routeIndex = 0;
    cursor.page += 1;
    cursor.resumeY = undefined;
  }
}

/** Apply one legal slot-growth operation, move pushed slots, and record it. */
/**
 * @planner-target composition/layout/page-state.ts
 * @planner-responsibility Apply one legal slot-growth operation and move affected slots.
 */
export function growSlot(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  requiredBottom: number,
): void {
  const { currentPage, definition } = target;
  const slot = currentPage.slots.get(definition.id);
  if (!slot) return;
  const growth = definition.grow;
  if (!growth || growth.axis !== 'y') return;
  const maxBottom = definition.box.y + growth.maxHeight;
  const nextBottom = Math.min(maxBottom, Math.max(rectBottom(slot.box), requiredBottom));
  const delta = nextBottom - rectBottom(slot.box);
  if (delta <= 0) return;
  slot.box.height += delta;
  for (const pushedId of growth.pushes ?? []) {
    const pushed = currentPage.slots.get(pushedId);
    if (!pushed) continue;
    pushed.box.y += delta;
    const pushedDefinition = currentPage.layout.slots.find((candidate) => candidate.id === pushedId);
    if (pushedDefinition?.kind !== 'text') continue;
    pushed.box.height = Math.max(0, pushed.box.height - delta);
    if (pushed.box.height === 0) pushed.state = 'exhausted';
  }
  recordFlowDecision(context, 'SLOT_GROWN', runtime, target);
}
