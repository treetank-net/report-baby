import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionBlockKind } from '../model.js';
import type { CompositionPlan, CompositionTextMetrics } from '../engine.js';

export interface JsPdfCompositionStyle {
  fontSize: number;
  lineHeight: number;
  baselineOffset: number;
  fontStyle: 'normal' | 'bold';
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
  blockRenderers?: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>>;
  tableRenderer?: JsPdfCompositionTableRenderer;
}
