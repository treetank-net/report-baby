import type {
  CompositionBlock,
  CompositionRect,
  CompositionSlotTemplate,
} from '../model.js';
import type {
  CompositionFlowBarrierBoxCandidate,
  CompositionGraphicPlacement,
  CompositionLine,
  CompositionPlacement,
  CompositionSlot,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { glyphSamplingBoxes } from '../glyph-sampling.js';
import { graphicIntervalsForLine } from '../geometry/visual-geometry.js';
import { rectBottom } from '../geometry/rectangles.js';
import { compositionStyleName } from './style-name.js';
import { wordsOf } from './tokenization.js';

export interface WrappedLine {
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

function measure(metrics: CompositionTextMetrics, text: string, styleName: string): number {
  const width = metrics.measureText(text, styleName);
  if (!Number.isFinite(width) || width < 0) throw new Error(`Text metrics returned an invalid width for '${styleName}': ${width}.`);
  return width;
}

function lineInkBounds(metrics: CompositionTextMetrics, styleName: string, lineHeight: number): { top: number; bottom: number } {
  const bounds = metrics.lineInkBounds?.(styleName) ?? { top: 0, bottom: lineHeight };
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom) || bounds.bottom < bounds.top) {
    throw new Error(`Text metrics returned invalid ink bounds for '${styleName}': ${JSON.stringify(bounds)}.`);
  }
  return bounds;
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
  lineHeight: number,
  graphics: CompositionGraphicPlacement[],
): Interval[] {
  const blocked = mergeIntervals(graphics.flatMap((graphic) => graphic.wrap === 'around' ? graphicIntervalsForLine(graphic, y, lineHeight) : []));
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

function nextFlowBarrierBoxLineY(
  currentY: number,
  lineBounds: { top: number; bottom: number },
  candidates: CompositionFlowBarrierBoxCandidate[],
  tolerance: number,
): number | undefined {
  return candidates
    .map((candidate) => ({ top: candidate.box.y, bottom: rectBottom(candidate.box) }))
    .sort((left, right) => left.top - right.top)
    .map((candidate) => ({ lineY: candidate.top - lineBounds.top, bottom: candidate.bottom }))
    .find((candidate) => candidate.lineY > currentY + tolerance
      && candidate.lineY + lineBounds.bottom <= candidate.bottom + tolerance)?.lineY;
}

function widestInterval(intervals: Interval[], minimumWidth = 0): Interval | undefined {
  return intervals.filter((interval) => interval.end - interval.start >= minimumWidth).reduce<Interval | undefined>((widest, current) => {
    if (!widest || current.end - current.start > widest.end - widest.start) return current;
    return widest;
  }, undefined);
}

export function wrapText(
  metrics: CompositionTextMetrics,
  text: string,
  styleName: string,
  startWord: number,
  slot: CompositionRect,
  startLineOffset: number,
  bottom: number,
  graphics: CompositionGraphicPlacement[],
  lineHeight: number,
  minimumWrapWidth = 0,
  flowBarrierBoxCandidates: CompositionFlowBarrierBoxCandidate[] = [],
  geometryTolerance = 0,
): WrappedLine[] {
  if (!Number.isFinite(slot.width) || slot.width <= 0) return [];
  const words = wordsOf(text);
  const indent = Math.max(0, metrics.textIndent?.(styleName) ?? 0);
  const textSlot = { x: slot.x + indent, y: slot.y, width: Math.max(0, slot.width - indent), height: slot.height };
  const lines: WrappedLine[] = [];
  const inkBounds = lineInkBounds(metrics, styleName, lineHeight);
  const lineBounds = { top: Math.min(0, inkBounds.top), bottom: Math.max(lineHeight, inkBounds.bottom) };
  const lastFlowBarrierBottom = flowBarrierBoxCandidates.length > 0
    ? Math.max(...flowBarrierBoxCandidates.map((candidate) => rectBottom(candidate.box)))
    : Number.POSITIVE_INFINITY;
  let index = startWord;
  let lineOffset = startLineOffset;
  while (index < words.length) {
    const lineY = slot.y + lineOffset * lineHeight;
    if (lineY + lineBounds.bottom > bottom) break;
    if (lineY + lineBounds.top < slot.y - geometryTolerance) {
      lineOffset = (-lineBounds.top) / lineHeight;
      continue;
    }
    if (!lineFitsFlowBarrierBox(lineY, lineBounds, flowBarrierBoxCandidates, geometryTolerance)) {
      if (lineY >= lastFlowBarrierBottom - geometryTolerance) break;
      const nextLineY = nextFlowBarrierBoxLineY(lineY, lineBounds, flowBarrierBoxCandidates, geometryTolerance);
      if (nextLineY !== undefined) {
        lineOffset = (nextLineY - slot.y) / lineHeight;
        continue;
      }
      lineOffset += 1;
      continue;
    }
    const interval = widestInterval(availableIntervals(textSlot, lineY, lineHeight, graphics), minimumWrapWidth);
    if (!interval || interval.end <= interval.start) {
      lineOffset += 1;
      continue;
    }
    const intervalWidth = interval.end - interval.start;
    const firstWordWidth = measure(metrics, words[index], styleName);
    if (firstWordWidth > intervalWidth && intervalWidth < textSlot.width) {
      lineOffset += 1;
      continue;
    }
    let end = index;
    let lineText = '';
    while (end < words.length) {
      const candidate = lineText ? `${lineText} ${words[end]}` : words[end];
      const trailingReserve = end + 1 >= words.length
        ? Math.max(0, metrics.textTrailingReserve?.(styleName) ?? 0)
        : 0;
      const textWidth = Math.max(0, intervalWidth - trailingReserve);
      if (measure(metrics, candidate, styleName) <= textWidth || (!lineText && measure(metrics, candidate, styleName) <= intervalWidth)) {
        lineText = candidate;
        end += 1;
        continue;
      }
      break;
    }
    lines.push({
      text: lineText,
      naturalWidth: measure(metrics, lineText, styleName),
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

export function obstructionBetweenLines(
  lines: WrappedLine[],
  graphics: CompositionGraphicPlacement[],
  slotY: number,
  lineHeight: number,
  tolerance: number,
): CompositionGraphicPlacement | undefined {
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const gapTop = slotY + (previous.lineOffset + 1) * lineHeight;
    const gapBottom = slotY + current.lineOffset * lineHeight;
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

export function obstructionAcrossLineBands(
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

/** Return the number of complete line boxes that fit in a vertical interval. */
export function availableLineCount(height: number, leading: number): number {
  const roundingUlps = 1024;
  return Math.max(0, Math.floor(height / leading + Number.EPSILON * roundingUlps));
}

/** Read the authored text carried by one block. */
function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

/** Resolve the renderer-neutral style name for one block. */
export function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

/** Validate and return the line height for one block. */
export function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

/** Validate and return the text padding for one block. */
export function textPadding(metrics: CompositionTextMetrics, block: CompositionBlock): { top: number; bottom: number } {
  const padding = metrics.textPadding?.(styleFor(block)) ?? { top: 0, bottom: 0 };
  if (!Number.isFinite(padding.top) || !Number.isFinite(padding.bottom) || padding.top < 0 || padding.bottom < 0) {
    throw new Error(`Text metrics returned invalid padding for '${styleFor(block)}': ${JSON.stringify(padding)}.`);
  }
  return padding;
}

/** Wrap one block against the supplied geometry and obstacles. */
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

/** Return the normalized word count basis for one block. */
export function wordsForBlock(block: CompositionBlock): string[] {
  return wordsOf(textOf(block));
}

export interface TextPlacementPage {
  page: number;
  slots: Map<string, CompositionSlot>;
}

type LinePlacementGeometry = {
  firstY: number;
  lastBottom: number;
  left: number;
  right: number;
  verticalOffset: number;
};

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

function alignedLineX(definition: CompositionSlotTemplate, line: WrappedLine): number {
  return definition.textAlign === 'right'
    ? line.x + line.width - line.naturalWidth
    : definition.textAlign === 'center'
      ? line.x + (line.width - line.naturalWidth) / 2
      : line.x;
}

function appendPlacedLines(
  pageState: TextPlacementPage,
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

function markLinePlacementOccupancy(slot: CompositionSlot, lastBottom: number): void {
  slot.state = lastBottom >= rectBottom(slot.box) ? 'exhausted' : 'partial';
}

/** Place wrapped lines, then update slot occupancy. */
export function placeLines(
  pageState: TextPlacementPage,
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
