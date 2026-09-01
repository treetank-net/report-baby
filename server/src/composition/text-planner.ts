import type {
  CompositionBlock,
  CompositionDocument,
  CompositionGlyphDefinition,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionBlockMeasurement,
  CompositionBlockTrace,
  CompositionBlockPlacement,
  CompositionFlowBarrierBoxCandidate,
  CompositionFlowPlacement,
  CompositionDiagnostic,
  CompositionGraphicPlacement,
  CompositionGlyphPlacement,
  CompositionGlyphSpec,
  CompositionLine,
  CompositionPlan,
  CompositionPlanTrace,
  CompositionPlanningPhaseName,
  CompositionPlacement,
  CompositionPlanner,
  CompositionSlot,
  CompositionTraceDecision,
  CompositionTextMetrics,
  CompositionTableMeasurement,
  CompositionWordRange,
} from './engine.js';
import { graphicIntervalsForLine, polygonPoints } from './graphic-geometry.js';
import { compositionStyleName } from './style-name.js';

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
}

interface WrappedLine {
  text: string;
  naturalWidth: number;
  startWord: number;
  endWord: number;
  x: number;
  width: number;
  lineOffset: number;
}

interface Interval {
  start: number;
  end: number;
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

interface PlannedInsertion {
  flowId: string;
  blockId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

function isAtomicBlock(block: CompositionBlock): boolean {
  return block.atomic === true || block.kind === 'metric' || block.kind === 'chart';
}

function requiresBlockSlot(block: CompositionBlock): boolean {
  return isAtomicBlock(block) && (block.kind !== 'image' || block.role === 'chart' || block.role === 'metric');
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

function slotFor(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: Map<string, CompositionSlot>,
  pageState?: PageState,
): { definition: CompositionSlotTemplate; routeIndex: number } | undefined {
  const routeHasBlockSlot = slotIds.some((id) => layout.slots.some((slot) => slot.id === id && slot.kind === 'block'));
  for (let index = routeIndex; index < slotIds.length; index += 1) {
    const id = slotIds[index];
    const definition = layout.slots.find((slot) => slot.id === id && (slot.flowId === undefined || slot.flowId === flowId));
    if (!definition) continue;
    if (definition.allowedRoles?.includes('quote') && slots?.get(id)?.state === 'exhausted') continue;
    if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) continue;
    if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) continue;
    if (definition.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') continue;
    if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) continue;
    if (definition.kind === 'text' && routeHasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !definition.allowedBlockKinds?.includes(block.kind)) continue;
    return { definition, routeIndex: index };
  }
  return undefined;
}

function hasRoleEligibleSlot(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: Map<string, CompositionSlot>,
  pageState?: PageState,
): boolean {
  const routeHasBlockSlot = slotIds.some((id) => layout.slots.some((slot) => slot.id === id && slot.kind === 'block'));
  return slotIds.slice(routeIndex).some((id) => layout.slots.some((slot) => {
    if (slot.id !== id || (slot.flowId !== undefined && slot.flowId !== flowId)) return false;
    if (slot.allowedRoles?.includes('quote') && slots?.get(id)?.state === 'exhausted') return false;
    if (slot.allowedRoles && !slot.allowedRoles.includes(block.role)) return false;
    if (slot.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') return false;
    if (slot.allowedBlockKinds && !slot.allowedBlockKinds.includes(block.kind)) return false;
    if (slot.kind === 'text' && routeHasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !slot.allowedBlockKinds?.includes(block.kind)) return false;
    return !slot.allowedBlockIds || blockMatchesAllowedId(block.id, slot.allowedBlockIds);
  }));
}

function slotId(page: number, id: string): string {
  return `${page}:${id}`;
}

function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

function measure(metrics: CompositionTextMetrics, text: string, block: CompositionBlock): number {
  const width = metrics.measureText(text, styleFor(block));
  if (!Number.isFinite(width) || width < 0) throw new Error(`Text metrics returned an invalid width for '${styleFor(block)}': ${width}.`);
  return width;
}

function lineInkBounds(metrics: CompositionTextMetrics, block: CompositionBlock, lineHeightValue: number): { top: number; bottom: number } {
  const bounds = metrics.lineInkBounds?.(styleFor(block)) ?? { top: 0, bottom: lineHeightValue };
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom) || bounds.bottom < bounds.top) {
    throw new Error(`Text metrics returned invalid ink bounds for '${styleFor(block)}': ${JSON.stringify(bounds)}.`);
  }
  return bounds;
}

function textPadding(metrics: CompositionTextMetrics, block: CompositionBlock): { top: number; bottom: number } {
  const padding = metrics.textPadding?.(styleFor(block)) ?? { top: 0, bottom: 0 };
  if (!Number.isFinite(padding.top) || !Number.isFinite(padding.bottom) || padding.top < 0 || padding.bottom < 0) {
    throw new Error(`Text metrics returned invalid padding for '${styleFor(block)}': ${JSON.stringify(padding)}.`);
  }
  return padding;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

function availableIntervals(
  slot: CompositionRect,
  y: number,
  lineHeightValue: number,
  graphics: CompositionGraphicPlacement[],
): Interval[] {
  const blocked = mergeIntervals(graphics.flatMap((graphic) => graphic.wrap === 'around' ? graphicIntervalsForLine(graphic, y, lineHeightValue) : []));
  const available: Interval[] = [];
  let cursor = slot.x;
  for (const interval of blocked) {
    const start = Math.max(slot.x, interval.start);
    const end = Math.min(slot.x + slot.width, interval.end);
    if (start > cursor) available.push({ start: cursor, end: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < slot.x + slot.width) available.push({ start: cursor, end: slot.x + slot.width });
  return available;
}

function lineFitsFlowBarrierBox(
  y: number,
  lineBounds: { top: number; bottom: number },
  candidates: CompositionFlowBarrierBoxCandidate[],
  tolerance: number,
): boolean {
  if (candidates.length === 0) return true;
  return candidates.some((candidate) =>
    y + lineBounds.top >= candidate.box.y - tolerance
    && y + lineBounds.bottom <= rectBottom(candidate.box) + tolerance,
  );
}

/**
 * Return the first legal line-box position at a candidate boundary.
 * The candidate boundary is a placement opportunity, not the baseline: the
 * font's actual ink top must be accounted for before handing it to the
 * cursor. This keeps the planner and the PDF renderer on the same geometry.
 */
function nextFlowBarrierBoxLineY(
  currentY: number,
  lineBounds: { top: number; bottom: number },
  candidates: CompositionFlowBarrierBoxCandidate[],
  tolerance: number,
): number | undefined {
  return candidates
    .map((candidate) => ({ top: candidate.box.y, bottom: rectBottom(candidate.box) }))
    .sort((left, right) => left.top - right.top)
    .map((candidate) => ({
      lineY: candidate.top - lineBounds.top,
      bottom: candidate.bottom,
    }))
    .find((candidate) => {
      return candidate.lineY > currentY + tolerance
        && candidate.lineY + lineBounds.bottom <= candidate.bottom + tolerance;
    })?.lineY;
}

function widestInterval(intervals: Interval[], minimumWidth = 0): Interval | undefined {
  return intervals.filter((interval) => interval.end - interval.start >= minimumWidth).reduce<Interval | undefined>((widest, current) => {
    if (!widest || current.end - current.start > widest.end - widest.start) return current;
    return widest;
  }, undefined);
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
  if (!Number.isFinite(slot.width) || slot.width <= 0) return [];
  const words = wordsOf(textOf(block));
  const indent = Math.max(0, metrics.textIndent?.(styleFor(block)) ?? 0);
  const textSlot = { x: slot.x + indent, y: slot.y, width: Math.max(0, slot.width - indent), height: slot.height };
  const lines: WrappedLine[] = [];
  const inkBounds = lineInkBounds(metrics, block, lineHeightValue);
  const lineBounds = {
    top: Math.min(0, inkBounds.top),
    bottom: Math.max(lineHeightValue, inkBounds.bottom),
  };
  const lastFlowBarrierBottom = flowBarrierBoxCandidates.length > 0
    ? Math.max(...flowBarrierBoxCandidates.map((candidate) => rectBottom(candidate.box)))
    : Number.POSITIVE_INFINITY;
  let index = startWord;
  let lineOffset = startLineOffset;
  while (index < words.length) {
    const lineY = slot.y + lineOffset * lineHeightValue;
    if (lineY + lineBounds.bottom > bottom) break;
    if (lineY + lineBounds.top < slot.y - geometryTolerance) {
      lineOffset = (-lineBounds.top) / lineHeightValue;
      continue;
    }
    if (!lineFitsFlowBarrierBox(lineY, lineBounds, flowBarrierBoxCandidates, geometryTolerance)) {
      if (lineY >= lastFlowBarrierBottom - geometryTolerance) break;
      const nextLineY = nextFlowBarrierBoxLineY(lineY, lineBounds, flowBarrierBoxCandidates, geometryTolerance);
      if (nextLineY !== undefined) {
        lineOffset = (nextLineY - slot.y) / lineHeightValue;
        continue;
      }
      lineOffset += 1;
      continue;
    }
    const interval = widestInterval(availableIntervals(textSlot, lineY, lineHeightValue, graphics), minimumWrapWidth);
    if (!interval || interval.end <= interval.start) {
      lineOffset += 1;
      continue;
    }
    const intervalWidth = interval.end - interval.start;
    const firstWordWidth = measure(metrics, words[index], block);
    // Words are intentionally not split. When an exclusion leaves only a
    // narrow side interval that cannot hold the next word, wait until the
    // obstacle ends and try the full slot. A genuinely over-wide word in the
    // full slot is still emitted and reported as OVERFULL_LINE below.
    if (firstWordWidth > intervalWidth && intervalWidth < textSlot.width) {
      lineOffset += 1;
      continue;
    }
    let end = index;
    let text = '';
    while (end < words.length) {
      const candidate = text ? `${text} ${words[end]}` : words[end];
      const trailingReserve = end + 1 >= words.length
        ? Math.max(0, metrics.textTrailingReserve?.(styleFor(block)) ?? 0)
        : 0;
      const textWidth = Math.max(0, intervalWidth - trailingReserve);
      if (measure(metrics, candidate, block) <= textWidth || (!text && measure(metrics, candidate, block) <= intervalWidth)) {
        text = candidate;
        end += 1;
        continue;
      }
      break;
    }
    lines.push({
      text,
      naturalWidth: measure(metrics, text, block),
      startWord: index,
      endWord: end,
      x: interval.start,
      width: interval.end - interval.start,
      lineOffset,
    });
    index = end;
    lineOffset += 1;
  }
  return lines;
}

function obstructionBetweenLines(
  lines: WrappedLine[],
  graphics: CompositionGraphicPlacement[],
  slotY: number,
  lineHeightValue: number,
  tolerance: number,
): CompositionGraphicPlacement | undefined {
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const gapTop = slotY + (previous.lineOffset + 1) * lineHeightValue;
    const gapBottom = slotY + current.lineOffset * lineHeightValue;
    if (gapBottom - gapTop <= tolerance) continue;
    const obstruction = graphics.find((graphic) => graphic.wrap === 'around'
      && graphic.box.y < gapBottom - tolerance
      && rectBottom(graphic.box) > gapTop + tolerance
      && graphic.box.x < Math.max(previous.x + previous.width, current.x + current.width) + tolerance
      && graphic.box.x + graphic.box.width > Math.min(previous.x, current.x) - tolerance);
    if (obstruction) return obstruction;
  }
  return undefined;
}

function obstructionAcrossLineBands(
  bands: Array<{ lines: WrappedLine[]; lineHeight: number }>,
  slot: CompositionRect,
  slotY: number,
  graphics: CompositionGraphicPlacement[],
  tolerance: number,
): CompositionGraphicPlacement | undefined {
  const occupiedBands = bands
    .filter((band) => band.lines.length > 0)
    .map((band) => ({
      top: slotY + band.lines[0].lineOffset * band.lineHeight,
      bottom: slotY + (band.lines.at(-1)!.lineOffset + 1) * band.lineHeight,
    }));
  if (occupiedBands.length === 0) return undefined;
  const top = Math.min(...occupiedBands.map((band) => band.top));
  const bottom = Math.max(...occupiedBands.map((band) => band.bottom));
  return graphics
    .filter((graphic) => graphic.wrap === 'around'
      && graphic.box.y < bottom - tolerance
      && rectBottom(graphic.box) > top + tolerance
      && graphic.box.x < slot.x + slot.width + tolerance
      && graphic.box.x + graphic.box.width > slot.x - tolerance)
    .sort((left, right) => left.box.y - right.box.y)[0];
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

function insertionKey(flowId: string, blockId: string): string {
  return `${flowId}:${blockId}`;
}

/**
 * Read the insertion proposal produced by a previous planning pass. The
 * proposal is deliberately derived from the plan rather than from a fixed
 * page number: changing text metrics or a preceding block must be able to
 * move the proposal on the next pass.
 */
function insertionProposalsFromPlan(document: CompositionDocument, template: CompositionTemplate, plan: CompositionPlan): Map<string, PlannedInsertion> {
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
      proposals.set(insertionKey(flowId, block.id), { flowId, blockId: block.id, ...selected });
      previousCandidateIndex = selectedIndex;
    }
  }
  return proposals;
}

function insertionProposalSignature(proposals: Map<string, PlannedInsertion>): string {
  return [...proposals.values()]
    .sort((left, right) => insertionKey(left.flowId, left.blockId).localeCompare(insertionKey(right.flowId, right.blockId)))
    .map((proposal) => `${insertionKey(proposal.flowId, proposal.blockId)}@${proposal.page}:${proposal.slotId}:${proposal.box.x},${proposal.box.y},${proposal.box.width},${proposal.box.height}`)
    .join('|');
}

/**
 * Seed hard insertions in reading order. This is intentionally independent of
 * the amount of main text: otherwise the first pass can fill a future quote
 * band and only discover the quote after the band is no longer available.
 */
function seedInsertionProposals(document: CompositionDocument, template: CompositionTemplate): Map<string, PlannedInsertion> {
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
      proposals.set(insertionKey(flowId, block.id), { flowId, blockId: block.id, ...candidate });
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
      placeLines(page, definition, block, flowId, undefined, lines, leading, plan.placements, plan.insertionLines ?? (plan.insertionLines = []), 'insertion');
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
    const points = absoluteGraphicPoints(graphic, definition.box);
    const placement: CompositionGraphicPlacement = {
      id: `graphic:${graphic.id}`,
      graphicId: graphic.id,
      ...(graphic.assetId === undefined ? {} : { assetId: graphic.assetId }),
      slotId: slotId(pageState.page, definition.id),
      page: pageState.page,
      shape: graphic.shape,
      wrap: graphic.wrap ?? 'around',
      box: { ...definition.box },
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
  for (const page of pages) placeGraphicsForPage(document, page, plan);
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

function availableLineCount(height: number, leading: number): number {
  // Geometry assembled from normalized template fractions can land a few ULPs
  // below an exact line boundary (for example 1.9999999999999996 lines).
  // Treat that boundary as closed; otherwise a grown box can eject its last
  // line into the next slot and make the renderer appear to overlap content.
  const roundingUlps = 1024;
  return Math.max(0, Math.floor(height / leading + Number.EPSILON * roundingUlps));
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

/**
 * Return the first reserved insertion that occurs after the current authored
 * block and on this page. A full-width insertion is not a route segment: it
 * is a hard horizontal boundary for the current stream. Without this bound,
 * wrapBlock can see the obstacle, skip over it, and place the text authored
 * before the quote below the quote itself.
 */
function nextInsertionProposal(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): PlannedInsertion | undefined {
  if ((flow.insertionSlots?.length ?? 0) === 0) return undefined;
  return blocks
    .slice(blockIndex + 1)
    .filter((block) => block.role === 'quote')
    .map((block) => proposals.get(insertionKey(flowId, block.id)))
    .filter((proposal): proposal is PlannedInsertion => proposal !== undefined && proposal.page === page && proposal.box.y > afterY + Number.EPSILON)
    .sort((left, right) => left.box.y - right.box.y)[0];
}

function nextInsertionBoundary(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): number | undefined {
  return nextInsertionProposal(flow, blocks, blockIndex, page, proposals, flowId, afterY)?.box.y;
}

function placeLines(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  flowId: string,
  routeIndex: number | undefined,
  lines: WrappedLine[],
  lineHeightValue: number,
  placements: CompositionPlacement[],
  outputLines: CompositionLine[],
  layer: 'flow' | 'insertion' = 'flow',
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot || lines.length === 0) return;
  const box = slot.box;
  const first = lines[0];
  const last = lines.at(-1)!;
  const contentHeight = (last.lineOffset - first.lineOffset + 1) * lineHeightValue;
  const freeHeight = Math.max(0, box.height - contentHeight);
  const verticalOffset = definition.verticalAlign === 'middle'
    ? freeHeight / 2
    : definition.verticalAlign === 'bottom'
      ? freeHeight
      : 0;
  const firstY = box.y + first.lineOffset * lineHeightValue + verticalOffset;
  const lastBottom = box.y + (last.lineOffset + 1) * lineHeightValue + verticalOffset;
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
    const outputLine: CompositionLine = {
      blockId: block.id,
      flowId,
      slotId: slot.id,
      page: pageState.page,
      ...(routeIndex === undefined ? {} : { routeIndex }),
      text: line.text,
      box: {
        x: line.x,
        y: box.y + line.lineOffset * lineHeightValue + verticalOffset,
        width: line.width,
        height: lineHeightValue,
      },
      ...(definition.textAlign ? { textAlign: definition.textAlign } : {}),
      naturalWidth: line.naturalWidth,
      startWord: line.startWord,
      endWord: line.endWord,
      ...(layer === 'flow' ? {} : { layer }),
    };
    outputLines.push(outputLine);
  });
  const occupiedBottom = lastBottom;
  slot.state = occupiedBottom >= rectBottom(box) ? 'exhausted' : 'partial';
}

function placeAtomicBlock(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  measurement: CompositionBlockMeasurement,
  routeIndex: number,
  blockPlacements: CompositionBlockPlacement[],
  graphicPlacements: CompositionPlan['graphicPlacements'],
  top = pageState.slots.get(definition.id)?.box.y ?? definition.box.y,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  const placement: CompositionBlockPlacement = {
    id: `block-placement:${blockPlacements.length + 1}`,
    blockId: block.id,
    kind: block.kind,
    slotId: slot.id,
    page: pageState.page,
    routeIndex,
    box: { x: slot.box.x, y: top, width: slot.box.width, height: measurement.height },
  };
  if (block.kind === 'image' && measurement.image) {
    const imageX = block.image?.wrap === 'left'
      ? slot.box.x
      : block.image?.wrap === 'right'
        ? slot.box.x + slot.box.width - measurement.image.width
        : slot.box.x + (slot.box.width - measurement.image.width) / 2;
    placement.imageBox = {
      x: imageX,
      y: top,
      width: measurement.image.width,
      height: measurement.image.height,
    };
    if (measurement.image.captionHeight > 0) {
      placement.captionBox = {
        x: imageX,
        y: top + measurement.image.height,
        width: measurement.image.width,
        height: measurement.image.captionHeight,
      };
    }
    placement.scale = measurement.image.scale;
    if (block.image?.wrap === 'left' || block.image?.wrap === 'right') {
      graphicPlacements.push({
        id: `graphic:${block.id}:boundary`,
        graphicId: `${block.id}:boundary`,
        slotId: slot.id,
        page: pageState.page,
        shape: 'rectangle',
        wrap: 'around',
        paint: false,
        box: { x: imageX, y: top, width: measurement.image.width, height: measurement.height },
      });
    }
  }
  blockPlacements.push(placement);
  const canGrowFurther = definition.kind === 'text'
    && definition.grow?.axis === 'y'
    && rectBottom(slot.box) < definition.box.y + definition.grow.maxHeight - Number.EPSILON;
  slot.state = top + measurement.height >= rectBottom(slot.box) && !canGrowFurther ? 'exhausted' : 'partial';
}

function placeTableFragment(
  pageState: PageState,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  measurement: CompositionTableMeasurement,
  startRow: number,
  repeatsHeader: boolean,
  routeIndex: number,
  tablePlacements: CompositionPlan['tablePlacements'],
  top = pageState.slots.get(definition.id)?.box.y ?? definition.box.y,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  tablePlacements.push({
    id: `table-placement:${tablePlacements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    page: pageState.page,
    routeIndex,
    box: { x: slot.box.x, y: top, width: slot.box.width, height: measurement.height },
    startRow,
    endRow: measurement.endRow,
    repeatsHeader,
  });
  slot.state = 'exhausted';
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

function plannedLines(plan: CompositionPlan): CompositionLine[] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function glyphTargetBox(target: CompositionGlyphDefinition['target'], page: number, plan: CompositionPlan, lines: CompositionLine[]): { box: CompositionRect; slotId?: string; flowId?: string } | undefined {
  if (target.kind === 'graphic') {
    const graphic = plan.graphicPlacements.find((placement) => placement.page === page && (placement.graphicId === target.id || placement.id === target.id));
    return graphic ? { box: graphic.box, slotId: graphic.slotId } : undefined;
  }
  const targetLines = lines.filter((line) => line.page === page && line.blockId === target.id);
  if (targetLines.length > 0) {
    const left = Math.min(...targetLines.map((line) => line.box.x));
    const top = Math.min(...targetLines.map((line) => line.box.y));
    const right = Math.max(...targetLines.map((line) => line.box.x + line.box.width));
    const bottom = Math.max(...targetLines.map((line) => line.box.y + line.box.height));
    return { box: { x: left, y: top, width: right - left, height: bottom - top }, slotId: targetLines[0].slotId, flowId: targetLines[0].flowId };
  }
  const placement = plan.blockPlacements.find((candidate) => candidate.page === page && candidate.blockId === target.id);
  return placement ? { box: placement.box, slotId: placement.slotId, flowId: undefined } : undefined;
}

function glyphAnchorX(metrics: CompositionTextMetrics, spec: CompositionGlyphSpec, target: { box: CompositionRect; line?: CompositionLine }): number {
  const offsetX = spec.offsetX ?? 0;
  if (spec.anchor === 'text-start') {
    const anchorX = target.line?.box.x ?? target.box.x;
    return spec.anchorAlignment === 'end'
      ? anchorX - metrics.measureText(spec.text, spec.styleName) - offsetX
      : anchorX + offsetX;
  }
  if (spec.anchor === 'text-end') {
    if (!target.line) return target.box.x + target.box.width + offsetX;
    const textWidth = spec.anchorMeasureStyleName
      ? metrics.measureText(target.line.text, spec.anchorMeasureStyleName)
      : target.line.naturalWidth;
    const anchorX = target.line.box.x + textWidth;
    return spec.anchorAlignment === 'end'
      ? anchorX - metrics.measureText(spec.text, spec.styleName) - offsetX
      : anchorX + offsetX;
  }
  return target.box.x + offsetX;
}

function placeGlyphObjects(document: CompositionDocument, metrics: CompositionTextMetrics, plan: CompositionPlan): void {
  plan.glyphPlacements ??= [];
  const lines = plannedLines(plan);
  const generated = Object.values(document.flows).flatMap((flow) => flow.blocks.flatMap((block) => (metrics.glyphs?.(compositionStyleName(block)) ?? []).map((glyph) => ({
    ...glyph,
    id: `${block.id}:${glyph.id}`,
    target: { kind: 'block' as const, id: block.id },
    source: 'generated' as const,
  }))));
  const definitions: Array<CompositionGlyphDefinition & { source: 'generated' | 'authored' }> = [
    ...generated,
    ...(document.glyphs ?? []).map((glyph) => ({ ...glyph, source: 'authored' as const })),
  ];
  for (const definition of definitions) {
    const targetPages = definition.target.kind === 'graphic'
      ? plan.graphicPlacements.filter((placement) => placement.graphicId === definition.target.id || placement.id === definition.target.id).map((placement) => placement.page)
      : [...new Set(lines.filter((line) => line.blockId === definition.target.id).map((line) => line.page))];
    for (const page of targetPages) {
      const target = glyphTargetBox(definition.target, page, plan, lines);
      if (!target) continue;
      const targetLines = lines.filter((line) => line.page === page && line.blockId === definition.target.id).sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
      const targetLine = definition.targetMode === 'first-line' ? targetLines[0] : definition.targetMode === 'last-line' ? targetLines.at(-1) : undefined;
      if (definition.targetMode !== 'box' && !targetLine) continue;
      const glyphWidth = metrics.measureText(definition.text, definition.styleName);
      const baseBox = targetLine?.box ?? target.box;
      let x = glyphAnchorX(metrics, definition, { box: baseBox, line: targetLine });
      if (definition.clampToTarget) x = Math.max(target.box.x, Math.min(x, target.box.x + target.box.width - glyphWidth));
      const baselineOffset = metrics.glyphBaselineOffset?.(definition.styleName) ?? 0;
      const lineInkBounds = metrics.glyphInkBounds?.(definition.text, definition.styleName) ?? metrics.lineInkBounds?.(definition.styleName) ?? {
        top: 0,
        bottom: metrics.lineHeight(definition.styleName),
      };
      const y = baseBox.y + (definition.offsetY ?? 0);
      const glyphBoxY = y + lineInkBounds.top;
      const glyphBoxHeight = Math.max(0, lineInkBounds.bottom - lineInkBounds.top);
      plan.glyphPlacements.push({
        id: `glyph-placement:${definition.id}:${page}`,
        glyphId: definition.id,
        targetType: definition.target.kind,
        targetId: definition.target.id,
        ...(target.flowId === undefined ? {} : { flowId: target.flowId }),
        page,
        ...(target.slotId === undefined ? {} : { slotId: target.slotId }),
        text: definition.text,
        styleName: definition.styleName,
        anchor: definition.anchor,
        ...(definition.anchorAlignment === undefined ? {} : { anchorAlignment: definition.anchorAlignment }),
        ...(definition.anchorMeasureStyleName === undefined ? {} : { anchorMeasureStyleName: definition.anchorMeasureStyleName }),
        source: definition.source,
        // The debug/rendering box follows the actual painted ascender and
        // descender around the baseline. It is intentionally not the full
        // line-height box used by the planner for text flow.
        box: { x, y: glyphBoxY, width: glyphWidth, height: glyphBoxHeight },
        baselineY: y + baselineOffset,
        ...(definition.opacity === undefined ? {} : { opacity: definition.opacity }),
      });
      plan.decisions.push({ code: 'GLYPH_OBJECT_PLACED', glyphId: definition.id, targetId: definition.target.id, page, targetType: definition.target.kind, box: { x, y: glyphBoxY, width: glyphWidth, height: glyphBoxHeight } });
    }
  }
}

function recordPlanningPhase(
  plan: CompositionPlan,
  name: CompositionPlanningPhaseName,
  status: 'completed' | 'failed',
  details?: Record<string, unknown>,
  iteration?: number,
): void {
  plan.trace?.phases.push({ name, status, ...(iteration === undefined ? {} : { iteration }), ...(details ? { details } : {}) });
}

function sourceWordCount(block: CompositionBlock): number {
  return wordsForBlock(block).length;
}

function tracePlan(document: CompositionDocument, metrics: CompositionTextMetrics, plan: CompositionPlan): void {
  const sourceBlocks = Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => ({ flowId: flow.id, block })));
  const decisionsByBlock = new Map<string, CompositionTraceDecision[]>();
  for (const decision of plan.decisions) {
    const blockId = typeof decision.blockId === 'string' ? decision.blockId : undefined;
    if (!blockId) continue;
    const details = Object.fromEntries(Object.entries(decision).filter(([key]) => key !== 'code' && key !== 'blockId'));
    const decisions = decisionsByBlock.get(blockId) ?? [];
    if (!decisions.some((item) => item.code === decision.code && JSON.stringify(item.details) === JSON.stringify(details))) {
      decisions.push({ code: decision.code, details });
    }
    decisionsByBlock.set(blockId, decisions);
  }
  const fragmentsByBlock = new Map<string, CompositionBlockTrace['fragments']>();
  const addFragment = (blockId: string, fragment: CompositionBlockTrace['fragments'][number]): void => {
    const fragments = fragmentsByBlock.get(blockId) ?? [];
    fragments.push(fragment);
    fragmentsByBlock.set(blockId, fragments);
  };
  for (const line of plannedLines(plan)) addFragment(line.blockId, { page: line.page, slotId: line.slotId, ...(line.routeIndex === undefined ? {} : { routeIndex: line.routeIndex }), startWord: line.startWord, endWord: line.endWord, text: line.text, box: { ...line.box } });
  for (const placement of plan.blockPlacements) addFragment(placement.blockId, { page: placement.page, slotId: placement.slotId, routeIndex: placement.routeIndex, box: { ...placement.box } });
  for (const placement of plan.tablePlacements) addFragment(placement.blockId, { page: placement.page, slotId: placement.slotId, routeIndex: placement.routeIndex, box: { ...placement.box } });
  const residualIds = new Set(plan.residualContent.map((residual) => residual.blockId));
  const blocks = sourceBlocks.map(({ flowId, block }) => {
    const fragments = (fragmentsByBlock.get(block.id) ?? []).sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x);
    const coveredWords = fragments.reduce((total, fragment) => total + Math.max(0, (fragment.endWord ?? fragment.startWord ?? 0) - (fragment.startWord ?? 0)), 0);
    const status: CompositionBlockTrace['status'] = fragments.length === 0 ? 'empty' : residualIds.has(block.id) ? 'residual' : coveredWords < sourceWordCount(block) ? 'partial' : 'placed';
    return { flowId, blockId: block.id, kind: block.kind, role: block.role, sourceText: textOf(block), sourceWordCount: sourceWordCount(block), status, fragments, decisions: decisionsByBlock.get(block.id) ?? [] };
  });
  const lineHeightBySlot = new Map<string, number>();
  for (const line of plannedLines(plan)) if (!lineHeightBySlot.has(line.slotId)) lineHeightBySlot.set(line.slotId, line.box.height);
  const defaultLineHeight = metrics.lineHeight('body');
  const slots = plan.slots.map((slot) => {
    const lineHeightValue = lineHeightBySlot.get(slot.id) ?? defaultLineHeight;
    const occupiedBottom = Math.max(
      slot.box.y,
      ...plannedLines(plan).filter((line) => line.slotId === slot.id).map((line) => line.box.y + line.box.height),
      ...plan.blockPlacements.filter((placement) => placement.slotId === slot.id).map((placement) => placement.box.y + placement.box.height),
      ...plan.tablePlacements.filter((placement) => placement.slotId === slot.id).map((placement) => placement.box.y + placement.box.height),
    );
    const occupiedHeight = Math.max(0, occupiedBottom - slot.box.y);
    const remainingHeight = Math.max(0, slot.box.height - occupiedHeight);
    return {
      page: slot.page,
      slotId: slot.id,
      regionId: slot.regionId,
      ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
      ...(slot.routeIndex === undefined ? {} : { routeIndex: slot.routeIndex }),
      ...(slot.allowedRoles === undefined ? {} : { allowedRoles: [...slot.allowedRoles] }),
      state: slot.state,
      box: { ...slot.box },
      lineCount: plannedLines(plan).filter((line) => line.slotId === slot.id).length,
      occupiedHeight,
      remainingHeight,
      lineHeight: lineHeightValue,
      remainingLines: availableLineCount(remainingHeight, lineHeightValue),
    };
  });
  plan.trace = {
    phases: plan.trace?.phases ?? [],
    blocks,
    slots,
    ...(plan.flowPlacements ? { flowPlacements: plan.flowPlacements } : {}),
  } satisfies CompositionPlanTrace;
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

function registerFlowPlacements(document: CompositionDocument, plan: CompositionPlan): CompositionFlowPlacement[] {
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  const contentBySlot = new Map<string, Set<string>>();
  const linesBySlot = new Map<string, number>();
  const addContent = (flowId: string | undefined, slotId: string, blockId: string): void => {
    if (!flowId) return;
    const key = `${flowId}:${slotId}`;
    const blockIds = contentBySlot.get(key) ?? new Set<string>();
    blockIds.add(blockId);
    contentBySlot.set(key, blockIds);
  };
  for (const line of plannedLines(plan)) {
    addContent(line.flowId, line.slotId, line.blockId);
    linesBySlot.set(line.slotId, (linesBySlot.get(line.slotId) ?? 0) + 1);
  }
  for (const placement of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    addContent(blockFlowIds.get(placement.blockId), placement.slotId, placement.blockId);
  }
  return plan.slots
    .filter((slot): slot is CompositionSlot & { flowId: string; routeIndex: number } => slot.flowId !== undefined && slot.routeIndex !== undefined && slot.kind === 'text')
    .map((slot) => {
      const key = `${slot.flowId}:${slot.id}`;
      const blockIds = [...(contentBySlot.get(key) ?? new Set<string>())];
      const blockedBy = plan.graphicPlacements
        .filter((graphic) => graphic.page === slot.page && graphic.wrap === 'around'
          && graphic.box.x <= slot.box.x
          && graphic.box.y <= slot.box.y
          && rectBottom(graphic.box) >= rectBottom(slot.box)
          && graphic.box.x + graphic.box.width >= slot.box.x + slot.box.width)
        .map((graphic) => graphic.graphicId);
      return {
        id: `flow-placement:${slot.id}`,
        flowId: slot.flowId,
        page: slot.page,
        slotId: slot.id,
        routeIndex: slot.routeIndex,
        box: { ...slot.box },
        state: slot.state,
        hasContent: blockIds.length > 0,
        blockIds,
        lineCount: linesBySlot.get(slot.id) ?? 0,
        blockedBy,
      };
    })
    .sort((left, right) => left.page - right.page || left.routeIndex - right.routeIndex || left.slotId.localeCompare(right.slotId));
}

function splitFlowBarrierBoxCandidates(
  textPlacements: Array<Pick<CompositionFlowPlacement, 'id' | 'flowId' | 'page' | 'slotId' | 'box'>>,
  graphics: CompositionGraphicPlacement[],
): CompositionFlowBarrierBoxCandidate[] {
  const barriers = graphics.filter((candidate) => candidate.wrap === 'around');
  const candidates: CompositionFlowBarrierBoxCandidate[] = [];
  for (const placement of textPlacements) {
    const placementBottom = rectBottom(placement.box);
    const boundaries = barriers
      .filter((candidate) => candidate.page === placement.page && candidate.slotId !== placement.slotId && horizontalOverlap(placement.box, candidate.box) && rectsOverlap(placement.box, candidate.box))
      .sort((left, right) => left.box.y - right.box.y || left.graphicId.localeCompare(right.graphicId));
    if (boundaries.length === 0) continue;
    let segmentTop = placement.box.y;
    let previousSourceId: string | undefined;
    for (const boundary of boundaries) {
      const boundaryTop = Math.max(placement.box.y, Math.min(placementBottom, boundary.box.y));
      if (boundaryTop > segmentTop) {
        candidates.push({
          id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:${boundary.graphicId}`,
          flowId: placement.flowId,
          ...(previousSourceId === undefined ? {} : { previousSourceId }),
          nextSourceId: boundary.graphicId,
          placementId: placement.id,
          page: placement.page,
          box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: boundaryTop - segmentTop },
        });
      }
      segmentTop = Math.max(segmentTop, Math.min(placementBottom, rectBottom(boundary.box)));
      previousSourceId = boundary.graphicId;
    }
    if (placementBottom > segmentTop) {
      candidates.push({
        id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:flow-end`,
        flowId: placement.flowId,
        ...(previousSourceId === undefined ? {} : { previousSourceId }),
        placementId: placement.id,
        page: placement.page,
        box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: placementBottom - segmentTop },
      });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.flowId.localeCompare(right.flowId) || left.placementId.localeCompare(right.placementId) || (left.nextSourceId ?? '').localeCompare(right.nextSourceId ?? ''));
}

function flowBarrierBoxCandidatesForSlot(
  pageState: PageState,
  slot: CompositionSlot,
  flowId: string,
  plan: CompositionPlan,
): CompositionFlowBarrierBoxCandidate[] {
  if (slot.kind !== 'text') return [];
  return splitFlowBarrierBoxCandidates([{
    id: `flow-placement:${slot.id}`,
    flowId,
    page: pageState.page,
    slotId: slot.id,
    box: { ...slot.box },
  }], plan.graphicPlacements);
}

function registerFlowBarrierBoxCandidates(plan: CompositionPlan): CompositionFlowBarrierBoxCandidate[] {
  const textPlacements = (plan.flowPlacements ?? []).filter((placement) => placement.flowId !== undefined);
  return splitFlowBarrierBoxCandidates(textPlacements, plan.graphicPlacements);
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
      : slotFor(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots, currentPage);
    if (block.role !== 'quote' && cursor.startWord > 0 && selectedSlot) {
      const insertionIndex = availableRouteSlots.findIndex((slotId, index) => index >= cursor.routeIndex
        && index < selectedSlot!.routeIndex
        && currentPage.layout.slots.some((slot) => slot.id === slotId && slot.allowedRoles?.includes('quote'))
        && currentPage.slots.get(slotId)?.state === 'open');
      if (insertionIndex >= 0) {
        collapseInsertionBeforeContinuation(currentPage, availableRouteSlots, insertionIndex, plan, flowId, block.id);
        selectedSlot = slotFor(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots, currentPage);
      }
    }
    if (!selectedSlot || (selectedSlot.definition.kind !== 'text' && selectedSlot.definition.kind !== 'block')) {
      if (selectedSlot === undefined && !hasRoleEligibleSlot(currentPage.layout, availableRouteSlots, cursor.routeIndex, flowId, block, currentPage.slots, currentPage)) {
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
    if (block.kind === 'table') {
      const table = block.table;
      if (!table || !metrics.measureTable) {
        plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_UNAVAILABLE', `No renderer-neutral table measurement is available for '${block.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        cursor.startRow = 0;
        continue;
      }
      if (table.body.length === 0) {
        plan.decisions.push({ code: 'EMPTY_TABLE_SKIPPED', flowId, blockId: block.id, slotId: definition.id });
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        cursor.startRow = 0;
        continue;
      }
      const slot = currentPage.slots.get(definition.id)!;
      const tablePrevious = definition.kind === 'text' ? previousBlockInSlot(plan, slot.id, block.id, document) : undefined;
      const tableGap = tablePrevious ? metrics.blockGap?.(styleFor(tablePrevious), styleFor(block)) ?? 0 : 0;
      const tableTop = definition.kind === 'text'
        ? contentStartBottom(currentPage, plan, slot, document) + tableGap
        : slot.box.y;
      const tableBox = { ...slot.box, y: tableTop, height: Math.max(0, rectBottom(slot.box) - tableTop) };
      const repeatsHeader = cursor.startRow > 0
        && !plan.tablePlacements.some((placement) => placement.blockId === block.id && placement.page === currentPage.page);
      let measurement: CompositionTableMeasurement;
      try {
        measurement = metrics.measureTable(block, tableBox, cursor.startRow, { repeatHeader: repeatsHeader });
      } catch (cause) {
        plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_FAILED', `Measurement failed for table '${block.id}': ${cause instanceof Error ? cause.message : String(cause)}`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { startRow: cursor.startRow } }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        cursor.startRow = 0;
        continue;
      }
      const rowCount = table.body.length;
      if (!Number.isFinite(measurement.height) || measurement.height <= 0 || !Number.isInteger(measurement.endRow) || measurement.endRow <= cursor.startRow || measurement.endRow > rowCount) {
        plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_INVALID', `Table '${block.id}' returned an invalid fragment.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { startRow: cursor.startRow, endRow: measurement.endRow, height: measurement.height, rowCount } }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        cursor.startRow = 0;
        continue;
      }
      const availableHeight = rectBottom(slot.box) - tableTop;
      if (measurement.height > availableHeight) {
        plan.decisions.push({ code: 'TABLE_FRAGMENT_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, startRow: cursor.startRow, reason: 'table-fragment-does-not-fit' });
        advanceCursor(cursor, availableRouteSlots);
        continue;
      }
      placeTableFragment(currentPage, definition, block, measurement, cursor.startRow, repeatsHeader, selectedSlot.routeIndex, plan.tablePlacements, tableTop);
      plan.decisions.push({ code: 'TABLE_FRAGMENT_PLACED', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, startRow: cursor.startRow, endRow: measurement.endRow, repeatsHeader });
      cursor.startWord = 0;
      if (measurement.endRow >= rowCount) {
        cursor.blockIndex += 1;
        cursor.startRow = 0;
      } else {
        cursor.startRow = measurement.endRow;
      }
      if (definition.kind !== 'text' || tableTop + measurement.height >= rectBottom(slot.box)) advanceCursor(cursor, availableRouteSlots);
      continue;
    }
    if (definition.kind === 'block' || block.kind === 'image' || isAtomicBlock(block)) {
      if (!isAtomicBlock(block)) {
        plan.diagnostics.push(diagnostic('error', 'NON_ATOMIC_BLOCK_IN_BLOCK_SLOT', `Block slot '${definition.id}' cannot place non-atomic block '${block.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        continue;
      }
      if (!metrics.measureBlock) {
        plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_UNAVAILABLE', `No renderer-neutral measurement is available for atomic block '${block.id}'.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        continue;
      }
      const slot = currentPage.slots.get(definition.id)!;
      const previous = definition.kind === 'text' ? previousBlockInSlot(plan, slot.id, block.id, document) : undefined;
      const blockGap = previous ? metrics.blockGap?.(styleFor(previous), styleFor(block)) ?? 0 : 0;
      const blockTop = definition.kind === 'text'
        ? contentStartBottom(currentPage, plan, slot, document) + blockGap
        : slot.box.y;
      const blockMeasureBottom = definition.kind === 'text' && definition.grow?.axis === 'y'
        ? definition.box.y + definition.grow.maxHeight
        : rectBottom(slot.box);
      const blockBox = { ...slot.box, y: blockTop, height: Math.max(0, blockMeasureBottom - blockTop) };
      let measurement: CompositionBlockMeasurement;
      try {
        measurement = metrics.measureBlock(block, blockBox);
      } catch (cause) {
        plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_FAILED', `Measurement failed for atomic block '${block.id}': ${cause instanceof Error ? cause.message : String(cause)}`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        continue;
      }
      if (!Number.isFinite(measurement.height) || measurement.height <= 0) {
        plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_INVALID', `Atomic block '${block.id}' returned an invalid height.`, { flowId, blockId: block.id, page: currentPage.page, slotId: definition.id, details: { height: measurement.height } }));
        cursor.blockIndex += 1;
        cursor.startWord = 0;
        continue;
      }
      if (definition.kind === 'text' && definition.grow?.axis === 'y') {
        growSlot(currentPage, definition, blockTop + measurement.height, plan, flowId, block.id);
      }
      const availableBlockHeight = rectBottom(slot.box) - blockTop;
      const geometryTolerance = policy.geometryTolerance ?? 0;
      if (measurement.height > availableBlockHeight + geometryTolerance) {
        plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'atomic-block-does-not-fit' });
        advanceCursor(cursor, availableRouteSlots);
        continue;
      }
      if (blockTop + measurement.height > rectBottom(slot.box) + geometryTolerance) {
        plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'atomic-block-does-not-fit-after-existing-content' });
        advanceCursor(cursor, availableRouteSlots);
        continue;
      }
      placeAtomicBlock(currentPage, definition, block, measurement, selectedSlot.routeIndex, plan.blockPlacements, plan.graphicPlacements, blockTop);
      if (measurement.scaled) {
        plan.decisions.push({ code: block.kind === 'image' ? 'IMAGE_SCALED_TO_FIT' : 'BLOCK_SCALED_TO_FIT', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, reason: 'atomic-block-natural-height-exceeds-slot-height' });
      }
      plan.decisions.push({ code: 'ATOMIC_BLOCK_PLACED', flowId, blockId: block.id, slotId: slot.id, page: currentPage.page, height: measurement.height });
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      if (cursor.blockIndex < blocks.length && definition.kind !== 'text') advanceCursor(cursor, availableRouteSlots);
      continue;
    }
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
      : flowBarrierBoxCandidatesForSlot(currentPage, slot, flowId, plan);
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
    placeLines(currentPage, definition, block, flowId, continuousInsertion ? undefined : selectedSlot.routeIndex, selected, leading, plan.placements, plan.lines);
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
): CompositionPlan {
  const plan = createPlan(policy.minimumFragmentLines);
  validateGrowthPolicies(template, plan);
  recordPlanningPhase(plan, 'preflight', plan.diagnostics.some((item) => item.severity === 'error') ? 'failed' : 'completed', { layoutCount: template.layouts.length, flowCount: Object.keys(document.flows).length });
  const pages: PageState[] = [];
  materializeGraphicPages(document, template, pages, plan);
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
  return {
    plan(document, metrics) {
      const maxIterations = policy.maxPlanningIterations ?? 1;
      if (!Number.isInteger(maxIterations) || maxIterations < 1) {
        const plan = createPlan(policy.minimumFragmentLines);
        plan.diagnostics.push(diagnostic('error', 'PLANNER_ITERATION_POLICY_INVALID', 'Planner iteration count must be a positive integer.', { details: { maxIterations } }));
        return plan;
      }
      let proposals = seedInsertionProposals(document, template);
      let previousSignature: string | undefined;
      let latestPlan = planDocumentOnce(document, metrics, template, policy, proposals);
      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        const nextProposals = insertionProposalsFromPlan(document, template, latestPlan);
        const signature = insertionProposalSignature(nextProposals);
        latestPlan.decisions.push({ code: 'PLANNER_PASS_COMPLETED', iteration, insertionCount: nextProposals.size, signature });
        recordPlanningPhase(latestPlan, 'reflow', 'completed', { insertionCount: nextProposals.size, signature }, iteration);
        if (signature === previousSignature || (iteration === 1 && nextProposals.size === 0)) {
          latestPlan.decisions.push({ code: 'PLANNER_STABILIZED', iteration, insertionCount: nextProposals.size });
          return latestPlan;
        }
        if (iteration === maxIterations) {
          recordPlanningPhase(latestPlan, 'reflow', 'failed', { insertionCount: nextProposals.size, signature, iterations: maxIterations }, iteration);
          latestPlan.diagnostics.push(diagnostic('error', 'PLANNER_DID_NOT_STABILIZE', `Planner did not stabilize after ${maxIterations} pass(es).`, { details: { iterations: maxIterations, insertionCount: nextProposals.size } }));
          return latestPlan;
        }
        proposals = nextProposals;
        previousSignature = signature;
        latestPlan = planDocumentOnce(document, metrics, template, policy, proposals);
      }
      return latestPlan;
    },
  };
}
