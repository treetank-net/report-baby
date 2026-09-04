import type { jsPDF } from 'jspdf';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { defaultRenderTheme } from './brand-context.js';
import { readBuiltinPageTemplateSource, readRenderConfig } from './builtin-template-source.js';
import type { RenderTheme } from './core/model/render-theme.js';
import type { ResolvedReportPlan } from './core/model/resolved-report-plan.js';
import type { CompositionInput } from './contract/schema.js';
import { pageGeometryFromTemplate, type PageGeometry } from './page-geometry.js';
import { resolveReportPlan } from './report-plan.js';
import {
  compositionChartStyleFromRenderConfig,
  compositionImageStyleFromRenderConfig,
  compositionMetricStyleFromRenderConfig,
  compositionPdfBackendOptionsFromRenderConfig,
  compositionStylesFromRenderConfig,
  compositionTableStyleFromRenderConfig,
  planReportComposition,
  type ReportCompositionResult,
} from './composition/report-composition-entrypoint.js';
import { createCompositionContrastProvider } from './composition/contrast.js';
import { compositionDocumentFromInput } from './composition/input.js';
import {
  combineJsPdfCompositionBlockCapabilities,
  createJsPdfChartBlockCapabilities,
  createJsPdfImageBlockCapabilities,
  createJsPdfMetricBlockCapabilities,
  createJsPdfTableBlockCapabilities,
  createJsPdfTextBackend,
} from './composition/js-pdf-adapter.js';
import type { CompositionBlockKind } from './composition/model.js';
import type { JsPdfCompositionBlockCapability } from './composition/js-pdf-adapter.js';
import { renderComposition } from './composition/engine.js';
import type { CompositionBox, CompositionPageChrome, CompositionPlan } from './composition/engine.js';
import { assertReportPlan } from './report-plan-assertions.js';
import { installReportDrawingRecorder, type ReportDrawing } from './report-drawing-recorder.js';
import { loadRenderFontSet, newPdf, pdfFont, readableTextColor } from './render-primitives.js';
import { compileTemplateSource, type CompiledTemplate } from './template-contract.js';
import { resolveImageAsset } from './image-resolver.js';
import { decodePngDataUri } from './image-raster.js';
import type { SourceContext } from './source-context.js';

export interface TemplateInfo { name: string; description: string; }

const TEMPLATES: TemplateInfo[] = [
  { name: 'default-report', description: 'Branded A4 report rendered from named semantic flows.' },
  { name: 'campaign-summary', description: 'Compact A4 campaign summary using the same semantic flow contract.' },
  { name: 'pages/editorial-two-column', description: 'A4 editorial page with two equal text columns.' },
  { name: 'pages/editorial-inset-two-column', description: 'A4 editorial page with a full-width intro and full-width in-text insertions between two narrative columns.' },
  { name: 'pages/editorial-metrics-two-column', description: 'A4 editorial page with KPI slots above two narrative columns.' },
  { name: 'pages/editorial-chart-two-column', description: 'A4 editorial page with a chart slot above two narrative columns.' },
  { name: 'pages/editorial-three-column', description: 'A4 editorial page with three unequal text columns.' },
  { name: 'pages/showcase-report', description: 'A4 report page with a plain first-page surface and a continuation layout.' },
  { name: 'pages/showcase-report-band', description: 'A4 report page with a reserved header band and a continuation layout.' },
];

export function listTemplates(): TemplateInfo[] { return TEMPLATES; }

const RENDER_CONFIG = readRenderConfig();
const PDF_CONFIG = RENDER_CONFIG.pdf;
const REPORT_LOCKUP = RENDER_CONFIG.chrome.reportLockup;
const PT_TO_PX = RENDER_CONFIG.canvas.width / RENDER_CONFIG.canvas.pptxWidth / RENDER_CONFIG.canvas.pointsPerInch;

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function compositionTextCorpusSeed(document: ReturnType<typeof compositionDocumentFromInput>): string {
  const corpus = Object.values(document.flows)
    .flatMap((flow) => flow.blocks.map((block) => block.text ?? ''))
    .join('\u241e');
  return createHash('sha1').update(corpus).digest('hex');
}

interface ResolvedReportTemplate { page?: CompiledTemplate['page']; compiled?: CompiledTemplate; }

function resolveTemplate(name: string): ResolvedReportTemplate {
  const sourceName = name === 'default-report' || name === 'campaign-summary' ? 'pages/default-report' : name;
  const pageSource = readBuiltinPageTemplateSource(sourceName);
  if (!pageSource) throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((template) => template.name).join(', ')}`);
  const compiled = compileTemplateSource(pageSource.source);
  return { page: compiled.page, compiled };
}

function compositionGeometry(name: string): { template: CompiledTemplate; geometry: PageGeometry } {
  const resolved = resolveTemplate(name);
  if (!resolved.compiled || !resolved.page) throw new Error(`Template '${name}' has no declarative page composition.`);
  return { template: resolved.compiled, geometry: pageGeometryFromTemplate(resolved.compiled) };
}

async function reportLogo(theme: RenderTheme, sourceContext: SourceContext | undefined) {
  const path = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoWhitePath : theme.logoMarkPath ?? theme.logoPath;
  if (!path || !sourceContext) return undefined;
  const relativePath = relative(sourceContext.brandRoot, path).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('../')) return undefined;
  return resolveImageAsset(`brand://${relativePath}`, sourceContext);
}

function drawContainedImage(doc: jsPDF, asset: Awaited<ReturnType<typeof resolveImageAsset>> | undefined, x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } | undefined {
  if (!asset) return undefined;
  const properties = doc.getImageProperties(asset.data);
  const scale = Math.min(width / properties.width, height / properties.height);
  const renderedWidth = properties.width * scale;
  const renderedHeight = properties.height * scale;
  const rendered = { x: x + (width - renderedWidth) / 2, y: y + (height - renderedHeight) / 2, width: renderedWidth, height: renderedHeight };
  doc.addImage(asset.data, asset.format, rendered.x, rendered.y, rendered.width, rendered.height);
  return rendered;
}

function drawReportChrome(doc: jsPDF, page: number, pageCount: number, geometry: PageGeometry, theme: RenderTheme, logo: Awaited<ReturnType<typeof resolveImageAsset>> | undefined, brand: string | undefined, chrome: CompositionPageChrome, continuation = false): void {
  doc.setFillColor(...rgb(theme.background));
  doc.rect(0, 0, geometry.width, geometry.height, 'F');
  const headerBandHeight = chrome.headerBand.height;
  const band = theme.reportHeaderStyle === 'accent-band' ? theme.primary : theme.reportHeaderStyle === 'dark-band' ? theme.background : undefined;
  if (band) {
    doc.setFillColor(...rgb(band));
    doc.rect(chrome.headerBand.x, chrome.headerBand.y, chrome.headerBand.width, chrome.headerBand.height, 'F');
  }
  const lockup = continuation ? REPORT_LOCKUP.continuation : REPORT_LOCKUP.standard;
  const logoWidth = theme.logoMarkPath || theme.logoWhiteMarkPath ? lockup.markWidthMm : lockup.fullLogoWidthMm;
  const logoX = chrome.lockup?.x ?? PDF_CONFIG.margin;
  const logoY = continuation ? PDF_CONFIG.headerRepeatLogoY : chrome.lockup?.y ?? PDF_CONFIG.headerLogoY;
  const logoHeight = lockup.maxHeightMm;
  const renderedLogo = drawContainedImage(doc, logo, logoX, logoY, logoWidth, logoHeight) ?? { x: logoX, y: logoY, width: logoWidth, height: logoHeight };
  if (brand && theme.showReportBrandName) {
    doc.setFont(pdfFont(theme), 'bold');
    const brandSize = lockup.nameSizePt;
    doc.setFontSize(brandSize);
    doc.setTextColor(...rgb(band ? readableTextColor(band, theme, brandSize * PT_TO_PX, true) : theme.primary));
    const brandHeight = doc.getTextDimensions(brand.toUpperCase()).h;
    const freeHeight = Math.max(0, renderedLogo.height - brandHeight);
    const brandOffset = lockup.verticalAlign === 'middle' ? freeHeight / 2 : lockup.verticalAlign === 'bottom' ? freeHeight : 0;
    const brandBaseline = renderedLogo.y + brandOffset + brandHeight;
    doc.text(brand.toUpperCase(), renderedLogo.x + renderedLogo.width + lockup.gapMm, brandBaseline);
  }
  if (!band && theme.reportHeaderStyle !== 'image-band') {
    doc.setDrawColor(...rgb(theme.primary));
    doc.setLineWidth(continuation ? PDF_CONFIG.headerRepeatRuleWidth : PDF_CONFIG.headerRuleWidth);
    const rule = chrome.headerRule;
    if (rule) doc.line(rule.x, rule.y, rule.x + rule.width, rule.y);
  }
  doc.setDrawColor(...rgb(theme.line));
  doc.setLineWidth(PDF_CONFIG.footerLineWidth);
  doc.line(chrome.footerRule.x, chrome.footerRule.y, chrome.footerRule.x + chrome.footerRule.width, chrome.footerRule.y);
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  doc.setTextColor(...rgb(theme.muted));
  const pageNumber = `${page} / ${pageCount}`;
  doc.text(pageNumber, chrome.pageNumber.x + chrome.pageNumber.width, chrome.pageNumber.y + chrome.pageNumber.height, { align: 'right' });
}

function configNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Render configuration is missing finite ${key}.`);
  return value;
}

function drawCompositionDebugOverlay(doc: jsPDF, composition: ReportCompositionResult, theme: RenderTheme, geometry: PageGeometry): void {
  const debug = RENDER_CONFIG.compositionDebug;
  const plan = composition.plan;
  const headingBlocks = new Set((plan.trace?.blocks ?? []).filter((block) => block.kind === 'heading').map((block) => block.blockId));
  const lines = [...(plan.lines ?? []), ...(plan.insertionLines ?? [])];
  const drawRect = (box: CompositionBox, width: number, color: string, dashed = false): void => {
    doc.setDrawColor(...rgb(color));
    doc.setLineWidth(width);
    doc.setLineDashPattern(dashed ? [2, 1] : [], 0);
    doc.rect(box.x, box.y, box.width, box.height, 'S');
  };
  const drawLabel = (text: string, box: CompositionBox, page: CompositionPlan['pages'][number], labelColor = theme.primary, preferredPosition: 'above' | 'side' = 'above'): void => {
    doc.setFont(pdfFont(theme), 'normal');
    doc.setFontSize(debug.labelSize);
    doc.setTextColor(...rgb(labelColor));
    const width = doc.getTextWidth(text);
    const canPlaceAbove = preferredPosition === 'above' && box.y > debug.labelGap + debug.labelSize;
    if (canPlaceAbove) {
      doc.text(text, box.x, box.y - debug.labelGap);
      return;
    }
    if (box.x <= page.width / 2) {
      doc.text(text, Math.max(debug.labelGap, box.x - debug.labelGap), box.y + debug.labelSize, { align: 'right' });
      return;
    }
    const rightX = box.x + box.width + debug.labelGap;
    if (rightX + width <= page.width - debug.labelGap) {
      doc.text(text, rightX, box.y + debug.labelSize);
    } else {
      doc.text(text, page.width - debug.labelGap, box.y + debug.labelSize, { align: 'right' });
    }
  };
  for (const page of plan.pages ?? []) {
    doc.setPage(page.page);
    const pageGeometry = page.layoutId.endsWith(':continuation') ? geometry.continuation ?? geometry : geometry;
    doc.setFont(pdfFont(theme), 'bold');
    doc.setFontSize(debug.labelSize);
    doc.setTextColor(...rgb(theme.primary));
    doc.text(`DEBUG overlay p${page.page} - ${composition.evaluation.status}`, debug.pagePadding / 2, debug.pagePadding);

    const chrome = page.chrome;
    const headerBand = chrome?.headerBand ?? { x: 0, y: 0, width: page.width, height: pageGeometry.bands.header?.bottom ?? PDF_CONFIG.headerBandHeight };
    drawRect(headerBand, debug.lineWidth, theme.muted, true);
    drawLabel('CHROME header band', headerBand, page, theme.muted, 'side');

    for (const placement of plan.flowPlacements ?? []) {
      if (placement.page !== page.page) continue;
      const empty = !placement.hasContent && (placement.blockedBy ?? []).length === 0;
      const reserved = empty && placement.flowId === 'quotes';
      const placementColor = reserved ? theme.secondary : empty ? theme.danger : placement.flowId === 'quotes' ? theme.secondary : theme.primary;
      drawRect(placement.box, empty ? debug.obstacleLineWidth : debug.placementLineWidth, placementColor, true);
      const placementLabel = reserved
        ? `RESERVED ${placement.flowId} r${placement.routeIndex}`
        : placement.hasContent
          ? `${placement.flowId} r${placement.routeIndex} ${placement.lineCount} lines`
          : `EMPTY ${placement.flowId} r${placement.routeIndex}`;
      drawLabel(placementLabel, placement.box, page, placementColor);
    }

    for (const graphic of plan.graphicPlacements ?? []) {
      if (graphic.page !== page.page || !(graphic.wrap === 'around' || graphic.graphicId.startsWith('insertion:'))) continue;
      drawRect(graphic.box, debug.obstacleLineWidth, theme.secondary);
      drawLabel(`OBSTACLE ${graphic.graphicId}`, graphic.box, page, theme.secondary);
    }

    for (const frame of plan.movableInsertionFrames ?? []) {
      if (frame.page !== page.page) continue;
      drawRect(frame.box, debug.obstacleLineWidth, theme.danger, true);
      drawLabel(`MOVABLE INSERTION FRAME ${frame.id} · ${frame.candidateCount} ${frame.axis}-positions`, frame.box, page, theme.danger, 'side');
    }

    for (const candidate of plan.flowBarrierBoxCandidates ?? []) {
      if (candidate.page !== page.page) continue;
      const inset = Math.min(debug.flowBarrierBoxInset, candidate.box.width / 2, candidate.box.height / 2);
      const visibleBox = {
        x: candidate.box.x + inset,
        y: candidate.box.y + inset,
        width: Math.max(0, candidate.box.width - inset * 2),
        height: Math.max(0, candidate.box.height - inset * 2),
      };
      drawRect(visibleBox, debug.placementLineWidth, theme.warning, true);
      drawLabel(`FLOW BARRIER BOX CANDIDATE ${candidate.flowId} ${candidate.previousSourceId ?? 'flow-start'} -> ${candidate.nextSourceId ?? 'flow-end'}`, visibleBox, page, theme.warning, 'side');
    }

    for (const placement of plan.blockPlacements ?? []) {
      if (placement.page !== page.page) continue;
      drawRect(placement.box, debug.lineWidth, theme.primary);
      drawLabel(`BLOCK ${placement.blockId}`, placement.box, page, theme.primary);
      if (placement.kind === 'image' && placement.imageBox) {
        drawRect(placement.imageBox, debug.lineWidth, theme.primary);
        drawLabel(`IMAGE ${placement.blockId}`, placement.imageBox, page, theme.primary);
      }
      if (placement.kind === 'image' && placement.captionBox) {
        drawRect(placement.captionBox, debug.lineWidth, theme.secondary);
        drawLabel(`CAPTION ${placement.blockId}`, placement.captionBox, page, theme.secondary);
      }
    }

    for (const placement of plan.tablePlacements ?? []) {
      if (placement.page !== page.page) continue;
      drawRect(placement.box, debug.lineWidth, theme.primary);
      drawLabel(`TABLE ${placement.blockId}`, placement.box, page, theme.primary);
    }

    const pageNumberBox = chrome?.pageNumber;
    if (pageNumberBox) {
      drawRect(pageNumberBox, debug.lineWidth, theme.muted);
      drawLabel('CHROME footer {page}/{pages}', pageNumberBox, page, theme.muted, 'side');
    }

    for (const line of lines) {
      if (line.page !== page.page) continue;
      const lineColor = headingBlocks.has(line.blockId) ? theme.primary : line.flowId === 'quotes' ? theme.secondary : line.flowId === 'intro' ? theme.primary : theme.foreground;
      drawRect(line.box, debug.lineWidth, lineColor);
      if (line.layer === 'insertion' || line.startWord === 0) drawLabel(`${line.flowId}:${line.blockId} ${line.startWord}-${line.endWord}`, line.box, page, lineColor, 'side');
    }

    for (const glyph of plan.glyphPlacements ?? []) {
      if (glyph.page !== page.page) continue;
      const glyphColor = glyph.source === 'authored' ? theme.danger : theme.secondary;
      drawRect(glyph.box, debug.lineWidth, glyphColor, true);
      drawLabel(`GLYPH ${glyph.source} ${glyph.glyphId}`, glyph.box, page, glyphColor, 'side');
    }
  }
  doc.setLineDashPattern([], 0);
}

export interface ReportRenderDiagnostics {
  plan: ResolvedReportPlan;
  drawings: ReportDrawing[];
  composition?: ReportCompositionResult;
}

export async function renderReportPdfDetailed(name: string, data: CompositionInput, theme = defaultRenderTheme(), warnings: string[] = [], sourceContext?: SourceContext, compositionDebug = false): Promise<{ buffer: Buffer; diagnostics: ReportRenderDiagnostics }> {
  const planned = await renderReportCompositionPdf(name, data, theme, sourceContext, compositionDebug);
  for (const diagnostic of planned.composition.evaluation.diagnostics) if (diagnostic.severity === 'warning') warnings.push(diagnostic.message);
  const { geometry } = compositionGeometry(name);
  const plan = resolveReportPlan({ templateRef: name, theme, geometry, pageCount: Math.max(1, planned.composition.plan.pages.length), compositionDocument: planned.composition.document });
  assertReportPlan(plan, { requireCoverage: geometry.dynamicFlow, maxCoverageGap: PDF_CONFIG.planCoverageMaxGap });
  return { buffer: planned.buffer, diagnostics: { plan, drawings: planned.drawings, composition: planned.composition } };
}

export async function renderReportPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), warnings: string[] = [], sourceContext?: SourceContext): Promise<Buffer> {
  return (await renderReportPdfDetailed(name, data, theme, warnings, sourceContext)).buffer;
}

function footerTextWidth(doc: jsPDF, geometry: PageGeometry, maxPages: number, theme: RenderTheme): number {
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  const labelWidth = doc.getTextWidth(`${maxPages} / ${maxPages}`);
  const pages = [geometry, ...(geometry.continuation ? [geometry.continuation] : [])];
  return Math.min(...pages.map((page) => Math.max(1, page.width - page.margins.right - page.margins.left - PDF_CONFIG.footerNumberGap - labelWidth)));
}

interface PreparedReportComposition {
  doc: jsPDF;
  geometry: PageGeometry;
  template: CompiledTemplate;
  composition: ReportCompositionResult;
  drawings: ReportDrawing[];
  render: () => void;
}

function pageChrome(doc: jsPDF, page: CompositionPlan['pages'][number], pageCount: number, geometry: PageGeometry, theme: RenderTheme, lockup?: CompositionBox): CompositionPageChrome {
  const headerBandHeight = geometry.bands.header?.bottom ?? PDF_CONFIG.headerBandHeight;
  const headerBand: CompositionBox = { x: 0, y: 0, width: page.width, height: headerBandHeight };
  const headerRuleY = headerBandHeight - PDF_CONFIG.headerBottomGap;
  const headerRule = theme.reportHeaderStyle === 'accent-band' || theme.reportHeaderStyle === 'dark-band' || theme.reportHeaderStyle === 'image-band'
    ? undefined
    : { x: PDF_CONFIG.margin, y: headerRuleY, width: page.width - PDF_CONFIG.margin * 2, height: PDF_CONFIG.headerRuleWidth };
  const footerTop = geometry.bands.footer?.top ?? PDF_CONFIG.footerY - PDF_CONFIG.footerFontSize;
  const footerRule: CompositionBox = { x: PDF_CONFIG.margin, y: footerTop, width: page.width - PDF_CONFIG.margin * 2, height: PDF_CONFIG.footerLineWidth };
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  const pageNumberText = `${page.page} / ${pageCount}`;
  const pageNumberWidth = doc.getTextWidth(pageNumberText);
  const pageNumberHeight = doc.getTextDimensions(pageNumberText).h;
  const pageNumberBaseline = footerTop + PDF_CONFIG.footerBaselineOffset;
  const pageNumber: CompositionBox = {
    x: page.width - PDF_CONFIG.margin - pageNumberWidth,
    y: pageNumberBaseline - pageNumberHeight,
    width: pageNumberWidth,
    height: pageNumberHeight,
  };
  return { headerBand, ...(headerRule ? { headerRule } : {}), footerRule, pageNumber, ...(lockup ? { lockup } : {}) };
}

function attachPageChrome(doc: jsPDF, composition: ReportCompositionResult, geometry: PageGeometry, theme: RenderTheme): void {
  for (const page of composition.plan.pages) {
    const pageGeometry = page.layoutId.endsWith(':continuation') ? geometry.continuation ?? geometry : geometry;
    const lockup = composition.plan.slots.find((slot) => slot.page === page.page && slot.id === `${page.page}:header-lockup`);
    page.chrome = pageChrome(doc, page, composition.plan.pages.length, pageGeometry, theme, lockup?.box);
  }
}

async function prepareReportComposition(name: string, data: CompositionInput, theme: RenderTheme, sourceContext?: SourceContext, rejectOnEvaluation = true): Promise<PreparedReportComposition> {
  const { template, geometry } = compositionGeometry(name);
  const fontSet = await loadRenderFontSet(theme);
  const doc = newPdf('portrait', [geometry.width, geometry.height], fontSet);
  const family = pdfFont(theme);
  const drawings: ReportDrawing[] = [];
  installReportDrawingRecorder(doc, drawings);
  const footerTop = geometry.bands.footer?.top ?? PDF_CONFIG.footerY;
  const renderGeometry: PageGeometry = {
    ...geometry,
    bands: { ...geometry.bands, footer: geometry.bands.footer ? { ...geometry.bands.footer, top: footerTop } : { x: 0, top: footerTop, width: geometry.width, bottom: geometry.height } },
    continuationTop: geometry.continuationTop ?? PDF_CONFIG.headerRepeatHeight + PDF_CONFIG.headerRepeatBottomGap,
    continuationBottom: geometry.continuationBottom ?? footerTop,
  };
  // Do not invent a header band for templates that deliberately omit one.
  // A continuation-only header must remain a property of that continuation
  // layout, otherwise the planner turns it into a first-page header too.
  const planGeometry: PageGeometry = renderGeometry;
  const maxPages = configNumber(PDF_CONFIG.compositionMaxPages, 'pdf.composition_max_pages');
  const compositionDocument = compositionDocumentFromInput(data);
  const resolvedImages = new Map<string, Awaited<ReturnType<typeof resolveImageAsset>>>();
  for (const asset of compositionDocument.assets ?? []) {
    if (!sourceContext) throw new Error('Image content requires an explicit source context.');
    resolvedImages.set(asset.id, await resolveImageAsset(asset.source, sourceContext));
  }
  const contrastRasters = new Map<string, NonNullable<ReturnType<typeof decodePngDataUri>>>();
  for (const [assetId, asset] of resolvedImages) {
    const raster = decodePngDataUri(asset.data);
    if (raster) contrastRasters.set(assetId, raster);
  }
  const contrastProvider = createCompositionContrastProvider({
    rasterImages: contrastRasters,
    foreground: rgb(theme.foreground),
    sampleCount: configNumber(RENDER_CONFIG.contrast.sampleCount, 'contrast.sample_count'),
    sampleSeed: compositionTextCorpusSeed(compositionDocument),
    pageBackground: rgb(theme.background),
  });
  const imageCaption = theme.reportImageCaption;
  const compositionChartStyle = compositionChartStyleFromRenderConfig({ fillColor: rgb(theme.background), drawColor: rgb(theme.line), foregroundColor: rgb(theme.foreground), mutedColor: rgb(theme.muted), gridColor: rgb(theme.line), palette: theme.palette.map(rgb) });
  const imageCapabilities = compositionDocument.assets?.length
    ? createJsPdfImageBlockCapabilities(doc, family, resolvedImages, compositionImageStyleFromRenderConfig({
      ...(imageCaption?.size === undefined ? {} : { captionSize: imageCaption.size }),
      ...(imageCaption?.lineHeight === undefined ? {} : { captionLineHeight: imageCaption.lineHeight }),
      ...(imageCaption?.baselineOffset === undefined ? {} : { captionBaselineOffset: imageCaption.baselineOffset }),
      ...(imageCaption?.gap === undefined ? {} : { captionGap: imageCaption.gap }),
      ...(imageCaption?.paddingX === undefined ? {} : { captionPaddingX: imageCaption.paddingX }),
      ...(imageCaption?.bottomGap === undefined ? {} : { captionBottomGap: imageCaption.bottomGap }),
      ...(imageCaption?.align === undefined ? {} : { captionAlign: imageCaption.align }),
      chart: compositionChartStyle,
    }))
    : undefined;
  const blocks = Object.values(compositionDocument.flows).flatMap((flow) => flow.blocks);
  const capabilities: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockCapability>> = {};
  if (blocks.some((block) => block.kind === 'metric')) capabilities.metric = createJsPdfMetricBlockCapabilities(doc, family, compositionMetricStyleFromRenderConfig({ fillColor: rgb(theme.soft), drawColor: rgb(theme.line), labelColor: rgb(theme.muted), valueColor: rgb(theme.foreground), deltaColor: rgb(theme.primary), noteColor: rgb(theme.muted), trendUpColor: rgb(theme.success), trendDownColor: rgb(theme.danger), trendFlatColor: rgb(theme.muted) }));
  if (blocks.some((block) => block.kind === 'chart')) capabilities.chart = createJsPdfChartBlockCapabilities(doc, family, compositionChartStyle);
  const tableCapabilities = blocks.some((block) => block.kind === 'table') ? createJsPdfTableBlockCapabilities(doc, family, compositionTableStyleFromRenderConfig({ headerFillColor: rgb(theme.primary), headerTextColor: rgb(readableTextColor(theme.primary, theme, PDF_CONFIG.tableFontSize * PT_TO_PX, true)), rowFillColor: rgb(theme.background), alternateRowFillColor: rgb(theme.soft), textColor: rgb(theme.foreground), lineColor: rgb(theme.line) })) : undefined;
  if (imageCapabilities) capabilities.image = imageCapabilities;
  const combined = Object.keys(capabilities).length > 0 ? combineJsPdfCompositionBlockCapabilities(capabilities) : undefined;
  const reportBand = theme.reportHeaderStyle === 'accent-band'
    ? theme.primary
    : theme.reportHeaderStyle === 'dark-band'
      ? theme.background
      : undefined;
  const reportMetadataColor = reportBand
    ? rgb(readableTextColor(reportBand, theme, PDF_CONFIG.headerPeriodSize * PT_TO_PX, false))
    : theme.reportHeaderStyle === 'image-band'
      ? rgb(theme.imageTextColor)
      : rgb(theme.muted);
  const compositionStyles = compositionStylesFromRenderConfig({
    foreground: rgb(theme.foreground),
    muted: rgb(theme.muted),
    primary: rgb(theme.primary),
    quote: rgb(theme.secondary),
    subtitle: reportMetadataColor,
    eyebrow: reportMetadataColor,
  }, theme.titleCase, theme.glyphFontFamily);
  const composition = planReportComposition(doc, template, planGeometry, data, { family, maxPages, includeTitlePage: Boolean(data.flows.title && template.pageTitle), includeHeaderFlow: Boolean(data.flows.header), auxiliaryTextWidths: { footer: footerTextWidth(doc, geometry, maxPages, theme) }, policy: { minimumWrapWidth: PDF_CONFIG.floatMinWidth }, styles: compositionStyles, ...(combined ? { measureBlock: combined.measureBlock } : {}), ...(tableCapabilities ? { measureTable: tableCapabilities.measureTable } : {}), ...(contrastProvider ? { contrastProvider } : {}) });
  attachPageChrome(doc, composition, planGeometry, theme);
  if (rejectOnEvaluation && composition.evaluation.status === 'rejected') {
    const details = composition.evaluation.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`Composition plan rejected for '${name}': ${details}`);
  }
  const render = (): void => {
    renderComposition(composition.document, composition, createJsPdfTextBackend(doc, family, compositionStyles, { ...compositionPdfBackendOptionsFromRenderConfig(), ...(resolvedImages.size > 0 ? { imageAssets: resolvedImages } : {}), ...(combined ? { blockRenderers: combined.blockRenderers } : {}), ...(tableCapabilities ? { tableRenderer: tableCapabilities.renderer } : {}) }));
  };
  return { doc, geometry, template, composition, drawings, render };
}

export async function renderReportCompositionPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext, compositionDebug = false): Promise<{ buffer: Buffer; composition: ReportCompositionResult; drawings: ReportDrawing[] }> {
  const prepared = await prepareReportComposition(name, data, theme, sourceContext);
  const { doc, geometry, template, composition, drawings } = prepared;
  const logo = await reportLogo(theme, sourceContext);
  for (const page of composition.plan.pages) {
    if (doc.getNumberOfPages() < page.page) doc.addPage([page.width, page.height]);
    doc.setPage(page.page);
    const pageGeometry = page.layoutId === `${template.id}:continuation` ? geometry.continuation ?? geometry : geometry;
    if (!(template.pageTitle && page.page === 1)) {
      const chrome = composition.plan.pages[page.page - 1].chrome;
      if (!chrome) throw new Error(`Composition plan has no chrome geometry for page ${page.page}.`);
      drawReportChrome(doc, page.page, composition.plan.pages.length, pageGeometry, theme, logo, theme.brandName, chrome, page.layoutId === `${template.id}:continuation`);
    }
  }
  if (compositionDebug) drawCompositionDebugOverlay(doc, composition, theme, geometry);
  prepared.render();
  return { buffer: Buffer.from(doc.output('arraybuffer')), composition, drawings };
}

export function resolveReportPlanOnly(name: string, data: CompositionInput, theme = defaultRenderTheme()): ResolvedReportPlan {
  const { geometry } = compositionGeometry(name);
  const plan = resolveReportPlan({ templateRef: name, theme, geometry, pageCount: 1, compositionDocument: compositionDocumentFromInput(data) });
  assertReportPlan(plan, { requireCoverage: geometry.dynamicFlow, maxCoverageGap: PDF_CONFIG.planCoverageMaxGap });
  return plan;
}

/**
 * Plan the same composition used by renderReportCompositionPdf, without
 * drawing content or producing a PDF buffer. This is the dry-run seam: the
 * jsPDF instance exists only to provide the real font metrics used by the
 * planner.
 */
export async function resolveReportCompositionOnly(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext): Promise<ReportCompositionResult> {
  return (await prepareReportComposition(name, data, theme, sourceContext, false)).composition;
}
