import type { jsPDF } from 'jspdf';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import type { RenderTheme } from '../contracts/render-theme.js';
import type { CompositionInput } from '../contracts/input/schema.js';
import { readRenderConfig } from '../template/builtins.js';
import type { PageGeometry } from '../template/geometry.js';
import type { CompiledTemplate } from '../template/contracts.js';
import type { ReportCompositionResult } from '../composition/report-composition-entrypoint.js';
import {
  compositionChartStyleFromRenderConfig,
  compositionGraphicStyleFromRenderConfig,
  compositionImageStyleFromRenderConfig,
  compositionMetricStyleFromRenderConfig,
  compositionPdfBackendOptionsFromRenderConfig,
  compositionStylesFromRenderConfig,
  compositionTableStyleFromRenderConfig,
  planReportComposition,
} from '../composition/report-composition-entrypoint.js';
import { createCompositionContrastProvider } from '../composition/evaluation/contrast.js';
import { compositionDocumentFromInput } from '../composition/adapters/input.js';
import {
  combineJsPdfCompositionBlockCapabilities,
  createJsPdfTextBackend,
} from '../composition/adapters/pdf/backend.js';
import { createJsPdfChartBlockCapabilities } from '../composition/adapters/pdf/chart.js';
import { createJsPdfImageBlockCapabilities } from '../composition/adapters/pdf/image.js';
import { createJsPdfMetricBlockCapabilities } from '../composition/adapters/pdf/metric.js';
import { createJsPdfTableBlockCapabilities } from '../composition/adapters/pdf/table.js';
import type { CompositionBlockKind } from '../composition/contracts/model.js';
import type { JsPdfCompositionBlockCapability } from '../composition/contracts/pdf.js';
import { renderComposition } from '../composition/composition-engine.js';
import { resolveImageAsset } from '../rendering/image-resolver.js';
import { decodePngDataUri } from '../rendering/image-raster.js';
import { installReportDrawingRecorder, type ReportDrawing } from '../artifacts/drawing-recorder.js';
import { loadRenderFontSet, newPdf, pdfFont, readableTextColor } from '../rendering/primitives.js';
import type { SourceContext } from '../source/context.js';

const RENDER_CONFIG = readRenderConfig();
const PDF_CONFIG = RENDER_CONFIG.pdf;
const PT_TO_PX = RENDER_CONFIG.canvas.width / RENDER_CONFIG.canvas.pptxWidth / RENDER_CONFIG.canvas.pointsPerInch;

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function configNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Render configuration is missing finite ${key}.`);
  return value;
}

function compositionTextCorpusSeed(document: ReturnType<typeof compositionDocumentFromInput>): string {
  const corpus = Object.values(document.flows)
    .flatMap((flow) => flow.blocks.map((block) => block.text ?? ''))
    .join('\u241e');
  return createHash('sha1').update(corpus).digest('hex');
}

function footerTextWidth(doc: jsPDF, geometry: PageGeometry, maxPages: number, theme: RenderTheme): number {
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.footerFontSize);
  const labelWidth = doc.getTextWidth(`${maxPages} / ${maxPages}`);
  const pages = [geometry, ...(geometry.continuation ? [geometry.continuation] : [])];
  return Math.min(...pages.map((page) => Math.max(1, page.width - page.margins.right - page.margins.left - PDF_CONFIG.footerNumberGap - labelWidth)));
}

export interface PreparedReportComposition {
  doc: jsPDF;
  geometry: PageGeometry;
  template: CompiledTemplate;
  composition: ReportCompositionResult;
  drawings: ReportDrawing[];
  render: () => void;
}

export interface ReportCompositionRuntimeOptions {
  name: string;
  data: CompositionInput;
  theme: RenderTheme;
  sourceContext?: SourceContext;
  template: CompiledTemplate;
  geometry: PageGeometry;
  rejectOnEvaluation?: boolean;
}

/**
 * Prepare the composition runtime used by the report renderer.
 *
 * This module owns report-specific resource preparation: fonts, assets,
 * contrast input, block capabilities, styles, planning and the backend
 * closure. The report renderer remains responsible for chrome and final PDF
 * orchestration; the renderer-neutral planner remains behind its entrypoint.
 */
export async function prepareReportComposition(options: ReportCompositionRuntimeOptions): Promise<PreparedReportComposition> {
  const { name, data, theme, sourceContext, template, geometry } = options;
  const fontSet = await loadRenderFontSet(theme);
  const doc = newPdf('portrait', [geometry.width, geometry.height], fontSet);
  const family = pdfFont(theme);
  const drawings: ReportDrawing[] = [];
  installReportDrawingRecorder(doc, drawings);
  const maxPages = configNumber(PDF_CONFIG.compositionMaxPages, 'pdf.composition_max_pages');
  const footerTop = geometry.bands.footer?.top ?? PDF_CONFIG.footerY;
  const planGeometry: PageGeometry = {
    ...geometry,
    bands: { ...geometry.bands, footer: geometry.bands.footer ? { ...geometry.bands.footer, top: footerTop } : { x: 0, top: footerTop, width: geometry.width, bottom: geometry.height } },
    continuationTop: geometry.continuationTop ?? PDF_CONFIG.headerRepeatHeight + PDF_CONFIG.headerRepeatBottomGap,
    continuationBottom: geometry.continuationBottom ?? footerTop,
  };
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
  const composition = planReportComposition(doc, template, planGeometry, data, {
    family,
    maxPages,
    includeTitlePage: Boolean(data.flows.title && template.pageTitle),
    includeHeaderFlow: Boolean(data.flows.header),
    auxiliaryTextWidths: { footer: footerTextWidth(doc, geometry, maxPages, theme) },
    policy: { minimumWrapWidth: PDF_CONFIG.floatMinWidth },
    styles: compositionStyles,
    ...(combined ? { measureBlock: combined.measureBlock } : {}),
    ...(tableCapabilities ? { measureTable: tableCapabilities.measureTable } : {}),
    ...(contrastProvider ? { contrastProvider } : {}),
  });
  if (options.rejectOnEvaluation !== false && composition.evaluation.status === 'rejected') {
    const details = composition.evaluation.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`Composition plan rejected for '${name}': ${details}`);
  }
  const render = (): void => {
    renderComposition(composition.document, composition, createJsPdfTextBackend(doc, family, compositionStyles, {
      ...compositionPdfBackendOptionsFromRenderConfig(),
      ...(resolvedImages.size > 0 ? { imageAssets: resolvedImages } : {}),
      ...(composition.plan.graphicPlacements.some((graphic) => graphic.paint !== false) ? { graphicStyle: compositionGraphicStyleFromRenderConfig({ fillColor: rgb(theme.soft), drawColor: rgb(theme.line) }) } : {}),
      ...(combined ? { blockRenderers: combined.blockRenderers } : {}),
      ...(tableCapabilities ? { tableRenderer: tableCapabilities.renderer } : {}),
    }));
  };
  return { doc, geometry, template, composition, drawings, render };
}
