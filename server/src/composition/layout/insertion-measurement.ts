import type {
  CompositionBlock,
  CompositionRect,
  CompositionSlotTemplate,
} from '../contracts/model.js';
import type { CompositionBlockMeasurement, CompositionTableMeasurement, CompositionTextMetrics } from '../contracts/engine-contracts.js';
import { rectBottom } from '../geometry/rectangles.js';
import { lineHeight, textPadding, wrapBlock, wordsForBlock } from '../text/text-layout.js';
import type { WrappedLine } from '../text/text-layout.js';

export type InsertionTextMeasurement = {
  leading: number;
  padding: { top: number; bottom: number };
  lines: WrappedLine[];
  wordCount: number;
  consumed: number;
};

export type InsertionContentMeasurement =
  | { kind: 'text'; text: InsertionTextMeasurement }
  | { kind: 'table'; table: CompositionTableMeasurement }
  | { kind: 'block'; block: CompositionBlockMeasurement };

/** Measure insertion text once so proposal fitting and placement share one calculator. */
export function measureInsertionText(
  metrics: CompositionTextMetrics,
  definition: CompositionSlotTemplate,
  box: CompositionRect,
  block: CompositionBlock,
): InsertionTextMeasurement {
  const leading = lineHeight(metrics, block);
  const padding = textPadding(metrics, block);
  const measurementBox = definition.fitContent && definition.grow?.axis === 'y'
    ? { ...box, height: Math.max(box.height, definition.grow.maxHeight) }
    : box;
  const contentBox = {
    ...measurementBox,
    y: measurementBox.y + padding.top,
    height: Math.max(0, measurementBox.height - padding.top - padding.bottom),
  };
  const lines = wrapBlock(metrics, block, 0, contentBox, 0, rectBottom(contentBox), [], leading);
  return {
    leading,
    padding,
    lines,
    wordCount: wordsForBlock(block).length,
    consumed: lines.at(-1)?.endWord ?? 0,
  };
}

/** Measure any content block claimed by an insertion slot. */
export function measureInsertionContent(
  metrics: CompositionTextMetrics,
  definition: CompositionSlotTemplate,
  box: CompositionRect,
  block: CompositionBlock,
): InsertionContentMeasurement | undefined {
  const measurementBox = definition.fitContent && definition.grow?.axis === 'y'
    ? { ...box, height: Math.max(box.height, definition.grow.maxHeight) }
    : box;
  if (block.kind === 'table') {
    if (!metrics.measureTable) return undefined;
    return { kind: 'table', table: metrics.measureTable(block, measurementBox, 0, { repeatHeader: false }) };
  }
  if (block.atomic === true || block.kind === 'image' || block.kind === 'metric' || block.kind === 'chart') {
    if (!metrics.measureBlock) return undefined;
    return { kind: 'block', block: metrics.measureBlock(block, measurementBox) };
  }
  return { kind: 'text', text: measureInsertionText(metrics, definition, box, block) };
}

export function insertionContentHeight(measurement: InsertionContentMeasurement): number {
  if (measurement.kind === 'text') {
    const { lines, leading, padding } = measurement.text;
    if (lines.length === 0) return 0;
    return padding.top + (lines.at(-1)!.lineOffset + 1) * leading + padding.bottom;
  }
  return measurement.kind === 'table' ? measurement.table.height : measurement.block.height;
}

export function insertionContentIsComplete(measurement: InsertionContentMeasurement, block: CompositionBlock): boolean {
  if (measurement.kind === 'text') return measurement.text.consumed >= measurement.text.wordCount;
  if (measurement.kind === 'table') return measurement.table.endRow >= (block.table?.body.length ?? 0);
  return true;
}
