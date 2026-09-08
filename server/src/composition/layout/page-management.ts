import type {
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from '../model.js';
import type {
  CompositionDiagnostic,
  CompositionPlan,
  CompositionSlot,
} from '../engine.js';
import type { PageState } from '../contracts/layout-state.js';
import { diagnostic } from '../planning-records.js';
export type { PageState } from '../contracts/layout-state.js';

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Find one compiled layout by identifier.
 */
function layoutById(template: CompositionTemplate, id: string): CompositionLayoutTemplate | undefined {
  return template.layouts.find((layout) => layout.id === id);
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Resolve the layout assigned to one flow page.
 */
export function routeLayout(route: CompositionFlowRoute, template: CompositionTemplate, page: number): CompositionLayoutTemplate | undefined {
  const layoutId = route.layouts?.[Math.min(page - 1, route.layouts.length - 1)] ?? template.layouts[0]?.id;
  return layoutId ? layoutById(template, layoutId) : undefined;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Resolve the route slot identifiers for one layout.
 */
export function routeSlots(route: CompositionFlowRoute, layout: CompositionLayoutTemplate): string[] {
  return route.slotsByLayout?.[layout.id] ?? route.slots;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Build the page-qualified identifier for one slot.
 */
export function slotId(page: number, id: string): string {
  return `${page}:${id}`;
}

/** Resolve a mutable slot box, falling back to the compiled definition. */
/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current slotBox implementation intact until its target seam is extracted.
 */
export function slotBox(pageState: PageState, definition: CompositionSlotTemplate): CompositionRect {
  return pageState.slots.get(definition.id)?.box ?? definition.box;
}

/**
 * @planner-target composition/page-management.ts
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
 * @planner-target composition/page-management.ts
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

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Return the lower edge of a rectangle.
 */
export function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Determine whether two rectangles overlap with tolerance.
 */
export function rectsOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(first.width), Math.abs(first.height), Math.abs(second.x), Math.abs(second.y), Math.abs(second.width), Math.abs(second.height));
  return horizontal > Number.EPSILON * scale * 32 && vertical > Number.EPSILON * scale * 32;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Validate all configured vertical slot-growth targets.
 */
export function validateGrowthPolicies(template: CompositionTemplate, plan: CompositionPlan): void {
  for (const layout of template.layouts) {
    const slotIds = new Set(layout.slots.map((slot) => slot.id));
    for (const slot of layout.slots) {
      const growth = slot.grow;
      if (!growth) continue;
      if (growth.axis !== 'y' || !Number.isFinite(growth.maxHeight) || growth.maxHeight < slot.box.height) {
        plan.diagnostics.push(diagnostic('error', 'GROW_POLICY_INVALID', `Slot '${slot.id}' has an invalid vertical growth limit.`, { slotId: slot.id, details: { layoutId: layout.id } }));
      }
      for (const pushedId of growth.pushes ?? []) {
        if (!slotIds.has(pushedId) || pushedId === slot.id) {
          plan.diagnostics.push(diagnostic('error', 'GROW_TARGET_NOT_FOUND', `Slot '${slot.id}' cannot push '${pushedId}' in layout '${layout.id}'.`, { slotId: slot.id, details: { pushedId, layoutId: layout.id } }));
        }
      }
    }
  }
}
