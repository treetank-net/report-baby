import type { CompositionBlock, CompositionRect } from '../model.js';
import type { CompositionFlowBarrierBoxCandidate, CompositionGraphicPlacement, CompositionTextMetrics } from '../engine.js';
import { graphicIntervalsForLine } from '../geometry/visual-geometry.js';
import { rectBottom } from '../geometry/rectangles.js';
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
