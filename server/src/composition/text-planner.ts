import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionMovableInsertionFrame,
  CompositionMovableGraphicFrame,
  CompositionFlowBarrierBoxCandidate,
  CompositionDiagnostic,
  CompositionGraphicPlacement,
  CompositionLine,
  CompositionPlan,
  CompositionPlacement,
  CompositionPlanner,
  CompositionSlot,
  CompositionTextMetrics,
  CompositionWordRange,
} from './engine.js';
import { polygonPoints } from './graphic-geometry.js';
import { compositionStyleName } from './style-name.js';
import {
  flowBarrierBoxCandidatesForSlot,
  registerFlowBarrierBoxCandidates,
  registerFlowPlacements,
} from './flow-barriers.js';
import { placeGlyphObjects } from './glyph-objects.js';
import { glyphSamplingBoxes } from './glyph-sampling.js';
import { hasRoleEligibleSlot, isAtomicBlock, slotFor } from './route-slots.js';
import { insertionKey, nextInsertionBoundary, nextInsertionProposal } from './insertion-order.js';
import { obstructionAcrossLineBands, wrapText, type WrappedLine } from './text-wrapping.js';
import { availableLineCount } from './line-capacity.js';
import { recordPlanningPhase, tracePlan } from './planning-trace.js';
import { placeStructuredBlock } from './structured-block-placement.js';
import {
  movableInsertionProposalCandidates,
  movableInsertionProposalRefinements,
  movableInsertionProposalSignature,
  movableGraphicProposalCandidates,
  movableGraphicProposalRefinements,
  type MovableGraphicPolicy,
  type MovableInsertionBounds,
  type PlannedGraphic,
  type PlannedInsertion,
} from './text-planner-candidates.js';
import { planFlow } from './flow-planner.js';

export type { MovableGraphicPolicy, MovableInsertionBounds } from './text-planner-candidates.js';

export interface TextCompositionPlannerPolicy {
  minimumLinesAtStart?: number;
  minimumLinesAtEnd?: number;
  keepListItemsTogether?: boolean;
  /** Minimum width of a side interval that may receive wrapped text. */
  minimumWrapWidth?: number;
  /** Default number of following lines kept with a heading when unspecified. */
  headingKeepWithNextLines?: number;
  /** Number of complete layout passes allowed for obstacle stabilization. */
  maxPlanningIterations?: number;
  /** A non-final fragment must retain at least this many lines. */
  minimumFragmentLines?: number;
  /** Tolerance for renderer-neutral geometry comparisons, in planner units. */
  geometryTolerance?: number;
  /**
   * Optional legal frame for an insertion. The key is the existing
   * `flow:block` insertion key; every generated position is planned and
   * evaluated as a complete candidate.
   */
  movableInsertionBounds?: Record<string, MovableInsertionBounds>;
  /** Optional legal frames for authored graphics with an explicit size. */
  movableGraphicBounds?: MovableGraphicPolicy;
}

export interface PageState {
  page: number;
  layout: CompositionLayoutTemplate;
  slots: Map<string, CompositionSlot>;
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current wordsOf implementation intact until its target seam is extracted.
 */
function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current textOf implementation intact until its target seam is extracted.
 */
function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

/**
 * @planner-target composition/style-name.ts
 * @planner-responsibility Keep the current styleFor implementation intact until its target seam is extracted.
 */
export function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Keep the current diagnostic implementation intact until its target seam is extracted.
 */
export function diagnostic(
  severity: CompositionDiagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<CompositionDiagnostic> = {},
): CompositionDiagnostic {
  return { severity, code, message, ...extra };
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current layoutById implementation intact until its target seam is extracted.
 */
function layoutById(template: CompositionTemplate, id: string): CompositionLayoutTemplate | undefined {
  return template.layouts.find((layout) => layout.id === id);
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current routeLayout implementation intact until its target seam is extracted.
 */
export function routeLayout(route: CompositionFlowRoute, template: CompositionTemplate, page: number): CompositionLayoutTemplate | undefined {
  const layoutId = route.layouts?.[Math.min(page - 1, route.layouts.length - 1)] ?? template.layouts[0]?.id;
  return layoutId ? layoutById(template, layoutId) : undefined;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current routeSlots implementation intact until its target seam is extracted.
 */
export function routeSlots(route: CompositionFlowRoute, layout: CompositionLayoutTemplate): string[] {
  return route.slotsByLayout?.[layout.id] ?? route.slots;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current slotId implementation intact until its target seam is extracted.
 */
function slotId(page: number, id: string): string {
  return `${page}:${id}`;
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current lineHeight implementation intact until its target seam is extracted.
 */
export function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current textPadding implementation intact until its target seam is extracted.
 */
export function textPadding(metrics: CompositionTextMetrics, block: CompositionBlock): { top: number; bottom: number } {
  const padding = metrics.textPadding?.(styleFor(block)) ?? { top: 0, bottom: 0 };
  if (!Number.isFinite(padding.top) || !Number.isFinite(padding.bottom) || padding.top < 0 || padding.bottom < 0) {
    throw new Error(`Text metrics returned invalid padding for '${styleFor(block)}': ${JSON.stringify(padding)}.`);
  }
  return padding;
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current wrapBlock implementation intact until its target seam is extracted.
 */
export function wrapBlock(
  metrics: CompositionTextMetrics,
  block: CompositionBlock,
  startWord: number,
  slot: CompositionRect,
  startLineOffset: number,
  bottom: number,
  graphics: CompositionGraphicPlacement[],
  lineHeightValue: number,
  minimumWrapWidth = 0,
  flowBarrierBoxCandidates: CompositionFlowBarrierBoxCandidate[] = [],
  geometryTolerance = 0,
): WrappedLine[] {
  return wrapText(
    metrics,
    textOf(block),
    styleFor(block),
    startWord,
    slot,
    startLineOffset,
    bottom,
    graphics,
    lineHeightValue,
    minimumWrapWidth,
    flowBarrierBoxCandidates,
    geometryTolerance,
  );
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Keep the current wordsForBlock implementation intact until its target seam is extracted.
 */
export function wordsForBlock(block: CompositionBlock): string[] {
  return wordsOf(textOf(block));
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current newPage implementation intact until its target seam is extracted.
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
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current fitInsertionProposal implementation intact until its target seam is extracted.
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
  const leading = lineHeight(metrics, block);
  const padding = textPadding(metrics, block);
  const measurementBox = definition.grow?.axis === 'y'
    ? { ...proposal.box, height: Math.max(proposal.box.height, definition.grow.maxHeight) }
    : proposal.box;
  const contentBox = {
    ...measurementBox,
    y: measurementBox.y + padding.top,
    height: Math.max(0, measurementBox.height - padding.top - padding.bottom),
  };
  const lines = wrapBlock(metrics, block, 0, contentBox, 0, rectBottom(contentBox), [], leading);
  if (lines.length === 0) return proposal;
  const contentHeight = (lines.at(-1)!.lineOffset + 1) * leading;
  const maximumHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : proposal.box.height;
  return {
    ...proposal,
    box: {
      ...proposal.box,
      height: Math.min(maximumHeight, padding.top + contentHeight + padding.bottom),
    },
  };
}

type InsertionSlotCandidate = {
  page: number;
  slotId: string;
  box: CompositionRect;
};

/**
 * @planner-target composition/insertion-planning.ts
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
 * Read the insertion proposal produced by a previous planning pass. The
 * proposal is deliberately derived from the plan rather than from a fixed
 * page number: changing text metrics or a preceding block must be able to
 * move the proposal on the next pass.
 */
/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current insertionProposalsFromPlan implementation intact until its target seam is extracted.
 */
function insertionProposalsFromPlan(document: CompositionDocument, template: CompositionTemplate, plan: CompositionPlan, metrics: CompositionTextMetrics): Map<string, PlannedInsertion> {
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

type MovableBoundsPolicy = {
  bounds?: CompositionRect;
  candidateCount: number;
};

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Validate one family of movable placement frames and emit its domain-specific diagnostics.
 */
function validateMovableBounds(
  proposals: Map<string, { box: CompositionRect }>,
  policies: Record<string, MovableBoundsPolicy>,
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Validate movable insertion frames.
 */
function validateMovableInsertionBounds(
  insertionProposals: Map<string, PlannedInsertion>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  validateMovableBounds(insertionProposals, policy.movableInsertionBounds ?? {}, plan, 'insertion');
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Validate movable graphic frames.
 */
function validateMovableGraphicBounds(
  graphicProposals: Map<string, PlannedGraphic>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  validateMovableBounds(graphicProposals, policy.movableGraphicBounds ?? {}, plan, 'graphic');
}

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current graphicBox implementation intact until its target seam is extracted.
 */
function graphicBox(graphic: NonNullable<CompositionDocument['graphics']>[number], slot: CompositionSlotTemplate): CompositionRect {
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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Find the graphic slot definition on one materialized page.
 */
function graphicDefinitionForPage(pageState: PageState, graphic: DocumentGraphic): CompositionSlotTemplate | undefined {
  const definition = pageState.layout.slots.find((slot) => slot.id === graphic.slotId);
  return definition?.kind === 'graphic' ? definition : undefined;
}

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Validate shape-specific graphic parameters.
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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Check whether a proposed graphic box remains inside its slot.
 */
function graphicBoxFitsSlot(box: CompositionRect, definition: CompositionSlotTemplate): boolean {
  return box.x >= definition.box.x
    && box.y >= definition.box.y
    && box.x + box.width <= definition.box.x + definition.box.width
    && box.y + box.height <= definition.box.y + definition.box.height;
}

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Build the renderer-neutral placement record for a graphic.
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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Validate and materialize one graphic on its target page.
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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current seedGraphicProposals implementation intact until its target seam is extracted.
 */
function seedGraphicProposals(document: CompositionDocument, template: CompositionTemplate): Map<string, PlannedGraphic> {
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

/**
 * Seed hard insertions in reading order. This is intentionally independent of
 * the amount of main text: otherwise the first pass can fill a future quote
 * band and only discover the quote after the band is no longer available.
 */
/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Keep the current seedInsertionProposals implementation intact until its target seam is extracted.
 */
function seedInsertionProposals(document: CompositionDocument, template: CompositionTemplate, metrics: CompositionTextMetrics): Map<string, PlannedInsertion> {
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
 * Reserve hard insertion geometry before any ordinary flow receives a line.
 * A quote is still rendered from its source block later, but its rectangle is
 * already an exclusion boundary while the main stream is being planned.
 */
/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Reserve insertion rectangles that must obstruct flowing content.
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
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Collapse open insertion slots without an authored proposal on their page.
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
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Reserve all planned insertion rectangles and collapse unused slots.
 */
function reserveInsertionObstacles(
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  proposals: Map<string, PlannedInsertion>,
): void {
  for (const proposal of proposals.values()) reserveInsertionObstacle(template, pages, plan, proposal);
  collapseUnassignedInsertionSlots(template, pages, plan, proposals);
}

/**
 * Lay out authored insertions before the ordinary flow.  The old planner only
 * reserved their rectangles and then sent the quote back through the main
 * block loop, which made a quote look like another route segment and allowed
 * the text cursor to decide its placement.  Here the quote is measured and
 * painted as a separate layer first; the main cursor only sees its obstacle.
 */
/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Validate, measure, and materialize planned insertion blocks on a page.
 */
type InsertionBlockTarget = {
  key: string;
  proposal: PlannedInsertion;
  page: PageState;
  definition: CompositionSlotTemplate;
  slot: CompositionSlot;
};

/**
 * @planner-target composition/insertion-planning.ts
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

type MeasuredInsertionBlock = {
  leading: number;
  padding: { top: number; bottom: number };
  lines: ReturnType<typeof wrapBlock>;
  wordCount: number;
  consumed: number;
};

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Measure one insertion against its planned obstacle box.
 */
function measureInsertionBlock(
  metrics: CompositionTextMetrics,
  target: InsertionBlockTarget,
  block: CompositionBlock,
): MeasuredInsertionBlock {
  const { definition, slot } = target;
  const leading = lineHeight(metrics, block);
  const padding = textPadding(metrics, block);
  const measurementBox = definition.fitContent && definition.grow?.axis === 'y'
    ? { ...slot.box, height: Math.max(slot.box.height, definition.grow.maxHeight) }
    : slot.box;
  const contentBox = {
    ...measurementBox,
    y: measurementBox.y + padding.top,
    height: Math.max(0, measurementBox.height - padding.top - padding.bottom),
  };
  const lines = wrapBlock(metrics, block, 0, contentBox, 0, rectBottom(contentBox), [], leading);
  return { leading, padding, lines, wordCount: wordsForBlock(block).length, consumed: lines.at(-1)?.endWord ?? 0 };
}

/**
 * @planner-target composition/insertion-planning.ts
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
  plan.decisions.push({
    code: 'INSERTION_SLOT_FIT_CONTENT',
    flowId: proposal.flowId,
    blockId: block.id,
    page: page.page,
    slotId: slot.id,
    fromHeight: proposal.box.height,
    toHeight: fittedHeight,
    contentHeight,
    maxHeight,
  });
}

/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Synchronize a materialized insertion obstacle with its fitted slot box.
 */
function synchronizeInsertionObstacle(plan: CompositionPlan, target: InsertionBlockTarget, block: CompositionBlock): void {
  const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === target.page.page);
  if (obstacle) obstacle.box = { ...target.slot.box };
}

/**
 * @planner-target composition/insertion-planning.ts
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
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Validate, measure, and materialize planned insertion blocks on a page.
 */
function placeInsertionLayer(
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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current absoluteGraphicPoints implementation intact until its target seam is extracted.
 */
function absoluteGraphicPoints(graphic: { points?: Array<{ x: number; y: number }> }, box: CompositionRect): Array<{ x: number; y: number }> | undefined {
  if (!graphic.points || graphic.points.length < 3) return undefined;
  return graphic.points.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height }));
}

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

/**
 * @planner-target composition/graphic-planning.ts
 * @planner-responsibility Keep the current materializeGraphicPages implementation intact until its target seam is extracted.
 */
function materializeGraphicPages(
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

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current ensurePage implementation intact until its target seam is extracted.
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
 * @planner-responsibility Keep the current rectBottom implementation intact until its target seam is extracted.
 */
export function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current rectsOverlap implementation intact until its target seam is extracted.
 */
export function rectsOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(first.width), Math.abs(first.height), Math.abs(second.x), Math.abs(second.y), Math.abs(second.width), Math.abs(second.height));
  return horizontal > Number.EPSILON * scale * 32 && vertical > Number.EPSILON * scale * 32;
}







/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Keep the current placeLines implementation intact until its target seam is extracted.
 */
type LinePlacementGeometry = {
  firstY: number;
  lastBottom: number;
  left: number;
  right: number;
  verticalOffset: number;
};

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Calculate the shared placement geometry for a batch of wrapped lines.
 */
function linePlacementGeometry(
  slot: CompositionSlot,
  definition: CompositionSlotTemplate,
  lines: WrappedLine[],
  lineHeightValue: number,
  padding: { top: number; bottom: number },
): LinePlacementGeometry {
  const box = slot.box;
  const first = lines[0];
  const last = lines.at(-1)!;
  const contentHeight = (last.lineOffset - first.lineOffset + 1) * lineHeightValue;
  const freeHeight = Math.max(0, box.height - padding.top - padding.bottom - contentHeight);
  const verticalOffset = definition.verticalAlign === 'middle'
    ? freeHeight / 2
    : definition.verticalAlign === 'bottom'
      ? freeHeight
      : 0;
  return {
    firstY: box.y + padding.top + first.lineOffset * lineHeightValue + verticalOffset,
    lastBottom: box.y + padding.top + (last.lineOffset + 1) * lineHeightValue + verticalOffset,
    left: Math.min(...lines.map((line) => line.x)),
    right: Math.max(...lines.map((line) => line.x + line.width)),
    verticalOffset,
  };
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Resolve the aligned x-coordinate for one wrapped line.
 */
function alignedLineX(definition: CompositionSlotTemplate, line: WrappedLine): number {
  return definition.textAlign === 'right'
    ? line.x + line.width - line.naturalWidth
    : definition.textAlign === 'center'
      ? line.x + (line.width - line.naturalWidth) / 2
      : line.x;
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Append renderer-neutral line records for one placed line batch.
 */
function appendPlacedLines(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  flowId: string,
  routeIndex: number | undefined,
  lines: WrappedLine[],
  lineHeightValue: number,
  padding: { top: number; bottom: number },
  verticalOffset: number,
  outputLines: CompositionLine[],
  layer: 'flow' | 'insertion',
): void {
  const slot = pageState.slots.get(definition.id)!;
  lines.forEach((line) => {
    const lineY = slot.box.y + padding.top + line.lineOffset * lineHeightValue + verticalOffset;
    const textX = alignedLineX(definition, line);
    outputLines.push({
      blockId: block.id,
      flowId,
      slotId: slot.id,
      page: pageState.page,
      ...(routeIndex === undefined ? {} : { routeIndex }),
      text: line.text,
      box: {
        x: line.x,
        y: lineY,
        width: line.width,
        height: lineHeightValue,
      },
      ...(definition.textAlign ? { textAlign: definition.textAlign } : {}),
      naturalWidth: line.naturalWidth,
      startWord: line.startWord,
      endWord: line.endWord,
      glyphSamplingBoxes: glyphSamplingBoxes(metrics, block, line.text, textX, lineY, line.naturalWidth, lineHeightValue),
      ...(layer === 'flow' ? {} : { layer }),
    });
  });
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Update slot occupancy after line placement.
 */
function markLinePlacementOccupancy(slot: CompositionSlot, lastBottom: number): void {
  slot.state = lastBottom >= rectBottom(slot.box) ? 'exhausted' : 'partial';
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Place wrapped lines, then update slot occupancy.
 */
export function placeLines(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  flowId: string,
  routeIndex: number | undefined,
  lines: WrappedLine[],
  lineHeightValue: number,
  placements: CompositionPlacement[],
  outputLines: CompositionLine[],
  layer: 'flow' | 'insertion' = 'flow',
  padding: { top: number; bottom: number } = { top: 0, bottom: 0 },
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot || lines.length === 0) return;
  const geometry = linePlacementGeometry(slot, definition, lines, lineHeightValue, padding);
  placements.push({
    id: `placement:${placements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    page: pageState.page,
    ...(routeIndex === undefined ? {} : { routeIndex }),
    box: { x: geometry.left, y: geometry.firstY, width: geometry.right - geometry.left, height: geometry.lastBottom - geometry.firstY },
    startWord: lines[0].startWord,
    endWord: lines.at(-1)!.endWord,
    ...(layer === 'flow' ? {} : { layer }),
  });
  appendPlacedLines(pageState, definition, block, metrics, flowId, routeIndex, lines, lineHeightValue, padding, geometry.verticalOffset, outputLines, layer);
  markLinePlacementOccupancy(slot, geometry.lastBottom);
}

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Keep the current addResidual implementation intact until its target seam is extracted.
 */
export function addResidual(
  residualContent: CompositionPlan['residualContent'],
  flowId: string,
  block: CompositionBlock,
  startWord: number,
  lastLegalSlotId: string | undefined,
  reason: string,
): void {
  const end = wordsForBlock(block).length;
  if (startWord >= end) return;
  const consumed: CompositionWordRange = { start: 0, end: startWord };
  const remaining: CompositionWordRange = { start: startWord, end };
  residualContent.push({ flowId, blockId: block.id, reason, consumed, remaining, ...(lastLegalSlotId ? { lastLegalSlotId } : {}) });
}

/**
 * @planner-target composition/planning-records.ts
 * @planner-responsibility Keep the current addTableResidual implementation intact until its target seam is extracted.
 */
export function addTableResidual(
  residualContent: CompositionPlan['residualContent'],
  flowId: string,
  block: CompositionBlock,
  startRow: number,
  lastLegalSlotId: string | undefined,
  reason: string,
): void {
  const end = block.table?.body.length ?? 0;
  if (startRow >= end) return;
  residualContent.push({ flowId, blockId: block.id, reason, remainingRows: { start: startRow, end }, ...(lastLegalSlotId ? { lastLegalSlotId } : {}) });
}


/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Keep the current createPlan implementation intact until its target seam is extracted.
 */
function createPlan(minimumFragmentLines?: number): CompositionPlan {
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

/**
 * @planner-target composition/document-layout.ts
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

/**
 * @planner-target composition/page-management.ts
 * @planner-responsibility Keep the current validateGrowthPolicies implementation intact until its target seam is extracted.
 */
function validateGrowthPolicies(template: CompositionTemplate, plan: CompositionPlan): void {
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

/**
 * @planner-target composition/document-layout.ts
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Tell whether a plan has any error diagnostics.
 */
function planHasErrors(plan: CompositionPlan): boolean {
  return plan.diagnostics.some((item) => item.severity === 'error');
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Materialize movable insertion frames from the active policy and proposals.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Materialize movable graphic frames from the active policy and proposals.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Reject quote blocks that are not owned by a non-main insertion flow.
 */
function validateQuoteFlowContracts(
  document: CompositionDocument,
  template: CompositionTemplate,
  plan: CompositionPlan,
): void {
  if (template.routes.main?.insertionSlots?.length) {
    plan.diagnostics.push(diagnostic(
      'error',
      'MAIN_FLOW_INSERTIONS_FORBIDDEN',
      "The main flow cannot declare insertion slots; use a separate insertion flow.",
      { flowId: 'main' },
    ));
  }
  for (const [flowId, flow] of Object.entries(document.flows)) {
    for (const block of flow.blocks) {
      if (block.role !== 'quote') continue;
      if (flowId === 'main') {
        plan.diagnostics.push(diagnostic(
          'error',
          'MAIN_FLOW_QUOTE_FORBIDDEN',
          `Quote block '${block.id}' must be supplied by a flow other than 'main'.`,
          { flowId, blockId: block.id },
        ));
        continue;
      }
      if (template.routes[flowId]?.insertionSlots?.length) continue;
      plan.diagnostics.push(diagnostic(
        'error',
        'QUOTE_INSERTION_FLOW_REQUIRED',
        `Quote block '${block.id}' must belong to a flow with insertion slots.`,
        { flowId, blockId: block.id },
      ));
    }
  }
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Attach candidate frames and run all preflight validations for one layout pass.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Create the first document page and reserve planned insertion obstacles.
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
  // A rendered document always has a first page, even when all content
  // flows are empty. This keeps the planner's page count aligned with the
  // PDF backend's initial jsPDF page.
  const firstRoute = template.routes.main ?? Object.values(template.routes)[0];
  if (firstRoute) ensurePage(pages, template, firstRoute, 1, plan.diagnostics, 'document');
  reserveInsertionObstacles(template, pages, plan, insertionProposals);
  recordPlanningPhase(plan, 'obstacle-reservation', planHasErrors(plan) ? 'failed' : 'completed', { obstacleCount: plan.graphicPlacements.filter((graphic) => graphic.graphicId.startsWith('insertion:')).length });
  return pages;
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Materialize all planned insertion text before ordinary flow placement.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Plan a repeated flow once for every already-materialized page.
 */
function planRepeatedFlow(
  context: DocumentFlowPlanningContext,
  flowId: string,
  route: CompositionFlowRoute,
): void {
  context.plan.repeatFlowIds?.push(flowId);
  const pageCount = Math.max(1, context.pages.length);
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= pageCount; page += 1) {
    planFlow(context.document, context.metrics, context.template, context.policy, flowId, { ...route, continuation: 'forbidden' }, context.pages, context.plan, page);
  }
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Validate and plan one ordinary flow from its configured start page.
 */
function planOrdinaryFlow(
  context: DocumentFlowPlanningContext,
  flowId: string,
  route: CompositionFlowRoute,
): void {
  if (route.startPage !== undefined && (!Number.isInteger(route.startPage) || route.startPage < 1 || route.startPage > context.template.maxPages)) {
    context.plan.diagnostics.push(diagnostic('error', 'FLOW_START_PAGE_INVALID', `Flow '${flowId}' has an invalid start page ${route.startPage}.`, { flowId }));
    return;
  }
  planFlow(context.document, context.metrics, context.template, context.policy, flowId, route, context.pages, context.plan, route.startPage ?? 1, Boolean(route.insertionSlots?.length));
}

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Dispatch one flow to its repeated or ordinary planning path.
 */
function planDocumentFlow(
  context: DocumentFlowPlanningContext,
  flowId: string,
  flow: CompositionDocument['flows'][string],
): void {
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Preserve the ordinary-before-repeated flow ordering and plan every document flow.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Finalize page, flow, barrier, glyph, and trace projections after flow planning.
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Coordinate one complete document-layout run from preflight through finalization.
 */
function planDocumentOnce(
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
  // Repeated chrome depends on the final number of pages. Plan all ordinary
  // flows first so a header/footer that starts on page 2 cannot observe the
  // provisional one-page document and silently disappear.
  planDocumentFlows(document, metrics, template, policy, pages, plan);
  finalizeDocumentPlan(document, metrics, template, pages, plan);
  return plan;
}

/**
 * @planner-target composition/text-planner.ts
 * @planner-responsibility Expose candidate planning while retaining the existing planner contract.
 */
export function createTextCompositionPlanner(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
): CompositionPlanner {
  /**
   * @planner-target composition/text-planner.ts
   * @planner-responsibility Keep the current planCandidates implementation intact until its target seam is extracted.
   */
  function planCandidates(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan[] {
    const maxIterations = policy.maxPlanningIterations ?? 1;
    if (!Number.isInteger(maxIterations) || maxIterations < 1) {
      const plan = createPlan(policy.minimumFragmentLines);
      plan.diagnostics.push(diagnostic('error', 'PLANNER_ITERATION_POLICY_INVALID', 'Planner iteration count must be a positive integer.', { details: { maxIterations } }));
      return [plan];
    }
    const candidates: CompositionPlan[] = [];
    const seededProposals = seedInsertionProposals(document, template, metrics);
    const seededGraphicProposals = seedGraphicProposals(document, template);
    const movableCandidates = movableInsertionProposalCandidates(seededProposals, policy.movableInsertionBounds ?? {});
    const movableGraphicCandidates = movableGraphicProposalCandidates(seededGraphicProposals, policy.movableGraphicBounds ?? {});
    if (movableCandidates.length > 1 || movableGraphicCandidates.length > 1) {
      return movableCandidates.flatMap((insertionSet) => movableGraphicCandidates.map((graphicSet) => planDocumentOnce(document, metrics, template, policy, insertionSet, graphicSet)));
    }
    let proposals = seededProposals;
    let previousSignature: string | undefined;
    let latestPlan = planDocumentOnce(document, metrics, template, policy, proposals, seededGraphicProposals);
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      candidates.push(latestPlan);
      const nextProposals = insertionProposalsFromPlan(document, template, latestPlan, metrics);
      const signature = movableInsertionProposalSignature(nextProposals);
      latestPlan.decisions.push({ code: 'PLANNER_PASS_COMPLETED', iteration, insertionCount: nextProposals.size, signature });
      recordPlanningPhase(latestPlan, 'reflow', 'completed', { insertionCount: nextProposals.size, signature }, iteration);
      if (signature === previousSignature || (iteration === 1 && nextProposals.size === 0)) {
        latestPlan.decisions.push({ code: 'PLANNER_STABILIZED', iteration, insertionCount: nextProposals.size });
        return candidates;
      }
      if (iteration === maxIterations) {
        recordPlanningPhase(latestPlan, 'reflow', 'failed', { insertionCount: nextProposals.size, signature, iterations: maxIterations }, iteration);
        latestPlan.diagnostics.push(diagnostic('error', 'PLANNER_DID_NOT_STABILIZE', `Planner did not stabilize after ${maxIterations} pass(es).`, { details: { iterations: maxIterations, insertionCount: nextProposals.size } }));
        return candidates;
      }
      proposals = nextProposals;
      previousSignature = signature;
      latestPlan = planDocumentOnce(document, metrics, template, policy, proposals, seededGraphicProposals);
    }
    return candidates;
  }

  return {
    /**
     * @planner-target composition/text-planner.ts
     * @planner-responsibility Keep the current plan implementation intact until its target seam is extracted.
     */
    plan(document, metrics) {
      return planCandidates(document, metrics).at(-1)!;
    },
    planCandidates,
    candidateRefinementRounds: Math.max(
      0,
      ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
      ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
    ),
    /**
     * @planner-target composition/text-planner.ts
     * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
     */
    planRefinedCandidates(document, metrics, selected, round) {
      const seededProposals = seedInsertionProposals(document, template, metrics);
      const seededGraphicProposals = seedGraphicProposals(document, template);
      const selectedPlacements = selected.graphicPlacements
        .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
        .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
      const selectedGraphicPlacements = selected.graphicPlacements
        .filter((graphic) => policy.movableGraphicBounds?.[graphic.graphicId] !== undefined)
        .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
      const insertionRefinements = movableInsertionProposalRefinements(seededProposals, selectedPlacements, policy.movableInsertionBounds ?? {}, round);
      const graphicRefinements = movableGraphicProposalRefinements(seededGraphicProposals, selectedGraphicPlacements, policy.movableGraphicBounds ?? {}, round);
      const insertionCandidates = insertionRefinements.length > 0 ? insertionRefinements : [seededProposals];
      const graphicCandidates = graphicRefinements.length > 0 ? graphicRefinements : [seededGraphicProposals];
      if (insertionRefinements.length === 0 && graphicRefinements.length === 0) return [];
      return insertionCandidates.flatMap((insertionSet) => graphicCandidates.map((graphicSet) => planDocumentOnce(document, metrics, template, policy, insertionSet, graphicSet)));
    },
  };
}
