import type { MetricCard } from '../rendering/svg.js';
import { FONT_FAMILY } from '../rendering/svg.js';
import { readRenderConfig, type RenderConfig } from '../template/builtins.js';
import type { Slide } from '../contracts/input/schema.js';
import type { RenderTheme } from '../contracts/render-theme.js';
import type { ResolvedSlidePlan } from '../contracts/resolved-slide-plan.js';

export const RENDER_CONFIG: RenderConfig = readRenderConfig();
export const WIDTH = RENDER_CONFIG.canvas.width;
export const HEIGHT = RENDER_CONFIG.canvas.height;
export const PPTX_WIDTH = RENDER_CONFIG.canvas.pptxWidth;
export const PPTX_HEIGHT = RENDER_CONFIG.canvas.pptxHeight;
export const PDF_WIDTH_MM = RENDER_CONFIG.canvas.pdfWidthMm;
export const PDF_HEIGHT_MM = RENDER_CONFIG.canvas.pdfHeightMm;
export const PX_PER_INCH = WIDTH / RENDER_CONFIG.canvas.pptxWidth;
export const PX_TO_PT = RENDER_CONFIG.canvas.pointsPerInch / PX_PER_INCH;
export const CARD_PADDING_INCHES = RENDER_CONFIG.spacing.cardPaddingX / PX_PER_INCH;

export const INK = '#0f172a';
export const MUTED = '#64748b';
export const ACCENT = '#2563eb';
export const SOFT = '#f8fafc';
export const LINE = '#e2e8f0';

export function pptxHeadingSize(sizePx: number, theme: RenderTheme): number {
  return sizePx * PX_TO_PT * theme.pptxHeadingScale;
}

export function textBoxBaseline(
  box: { y: number; height: number },
  size: number,
  verticalAlign?: 'top' | 'middle' | 'bottom',
  lineHeight = size * RENDER_CONFIG.text.lineHeight,
  lineCount = 1,
): number {
  if (verticalAlign) {
    const contentHeight = size + Math.max(0, lineCount - 1) * lineHeight;
    const freeSpace = Math.max(0, box.height - contentHeight);
    const offset = verticalAlign === 'middle' ? freeSpace / 2 : verticalAlign === 'bottom' ? freeSpace : 0;
    return box.y + offset + size;
  }
  const preferred = box.y + box.height * RENDER_CONFIG.fallbacks.text_box_baseline_ratio;
  const minimum = box.y + size;
  const maximum = box.y + box.height - size * RENDER_CONFIG.fallbacks.text_box_descender_ratio;
  return Math.max(minimum, Math.min(maximum, preferred));
}

export interface SlideLayout {
  headerTitleY: number;
  headerSubtitleY: number;
  headerLineY: number;
  contentTop: number;
  contentBottom: number;
  chart: { x: number; y: number; width: number; height: number };
  table: { x: number; y: number; width: number; height: number };
  narrativeY: number;
  conclusionsY: number;
}

export function slideLayout(theme: RenderTheme, plan?: ResolvedSlidePlan): SlideLayout {
  const headerLineY = plan?.slots.header ? plan.slots.header.y + plan.slots.header.height : plan?.headerLineY ?? RENDER_CONFIG.spacing.fallbackHeaderLine;
  const contentTop = plan?.slots.content?.y ?? headerLineY + RENDER_CONFIG.spacing.contentGap;
  const contentBottom = plan?.slots.content ? plan.slots.content.y + plan.slots.content.height : RENDER_CONFIG.spacing.fallbackContentBottom;
  const chart = plan?.slots.chart;
  const table = plan?.slots.table;
  const narrative = plan?.slots.narrative;
  const conclusions = plan?.slots.conclusions;
  return {
    headerTitleY: plan?.headerTitleY ?? RENDER_CONFIG.spacing.fallbackHeaderTitle,
    headerSubtitleY: plan?.headerSubtitleY ?? RENDER_CONFIG.spacing.fallbackHeaderSubtitle,
    headerLineY,
    contentTop,
    contentBottom,
    chart: chart ?? { x: RENDER_CONFIG.spacing.margin + RENDER_CONFIG.spacing.chartSidePadding, y: contentTop, width: RENDER_CONFIG.spacing.contentWidth - RENDER_CONFIG.spacing.chartSidePadding * 2, height: Math.min(RENDER_CONFIG.spacing.maxChartHeight, contentBottom - contentTop) },
    table: table ?? { x: RENDER_CONFIG.spacing.margin, y: contentTop + RENDER_CONFIG.spacing.tableTopAdjustment, width: RENDER_CONFIG.spacing.contentWidth, height: contentBottom - contentTop - RENDER_CONFIG.spacing.tableTopAdjustment },
    narrativeY: narrative?.y ?? contentTop + RENDER_CONFIG.spacing.narrativeOffset,
    conclusionsY: conclusions?.y ?? contentTop + RENDER_CONFIG.spacing.conclusionsOffset,
  };
}

export function isRtl(plan?: ResolvedSlidePlan): boolean {
  return plan?.direction === 'rtl';
}

export function logicalBoxX(left: number, width: number, plan?: ResolvedSlidePlan): number {
  return isRtl(plan) ? WIDTH - left - width : left;
}

export function logicalTextX(left: number, width: number, plan?: ResolvedSlidePlan, padding = RENDER_CONFIG.spacing.cardPaddingX): number {
  return isRtl(plan) ? left + width - padding : left + padding;
}

export function logicalTextAnchor(plan?: ResolvedSlidePlan): 'start' | 'end' {
  return isRtl(plan) ? 'end' : 'start';
}

export function estimatedTextWidth(value: string, size: number, family: string): number {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  return value.length * size * glyphWidth;
}

export function assertTextFitsBox(label: string, fit: ReturnType<typeof fitText>, box: { x: number; y: number; width: number; height: number }, baselineY: number, family: string): void {
  const widestLine = Math.max(0, ...fit.lines.map((line) => estimatedTextWidth(line, fit.size, family)));
  const top = baselineY - fit.size;
  const bottom = baselineY + Math.max(0, fit.lines.length - 1) * fit.lineHeight;
  const tolerance = RENDER_CONFIG.fallbacks.text_fit_tolerance;
  if (widestLine > box.width + tolerance) throw new Error(`${label} exceeds its template slot horizontally.`);
  if (top < box.y - tolerance || bottom > box.y + box.height + tolerance) throw new Error(`${label} exceeds its template slot vertically.`);
}

function lockupNameSize(brand: string | undefined, baseSize: number, theme: RenderTheme, plan: ResolvedSlidePlan): number {
  const rule = plan.slotRules['lockup-name'];
  if (!brand || !rule || rule.overflow === 'reject' || plan.lockup.name.width <= 0) return baseSize;
  const glyphWidth = theme.fontFamily.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  const available = plan.lockup.name.width + RENDER_CONFIG.fallbacks.text_fit_tolerance;
  const required = brand.length * glyphWidth;
  if (required <= 0) return baseSize;
  const largestFittingSize = Math.floor(available / required);
  if (largestFittingSize >= baseSize) return baseSize;
  const smallestAllowedSize = Math.min(theme.minHeadingPt, baseSize);
  if (largestFittingSize < smallestAllowedSize) throw new Error(`Brand name exceeds its template slot even at the smallest heading size: ${brand} needs ${Math.ceil(required * smallestAllowedSize)}px at ${smallestAllowedSize}pt but the slot is ${Math.round(available)}px wide`);
  return largestFittingSize;
}

function lockupVariant(slide: Slide): RenderConfig['chrome']['lockup']['standard' | 'title' | 'compact'] {
  return slide.type === 'title' ? RENDER_CONFIG.chrome.lockup.title : RENDER_CONFIG.chrome.lockup.standard;
}

function lockupGap(variant: ReturnType<typeof lockupVariant>, spacing: ResolvedSlidePlan['lockup']['spacing']): number {
  return spacing === 'compact' ? variant.gapCompactPx : spacing === 'open' ? variant.gapOpenPx : variant.gapNormalPx;
}

export function lockupGeometry(slide: Slide, theme: RenderTheme, brand?: string, plan?: ResolvedSlidePlan): { markX: number; markY: number; markW: number; markH: number; nameX: number; nameY: number; nameSize: number; nameAnchor: 'start' | 'end' } {
  const legacy = RENDER_CONFIG.legacy;
  const variant = lockupVariant(slide);
  if (plan) {
    const mark = plan.lockup.mark;
    const name = plan.lockup.name;
    const gap = lockupGap(variant, plan.lockup.spacing);
    const nameSize = lockupNameSize(brand, variant.nameSizePx, theme, plan);
    const nameY = textBoxBaseline({ y: mark.y, height: mark.height }, nameSize, plan.lockup.verticalAlign, nameSize, 1);
    return { markX: mark.x, markY: mark.y, markW: mark.width, markH: mark.height, nameX: plan.sourceTemplate ? (plan.lockup.physicalSide === 'right' ? name.x + name.width : name.x) : plan.lockup.physicalSide === 'right' ? mark.x - gap : mark.x + mark.width + gap, nameY, nameSize, nameAnchor: plan.lockup.physicalSide === 'right' ? 'end' : 'start' };
  }
  const title = slide.type === 'title';
  const centered = title && theme.titleAlign === 'center';
  const gap = lockupGap(variant, 'normal');
  const markW = variant.markWidthPx;
  const nameSize = variant.nameSizePx;
  const groupWidth = markW + gap + String(brand ?? '').length * (nameSize * RENDER_CONFIG.text.headingGlyphWidth);
  const markX = centered ? (WIDTH - groupWidth) / 2 : RENDER_CONFIG.spacing.margin;
  const markY = variant.markYPx;
  const markH = variant.markHeightPx;
  const nameY = textBoxBaseline({ y: markY, height: markH }, nameSize, variant.verticalAlign, nameSize, 1);
  return { markX, markY, markW, markH, nameX: markX + markW + gap, nameY, nameSize, nameAnchor: 'start' };
}

export function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function text(x: number, y: number, value: unknown, size: number, options: { color?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; family?: string } = {}): string {
  return `<text x="${x}" y="${y}" font-family="${options.family ?? FONT_FAMILY}" font-size="${size}" fill="${options.color ?? INK}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? 'start'}">${escapeXml(value)}</text>`;
}

export function wrap(value: string, maxChars: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitText(value: string, baseSize: number, baseMaxChars: number, maxLines: number, theme: RenderTheme, minimumPt = theme.minHeadingPt): { lines: string[]; size: number; lineHeight: number; overflow: boolean } {
  let scale = theme.headingScale;
  const minimumScale = theme.fitStrategy === 'shrink-to-fit' ? minimumPt / (baseSize * PX_TO_PT) : scale;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const lines = wrap(value, Math.max(baseMaxChars, Math.floor(baseMaxChars / Math.max(scale, 0.01))));
    if (lines.length <= maxLines) return { lines, size: baseSize * scale, lineHeight: baseSize * RENDER_CONFIG.text.lineHeight * scale, overflow: false };
    const next = Math.max(minimumScale, scale * 0.88);
    if (next === scale) return { lines, size: baseSize * scale, lineHeight: baseSize * RENDER_CONFIG.text.lineHeight * scale, overflow: true };
    scale = next;
  }
  const lines = wrap(value, Math.max(baseMaxChars, Math.floor(baseMaxChars / Math.max(scale, 0.01))));
  return { lines, size: baseSize * scale, lineHeight: baseSize * RENDER_CONFIG.text.lineHeight * scale, overflow: lines.length > maxLines };
}

export function fitSingleLine(value: string, width: number, size: number, family: string): string {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  const maxChars = Math.max(1, Math.floor(width / (size * glyphWidth)));
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function metricInnerBox(box: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return { x: box.x + RENDER_CONFIG.spacing.cardPaddingX, y: box.y + RENDER_CONFIG.spacing.cardPaddingY, width: Math.max(1, box.width - RENDER_CONFIG.spacing.cardPaddingX * 2), height: Math.max(1, box.height - RENDER_CONFIG.spacing.cardPaddingY * 2) };
}

function metricMaxChars(inner: { width: number }, size: number, family: string): number {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoBodyGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  return Math.max(4, Math.floor(inner.width / (size * glyphWidth)));
}

function fitMetricField(metric: MetricCard, label: string, value: string, size: number, family: string, baseline: number, inner: { x: number; y: number; width: number; height: number }, theme: RenderTheme, minimumPt = theme.minBodyPt): ReturnType<typeof fitText> {
  const fit = fitText(value, size, metricMaxChars(inner, size, family), 1, theme, minimumPt);
  if (fit.overflow) throw new Error(`Metric card '${metric.label}' ${label} does not fit its template slot.`);
  assertTextFitsBox(`Metric card '${metric.label}' ${label}`, fit, inner, baseline, family);
  return fit;
}

export function fitMetricCard(metric: MetricCard, box: { x: number; y: number; width: number; height: number }, theme: RenderTheme): { label: ReturnType<typeof fitText>; value: ReturnType<typeof fitText>; delta?: ReturnType<typeof fitText>; note?: ReturnType<typeof fitText> } {
  const inner = metricInnerBox(box);
  const label = fitMetricField(metric, 'label', metric.label.toUpperCase(), RENDER_CONFIG.typography.metricLabel, theme.fontFamily, box.y + box.height * RENDER_CONFIG.metrics.labelBaseline, inner, theme);
  const value = fitMetricField(metric, 'value', String(metric.value), Math.round(RENDER_CONFIG.typography.metricValue * theme.headingScale), theme.headingFontFamily, box.y + box.height * RENDER_CONFIG.metrics.valueBaseline, inner, theme, theme.minHeadingPt);
  const delta = metric.delta ? fitMetricField(metric, 'delta', metric.delta, RENDER_CONFIG.typography.metricDelta, theme.fontFamily, box.y + box.height * RENDER_CONFIG.metrics.deltaBaseline, inner, theme) : undefined;
  const note = metric.note ? fitMetricField(metric, 'note', metric.note, RENDER_CONFIG.typography.metricNote, theme.fontFamily, box.y + box.height - RENDER_CONFIG.metrics.noteBottom, inner, theme) : undefined;
  return { label, value, delta, note };
}

export function templateFitTheme(theme: RenderTheme, overflow: 'reject' | 'shrink-to-fit' | undefined): RenderTheme {
  return overflow ? { ...theme, fitStrategy: overflow === 'shrink-to-fit' ? 'shrink-to-fit' : 'none' } : theme;
}

export function fitTemplateText(label: string, value: string, box: { x: number; y: number; width: number; height: number }, baseSize: number, maxLines: number, overflow: 'reject' | 'shrink-to-fit' | undefined, verticalAlign: 'top' | 'middle' | 'bottom' | undefined, theme: RenderTheme, family: string): { fit: ReturnType<typeof fitText>; baseline: number } {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  const maxChars = Math.max(4, Math.floor(box.width / (baseSize * glyphWidth)));
  const fit = fitText(value, baseSize, maxChars, maxLines, templateFitTheme(theme, overflow), theme.minBodyPt);
  if (fit.overflow) throw new Error(`${label} does not fit its template slot.`);
  const baseline = textBoxBaseline(box, fit.size, verticalAlign, fit.lineHeight, fit.lines.length);
  assertTextFitsBox(label, fit, box, baseline, family);
  return { fit, baseline };
}

export function getTitleSafeArea(theme: RenderTheme, plan?: ResolvedSlidePlan): { x: number; y: number; width: number; height: number } {
  if (plan?.safeArea) return { x: plan.safeArea.x / WIDTH, y: plan.safeArea.y / HEIGHT, width: plan.safeArea.width / WIDTH, height: plan.safeArea.height / HEIGHT };
  return theme.headerStyle === 'image-band' || Boolean(theme.coverImagePath) ? theme.imageTextSafeArea : { x: RENDER_CONFIG.legacy.title_safe_x, y: 0, width: RENDER_CONFIG.legacy.title_safe_width, height: 1 };
}

export function titleTextLimit(theme: RenderTheme, area: { width: number }, size: number, fallback: number, graphic: boolean): number {
  const legacy = RENDER_CONFIG.legacy;
  if (!graphic && area.width >= legacy.title_area_width_threshold) return fallback;
  if (!graphic) return Math.max(legacy.header_title_min_chars, Math.min(fallback, Math.floor(fallback * area.width / legacy.title_area_width_threshold)));
  const estimatedGlyphWidth = size * (theme.headingFontFamily.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoHeadingGlyphWidth : legacy.title_graphic_glyph_width);
  return Math.max(legacy.header_title_min_chars, Math.min(fallback, Math.floor((area.width * WIDTH) / estimatedGlyphWidth)));
}

export function subtitleTextLimit(theme: RenderTheme, area: { width: number }, size: number, fallback: number, graphic: boolean): number {
  const legacy = RENDER_CONFIG.legacy;
  if (!graphic && area.width >= legacy.title_area_width_threshold) return fallback;
  if (!graphic) return Math.max(legacy.header_subtitle_min_chars, Math.min(fallback, Math.floor(fallback * area.width / legacy.title_area_width_threshold)));
  const estimatedGlyphWidth = size * (theme.fontFamily.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoBodyGlyphWidth : legacy.subtitle_graphic_glyph_width);
  return Math.max(legacy.header_subtitle_min_chars, Math.min(fallback, Math.floor((area.width * WIDTH) / estimatedGlyphWidth)));
}

export function titleLayoutDiagnostics(slide: Slide, theme: RenderTheme): { titleLines: number; subtitleLines: number } {
  if (slide.type !== 'title') return { titleLines: 0, subtitleLines: 0 };
  const area = getTitleSafeArea(theme);
  const graphic = Boolean(theme.coverImagePath) || (theme.headerStyle === 'image-band' && Boolean(theme.backgroundImagePath));
  const titleFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, RENDER_CONFIG.typography.title, titleTextLimit(theme, area, RENDER_CONFIG.typography.title, RENDER_CONFIG.legacy.title_max_chars, graphic), RENDER_CONFIG.text.titleMaxLines, theme);
  const subtitleFit = slide.subtitle ? fitText(slide.subtitle, RENDER_CONFIG.typography.subtitle * theme.bodyScale, subtitleTextLimit(theme, area, RENDER_CONFIG.typography.subtitle * theme.bodyScale, RENDER_CONFIG.legacy.subtitle_max_chars, graphic), RENDER_CONFIG.text.subtitleMaxLines, theme, theme.minBodyPt) : undefined;
  return { titleLines: titleFit.lines.length, subtitleLines: subtitleFit?.lines.length ?? 0 };
}

export function assertTitleWithinSafeArea(theme: RenderTheme, titleFit: ReturnType<typeof fitText>, subtitleFit?: ReturnType<typeof fitText>, plan?: ResolvedSlidePlan): void {
  const area = getTitleSafeArea(theme, plan);
  const titleBaselineY = plan?.titleLayout.titleBaselineY ?? RENDER_CONFIG.legacy.title_baseline_y;
  const subtitleBaselineY = plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleBaselineY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap);
  const top = titleBaselineY - titleFit.size;
  const titleBottom = titleBaselineY + Math.max(0, titleFit.lines.length - 1) * titleFit.lineHeight;
  const subtitleTop = subtitleFit ? subtitleBaselineY - subtitleFit.size : titleBottom;
  const bottom = subtitleFit ? subtitleTop + Math.max(0, subtitleFit.lines.length - 1) * subtitleFit.lineHeight : titleBottom;
  const areaTop = area.y * HEIGHT;
  const areaBottom = (area.y + area.height) * HEIGHT;
  const eyebrowTop = (plan?.titleLayout.eyebrowY ?? RENDER_CONFIG.fallbacks.title_eyebrow_y) - RENDER_CONFIG.legacy.title_eyebrow_top_adjustment;
  if (Math.min(eyebrowTop, top, subtitleFit ? subtitleTop : top) < areaTop || bottom > areaBottom) throw new Error(`Slide title content exceeds the safe image area (${area.x},${area.y},${area.width},${area.height}).`);
  const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');
  if (typedSource && plan?.slots.title && titleBottom > plan.slots.title.y + plan.slots.title.height) throw new Error('Slide title content exceeds its template slot.');
  if (subtitleFit && typedSource && plan?.slots.subtitle && bottom > plan.slots.subtitle.y + plan.slots.subtitle.height) throw new Error('Slide subtitle content exceeds its template slot.');
  if (typedSource && plan?.slots.eyebrow && eyebrowTop + RENDER_CONFIG.legacy.title_eyebrow_top_adjustment > plan.slots.eyebrow.y + plan.slots.eyebrow.height) throw new Error('Slide eyebrow content exceeds its template slot.');
}
