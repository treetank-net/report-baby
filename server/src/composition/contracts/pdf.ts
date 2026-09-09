import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionBlockKind, CompositionInlineRun } from './model.js';
import type { CompositionPlan, CompositionTextMetrics } from './engine-contracts.js';

export interface JsPdfCompositionStyle {
  fontSize: number;
  lineHeight: number;
  baselineOffset: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic';
  fontFamily?: string;
  textColor?: [number, number, number];
  textTransform?: 'uppercase';
  textIndent?: number;
  paddingTop?: number;
  paddingBottom?: number;
  marginBefore?: number;
  marginAfter?: number;
  quoteMarks?: {
    open: string;
    close: string;
    size: number;
    gap: number;
    baselineOffset: number;
    color: [number, number, number];
  };
  marker?: {
    x: number;
    y: number;
    radius: number;
    color: [number, number, number];
  };
}

export type JsPdfCompositionStyles = Record<string, JsPdfCompositionStyle>;

/** Apply inline semantic marks without making the planner depend on jsPDF. */
export function styleForInlineRun(style: JsPdfCompositionStyle, run?: CompositionInlineRun): JsPdfCompositionStyle {
  if (!run || run.marks.length === 0) return style;
  const bold = style.fontStyle === 'bold' || style.fontStyle === 'bolditalic' || run.marks.includes('strong');
  const italic = style.fontStyle === 'italic' || style.fontStyle === 'bolditalic' || run.marks.includes('emphasis');
  const fontStyle = bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
  return fontStyle === style.fontStyle ? style : { ...style, fontStyle };
}

export interface JsPdfCompositionGraphicStyle {
  fillColor: [number, number, number];
  drawColor: [number, number, number];
  lineWidth: number;
}

export interface JsPdfCompositionMetricStyle {
  fillColor: [number, number, number];
  drawColor: [number, number, number];
  labelColor: [number, number, number];
  valueColor: [number, number, number];
  deltaColor: [number, number, number];
  noteColor: [number, number, number];
  trendUpColor: [number, number, number];
  trendDownColor: [number, number, number];
  trendFlatColor: [number, number, number];
  radius: number;
  lineWidth: number;
  padding: number;
  labelY: number;
  valueY: number;
  deltaY: number;
  noteY: number;
  height: number;
  labelSize: number;
  valueSize: number;
  deltaSize: number;
  noteSize: number;
}

export interface JsPdfCompositionChartStyle {
  fillColor: [number, number, number];
  drawColor: [number, number, number];
  foregroundColor: [number, number, number];
  mutedColor: [number, number, number];
  gridColor: [number, number, number];
  palette: Array<[number, number, number]>;
  width: number;
  height: number;
  renderWidth: number;
  headerTitleY: number;
  headerTitleSize: number;
  headerSubtitleSize: number;
  headerTitleGap: number;
  headerBottomGap: number;
  headerX: number;
  headerEmptyTop: number;
  padLeft: number;
  padRight: number;
  padBottom: number;
  ticks: number;
  barRadius: number;
  valueOffset: number;
  lineWidth: number;
  pointRadius: number;
  textSize: number;
  barSlotRatio: number;
  barMaxWidth: number;
  barValueSize: number;
  barLabelSize: number;
  barLabelGap: number;
  lineAreaOpacity: number;
  linePointStrokeWidth: number;
  tickLabelOffset: number;
  tickLabelBaseline: number;
  tickLabelSize: number;
  gridLineWidth: number;
  lineLabelGap: number;
  lineLabelSize: number;
  lineValueOffset: number;
  lineValueSize: number;
  minimumFontSize?: number;
}

export interface JsPdfCompositionTableStyle {
  headerFillColor: [number, number, number];
  headerTextColor: [number, number, number];
  rowFillColor: [number, number, number];
  alternateRowFillColor: [number, number, number];
  textColor: [number, number, number];
  lineColor: [number, number, number];
  fontSize: number;
  lineHeightRatio: number;
  cellPadding: number;
  lineWidth: number;
  maxRowsPerFragment: number;
}

export interface JsPdfCompositionImageAsset {
  data: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

export interface JsPdfCompositionImageStyle {
  captionGap: number;
  captionBottomGap: number;
  captionLineHeight: number;
  captionBaselineOffset: number;
  captionSize: number;
  captionPaddingX: number;
  captionAlign?: 'left' | 'center' | 'right';
  chart?: JsPdfCompositionChartStyle;
}

export interface JsPdfCompositionLockupStyle {
  markWidth: number;
  maxHeight: number;
  gap: number;
  nameSize: number;
  textColor: [number, number, number];
  verticalAlign: 'top' | 'middle' | 'bottom';
}

export type JsPdfCompositionBlockRenderer = (
  doc: jsPDF,
  block: CompositionBlock,
  placement: CompositionPlan['blockPlacements'][number],
) => void;

export type JsPdfCompositionTableRenderer = (
  doc: jsPDF,
  block: CompositionBlock,
  placement: CompositionPlan['tablePlacements'][number],
) => void;

export type JsPdfCompositionImageRenderer = (
  doc: jsPDF,
  block: CompositionBlock,
  placement: CompositionPlan['blockPlacements'][number],
) => void;

export interface JsPdfCompositionBlockCapability {
  measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>;
  renderer: JsPdfCompositionBlockRenderer;
}

export interface JsPdfCompositionBackendOptions {
  pageSizeTolerance: number;
  graphicStyle?: JsPdfCompositionGraphicStyle;
  imageAssets?: ReadonlyMap<string, JsPdfCompositionImageAsset>;
  inlineFontCoverage?: JsPdfInlineFontCoverage;
  blockRenderers?: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>>;
  tableRenderer?: JsPdfCompositionTableRenderer;
}

export interface JsPdfInlineFontCoverage {
  family: string;
  regular?: Set<number>;
  bold?: Set<number>;
}
