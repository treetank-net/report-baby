import type {
  CompositionBlock,
  CompositionRect,
  CompositionSlotTemplate,
} from '../contracts/model.js';
import type { CompositionTextMetrics } from '../contracts/engine-contracts.js';
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
