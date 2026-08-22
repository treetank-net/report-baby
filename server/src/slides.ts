import { createHash } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import PptxGenJS from 'pptxgenjs';
import { assetDataUri, defaultRenderTheme, type RenderTheme } from './brand.js';
import { readRenderConfig, type RenderConfig } from './builtin-template-loader.js';
import { loadRenderFontSet, newPdf, readableTextColor, renderSvgToPng } from './render.js';
import { FONT_FAMILY, PALETTE, renderChart, type ChartDatum, type ChartType, type MetricCard } from './svg.js';
import type { ResolvedSlidePlan } from './slide-plan.js';
import type { CompiledTemplate } from './template-source.js';
import { SLIDE_NOTES_MAX_CHARS } from './contract/schema.js';

export type Slide =
  | SlideBase & { type: 'title'; eyebrow?: string }
  | SlideBase & { type: 'metrics'; metrics: MetricCard[]; body?: string; callout?: string }
  | SlideBase & { type: 'chart'; chart: { type: ChartType; data: ChartDatum[]; prefix?: string; suffix?: string } }
  | SlideBase & { type: 'table'; head: string[]; body: Array<Array<string | number>> }
  | SlideBase & { type: 'narrative'; body: string; highlights?: string[] }
  | SlideBase & { type: 'conclusions'; items: string[] }
  | SlideBase & { type: 'columns'; columns: Array<{ heading?: string; body: string; highlights?: string[] }> };

interface SlideBase {
  title: string;
  subtitle?: string;
  notes?: string;
  brand_ref?: string;
  template_ref?: string;
  surface?: string;
  direction?: import('./slide-templates.js').TextDirection;
  overrides?: import('./brand.js').BrandOverrides;
}

export interface SlideDeck {
  title?: string;
  brand?: string;
  brand_ref?: string;
  template_ref?: string;
  surface?: string;
  direction?: import('./slide-templates.js').TextDirection;
  overrides?: import('./brand.js').BrandOverrides;
  footer?: string;
  slides: Slide[];
  slideThemes?: Array<RenderTheme | undefined>;
  slidePlans?: Array<ResolvedSlidePlan | undefined>;
  slideTemplateSources?: Array<CompiledTemplate | undefined>;
}

const RENDER_CONFIG: RenderConfig = readRenderConfig();
const WIDTH = RENDER_CONFIG.canvas.width;
const HEIGHT = RENDER_CONFIG.canvas.height;
const PPTX_WIDTH = RENDER_CONFIG.canvas.pptxWidth;
const PPTX_HEIGHT = RENDER_CONFIG.canvas.pptxHeight;
const PX_PER_INCH = WIDTH / RENDER_CONFIG.canvas.pptxWidth;
const PX_TO_PT = RENDER_CONFIG.canvas.pointsPerInch / PX_PER_INCH;
const CARD_PADDING_INCHES = RENDER_CONFIG.spacing.cardPaddingX / PX_PER_INCH;

function pptxHeadingSize(sizePx: number, theme: RenderTheme): number {
  return sizePx * PX_TO_PT * theme.pptxHeadingScale;
}
const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#2563eb';
const SOFT = '#f8fafc';
const LINE = '#e2e8f0';

function textBoxBaseline(box: { y: number; height: number }, size: number): number {
  const preferred = box.y + box.height * RENDER_CONFIG.fallbacks.text_box_baseline_ratio;
  const minimum = box.y + size;
  const maximum = box.y + box.height - size * RENDER_CONFIG.fallbacks.text_box_descender_ratio;
  return Math.max(minimum, Math.min(maximum, preferred));
}

interface SlideLayout {
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

function slideLayout(theme: RenderTheme, plan?: ResolvedSlidePlan): SlideLayout {
  const band = theme.headerStyle === 'accent-band' || theme.headerStyle === 'dark-band';
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

function isRtl(plan?: ResolvedSlidePlan): boolean {
  return plan?.direction === 'rtl';
}

function logicalBoxX(left: number, width: number, plan?: ResolvedSlidePlan): number {
  return isRtl(plan) ? WIDTH - left - width : left;
}

function logicalTextX(left: number, width: number, plan?: ResolvedSlidePlan, padding = RENDER_CONFIG.spacing.cardPaddingX): number {
  return isRtl(plan) ? left + width - padding : left + padding;
}

function logicalTextAnchor(plan?: ResolvedSlidePlan): 'start' | 'end' {
  return isRtl(plan) ? 'end' : 'start';
}

function estimatedTextWidth(value: string, size: number, family: string): number {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  return value.length * size * glyphWidth;
}

function assertTextFitsBox(label: string, fit: ReturnType<typeof fitText>, box: { x: number; y: number; width: number; height: number }, baselineY: number, family: string): void {
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

function lockupGeometry(slide: Slide, theme: RenderTheme, brand?: string, plan?: ResolvedSlidePlan): { markX: number; markY: number; markW: number; markH: number; nameX: number; nameY: number; nameSize: number; nameAnchor: 'start' | 'end' } {
  const legacy = RENDER_CONFIG.legacy;
  if (plan) {
    const title = slide.type === 'title';
    const mark = plan.lockup.mark;
    const name = plan.lockup.name;
    const gap = plan.lockup.spacing === 'compact' ? legacy.lockup_gap_compact : plan.lockup.spacing === 'open' ? legacy.lockup_gap_open : legacy.lockup_gap_normal;
    return { markX: mark.x, markY: mark.y, markW: mark.width, markH: mark.height, nameX: plan.sourceTemplate ? (plan.lockup.physicalSide === 'right' ? name.x + name.width : name.x) : plan.lockup.physicalSide === 'right' ? mark.x - gap : mark.x + mark.width + gap, nameY: plan.sourceTemplate ? name.y + name.height * RENDER_CONFIG.fallbacks.lockup_name_baseline_ratio : title ? legacy.title_name_y : legacy.regular_name_y, nameSize: lockupNameSize(brand, title ? legacy.title_name_size : legacy.regular_name_size, theme, plan), nameAnchor: plan.lockup.physicalSide === 'right' ? 'end' : 'start' };
  }
  const title = slide.type === 'title';
  const centered = title && theme.titleAlign === 'center';
  const markW = centered ? legacy.title_mark_width : legacy.regular_mark_width;
  const nameSize = title ? legacy.title_name_size : legacy.regular_name_size;
  const groupWidth = markW + legacy.lockup_gap_normal + String(brand ?? '').length * (nameSize * RENDER_CONFIG.text.headingGlyphWidth);
  const markX = centered ? (WIDTH - groupWidth) / 2 : RENDER_CONFIG.spacing.margin;
  return { markX, markY: title ? legacy.title_mark_y : legacy.regular_mark_y, markW, markH: legacy.regular_mark_width, nameX: markX + markW + legacy.lockup_gap_normal, nameY: title ? legacy.title_name_y : legacy.regular_name_y, nameSize, nameAnchor: 'start' };
}

function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function text(x: number, y: number, value: unknown, size: number, options: { color?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; family?: string } = {}): string {
  return `<text x="${x}" y="${y}" font-family="${options.family ?? FONT_FAMILY}" font-size="${size}" fill="${options.color ?? INK}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? 'start'}">${escapeXml(value)}</text>`;
}

function wrap(value: string, maxChars: number): string[] {
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

function wrappedText(x: number, y: number, value: string, size: number, maxChars: number, lineHeight: number, options: { color?: string; weight?: number; family?: string; anchor?: 'start' | 'end' } = {}): string {
  return wrap(value, maxChars).map((line, index) => text(x, y + index * lineHeight, line, size, options)).join('');
}

function validateSlideContent(slide: Slide): void {
  if (slide.notes !== undefined && slide.notes.length > SLIDE_NOTES_MAX_CHARS) {
    throw new Error(`Slide '${slide.title}' has ${slide.notes.length} characters of notes; at most ${SLIDE_NOTES_MAX_CHARS} are supported.`);
  }
  if (slide.type === 'table') {
    if (slide.body.length > 10) throw new Error(`Table slide '${slide.title}' has ${slide.body.length} rows; the renderer supports at most 10 without pagination.`);
    if ([...slide.head, ...slide.body.flat()].some((cell) => String(cell).length > RENDER_CONFIG.legacy.table_cell_max_chars)) throw new Error(`Table slide '${slide.title}' contains a cell longer than the supported ${RENDER_CONFIG.legacy.table_cell_max_chars}-character width.`);
  }
  if (slide.type === 'conclusions' && slide.items.length > 7) throw new Error(`Conclusions slide '${slide.title}' has more than 7 items; use another slide or a dedicated template.`);
  if (slide.type === 'narrative' && (slide.highlights?.length ?? 0) > 4) throw new Error(`Narrative slide '${slide.title}' has more than 4 highlights; use another slide or a dedicated template.`);
  if (slide.type === 'columns' && (slide.columns.length !== 2 || slide.columns.some((column) => !column.body || (column.highlights?.length ?? 0) > 3))) {
    throw new Error(`Two-column slide '${slide.title}' needs exactly two columns with at most three highlights per column.`);
  }
}

function fitText(value: string, baseSize: number, baseMaxChars: number, maxLines: number, theme: RenderTheme, minimumPt = theme.minHeadingPt): { lines: string[]; size: number; lineHeight: number; overflow: boolean } {
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

function fitSingleLine(value: string, width: number, size: number, family: string): string {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  const maxChars = Math.max(1, Math.floor(width / (size * glyphWidth)));
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function fitMetricCard(metric: MetricCard, box: { x: number; y: number; width: number; height: number }, theme: RenderTheme): {
  label: ReturnType<typeof fitText>;
  value: ReturnType<typeof fitText>;
  delta?: ReturnType<typeof fitText>;
  note?: ReturnType<typeof fitText>;
} {
  const inner = { x: box.x + RENDER_CONFIG.spacing.cardPaddingX, y: box.y + RENDER_CONFIG.spacing.cardPaddingY, width: Math.max(1, box.width - RENDER_CONFIG.spacing.cardPaddingX * 2), height: Math.max(1, box.height - RENDER_CONFIG.spacing.cardPaddingY * 2) };
  const maxChars = (size: number, family: string): number => Math.max(4, Math.floor(inner.width / (size * (family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoBodyGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth))));
  const make = (label: string, value: string, size: number, family: string, baseline: number, minimumPt = theme.minBodyPt): ReturnType<typeof fitText> => {
    const fit = fitText(value, size, maxChars(size, family), 1, theme, minimumPt);
    if (fit.overflow) throw new Error(`Metric card '${metric.label}' ${label} does not fit its template slot.`);
    assertTextFitsBox(`Metric card '${metric.label}' ${label}`, fit, inner, baseline, family);
    return fit;
  };
  const label = make('label', metric.label.toUpperCase(), RENDER_CONFIG.typography.metricLabel, theme.fontFamily, box.y + box.height * RENDER_CONFIG.metrics.labelBaseline);
  const value = make('value', String(metric.value), Math.round(RENDER_CONFIG.typography.metricValue * theme.headingScale), theme.headingFontFamily, box.y + box.height * RENDER_CONFIG.metrics.valueBaseline, theme.minHeadingPt);
  const delta = metric.delta ? make('delta', metric.delta, RENDER_CONFIG.typography.metricDelta, theme.fontFamily, box.y + box.height * RENDER_CONFIG.metrics.deltaBaseline) : undefined;
  const note = metric.note ? make('note', metric.note, RENDER_CONFIG.typography.metricNote, theme.fontFamily, box.y + box.height - RENDER_CONFIG.metrics.noteBottom) : undefined;
  return { label, value, delta, note };
}

function fitTemplateText(label: string, value: string, box: { x: number; y: number; width: number; height: number }, baseSize: number, maxLines: number, overflow: 'reject' | 'shrink-to-fit' | undefined, theme: RenderTheme, family: string): { fit: ReturnType<typeof fitText>; baseline: number } {
  const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
  const maxChars = Math.max(4, Math.floor(box.width / (baseSize * glyphWidth)));
  const fit = fitText(value, baseSize, maxChars, maxLines, templateFitTheme(theme, overflow), theme.minBodyPt);
  if (fit.overflow) throw new Error(`${label} does not fit its template slot.`);
  const baseline = textBoxBaseline(box, fit.size);
  assertTextFitsBox(label, fit, box, baseline, family);
  return { fit, baseline };
}

function templateFitTheme(theme: RenderTheme, overflow: 'reject' | 'shrink-to-fit' | undefined): RenderTheme {
  return overflow ? { ...theme, fitStrategy: overflow === 'shrink-to-fit' ? 'shrink-to-fit' : 'none' } : theme;
}

function getTitleSafeArea(theme: RenderTheme, plan?: ResolvedSlidePlan): { x: number; y: number; width: number; height: number } {
  if (plan?.safeArea) return { x: plan.safeArea.x / WIDTH, y: plan.safeArea.y / HEIGHT, width: plan.safeArea.width / WIDTH, height: plan.safeArea.height / HEIGHT };
  return theme.headerStyle === 'image-band' || Boolean(theme.coverImagePath) ? theme.imageTextSafeArea : { x: RENDER_CONFIG.legacy.title_safe_x, y: 0, width: RENDER_CONFIG.legacy.title_safe_width, height: 1 };
}

function titleTextLimit(theme: RenderTheme, area: { width: number }, size: number, fallback: number, graphic: boolean): number {
  const legacy = RENDER_CONFIG.legacy;
  if (!graphic && area.width >= legacy.title_area_width_threshold) return fallback;
  if (!graphic) return Math.max(legacy.header_title_min_chars, Math.min(fallback, Math.floor(fallback * area.width / legacy.title_area_width_threshold)));
  const estimatedGlyphWidth = size * (theme.headingFontFamily.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoHeadingGlyphWidth : legacy.title_graphic_glyph_width);
  return Math.max(legacy.header_title_min_chars, Math.min(fallback, Math.floor((area.width * WIDTH) / estimatedGlyphWidth)));
}

function subtitleTextLimit(theme: RenderTheme, area: { width: number }, size: number, fallback: number, graphic: boolean): number {
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

function assertTitleWithinSafeArea(theme: RenderTheme, titleFit: ReturnType<typeof fitText>, subtitleFit?: ReturnType<typeof fitText>, plan?: ResolvedSlidePlan): void {
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

function frame(deck: SlideDeck, slide: Slide, index: number, theme: RenderTheme, assets: { logo?: string; logoMark?: string; background?: string; cover?: string }, plan?: ResolvedSlidePlan): string[] {
  const legacy = RENDER_CONFIG.legacy;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`, `<rect width="${WIDTH}" height="${HEIGHT}" fill="${theme.background}"/>`];
  const titleGraphic = slide.type === 'title' && Boolean(assets.cover);
  if (titleGraphic) {
    parts.push(`<image href="${assets.cover}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice"/>`);
    if (theme.imageScrim) {
      const area = theme.imageTextSafeArea;
      parts.push(`<rect x="${area.x * WIDTH}" y="${area.y * HEIGHT}" width="${area.width * WIDTH}" height="${area.height * HEIGHT}" fill="${theme.imageScrim.color}" opacity="${theme.imageScrim.opacity}" rx="${theme.radius}"/>`);
    }
  } else if (assets.background && theme.headerStyle === 'image-band') {
    const imageArea = plan?.slots.image;
    if (imageArea) parts.push(`<image href="${assets.background}" x="${imageArea.x}" y="${imageArea.y}" width="${imageArea.width}" height="${imageArea.height}" preserveAspectRatio="xMidYMid slice" opacity="${theme.backgroundImageOpacity}"/>`);
    else parts.push(`<image href="${assets.background}" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" preserveAspectRatio="xMidYMid slice" opacity="${theme.backgroundImageOpacity}"/>`);
    if (theme.imageScrim) {
      const area = theme.imageTextSafeArea;
      parts.push(`<rect x="${area.x * WIDTH}" y="${area.y * HEIGHT}" width="${area.width * WIDTH}" height="${area.height * HEIGHT}" fill="${theme.imageScrim.color}" opacity="${theme.imageScrim.opacity}" rx="${theme.radius}"/>`);
    }
  }
  const band = theme.headerStyle === 'accent-band' ? theme.primary : theme.headerStyle === 'dark-band' ? theme.background : undefined;
  const layout = slideLayout(theme, plan);
  if (band && !titleGraphic) parts.push(`<rect x="0" y="0" width="${WIDTH}" height="${layout.headerLineY}" fill="${band}"/>`);
  const lockup = lockupGeometry(slide, theme, deck.brand, plan);
  const { markX, markY, markW } = lockup;
  if (assets.logoMark) parts.push(`<image href="${assets.logoMark}" x="${markX}" y="${markY}" width="${markW}" height="${lockup.markH}" preserveAspectRatio="xMidYMid meet"/>`);
  else if (assets.logo) {
    const logoW = slide.type === 'title' ? theme.titleLogoWidthPx : legacy.regular_logo_width;
    const logoH = slide.type === 'title' ? theme.titleLogoHeightPx : legacy.regular_logo_height;
    const logoX = plan?.lockup.physicalSide === 'right' ? WIDTH - RENDER_CONFIG.spacing.margin - logoW : plan?.titleAlign === 'center' ? (WIDTH - logoW) / 2 : RENDER_CONFIG.spacing.margin;
    parts.push(`<image href="${assets.logo}" x="${logoX}" y="${markY}" width="${logoW}" height="${logoH}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  const imageBand = theme.headerStyle === 'image-band' && Boolean(assets.background);
  const graphicText = imageBand ? theme.imageTextColor : '#ffffff';
  const bandText = band ? readableTextColor(band, theme, RENDER_CONFIG.typography.headerTitle, true) : imageBand ? graphicText : theme.foreground;
  if (assets.logoMark && slide.type === 'title' && deck.brand) {
    parts.push(text(lockup.nameX, lockup.nameY, deck.brand, lockup.nameSize, { color: band ? readableTextColor(band, theme, lockup.nameSize, true) : imageBand ? graphicText : theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: lockup.nameAnchor }));
  }
  if (slide.type !== 'title') {
    if (assets.logoMark && deck.brand) parts.push(text(lockup.nameX, lockup.nameY, deck.brand.toUpperCase(), lockup.nameSize, { color: bandText, weight: 700, family: theme.fontFamily, anchor: lockup.nameAnchor }));
    const headerTitleBox = plan?.sourceTemplate ? plan.slots.title : { x: RENDER_CONFIG.spacing.margin, y: layout.headerTitleY - legacy.header_title_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.header_title_box_height };
    const headerSubtitleBox = plan?.sourceTemplate ? plan.slots.subtitle : { x: RENDER_CONFIG.spacing.margin, y: layout.headerSubtitleY - legacy.header_subtitle_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.header_subtitle_box_height };
    const headerAnchor = plan?.titleAlign === 'right' || plan?.direction === 'rtl' ? 'end' : plan?.titleAlign === 'center' ? 'middle' : 'start';
    const headerX = headerAnchor === 'end' ? headerTitleBox.x + headerTitleBox.width : headerAnchor === 'middle' ? headerTitleBox.x + headerTitleBox.width / 2 : headerTitleBox.x;
    const headerTitleSize = Math.round(RENDER_CONFIG.typography.headerTitle * theme.headingScale);
    const headerTitleFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, headerTitleSize, Math.max(legacy.header_title_min_chars, Math.floor(headerTitleBox.width / (headerTitleSize * RENDER_CONFIG.text.headingGlyphWidth))), plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.headerMaxLines, templateFitTheme(theme, plan?.titleConstraints.overflow));
    if (headerTitleFit.overflow) throw new Error(`Slide heading does not fit within its template slot: ${slide.title}`);
    const headerTitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerTitleBox, headerTitleFit.size) : layout.headerTitleY;
    assertTextFitsBox('Slide heading', headerTitleFit, headerTitleBox, headerTitleBaseline, theme.headingFontFamily);
    parts.push(headerTitleFit.lines.map((line, lineIndex) => text(headerX, headerTitleBaseline + lineIndex * headerTitleFit.lineHeight, line, headerTitleFit.size, { color: bandText, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: headerAnchor })).join(''));
    if (slide.subtitle) {
      const subtitleX = headerAnchor === 'end' ? headerSubtitleBox.x + headerSubtitleBox.width : headerAnchor === 'middle' ? headerSubtitleBox.x + headerSubtitleBox.width / 2 : headerSubtitleBox.x;
      const headerSubtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale, Math.max(legacy.header_subtitle_min_chars, Math.floor(headerSubtitleBox.width / (RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale * RENDER_CONFIG.text.bodyGlyphWidth))), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.headerMaxLines, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
      if (headerSubtitleFit.overflow) throw new Error(`Slide subtitle does not fit within its template slot: ${slide.subtitle}`);
      const headerSubtitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerSubtitleBox, headerSubtitleFit.size) : layout.headerSubtitleY;
      assertTextFitsBox('Slide subtitle', headerSubtitleFit, headerSubtitleBox, headerSubtitleBaseline, theme.fontFamily);
      parts.push(headerSubtitleFit.lines.map((line, lineIndex) => text(subtitleX, headerSubtitleBaseline + lineIndex * headerSubtitleFit.lineHeight, line, headerSubtitleFit.size, { color: band ? readableTextColor(band, theme, headerSubtitleFit.size, false) : imageBand ? graphicText : theme.muted, family: theme.fontFamily, anchor: headerAnchor })).join(''));
    }
    const headerBox = plan?.slots.header ?? { x: RENDER_CONFIG.spacing.margin, y: 0, width: RENDER_CONFIG.spacing.contentWidth, height: layout.headerLineY };
    if (!band) parts.push(`<line x1="${headerBox.x}" y1="${layout.headerLineY}" x2="${headerBox.x + headerBox.width}" y2="${layout.headerLineY}" stroke="${theme.line}" stroke-width="2"/>`);
  }
  const footerBox = plan?.slots.footer ?? { x: RENDER_CONFIG.spacing.margin, y: RENDER_CONFIG.spacing.footerY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.spacing.footerHeight };
  const footerY = footerBox.y;
  const footerTextY = textBoxBaseline(footerBox, RENDER_CONFIG.typography.footer);
  const footerOnGraphic = imageBand || titleGraphic;
  const footerLineColor = footerOnGraphic ? theme.imageTextColor : theme.line;
  const footerTextColor = footerOnGraphic ? theme.titleSubtitleColor : theme.muted;
  parts.push(`<line x1="${footerBox.x}" y1="${footerY}" x2="${footerBox.x + footerBox.width}" y2="${footerY}" stroke="${footerLineColor}" stroke-width="2" opacity="${footerOnGraphic ? 0.65 : 1}"/>`);
  if (deck.footer) parts.push(text(logicalTextX(footerBox.x, footerBox.width, plan, 0), footerTextY, fitSingleLine(deck.footer, footerBox.width, RENDER_CONFIG.typography.footer, theme.fontFamily), RENDER_CONFIG.typography.footer, { color: footerTextColor, anchor: logicalTextAnchor(plan), family: theme.fontFamily }));
  parts.push(text(footerBox.x + footerBox.width, footerTextY, `${index + 1} / ${deck.slides.length}`, RENDER_CONFIG.typography.footer, { color: footerTextColor, anchor: 'end', family: theme.fontFamily }));
  return parts;
}

async function chartImage(slide: Extract<Slide, { type: 'chart' }>, theme: RenderTheme, width = RENDER_CONFIG.chart.width, height = RENDER_CONFIG.chart.height): Promise<string> {
  const svg = renderChart(slide.chart.type, {
    ...slide.chart,
    width,
    height,
    theme,
    data: slide.chart.data.map((datum, index) => ({ ...datum, color: datum.color ?? theme.palette[index % theme.palette.length] })),
  });
  const png = await renderSvgToPng(svg, width, await loadRenderFontSet(theme));
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function renderSlideSvg(deck: SlideDeck, slide: Slide, index: number, theme = defaultRenderTheme()): Promise<string> {
  validateSlideContent(slide);
  const legacy = RENDER_CONFIG.legacy;
  const plan = deck.slidePlans?.[index];
  const titleAlign = plan?.titleAlign ?? theme.titleAlign;
  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoMarkPath = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoMarkPath : theme.logoMarkPath;
  const [logo, logoMark, background, cover] = await Promise.all([assetDataUri(logoPath), assetDataUri(logoMarkPath), assetDataUri(theme.backgroundImagePath), assetDataUri(theme.coverImagePath)]);
  const parts = frame(deck, slide, index, theme, { logo, logoMark, background, cover }, plan);
  const layout = slideLayout(theme, plan);
  const titleOnGraphic = theme.headerStyle === 'dark-band' || Boolean(cover) || (theme.headerStyle === 'image-band' && Boolean(background));
  const titleColor = titleOnGraphic ? theme.titleColor : theme.foreground;
  const graphicContentColor = titleOnGraphic ? theme.imageTextColor : theme.foreground;
  const titleAnchor = titleAlign === 'center' ? 'middle' : titleAlign === 'right' ? 'end' : 'start';
  const safeArea = getTitleSafeArea(theme, plan);
  const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');
  const titleBox = typedSource && plan?.slots.title ? { x: plan.slots.title.x / WIDTH, y: plan.slots.title.y / HEIGHT, width: plan.slots.title.width / WIDTH, height: plan.slots.title.height / HEIGHT } : safeArea;
  const titleX = titleAlign === 'center' ? (titleBox.x + titleBox.width / 2) * WIDTH : titleAlign === 'right' ? (titleBox.x + titleBox.width) * WIDTH : titleBox.x * WIDTH;
  const eyebrowBox = typedSource && plan?.slots.eyebrow ? { x: plan.slots.eyebrow.x / WIDTH, y: plan.slots.eyebrow.y / HEIGHT, width: plan.slots.eyebrow.width / WIDTH, height: plan.slots.eyebrow.height / HEIGHT } : titleBox;
  const eyebrowX = titleAlign === 'center' ? (eyebrowBox.x + eyebrowBox.width / 2) * WIDTH : titleAlign === 'right' ? (eyebrowBox.x + eyebrowBox.width) * WIDTH : eyebrowBox.x * WIDTH;
  const eyebrowY = plan?.titleLayout.eyebrowY ?? RENDER_CONFIG.fallbacks.title_eyebrow_y;
  const titleY = plan?.titleLayout.titleBaselineY ?? RENDER_CONFIG.legacy.title_baseline_y;
  const graphicTitle = Boolean(cover) || (theme.headerStyle === 'image-band' && Boolean(background));
  const titleMaxChars = titleTextLimit(theme, titleBox, RENDER_CONFIG.typography.title, RENDER_CONFIG.legacy.title_max_chars, graphicTitle);
  if (slide.type === 'title') {
    const lockupName = lockupGeometry(slide, theme, deck.brand, plan);
    if (deck.brand && plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand], size: lockupName.nameSize, lineHeight: lockupName.nameSize, overflow: false }, plan.lockup.name, lockupName.nameY, theme.headingFontFamily);
    if (slide.eyebrow || deck.brand) {
      const eyebrowFit = fitText(slide.eyebrow ?? deck.brand?.toUpperCase() ?? '', RENDER_CONFIG.typography.eyebrow, RENDER_CONFIG.legacy.title_eyebrow_max_chars, plan?.eyebrowConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.eyebrowConstraints.overflow), theme.minBodyPt);
      if (eyebrowFit.overflow) throw new Error(`Slide eyebrow does not fit within the template slot: ${slide.eyebrow ?? deck.brand}`);
      assertTextFitsBox('Slide eyebrow', eyebrowFit, { x: eyebrowBox.x * WIDTH, y: eyebrowBox.y * HEIGHT, width: eyebrowBox.width * WIDTH, height: eyebrowBox.height * HEIGHT }, eyebrowY, theme.fontFamily);
      parts.push(eyebrowFit.lines.map((line, lineIndex) => text(eyebrowX, eyebrowY + lineIndex * eyebrowFit.lineHeight, line, eyebrowFit.size, { color: titleOnGraphic ? theme.titleAccentColor : theme.primary, weight: 700, anchor: titleAnchor, family: theme.fontFamily })).join(''));
    }
    const titleFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, RENDER_CONFIG.typography.title, titleMaxChars, plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.titleMaxLines, templateFitTheme(theme, plan?.titleConstraints.overflow));
    if (titleFit.overflow) throw new Error(`Slide title does not fit within the safe title area: ${slide.title}`);
    assertTextFitsBox('Slide title', titleFit, { x: titleBox.x * WIDTH, y: titleBox.y * HEIGHT, width: titleBox.width * WIDTH, height: titleBox.height * HEIGHT }, titleY, theme.headingFontFamily);
    parts.push(titleFit.lines.map((line, lineIndex) => text(titleX, titleY + lineIndex * titleFit.lineHeight, line, titleFit.size, { color: titleColor, weight: theme.headingWeight, family: theme.headingFontFamily, anchor: titleAnchor })).join(''));
    if (slide.subtitle) {
      const subtitleY = plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap);
      const subtitleBox = typedSource && plan?.slots.subtitle ? { x: plan.slots.subtitle.x / WIDTH, y: plan.slots.subtitle.y / HEIGHT, width: plan.slots.subtitle.width / WIDTH, height: plan.slots.subtitle.height / HEIGHT } : safeArea;
      const subtitleX = titleAlign === 'center' ? (subtitleBox.x + subtitleBox.width / 2) * WIDTH : titleAlign === 'right' ? (subtitleBox.x + subtitleBox.width) * WIDTH : subtitleBox.x * WIDTH;
      const subtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.subtitle * theme.bodyScale, subtitleTextLimit(theme, subtitleBox, RENDER_CONFIG.typography.subtitle * theme.bodyScale, RENDER_CONFIG.legacy.subtitle_max_chars, graphicTitle), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.subtitleMaxLines, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
      if (subtitleFit.overflow) throw new Error(`Slide subtitle does not fit within the safe title area: ${slide.subtitle}`);
      assertTextFitsBox('Slide subtitle', subtitleFit, { x: subtitleBox.x * WIDTH, y: subtitleBox.y * HEIGHT, width: subtitleBox.width * WIDTH, height: subtitleBox.height * HEIGHT }, subtitleY, theme.fontFamily);
      assertTitleWithinSafeArea(theme, titleFit, subtitleFit, plan);
      parts.push(subtitleFit.lines.map((line, lineIndex) => text(subtitleX, subtitleY + lineIndex * subtitleFit.lineHeight, line, subtitleFit.size, { color: titleOnGraphic ? theme.titleSubtitleColor : theme.muted, family: theme.fontFamily, anchor: titleAnchor })).join(''));
    } else assertTitleWithinSafeArea(theme, titleFit, undefined, plan);
  } else if (slide.type === 'metrics') {
    const brandMetrics = Boolean(plan?.slots['metric-1']);
    if (plan?.sourceTemplate?.archetype === 'metrics' && slide.metrics.length !== 3) throw new Error(`Template '${plan.templateRef}' requires exactly three metrics.`);
    const columns = Math.min(3, slide.metrics.length);
    const rows = Math.ceil(slide.metrics.length / columns);
    const gap = RENDER_CONFIG.spacing.cardGap;
    const cardWidth = (RENDER_CONFIG.spacing.contentWidth - gap * (columns - 1)) / columns;
    const cardHeight = Math.min(RENDER_CONFIG.metrics.maxHeight, (RENDER_CONFIG.metrics.usableHeight - gap * (rows - 1)) / rows);
    slide.metrics.forEach((metric, metricIndex) => {
      const col = metricIndex % columns;
      const row = Math.floor(metricIndex / columns);
      const sourceBox = brandMetrics ? plan?.slots[`metric-${metricIndex + 1}`] : undefined;
      if (brandMetrics && !sourceBox) throw new Error(`Template '${plan?.templateRef ?? 'resolved slide'}' is missing metric-${metricIndex + 1}.`);
      const x = sourceBox?.x ?? logicalBoxX(RENDER_CONFIG.spacing.margin + col * (cardWidth + gap), cardWidth, plan);
      const y = sourceBox?.y ?? layout.contentTop + row * (cardHeight + gap);
      const width = sourceBox?.width ?? cardWidth;
      const height = sourceBox?.height ?? cardHeight;
      const metricFit = fitMetricCard(metric, { x, y, width, height }, theme);
      parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.line}" stroke-width="2"/>`);
      const textX = logicalTextX(x, width, plan, RENDER_CONFIG.spacing.cardPaddingX);
      const anchor = logicalTextAnchor(plan);
      const labelY = y + height * RENDER_CONFIG.metrics.labelBaseline;
      const valueY = y + height * RENDER_CONFIG.metrics.valueBaseline;
      const deltaY = y + height * RENDER_CONFIG.metrics.deltaBaseline;
      parts.push(metricFit.label.lines.map((line, lineIndex) => text(textX, labelY + lineIndex * metricFit.label.lineHeight, line, metricFit.label.size, { color: theme.muted, weight: 700, family: theme.fontFamily, anchor })).join(''));
      parts.push(metricFit.value.lines.map((line, lineIndex) => text(textX, valueY + lineIndex * metricFit.value.lineHeight, line, metricFit.value.size, { color: theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor })).join(''));
      if (metricFit.delta) parts.push(metricFit.delta.lines.map((line, lineIndex) => text(textX, deltaY + lineIndex * metricFit.delta!.lineHeight, line, metricFit.delta!.size, { color: metric.trend === 'down' ? theme.danger : metric.trend === 'up' ? theme.success : theme.muted, weight: 700, family: theme.fontFamily, anchor })).join(''));
      if (metricFit.note) parts.push(metricFit.note.lines.map((line, lineIndex) => text(textX, y + height - RENDER_CONFIG.metrics.noteBottom + lineIndex * metricFit.note!.lineHeight, line, metricFit.note!.size, { color: theme.muted, family: theme.fontFamily, anchor })).join(''));
    });
    const bodyBox = brandMetrics ? plan?.slots.body : undefined;
    if (slide.body) {
      const box = bodyBox ?? { x: RENDER_CONFIG.spacing.margin, y: layout.contentTop + RENDER_CONFIG.fallbacks.metrics_body_y_offset, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.metrics_body_height };
      const body = fitTemplateText('Metrics body', slide.body, box, Math.round(RENDER_CONFIG.typography.body * theme.bodyScale), plan?.slotRules.body?.maxLines ?? 3, plan?.slotRules.body?.overflow, theme, theme.fontFamily);
      const bodyX = logicalTextX(box.x, box.width, plan, 0);
      parts.push(body.fit.lines.map((line, lineIndex) => text(bodyX, body.baseline + lineIndex * body.fit.lineHeight, line, body.fit.size, { color: theme.foreground, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    }
    if (slide.callout) {
      const calloutBox = brandMetrics ? plan?.slots.callout : undefined;
      const calloutX = calloutBox ? calloutBox.x : RENDER_CONFIG.spacing.margin;
      const calloutY = calloutBox?.y ?? layout.contentTop + RENDER_CONFIG.fallbacks.metrics_callout_y_offset;
      const calloutWidth = calloutBox?.width ?? RENDER_CONFIG.spacing.contentWidth;
      const calloutHeight = calloutBox?.height ?? RENDER_CONFIG.metrics.calloutHeight;
      parts.push(`<rect x="${calloutX}" y="${calloutY}" width="${calloutWidth}" height="${calloutHeight}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.primary}" stroke-width="2"/>`);
      const box = { x: calloutX + RENDER_CONFIG.metrics.calloutPaddingX, y: calloutY + RENDER_CONFIG.metrics.calloutPaddingY, width: calloutWidth - RENDER_CONFIG.metrics.calloutPaddingX * 2, height: calloutHeight - RENDER_CONFIG.metrics.calloutPaddingY * 2 };
      const callout = fitTemplateText('Metrics callout', slide.callout, box, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules.callout?.maxLines ?? 2, plan?.slotRules.callout?.overflow, theme, theme.fontFamily);
      const calloutXText = logicalTextX(calloutX, calloutWidth, plan, RENDER_CONFIG.metrics.calloutPaddingX);
      parts.push(callout.fit.lines.map((line, lineIndex) => text(calloutXText, callout.baseline + lineIndex * callout.fit.lineHeight, line, callout.fit.size, { color: theme.foreground, weight: 700, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    }
  } else if (slide.type === 'columns') {
    const fallbackBoxes = [
      { x: RENDER_CONFIG.spacing.margin, y: layout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: layout.contentBottom - layout.contentTop - legacy.columns_fallback_height_padding },
      { x: RENDER_CONFIG.spacing.margin + legacy.columns_fallback_width + legacy.columns_fallback_x_gap, y: layout.contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: layout.contentBottom - layout.contentTop - legacy.columns_fallback_height_padding },
    ];
    slide.columns.forEach((column, columnIndex) => {
      const box = plan?.slots[columnIndex === 0 ? 'left' : 'right'] ?? fallbackBoxes[columnIndex]!;
      parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${theme.radius}" fill="${theme.soft}" stroke="${theme.line}" stroke-width="2"/>`);
      const inner = { x: box.x + RENDER_CONFIG.spacing.columnPadding, y: box.y + RENDER_CONFIG.fallbacks.columns_inner_padding_y, width: box.width - RENDER_CONFIG.spacing.columnPadding * 2, height: box.height - RENDER_CONFIG.fallbacks.columns_inner_padding_y * 2 };
      const anchor = logicalTextAnchor(plan);
      const heading = column.heading ?? `Column ${columnIndex + 1}`;
      const headingFit = fitTemplateText(`Column ${columnIndex + 1} heading`, heading, { ...inner, height: legacy.columns_heading_height }, Math.round(RENDER_CONFIG.fallbacks.columns_heading_size * theme.headingScale), 2, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.overflow, theme, theme.headingFontFamily);
      const headingX = logicalTextX(box.x, box.width, plan, RENDER_CONFIG.spacing.columnPadding);
      parts.push(headingFit.fit.lines.map((line, lineIndex) => text(headingX, headingFit.baseline + lineIndex * headingFit.fit.lineHeight, line, headingFit.fit.size, { color: theme.foreground, weight: theme.headingWeight, family: theme.headingFontFamily, anchor })).join(''));
      const bodyValue = [column.body, ...(column.highlights ?? []).map((item) => `• ${item}`)].join('\n');
      const bodyBox = { x: inner.x, y: box.y + legacy.columns_body_top, width: inner.width, height: box.height - legacy.columns_body_bottom_padding };
      const bodyFit = fitTemplateText(`Column ${columnIndex + 1} body`, bodyValue, bodyBox, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.maxLines ?? 12, plan?.slotRules[columnIndex === 0 ? 'left' : 'right']?.overflow, theme, theme.fontFamily);
      parts.push(bodyFit.fit.lines.map((line, lineIndex) => text(logicalTextX(bodyBox.x, bodyBox.width, plan, 0), bodyFit.baseline + lineIndex * bodyFit.fit.lineHeight, line, bodyFit.fit.size, { color: theme.foreground, family: theme.fontFamily, anchor })).join(''));
    });
  } else if (slide.type === 'chart') {
  parts.push(`<image href="${await chartImage(slide, theme, layout.chart.width, layout.chart.height)}" x="${layout.chart.x}" y="${layout.chart.y}" width="${layout.chart.width}" height="${layout.chart.height}" preserveAspectRatio="xMidYMid meet"/>`);
  } else if (slide.type === 'table') {
    const columns = slide.head.length;
    const colWidth = RENDER_CONFIG.spacing.contentWidth / columns;
    const rows = slide.body.slice(0, 10);
    const rowHeight = Math.min(legacy.table_row_max_height, layout.table.height / (rows.length + 1));
    slide.head.forEach((cell, col) => {
      const x = logicalBoxX(RENDER_CONFIG.spacing.margin + col * colWidth, colWidth, plan);
      parts.push(`<rect x="${x}" y="${layout.table.y}" width="${colWidth}" height="${rowHeight}" fill="${theme.primary}"/>`);
      parts.push(text(logicalTextX(x, colWidth, plan), layout.table.y + rowHeight * legacy.table_row_text_ratio, fitSingleLine(cell, colWidth - RENDER_CONFIG.spacing.cardPaddingX, legacy.table_text_size, theme.fontFamily), legacy.table_text_size, { color: readableTextColor(theme.primary, theme, legacy.table_text_size, true), weight: 700, anchor: logicalTextAnchor(plan) }));
    });
    rows.forEach((row, rowIndex) => row.forEach((cell, col) => {
      const x = logicalBoxX(RENDER_CONFIG.spacing.margin + col * colWidth, colWidth, plan);
      const y = layout.table.y + (rowIndex + 1) * rowHeight;
      parts.push(`<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="${rowIndex % 2 ? theme.soft : theme.background}" stroke="${theme.line}" stroke-width="1"/>`);
      const cellSize = Math.round(legacy.table_body_text_size * theme.bodyScale);
      parts.push(text(logicalTextX(x, colWidth, plan), y + rowHeight * legacy.table_row_text_ratio, fitSingleLine(String(cell).slice(0, legacy.table_cell_max_chars), colWidth - RENDER_CONFIG.spacing.cardPaddingX, cellSize, theme.fontFamily), cellSize, { color: theme.foreground, anchor: logicalTextAnchor(plan) }));
    }));
  } else if (slide.type === 'narrative') {
    const narrativeBox = plan?.slots.narrative ?? { x: RENDER_CONFIG.spacing.margin, y: layout.narrativeY - RENDER_CONFIG.fallbacks.narrative_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: legacy.narrative_fallback_height };
    const narrativeFit = fitTemplateText('Narrative body', slide.body, narrativeBox, Math.round(RENDER_CONFIG.typography.narrative * theme.bodyScale), plan?.slotRules.narrative?.maxLines ?? 5, plan?.slotRules.narrative?.overflow, theme, theme.fontFamily);
    parts.push(narrativeFit.fit.lines.map((line, lineIndex) => text(logicalTextX(narrativeBox.x, narrativeBox.width, plan, 0), narrativeFit.baseline + lineIndex * narrativeFit.fit.lineHeight, line, narrativeFit.fit.size, { color: graphicContentColor, family: theme.fontFamily, anchor: logicalTextAnchor(plan) })).join(''));
    (slide.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => {
      const highlightBox = plan?.slots[`narrative-highlight-${itemIndex + 1}`] ?? { x: legacy.narrative_highlight_x, y: legacy.narrative_highlight_y + itemIndex * legacy.narrative_highlight_step, width: legacy.narrative_highlight_width, height: legacy.narrative_highlight_height };
      const fit = fitTemplateText(`Narrative highlight ${itemIndex + 1}`, item, highlightBox, Math.round(RENDER_CONFIG.typography.highlight * theme.bodyScale), plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.maxLines ?? 1, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.overflow, theme, theme.fontFamily);
      const bulletX = isRtl(plan) ? highlightBox.x + highlightBox.width + RENDER_CONFIG.spacing.columnPadding - RENDER_CONFIG.fallbacks.bullet_x_nudge : highlightBox.x - RENDER_CONFIG.spacing.columnPadding + RENDER_CONFIG.fallbacks.bullet_x_nudge;
      parts.push(`<circle cx="${bulletX}" cy="${fit.baseline - RENDER_CONFIG.spacing.cardPaddingY / RENDER_CONFIG.fallbacks.bullet_baseline_divisor}" r="${RENDER_CONFIG.shapes.bulletRadius}" fill="${titleOnGraphic ? theme.imageTextColor : theme.primary}"/>`);
      parts.push(fit.fit.lines.map((line, lineIndex) => text(logicalTextX(highlightBox.x, highlightBox.width, plan, 0), fit.baseline + lineIndex * fit.fit.lineHeight, line, fit.fit.size, { color: graphicContentColor, weight: 700, anchor: logicalTextAnchor(plan) })).join(''));
    });
  } else if (slide.type === 'conclusions') {
    const conclusionsBox = plan?.slots.conclusions ?? { x: RENDER_CONFIG.spacing.margin, y: layout.conclusionsY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.conclusions_height };
    slide.items.slice(0, 7).forEach((item, itemIndex) => {
      const rowHeight = conclusionsBox.height / Math.max(slide.items.length, 1);
      const y = conclusionsBox.y + rowHeight * (itemIndex + 0.5);
      const iconX = isRtl(plan) ? conclusionsBox.x + conclusionsBox.width - RENDER_CONFIG.shapes.conclusionIcon : conclusionsBox.x;
      parts.push(`<rect x="${iconX}" y="${y - RENDER_CONFIG.legacy.conclusion_icon_y_adjustment}" width="${RENDER_CONFIG.shapes.conclusionIcon}" height="${RENDER_CONFIG.shapes.conclusionIcon}" rx="${RENDER_CONFIG.shapes.conclusionIconRadius}" fill="${theme.palette[itemIndex % theme.palette.length]}"/>`);
      parts.push(text(iconX + RENDER_CONFIG.shapes.conclusionIcon / 2, y - RENDER_CONFIG.legacy.conclusion_number_y_adjustment, itemIndex + 1, RENDER_CONFIG.legacy.conclusion_number_size, { color: theme.background, weight: 700, anchor: 'middle' }));
      const conclusionTextX = isRtl(plan) ? conclusionsBox.x : iconX + RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr - RENDER_CONFIG.legacy.conclusion_icon_x_ltr;
      const conclusionTextWidth = conclusionsBox.width - RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr + RENDER_CONFIG.legacy.conclusion_icon_x_ltr;
      const conclusionSize = Math.round(RENDER_CONFIG.legacy.conclusion_text_size * theme.bodyScale);
      parts.push(text(logicalTextX(conclusionTextX, conclusionTextWidth, plan, 0), y, fitSingleLine(item, conclusionTextWidth, conclusionSize, theme.fontFamily), conclusionSize, { color: graphicContentColor, weight: 600, anchor: logicalTextAnchor(plan), family: theme.fontFamily }));
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

export async function renderSlidesPng(deck: SlideDeck, selectedIndex?: number, theme = defaultRenderTheme()): Promise<Buffer[]> {
  const indexes = selectedIndex === undefined ? deck.slides.map((_, index) => index) : [selectedIndex];
  return Promise.all(indexes.map(async (index) => {
    const slide = deck.slides[index];
    if (!slide) throw new Error(`Slide index ${index} is outside 0..${deck.slides.length - 1}`);
    const slideTheme = deck.slideThemes?.[index] ?? theme;
    return renderSvgToPng(await renderSlideSvg(deck, slide, index, slideTheme), WIDTH, await loadRenderFontSet(slideTheme));
  }));
}

export async function renderSlidesPdf(deck: SlideDeck, theme = defaultRenderTheme()): Promise<Buffer> {
  const doc = newPdf('landscape', [RENDER_CONFIG.canvas.height / 4, RENDER_CONFIG.canvas.width / 4]);
  for (let index = 0; index < deck.slides.length; index++) {
    if (index > 0) doc.addPage([RENDER_CONFIG.canvas.height / 4, RENDER_CONFIG.canvas.width / 4], 'landscape');
    const png = (await renderSlidesPng(deck, index, theme))[0];
    doc.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 0, 0, RENDER_CONFIG.canvas.width / 4, RENDER_CONFIG.canvas.height / 4);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

function addPptxFooter(pptxSlide: PptxGenJS.Slide, shapeType: PptxGenJS['ShapeType'], deck: SlideDeck, index: number, theme: RenderTheme, graphic: boolean, plan?: ResolvedSlidePlan): void {
  const footerBox = plan?.slots.footer ?? { x: RENDER_CONFIG.spacing.margin, y: RENDER_CONFIG.spacing.footerY, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.spacing.footerHeight };
  const footerOnGraphic = graphic;
  const footerLineColor = footerOnGraphic ? theme.imageTextColor.slice(1) : theme.line.slice(1);
  const footerTextColor = footerOnGraphic ? theme.titleSubtitleColor.slice(1) : theme.muted.slice(1);
  pptxSlide.addShape(shapeType.line, { x: footerBox.x / PX_PER_INCH, y: footerBox.y / PX_PER_INCH, w: footerBox.width / PX_PER_INCH, h: 0, line: { color: footerLineColor, width: 1, transparency: footerOnGraphic ? 35 : 0 } });
  if (deck.footer) pptxSlide.addText(fitSingleLine(deck.footer, footerBox.width - RENDER_CONFIG.legacy.footer_text_padding * 2, RENDER_CONFIG.typography.footer, theme.fontFamily), { x: footerBox.x / PX_PER_INCH, y: (footerBox.y + RENDER_CONFIG.legacy.footer_text_padding) / PX_PER_INCH, w: (footerBox.width - RENDER_CONFIG.legacy.footer_text_width) / PX_PER_INCH, h: RENDER_CONFIG.typography.footer * RENDER_CONFIG.text.lineHeight / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: RENDER_CONFIG.typography.footer * PX_TO_PT, color: footerTextColor, margin: 0, valign: 'top', align: plan?.direction === 'rtl' ? 'right' : 'left' });
  pptxSlide.addText(`${index + 1} / ${deck.slides.length}`, { x: (footerBox.x + footerBox.width - RENDER_CONFIG.legacy.footer_number_width) / PX_PER_INCH, y: (footerBox.y + RENDER_CONFIG.legacy.footer_text_padding) / PX_PER_INCH, w: RENDER_CONFIG.legacy.footer_number_width / PX_PER_INCH, h: RENDER_CONFIG.typography.footer * RENDER_CONFIG.text.lineHeight / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: RENDER_CONFIG.typography.footer * PX_TO_PT, color: footerTextColor, align: 'right', margin: 0, valign: 'top' });
}

async function pptxAssetDataUri(filePath: string | undefined, width: number, theme: RenderTheme): Promise<string | undefined> {
  const uri = await assetDataUri(filePath);
  const svgPrefix = 'data:image/svg+xml;base64,';
  if (!uri?.startsWith(svgPrefix)) return uri;
  const svg = Buffer.from(uri.slice(svgPrefix.length), 'base64').toString('utf8');
  const png = await renderSvgToPng(svg, width, await loadRenderFontSet(theme));
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function addPptxHeader(pptxSlide: PptxGenJS.Slide, shapeType: PptxGenJS['ShapeType'], deck: SlideDeck, slide: Exclude<Slide, { type: 'title' }>, index: number, theme: RenderTheme, plan?: ResolvedSlidePlan): Promise<void> {
  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoMarkPath = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoMarkPath : theme.logoMarkPath;
  const [logo, logoMark] = await Promise.all([pptxAssetDataUri(logoPath, RENDER_CONFIG.pptx.logo_raster_width, theme), pptxAssetDataUri(logoMarkPath, RENDER_CONFIG.pptx.logo_raster_width, theme)]);
  const band = theme.headerStyle === 'accent-band' ? theme.primary : theme.headerStyle === 'dark-band' ? theme.background : undefined;
  const layout = slideLayout(theme, plan);
  const headerTitleBox = plan?.sourceTemplate ? plan.slots.title : { x: RENDER_CONFIG.spacing.margin, y: layout.headerTitleY - RENDER_CONFIG.legacy.header_title_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.header_title_box_height };
  const headerSubtitleBox = plan?.sourceTemplate ? plan.slots.subtitle : { x: RENDER_CONFIG.spacing.margin, y: layout.headerSubtitleY - RENDER_CONFIG.legacy.header_subtitle_box_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.header_subtitle_box_height };
  const headerFit = fitText(theme.titleCase === 'upper' ? slide.title.toUpperCase() : slide.title, RENDER_CONFIG.typography.headerTitle, Math.max(RENDER_CONFIG.legacy.header_title_min_chars, Math.floor(headerTitleBox.width / (RENDER_CONFIG.typography.headerTitle * RENDER_CONFIG.text.headingGlyphWidth))), plan?.titleConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.titleConstraints.overflow));
  if (headerFit.overflow) throw new Error(`Slide heading does not fit within the safe header area: ${slide.title}`);
  if (band) pptxSlide.addShape(shapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: layout.headerLineY / PX_PER_INCH, fill: { color: band.slice(1) }, line: { color: band.slice(1), transparency: 100 } });
  const lockup = lockupGeometry(slide, theme, deck.brand, plan);
  if (logoMark) pptxSlide.addImage({ data: logoMark, x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH, transparency: 0 });
  else if (logo) {
    const logoWidth = RENDER_CONFIG.legacy.regular_logo_width / PX_PER_INCH;
    const x = plan?.lockup.physicalSide === 'right'
      ? (WIDTH - RENDER_CONFIG.spacing.margin - RENDER_CONFIG.legacy.regular_logo_width) / PX_PER_INCH
      : plan?.titleAlign === 'center'
        ? (WIDTH - RENDER_CONFIG.legacy.regular_logo_width) / 2 / PX_PER_INCH
        : RENDER_CONFIG.spacing.margin / PX_PER_INCH;
    const y = lockup.markY / PX_PER_INCH;
    const logoHeight = RENDER_CONFIG.legacy.regular_logo_height / PX_PER_INCH;
    pptxSlide.addImage({ data: logo, x, y, w: logoWidth, h: logoHeight, sizing: { type: 'contain', x, y, w: logoWidth, h: logoHeight }, transparency: 0 });
  }
  const headerColor = band ? readableTextColor(band, theme, RENDER_CONFIG.typography.headerTitle, true).slice(1) : theme.headerStyle === 'image-band' ? theme.imageTextColor.slice(1) : theme.foreground.slice(1);
  if (logoMark && deck.brand) {
    const nameBox = plan?.sourceTemplate ? plan.lockup.name : { x: lockup.nameAnchor === 'end' ? lockup.nameX - RENDER_CONFIG.legacy.name_width : lockup.nameX, y: lockup.nameY - RENDER_CONFIG.pptx.brand_name_box_y_adjustment, width: RENDER_CONFIG.legacy.name_width, height: RENDER_CONFIG.pptx.brand_name_box_height };
    if (plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand.toUpperCase()], size: lockup.nameSize, lineHeight: lockup.nameSize, overflow: false }, plan.lockup.name, lockup.nameY, theme.fontFamily);
    pptxSlide.addText(deck.brand.toUpperCase(), { x: nameBox.x / PX_PER_INCH, y: (lockup.nameY - lockup.nameSize) / PX_PER_INCH, w: nameBox.width / PX_PER_INCH, h: (lockup.nameSize * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: pptxHeadingSize(lockup.nameSize, theme), bold: true, color: headerColor, align: lockup.nameAnchor === 'end' ? 'right' : 'left', margin: 0, valign: 'top' });
  }
  const headerAlign: 'left' | 'center' | 'right' = plan?.titleAlign === 'right' || plan?.direction === 'rtl' ? 'right' : plan?.titleAlign === 'center' ? 'center' : 'left';
  const headerTitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerTitleBox, headerFit.size) : layout.headerTitleY;
  assertTextFitsBox('Slide heading', headerFit, headerTitleBox, headerTitleBaseline, theme.headingFontFamily);
  pptxSlide.addText(headerFit.lines.join('\n'), { x: headerTitleBox.x / PX_PER_INCH, y: (headerTitleBaseline - headerFit.size) / PX_PER_INCH, w: headerTitleBox.width / PX_PER_INCH, h: (headerFit.lines.length * headerFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: theme.headingFontFamily, fontSize: pptxHeadingSize(headerFit.size, theme), bold: true, color: headerColor, align: headerAlign, margin: 0, valign: 'top' });
  if (slide.subtitle) {
    const subtitleFit = fitText(slide.subtitle, RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale, Math.max(RENDER_CONFIG.legacy.header_subtitle_min_chars, Math.floor(headerSubtitleBox.width / (RENDER_CONFIG.typography.headerSubtitle * theme.bodyScale * RENDER_CONFIG.text.bodyGlyphWidth))), plan?.subtitleConstraints.maxLines ?? 1, templateFitTheme(theme, plan?.subtitleConstraints.overflow), theme.minBodyPt);
    if (subtitleFit.overflow) throw new Error(`Slide subtitle does not fit within the safe header area: ${slide.subtitle}`);
    const headerSubtitleBaseline = plan?.sourceTemplate ? textBoxBaseline(headerSubtitleBox, subtitleFit.size) : layout.headerSubtitleY;
    assertTextFitsBox('Slide subtitle', subtitleFit, headerSubtitleBox, headerSubtitleBaseline, theme.fontFamily);
    pptxSlide.addText(subtitleFit.lines.join('\n'), { x: headerSubtitleBox.x / PX_PER_INCH, y: (headerSubtitleBaseline - subtitleFit.size) / PX_PER_INCH, w: headerSubtitleBox.width / PX_PER_INCH, h: (subtitleFit.lines.length * subtitleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: theme.fontFamily, fontSize: subtitleFit.size * PX_TO_PT, color: band ? readableTextColor(band, theme, subtitleFit.size, false).slice(1) : theme.headerStyle === 'image-band' ? theme.imageTextColor.slice(1) : theme.muted.slice(1), align: headerAlign, margin: 0, valign: 'top' });
  }
  const headerBox = plan?.slots.header ?? { x: RENDER_CONFIG.spacing.margin, y: 0, width: RENDER_CONFIG.spacing.contentWidth, height: layout.headerLineY };
  if (!band) pptxSlide.addShape(shapeType.line, { x: headerBox.x / PX_PER_INCH, y: layout.headerLineY / PX_PER_INCH, w: headerBox.width / PX_PER_INCH, h: 0, line: { color: theme.headerStyle === 'image-band' ? 'FFFFFF' : theme.line.slice(1), width: 1, transparency: theme.headerStyle === 'image-band' ? 50 : 0 } });
}

export async function renderSlidesPptx(deck: SlideDeck, theme = defaultRenderTheme()): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'TreeTank report-baby';
  pptx.subject = deck.title ?? 'Presentation';
  pptx.title = deck.title ?? deck.slides[0]?.title ?? 'Presentation';
  pptx.company = deck.brand ?? 'TreeTank';
  for (let index = 0; index < deck.slides.length; index++) {
    const content = deck.slides[index];
    validateSlideContent(content);
    const slide = pptx.addSlide();
    if (content.notes) slide.addNotes(content.notes);
    const slideTheme = deck.slideThemes?.[index] ?? theme;
    const plan = deck.slidePlans?.[index];
    const titleAlign = plan?.titleAlign ?? slideTheme.titleAlign;
    slide.background = { color: slideTheme.background.slice(1) };
    const logoPath = slideTheme.logoVariant === 'white' ? slideTheme.logoWhitePath ?? slideTheme.logoPath : slideTheme.logoPath;
    const logoMarkPath = slideTheme.logoVariant === 'white' ? slideTheme.logoWhiteMarkPath ?? slideTheme.logoMarkPath : slideTheme.logoMarkPath;
    const [logo, logoMark] = await Promise.all([pptxAssetDataUri(logoPath, RENDER_CONFIG.pptx.logo_raster_width, slideTheme), pptxAssetDataUri(logoMarkPath, RENDER_CONFIG.pptx.logo_raster_width, slideTheme)]);
    const background = await pptxAssetDataUri(slideTheme.backgroundImagePath, RENDER_CONFIG.canvas.width, slideTheme);
    const cover = content.type === 'title' ? await pptxAssetDataUri(slideTheme.coverImagePath, RENDER_CONFIG.canvas.width, slideTheme) : undefined;
    const graphicContentColor = Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background)) ? slideTheme.imageTextColor.slice(1) : slideTheme.foreground.slice(1);
    const slideLayoutValues = slideLayout(slideTheme, plan);
    if (background && slideTheme.headerStyle === 'image-band') {
      const imageArea = plan?.slots.image;
      const imageX = imageArea ? imageArea.x / PX_PER_INCH : 0;
      const imageY = imageArea ? imageArea.y / PX_PER_INCH : 0;
      const imageW = imageArea ? imageArea.width / PX_PER_INCH : PPTX_WIDTH;
      const imageH = imageArea ? imageArea.height / PX_PER_INCH : PPTX_HEIGHT;
      slide.addImage({ data: background, x: imageX, y: imageY, w: imageW, h: imageH, sizing: { type: 'cover', x: imageX, y: imageY, w: imageW, h: imageH }, transparency: Math.round((1 - slideTheme.backgroundImageOpacity) * 100) });
      if (slideTheme.imageScrim) {
        const area = slideTheme.imageTextSafeArea;
        slide.addShape(pptx.ShapeType.roundRect, { x: area.x * PPTX_WIDTH, y: area.y * PPTX_HEIGHT, w: area.width * PPTX_WIDTH, h: area.height * PPTX_HEIGHT, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.imageScrim.color.slice(1), transparency: Math.round((1 - slideTheme.imageScrim.opacity) * 100) }, line: { color: slideTheme.imageScrim.color.slice(1), transparency: 100 } });
      }
    }
    if (cover) {
      slide.addImage({ data: cover, x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT, sizing: { type: 'cover', x: 0, y: 0, w: PPTX_WIDTH, h: PPTX_HEIGHT }, transparency: 0 });
      if (slideTheme.imageScrim) {
        const area = slideTheme.imageTextSafeArea;
        slide.addShape(pptx.ShapeType.roundRect, { x: area.x * PPTX_WIDTH, y: area.y * PPTX_HEIGHT, w: area.width * PPTX_WIDTH, h: area.height * PPTX_HEIGHT, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.imageScrim.color.slice(1), transparency: Math.round((1 - slideTheme.imageScrim.opacity) * 100) }, line: { color: slideTheme.imageScrim.color.slice(1), transparency: 100 } });
      }
    }
    if (slideTheme.headerStyle === 'accent-band' && !cover) slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: slideLayoutValues.headerLineY / PX_PER_INCH, fill: { color: slideTheme.primary.slice(1) }, line: { color: slideTheme.primary.slice(1), transparency: 100 } });
    if (slideTheme.headerStyle === 'dark-band' && !cover) slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: PPTX_WIDTH, h: slideLayoutValues.headerLineY / PX_PER_INCH, fill: { color: slideTheme.background.slice(1) }, line: { color: slideTheme.background.slice(1), transparency: 100 } });
    if (content.type === 'title') {
      const lockup = lockupGeometry(content, slideTheme, deck.brand, plan);
      const titleEyebrowY = plan?.titleLayout.eyebrowY ?? RENDER_CONFIG.fallbacks.title_eyebrow_y;
      const titleY = plan?.titleLayout.titleBaselineY ?? RENDER_CONFIG.legacy.title_baseline_y;
      if (logoMark) slide.addImage({ data: logoMark, x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH, sizing: { type: 'contain', x: lockup.markX / PX_PER_INCH, y: lockup.markY / PX_PER_INCH, w: lockup.markW / PX_PER_INCH, h: lockup.markH / PX_PER_INCH }, transparency: 0 });
      else if (logo) {
        const logoW = slideTheme.titleLogoWidthPx / PX_PER_INCH;
        const logoH = slideTheme.titleLogoHeightPx / PX_PER_INCH;
        const logoX = plan?.lockup.physicalSide === 'right' ? PPTX_WIDTH - RENDER_CONFIG.legacy.title_logo_right_inset / PX_PER_INCH - logoW : titleAlign === 'center' ? (PPTX_WIDTH - logoW) / 2 : RENDER_CONFIG.legacy.title_logo_left_inset / PX_PER_INCH;
        const logoY = RENDER_CONFIG.legacy.title_logo_y / PX_PER_INCH;
        slide.addImage({ data: logo, x: logoX, y: logoY, w: logoW, h: logoH, sizing: { type: 'contain', x: logoX, y: logoY, w: logoW, h: logoH }, transparency: 0 });
      }
      const titleColor = slideTheme.headerStyle === 'plain'
        ? slideTheme.foreground.slice(1)
        : slideTheme.titleColor.slice(1);
      const safeArea = getTitleSafeArea(slideTheme, plan);
      const typedSource = Boolean(plan?.sourceTemplate && plan.sourceTemplate.id !== 'slides/standard');
      const titleBox = typedSource && plan?.slots.title ? { x: plan.slots.title.x / WIDTH, y: plan.slots.title.y / HEIGHT, width: plan.slots.title.width / WIDTH, height: plan.slots.title.height / HEIGHT } : safeArea;
      const titleBoxX = titleBox.x * PPTX_WIDTH;
      const titleBoxWidth = titleBox.width * PPTX_WIDTH;
      const graphicTitle = Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background));
      const titleMaxChars = titleTextLimit(slideTheme, titleBox, RENDER_CONFIG.typography.title, RENDER_CONFIG.legacy.title_max_chars, graphicTitle);
      const titleFit = fitText(slideTheme.titleCase === 'upper' ? content.title.toUpperCase() : content.title, RENDER_CONFIG.typography.title, titleMaxChars, plan?.titleConstraints.maxLines ?? RENDER_CONFIG.text.titleMaxLines, templateFitTheme(slideTheme, plan?.titleConstraints.overflow));
      if (titleFit.overflow) throw new Error(`Slide title does not fit within the safe title area: ${content.title}`);
      assertTextFitsBox('Slide title', titleFit, { x: titleBox.x * WIDTH, y: titleBox.y * HEIGHT, width: titleBox.width * WIDTH, height: titleBox.height * HEIGHT }, titleY, slideTheme.headingFontFamily);
      const subtitleBox = typedSource && plan?.slots.subtitle ? { x: plan.slots.subtitle.x / WIDTH, y: plan.slots.subtitle.y / HEIGHT, width: plan.slots.subtitle.width / WIDTH, height: plan.slots.subtitle.height / HEIGHT } : safeArea;
      const subtitleFit = content.subtitle ? fitText(content.subtitle, RENDER_CONFIG.typography.subtitle * slideTheme.bodyScale, subtitleTextLimit(slideTheme, subtitleBox, RENDER_CONFIG.typography.subtitle * slideTheme.bodyScale, RENDER_CONFIG.legacy.subtitle_max_chars, graphicTitle), plan?.subtitleConstraints.maxLines ?? RENDER_CONFIG.text.subtitleMaxLines, templateFitTheme(slideTheme, plan?.subtitleConstraints.overflow), slideTheme.minBodyPt) : undefined;
      if (subtitleFit?.overflow) throw new Error(`Slide subtitle does not fit within the safe title area: ${content.subtitle}`);
      if (subtitleFit) assertTextFitsBox('Slide subtitle', subtitleFit, { x: subtitleBox.x * WIDTH, y: subtitleBox.y * HEIGHT, width: subtitleBox.width * WIDTH, height: subtitleBox.height * HEIGHT }, plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap), slideTheme.fontFamily);
      assertTitleWithinSafeArea(slideTheme, titleFit, subtitleFit, plan);
      const titleSubtitleY = plan?.titleLayout.subtitleBaselineY ?? Math.max(RENDER_CONFIG.legacy.subtitle_baseline_floor, titleY + titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.title_subtitle_gap);
      if (logoMark && deck.brand) {
        const nameBox = plan?.sourceTemplate ? plan.lockup.name : { x: lockup.nameAnchor === 'end' ? lockup.nameX - RENDER_CONFIG.legacy.name_width : lockup.nameX, y: lockup.nameY - RENDER_CONFIG.pptx.brand_name_box_y_adjustment, width: RENDER_CONFIG.legacy.name_width, height: RENDER_CONFIG.pptx.brand_name_box_height };
        if (plan?.sourceTemplate) assertTextFitsBox('Brand name', { lines: [deck.brand], size: lockup.nameSize, lineHeight: lockup.nameSize, overflow: false }, plan.lockup.name, lockup.nameY, slideTheme.headingFontFamily);
        slide.addText(deck.brand, { x: nameBox.x / PX_PER_INCH, y: (lockup.nameY - lockup.nameSize) / PX_PER_INCH, w: nameBox.width / PX_PER_INCH, h: (lockup.nameSize * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: pptxHeadingSize(lockup.nameSize, slideTheme), bold: true, color: titleColor, align: lockup.nameAnchor === 'end' ? 'right' : 'left', margin: 0, valign: 'top' });
      }
      const eyebrowFit = fitText(content.eyebrow ?? deck.brand ?? '', RENDER_CONFIG.typography.eyebrow, RENDER_CONFIG.legacy.title_eyebrow_max_chars, plan?.eyebrowConstraints.maxLines ?? 1, templateFitTheme(slideTheme, plan?.eyebrowConstraints.overflow), slideTheme.minBodyPt);
      if (eyebrowFit.overflow) throw new Error(`Slide eyebrow does not fit within the template slot: ${content.eyebrow ?? deck.brand}`);
      const eyebrowBox = typedSource && plan?.slots.eyebrow ? { x: plan.slots.eyebrow.x / WIDTH, y: plan.slots.eyebrow.y / HEIGHT, width: plan.slots.eyebrow.width / WIDTH, height: plan.slots.eyebrow.height / HEIGHT } : titleBox;
      assertTextFitsBox('Slide eyebrow', eyebrowFit, { x: eyebrowBox.x * WIDTH, y: eyebrowBox.y * HEIGHT, width: eyebrowBox.width * WIDTH, height: eyebrowBox.height * HEIGHT }, titleEyebrowY, slideTheme.fontFamily);
      slide.addText(eyebrowFit.lines.join('\n'), { x: eyebrowBox.x * PPTX_WIDTH, y: (titleEyebrowY - eyebrowFit.size) / PX_PER_INCH, w: eyebrowBox.width * PPTX_WIDTH, h: (eyebrowFit.lines.length * eyebrowFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: eyebrowFit.size * PX_TO_PT, bold: true, color: slideTheme.headerStyle === 'plain' ? slideTheme.primary.slice(1) : slideTheme.titleAccentColor.slice(1), align: titleAlign, margin: 0, valign: 'top' });
      slide.addText(titleFit.lines.join('\n'), { x: titleBoxX, y: (titleY - titleFit.size) / PX_PER_INCH, w: titleBoxWidth, h: (titleFit.lines.length * titleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: pptxHeadingSize(titleFit.size, slideTheme), bold: true, color: titleColor, align: titleAlign, valign: 'top', margin: 0, breakLine: false });
      if (subtitleFit) {
        slide.addText(subtitleFit.lines.join('\n'), { x: subtitleBox.x * PPTX_WIDTH, y: (titleSubtitleY - subtitleFit.size) / PX_PER_INCH, w: subtitleBox.width * PPTX_WIDTH, h: (subtitleFit.lines.length * subtitleFit.lineHeight + RENDER_CONFIG.legacy.pptx_text_box_extra_height) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: subtitleFit.size * PX_TO_PT, color: slideTheme.headerStyle === 'plain' ? slideTheme.muted.slice(1) : slideTheme.titleSubtitleColor.slice(1), align: titleAlign, valign: 'top', margin: 0 });
      }
    } else {
      await addPptxHeader(slide, pptx.ShapeType, deck, content, index, slideTheme, plan);
      if (content.type === 'metrics') {
        const brandMetrics = Boolean(plan?.slots['metric-1']);
        if (plan?.sourceTemplate?.archetype === 'metrics' && content.metrics.length !== 3) throw new Error(`Template '${plan.templateRef}' requires exactly three metrics.`);
        const cols = Math.min(3, content.metrics.length);
        content.metrics.forEach((metric, metricIndex) => {
          const pixelGap = RENDER_CONFIG.spacing.cardGap;
          const cardWidth = (RENDER_CONFIG.spacing.contentWidth - pixelGap * (cols - 1)) / cols;
          const cardHeight = Math.min(RENDER_CONFIG.metrics.maxHeight, (RENDER_CONFIG.metrics.usableHeight - pixelGap * (Math.ceil(content.metrics.length / cols) - 1)) / Math.ceil(content.metrics.length / cols));
          const sourceBox = brandMetrics ? plan?.slots[`metric-${metricIndex + 1}`] : undefined;
          if (brandMetrics && !sourceBox) throw new Error(`Template '${plan?.templateRef ?? 'resolved slide'}' is missing metric-${metricIndex + 1}.`);
          const rawX = RENDER_CONFIG.spacing.margin + (metricIndex % cols) * (cardWidth + pixelGap);
          const pixelX = sourceBox?.x ?? logicalBoxX(rawX, cardWidth, plan);
          const pixelY = sourceBox?.y ?? slideLayout(slideTheme, plan).contentTop + Math.floor(metricIndex / cols) * (cardHeight + pixelGap);
          const pixelW = sourceBox?.width ?? cardWidth;
          const pixelH = sourceBox?.height ?? cardHeight;
          const metricFit = fitMetricCard(metric, { x: pixelX, y: pixelY, width: pixelW, height: pixelH }, slideTheme);
          const x = pixelX / PX_PER_INCH;
          const y = pixelY / PX_PER_INCH;
          const w = pixelW / PX_PER_INCH;
          const h = pixelH / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.line.slice(1), width: 1 } });
          const textAlign = isRtl(plan) ? 'right' : 'left';
          slide.addText(metricFit.label.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (pixelY + pixelH * RENDER_CONFIG.metrics.labelBaseline - metricFit.label.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: metricFit.label.lineHeight / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: metricFit.label.size * PX_TO_PT, bold: true, color: slideTheme.muted.slice(1), align: textAlign, margin: 0, valign: 'top' });
          slide.addText(metricFit.value.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (pixelY + pixelH * RENDER_CONFIG.metrics.valueBaseline - metricFit.value.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: metricFit.value.lineHeight / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: metricFit.value.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: textAlign, margin: 0, valign: 'top' });
          if (metricFit.delta ?? metricFit.note) {
            const fit = metricFit.delta ?? metricFit.note!;
            const baseline = metricFit.delta ? pixelY + pixelH * RENDER_CONFIG.metrics.deltaBaseline : pixelY + pixelH - RENDER_CONFIG.metrics.noteBottom;
            slide.addText(fit.lines.join('\n'), { x: x + CARD_PADDING_INCHES, y: (baseline - fit.size) / PX_PER_INCH, w: w - CARD_PADDING_INCHES * 2, h: fit.lineHeight / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: fit.size * PX_TO_PT, bold: Boolean(metricFit.delta), color: metric.trend === 'down' ? slideTheme.danger.slice(1) : metric.trend === 'up' ? slideTheme.success.slice(1) : slideTheme.muted.slice(1), align: textAlign, margin: 0, valign: 'top' });
          }
        });
        const metricsLayout = slideLayout(slideTheme, plan);
        const bodyBox = brandMetrics ? plan?.slots.body : undefined;
        if (content.body) {
          const box = bodyBox ?? { x: RENDER_CONFIG.spacing.margin, y: metricsLayout.contentTop + RENDER_CONFIG.fallbacks.metrics_body_y_offset, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.fallbacks.metrics_body_height };
          const body = fitTemplateText('Metrics body', content.body, box, Math.round(RENDER_CONFIG.typography.body * slideTheme.bodyScale), plan?.slotRules.body?.maxLines ?? 3, plan?.slotRules.body?.overflow, slideTheme, slideTheme.fontFamily);
          slide.addText(body.fit.lines.join('\n'), { x: box.x / PX_PER_INCH, y: (body.baseline - body.fit.size) / PX_PER_INCH, w: box.width / PX_PER_INCH, h: (body.fit.lines.length * body.fit.lineHeight + body.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: body.fit.size * PX_TO_PT, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, breakLine: false, valign: 'top' });
        }
        if (content.callout) {
          const calloutBox = brandMetrics ? plan?.slots.callout : undefined;
          const calloutX = calloutBox?.x ?? RENDER_CONFIG.spacing.margin;
          const calloutY = calloutBox?.y ?? metricsLayout.contentTop + RENDER_CONFIG.fallbacks.metrics_callout_y_offset;
          const calloutW = calloutBox?.width ?? RENDER_CONFIG.spacing.contentWidth;
          const calloutH = calloutBox?.height ?? RENDER_CONFIG.metrics.calloutHeight;
          slide.addShape(pptx.ShapeType.roundRect, { x: calloutX / PX_PER_INCH, y: calloutY / PX_PER_INCH, w: calloutW / PX_PER_INCH, h: calloutH / PX_PER_INCH, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.primary.slice(1), width: 1 } });
          const callout = fitTemplateText('Metrics callout', content.callout, { x: calloutX + RENDER_CONFIG.metrics.calloutPaddingX, y: calloutY + RENDER_CONFIG.metrics.calloutPaddingY, width: calloutW - RENDER_CONFIG.metrics.calloutPaddingX * 2, height: calloutH - RENDER_CONFIG.metrics.calloutPaddingY * 2 }, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules.callout?.maxLines ?? 2, plan?.slotRules.callout?.overflow, slideTheme, slideTheme.fontFamily);
          slide.addText(callout.fit.lines.join('\n'), { x: (calloutX + RENDER_CONFIG.metrics.calloutPaddingX) / PX_PER_INCH, y: (callout.baseline - callout.fit.size) / PX_PER_INCH, w: (calloutW - RENDER_CONFIG.metrics.calloutPaddingX * 2) / PX_PER_INCH, h: (callout.fit.lines.length * callout.fit.lineHeight + callout.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: callout.fit.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        }
      } else if (content.type === 'columns') {
        const legacy = RENDER_CONFIG.legacy;
        const fallbackBoxes = [
          { x: RENDER_CONFIG.spacing.margin, y: slideLayout(slideTheme, plan).contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: slideLayout(slideTheme, plan).contentBottom - slideLayout(slideTheme, plan).contentTop - legacy.columns_fallback_height_padding },
          { x: RENDER_CONFIG.spacing.margin + legacy.columns_fallback_width + legacy.columns_fallback_x_gap, y: slideLayout(slideTheme, plan).contentTop + RENDER_CONFIG.fallbacks.columns_y_offset, width: legacy.columns_fallback_width, height: slideLayout(slideTheme, plan).contentBottom - slideLayout(slideTheme, plan).contentTop - legacy.columns_fallback_height_padding },
        ];
        content.columns.forEach((column, columnIndex) => {
          const box = plan?.slots[columnIndex === 0 ? 'left' : 'right'] ?? fallbackBoxes[columnIndex]!;
          const x = box.x / PX_PER_INCH;
          const y = box.y / PX_PER_INCH;
          const w = box.width / PX_PER_INCH;
          const h = box.height / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h, rectRadius: RENDER_CONFIG.pptx.round_rect_radius_inches, fill: { color: slideTheme.soft.slice(1) }, line: { color: slideTheme.line.slice(1), width: 1 } });
          const inner = { x: box.x + RENDER_CONFIG.spacing.columnPadding, y: box.y + RENDER_CONFIG.fallbacks.columns_inner_padding_y, width: box.width - RENDER_CONFIG.spacing.columnPadding * 2, height: box.height - RENDER_CONFIG.fallbacks.columns_inner_padding_y * 2 };
          const heading = column.heading ?? `Column ${columnIndex + 1}`;
          const slotId = columnIndex === 0 ? 'left' : 'right';
          const headingFit = fitTemplateText(`Column ${columnIndex + 1} heading`, heading, { ...inner, height: legacy.columns_heading_height }, Math.round(RENDER_CONFIG.fallbacks.columns_heading_size * slideTheme.headingScale), 2, plan?.slotRules[slotId]?.overflow, slideTheme, slideTheme.headingFontFamily);
          slide.addText(headingFit.fit.lines.join('\n'), { x: inner.x / PX_PER_INCH, y: (headingFit.baseline - headingFit.fit.size) / PX_PER_INCH, w: inner.width / PX_PER_INCH, h: (headingFit.fit.lines.length * headingFit.fit.lineHeight + headingFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.headingFontFamily, fontSize: headingFit.fit.size * PX_TO_PT, bold: true, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
          const bodyBox = { x: inner.x, y: box.y + legacy.columns_body_top, width: inner.width, height: box.height - legacy.columns_body_bottom_padding };
          const bodyValue = [column.body, ...(column.highlights ?? []).map((item) => `• ${item}`)].join('\n');
          const bodyFit = fitTemplateText(`Column ${columnIndex + 1} body`, bodyValue, bodyBox, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules[slotId]?.maxLines ?? 12, plan?.slotRules[slotId]?.overflow, slideTheme, slideTheme.fontFamily);
          slide.addText(bodyFit.fit.lines.join('\n'), { x: bodyBox.x / PX_PER_INCH, y: (bodyFit.baseline - bodyFit.fit.size) / PX_PER_INCH, w: bodyBox.width / PX_PER_INCH, h: (bodyFit.fit.lines.length * bodyFit.fit.lineHeight + bodyFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: bodyFit.fit.size * PX_TO_PT, color: slideTheme.foreground.slice(1), align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        });
      } else if (content.type === 'chart') {
        const chart = slideLayout(slideTheme, plan).chart;
        slide.addImage({ data: await chartImage(content, slideTheme), x: chart.x / PX_PER_INCH, y: chart.y / PX_PER_INCH, w: chart.width / PX_PER_INCH, h: chart.height / PX_PER_INCH });
      } else if (content.type === 'table') {
        const table = slideLayout(slideTheme, plan).table;
        const tableRows = [
          content.head.map((cell) => ({ text: String(cell), options: { bold: true, color: readableTextColor(slideTheme.primary, slideTheme, RENDER_CONFIG.pptx.table_font_size / PX_TO_PT, true).slice(1), fill: { color: slideTheme.primary.slice(1) } } })),
          ...content.body.slice(0, 10).map((row, rowIndex) => row.map((cell) => ({
            text: String(cell),
            options: { color: slideTheme.foreground.slice(1), fill: { color: (rowIndex % 2 ? slideTheme.soft : slideTheme.background).slice(1) } },
          }))),
        ];
        slide.addTable(isRtl(plan) ? tableRows.map((row) => [...row].reverse()) : tableRows, { x: table.x / PX_PER_INCH, y: table.y / PX_PER_INCH, w: table.width / PX_PER_INCH, h: table.height / PX_PER_INCH, border: { type: 'solid', color: slideTheme.line.slice(1), pt: 1 }, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.pptx.table_font_size * slideTheme.bodyScale, color: slideTheme.foreground.slice(1), margin: RENDER_CONFIG.legacy.default_text_padding / PX_PER_INCH, bold: false, rowH: RENDER_CONFIG.pptx.table_row_height_inches });
      } else if (content.type === 'narrative') {
        const narrativeLayout = slideLayout(slideTheme, plan);
        const narrativeBox = plan?.slots.narrative ?? { x: RENDER_CONFIG.spacing.margin, y: narrativeLayout.narrativeY - RENDER_CONFIG.fallbacks.narrative_y_adjustment, width: RENDER_CONFIG.spacing.contentWidth, height: RENDER_CONFIG.legacy.narrative_fallback_height };
        const narrativeFit = fitTemplateText('Narrative body', content.body, narrativeBox, Math.round(RENDER_CONFIG.typography.narrative * slideTheme.bodyScale), plan?.slotRules.narrative?.maxLines ?? 5, plan?.slotRules.narrative?.overflow, slideTheme, slideTheme.fontFamily);
        slide.addText(narrativeFit.fit.lines.join('\n'), { x: narrativeBox.x / PX_PER_INCH, y: (narrativeFit.baseline - narrativeFit.fit.size) / PX_PER_INCH, w: narrativeBox.width / PX_PER_INCH, h: (narrativeFit.fit.lines.length * narrativeFit.fit.lineHeight + narrativeFit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: narrativeFit.fit.size * PX_TO_PT, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', breakLine: false, valign: 'top', margin: 0 });
        (content.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => {
          const highlightBox = plan?.slots[`narrative-highlight-${itemIndex + 1}`] ?? { x: RENDER_CONFIG.legacy.narrative_highlight_x, y: RENDER_CONFIG.legacy.narrative_highlight_y + itemIndex * RENDER_CONFIG.legacy.narrative_highlight_step, width: RENDER_CONFIG.legacy.narrative_highlight_width, height: RENDER_CONFIG.legacy.narrative_highlight_height };
          const fit = fitTemplateText(`Narrative highlight ${itemIndex + 1}`, item, highlightBox, Math.round(RENDER_CONFIG.typography.highlight * slideTheme.bodyScale), plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.maxLines ?? 1, plan?.slotRules[`narrative-highlight-${itemIndex + 1}`]?.overflow, slideTheme, slideTheme.fontFamily);
          slide.addText([{ text: item, options: { bullet: { indent: RENDER_CONFIG.pptx.bullet_indent }, bold: true } }], { x: highlightBox.x / PX_PER_INCH, y: (fit.baseline - fit.fit.size) / PX_PER_INCH, w: highlightBox.width / PX_PER_INCH, h: (fit.fit.lines.length * fit.fit.lineHeight + fit.fit.size) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: fit.fit.size * PX_TO_PT, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', rtlMode: isRtl(plan), margin: 0, valign: 'top' });
        });
      } else if (content.type === 'conclusions') {
        const conclusionsLayout = slideLayout(slideTheme, plan);
        content.items.slice(0, 7).forEach((item, itemIndex) => {
          const y = (conclusionsLayout.conclusionsY + itemIndex * RENDER_CONFIG.legacy.conclusion_step) / PX_PER_INCH;
          const color = slideTheme.palette[itemIndex % slideTheme.palette.length].slice(1);
          const iconX = (isRtl(plan) ? RENDER_CONFIG.legacy.conclusion_icon_x_rtl : RENDER_CONFIG.legacy.conclusion_icon_x_ltr) / PX_PER_INCH;
          slide.addShape(pptx.ShapeType.roundRect, { x: iconX, y: (y - RENDER_CONFIG.legacy.conclusion_icon_y_adjustment / PX_PER_INCH), w: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, h: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, rectRadius: RENDER_CONFIG.pptx.conclusion_icon_rect_radius_inches, fill: { color }, line: { color } });
          slide.addText(String(itemIndex + 1), { x: iconX, y: (y * PX_PER_INCH - RENDER_CONFIG.legacy.conclusion_number_size) / PX_PER_INCH, w: RENDER_CONFIG.shapes.conclusionIcon / PX_PER_INCH, h: (RENDER_CONFIG.legacy.conclusion_number_size * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.legacy.conclusion_number_size * PX_TO_PT, bold: true, color: slideTheme.background.slice(1), align: 'center', margin: 0, valign: 'top' });
          const conclusionTextWidth = RENDER_CONFIG.pptx.conclusion_text_width_inches * PX_PER_INCH;
          slide.addText(fitSingleLine(item, conclusionTextWidth, RENDER_CONFIG.legacy.conclusion_text_size * slideTheme.bodyScale, slideTheme.fontFamily), { x: isRtl(plan) ? RENDER_CONFIG.pptx.conclusion_text_x_rtl_inches : RENDER_CONFIG.legacy.conclusion_icon_text_x_ltr / PX_PER_INCH, y: (y * PX_PER_INCH - RENDER_CONFIG.legacy.conclusion_text_size) / PX_PER_INCH, w: RENDER_CONFIG.pptx.conclusion_text_width_inches, h: (RENDER_CONFIG.legacy.conclusion_text_size * RENDER_CONFIG.text.lineHeight) / PX_PER_INCH, fontFace: slideTheme.fontFamily, fontSize: RENDER_CONFIG.legacy.conclusion_text_size * PX_TO_PT * slideTheme.bodyScale, bold: true, color: graphicContentColor, align: isRtl(plan) ? 'right' : 'left', margin: 0, valign: 'top' });
        });
      }
    }
    addPptxFooter(slide, pptx.ShapeType, deck, index, slideTheme, Boolean(cover) || (slideTheme.headerStyle === 'image-band' && Boolean(background)), plan);
  }
  return deduplicatePptxMedia(Buffer.from(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer));
}

function deduplicatePptxMedia(pptx: Buffer): Buffer {
  const entries = unzipSync(new Uint8Array(pptx));
  const canonicalByDigest = new Map<string, string>();
  const replacement = new Map<string, string>();
  for (const name of Object.keys(entries).sort()) {
    if (!name.startsWith('ppt/media/')) continue;
    const digest = createHash('sha256').update(entries[name]).digest('hex');
    const canonical = canonicalByDigest.get(digest);
    if (canonical === undefined) canonicalByDigest.set(digest, name);
    else replacement.set(name, canonical);
  }
  if (replacement.size === 0) return pptx;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const contentTypes = '[Content_Types].xml';
  const kept: Record<string, Uint8Array> = {};
  const order = Object.keys(entries).filter((name) => name !== contentTypes && !name.endsWith('/'));
  for (const name of entries[contentTypes] ? [contentTypes, ...order] : order) {
    if (replacement.has(name)) continue;
    const content = entries[name];
    if (!name.endsWith('.rels')) {
      kept[name] = content;
      continue;
    }
    let text = decoder.decode(content);
    for (const [duplicate, canonical] of replacement) {
      text = text.replaceAll(`../media/${duplicate.slice('ppt/media/'.length)}`, `../media/${canonical.slice('ppt/media/'.length)}`);
    }
    kept[name] = encoder.encode(text);
  }
  return Buffer.from(zipSync(kept, { level: 6 }));
}
