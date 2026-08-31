import type { jsPDF } from 'jspdf';
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
} from './composition/report-shadow.js';
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
import type { CompositionBox } from './composition/engine.js';
import { assertReportPlan } from './report-plan-assertions.js';
import { installReportDrawingRecorder, type ReportDrawing } from './report-drawing-recorder.js';
import { loadRenderFontSet, newPdf, pdfFont, readableTextColor } from './render-primitives.js';
import { compileTemplateSource, type CompiledTemplate } from './template-contract.js';
import { resolveImageAsset } from './image-resolver.js';
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

function drawReportChrome(doc: jsPDF, page: number, pageCount: number, geometry: PageGeometry, theme: RenderTheme, logo: Awaited<ReturnType<typeof resolveImageAsset>> | undefined, brand: string | undefined, lockupBox?: CompositionBox, continuation = false): void {
  doc.setFillColor(...rgb(theme.background));
  doc.rect(0, 0, geometry.width, geometry.height, 'F');
  const headerBandHeight = geometry.bands.header?.bottom ?? PDF_CONFIG.headerBandHeight;
  const band = theme.reportHeaderStyle === 'accent-band' ? theme.primary : theme.reportHeaderStyle === 'dark-band' ? theme.background : undefined;
  if (band) {
    doc.setFillColor(...rgb(band));
    doc.rect(0, 0, geometry.width, headerBandHeight, 'F');
  }
  const lockup = continuation ? REPORT_LOCKUP.continuation : REPORT_LOCKUP.standard;
  const logoWidth = theme.logoMarkPath || theme.logoWhiteMarkPath ? lockup.markWidthMm : lockup.fullLogoWidthMm;
  const logoX = lockupBox?.x ?? PDF_CONFIG.margin;
  const logoY = continuation ? PDF_CONFIG.headerRepeatLogoY : lockupBox?.y ?? PDF_CONFIG.headerLogoY;
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
    const ruleY = headerBandHeight - PDF_CONFIG.headerBottomGap;
    doc.line(PDF_CONFIG.margin, ruleY, geometry.width - PDF_CONFIG.margin, ruleY);
  }
  const footerTop = geometry.bands.footer?.top ?? PDF_CONFIG.footerY - PDF_CONFIG.footerFontSize;
  doc.setDrawColor(...rgb(theme.line));
  doc.setLineWidth(PDF_CONFIG.footerLineWidth);
  doc.line(PDF_CONFIG.margin, footerTop, geometry.width - PDF_CONFIG.margin, footerTop);
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  doc.setTextColor(...rgb(theme.muted));
  doc.text(`${page} / ${pageCount}`, geometry.width - PDF_CONFIG.margin, footerTop + PDF_CONFIG.footerBaselineOffset, { align: 'right' });
}

function configNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Render configuration is missing finite ${key}.`);
  return value;
}

function drawCompositionDebugOverlay(doc: jsPDF, composition: ReportCompositionResult, theme: RenderTheme): void {
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
  const drawLabel = (text: string, box: CompositionBox): void => {
    doc.setFont(pdfFont(theme), 'normal');
    doc.setFontSize(debug.labelSize);
    doc.setTextColor(...rgb(theme.primary));
    doc.text(text, box.x + debug.labelGap, box.y + debug.labelGap + debug.labelSize);
  };
  for (const page of plan.pages ?? []) {
    doc.setPage(page.page);
    doc.setFont(pdfFont(theme), 'bold');
    doc.setFontSize(debug.labelSize);
    doc.setTextColor(...rgb(theme.primary));
    doc.text(`DEBUG overlay p${page.page} - ${composition.evaluation.status}`, debug.pagePadding, debug.pagePadding);

    for (const placement of plan.flowPlacements ?? []) {
      if (placement.page !== page.page) continue;
      const empty = !placement.hasContent && (placement.blockedBy ?? []).length === 0;
      const placementColor = empty ? theme.danger : placement.flowId === 'quotes' ? theme.secondary : theme.primary;
      drawRect(placement.box, empty ? debug.obstacleLineWidth : debug.placementLineWidth, placementColor, true);
      drawLabel(`${placement.flowId} r${placement.routeIndex} ${placement.hasContent ? `${placement.lineCount} lines` : 'EMPTY'}`, placement.box);
    }

    for (const graphic of plan.graphicPlacements ?? []) {
      if (graphic.page !== page.page || !(graphic.wrap === 'around' || graphic.graphicId.startsWith('insertion:'))) continue;
      drawRect(graphic.box, debug.obstacleLineWidth, theme.secondary);
      drawLabel(`OBSTACLE ${graphic.graphicId}`, graphic.box);
    }

    for (const placement of [...(plan.blockPlacements ?? []), ...(plan.tablePlacements ?? [])]) {
      if (placement.page !== page.page) continue;
      drawRect(placement.box, debug.lineWidth, theme.primary);
      drawLabel(`BLOCK ${placement.blockId}`, placement.box);
    }

    for (const line of lines) {
      if (line.page !== page.page) continue;
      const lineColor = headingBlocks.has(line.blockId) ? theme.primary : line.flowId === 'quotes' ? theme.secondary : line.flowId === 'intro' ? theme.primary : theme.foreground;
      drawRect(line.box, debug.lineWidth, lineColor);
      if (line.layer === 'insertion' || line.startWord === 0) drawLabel(`${line.flowId}:${line.blockId} ${line.startWord}-${line.endWord}`, line.box);
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

export async function renderReportCompositionPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext, compositionDebug = false): Promise<{ buffer: Buffer; composition: ReportCompositionResult; drawings: ReportDrawing[] }> {
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
    const imageCaption = theme.reportImageCaption;
  const compositionChartStyle = compositionChartStyleFromRenderConfig({ fillColor: rgb(theme.background), drawColor: rgb(theme.line), foregroundColor: rgb(theme.foreground), mutedColor: rgb(theme.muted), gridColor: rgb(theme.line), palette: theme.palette.map(rgb) });
  const imageCapabilities = compositionDocument.assets?.length
    ? createJsPdfImageBlockCapabilities(doc, family, resolvedImages, compositionImageStyleFromRenderConfig({
      ...(imageCaption?.size === undefined ? {} : { captionSize: imageCaption.size }),
      ...(imageCaption?.lineHeight === undefined ? {} : { captionLineHeight: imageCaption.lineHeight }),
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
  }, theme.titleCase);
  const composition = planReportComposition(doc, template, planGeometry, data, { family, maxPages, includeTitlePage: Boolean(data.flows.title && template.pageTitle), includeHeaderFlow: Boolean(data.flows.header), auxiliaryTextWidths: { footer: footerTextWidth(doc, geometry, maxPages, theme) }, policy: { minimumWrapWidth: PDF_CONFIG.floatMinWidth }, styles: compositionStyles, ...(combined ? { measureBlock: combined.measureBlock } : {}), ...(tableCapabilities ? { measureTable: tableCapabilities.measureTable } : {}) });
  if (composition.evaluation.status === 'rejected') {
    const details = composition.evaluation.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`Composition plan rejected for '${name}': ${details}`);
  }
  const logo = await reportLogo(theme, sourceContext);
  for (const page of composition.plan.pages) {
    if (doc.getNumberOfPages() < page.page) doc.addPage([page.width, page.height]);
    doc.setPage(page.page);
    const pageGeometry = page.layoutId === `${template.id}:continuation` ? geometry.continuation ?? geometry : geometry;
    if (!(template.pageTitle && page.page === 1)) {
      const lockup = composition.plan.slots.find((slot) => slot.page === page.page && slot.id === `${page.page}:header-lockup`);
      drawReportChrome(doc, page.page, composition.plan.pages.length, pageGeometry, theme, logo, theme.brandName, lockup?.box, page.layoutId === `${template.id}:continuation`);
    }
  }
  if (compositionDebug) drawCompositionDebugOverlay(doc, composition, theme);
  renderComposition(composition.document, composition, createJsPdfTextBackend(doc, family, compositionStyles, { ...compositionPdfBackendOptionsFromRenderConfig(), ...(resolvedImages.size > 0 ? { imageAssets: resolvedImages } : {}), ...(combined ? { blockRenderers: combined.blockRenderers } : {}), ...(tableCapabilities ? { tableRenderer: tableCapabilities.renderer } : {}) }));
  return { buffer: Buffer.from(doc.output('arraybuffer')), composition, drawings };
}

/** Alias retained for the prototype harness; it executes the same planner route. */
export async function renderReportCompositionShadowPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext) {
  return renderReportCompositionPdf(name, data, theme, sourceContext);
}

export function resolveReportPlanOnly(name: string, data: CompositionInput, theme = defaultRenderTheme()): ResolvedReportPlan {
  const { geometry } = compositionGeometry(name);
  const plan = resolveReportPlan({ templateRef: name, theme, geometry, pageCount: 1, compositionDocument: compositionDocumentFromInput(data) });
  assertReportPlan(plan, { requireCoverage: geometry.dynamicFlow, maxCoverageGap: PDF_CONFIG.planCoverageMaxGap });
  return plan;
}
