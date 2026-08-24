import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { BUILTIN_TEMPLATE_FILES } from './generated/builtin-template-files.js';

export interface BuiltinSlideTemplateDocument {
  id: string;
  headerTitleY: number;
  headerSubtitleY: number;
  headerLineY: number;
  contentTop: number;
  contentBottom: number;
  titleAlign: 'start' | 'center';
}

export interface RenderConfig {
  canvas: { width: number; height: number; pptxWidth: number; pptxHeight: number; pointsPerInch: number };
  assets: Record<string, number>;
  sources: { zipMaxEntries: number; zipMaxFileBytes: number; zipMaxTotalBytes: number; zipMaxCompressionRatio: number; zipMaxNestedArchives: number };
  images: { maxAssetBytes: number; maxDecodedPixels: number; maxDimensionPx: number; maxPerDocument: number; remoteTimeoutMs: number; remoteMaxRedirects: number };
  reportOutput: { pngWidthPx: number; pptxWidthInches: number; pptxHeightInches: number };
  pdf: Record<string, number>;
  chart: Record<string, number>;
  spacing: { margin: number; contentWidth: number; footerY: number; footerHeight: number; contentGap: number; cardGap: number; cardPaddingX: number; cardPaddingY: number; columnPadding: number; fallbackHeaderLine: number; fallbackContentBottom: number; fallbackHeaderTitle: number; fallbackHeaderSubtitle: number; chartSidePadding: number; tableTopAdjustment: number; narrativeOffset: number; conclusionsOffset: number; maxChartHeight: number };
  typography: { title: number; subtitle: number; eyebrow: number; headerTitle: number; headerSubtitle: number; body: number; small: number; metricLabel: number; metricValue: number; metricDelta: number; metricNote: number; table: number; narrative: number; highlight: number; conclusion: number; footer: number };
  shapes: { metricRadius: number; calloutRadius: number; conclusionIcon: number; conclusionIconRadius: number; bulletRadius: number };
  metrics: { maxHeight: number; usableHeight: number; valueBaseline: number; labelBaseline: number; deltaBaseline: number; noteBottom: number; calloutHeight: number; calloutPaddingX: number; calloutPaddingY: number };
  text: { headingGlyphWidth: number; bodyGlyphWidth: number; monoHeadingGlyphWidth: number; monoBodyGlyphWidth: number; monoEstimatedGlyphWidth: number; lineHeight: number; titleMaxLines: number; subtitleMaxLines: number; headerMaxLines: number };
  pptx: Record<string, number>;
  contrast: { bodyMinimum: number; largeMinimum: number; largeTextPx: number; largeBoldTextPx: number };
  fallbacks: Record<string, number>;
  legacy: Record<string, number>;
}

const EMBEDDED_TEMPLATE_ROOT = 'embedded:server/templates';

function templateRootCandidates(): string[] {
  const executableDirectory = typeof __dirname === 'string' ? __dirname : undefined;
  const argvDirectory = process.argv[1] ? dirname(resolve(process.argv[1])) : undefined;
  return [
    process.env.REPORT_BABY_TEMPLATE_DIR,
    executableDirectory && join(executableDirectory, 'templates'),
    argvDirectory && join(argvDirectory, 'templates'),
    join(process.cwd(), 'templates'),
    join(process.cwd(), 'server', 'templates'),
  ].filter((value): value is string => Boolean(value));
}

function looksLikeTemplateRoot(candidate: string): boolean {
  return existsSync(join(candidate, 'render-config.yml')) || existsSync(join(candidate, 'slides', 'standard', 'template.yml'));
}

function overrideTemplateRoot(): string | undefined {
  const configured = process.env.REPORT_BABY_TEMPLATE_DIR;
  if (configured && existsSync(configured)) return configured;
  return templateRootCandidates().find(looksLikeTemplateRoot);
}

export function builtinTemplateRoot(): string {
  return overrideTemplateRoot() ?? EMBEDDED_TEMPLATE_ROOT;
}

function safeTemplateRef(templateRef: string): string {
  const normalized = templateRef.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid built-in template reference '${templateRef}'.`);
  }
  return normalized;
}

function templateRelativePath(templateRef: string): string {
  return `${safeTemplateRef(templateRef)}/template.yml`;
}

function readTemplateFile(relativePath: string): { text: string; path: string } | undefined {
  const overrideRoot = overrideTemplateRoot();
  if (overrideRoot) {
    const overridePath = join(overrideRoot, relativePath);
    if (existsSync(overridePath)) return { text: readFileSync(overridePath, 'utf8'), path: overridePath };
  }
  const embedded = BUILTIN_TEMPLATE_FILES[relativePath];
  return embedded === undefined ? undefined : { text: embedded, path: `${EMBEDDED_TEMPLATE_ROOT}/${relativePath}` };
}

function templatePath(templateRef: string): string {
  const relativePath = templateRelativePath(templateRef);
  return readTemplateFile(relativePath)?.path ?? join(builtinTemplateRoot(), relativePath);
}

function readYaml(file: { text: string; path: string } | undefined): Record<string, unknown> | undefined {
  if (!file) return undefined;
  const value = parse(file.text) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Built-in template '${file.path}' must contain a YAML object.`);
  return value as Record<string, unknown>;
}

export function readRenderConfig(): RenderConfig {
  const source = readYaml(readTemplateFile('render-config.yml'));
  if (!source) throw new Error(`Render configuration render-config.yml was not found in ${builtinTemplateRoot()} and is missing from the embedded templates.`);
  const canvas = source.canvas as Record<string, unknown>;
  const sources = source.sources as Record<string, unknown>;
  const images = source.images as Record<string, unknown>;
  const reportOutput = source.report_output as Record<string, unknown>;
  const spacing = source.spacing as Record<string, unknown>;
  const typography = source.typography as Record<string, unknown>;
  const shapes = source.shapes as Record<string, unknown>;
  const metrics = source.metrics as Record<string, unknown>;
  const text = source.text as Record<string, unknown>;
  const legacySource = source.legacy as Record<string, unknown>;
  const get = (group: Record<string, unknown>, key: string): number => numberAt(group[key], `render-config.${key}`);
  const legacy = Object.fromEntries(Object.entries(legacySource).map(([key, value]) => [key, numberAt(value, `render-config.legacy.${key}`)]));
  const numberDictionary = (name: string): Record<string, number> => Object.fromEntries(Object.entries((source[name] ?? {}) as Record<string, unknown>).map(([key, value]) => [key, numberAt(value, `render-config.${name}.${key}`)]));
  const camelDictionary = (name: string): Record<string, number> => Object.fromEntries(Object.entries(numberDictionary(name)).map(([key, value]) => [key.replace(/_([a-z0-9])/g, (_match, character: string) => character.toUpperCase()), value]));
  return {
    canvas: { width: get(canvas, 'width'), height: get(canvas, 'height'), pptxWidth: get(canvas, 'pptx_width'), pptxHeight: get(canvas, 'pptx_height'), pointsPerInch: get(canvas, 'points_per_inch') },
    assets: camelDictionary('assets'),
    sources: { zipMaxEntries: get(sources, 'zip_max_entries'), zipMaxFileBytes: get(sources, 'zip_max_file_bytes'), zipMaxTotalBytes: get(sources, 'zip_max_total_bytes'), zipMaxCompressionRatio: get(sources, 'zip_max_compression_ratio'), zipMaxNestedArchives: get(sources, 'zip_max_nested_archives') },
    images: { maxAssetBytes: get(images, 'max_asset_bytes'), maxDecodedPixels: get(images, 'max_decoded_pixels'), maxDimensionPx: get(images, 'max_dimension_px'), maxPerDocument: get(images, 'max_per_document'), remoteTimeoutMs: get(images, 'remote_timeout_ms'), remoteMaxRedirects: get(images, 'remote_max_redirects') },
    reportOutput: { pngWidthPx: get(reportOutput, 'png_width_px'), pptxWidthInches: get(reportOutput, 'pptx_width_inches'), pptxHeightInches: get(reportOutput, 'pptx_height_inches') },
    pdf: camelDictionary('pdf'),
    chart: camelDictionary('chart'),
    spacing: { margin: get(spacing, 'margin'), contentWidth: get(spacing, 'content_width'), footerY: get(spacing, 'footer_y'), footerHeight: get(spacing, 'footer_height'), contentGap: get(spacing, 'content_gap'), cardGap: get(spacing, 'card_gap'), cardPaddingX: get(spacing, 'card_padding_x'), cardPaddingY: get(spacing, 'card_padding_y'), columnPadding: get(spacing, 'column_padding'), fallbackHeaderLine: get(spacing, 'fallback_header_line'), fallbackContentBottom: get(spacing, 'fallback_content_bottom'), fallbackHeaderTitle: get(spacing, 'fallback_header_title'), fallbackHeaderSubtitle: get(spacing, 'fallback_header_subtitle'), chartSidePadding: get(spacing, 'chart_side_padding'), tableTopAdjustment: get(spacing, 'table_top_adjustment'), narrativeOffset: get(spacing, 'narrative_offset'), conclusionsOffset: get(spacing, 'conclusions_offset'), maxChartHeight: get(spacing, 'max_chart_height') },
    typography: { title: get(typography, 'title'), subtitle: get(typography, 'subtitle'), eyebrow: get(typography, 'eyebrow'), headerTitle: get(typography, 'header_title'), headerSubtitle: get(typography, 'header_subtitle'), body: get(typography, 'body'), small: get(typography, 'small'), metricLabel: get(typography, 'metric_label'), metricValue: get(typography, 'metric_value'), metricDelta: get(typography, 'metric_delta'), metricNote: get(typography, 'metric_note'), table: get(typography, 'table'), narrative: get(typography, 'narrative'), highlight: get(typography, 'highlight'), conclusion: get(typography, 'conclusion'), footer: get(typography, 'footer') },
    shapes: { metricRadius: get(shapes, 'metric_radius'), calloutRadius: get(shapes, 'callout_radius'), conclusionIcon: get(shapes, 'conclusion_icon'), conclusionIconRadius: get(shapes, 'conclusion_icon_radius'), bulletRadius: get(shapes, 'bullet_radius') },
    metrics: { maxHeight: get(metrics, 'max_height'), usableHeight: get(metrics, 'usable_height'), valueBaseline: get(metrics, 'value_baseline'), labelBaseline: get(metrics, 'label_baseline'), deltaBaseline: get(metrics, 'delta_baseline'), noteBottom: get(metrics, 'note_bottom'), calloutHeight: get(metrics, 'callout_height'), calloutPaddingX: get(metrics, 'callout_padding_x'), calloutPaddingY: get(metrics, 'callout_padding_y') },
    text: { headingGlyphWidth: get(text, 'heading_glyph_width'), bodyGlyphWidth: get(text, 'body_glyph_width'), monoHeadingGlyphWidth: get(text, 'mono_heading_glyph_width'), monoBodyGlyphWidth: get(text, 'mono_body_glyph_width'), monoEstimatedGlyphWidth: get(text, 'mono_estimated_glyph_width'), lineHeight: get(text, 'line_height'), titleMaxLines: get(text, 'title_max_lines'), subtitleMaxLines: get(text, 'subtitle_max_lines'), headerMaxLines: get(text, 'header_max_lines') },
    pptx: numberDictionary('pptx'),
    contrast: camelDictionary('contrast') as RenderConfig['contrast'],
    fallbacks: numberDictionary('fallbacks'),
    legacy,
  };
}

function numberAt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Built-in template ${label} must be a finite number.`);
  return value;
}

export function readBuiltinSlideTemplate(templateRef: string | undefined): BuiltinSlideTemplateDocument | undefined {
  if (!templateRef) return readBuiltinSlideTemplate('slides/standard');
  const source = readYaml(readTemplateFile(templateRelativePath(templateRef)));
  if (!source) return undefined;
  return {
    id: typeof source.id === 'string' ? source.id : templateRef,
    headerTitleY: numberAt(source.header_title_y, `${templateRef}.header_title_y`),
    headerSubtitleY: numberAt(source.header_subtitle_y, `${templateRef}.header_subtitle_y`),
    headerLineY: numberAt(source.header_line_y, `${templateRef}.header_line_y`),
    contentTop: numberAt(source.content_top, `${templateRef}.content_top`),
    contentBottom: numberAt(source.content_bottom, `${templateRef}.content_bottom`),
    titleAlign: source.title_align === 'center' ? 'center' : 'start',
  };
}

export function readBuiltinTemplateSource(templateRef: string | undefined): { source: unknown; path: string } | undefined {
  if (!templateRef) return undefined;
  const file = readTemplateFile(templateRelativePath(templateRef));
  const source = readYaml(file);
  if (!file || !source || source.kind !== 'slide') return undefined;
  return { source, path: file.path };
}

export function readBuiltinPageTemplateSource(templateRef: string | undefined): { source: unknown; path: string } | undefined {
  if (!templateRef) return undefined;
  const file = readTemplateFile(templateRelativePath(templateRef));
  const source = readYaml(file);
  if (!file || !source || source.kind !== 'page') return undefined;
  return { source, path: file.path };
}

function slideTemplateRefs(): string[] {
  const suffix = '/template.yml';
  const refs = new Set(Object.keys(BUILTIN_TEMPLATE_FILES)
    .filter((key) => key.startsWith('slides/') && key.endsWith(suffix))
    .map((key) => key.slice(0, -suffix.length)));
  const overrideRoot = overrideTemplateRoot();
  const overrideSlides = overrideRoot ? join(overrideRoot, 'slides') : undefined;
  if (overrideSlides && existsSync(overrideSlides)) {
    for (const entry of readdirSync(overrideSlides, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(overrideSlides, entry.name, 'template.yml'))) refs.add(`slides/${entry.name}`);
    }
  }
  return [...refs].sort();
}

export function listBuiltinSlideTemplates(): Array<{ templateRef: string; path: string }> {
  return slideTemplateRefs().map((templateRef) => ({ templateRef, path: templatePath(templateRef) }));
}

function pageTemplateRefs(): string[] {
  const suffix = '/template.yml';
  const refs = new Set(Object.keys(BUILTIN_TEMPLATE_FILES)
    .filter((key) => key.startsWith('pages/') && key.endsWith(suffix))
    .map((key) => key.slice(0, -suffix.length)));
  const overrideRoot = overrideTemplateRoot();
  const overridePages = overrideRoot ? join(overrideRoot, 'pages') : undefined;
  if (overridePages && existsSync(overridePages)) {
    for (const entry of readdirSync(overridePages, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(overridePages, entry.name, 'template.yml'))) refs.add(`pages/${entry.name}`);
    }
  }
  return [...refs].sort();
}

export function listBuiltinPageTemplates(): Array<{ templateRef: string; path: string }> {
  return pageTemplateRefs().map((templateRef) => ({ templateRef, path: templatePath(templateRef) }));
}

export function readBuiltinTemplateText(templateRef: string): { text: string; path: string } {
  const file = readTemplateFile(templateRelativePath(templateRef));
  if (!file) throw new Error(`Built-in template '${templateRef}' was not found in ${builtinTemplateRoot()} or in the embedded templates.`);
  return file;
}
