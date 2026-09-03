import type { jsPDF } from 'jspdf';
import { readRenderConfig } from '../builtin-template-source.js';
import type { PageGeometry } from '../page-geometry.js';
import type { CompositionInput } from '../contract/schema.js';
import type { CompiledTemplate } from '../template-contract.js';
import type { CompositionTemplate } from './model.js';
import type { CompositionEvaluation, CompositionPlan, CompositionTextMetrics } from './engine.js';
import type { CompositionContrastProvider } from './contrast.js';
import { compositionDocumentFromInput } from './input.js';
import { compositionTemplateFromPageGeometry } from './page-template-adapter.js';
import {
  createJsPdfTextMetrics,
  type JsPdfCompositionStyle,
  type JsPdfCompositionChartStyle,
  type JsPdfCompositionMetricStyle,
  type JsPdfCompositionTableStyle,
  type JsPdfCompositionImageStyle,
  type JsPdfCompositionStyles,
} from './js-pdf-adapter.js';
import { createTextCompositionEngine } from './text-engine.js';
import type { TextCompositionPlannerPolicy } from './text-planner.js';

export interface ReportCompositionOptions {
  family: string;
  maxPages: number;
  includeTitlePage?: boolean;
  includeHeaderFlow?: boolean;
  mainFlowId?: string;
  auxiliaryTextWidths?: Record<string, number>;
  policy?: TextCompositionPlannerPolicy;
  styles?: JsPdfCompositionStyles;
  measureBlock?: CompositionTextMetrics['measureBlock'];
  measureTable?: CompositionTextMetrics['measureTable'];
  contrastProvider?: CompositionContrastProvider;
}

export interface ReportCompositionResult {
  document: ReturnType<typeof compositionDocumentFromInput>;
  template: CompositionTemplate;
  metrics: CompositionTextMetrics;
  plan: CompositionPlan;
  evaluation: CompositionEvaluation;
}

function pdfNumber(pdf: Record<string, number>, key: string): number {
  const value = pdf[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite pdf.${key}.`);
  return value;
}

/**
 * Keep the composition shadow on the same typography seam as the report
 * renderer. The planner receives measured widths from jsPDF, while every
 * tunable size, line height and baseline offset comes from render-config.yml.
 */
export interface CompositionTextColors {
  foreground: [number, number, number];
  muted: [number, number, number];
  primary: [number, number, number];
  quote?: [number, number, number];
  /** Color used by title metadata on a contrasting report header surface. */
  subtitle?: [number, number, number];
  eyebrow?: [number, number, number];
}

export function compositionStylesFromRenderConfig(colors?: CompositionTextColors, titleCase: 'normal' | 'upper' = 'normal', glyphFontFamily?: string): JsPdfCompositionStyles {
  const pdf = readRenderConfig().pdf;
  const textColor = (color: [number, number, number] | undefined) => color === undefined ? {} : { textColor: color };
  const body: JsPdfCompositionStyle = {
    fontSize: pdfNumber(pdf, 'bodySize'),
    lineHeight: pdfNumber(pdf, 'bodyLineHeight'),
    baselineOffset: pdfNumber(pdf, 'bodyBaselineOffset'),
    fontStyle: 'normal',
    marginBefore: pdfNumber(pdf, 'bodyMarginBefore'),
    marginAfter: pdfNumber(pdf, 'bodyMarginAfter'),
    ...textColor(colors?.foreground),
  };
  return {
    body,
    'list-item': {
      ...body,
      marginBefore: pdfNumber(pdf, 'listItemMarginBefore'),
      marginAfter: pdfNumber(pdf, 'listItemMarginAfter'),
      lineHeight: pdfNumber(pdf, 'bodyLineHeight') + pdfNumber(pdf, 'highlightLineGap'),
      ...(colors?.primary === undefined ? {} : {
        textIndent: pdfNumber(pdf, 'highlightIndent'),
        marker: {
          x: pdfNumber(pdf, 'highlightBulletX'),
          y: pdfNumber(pdf, 'highlightBulletY'),
          radius: pdfNumber(pdf, 'highlightBulletRadius'),
          color: colors.primary,
        },
      }),
    },
    title: {
      fontSize: pdfNumber(pdf, 'headerTitleSize'),
      lineHeight: pdfNumber(pdf, 'headerTitleLineHeight'),
      baselineOffset: pdfNumber(pdf, 'headerTextBaselineOffset'),
      fontStyle: 'bold',
      ...(titleCase === 'upper' ? { textTransform: 'uppercase' as const } : {}),
      ...textColor(colors?.foreground),
    },
    subtitle: {
      fontSize: pdfNumber(pdf, 'headerSubtitleSize'),
      lineHeight: pdfNumber(pdf, 'headerSubtitleLineHeight'),
      baselineOffset: pdfNumber(pdf, 'headerTextBaselineOffset'),
      fontStyle: 'normal',
      ...textColor(colors?.subtitle ?? colors?.muted),
    },
    eyebrow: {
      fontSize: pdfNumber(pdf, 'headerPeriodSize'),
      lineHeight: pdfNumber(pdf, 'headerSubtitleLineHeight'),
      baselineOffset: pdfNumber(pdf, 'headerTextBaselineOffset'),
      fontStyle: 'normal',
      ...textColor(colors?.eyebrow ?? colors?.muted),
    },
    header: {
      fontSize: pdfNumber(pdf, 'headerSubtitleSize'),
      lineHeight: pdfNumber(pdf, 'headerSubtitleLineHeight'),
      baselineOffset: pdfNumber(pdf, 'headerBaselineOffset'),
      fontStyle: 'normal',
      marginBefore: pdfNumber(pdf, 'headerMarginBefore'),
      marginAfter: pdfNumber(pdf, 'headerMarginAfter'),
      ...textColor(colors?.foreground),
    },
    heading: {
      fontSize: pdfNumber(pdf, 'sectionHeadingSize'),
      lineHeight: pdfNumber(pdf, 'sectionHeadingLineHeight'),
      baselineOffset: pdfNumber(pdf, 'headingBaselineOffset'),
      fontStyle: 'bold',
      marginBefore: pdfNumber(pdf, 'headingMarginBefore'),
      marginAfter: pdfNumber(pdf, 'headingMarginAfter'),
      ...textColor(colors?.foreground),
    },
    intro: {
      fontSize: pdfNumber(pdf, 'bodySize'),
      lineHeight: pdfNumber(pdf, 'introLineHeight'),
      baselineOffset: pdfNumber(pdf, 'introBaselineOffset'),
      fontStyle: 'normal',
      marginAfter: pdfNumber(pdf, 'bodyMarginAfter'),
      ...textColor(colors?.foreground),
    },
    quote: {
      fontSize: pdfNumber(pdf, 'quoteSize'),
      lineHeight: pdfNumber(pdf, 'quoteLineHeight'),
      baselineOffset: pdfNumber(pdf, 'quoteBaselineOffset'),
      fontStyle: 'normal',
      textIndent: pdfNumber(pdf, 'quoteTextIndent'),
      paddingTop: pdfNumber(pdf, 'quotePaddingTop'),
      paddingBottom: pdfNumber(pdf, 'quotePaddingBottom'),
      marginBefore: pdfNumber(pdf, 'quoteMarginBefore'),
      marginAfter: pdfNumber(pdf, 'quoteMarginAfter'),
      ...((colors?.quote ?? colors?.primary) === undefined ? {} : {
        quoteMarks: {
          open: '“',
          close: '”',
          size: pdfNumber(pdf, 'quoteMarkSize'),
          gap: pdfNumber(pdf, 'quoteMarkGap'),
          baselineOffset: pdfNumber(pdf, 'quoteMarkBaselineOffset'),
          color: colors!.quote ?? colors!.primary!,
        },
      }),
      ...textColor(colors?.quote ?? colors?.primary ?? colors?.foreground),
    },
    'quote-mark': {
      fontSize: pdfNumber(pdf, 'quoteMarkSize'),
      lineHeight: pdfNumber(pdf, 'quoteLineHeight'),
      baselineOffset: pdfNumber(pdf, 'quoteMarkBaselineOffset'),
      fontStyle: 'bold',
      ...(glyphFontFamily === undefined ? {} : { fontFamily: glyphFontFamily }),
      ...textColor(colors?.quote ?? colors?.primary ?? colors?.foreground),
    },
    sidebar: {
      ...body,
      baselineOffset: pdfNumber(pdf, 'sidebarBaselineOffset'),
      ...textColor(colors?.foreground),
    },
    footer: {
      fontSize: pdfNumber(pdf, 'footerFontSize'),
      lineHeight: pdfNumber(pdf, 'footerTextLineHeight'),
      baselineOffset: pdfNumber(pdf, 'footerBaselineOffset'),
      fontStyle: 'normal',
      ...textColor(colors?.muted),
    },
  };
}

export interface CompositionMetricColors {
  fillColor: [number, number, number];
  drawColor: [number, number, number];
  labelColor: [number, number, number];
  valueColor: [number, number, number];
  deltaColor: [number, number, number];
  noteColor?: [number, number, number];
  trendUpColor?: [number, number, number];
  trendDownColor?: [number, number, number];
  trendFlatColor?: [number, number, number];
}

export interface CompositionChartColors {
  fillColor: [number, number, number];
  drawColor: [number, number, number];
  foregroundColor: [number, number, number];
  mutedColor: [number, number, number];
  gridColor: [number, number, number];
  palette: Array<[number, number, number]>;
}

export interface CompositionTableColors {
  headerFillColor: [number, number, number];
  headerTextColor: [number, number, number];
  rowFillColor: [number, number, number];
  alternateRowFillColor: [number, number, number];
  textColor: [number, number, number];
  lineColor: [number, number, number];
}

/**
 * Keep metric geometry in render-config.yml while allowing the brand/theme to
 * provide only colors. This object can be passed to the jsPDF metric
 * capability without leaking render-config knowledge into the adapter.
 */
export function compositionMetricStyleFromRenderConfig(colors: CompositionMetricColors): JsPdfCompositionMetricStyle {
  const pdf = readRenderConfig().pdf;
  return {
    ...colors,
    noteColor: colors.noteColor ?? colors.deltaColor,
    trendUpColor: colors.trendUpColor ?? colors.deltaColor,
    trendDownColor: colors.trendDownColor ?? colors.deltaColor,
    trendFlatColor: colors.trendFlatColor ?? colors.deltaColor,
    radius: pdfNumber(pdf, 'kpiRadius'),
    lineWidth: pdfNumber(pdf, 'kpiLineWidth'),
    padding: pdfNumber(pdf, 'kpiPadding'),
    labelY: pdfNumber(pdf, 'kpiLabelY'),
    valueY: pdfNumber(pdf, 'kpiValueY'),
    deltaY: pdfNumber(pdf, 'kpiDeltaY'),
    noteY: pdfNumber(pdf, 'compositionMetricNoteY'),
    height: pdfNumber(pdf, 'compositionMetricHeight'),
    labelSize: pdfNumber(pdf, 'kpiLabelSize'),
    valueSize: pdfNumber(pdf, 'kpiValueSize'),
    deltaSize: pdfNumber(pdf, 'kpiDeltaSize'),
    noteSize: pdfNumber(pdf, 'kpiNoteSize'),
  };
}

/** Keep chart geometry in render-config.yml; a brand supplies only colors. */
export function compositionChartStyleFromRenderConfig(colors: CompositionChartColors): JsPdfCompositionChartStyle {
  const chart = readRenderConfig().chart;
  const chartNumber = (key: string): number => {
    const value = chart[key];
    if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite chart.${key}.`);
    return value;
  };
  return {
    ...colors,
    width: chartNumber('width'),
    height: chartNumber('height'),
    renderWidth: chartNumber('renderWidth'),
    headerTitleY: chartNumber('headerTitleY'),
    headerTitleSize: chartNumber('headerTitleSize'),
    headerSubtitleSize: chartNumber('headerSubtitleSize'),
    headerTitleGap: chartNumber('headerTitleGap'),
    headerBottomGap: chartNumber('headerBottomGap'),
    headerX: chartNumber('headerX'),
    headerEmptyTop: chartNumber('headerEmptyTop'),
    padLeft: chartNumber('padLeft'),
    padRight: chartNumber('padRight'),
    padBottom: chartNumber('padBottom'),
    ticks: chartNumber('ticks'),
    barRadius: chartNumber('barRadius'),
    valueOffset: chartNumber('valueOffset'),
    lineWidth: chartNumber('lineWidth'),
    pointRadius: chartNumber('pointRadius'),
    textSize: chartNumber('textSize'),
    barSlotRatio: chartNumber('barSlotRatio'),
    barMaxWidth: chartNumber('barMaxWidth'),
    barValueSize: chartNumber('barValueSize'),
    barLabelSize: chartNumber('barLabelSize'),
    barLabelGap: chartNumber('barLabelGap'),
    lineAreaOpacity: chartNumber('lineAreaOpacity'),
    tickLabelOffset: chartNumber('tickLabelOffset'),
    tickLabelBaseline: chartNumber('tickLabelBaseline'),
    tickLabelSize: chartNumber('tickLabelSize'),
    gridLineWidth: chartNumber('gridLineWidth'),
    lineLabelGap: chartNumber('lineLabelGap'),
    lineLabelSize: chartNumber('lineLabelSize'),
    lineValueOffset: chartNumber('lineValueOffset'),
    lineValueSize: chartNumber('lineValueSize'),
    minimumFontSize: chartNumber('minimumFontSize'),
    linePointStrokeWidth: chartNumber('linePointStrokeWidth'),
  };
}

export function compositionTableStyleFromRenderConfig(colors: CompositionTableColors): JsPdfCompositionTableStyle {
  const pdf = readRenderConfig().pdf;
  return {
    ...colors,
    fontSize: pdfNumber(pdf, 'tableFontSize'),
    lineHeightRatio: pdfNumber(pdf, 'tableLineHeightRatio'),
    cellPadding: pdfNumber(pdf, 'tableCellPadding'),
    lineWidth: pdfNumber(pdf, 'tableLineWidth'),
    maxRowsPerFragment: Math.max(1, Math.floor(pdfNumber(pdf, 'tableFlowMaxRows'))),
  };
}

export function compositionImageStyleFromRenderConfig(overrides: Partial<JsPdfCompositionImageStyle> = {}): JsPdfCompositionImageStyle {
  const pdf = readRenderConfig().pdf;
  return {
    captionGap: pdfNumber(pdf, 'imageCaptionGap'),
    captionBottomGap: pdfNumber(pdf, 'imageCaptionBottomGap'),
    captionLineHeight: pdfNumber(pdf, 'imageCaptionLineHeight'),
    captionBaselineOffset: pdfNumber(pdf, 'imageCaptionBaselineOffset'),
    captionSize: pdfNumber(pdf, 'imageCaptionSize'),
    captionPaddingX: pdfNumber(pdf, 'imageCaptionPaddingX'),
    captionAlign: 'center',
    ...overrides,
  };
}

export function compositionPdfBackendOptionsFromRenderConfig(): { pageSizeTolerance: number } {
  return { pageSizeTolerance: pdfNumber(readRenderConfig().pdf, 'pageSizeTolerance') };
}

/**
 * Build a renderer-neutral plan for real Report Baby input using real jsPDF
 * text measurements. The planner does not draw; a selected PDF backend later
 * executes the accepted placements. The file keeps its historical name while
 * the prototype harness is being migrated.
 */
export function planReportComposition(
  doc: jsPDF,
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  data: CompositionInput,
  options: ReportCompositionOptions,
): ReportCompositionResult {
  const document = compositionDocumentFromInput(data);
  const template = compositionTemplateFromPageGeometry(compiled, geometry, {
    maxPages: options.maxPages,
    ...(options.includeTitlePage === undefined ? {} : { includeTitlePage: options.includeTitlePage }),
    includeHeaderFlow: options.includeHeaderFlow ?? true,
    ...(options.mainFlowId === undefined ? {} : { mainFlowId: options.mainFlowId }),
    ...(options.auxiliaryTextWidths === undefined ? {} : { auxiliaryTextWidths: options.auxiliaryTextWidths }),
  });
  const styles = options.styles ?? compositionStylesFromRenderConfig();
  const metrics = createJsPdfTextMetrics(doc, options.family, styles);
  if (options.measureBlock) metrics.measureBlock = options.measureBlock;
  if (options.measureTable) metrics.measureTable = options.measureTable;
  const policy: TextCompositionPlannerPolicy = {
    headingKeepWithNextLines: pdfNumber(readRenderConfig().pdf, 'headingKeepWithNextLines'),
    minimumLinesAtStart: pdfNumber(readRenderConfig().pdf, 'widowMinLines'),
    minimumLinesAtEnd: pdfNumber(readRenderConfig().pdf, 'orphanMinLines'),
    maxPlanningIterations: pdfNumber(readRenderConfig().pdf, 'plannerMaxIterations'),
    minimumFragmentLines: pdfNumber(readRenderConfig().pdf, 'plannerMinimumFragmentLines'),
    geometryTolerance: pdfNumber(readRenderConfig().pdf, 'compositionGeometryTolerance'),
    keepListItemsTogether: pdfNumber(readRenderConfig().pdf, 'listItemKeepTogether') === 1,
    ...options.policy,
  };
  const result = createTextCompositionEngine(template, policy, options.contrastProvider ? { contrastProvider: options.contrastProvider } : {}).plan(document, metrics);
  return { document, template, metrics, plan: result.plan, evaluation: result.evaluation };
}

/** Compatibility names retained for the prototype harness. */
export type ReportCompositionShadowOptions = ReportCompositionOptions;
export type ReportCompositionShadowResult = ReportCompositionResult;

export function planReportCompositionShadow(
  doc: jsPDF,
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  data: CompositionInput,
  options: ReportCompositionShadowOptions,
): ReportCompositionShadowResult {
  return planReportComposition(doc, compiled, geometry, data, options);
}
