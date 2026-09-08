import type {
  CompositionBlock,
  CompositionRect,
} from '../contracts/model.js';
import type {
  CompositionFlowBarrierBoxCandidate,
  CompositionGraphicPlacement,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { graphicIntervalsForLine } from '../geometry/visual-geometry.js';
import { rectBottom } from '../geometry/rectangles.js';
import { compositionStyleName } from './style-name.js';
import { wordsOf } from './tokenization.js';
import type { WrappedLine } from './text-layout-contracts.js';
export { placeLines } from './text-placement.js';
export type { TextPlacementPage } from './text-placement.js';
export type { WrappedLine } from './text-layout-contracts.js';

interface Interval {
  start: number;
  end: number;
}

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current measure implementation intact until its target seam is extracted.
 */
function measure(metrics: CompositionTextMetrics, text: string, styleName: string): number {
  const width = metrics.measureText(text, styleName);
  if (!Number.isFinite(width) || width < 0) throw new Error(`Text metrics returned an invalid width for '${styleName}': ${width}.`);
  return width;
}

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current lineInkBounds implementation intact until its target seam is extracted.
 */
function lineInkBounds(metrics: CompositionTextMetrics, styleName: string, lineHeight: number): { top: number; bottom: number } {
  const bounds = metrics.lineInkBounds?.(styleName) ?? { top: 0, bottom: lineHeight };
  if (!Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom) || bounds.bottom < bounds.top) {
    throw new Error(`Text metrics returned invalid ink bounds for '${styleName}': ${JSON.stringify(bounds)}.`);
  }
  return bounds;
}

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current mergeIntervals implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current availableIntervals implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current lineFitsFlowBarrierBox implementation intact until its target seam is extracted.
 */
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
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current nextFlowBarrierBoxLineY implementation intact until its target seam is extracted.
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
    .map((candidate) => ({ lineY: candidate.top - lineBounds.top, bottom: candidate.bottom }))
    .find((candidate) => candidate.lineY > currentY + tolerance
      && candidate.lineY + lineBounds.bottom <= candidate.bottom + tolerance)?.lineY;
}

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current widestInterval implementation intact until its target seam is extracted.
 */
function widestInterval(intervals: Interval[], minimumWidth = 0): Interval | undefined {
  return intervals.filter((interval) => interval.end - interval.start >= minimumWidth).reduce<Interval | undefined>((widest, current) => {
    if (!widest || current.end - current.start > widest.end - widest.start) return current;
    return widest;
  }, undefined);
}

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current wrapText implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current obstructionBetweenLines implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current obstructionAcrossLineBands implementation intact until its target seam is extracted.
 */
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
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current availableLineCount implementation intact until its target seam is extracted.
 */
export function availableLineCount(height: number, leading: number): number {
  const roundingUlps = 1024;
  return Math.max(0, Math.floor(height / leading + Number.EPSILON * roundingUlps));
}

/** Read the authored text carried by one block. */
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current textOf implementation intact until its target seam is extracted.
 */
export function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

/** Resolve the renderer-neutral style name for one block. */
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current styleFor implementation intact until its target seam is extracted.
 */
export function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

/** Validate and return the line height for one block. */
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current lineHeight implementation intact until its target seam is extracted.
 */
export function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

/** Validate and return the text padding for one block. */
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current textPadding implementation intact until its target seam is extracted.
 */
export function textPadding(metrics: CompositionTextMetrics, block: CompositionBlock): { top: number; bottom: number } {
  const padding = metrics.textPadding?.(styleFor(block)) ?? { top: 0, bottom: 0 };
  if (!Number.isFinite(padding.top) || !Number.isFinite(padding.bottom) || padding.top < 0 || padding.bottom < 0) {
    throw new Error(`Text metrics returned invalid padding for '${styleFor(block)}': ${JSON.stringify(padding)}.`);
  }
  return padding;
}

/** Wrap one block against the supplied geometry and obstacles. */
/**
 * @planner-target composition/text/text-layout.ts
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

/** Return the normalized word count basis for one block. */
/**
 * @planner-target composition/text/text-layout.ts
 * @planner-responsibility Keep the current wordsForBlock implementation intact until its target seam is extracted.
 */
export function wordsForBlock(block: CompositionBlock): string[] {
  return wordsOf(textOf(block));
}
