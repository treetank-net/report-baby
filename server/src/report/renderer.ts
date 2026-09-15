import type { jsPDF } from 'jspdf';
import { relative } from 'node:path';
import { defaultRenderTheme } from '../brand/context.js';
import { readBuiltinPageTemplateSource, readRenderConfig } from '../template/builtins.js';
import type { RenderTheme } from '../contracts/render-theme.js';
import type { ResolvedReportPlan } from '../contracts/resolved-report-plan.js';
import type { CompositionInput, DocumentLayoutInput, PageTemplateScheduleInput, PlacementRequests } from '../contracts/input/schema.js';
import { pageGeometryFromTemplate, type PageGeometry } from '../template/geometry.js';
import { resolveReportPlan } from './legacy-plan.js';
import type { ReportCompositionResult } from '../composition/report-composition-entrypoint.js';
import { compositionDocumentFromInput } from '../composition/adapters/input.js';
import type { CompositionBox, CompositionPageChrome, CompositionPlan } from '../composition/contracts/engine-contracts.js';
import { assertReportPlan } from './legacy-plan-assertions.js';
import { installReportDrawingRecorder, type ReportDrawing } from '../artifacts/drawing-recorder.js';
import { pdfFont, readableTextColor } from '../rendering/primitives.js';
import { compileTemplateSource, type CompiledTemplate } from '../template/contracts.js';
import { resolveImageAsset } from '../rendering/image-resolver.js';
import type { SourceContext } from '../source/context.js';
import { prepareReportComposition } from './composition-runtime.js';
import type { PageTemplateSource } from '../composition/adapters/page-template.js';
import { normalizePageTemplateSchedule, templateRefAtPage } from '../composition/adapters/page-template-schedule.js';
import { normalizeDocumentLayout, pageTemplateAssignmentForPage } from '../composition/adapters/document-layout.js';
import { resolvePagePlaceholders } from '../composition/text/page-placeholders.js';
import { attachResolvedChromeSpacingReport } from '../composition/observability/spacing-report.js';

export interface TemplateInfo { name: string; description: string; }

const TEMPLATES: TemplateInfo[] = [
  { name: 'default-report', description: 'Branded A4 report rendered from named semantic flows.' },
  { name: 'campaign-summary', description: 'Compact A4 campaign summary using the same semantic flow contract.' },
  { name: 'pages/editorial-two-column', description: 'A4 editorial page with two equal text columns.' },
  { name: 'pages/editorial-dynamic-chrome', description: 'A4 editorial page with fit-content repeated header chrome.' },
  { name: 'pages/editorial-inset-two-column', description: 'A4 editorial page with a full-width intro and full-width in-text insertions between two narrative columns.' },
  { name: 'pages/editorial-metrics-two-column', description: 'A4 editorial page with KPI slots above two narrative columns.' },
  { name: 'pages/editorial-chart-two-column', description: 'A4 editorial page with a chart slot above two narrative columns.' },
  { name: 'pages/editorial-three-column', description: 'A4 editorial page with three unequal text columns.' },
  { name: 'pages/showcase-report', description: 'A4 report page with a plain header and ordinary content layout.' },
  { name: 'pages/showcase-report-band', description: 'A4 report page with a reserved header band and ordinary content layout.' },
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

function compositionGeometryForSchedule(name: string, schedule?: PageTemplateScheduleInput): { template: CompiledTemplate; geometry: PageGeometry; sources?: PageTemplateSource[] } {
  if (!schedule) return compositionGeometry(name);
  const references = [...new Set(schedule.map((entry) => entry.template_ref))];
  const sources = references.map((templateRef): PageTemplateSource => {
    const resolved = compositionGeometry(templateRef);
    return { templateRef, compiled: resolved.template, geometry: resolved.geometry };
  });
  const primary = sources[0];
  if (!primary) throw new Error('A page-template schedule needs at least one template.');
  return { template: primary.compiled, geometry: primary.geometry, sources };
}

function compositionGeometryForLayout(name: string, layout?: DocumentLayoutInput): { template: CompiledTemplate; geometry: PageGeometry; sources?: PageTemplateSource[] } {
  if (!layout) return compositionGeometry(name);
  const references = [...new Set(layout.map((entry) => entry.template))];
  const sources = references.map((templateRef): PageTemplateSource => {
    const resolved = compositionGeometry(templateRef);
    return { templateRef, compiled: resolved.template, geometry: resolved.geometry };
  });
  const primary = sources[0];
  if (!primary) throw new Error('A document layout needs at least one template.');
  return { template: primary.compiled, geometry: primary.geometry, sources };
}

function scheduledPageTemplateResolver(
  schedule: PageTemplateScheduleInput | undefined,
  sources: PageTemplateSource[] | undefined,
): ((page: number) => { templateRef: string; geometry: PageGeometry } | undefined) | undefined {
  if (!schedule || !sources) return undefined;
  const variant = normalizePageTemplateSchedule(schedule.map((entry) => ({
    pages: {
      ...(entry.pages.from === undefined ? {} : { from: entry.pages.from }),
      ...(entry.pages.to === undefined ? {} : { to: entry.pages.to }),
      ...(entry.pages.count === undefined ? {} : { count: entry.pages.count }),
    },
    templateRef: entry.template_ref,
  })))[0];
  if (!variant) return undefined;
  return (page: number) => {
    const templateRef = templateRefAtPage(variant, page);
    const source = templateRef === undefined ? undefined : sources.find((candidate) => candidate.templateRef === templateRef);
    return source ? { templateRef: source.templateRef, geometry: source.geometry } : undefined;
  };
}

function documentLayoutPageTemplateResolver(
  layout: DocumentLayoutInput | undefined,
  sources: PageTemplateSource[] | undefined,
): ((page: number) => { templateRef: string; geometry: PageGeometry } | undefined) | undefined {
  if (!layout || !sources) return undefined;
  const variant = normalizeDocumentLayout(layout)[0];
  if (!variant) return undefined;
  return (page: number) => {
    const assignment = pageTemplateAssignmentForPage(variant.entries, page);
    const source = assignment ? sources.find((candidate) => candidate.templateRef === assignment.templateRef) : undefined;
    return source ? { templateRef: source.templateRef, geometry: source.geometry } : undefined;
  };
}

async function reportLogo(theme: RenderTheme, sourceContext: SourceContext | undefined) {
  const path = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoWhitePath : theme.logoMarkPath ?? theme.logoPath;
  if (!path || !sourceContext) return undefined;
  const relativePath = relative(sourceContext.brandRoot, path).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('../')) return undefined;
  return resolveImageAsset(`brand://${relativePath}`, sourceContext);
}

async function reportHeaderImage(theme: RenderTheme, sourceContext: SourceContext | undefined) {
  const path = theme.reportHeaderImagePath;
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

function drawReportChrome(doc: jsPDF, page: number, pageCount: number, geometry: PageGeometry, theme: RenderTheme, logo: Awaited<ReturnType<typeof resolveImageAsset>> | undefined, headerImage: Awaited<ReturnType<typeof resolveImageAsset>> | undefined, brand: string | undefined, chrome: CompositionPageChrome, continuation = false, plannedLockup = false): void {
  doc.setFillColor(...rgb(theme.background));
  doc.rect(0, 0, geometry.width, geometry.height, 'F');
  const headerBandHeight = chrome.headerBand.height;
  const band = theme.reportHeaderStyle === 'accent-band' ? theme.primary : theme.reportHeaderStyle === 'dark-band' ? theme.background : undefined;
  if (band) {
    doc.setFillColor(...rgb(band));
    doc.rect(chrome.headerBand.x, chrome.headerBand.y, chrome.headerBand.width, chrome.headerBand.height, 'F');
  } else if (theme.reportHeaderStyle === 'image-band' && headerImage) {
    drawContainedImage(doc, headerImage, chrome.headerBand.x, chrome.headerBand.y, chrome.headerBand.width, chrome.headerBand.height);
  }
  if (!plannedLockup) {
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
  const pageNumber = resolvePagePlaceholders('{{page.number}} / {{page.count}}', page, pageCount);
  doc.text(pageNumber, chrome.pageNumber.x + chrome.pageNumber.width, chrome.pageNumber.y + chrome.pageNumber.height, { align: 'right' });
}

function drawCompositionDebugOverlay(doc: jsPDF, composition: ReportCompositionResult, theme: RenderTheme, geometry: PageGeometry, geometryForPage: (page: CompositionPlan['pages'][number]) => PageGeometry = () => geometry): void {
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
    const pageGeometry = geometryForPage(page);
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

export async function renderReportPdfDetailed(name: string, data: CompositionInput, theme = defaultRenderTheme(), warnings: string[] = [], sourceContext?: SourceContext, compositionDebug = false, insertionRequests?: PlacementRequests, pageTemplateSchedule?: PageTemplateScheduleInput, layout?: DocumentLayoutInput): Promise<{ buffer: Buffer; diagnostics: ReportRenderDiagnostics }> {
  const planned = await renderReportCompositionPdf(name, data, theme, sourceContext, compositionDebug, insertionRequests, pageTemplateSchedule, layout);
  for (const diagnostic of planned.composition.evaluation.diagnostics) if (diagnostic.severity === 'warning') warnings.push(diagnostic.message);
  const resolved = layout ? compositionGeometryForLayout(name, layout) : compositionGeometryForSchedule(name, pageTemplateSchedule);
  const pageTemplateForPage = (page: number) => {
    const compositionPage = planned.composition.plan.pages.find((candidate) => candidate.page === page);
    const templateRef = compositionPage?.templateRef;
    const source = templateRef === undefined ? undefined : resolved.sources?.find((candidate) => candidate.templateRef === templateRef);
    return source ? { templateRef: source.templateRef, geometry: source.geometry } : undefined;
  };
  const plan = resolveReportPlan({ templateRef: name, theme, geometry: resolved.geometry, pageCount: Math.max(1, planned.composition.plan.pages.length), compositionDocument: planned.composition.document, pageTemplateForPage });
  assertReportPlan(plan, { requireCoverage: resolved.geometry.dynamicFlow, maxCoverageGap: PDF_CONFIG.planCoverageMaxGap });
  return { buffer: planned.buffer, diagnostics: { plan, drawings: planned.drawings, composition: planned.composition } };
}

export async function renderReportPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), warnings: string[] = [], sourceContext?: SourceContext, insertionRequests?: PlacementRequests, pageTemplateSchedule?: PageTemplateScheduleInput, layout?: DocumentLayoutInput): Promise<Buffer> {
  return (await renderReportPdfDetailed(name, data, theme, warnings, sourceContext, false, insertionRequests, pageTemplateSchedule, layout)).buffer;
}

function footerTextWidth(doc: jsPDF, geometry: PageGeometry, maxPages: number, theme: RenderTheme): number {
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  const labelWidth = doc.getTextWidth(`${maxPages} / ${maxPages}`);
  const pages = [geometry];
  return Math.min(...pages.map((page) => Math.max(1, page.width - page.margins.right - page.margins.left - PDF_CONFIG.footerNumberGap - labelWidth)));
}

function dynamicHeaderBandHeight(composition: ReportCompositionResult, page: CompositionPlan['pages'][number], geometry: PageGeometry): number {
  const staticHeight = geometry.bands.header?.bottom ?? PDF_CONFIG.headerBandHeight;
  const headerSlots = composition.plan.slots.filter((slot) => slot.page === page.page && slot.flowId === 'header');
  if (!headerSlots.some((slot) => slot.fitContent)) return staticHeight;
  const contentSlots = new Set(composition.plan.flowPlacements?.filter((placement) => placement.page === page.page && placement.flowId === 'header' && placement.hasContent).map((placement) => placement.slotId) ?? []);
  const activeSlots = headerSlots.filter((slot) => slot.fitContent !== true || contentSlots.has(slot.id) || slot.kind === 'graphic');
  const contentBottom = activeSlots.reduce((bottom, slot) => Math.max(bottom, slot.box.y + slot.box.height), 0);
  // The rule is drawn `headerBottomGap` above the band bottom. Reserve a
  // second configured gap below the measured header so the title never
  // touches the rule.
  return contentBottom > 0 ? contentBottom + PDF_CONFIG.headerBottomGap * 2 : staticHeight;
}

function pageChrome(doc: jsPDF, page: CompositionPlan['pages'][number], pageCount: number, geometry: PageGeometry, theme: RenderTheme, lockup?: CompositionBox, headerHeight?: number): CompositionPageChrome {
  const headerBandHeight = headerHeight ?? geometry.bands.header?.bottom ?? PDF_CONFIG.headerBandHeight;
  const headerBand: CompositionBox = { x: 0, y: 0, width: page.width, height: headerBandHeight };
  const headerRuleY = headerBandHeight - PDF_CONFIG.headerBottomGap;
  const headerRule = theme.reportHeaderStyle === 'accent-band' || theme.reportHeaderStyle === 'dark-band' || theme.reportHeaderStyle === 'image-band'
    ? undefined
    : { x: PDF_CONFIG.margin, y: headerRuleY, width: page.width - PDF_CONFIG.margin * 2, height: PDF_CONFIG.headerRuleWidth };
  const footerTop = geometry.bands.footer?.top ?? PDF_CONFIG.footerY - PDF_CONFIG.footerFontSize;
  const footerRule: CompositionBox = { x: PDF_CONFIG.margin, y: footerTop, width: page.width - PDF_CONFIG.margin * 2, height: PDF_CONFIG.footerLineWidth };
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  const pageNumberText = resolvePagePlaceholders('{{page.number}} / {{page.count}}', page.page, pageCount);
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

function attachPageChrome(doc: jsPDF, composition: ReportCompositionResult, geometry: PageGeometry, theme: RenderTheme, geometryForPage: (page: CompositionPlan['pages'][number]) => PageGeometry = () => geometry): void {
  for (const page of composition.plan.pages) {
    const pageGeometry = geometryForPage(page);
    const lockup = composition.plan.slots.find((slot) => slot.page === page.page && slot.id === `${page.page}:header-lockup`);
    page.chrome = pageChrome(doc, page, composition.plan.pages.length, pageGeometry, theme, lockup?.box, dynamicHeaderBandHeight(composition, page, pageGeometry));
  }
  attachResolvedChromeSpacingReport(composition.plan);
}

export async function renderReportCompositionPdf(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext, compositionDebug = false, insertionRequests?: PlacementRequests, pageTemplateSchedule?: PageTemplateScheduleInput, layout?: DocumentLayoutInput): Promise<{ buffer: Buffer; composition: ReportCompositionResult; drawings: ReportDrawing[] }> {
  if (layout && pageTemplateSchedule) throw new Error('A report render accepts `layout` or the legacy page-template schedule, not both.');
  const resolved = layout ? compositionGeometryForLayout(name, layout) : compositionGeometryForSchedule(name, pageTemplateSchedule);
  const prepared = await prepareReportComposition({ name, data, theme, sourceContext, template: resolved.template, geometry: resolved.geometry, ...(resolved.sources ? { pageTemplateSources: resolved.sources } : {}), ...(layout ? { layout } : {}), ...(pageTemplateSchedule ? { pageTemplateSchedule } : {}), ...(insertionRequests ? { insertionRequests } : {}) });
  const geometryForPage = (page: CompositionPlan['pages'][number]): PageGeometry => resolved.sources?.find((source) => source.templateRef === page.templateRef)?.geometry ?? prepared.geometry;
  attachPageChrome(prepared.doc, prepared.composition, prepared.geometry, theme, geometryForPage);
  const { doc, geometry, template, composition, drawings } = prepared;
  const logo = await reportLogo(theme, sourceContext);
  const headerImage = await reportHeaderImage(theme, sourceContext);
  for (const page of composition.plan.pages) {
    if (doc.getNumberOfPages() < page.page) doc.addPage([page.width, page.height]);
    doc.setPage(page.page);
    const pageGeometry = geometryForPage(page);
    // Reserve the title-page surface only when the input actually contains a
    // title flow. A template may support a title page, but a content-only
    // report still needs the normal report chrome on page one.
    if (!(template.pageTitle && composition.document.flows.title && page.page === 1)) {
      const chrome = composition.plan.pages[page.page - 1].chrome;
      if (!chrome) throw new Error(`Composition plan has no chrome geometry for page ${page.page}.`);
      const plannedLockup = composition.plan.blockPlacements.some((placement) => placement.page === page.page && placement.kind === 'lockup');
      drawReportChrome(doc, page.page, composition.plan.pages.length, pageGeometry, theme, logo, headerImage, theme.brandName, chrome, false, plannedLockup);
    }
  }
  if (compositionDebug) drawCompositionDebugOverlay(doc, composition, theme, geometry, geometryForPage);
  prepared.render();
  return { buffer: Buffer.from(doc.output('arraybuffer')), composition, drawings };
}

export function resolveReportPlanOnly(name: string, data: CompositionInput, theme = defaultRenderTheme(), pageTemplateSchedule?: PageTemplateScheduleInput, layout?: DocumentLayoutInput): ResolvedReportPlan {
  if (layout && pageTemplateSchedule) throw new Error('A report plan accepts `layout` or the legacy page-template schedule, not both.');
  const resolved = layout ? compositionGeometryForLayout(name, layout) : compositionGeometryForSchedule(name, pageTemplateSchedule);
  const pageTemplateForPage = layout
    ? documentLayoutPageTemplateResolver(layout, resolved.sources)
    : scheduledPageTemplateResolver(pageTemplateSchedule, resolved.sources);
  const plan = resolveReportPlan({ templateRef: name, theme, geometry: resolved.geometry, pageCount: 1, compositionDocument: compositionDocumentFromInput(data), ...(pageTemplateForPage ? { pageTemplateForPage } : {}) });
  assertReportPlan(plan, { requireCoverage: resolved.geometry.dynamicFlow, maxCoverageGap: PDF_CONFIG.planCoverageMaxGap });
  return plan;
}

/**
 * Plan the same composition used by renderReportCompositionPdf, without
 * drawing content or producing a PDF buffer. This is the dry-run seam: the
 * jsPDF instance exists only to provide the real font metrics used by the
 * planner.
 */
export async function resolveReportCompositionOnly(name: string, data: CompositionInput, theme = defaultRenderTheme(), sourceContext?: SourceContext, insertionRequests?: PlacementRequests, pageTemplateSchedule?: PageTemplateScheduleInput, layout?: DocumentLayoutInput): Promise<ReportCompositionResult> {
  if (layout && pageTemplateSchedule) throw new Error('A report composition accepts `layout` or the legacy page-template schedule, not both.');
  const resolved = layout ? compositionGeometryForLayout(name, layout) : compositionGeometryForSchedule(name, pageTemplateSchedule);
  const prepared = await prepareReportComposition({ name, data, theme, sourceContext, template: resolved.template, geometry: resolved.geometry, rejectOnEvaluation: false, ...(resolved.sources ? { pageTemplateSources: resolved.sources } : {}), ...(layout ? { layout } : {}), ...(pageTemplateSchedule ? { pageTemplateSchedule } : {}), ...(insertionRequests ? { insertionRequests } : {}) });
  const geometryForPage = (page: CompositionPlan['pages'][number]): PageGeometry => resolved.sources?.find((source) => source.templateRef === page.templateRef)?.geometry ?? prepared.geometry;
  attachPageChrome(prepared.doc, prepared.composition, prepared.geometry, theme, geometryForPage);
  return prepared.composition;
}
