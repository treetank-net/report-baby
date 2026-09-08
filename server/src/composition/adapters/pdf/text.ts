import type { jsPDF } from 'jspdf';
import type { CompositionBlock } from '../../model.js';
import type { CompositionTextMetrics } from '../../engine.js';
import type {
  JsPdfCompositionStyle,
  JsPdfCompositionStyles,
} from '../../contracts/pdf.js';
import { compositionStyleName } from '../../text/style-name.js';

export function styleFor(styles: JsPdfCompositionStyles, block: CompositionBlock): JsPdfCompositionStyle {
  const name = compositionStyleName(block);
  const style = styles[name];
  if (!style) throw new Error(`No jsPDF composition style was provided for '${name}'.`);
  return style;
}

export function applyStyle(doc: jsPDF, family: string, style: JsPdfCompositionStyle): void {
  doc.setFont(style.fontFamily ?? family, style.fontStyle);
  doc.setFontSize(style.fontSize);
  if (style.textColor) doc.setTextColor(...style.textColor);
}

interface JsPdfFontMetricsMetadata {
  ascender?: number;
  decender?: number;
}

/**
 * Read the same font metadata that jsPDF uses for the eventual PDF text.
 * jsPDF exposes ascender/decender in its normalized 1000-unit font space.
 */
function measureLineInkBounds(doc: jsPDF, family: string, style: JsPdfCompositionStyle): { top: number; bottom: number } {
  applyStyle(doc, family, style);
  const internal = doc.internal as unknown as { getFont?: () => { metadata?: JsPdfFontMetricsMetadata } };
  const font = internal.getFont?.();
  const metadata = font?.metadata;
  // The built-in PDF fonts (for example Helvetica) have no TTF metadata in
  // jsPDF. Preserve the renderer-neutral line-box contract for those fonts;
  // registered TTF/brand fonts take the measured path below.
  if (metadata === undefined || (metadata.ascender === undefined && metadata.decender === undefined)) {
    return { top: 0, bottom: style.lineHeight };
  }
  const ascender = metadata?.ascender;
  const decender = metadata?.decender;
  if (!Number.isFinite(ascender) || !Number.isFinite(decender) || ascender === undefined || decender === undefined || ascender <= 0 || decender >= 0) {
    throw new Error(`jsPDF did not expose usable ascender/decender metrics for '${family}' '${style.fontStyle}'.`);
  }
  const fontSizeMm = style.fontSize * 25.4 / 72;
  return {
    top: style.baselineOffset - (ascender / 1000) * fontSizeMm,
    bottom: style.baselineOffset + (Math.abs(decender) / 1000) * fontSizeMm,
  };
}

function measureGlyphInkBounds(doc: jsPDF, family: string, text: string, style: JsPdfCompositionStyle): { top: number; bottom: number } {
  applyStyle(doc, family, style);
  const internal = doc.internal as unknown as { getFont?: () => { metadata?: JsPdfFontMetricsMetadata } };
  const metadata = internal.getFont?.()?.metadata;
  const ascender = metadata?.ascender;
  const decender = metadata?.decender;
  if (Number.isFinite(ascender) && Number.isFinite(decender) && ascender !== undefined && decender !== undefined && ascender > 0 && decender < 0) {
    const fontSizeMm = style.fontSize * 25.4 / 72;
    return {
      top: style.baselineOffset - (ascender / 1000) * fontSizeMm,
      bottom: style.baselineOffset + (Math.abs(decender) / 1000) * fontSizeMm,
    };
  }
  // Standard PDF fonts do not expose ascender/descender metadata. Their
  // getTextDimensions height is still tied to the selected font size; use a
  // conservative baseline-to-top box so a large glyph cannot escape its
  // debug frame.
  const height = doc.getTextDimensions(textForStyle(text, style)).h;
  return { top: style.baselineOffset - height, bottom: style.baselineOffset };
}

export function textForStyle(value: string, style: JsPdfCompositionStyle): string {
  return style.textTransform === 'uppercase' ? value.toUpperCase() : value;
}

export function oneLine(doc: jsPDF, value: string, width: number): string {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= 1) return lines[0] ?? '';
  let prefix = lines[0] ?? '';
  while (prefix.length > 1 && doc.getTextWidth(`${prefix}…`) > width) prefix = prefix.slice(0, -1);
  return `${prefix.replace(/[\s,;:.\u2013\u2014-]+$/u, '')}…`;
}

/**
 * Adapt the real PDF font metrics to the renderer-neutral planner contract.
 * The planner only sees this interface; it never imports or calls jsPDF.
 */
export function createJsPdfTextMetrics(
  doc: jsPDF,
  family: string,
  styles: JsPdfCompositionStyles,
): CompositionTextMetrics {
  // Capture the font geometry once. Planning may ask for the same style many
  // times; this also makes the adapter an explicit measurement overlay rather
  // than letting the planner depend on mutable jsPDF state.
  const measuredLineInkBounds = new Map<string, { top: number; bottom: number }>();
  for (const [name, style] of Object.entries(styles)) measuredLineInkBounds.set(name, measureLineInkBounds(doc, family, style));
  return {
    units: 'mm',
    family,
    measureText(text, style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      applyStyle(doc, family, selected);
      return doc.getTextWidth(textForStyle(text, selected));
    },
    lineHeight(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.lineHeight;
    },
    lineInkBounds(style) {
      const bounds = measuredLineInkBounds.get(style);
      if (!bounds) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return bounds;
    },
    glyphInkBounds(text, style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return measureGlyphInkBounds(doc, family, text, selected);
    },
    textPadding(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return { top: selected.paddingTop ?? 0, bottom: selected.paddingBottom ?? 0 };
    },
    foregroundColor(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textColor;
    },
    glyphBaselineOffset(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.baselineOffset;
    },
    textIndent(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textIndent ?? 0;
    },
    textTrailingReserve(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      if (!selected.quoteMarks) return 0;
      applyStyle(doc, family, selected);
      doc.setFont(selected.fontFamily ?? family, 'bold');
      doc.setFontSize(selected.quoteMarks.size);
      return doc.getTextWidth(selected.quoteMarks.close) + selected.quoteMarks.gap;
    },
    blockGap(previousStyle, nextStyle) {
      const previous = styles[previousStyle];
      const next = styles[nextStyle];
      if (!previous || !next) throw new Error(`No jsPDF composition style was provided for '${previousStyle}' or '${nextStyle}'.`);
      return Math.max(previous.marginAfter ?? 0, next.marginBefore ?? 0);
    },
  };
}
