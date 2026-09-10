import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionInlineRun } from '../../contracts/model.js';
import type { CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfInlineFontCoverage,
  JsPdfCompositionStyle,
  JsPdfCompositionStyles,
} from '../../contracts/pdf.js';
import { styleForInlineRun } from '../../contracts/pdf.js';
import { missingInlineCodePoints, splitInlineRunByCoverage } from '../../text/inline-runs.js';
import { compositionStyleName } from '../../text/style-name.js';

/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current styleFor implementation intact until its target seam is extracted.
 */
export function styleFor(styles: JsPdfCompositionStyles, block: CompositionBlock): JsPdfCompositionStyle {
  const name = compositionStyleName(block);
  const style = styles[name];
  if (!style) throw new Error(`No jsPDF composition style was provided for '${name}'.`);
  return style;
}

/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current applyStyle implementation intact until its target seam is extracted.
 */
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
/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current measureLineInkBounds implementation intact until its target seam is extracted.
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

/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current measureGlyphInkBounds implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current textForStyle implementation intact until its target seam is extracted.
 */
export function textForStyle(value: string, style: JsPdfCompositionStyle): string {
  return style.textTransform === 'uppercase' ? value.toUpperCase() : value;
}

/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current oneLine implementation intact until its target seam is extracted.
 */
export function oneLine(doc: jsPDF, value: string, width: number): string {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= 1) return lines[0] ?? '';
  let prefix = lines[0] ?? '';
  while (prefix.length > 1 && doc.getTextWidth(`${prefix}…`) > width) prefix = prefix.slice(0, -1);
  return `${prefix.replace(/[\s,;:.\u2013\u2014-]+$/u, '')}…`;
}

function availableFontStyles(doc: jsPDF, family: string): Set<string> {
  const fonts = doc.getFontList() as Record<string, string[] | undefined>;
  return new Set(fonts[family] ?? []);
}

/** Resolve semantic inline marks to an actually registered jsPDF face. */
export function resolveInlineRunStyle(doc: jsPDF, family: string, style: JsPdfCompositionStyle, run?: CompositionInlineRun): JsPdfCompositionStyle {
  const desired = styleForInlineRun(style, run);
  const available = availableFontStyles(doc, desired.fontFamily ?? family);
  if (available.has(desired.fontStyle)) return desired;
  const fallback = desired.fontStyle === 'bolditalic'
    ? available.has('bold') ? 'bold' : available.has('italic') ? 'italic' : 'normal'
    : desired.fontStyle === 'italic' && !available.has('italic')
      ? 'normal'
      : desired.fontStyle === 'bold' && !available.has('bold')
        ? 'normal'
        : desired.fontStyle;
  return fallback === desired.fontStyle ? desired : { ...desired, fontStyle: fallback };
}

export function coverageForRun(run: CompositionInlineRun, coverage: JsPdfInlineFontCoverage | undefined): Set<number> | undefined {
  if (!coverage) return undefined;
  return run.marks.includes('strong') ? coverage.bold ?? coverage.regular : coverage.regular;
}

/** Apply one semantic run and switch the whole run to the fallback font when needed. */
export function applyInlineTextStyle(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionStyle,
  text: string,
  run: CompositionInlineRun | undefined,
  coverage: JsPdfInlineFontCoverage | undefined,
): JsPdfCompositionStyle {
  const resolved = resolveInlineRunStyle(doc, family, style, run);
  const effectiveRun = run ?? { text, marks: [] };
  const missing = missingInlineCodePoints([effectiveRun], coverageForRun(effectiveRun, coverage));
  const selected = missing.length > 0 && coverage ? { ...resolved, fontFamily: coverage.family } : resolved;
  applyStyle(doc, family, selected);
  return selected;
}

/** Draw one line while keeping uncovered characters selectable in the fallback face. */
export function drawInlineText(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionStyle,
  text: string,
  x: number,
  y: number,
  run: CompositionInlineRun | undefined,
  coverage: JsPdfInlineFontCoverage | undefined,
): void {
  let cursor = x;
  const effectiveRun = run ?? { text, marks: [] };
  for (const segment of splitInlineRunByCoverage(effectiveRun, coverageForRun(effectiveRun, coverage))) {
    const runStyle = resolveInlineRunStyle(doc, family, style, segment.run);
    const resolvedStyle = segment.fallback && coverage ? { ...runStyle, fontFamily: coverage.family } : runStyle;
    const segmentText = textForStyle(segment.run.text, resolvedStyle);
    if (!segmentText) continue;
    applyStyle(doc, family, resolvedStyle);
    doc.text(segmentText, cursor, y + resolvedStyle.baselineOffset);
    cursor += doc.getTextWidth(segmentText);
  }
}

function measureInlineText(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionStyle,
  text: string,
  run: CompositionInlineRun | undefined,
  coverage: JsPdfInlineFontCoverage | undefined,
): number {
  if (!run || !coverage) {
    const resolved = resolveInlineRunStyle(doc, family, style, run);
    applyStyle(doc, family, resolved);
    return doc.getTextWidth(textForStyle(text, resolved));
  }
  return splitInlineRunByCoverage(run, coverageForRun(run, coverage)).reduce((total, segment) => {
    const segmentStyle = resolveInlineRunStyle(doc, family, style, segment.run);
    const resolvedStyle = segment.fallback ? { ...segmentStyle, fontFamily: coverage.family } : segmentStyle;
    applyStyle(doc, family, resolvedStyle);
    return total + doc.getTextWidth(textForStyle(segment.run.text, resolvedStyle));
  }, 0);
}

/**
 * Adapt the real PDF font metrics to the renderer-neutral planner contract.
 * The planner only sees this interface; it never imports or calls jsPDF.
 */
/**
 * @planner-target composition/adapters/pdf/text.ts
 * @planner-responsibility Keep the current createJsPdfTextMetrics implementation intact until its target seam is extracted.
 */
export function createJsPdfTextMetrics(
  doc: jsPDF,
  family: string,
  styles: JsPdfCompositionStyles,
  options: { inlineFontCoverage?: JsPdfInlineFontCoverage } = {},
): CompositionTextMetrics {
  // Capture the font geometry once. Planning may ask for the same style many
  // times; this also makes the adapter an explicit measurement overlay rather
  // than letting the planner depend on mutable jsPDF state.
  const measuredLineInkBounds = new Map<string, { top: number; bottom: number }>();
  for (const [name, style] of Object.entries(styles)) measuredLineInkBounds.set(name, measureLineInkBounds(doc, family, style));
  return {
    units: 'mm',
    family,
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current measureText implementation intact until its target seam is extracted.
     */
    measureText(text, style, run?: CompositionInlineRun) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return measureInlineText(doc, family, selected, text, run, options.inlineFontCoverage);
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current lineHeight implementation intact until its target seam is extracted.
     */
    lineHeight(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.lineHeight;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current lineInkBounds implementation intact until its target seam is extracted.
     */
    lineInkBounds(style) {
      const bounds = measuredLineInkBounds.get(style);
      if (!bounds) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return bounds;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current glyphInkBounds implementation intact until its target seam is extracted.
     */
    glyphInkBounds(text, style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return measureGlyphInkBounds(doc, family, text, selected);
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current textPadding implementation intact until its target seam is extracted.
     */
    textPadding(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return { top: selected.paddingTop ?? 0, bottom: selected.paddingBottom ?? 0 };
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current foregroundColor implementation intact until its target seam is extracted.
     */
    foregroundColor(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textColor;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current glyphBaselineOffset implementation intact until its target seam is extracted.
     */
    glyphBaselineOffset(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.baselineOffset;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current textIndent implementation intact until its target seam is extracted.
     */
    textIndent(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textIndent ?? 0;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current textMargins implementation intact until its target seam is extracted.
     */
    textMargins(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return { before: selected.marginBefore ?? 0, after: selected.marginAfter ?? 0 };
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current textTrailingReserve implementation intact until its target seam is extracted.
     */
    textTrailingReserve(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      if (!selected.quoteMarks) return 0;
      applyStyle(doc, family, selected);
      doc.setFont(selected.fontFamily ?? family, 'bold');
      doc.setFontSize(selected.quoteMarks.size);
      return doc.getTextWidth(selected.quoteMarks.close) + selected.quoteMarks.gap;
    },
    /**
     * @planner-target composition/adapters/pdf/text.ts
     * @planner-responsibility Keep the current blockGap implementation intact until its target seam is extracted.
     */
    blockGap(previousStyle, nextStyle) {
      const previous = styles[previousStyle];
      const next = styles[nextStyle];
      if (!previous || !next) throw new Error(`No jsPDF composition style was provided for '${previousStyle}' or '${nextStyle}'.`);
      return Math.max(previous.marginAfter ?? 0, next.marginBefore ?? 0);
    },
  };
}
