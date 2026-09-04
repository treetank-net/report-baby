import type { CompositionBlock } from './model.js';
import type { CompositionGlyphSamplingBox, CompositionTextMetrics } from './engine.js';
import { compositionStyleName } from './style-name.js';

function styleFor(block: CompositionBlock): string {
  return compositionStyleName(block);
}

function measure(metrics: CompositionTextMetrics, text: string, block: CompositionBlock): number {
  const width = metrics.measureText(text, styleFor(block));
  if (!Number.isFinite(width) || width < 0) throw new Error(`Text metrics returned an invalid width for '${styleFor(block)}': ${width}.`);
  return width;
}

/** Creates renderer-neutral full-line-height sampling cells for each visible character. */
export function glyphSamplingBoxes(
  metrics: CompositionTextMetrics,
  block: CompositionBlock,
  text: string,
  textX: number,
  lineY: number,
  naturalWidth: number,
  lineHeightValue: number,
): CompositionGlyphSamplingBox[] {
  const characters = Array.from(text);
  const result: CompositionGlyphSamplingBox[] = [];
  const styleName = styleFor(block);
  const foreground = metrics.foregroundColor?.(styleName);
  let previousWidth = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    const prefixWidth = measure(metrics, characters.slice(0, index + 1).join(''), block);
    const width = Math.max(0, prefixWidth - previousWidth);
    previousWidth = prefixWidth;
    if (/^\s$/u.test(character) || width <= 0) continue;
    result.push({
      // Contrast sampling deliberately uses a predictable character cell:
      // advance width horizontally and the complete line height vertically.
      // It estimates the chance of a contrast problem; it is not an ink-mask
      // proof and therefore does not need backend-specific glyph outlines.
      box: { x: textX + prefixWidth - width, y: lineY, width, height: lineHeightValue },
      baselineY: lineY + (metrics.glyphBaselineOffset?.(styleName) ?? 0),
      ...(foreground ? { foreground } : {}),
    });
  }
  if (result.length > 0 && Math.abs(previousWidth - naturalWidth) > 0.0001) {
    const correction = naturalWidth - previousWidth;
    result.at(-1)!.box.width = Math.max(0, result.at(-1)!.box.width + correction);
  }
  return result;
}
