import type {
  CompositionDocument,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionGraphicPlacement,
  CompositionPlan,
} from './engine.js';
import { polygonPoints } from './geometry/visual-geometry.js';
import { diagnostic } from './planning-records.js';
import { ensurePage, routeLayout, slotId } from './layout/page-state.js';
import type { PageState } from './contracts/layout-state.js';
import type { PlannedGraphic } from './text-planner-candidates.js';

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Calculate the default box for one authored graphic.
 */
function graphicBox(
  graphic: NonNullable<CompositionDocument['graphics']>[number],
  slot: CompositionSlotTemplate,
): CompositionRect {
  const width = graphic.size?.width ?? slot.box.width;
  const height = graphic.size?.height ?? slot.box.height;
  return {
    x: slot.box.x + (slot.box.width - width) / 2,
    y: slot.box.y + (slot.box.height - height) / 2,
    width,
    height,
  };
}

type DocumentGraphic = NonNullable<CompositionDocument['graphics']>[number];

/** Find the graphic slot definition on one materialized page. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current graphicDefinitionForPage implementation intact until its target seam is extracted.
 */
function graphicDefinitionForPage(pageState: PageState, graphic: DocumentGraphic): CompositionSlotTemplate | undefined {
  const definition = pageState.layout.slots.find((slot) => slot.id === graphic.slotId);
  return definition?.kind === 'graphic' ? definition : undefined;
}

/** Validate shape-specific graphic parameters. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current graphicShapeValidationError implementation intact until its target seam is extracted.
 */
function graphicShapeValidationError(graphic: DocumentGraphic): string | undefined {
  const invalidStar = !Number.isInteger(graphic.vertexCount)
    || (graphic.vertexCount ?? 0) < 3
    || graphic.innerRatio === undefined
    || graphic.innerRatio <= 0
    || graphic.innerRatio >= 1;
  if (graphic.shape === 'star' && invalidStar) {
    return `Star '${graphic.id}' needs a vertexCount of at least 3 and an innerRatio between 0 and 1.`;
  }
  const invalidPolygon = !graphic.points
    || graphic.points.length < 3
    || graphic.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1);
  if (graphic.shape === 'polygon' && invalidPolygon) {
    return `Polygon '${graphic.id}' needs at least three normalized points inside its slot.`;
  }
  return undefined;
}

/** Check whether a proposed graphic box remains inside its slot. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current graphicBoxFitsSlot implementation intact until its target seam is extracted.
 */
function graphicBoxFitsSlot(box: CompositionRect, definition: CompositionSlotTemplate): boolean {
  return box.x >= definition.box.x
    && box.y >= definition.box.y
    && box.x + box.width <= definition.box.x + definition.box.width
    && box.y + box.height <= definition.box.y + definition.box.height;
}

/** Build the renderer-neutral placement record for a graphic. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current createGraphicPlacement implementation intact until its target seam is extracted.
 */
function createGraphicPlacement(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  graphic: DocumentGraphic,
  box: CompositionRect,
): CompositionGraphicPlacement {
  const points = absoluteGraphicPoints(graphic, box);
  const placement: CompositionGraphicPlacement = {
    id: `graphic:${graphic.id}`,
    graphicId: graphic.id,
    ...(graphic.assetId === undefined ? {} : { assetId: graphic.assetId }),
    slotId: slotId(pageState.page, definition.id),
    page: pageState.page,
    shape: graphic.shape,
    wrap: graphic.wrap ?? 'around',
    box: { ...box },
    ...(points ? { points } : {}),
    ...(graphic.vertexCount === undefined ? {} : { vertexCount: graphic.vertexCount }),
    ...(graphic.innerRatio === undefined ? {} : { innerRatio: graphic.innerRatio }),
  };
  if (placement.shape !== 'ellipse' && placement.shape !== 'rectangle' && !placement.points) placement.points = polygonPoints(placement);
  return placement;
}

/** Validate and materialize one graphic on its target page. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current placeGraphicForPage implementation intact until its target seam is extracted.
 */
function placeGraphicForPage(
  document: CompositionDocument,
  pageState: PageState,
  plan: CompositionPlan,
  graphicProposals: Map<string, PlannedGraphic>,
  graphic: DocumentGraphic,
): void {
  if ((graphic.page ?? 1) !== pageState.page || plan.graphicPlacements.some((placement) => placement.graphicId === graphic.id)) return;
  const definition = graphicDefinitionForPage(pageState, graphic);
  if (!definition) {
    plan.diagnostics.push(diagnostic('error', 'GRAPHIC_SLOT_NOT_FOUND', `Graphic '${graphic.id}' cannot use graphic slot '${graphic.slotId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId }));
    return;
  }
  const shapeError = graphicShapeValidationError(graphic);
  if (shapeError) {
    plan.diagnostics.push(diagnostic('error', 'GRAPHIC_SHAPE_PARAMETER_INVALID', shapeError, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId }));
    return;
  }
  if (graphic.assetId !== undefined && !document.assets?.some((asset) => asset.id === graphic.assetId)) {
    plan.diagnostics.push(diagnostic('error', 'GRAPHIC_ASSET_NOT_FOUND', `Graphic '${graphic.id}' references missing asset '${graphic.assetId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId, details: { assetId: graphic.assetId } }));
    return;
  }
  const proposal = graphicProposals.get(graphic.id);
  const box = proposal?.box ?? graphicBox(graphic, definition);
  if (!graphicBoxFitsSlot(box, definition)) {
    plan.diagnostics.push(diagnostic('error', 'GRAPHIC_BOX_OUTSIDE_SLOT', `Graphic '${graphic.id}' leaves graphic slot '${graphic.slotId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId, details: { box, slot: definition.box } }));
    return;
  }
  plan.graphicPlacements.push(createGraphicPlacement(pageState, definition, graphic, box));
}

/** Materialize graphic proposals for one page and register their obstacles. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Materialize graphic proposals for one page and register their obstacles.
 */
export function placeGraphicsForPage(
  document: CompositionDocument,
  pageState: PageState,
  plan: CompositionPlan,
  graphicProposals: Map<string, PlannedGraphic> = new Map(),
): void {
  for (const graphic of document.graphics ?? []) placeGraphicForPage(document, pageState, plan, graphicProposals, graphic);
}

/** Seed authored graphic proposals from the main route's layout. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current seedGraphicProposals implementation intact until its target seam is extracted.
 */
export function seedGraphicProposals(document: CompositionDocument, template: CompositionTemplate): Map<string, PlannedGraphic> {
  const proposals = new Map<string, PlannedGraphic>();
  const route = template.routes.main ?? Object.values(template.routes)[0];
  if (!route) return proposals;
  for (const graphic of document.graphics ?? []) {
    const page = graphic.page ?? 1;
    const layout = routeLayout(route, template, page);
    const slot = layout?.slots.find((candidate) => candidate.id === graphic.slotId && candidate.kind === 'graphic');
    if (!slot) continue;
    proposals.set(graphic.id, { graphicId: graphic.id, page, slotId: graphic.slotId, box: graphicBox(graphic, slot) });
  }
  return proposals;
}

/** Convert normalized graphic points into page coordinates. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current absoluteGraphicPoints implementation intact until its target seam is extracted.
 */
function absoluteGraphicPoints(graphic: { points?: Array<{ x: number; y: number }> }, box: CompositionRect): Array<{ x: number; y: number }> | undefined {
  if (!graphic.points || graphic.points.length < 3) return undefined;
  return graphic.points.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height }));
}

/** Materialize all authored graphics on their configured pages. */
/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current materializeGraphicPages implementation intact until its target seam is extracted.
 */
export function materializeGraphicPages(
  document: CompositionDocument,
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  graphicProposals: Map<string, PlannedGraphic> = new Map(),
): void {
  const graphics = document.graphics ?? [];
  if (graphics.length === 0) return;
  const route = template.routes.main ?? Object.values(template.routes)[0];
  if (!route) {
    plan.diagnostics.push(diagnostic('error', 'GRAPHIC_ROUTE_NOT_FOUND', 'Graphics require at least one template flow route.', {}));
    return;
  }
  const pageNumbers = [...new Set(graphics.map((graphic) => graphic.page ?? 1))].sort((left, right) => left - right);
  for (const page of pageNumbers) {
    if (!Number.isInteger(page) || page < 1 || page > template.maxPages) {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_PAGE_OUT_OF_RANGE', `Graphic page '${page}' is outside the template page range.`, { page }));
      continue;
    }
    ensurePage(pages, template, route, page, plan.diagnostics, 'graphics');
  }
  for (const page of pages) placeGraphicsForPage(document, page, plan, graphicProposals);
}
