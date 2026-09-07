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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Keep the current validateMovableInsertionBounds implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/document-layout.ts
 * @planner-responsibility Keep the current validateMovableGraphicBounds implementation intact until its target seam is extracted.
 */
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
/**
 * @planner-target composition/insertion-planning.ts
 * @planner-responsibility Reserve insertion rectangles that must obstruct flowing content.
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
