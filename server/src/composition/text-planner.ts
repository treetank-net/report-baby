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

interface FlowCursor {
  blockIndex: number;
  startWord: number;
  startRow: number;
  page: number;
  routeIndex: number;
  /** The earliest y-coordinate available after an authored obstacle on this page. */
  resumeY?: number;
  /** The route slot whose local obstacle boundary produced resumeY. */
  resumeSlotId?: string;
}

interface PageState {
  page: number;
  layout: CompositionLayoutTemplate;
  slots: Map<string, CompositionSlot>;
}

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

function diagnostic(
  severity: CompositionDiagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<CompositionDiagnostic> = {},
): CompositionDiagnostic {
  return { severity, code, message, ...extra };
}

function layoutById(template: CompositionTemplate, id: string): CompositionLayoutTemplate | undefined {
  return template.layouts.find((layout) => layout.id === id);
}

function routeLayout(route: CompositionFlowRoute, template: CompositionTemplate, page: number): CompositionLayoutTemplate | undefined {
  const layoutId = route.layouts?.[Math.min(page - 1, route.layouts.length - 1)] ?? template.layouts[0]?.id;
  return layoutId ? layoutById(template, layoutId) : undefined;
}

function routeSlots(route: CompositionFlowRoute, layout: CompositionLayoutTemplate): string[] {
  return route.slotsByLayout?.[layout.id] ?? route.slots;
}

function insertionSlotFor(
  route: CompositionFlowRoute,
  layout: CompositionLayoutTemplate,
  pageState: PageState,
  plan: CompositionPlan,
  routeSlotIds: string[],
  routeIndex: number,
  document: CompositionDocument,
): CompositionSlotTemplate | undefined {
  const insertionIds = route.insertionSlots ?? [];
  if (insertionIds.length === 0) return undefined;
  const currentDefinition = layout.slots.find((slot) => slot.id === routeSlotIds[routeIndex]);
  const currentSlot = currentDefinition ? pageState.slots.get(currentDefinition.id) : undefined;
  const currentBottom = currentSlot
    ? contentStartBottom(pageState, plan, currentSlot, document)
    : Number.NEGATIVE_INFINITY;
  const candidates = insertionIds
    .map((id) => layout.slots.find((slot) => slot.id === id))
    .filter((slot): slot is CompositionSlotTemplate => slot !== undefined)
    .filter((slot) => slot.allowedRoles?.includes('quote') && pageState.slots.get(slot.id)?.state === 'open')
    .filter((slot) => {
      const occupied = [
        ...plan.lines,
        ...plan.blockPlacements,
        ...plan.tablePlacements,
      ].filter((item) => item.page === pageState.page);
      return !occupied.some((item) => rectsOverlap(item.box, slot.box));
    })
    .sort((left, right) => left.box.y - right.box.y)
    ;
  return candidates.find((slot) => slot.box.y + 0.001 >= currentBottom);
}

function slotId(page: number, id: string): string {
  return `${page}:${id}`;
}

function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

function textPadding(metrics: CompositionTextMetrics, block: CompositionBlock): { top: number; bottom: number } {
  const padding = metrics.textPadding?.(styleFor(block)) ?? { top: 0, bottom: 0 };
  if (!Number.isFinite(padding.top) || !Number.isFinite(padding.bottom) || padding.top < 0 || padding.bottom < 0) {
    throw new Error(`Text metrics returned invalid padding for '${styleFor(block)}': ${JSON.stringify(padding)}.`);
  }
  return padding;
}

function wrapBlock(
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

function wordsForBlock(block: CompositionBlock): string[] {
  return wordsOf(textOf(block));
}

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

/**
 * Read the insertion proposal produced by a previous planning pass. The
 * proposal is deliberately derived from the plan rather than from a fixed
 * page number: changing text metrics or a preceding block must be able to
 * move the proposal on the next pass.
 */
function insertionProposalsFromPlan(document: CompositionDocument, template: CompositionTemplate, plan: CompositionPlan, metrics: CompositionTextMetrics): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const candidates: Array<{ page: number; slotId: string; box: CompositionRect }> = [];
    const firstPage = route.startPage ?? 1;
    for (let page = firstPage; page <= template.maxPages; page += 1) {
      const layout = routeLayout(route, template, page);
      if (!layout) continue;
      for (const slotId of route.insertionSlots) {
        const slot = layout.slots.find((candidate) => candidate.id === slotId && candidate.allowedRoles?.includes('quote'));
        if (slot) candidates.push({ page, slotId, box: { ...slot.box } });
      }
    }
    candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x);
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

function validateMovableInsertionBounds(
  insertionProposals: Map<string, PlannedInsertion>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  for (const [key, movable] of Object.entries(policy.movableInsertionBounds ?? {})) {
    const proposal = insertionProposals.get(key);
    if (!proposal) {
      plan.diagnostics.push(diagnostic('error', 'MOVABLE_INSERTION_TARGET_NOT_FOUND', `Movable insertion policy '${key}' does not match a planned insertion.`, { details: { key } }));
      continue;
    }
    const { bounds } = movable;
    const validNumbers = [bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite);
    const validShape = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    const containsMeasuredBox = Boolean(bounds && proposal.box.width <= bounds.width && proposal.box.height <= bounds.height);
    if (!validNumbers || !validShape || !containsMeasuredBox || !Number.isInteger(movable.candidateCount) || movable.candidateCount < 1) {
      plan.diagnostics.push(diagnostic('error', 'MOVABLE_INSERTION_BOUNDS_INVALID', `Movable insertion frame '${key}' cannot contain its measured insertion box or candidate count.`, { details: { key, bounds, measuredBox: proposal.box, candidateCount: movable.candidateCount } }));
    }
  }
}

function validateMovableGraphicBounds(
  graphicProposals: Map<string, PlannedGraphic>,
  policy: TextCompositionPlannerPolicy,
  plan: CompositionPlan,
): void {
  for (const [key, movable] of Object.entries(policy.movableGraphicBounds ?? {})) {
    const proposal = graphicProposals.get(key);
    if (!proposal) {
      plan.diagnostics.push(diagnostic('error', 'MOVABLE_GRAPHIC_TARGET_NOT_FOUND', `Movable graphic policy '${key}' does not match a planned graphic.`, { details: { key } }));
      continue;
    }
    const { bounds } = movable;
    const validNumbers = [bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite);
    const validShape = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    const containsMeasuredBox = Boolean(bounds && proposal.box.width <= bounds.width && proposal.box.height <= bounds.height);
    if (!validNumbers || !validShape || !containsMeasuredBox || !Number.isInteger(movable.candidateCount) || movable.candidateCount < 1) {
      plan.diagnostics.push(diagnostic('error', 'MOVABLE_GRAPHIC_BOUNDS_INVALID', `Movable graphic frame '${key}' cannot contain its measured graphic box or candidate count.`, { details: { key, bounds, measuredBox: proposal.box, candidateCount: movable.candidateCount } }));
    }
  }
}

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
function seedInsertionProposals(document: CompositionDocument, template: CompositionTemplate, metrics: CompositionTextMetrics): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const candidates: Array<{ page: number; slotId: string; box: CompositionRect }> = [];
    const firstPage = route.startPage ?? 1;
    for (let page = firstPage; page <= template.maxPages; page += 1) {
      const layout = routeLayout(route, template, page);
      if (!layout) continue;
      for (const slotId of route.insertionSlots) {
        const slot = layout.slots.find((candidate) => candidate.id === slotId && candidate.allowedRoles?.includes('quote'));
        if (slot) candidates.push({ page, slotId, box: { ...slot.box } });
      }
    }
    candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x);
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
function reserveInsertionObstacles(
  template: CompositionTemplate,
  pages: PageState[],
  plan: CompositionPlan,
  proposals: Map<string, PlannedInsertion>,
): void {
  for (const proposal of proposals.values()) {
    const route = template.routes[proposal.flowId] ?? template.routes.main;
    if (!route) {
      plan.diagnostics.push(diagnostic('error', 'INSERTION_ROUTE_NOT_FOUND', `Insertion '${proposal.blockId}' has no route.`, { flowId: proposal.flowId, blockId: proposal.blockId }));
      continue;
    }
    const page = ensurePage(pages, template, route, proposal.page, plan.diagnostics, proposal.flowId);
    if (!page) continue;
    const definition = page.layout.slots.find((slot) => slot.id === proposal.slotId && slot.allowedRoles?.includes('quote'));
    const slot = definition ? page.slots.get(definition.id) : undefined;
    if (!definition || !slot) {
      plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Insertion '${proposal.blockId}' cannot reserve slot '${proposal.slotId}'.`, { flowId: proposal.flowId, blockId: proposal.blockId, page: proposal.page, slotId: proposal.slotId }));
      continue;
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
 * Lay out authored insertions before the ordinary flow.  The old planner only
 * reserved their rectangles and then sent the quote back through the main
 * block loop, which made a quote look like another route segment and allowed
 * the text cursor to decide its placement.  Here the quote is measured and
 * painted as a separate layer first; the main cursor only sees its obstacle.
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
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
      const key = insertionKey(flowId, block.id);
      const proposal = proposals.get(key);
      if (!proposal) {
        plan.diagnostics.push(diagnostic('error', 'INSERTION_PLAN_MISSING', `Insertion '${block.id}' has no planned obstacle slot.`, { flowId, blockId: block.id }));
        addResidual(plan.residualContent, flowId, block, 0, undefined, 'insertion-plan-missing');
        continue;
      }
      const page = ensurePage(pages, template, route, proposal.page, plan.diagnostics, flowId);
      const definition = page?.layout.slots.find((slot) => slot.id === proposal.slotId && slot.allowedRoles?.includes('quote'));
      const slot = definition && page ? page.slots.get(definition.id) : undefined;
      if (!page || !definition || !slot) {
        plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Insertion '${block.id}' cannot place its planned slot '${proposal.slotId}'.`, { flowId, blockId: block.id, page: proposal.page, slotId: proposal.slotId }));
        addResidual(plan.residualContent, flowId, block, 0, undefined, 'insertion-slot-not-found');
        continue;
      }
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
      const wordCount = wordsForBlock(block).length;
      const consumed = lines.at(-1)?.endWord ?? 0;
      if (consumed < wordCount) {
        plan.diagnostics.push(diagnostic('error', 'INSERTION_OVERFLOW', `Insertion '${block.id}' does not fit in its measured obstacle box.`, { flowId, blockId: block.id, page: page.page, slotId: slot.id, details: { consumed, wordCount, box: { ...slot.box } } }));
        addResidual(plan.residualContent, flowId, block, consumed, slot.id, 'insertion-overflow');
        continue;
      }
      if (definition.fitContent && lines.length > 0) {
        const contentHeight = (lines.at(-1)!.lineOffset + 1) * leading;
        const maxHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : slot.box.height;
        const fittedHeight = Math.min(maxHeight, padding.top + contentHeight + padding.bottom);
        slot.box.height = fittedHeight;
        plan.decisions.push({
          code: 'INSERTION_SLOT_FIT_CONTENT',
          flowId,
          blockId: block.id,
          page: page.page,
          slotId: slot.id,
          fromHeight: proposal.box.height,
          toHeight: fittedHeight,
          contentHeight,
          maxHeight,
        });
      }
      placeLines(page, definition, block, metrics, flowId, undefined, lines, leading, plan.placements, plan.insertionLines ?? (plan.insertionLines = []), 'insertion', padding);
      slot.state = 'exhausted';
      const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === page.page);
      if (obstacle) obstacle.box = { ...slot.box };
      plan.decisions.push({ code: 'INSERTION_LAYER_PLACED', flowId, blockId: block.id, page: page.page, slotId: slot.id, lineCount: lines.length, box: { ...slot.box } });
      placed.add(key);
    }
  }
  return placed;
}

function absoluteGraphicPoints(graphic: { points?: Array<{ x: number; y: number }> }, box: CompositionRect): Array<{ x: number; y: number }> | undefined {
  if (!graphic.points || graphic.points.length < 3) return undefined;
  return graphic.points.map((point) => ({ x: box.x + point.x * box.width, y: box.y + point.y * box.height }));
}

function placeGraphicsForPage(
  document: CompositionDocument,
  pageState: PageState,
  plan: CompositionPlan,
  graphicProposals: Map<string, PlannedGraphic> = new Map(),
): void {
  for (const graphic of document.graphics ?? []) {
    if ((graphic.page ?? 1) !== pageState.page || plan.graphicPlacements.some((placement) => placement.graphicId === graphic.id)) continue;
    const definition = pageState.layout.slots.find((slot) => slot.id === graphic.slotId);
    if (!definition || definition.kind !== 'graphic') {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_SLOT_NOT_FOUND', `Graphic '${graphic.id}' cannot use graphic slot '${graphic.slotId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId }));
      continue;
    }
    const invalidStar = !Number.isInteger(graphic.vertexCount) || (graphic.vertexCount ?? 0) < 3 || graphic.innerRatio === undefined || graphic.innerRatio <= 0 || graphic.innerRatio >= 1;
    if (graphic.shape === 'star' && invalidStar) {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_SHAPE_PARAMETER_INVALID', `Star '${graphic.id}' needs a vertexCount of at least 3 and an innerRatio between 0 and 1.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId }));
      continue;
    }
    if (graphic.shape === 'polygon' && (!graphic.points || graphic.points.length < 3 || graphic.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1))) {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_SHAPE_PARAMETER_INVALID', `Polygon '${graphic.id}' needs at least three normalized points inside its slot.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId }));
      continue;
    }
    if (graphic.assetId !== undefined && !document.assets?.some((asset) => asset.id === graphic.assetId)) {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_ASSET_NOT_FOUND', `Graphic '${graphic.id}' references missing asset '${graphic.assetId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId, details: { assetId: graphic.assetId } }));
      continue;
    }
    const proposal = graphicProposals.get(graphic.id);
    const box = proposal?.box ?? graphicBox(graphic, definition);
    if (box.x < definition.box.x || box.y < definition.box.y
      || box.x + box.width > definition.box.x + definition.box.width
      || box.y + box.height > definition.box.y + definition.box.height) {
      plan.diagnostics.push(diagnostic('error', 'GRAPHIC_BOX_OUTSIDE_SLOT', `Graphic '${graphic.id}' leaves graphic slot '${graphic.slotId}'.`, { blockId: graphic.id, page: pageState.page, slotId: graphic.slotId, details: { box, slot: definition.box } }));
      continue;
    }
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
    plan.graphicPlacements.push(placement);
  }
}

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

function ensurePage(
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

function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

function rectsOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(first.width), Math.abs(first.height), Math.abs(second.x), Math.abs(second.y), Math.abs(second.width), Math.abs(second.height));
  return horizontal > Number.EPSILON * scale * 32 && vertical > Number.EPSILON * scale * 32;
}

function slotCollidesWithPlacedBlock(pageState: PageState, slotId: string, plan: CompositionPlan, flowId?: string): boolean {
  const slot = pageState.slots.get(slotId);
  const box = slot?.box;
  if (!box) return false;
  return plan.lines.some((line) => line.layer !== 'insertion' && line.page === pageState.page && line.slotId !== slot.id && line.flowId !== flowId && rectsOverlap(box, line.box))
    || plan.blockPlacements.some((placement) => placement.page === pageState.page && placement.slotId !== slot.id && rectsOverlap(box, placement.box))
    || plan.tablePlacements.some((placement) => placement.page === pageState.page && placement.slotId !== slot.id && rectsOverlap(box, placement.box))
    || pageState.layout.slots.some((candidate) => candidate.reserved === true && candidate.id !== slot.id && rectsOverlap(box, candidate.box));
}

function slotBox(pageState: PageState, definition: CompositionSlotTemplate): CompositionRect {
  return pageState.slots.get(definition.id)?.box ?? definition.box;
}

function growSlot(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  requiredBottom: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  const growth = definition.grow;
  if (!growth || growth.axis !== 'y') return;
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  const maxBottom = definition.box.y + growth.maxHeight;
  const nextBottom = Math.min(maxBottom, Math.max(rectBottom(slot.box), requiredBottom));
  const delta = nextBottom - rectBottom(slot.box);
  if (delta <= 0) return;
  slot.box.height = nextBottom - slot.box.y;
  for (const pushedId of growth.pushes ?? []) {
    const pushed = pageState.slots.get(pushedId);
    if (!pushed) continue;
    pushed.box.y += delta;
    // Atomic/block slots have an intrinsic measured size.  Moving one must
    // not silently make it shorter than the backend can render; only text
    // slots are elastic after a preceding box grows.
    const pushedDefinition = pageState.layout.slots.find((candidate) => candidate.id === pushedId);
    if (pushedDefinition?.kind === 'text') {
      pushed.box.height = Math.max(0, pushed.box.height - delta);
      if (pushed.box.height === 0) pushed.state = 'exhausted';
    }
  }
  plan.decisions.push({
    code: 'SLOT_GROWN',
    flowId,
    blockId,
    slotId: slot.id,
    delta,
    pushedSlots: growth.pushes ?? [],
  });
}

function occupiedBottom(plan: CompositionPlan, slotId: string, fallback: number): number {
  const lineBottom = plan.lines
    .filter((line) => line.slotId === slotId)
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
  const blockBottom = plan.blockPlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), lineBottom);
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), blockBottom);
}

function flowingTextBottom(plan: CompositionPlan, slotId: string, fallback: number, document: CompositionDocument): number {
  const wrappedImages = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks)
    .filter((block) => block.kind === 'image' && (block.image?.wrap === 'left' || block.image?.wrap === 'right'))
    .map((block) => block.id));
  const lineBottom = plan.lines
    .filter((line) => line.slotId === slotId && line.layer !== 'insertion')
    .reduce((bottom, line) => Math.max(bottom, line.box.y + line.box.height), fallback);
  const blockBottom = plan.blockPlacements
    .filter((placement) => placement.slotId === slotId && !wrappedImages.has(placement.blockId))
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), lineBottom);
  return plan.tablePlacements
    .filter((placement) => placement.slotId === slotId)
    .reduce((bottom, placement) => Math.max(bottom, placement.box.y + placement.box.height), blockBottom);
}

function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

/**
 * Full-width insertion slots are intentionally not static flow obstacles:
 * reserving them on every continuation page creates an empty band on pages
 * before the insertion. Once an insertion has actually been placed, however,
 * subsequent content must start below its real painted bottom. This helper
 * derives that occupied boundary from the page's placed lines/blocks and
 * keeps the rule independent of a particular quote or template name.
 */
function occupiedBottomInOverlappingSlots(
  pageState: PageState,
  plan: CompositionPlan,
  targetSlot: CompositionSlot,
  fallback: number,
): number {
  const occupiedSlots = new Map<string, CompositionSlot>(
    [...pageState.slots.values()].map((slot) => [slot.id, slot]),
  );
  const bottomOf = (item: { page: number; slotId: string; box: CompositionRect }): number => {
    if (item.page !== pageState.page || item.slotId === targetSlot.id) return fallback;
    if ('layer' in item && item.layer === 'insertion') return fallback;
    const source = occupiedSlots.get(item.slotId);
    if (!source || source.flowId !== targetSlot.flowId || source.box.y >= rectBottom(targetSlot.box) || !horizontalOverlap(source.box, targetSlot.box)) return fallback;
    return item.box.y + item.box.height;
  };
  return Math.max(
    fallback,
    ...plan.lines.map(bottomOf),
    ...plan.blockPlacements.map(bottomOf),
    ...plan.tablePlacements.map(bottomOf),
  );
}

function previousBlockInOverlappingSlots(
  pageState: PageState,
  plan: CompositionPlan,
  targetSlot: CompositionSlot,
  document: CompositionDocument,
): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = [
    ...plan.lines,
    ...plan.blockPlacements,
    ...plan.tablePlacements,
  ].filter((item) => {
    if (item.page !== pageState.page || item.slotId === targetSlot.id) return false;
    if ('layer' in item && item.layer === 'insertion') return false;
    const source = pageState.slots.get(item.slotId);
    return source?.flowId === targetSlot.flowId && source !== undefined && source.box.y < rectBottom(targetSlot.box) && horizontalOverlap(source.box, targetSlot.box);
  }).sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
  return candidates.at(-1) ? blocks.get(candidates.at(-1)!.blockId) : undefined;
}

function contentStartBottom(
  pageState: PageState,
  plan: CompositionPlan,
  slot: CompositionSlot,
  document: CompositionDocument,
): number {
  const local = flowingTextBottom(plan, slot.id, slot.box.y, document);
  return occupiedBottomInOverlappingSlots(pageState, plan, slot, local);
}

function previousBlockInSlot(plan: CompositionPlan, slotId: string, currentBlockId: string, document: CompositionDocument): CompositionBlock | undefined {
  const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const candidates = [
    ...plan.placements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.blockPlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
    ...plan.tablePlacements.filter((placement) => placement.slotId === slotId && placement.blockId !== currentBlockId),
  ].sort((left, right) => (left.box.y + left.box.height) - (right.box.y + right.box.height));
  return candidates.at(-1) ? blocks.get(candidates.at(-1)!.blockId) : undefined;
}

function collapseUnusedInsertions(
  pageState: PageState,
  routeSlotIds: string[],
  fromRouteIndex: number,
  toRouteIndex: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  for (let index = fromRouteIndex; index < toRouteIndex; index += 1) {
    const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[index]);
    const insertion = definition ? pageState.slots.get(definition.id) : undefined;
    if (!definition?.allowedRoles?.includes('quote') || !insertion || insertion.state !== 'open') continue;
    const delta = insertion.box.height;
    if (delta <= 0) {
      insertion.state = 'exhausted';
      continue;
    }
    // The route already contains fixed text segments on both sides of this
    // insertion.  Collapsing an unused quote only changes route occupancy;
    // it must never move a later segment (especially the next column).
    insertion.state = 'exhausted';
    plan.decisions.push({
      code: 'OPTIONAL_INSERTION_COLLAPSED',
      flowId,
      blockId,
      page: pageState.page,
      slotId: insertion.id,
      routeIndex: index,
      delta,
      reason: 'no-insertion-content-on-page',
    });
  }
}

function collapseInsertionBeforeContinuation(
  pageState: PageState,
  routeSlotIds: string[],
  routeIndex: number,
  plan: CompositionPlan,
  flowId: string,
  blockId: string,
): void {
  const definition = pageState.layout.slots.find((slot) => slot.id === routeSlotIds[routeIndex]);
  const insertion = definition ? pageState.slots.get(definition.id) : undefined;
  if (!definition?.allowedRoles?.includes('quote') || !insertion || insertion.state !== 'open') return;
  const delta = insertion.box.height;
  if (delta <= 0) {
    insertion.state = 'exhausted';
    return;
  }
  // An insertion is an obstacle in the existing column geometry.  The text
  // stream is split around that obstacle; moving later boxes would turn the
  // two columns into independently positioned blocks and can pull a right
  // column above the left-column content.
  insertion.state = 'exhausted';
  plan.decisions.push({
    code: 'OPTIONAL_INSERTION_COLLAPSED',
    flowId,
    blockId,
    page: pageState.page,
    routeIndex,
    delta,
    reason: 'continuation-needs-uninterrupted-column',
  });
}

function placeLines(
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
  const firstY = box.y + padding.top + first.lineOffset * lineHeightValue + verticalOffset;
  const lastBottom = box.y + padding.top + (last.lineOffset + 1) * lineHeightValue + verticalOffset;
  const left = Math.min(...lines.map((line) => line.x));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  placements.push({
    id: `placement:${placements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    page: pageState.page,
    ...(routeIndex === undefined ? {} : { routeIndex }),
    box: { x: left, y: firstY, width: right - left, height: lastBottom - firstY },
    startWord: first.startWord,
    endWord: last.endWord,
    ...(layer === 'flow' ? {} : { layer }),
  });
  lines.forEach((line) => {
    const lineY = box.y + padding.top + line.lineOffset * lineHeightValue + verticalOffset;
    const textX = definition.textAlign === 'right'
      ? line.x + line.width - line.naturalWidth
      : definition.textAlign === 'center'
        ? line.x + (line.width - line.naturalWidth) / 2
        : line.x;
    const outputLine: CompositionLine = {
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
    };
    outputLines.push(outputLine);
  });
  const occupiedBottom = lastBottom;
  slot.state = occupiedBottom >= rectBottom(box) ? 'exhausted' : 'partial';
}

function addResidual(
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

function addTableResidual(
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

function advanceCursor(
  cursor: FlowCursor,
  routeSlotsForPage: string[],
): void {
  cursor.routeIndex += 1;
  cursor.resumeY = undefined;
  cursor.resumeSlotId = undefined;
  if (cursor.routeIndex >= routeSlotsForPage.length) {
    cursor.routeIndex = 0;
    cursor.page += 1;
    cursor.resumeY = undefined;
  }
}

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

function planFlow(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  flowId: string,
  route: CompositionFlowRoute,
  pages: PageState[],
  plan: CompositionPlan,
  startPage = 1,
  insertionProposals: Map<string, PlannedInsertion> = new Map(),
  skipPreplannedInsertions = false,
): void {
  const flow = document.flows[flowId];
  if (!flow) return;
  const authoredBlocks = flow.blocks;
  const geometryTolerance = policy.geometryTolerance ?? 0;
  const blocks = skipPreplannedInsertions
    ? authoredBlocks.filter((block) => block.role !== 'quote')
    : authoredBlocks;
  const authoredIndexOf = (blockId: string): number => authoredBlocks.findIndex((candidate) => candidate.id === blockId);
  const cursor: FlowCursor = { blockIndex: 0, startWord: 0, startRow: 0, page: startPage, routeIndex: 0 };
  let deferredQuote: { blockIndex: number; deferredPage: number; routeIndex?: number } | undefined;
  let activeDeferredQuote: { blockIndex: number; blockId: string; resume: { blockIndex: number; startWord: number; startRow: number } } | undefined;
  let lastLegalSlotId: string | undefined;
  while (cursor.blockIndex < blocks.length) {
    if (cursor.page > template.maxPages) {
      const block = blocks[cursor.blockIndex];
      plan.diagnostics.push(diagnostic('error', 'MAX_PAGES_EXCEEDED', `Flow '${flowId}' exceeded the template page limit.`, { flowId, blockId: block.id, page: cursor.page }));
      if (block.kind === 'table') addTableResidual(plan.residualContent, flowId, block, cursor.startRow, lastLegalSlotId, 'max-pages');
      else addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'max-pages');
      return;
    }
    if (cursor.page > startPage && route.continuation === 'forbidden') {
      const block = blocks[cursor.blockIndex];
      plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${flowId}' cannot continue beyond its first page.`, { flowId, blockId: block.id, page: cursor.page }));
      if (block.kind === 'table') addTableResidual(plan.residualContent, flowId, block, cursor.startRow, lastLegalSlotId, 'flow-continuation-forbidden');
      else addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'flow-continuation-forbidden');
      return;
    }
    const currentPage = ensurePage(pages, template, route, cursor.page, plan.diagnostics, flowId);
    if (!currentPage) return;
    const currentBlockAuthoredIndex = authoredIndexOf(blocks[cursor.blockIndex]?.id ?? '');
    const precedingInsertionPage = authoredBlocks
      .slice(0, currentBlockAuthoredIndex)
      .filter((candidate) => candidate.role === 'quote')
      .map((candidate) => insertionProposals.get(insertionKey(flowId, candidate.id))?.page)
      .filter((page): page is number => page !== undefined)
      .sort((left, right) => right - left)[0];
    if (precedingInsertionPage !== undefined && cursor.page < precedingInsertionPage) {
      cursor.page = precedingInsertionPage;
      cursor.routeIndex = 0;
      cursor.resumeY = undefined;
      plan.decisions.push({ code: 'FLOW_HELD_FOR_PREPLANNED_INSERTION', flowId, blockId: blocks[cursor.blockIndex].id, page: currentPage.page, reason: 'successor-must-not-pass-earlier-insertion', details: { insertionPage: precedingInsertionPage } });
      continue;
    }
    if (deferredQuote && !activeDeferredQuote && cursor.page === deferredQuote.deferredPage && deferredQuote.routeIndex !== undefined && cursor.routeIndex >= deferredQuote.routeIndex) {
      activeDeferredQuote = {
        blockIndex: deferredQuote.blockIndex,
        blockId: blocks[deferredQuote.blockIndex].id,
        resume: { blockIndex: cursor.blockIndex, startWord: cursor.startWord, startRow: cursor.startRow },
      };
      cursor.blockIndex = deferredQuote.blockIndex;
      cursor.startWord = 0;
      cursor.startRow = 0;
      cursor.routeIndex = deferredQuote.routeIndex;
      plan.decisions.push({ code: 'INSERTION_REPOSITIONED_PLACED', flowId, blockId: blocks[cursor.blockIndex].id, page: cursor.page, routeIndex: cursor.routeIndex, reason: 'earlier-route-segment-was-empty' });
    }
    if (deferredQuote && !activeDeferredQuote && cursor.page > deferredQuote.deferredPage) {
      activeDeferredQuote = {
        blockIndex: deferredQuote.blockIndex,
        blockId: blocks[deferredQuote.blockIndex].id,
        resume: { blockIndex: cursor.blockIndex, startWord: cursor.startWord, startRow: cursor.startRow },
      };
      cursor.blockIndex = deferredQuote.blockIndex;
      cursor.startWord = 0;
      cursor.startRow = 0;
      cursor.routeIndex = 0;
      plan.decisions.push({ code: 'DEFERRED_INSERTION_PLACED', flowId, blockId: blocks[cursor.blockIndex].id, page: cursor.page, reason: 'next-page-insertion-slot' });
    }
    placeGraphicsForPage(document, currentPage, plan);
    const availableRouteSlots = routeSlots(route, currentPage.layout);
    const block = blocks[cursor.blockIndex];
    const plannedInsertion = block.role === 'quote' ? insertionProposals.get(insertionKey(flowId, block.id)) : undefined;
    if (plannedInsertion && currentPage.page > plannedInsertion.page) {
      plan.diagnostics.push(diagnostic('error', 'INSERTION_PLAN_PASSED', `Insertion '${block.id}' passed its stabilized page ${plannedInsertion.page}.`, { flowId, blockId: block.id, page: currentPage.page, details: { plannedPage: plannedInsertion.page, plannedSlotId: plannedInsertion.slotId } }));
      addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'insertion-plan-passed');
      return;
    }
    const insertionDefinition = block.role === 'quote'
      ? plannedInsertion && currentPage.page === plannedInsertion.page
        ? currentPage.layout.slots.find((slot) => slot.id === plannedInsertion.slotId && slot.allowedRoles?.includes('quote'))
        : insertionSlotFor(route, currentPage.layout, currentPage, plan, availableRouteSlots, cursor.routeIndex, document)
      : undefined;
    if (block.role === 'quote' && (route.insertionSlots?.length ?? 0) > 0 && !insertionDefinition) {
      if (route.continuation === 'allowed' && cursor.page < template.maxPages) {
        cursor.page += 1;
        cursor.routeIndex = 0;
        plan.decisions.push({ code: 'INSERTION_PUSHED_TO_NEXT_PAGE', flowId, blockId: block.id, page: currentPage.page, reason: 'no-insertion-slot-after-current-flow-position' });
        continue;
      }
      plan.diagnostics.push(diagnostic('error', 'INSERTION_SLOT_NOT_FOUND', `Flow '${flowId}' cannot place insertion '${block.id}' after the current flow position.`, { flowId, blockId: block.id, page: currentPage.page }));
      addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'insertion-slot-not-found');
      return;
    }
    // A quote is an insertion, but it remains in authored flow order. It may
    // be deferred to another legal insertion slot; it must never be moved
    // behind the next ordinary block merely to fill an earlier segment.
    let selectedSlot = insertionDefinition
      ? { definition: insertionDefinition, routeIndex: cursor.routeIndex }
      : slotFor(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots);
    if (block.role !== 'quote' && cursor.startWord > 0 && selectedSlot) {
      const insertionIndex = availableRouteSlots.findIndex((slotId, index) => index >= cursor.routeIndex
        && index < selectedSlot!.routeIndex
        && currentPage.layout.slots.some((slot) => slot.id === slotId && slot.allowedRoles?.includes('quote'))
        && currentPage.slots.get(slotId)?.state === 'open');
      if (insertionIndex >= 0) {
        collapseInsertionBeforeContinuation(currentPage, availableRouteSlots, insertionIndex, plan, flowId, block.id);
        selectedSlot = slotFor(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots);
      }
    }
    if (!selectedSlot || (selectedSlot.definition.kind !== 'text' && selectedSlot.definition.kind !== 'block')) {
      if (selectedSlot === undefined && !hasRoleEligibleSlot(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots)) {
        if (block.role === 'quote' && route.continuation === 'allowed' && cursor.page === startPage && !deferredQuote) {
          const nextLayout = routeLayout(route, template, cursor.page + 1);
          const nextSlotIds = nextLayout ? routeSlots(route, nextLayout) : [];
          const nextPageHasInsertionSlot = nextLayout !== undefined && hasRoleEligibleSlot(nextLayout, nextSlotIds, 0, flowId, block);
          if (nextPageHasInsertionSlot) {
            deferredQuote = { blockIndex: cursor.blockIndex, deferredPage: cursor.page };
            cursor.blockIndex += 1;
            cursor.startWord = 0;
            cursor.startRow = 0;
            cursor.routeIndex = 0;
            plan.decisions.push({ code: 'INSERTION_DEFERRED', flowId, blockId: block.id, page: currentPage.page, reason: 'insertion-slot-only-on-continuation' });
            continue;
          }
        }
        if (route.continuation === 'allowed') {
          plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_PAGE', flowId, blockId: block.id, page: currentPage.page, reason: 'no-eligible-slot-on-page' });
          advanceCursor(cursor, availableRouteSlots);
          continue;
        }
      }
      plan.diagnostics.push(diagnostic('error', 'FLOW_SLOT_NOT_FOUND', `Flow '${flowId}' cannot use route slot '${availableRouteSlots[cursor.routeIndex] ?? ''}'.`, { flowId, page: currentPage.page }));
      addResidual(plan.residualContent, flowId, blocks[cursor.blockIndex], cursor.startWord, lastLegalSlotId, 'no-legal-slot');
      return;
    }
    const routeStartIndex = cursor.routeIndex;
    cursor.routeIndex = selectedSlot.routeIndex;
    const definition = selectedSlot.definition;
    const continuousInsertion = block.role === 'quote' && (route.insertionSlots?.includes(definition.id) ?? false);
    if (block.role !== 'quote') {
      collapseUnusedInsertions(currentPage, availableRouteSlots, routeStartIndex, selectedSlot.routeIndex, plan, flowId, block.id);
    }
    // Header/footer text deliberately shares its chrome band with the
    // reserved lockup. The lockup is a paint reservation, not a competing
    // content block, so it must not push the auxiliary flow to another page.
    if (flowId !== 'title' && flowId !== 'header' && flowId !== 'footer' && slotCollidesWithPlacedBlock(currentPage, definition.id, plan, flowId)) {
      plan.decisions.push({ code: 'TEXT_SLOT_COLLISION_PUSHED', flowId, blockId: block.id, slotId: definition.id, page: currentPage.page, reason: 'slot-overlaps-placed-block' });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (block.assetIds && block.assetIds.length > 0) {
      plan.diagnostics.push(diagnostic('error', 'UNSUPPORTED_INLINE_ASSET', `Text planner cannot place inline asset(s) from '${block.id}' without an asset-to-slot mapping.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { assetIds: block.assetIds } }));
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      continue;
    }
    if (placeStructuredBlock({
      pageState: currentPage,
      definition,
      block,
      flowId,
      routeIndex: selectedSlot.routeIndex,
      plan,
      cursor,
      blocksLength: blocks.length,
      availableRouteSlots,
      metrics,
      geometryTolerance,
      previousBlockInSlot: (slotId, blockId) => previousBlockInSlot(plan, slotId, blockId, document),
      contentStartBottom: (slot) => contentStartBottom(currentPage, plan, slot, document),
      advanceCursor,
      growSlot: (requiredBottom) => growSlot(currentPage, definition, requiredBottom, plan, flowId, block.id),
    })) continue;
    const leading = lineHeight(metrics, block);
    const slot = currentPage.slots.get(definition.id)!;
    const initialBox = slotBox(currentPage, definition);
    const growthBottom = definition.grow?.axis === 'y'
      ? definition.box.y + definition.grow.maxHeight
      : rectBottom(initialBox);
    const insertionBoundary = block.role === 'quote'
      ? undefined
      : nextInsertionBoundary(route, authoredBlocks, authoredIndexOf(block.id), currentPage.page, insertionProposals, flowId, cursor.resumeY);
    const textBottom = insertionBoundary === undefined
      ? growthBottom
      : Math.min(growthBottom, insertionBoundary);
    const localBottom = flowingTextBottom(plan, slot.id, initialBox.y, document);
    const crossSlotBottom = occupiedBottomInOverlappingSlots(currentPage, plan, slot, localBottom);
    const crossSlotPrevious = crossSlotBottom > localBottom
      ? previousBlockInOverlappingSlots(currentPage, plan, slot, document)
      : undefined;
    const crossSlotGap = crossSlotPrevious ? metrics.blockGap?.(styleFor(crossSlotPrevious), styleFor(block)) ?? 0 : 0;
    const previousInsertion = authoredBlocks
      .slice(0, authoredIndexOf(block.id))
      .filter((candidate) => candidate.role === 'quote')
      .map((candidate) => insertionProposals.get(insertionKey(flowId, candidate.id)))
      .filter((proposal): proposal is PlannedInsertion => proposal !== undefined && proposal.page === currentPage.page)
      .sort((left, right) => right.box.y - left.box.y)[0];
    const previousInsertionBottom = previousInsertion ? previousInsertion.box.y + previousInsertion.box.height : undefined;
    const insertionIsBeforeCurrentColumn = previousInsertion !== undefined
      && initialBox.x + initialBox.width / 2 <= previousInsertion.box.x + previousInsertion.box.width / 2;
    const usedBottom = Math.max(
      localBottom,
      crossSlotBottom,
      ...(insertionIsBeforeCurrentColumn && previousInsertionBottom !== undefined ? [previousInsertionBottom] : []),
      cursor.resumeSlotId === slot.id ? cursor.resumeY ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY,
    ) + crossSlotGap;
    const startLineOffset = Math.max(0, (usedBottom - initialBox.y) / leading);
    const pageGraphics = plan.graphicPlacements.filter((graphic) => graphic.page === currentPage.page && graphic.graphicId !== `insertion:${block.id}`);
    const flowBarrierBoxCandidates = block.role === 'quote'
      ? []
      : flowBarrierBoxCandidatesForSlot(currentPage.page, slot, flowId, plan.graphicPlacements);
    if (flowBarrierBoxCandidates.length > 0) {
      plan.decisions.push({
        code: 'FLOW_BARRIER_BOXES_CONSUMED',
        flowId,
        blockId: block.id,
        slotId: slot.id,
        page: currentPage.page,
        details: { candidateIds: flowBarrierBoxCandidates.map((candidate) => candidate.id) },
      });
    }
    const previous = cursor.startWord === 0 ? previousBlockInSlot(plan, slot.id, block.id, document) : undefined;
    // A resume boundary created by an obstacle is already the start of a new
    // legal content segment. The previous authored block is separated from
    // this heading by that barrier, so its margin-before must not be added a
    // second time after resumeY.
    const resumedAfterFlowBarrier = cursor.resumeSlotId === slot.id
      && cursor.resumeY !== undefined
      && cursor.resumeY > localBottom + geometryTolerance;
    let blockGap = resumedAfterFlowBarrier
      ? 0
      : previous ? metrics.blockGap?.(styleFor(previous), styleFor(block)) ?? 0 : 0;
    const isHeadingBlock = block.kind === 'heading' || block.role === 'heading' || block.role === 'title';
    let wrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset + blockGap / leading, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
    let completeWrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset + blockGap / leading, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
    // If only the inter-block gap prevents a whole heading from fitting in
    // the remaining physical lines, use the configured gap as a soft value
    // and compress it to zero for this boundary. Keeping a heading whole is
    // more important than creating a four-line hole at the end of a column;
    // ordinary body-to-body spacing remains unchanged.
    const availableWithoutGap = availableLineCount(rectBottom(initialBox) - (initialBox.y + startLineOffset * leading), leading);
    if (isHeadingBlock && blockGap > 0 && wrapped.length < completeWrapped.length) {
      const noGapWrapped = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset, textBottom, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
      const noGapComplete = wrapBlock(metrics, block, cursor.startWord, initialBox, startLineOffset, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
      if (noGapComplete.length <= availableWithoutGap && noGapWrapped.length === noGapComplete.length) {
        plan.decisions.push({ code: 'BLOCK_GAP_COMPRESSED', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, from: blockGap, to: 0, reason: 'keep-heading-whole-without-empty-column' });
        blockGap = 0;
        wrapped = noGapWrapped;
        completeWrapped = noGapComplete;
      }
    }
    if (wrapped.length === 0) {
      if (wordsForBlock(block).length === 0) {
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        continue;
      }
      plan.decisions.push({
        code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
        flowId,
        blockId: block.id,
        slotId: slot.id,
        page: currentPage.page,
        reason: 'no-available-text-band',
        details: {
          availableLines: availableLineCount(rectBottom(initialBox) - (initialBox.y + startLineOffset * leading), leading),
          lineHeight: leading,
          blockGap,
          startLineOffset,
        },
      });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (definition.grow?.axis === 'y' && cursor.startWord === 0) {
      const requiredBottom = initialBox.y + (wrapped.at(-1)!.lineOffset + 1) * leading;
      growSlot(currentPage, definition, requiredBottom, plan, flowId, block.id);
    }
    const currentBox = slotBox(currentPage, definition);
    // The inter-block gap is part of the next block's occupied band.  Omitting
    // it here made the planner claim that a third line was available while the
    // wrapped block (which starts after that gap) could only place two.
    const blockStartOffset = startLineOffset + blockGap / leading;
    const currentAvailableLines = availableLineCount(rectBottom(currentBox) - (currentBox.y + blockStartOffset * leading), leading);
    const usedLines = startLineOffset;
    if ((block.kind === 'heading' || block.role === 'heading' || block.role === 'title') && completeWrapped.length > currentAvailableLines) {
      plan.decisions.push({ code: 'HEADING_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'keep-heading-together', details: { requiredLines: completeWrapped.length, availableLines: currentAvailableLines, startLineOffset, blockGap } });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (block.kind === 'list-item' && policy.keepListItemsTogether && cursor.startWord === 0) {
      const complete = wrapBlock(metrics, block, 0, initialBox, 0, Number.POSITIVE_INFINITY, pageGraphics, leading, policy.minimumWrapWidth, flowBarrierBoxCandidates, geometryTolerance);
      const slotCapacity = availableLineCount(rectBottom(initialBox) - initialBox.y, leading);
      if (complete.length > currentAvailableLines && complete.length <= slotCapacity && usedLines > 0) {
        const minimumFragmentLines = policy.minimumFragmentLines ?? 1;
        if (currentAvailableLines < minimumFragmentLines) {
          plan.decisions.push({ code: 'LIST_ITEM_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'keep-list-item-together-below-minimum-fragment' });
          advanceCursor(cursor, availableRouteSlots);
          continue;
        }
        plan.decisions.push({ code: 'LIST_ITEM_SPLIT_TO_AVOID_HOLE', flowId, blockId: block.id, slotId: slot.id, reason: 'available-fragment-meets-minimum-and-whole-item-would-leave-hole', details: { availableLines: currentAvailableLines, minimumFragmentLines, completeLines: complete.length } });
      }
    }
    const next = blocks[cursor.blockIndex + 1];
    const keepLines = block.keepWithNextLines
      ?? (block.kind === 'heading' ? policy.headingKeepWithNextLines ?? 0 : 0);
    const nextLeading = next ? lineHeight(metrics, next) : leading;
    const nextWrapped = next ? wrapBlock(metrics, next, 0, currentBox, 0, rectBottom(currentBox), pageGraphics, nextLeading, policy.minimumWrapWidth, next.role === 'quote' ? [] : flowBarrierBoxCandidates, geometryTolerance) : [];
    if (isHeadingBlock && keepLines > 0 && next) {
      const headingStartOffset = startLineOffset + blockGap / leading;
      // Probe the cluster without obstacles first.  Using the wrapped result
      // from the real page here is insufficient: wrapBlock can skip lines
      // under an obstacle, making a quote that cuts through the lead look
      // like a normal gap instead of a violation of the keep rule.
      const headingProbe = wrapBlock(metrics, block, cursor.startWord, initialBox, headingStartOffset, Number.POSITIVE_INFINITY, [], leading, policy.minimumWrapWidth);
      const headingBottom = headingProbe.length > 0
        ? initialBox.y + (headingProbe.at(-1)!.lineOffset + 1) * leading
        : initialBox.y + headingStartOffset * leading;
      const nextProbeStart = (headingBottom + blockGap - currentBox.y) / nextLeading;
      const leadProbe = wrapBlock(metrics, next, 0, currentBox, nextProbeStart, Number.POSITIVE_INFINITY, [], nextLeading, policy.minimumWrapWidth);
      if (leadProbe.length >= keepLines) {
        const clusterObstacle = obstructionAcrossLineBands(
          [{ lines: headingProbe, lineHeight: leading }, { lines: leadProbe.slice(0, keepLines), lineHeight: nextLeading }],
          initialBox,
          initialBox.y,
          pageGraphics,
          geometryTolerance,
        );
        if (clusterObstacle) {
        const requiredClusterLines = headingProbe.length + keepLines;
        const resumeY = Math.max(cursor.resumeY ?? initialBox.y, rectBottom(clusterObstacle.box));
        const availableAfterObstacle = availableLineCount(rectBottom(currentBox) - resumeY, leading);
        if (availableAfterObstacle >= requiredClusterLines) {
          cursor.resumeY = resumeY;
          cursor.resumeSlotId = slot.id;
          plan.decisions.push({ code: 'HEADING_CLUSTER_PUSHED_BELOW_OBSTACLE', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, reason: 'keep-heading-and-lead-together', details: { obstacleId: clusterObstacle.graphicId, resumeY, requiredClusterLines, availableAfterObstacle } });
          continue;
        }
        plan.decisions.push({ code: 'HEADING_CLUSTER_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, reason: 'keep-heading-and-lead-together', details: { obstacleId: clusterObstacle.graphicId, requiredClusterLines, availableAfterObstacle } });
        advanceCursor(cursor, availableRouteSlots);
        continue;
        }
      }
    }
    const keepRequired = keepLines > 0 && cursor.startWord === 0
      ? completeWrapped.length + Math.min(keepLines, nextWrapped.length)
      : 0;
    // A heading's configured keep-with-next rule is hard: placing the heading
    // alone at the bottom of a slot would create the exact orphan visible in
    // the editorial PDF. The complete heading measurement is used here so a
    // heading that fits by itself is still pushed when its lead does not.
    if (isHeadingBlock && keepRequired > currentAvailableLines && usedLines > 0) {
      plan.decisions.push({
        code: 'KEEP_CLUSTER_PUSHED',
        flowId,
        blockId: block.id,
        from: slot.id,
        slotId: slot.id,
        reason: 'insufficient-local-capacity',
        details: { requiredLines: keepRequired, availableLines: currentAvailableLines },
      });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (!isHeadingBlock && keepRequired > currentAvailableLines && block.keepWithNextLines !== undefined && wrapped.length <= currentAvailableLines) {
      plan.decisions.push({ code: 'KEEP_CLUSTER_RELAXED', flowId, blockId: block.id, from: slot.id, reason: 'whole-block-fits-but-following-block-does-not' });
    }
    if (currentAvailableLines <= 0) {
      lastLegalSlotId = slot.id;
      plan.decisions.push({
        code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
        flowId,
        blockId: block.id,
        slotId: slot.id,
        page: currentPage.page,
        reason: 'next-block-spacing-or-line-height-does-not-fit',
        details: { availableLines: currentAvailableLines, lineHeight: leading, blockGap, startLineOffset },
      });
      if (route.continuation === 'forbidden' && cursor.routeIndex >= availableRouteSlots.length - 1) {
        plan.diagnostics.push(diagnostic('error', 'FLOW_CONTINUATION_FORBIDDEN', `Flow '${flowId}' cannot continue beyond its available slots on page ${currentPage.page}.`, { flowId, blockId: block.id, page: currentPage.page, slotId: slot.id }));
        addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'flow-continuation-forbidden');
        return;
      }
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    let take = Math.min(currentAvailableLines, wrapped.length);
    let remainder = completeWrapped.length - take;
    if (remainder > 0 && policy.minimumLinesAtEnd !== undefined && remainder < policy.minimumLinesAtEnd) {
      take -= policy.minimumLinesAtEnd - remainder;
      remainder = completeWrapped.length - take;
    }
    if (remainder > 0 && !isHeadingBlock && policy.minimumLinesAtStart !== undefined && take < policy.minimumLinesAtStart) {
      if (usedLines > 0) {
        plan.decisions.push({
          code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
          flowId,
          blockId: block.id,
          slotId: slot.id,
          page: currentPage.page,
          reason: 'minimum-fragment-start-would-be-violated',
          details: { availableLines: currentAvailableLines, attemptedLines: take, minimumFragmentLines: policy.minimumLinesAtStart, lineHeight: leading, blockGap, startLineOffset: blockStartOffset },
        });
        advanceCursor(cursor, availableRouteSlots);
        continue;
      }
      plan.diagnostics.push(diagnostic('error', 'MINIMUM_FRAGMENT_UNSATISFIED', `Flow '${flowId}' cannot satisfy the minimum fragment size for '${block.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: slot.id }));
      addResidual(plan.residualContent, flowId, block, cursor.startWord, lastLegalSlotId, 'minimum-fragment');
      return;
    }
    if (take <= 0) {
      plan.decisions.push({
        code: 'BLOCK_PUSHED_TO_NEXT_SLOT',
        flowId,
        blockId: block.id,
        slotId: slot.id,
        page: currentPage.page,
        reason: 'minimum-fragment-orphan-adjustment-left-no-lines',
        details: { availableLines: currentAvailableLines, attemptedLines: take, lineHeight: leading, blockGap, startLineOffset: blockStartOffset },
      });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (isHeadingBlock && remainder > 0) {
      plan.decisions.push({ code: 'HEADING_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'keep-heading-together', details: { requiredLines: completeWrapped.length, availableLines: currentAvailableLines, startLineOffset, blockGap } });
      advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    const selected = wrapped.slice(0, take);
    if (selected.some((line) => line.naturalWidth > line.width)) {
      plan.diagnostics.push(diagnostic('error', 'OVERFULL_LINE', `Flow '${flowId}' contains a token wider than slot '${definition.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: slot.id }));
    }
    placeLines(currentPage, definition, block, metrics, flowId, continuousInsertion ? undefined : selectedSlot.routeIndex, selected, leading, plan.placements, plan.lines);
    lastLegalSlotId = slot.id;
    const consumedEnd = selected.at(-1)!.endWord;
    if (consumedEnd >= wordsForBlock(block).length) {
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      if (block.role === 'quote') {
        slot.state = 'exhausted';
        if (continuousInsertion && !plan.graphicPlacements.some((graphic) => graphic.graphicId === `insertion:${block.id}` && graphic.page === currentPage.page)) {
          plan.graphicPlacements.push({
            id: `graphic:insertion:${block.id}`,
            graphicId: `insertion:${block.id}`,
            slotId: slot.id,
            page: currentPage.page,
            shape: 'rectangle',
            wrap: 'around',
            paint: false,
            box: { ...slot.box },
          });
          plan.decisions.push({ code: 'FLOW_INSERTION_OBSTACLE_PLACED', flowId, blockId: block.id, page: currentPage.page, slotId: slot.id, box: { ...slot.box } });
          cursor.resumeY = Math.max(cursor.resumeY ?? Number.NEGATIVE_INFINITY, rectBottom(slot.box));
          cursor.resumeSlotId = slot.id;
        }
        if (activeDeferredQuote?.blockId === block.id) {
          const resume = activeDeferredQuote.resume;
          activeDeferredQuote = undefined;
          deferredQuote = undefined;
          cursor.blockIndex = resume.blockIndex;
          cursor.startWord = resume.startWord;
          cursor.startRow = resume.startRow;
          cursor.routeIndex = selectedSlot.routeIndex + 1;
        }
      }
      plan.decisions.push({ code: 'BLOCK_PLACED', flowId, blockId: block.id, slotId: slot.id });
    } else {
      cursor.startWord = consumedEnd;
      plan.decisions.push({ code: 'BLOCK_CONTINUED', flowId, blockId: block.id, slotId: slot.id });
    }
    if (insertionBoundary !== undefined && consumedEnd < wordsForBlock(block).length) {
      const boundary = nextInsertionProposal(
        route,
        authoredBlocks,
        authoredIndexOf(block.id),
        currentPage.page,
        insertionProposals,
        flowId,
        cursor.resumeY,
      );
      if (!boundary) {
        plan.diagnostics.push(diagnostic('error', 'INSERTION_PRECEDENCE_CONFLICT', `Insertion boundary for the next quote leaves authored block '${block.id}' unfinished above it.`, { flowId, blockId: block.id, page: currentPage.page, slotId: slot.id, details: { insertionBoundary, consumedEnd, totalWords: wordsForBlock(block).length } }));
        addResidual(plan.residualContent, flowId, block, consumedEnd, slot.id, 'insertion-precedence-conflict');
        return;
      }
      cursor.startWord = consumedEnd;
      cursor.resumeY = boundary.box.y + boundary.box.height;
      cursor.resumeSlotId = slot.id;
      plan.decisions.push({ code: 'FLOW_RESUMED_BELOW_INSERTION', flowId, blockId: block.id, page: currentPage.page, slotId: slot.id, consumedEnd, obstacleY: boundary.box.y, obstacleBottom: cursor.resumeY });
      continue;
    }
    if (consumedEnd < wordsForBlock(block).length || cursor.blockIndex < blocks.length) {
      const nextBlock = blocks[cursor.blockIndex];
      // Keep the current column alive for an authored insertion that follows
      // this block.  An insertion is an obstacle in the same continuous
      // route, not a reason to finish the page before we have tried its next
      // legal band.  Advancing here used to leave the rest of the current
      // column empty and moved the quote (and all following text) to the next
      // page even when quote-b still fit below the preceding text.
      const nextInsertionFitsCurrentPage = nextBlock?.role === 'quote'
        && insertionSlotFor(route, currentPage.layout, currentPage, plan, availableRouteSlots, cursor.routeIndex, document) !== undefined;
      // A completed block does not end the continuous flow.  Re-enter the
      // placement loop so the next authored block gets the remaining vertical
      // band in this same slot; only an unfinished block must advance now.
      // Treating `selected.length === currentAvailableLines` as a reason to
      // advance was the source of false holes: that count describes the
      // current block's starting capacity, not the remaining capacity after
      // its last line (and it ignores the next block's actual line-height and
      // gap).
      if (!continuousInsertion && !nextInsertionFitsCurrentPage && consumedEnd < wordsForBlock(block).length) {
        const nextBlock = blocks[cursor.blockIndex];
        const nextLeading = nextBlock ? lineHeight(metrics, nextBlock) : undefined;
        const nextBlockGap = nextBlock ? metrics.blockGap?.(styleFor(block), styleFor(nextBlock)) ?? 0 : 0;
        const lastLineBottom = selected.at(-1)
          ? initialBox.y + (selected.at(-1)!.lineOffset + 1) * leading
          : initialBox.y;
        const nextBlockAvailableLines = nextLeading === undefined
          ? undefined
          : availableLineCount(rectBottom(currentBox) - lastLineBottom - nextBlockGap, nextLeading);
        plan.decisions.push({
          code: 'FLOW_SEGMENT_ADVANCED',
          flowId,
          blockId: block.id,
          page: currentPage.page,
          slotId: slot.id,
          routeIndex: selectedSlot.routeIndex,
          details: { selectedLines: selected.length, currentAvailableLines, consumedEnd, totalWords: wordsForBlock(block).length },
        });
        const transition = plan.decisions.at(-1)!;
        if (nextBlock && nextLeading !== undefined) {
          transition.details = {
            ...(transition.details as Record<string, unknown>),
            nextBlockId: nextBlock.id,
            nextBlockAvailableLines,
            nextBlockLineHeight: nextLeading,
            nextBlockGap,
          };
        }
        const pageBeforeAdvance = cursor.page;
        advanceCursor(cursor, availableRouteSlots);
        if (cursor.page > pageBeforeAdvance && cursor.blockIndex < blocks.length) {
          plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_PAGE', flowId, blockId: blocks[cursor.blockIndex].id, page: cursor.page, reason: 'previous-slot-exhausted' });
        }
      }
    }
  }
}

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

function planDocumentOnce(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  insertionProposals: Map<string, PlannedInsertion>,
  graphicProposals: Map<string, PlannedGraphic>,
): CompositionPlan {
  const plan = createPlan(policy.minimumFragmentLines);
  plan.movableInsertionFrames = Object.entries(policy.movableInsertionBounds ?? {}).flatMap(([key, movable]) => {
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
  plan.movableGraphicFrames = Object.entries(policy.movableGraphicBounds ?? {}).flatMap(([key, movable]) => {
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
  validateMovableInsertionBounds(insertionProposals, policy, plan);
  validateMovableGraphicBounds(graphicProposals, policy, plan);
  validateGrowthPolicies(template, plan);
  recordPlanningPhase(plan, 'preflight', plan.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'completed', { layoutCount: template.layouts.length, flowCount: Object.keys(document.flows).length });
  const pages: PageState[] = [];
  materializeGraphicPages(document, template, pages, plan, graphicProposals);
  // A rendered document always has a first page, even when all content
  // flows are empty. This keeps the planner's page count aligned with the
  // PDF backend's initial jsPDF page.
  const firstRoute = template.routes.main ?? Object.values(template.routes)[0];
  if (firstRoute) ensurePage(pages, template, firstRoute, 1, plan.diagnostics, 'document');
  reserveInsertionObstacles(template, pages, plan, insertionProposals);
  recordPlanningPhase(plan, 'obstacle-reservation', plan.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'completed', { obstacleCount: plan.graphicPlacements.filter((graphic) => graphic.graphicId.startsWith('insertion:')).length });
  const insertionKeys = placeInsertionLayer(document, metrics, template, plan, pages, insertionProposals);
  recordPlanningPhase(plan, 'insertion-placement', plan.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'completed', { insertionCount: insertionKeys.size });
  // Repeated chrome depends on the final number of pages. Plan all ordinary
  // flows first so a header/footer that starts on page 2 cannot observe the
  // provisional one-page document and silently disappear.
  const flowEntries = Object.entries(document.flows);
  const orderedFlowEntries = [
    ...flowEntries.filter(([flowId]) => template.routes[flowId]?.repeat !== 'each-page'),
    ...flowEntries.filter(([flowId]) => template.routes[flowId]?.repeat === 'each-page'),
  ];
  for (const [flowId, flow] of orderedFlowEntries) {
    const route = template.routes[flowId];
    if (!route) {
      if (flow.blocks.length > 0) plan.diagnostics.push(diagnostic('error', 'FLOW_ROUTE_NOT_FOUND', `Flow '${flowId}' has no route in template '${template.layouts[0]?.id ?? ''}'.`, { flowId }));
      continue;
    }
    if (route.repeat === 'each-page') {
      plan.repeatFlowIds?.push(flowId);
      const pageCount = Math.max(1, pages.length);
      const firstPage = route.startPage ?? 1;
      for (let page = firstPage; page <= pageCount; page += 1) {
        planFlow(document, metrics, template, policy, flowId, { ...route, continuation: 'forbidden' }, pages, plan, page, insertionProposals);
      }
    } else {
      if (route.startPage !== undefined && (!Number.isInteger(route.startPage) || route.startPage < 1 || route.startPage > template.maxPages)) {
        plan.diagnostics.push(diagnostic('error', 'FLOW_START_PAGE_INVALID', `Flow '${flowId}' has an invalid start page ${route.startPage}.`, { flowId }));
        continue;
      }
      planFlow(document, metrics, template, policy, flowId, route, pages, plan, route.startPage ?? 1, insertionProposals, Boolean(route.insertionSlots?.length));
    }
  }
  flattenPages(pages, plan, template);
  normalizePlanReadingOrder(document, plan);
  plan.flowPlacements = registerFlowPlacements(document, plan);
  plan.flowBarrierBoxCandidates = registerFlowBarrierBoxCandidates(plan);
  placeGlyphObjects(document, metrics, plan);
  recordPlanningPhase(plan, 'flow-placement', plan.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'completed', { lineCount: plan.lines.length, pageCount: plan.pages.length });
  tracePlan(document, metrics, plan);
  return plan;
}

export function createTextCompositionPlanner(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
): CompositionPlanner {
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
    plan(document, metrics) {
      return planCandidates(document, metrics).at(-1)!;
    },
    planCandidates,
    candidateRefinementRounds: Math.max(
      0,
      ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
      ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
    ),
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
