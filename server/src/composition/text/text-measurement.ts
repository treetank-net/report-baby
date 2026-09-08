import type {
  CompositionBlock,
  CompositionRect,
} from '../model.js';
import type {
  CompositionFlowBarrierBoxCandidate,
  CompositionGraphicPlacement,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { compositionStyleName } from './style-name.js';
import { wordsOf } from './tokenization.js';
import { wrapText, type WrappedLine } from './text-wrapping.js';

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Read the authored text carried by one block.
 */
function textOf(block: CompositionBlock): string {
  return block.text?.trim() ?? '';
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Resolve the renderer-neutral style name for one block.
 */
export function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Validate and return the line height for one block.
 */
export function lineHeight(metrics: CompositionTextMetrics, block: CompositionBlock): number {
  const height = metrics.lineHeight(styleFor(block));
  if (!Number.isFinite(height) || height <= 0) throw new Error(`Text metrics returned an invalid line-height for '${styleFor(block)}': ${height}.`);
  return height;
}

/**
 * @planner-target composition/text-measurement.ts
 * @planner-responsibility Validate and return the text padding for one block.
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
 * @planner-responsibility Wrap one block against the supplied geometry and obstacles.
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
 * @planner-responsibility Return the normalized word count basis for one block.
 */
export function wordsForBlock(block: CompositionBlock): string[] {
  return wordsOf(textOf(block));
}
