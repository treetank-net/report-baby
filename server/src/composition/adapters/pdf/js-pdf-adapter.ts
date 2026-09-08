import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionBlockKind, CompositionChart, CompositionDocument, CompositionTable } from '../../model.js';
import type { CompositionBackend, CompositionPlan, CompositionTableMeasurement, CompositionTextMetrics } from '../../engine.js';
import type {
  JsPdfCompositionBackendOptions,
  JsPdfCompositionBlockCapability,
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionChartStyle,
  JsPdfCompositionGraphicStyle,
  JsPdfCompositionImageAsset,
  JsPdfCompositionImageRenderer,
  JsPdfCompositionImageStyle,
  JsPdfCompositionMetricStyle,
  JsPdfCompositionStyle,
  JsPdfCompositionStyles,
  JsPdfCompositionTableRenderer,
  JsPdfCompositionTableStyle,
} from '../../contracts/pdf.js';
import { compositionStyleName } from '../../text/style-name.js';
import { fitContainBox } from '../../geometry/visual-geometry.js';

/**
 * Combine independently owned atomic-block capabilities without allowing the
 * last registered capability to replace the measurement for every kind.
 * Dispatch is intentionally keyed by the normalized block kind, so a caller
 * can register images, metrics and charts for one plan.
 */
export function combineJsPdfCompositionBlockCapabilities(
  capabilities: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockCapability>>,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; blockRenderers: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>> } {
  const blockRenderers = Object.fromEntries(Object.entries(capabilities)
    .filter(([, capability]) => capability !== undefined)
    .map(([kind, capability]) => [kind, capability!.renderer])) as Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>>;
  return {
    measureBlock(block, box) {
      const capability = capabilities[block.kind];
      if (!capability) throw new Error(`No jsPDF composition measurement capability was provided for '${block.kind}'.`);
      return capability.measureBlock(block, box);
    },
    blockRenderers,
  };
}

function assertInitialPageSize(doc: jsPDF, page: CompositionPlan['pages'][number], tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('jsPDF composition backend requires a non-negative page-size tolerance.');
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const sameDimension = (actual: number, expected: number): boolean => Math.abs(actual - expected)
    <= tolerance + Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 1000;
  if (!sameDimension(width, page.width) || !sameDimension(height, page.height)) {
    throw new Error(`jsPDF page 1 is ${width}x${height}mm but the composition plan requires ${page.width}x${page.height}mm.`);
  }
}

function styleName(block: CompositionBlock): string {
  return compositionStyleName(block);
}

function styleFor(styles: JsPdfCompositionStyles, block: CompositionBlock): JsPdfCompositionStyle {
  const name = styleName(block);
  const style = styles[name];
  if (!style) throw new Error(`No jsPDF composition style was provided for '${name}'.`);
  return style;
}

function applyStyle(doc: jsPDF, family: string, style: JsPdfCompositionStyle): void {
  doc.setFont(style.fontFamily ?? family, style.fontStyle);
  doc.setFontSize(style.fontSize);
  if (style.textColor) doc.setTextColor(...style.textColor);
}

interface JsPdfFontMetricsMetadata {
  ascender?: number;
  decender?: number;
}

/**
 * Read the same font metadata that jsPDF uses for the eventual PDF text.
 * jsPDF exposes ascender/decender in its normalized 1000-unit font space.
 */
function measureLineInkBounds(doc: jsPDF, family: string, style: JsPdfCompositionStyle): { top: number; bottom: number } {
  applyStyle(doc, family, style);
  const internal = doc.internal as unknown as { getFont?: () => { metadata?: JsPdfFontMetricsMetadata } };
  const font = internal.getFont?.();
  const metadata = font?.metadata;
  // The built-in PDF fonts (for example Helvetica) have no TTF metadata in
  // jsPDF. Preserve the renderer-neutral line-box contract for those fonts;
  // registered TTF/brand fonts take the measured path below.
  if (metadata === undefined || (metadata.ascender === undefined && metadata.decender === undefined)) {
    return { top: 0, bottom: style.lineHeight };
  }
  const ascender = metadata?.ascender;
  const decender = metadata?.decender;
  if (!Number.isFinite(ascender) || !Number.isFinite(decender) || ascender === undefined || decender === undefined || ascender <= 0 || decender >= 0) {
    throw new Error(`jsPDF did not expose usable ascender/decender metrics for '${family}' '${style.fontStyle}'.`);
  }
  const fontSizeMm = style.fontSize * 25.4 / 72;
  return {
    top: style.baselineOffset - (ascender / 1000) * fontSizeMm,
    bottom: style.baselineOffset + (Math.abs(decender) / 1000) * fontSizeMm,
  };
}

function measureGlyphInkBounds(doc: jsPDF, family: string, text: string, style: JsPdfCompositionStyle): { top: number; bottom: number } {
  applyStyle(doc, family, style);
  const internal = doc.internal as unknown as { getFont?: () => { metadata?: JsPdfFontMetricsMetadata } };
  const metadata = internal.getFont?.()?.metadata;
  const ascender = metadata?.ascender;
  const decender = metadata?.decender;
  if (Number.isFinite(ascender) && Number.isFinite(decender) && ascender !== undefined && decender !== undefined && ascender > 0 && decender < 0) {
    const fontSizeMm = style.fontSize * 25.4 / 72;
    return {
      top: style.baselineOffset - (ascender / 1000) * fontSizeMm,
      bottom: style.baselineOffset + (Math.abs(decender) / 1000) * fontSizeMm,
    };
  }
  // Standard PDF fonts do not expose ascender/descender metadata. Their
  // getTextDimensions height is still tied to the selected font size; use a
  // conservative baseline-to-top box so a large glyph cannot escape its
  // debug frame.
  const height = doc.getTextDimensions(textForStyle(text, style)).h;
  return { top: style.baselineOffset - height, bottom: style.baselineOffset };
}

function textForStyle(value: string, style: JsPdfCompositionStyle): string {
  return style.textTransform === 'uppercase' ? value.toUpperCase() : value;
}

function drawGraphic(
  doc: jsPDF,
  placement: CompositionPlan['graphicPlacements'][number],
  style: JsPdfCompositionGraphicStyle,
  assets?: ReadonlyMap<string, JsPdfCompositionImageAsset>,
): void {
  if (placement.paint === false) return;
  if (placement.assetId !== undefined) {
    const asset = assets?.get(placement.assetId);
    if (!asset) throw new Error(`Graphic '${placement.graphicId}' references unresolved asset '${placement.assetId}'.`);
    if (![asset.width, asset.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`Graphic asset '${placement.assetId}' has invalid dimensions.`);
    const imageBox = fitContainBox(placement.box, asset.width, asset.height);
    doc.addImage(asset.data, asset.format, imageBox.x, imageBox.y, imageBox.width, imageBox.height);
    return;
  }
  doc.setFillColor(...style.fillColor);
  doc.setDrawColor(...style.drawColor);
  doc.setLineWidth(style.lineWidth);
  if (placement.shape === 'rectangle') {
    doc.rect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, 'FD');
    return;
  }
  if (placement.shape === 'ellipse') {
    doc.ellipse(placement.box.x + placement.box.width / 2, placement.box.y + placement.box.height / 2, placement.box.width / 2, placement.box.height / 2, 'FD');
    return;
  }
  const points = placement.points;
  if (!points || points.length < 3) throw new Error(`Graphic '${placement.graphicId}' needs polygon points for shape '${placement.shape}'.`);
  const vectors = points.slice(1).map((point, index) => [point.x - points[index].x, point.y - points[index].y]);
  doc.lines(vectors, points[0].x, points[0].y, [1, 1], 'FD', true);
}

function metricFromBlock(block: CompositionBlock): NonNullable<CompositionBlock['metric']> {
  if (block.kind !== 'metric' || !block.metric) throw new Error(`Block '${block.id}' is not a metric.`);
  return block.metric;
}

function chartFromBlock(block: CompositionBlock): CompositionChart {
  if (block.kind !== 'chart' || !block.chart) throw new Error(`Block '${block.id}' is not a chart.`);
  if (block.chart.data.some((datum) => !Number.isFinite(datum.value))) throw new Error(`Chart '${block.id}' contains a non-finite value.`);
  return block.chart;
}

function tableFromBlock(block: CompositionBlock): CompositionTable {
  if (block.kind !== 'table' || !block.table) throw new Error(`Block '${block.id}' is not a table.`);
  return block.table;
}

function oneLine(doc: jsPDF, value: string, width: number): string {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= 1) return lines[0] ?? '';
  let prefix = lines[0] ?? '';
  while (prefix.length > 1 && doc.getTextWidth(`${prefix}…`) > width) prefix = prefix.slice(0, -1);
  return `${prefix.replace(/[\s,;:.\u2013\u2014-]+$/u, '')}…`;
}

export function createJsPdfMetricBlockCapabilities(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionMetricStyle,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; renderer: JsPdfCompositionBlockRenderer } {
  if (!Number.isFinite(style.height) || style.height <= 0) throw new Error('Metric block style requires a positive height.');
  return {
    measureBlock(block, box) {
      metricFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= style.padding * 2) throw new Error(`Metric block '${block.id}' has no usable width.`);
      return { height: style.height };
    },
    renderer(pdf, block, placement) {
      const metric = metricFromBlock(block);
      const contentWidth = placement.box.width - style.padding * 2;
      pdf.setFillColor(...style.fillColor);
      pdf.setDrawColor(...style.drawColor);
      pdf.setLineWidth(style.lineWidth);
      pdf.roundedRect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, style.radius, style.radius, 'FD');
      pdf.setFont(family, 'bold');
      pdf.setFontSize(style.labelSize);
      pdf.setTextColor(...style.labelColor);
      pdf.text(oneLine(pdf, String(metric.label).toUpperCase(), contentWidth), placement.box.x + style.padding, placement.box.y + style.labelY);
      pdf.setFont(family, 'bold');
      pdf.setFontSize(style.valueSize);
      pdf.setTextColor(...style.valueColor);
      pdf.text(oneLine(pdf, String(metric.value), contentWidth), placement.box.x + style.padding, placement.box.y + style.valueY);
      if (metric.delta) {
        pdf.setFont(family, 'bold');
        pdf.setFontSize(style.deltaSize);
        const deltaColor = metric.trend === 'down'
          ? style.trendDownColor
          : metric.trend === 'up'
            ? style.trendUpColor
            : metric.trend === 'flat'
              ? style.trendFlatColor
              : style.deltaColor;
        pdf.setTextColor(...deltaColor);
        pdf.text(oneLine(pdf, `${metric.trend === 'down' ? '▼ ' : metric.trend === 'up' ? '▲ ' : ''}${metric.delta}`, contentWidth), placement.box.x + style.padding, placement.box.y + style.deltaY);
      }
      if (metric.note) {
        pdf.setFont(family, 'normal');
        pdf.setFontSize(style.noteSize);
        pdf.setTextColor(...style.noteColor);
        pdf.text(oneLine(pdf, String(metric.note), contentWidth), placement.box.x + style.padding, placement.box.y + style.noteY);
      }
    },
  };
}

function chartHeaderTop(chart: CompositionChart, style: JsPdfCompositionChartStyle): number {
  if (!chart.title && !chart.subtitle) return style.headerEmptyTop;
  let y = style.headerTitleY;
  if (chart.title) y += chart.subtitle ? style.headerTitleGap : 0;
  if (chart.subtitle) y += style.headerSubtitleSize;
  return y + style.headerBottomGap;
}

function chartTextSize(size: number, renderedWidth: number, renderWidth: number, minimumFontSize: number): number {
  return Math.max(Number.isFinite(minimumFontSize) ? minimumFontSize : 1, size * renderedWidth / renderWidth * 72 / 25.4);
}

function chartCoordinate(value: number, origin: number, scale: number): number {
  return origin + value * scale;
}

function chartValue(value: number, chart: CompositionChart): string {
  const rounded = Math.round(value * 100) / 100;
  return `${chart.prefix ?? ''}${rounded}${chart.suffix ?? ''}`;
}

function chartPalette(style: JsPdfCompositionChartStyle, index: number): [number, number, number] {
  return style.palette[index % Math.max(1, style.palette.length)] ?? style.foregroundColor;
}

function chartColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const normalized = value.replace('#', '');
  if (!/^[\da-f]{6}$/iu.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function drawChartLabel(doc: jsPDF, family: string, text: string, x: number, y: number, size: number, color: [number, number, number], bold = false): void {
  doc.setFont(family, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(text, x, y);
}

function drawChartOneLineLabel(doc: jsPDF, family: string, text: string, x: number, y: number, size: number, maxWidth: number, color: [number, number, number], bold = false, align: 'left' | 'center' = 'left'): void {
  doc.setFont(family, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(oneLine(doc, text, Math.max(1, maxWidth)), x, y, { align });
}

function drawCompositionChart(doc: jsPDF, family: string, block: CompositionBlock, placement: CompositionPlan['blockPlacements'][number], style: JsPdfCompositionChartStyle): void {
  const chart = chartFromBlock(block);
  const scale = Math.min(placement.box.width / style.width, placement.box.height / style.height);
  const renderedFontWidth = style.renderWidth * scale;
  const renderedWidth = style.width * scale;
  const renderedHeight = style.height * scale;
  const originX = placement.box.x + (placement.box.width - renderedWidth) / 2;
  const originY = placement.box.y + (placement.box.height - renderedHeight) / 2;
  const sx = (value: number) => originX + value * scale;
  const sy = (value: number) => originY + value * scale;
  const plotTop = chartHeaderTop(chart, style);
  const plotBottom = style.height - style.padBottom;
  const plotLeft = style.padLeft;
  const plotRight = style.width - style.padRight;
  const plotWidth = Math.max(0, plotRight - plotLeft);
  const plotHeight = Math.max(0, plotBottom - plotTop);
  const values = chart.data.map((datum) => datum.value);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values, 1);
  const valueRange = Math.max(1, maximum - minimum);
  const yFor = (value: number) => plotBottom - (value - minimum) / valueRange * plotHeight;
  const tickCount = Math.max(1, Math.floor(style.ticks));

  doc.setFillColor(...style.fillColor);
  doc.setDrawColor(...style.drawColor);
  doc.setLineWidth(style.gridLineWidth * scale);
  doc.rect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, 'F');
  if (chart.title) drawChartOneLineLabel(doc, family, chart.title, sx(style.headerX), sy(style.headerTitleY), chartTextSize(style.headerTitleSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), plotWidth * scale, style.foregroundColor, true);
  if (chart.subtitle) {
    const subtitleY = chart.title ? style.headerTitleY + style.headerTitleGap : style.headerTitleY;
    drawChartOneLineLabel(doc, family, chart.subtitle, sx(style.headerX), sy(subtitleY), chartTextSize(style.headerSubtitleSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), plotWidth * scale, style.mutedColor);
  }

  if (chart.type === 'pie') {
    const total = chart.data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0);
    const radius = Math.min(plotWidth, plotHeight) / 2;
    const centerX = plotLeft + plotWidth / 2;
    const centerY = plotTop + plotHeight / 2;
    let start = -Math.PI / 2;
    chart.data.forEach((datum, index) => {
      const fraction = total > 0 ? Math.max(0, datum.value) / total : 0;
      const end = start + fraction * Math.PI * 2;
      if (fraction > 0) {
        doc.setFillColor(...chartColor(datum.color, chartPalette(style, index)));
        doc.triangle(sx(centerX), sy(centerY), sx(centerX + radius * Math.cos(start)), sy(centerY + radius * Math.sin(start)), sx(centerX + radius * Math.cos(end)), sy(centerY + radius * Math.sin(end)), 'F');
      }
      start = end;
    });
    chart.data.forEach((datum, index) => {
      const legendY = plotTop + index * style.textSize * 1.4;
      if (legendY >= plotBottom) return;
      doc.setFillColor(...chartColor(datum.color, chartPalette(style, index)));
      doc.rect(sx(plotLeft), sy(legendY - style.textSize), style.textSize * scale, style.textSize * scale, 'F');
      drawChartOneLineLabel(doc, family, datum.label, sx(plotLeft + style.textSize + style.barLabelGap), sy(legendY), chartTextSize(style.textSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), (style.width - plotLeft - style.textSize - style.barLabelGap - style.padRight) * scale, style.foregroundColor);
    });
    return;
  }

  doc.setDrawColor(...style.gridColor);
  doc.setLineWidth(style.gridLineWidth * scale);
  for (let index = 0; index <= tickCount; index += 1) {
    const y = plotBottom - plotHeight * index / tickCount;
    doc.line(sx(plotLeft), sy(y), sx(plotRight), sy(y));
    const value = minimum + valueRange * index / tickCount;
    drawChartLabel(doc, family, chartValue(value, chart), sx(plotLeft - style.tickLabelOffset), sy(y + style.tickLabelBaseline), chartTextSize(style.tickLabelSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), style.mutedColor);
  }

  if (chart.type === 'bar') {
    const slotWidth = chart.data.length > 0 ? plotWidth / chart.data.length : plotWidth;
    const barWidth = Math.min(style.barMaxWidth, slotWidth * style.barSlotRatio);
    chart.data.forEach((datum, index) => {
      const center = plotLeft + slotWidth * (index + 0.5);
      const top = yFor(Math.max(0, datum.value));
      const baseline = yFor(0);
      const barHeight = Math.max(0, Math.abs(baseline - top));
      doc.setFillColor(...chartPalette(style, index));
      doc.roundedRect(sx(center - barWidth / 2), sy(Math.min(top, baseline)), barWidth * scale, barHeight * scale, style.barRadius * scale, style.barRadius * scale, 'F');
      drawChartOneLineLabel(doc, family, chartValue(datum.value, chart), sx(center), sy(Math.min(top, baseline) - style.valueOffset), chartTextSize(style.barValueSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), barWidth * scale, style.foregroundColor, true, 'center');
      drawChartOneLineLabel(doc, family, datum.label, sx(center), sy(plotBottom + style.barLabelGap), chartTextSize(style.barLabelSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), slotWidth * scale, style.mutedColor, false, 'center');
    });
    return;
  }

  const points = chart.data.map((datum, index) => ({ x: plotLeft + (chart.data.length <= 1 ? plotWidth / 2 : plotWidth * index / (chart.data.length - 1)), y: yFor(datum.value) }));
  const accent = chartColor(chart.data[0]?.color, chartPalette(style, 0));
  if (points.length > 0) {
    const areaPoints = [
      { x: sx(points[0].x), y: sy(plotBottom) },
      ...points.map((point) => ({ x: sx(point.x), y: sy(point.y) })),
      { x: sx(points.at(-1)!.x), y: sy(plotBottom) },
    ];
    const areaVectors = areaPoints.slice(1).map((point, index) => [point.x - areaPoints[index].x, point.y - areaPoints[index].y]);
    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: style.lineAreaOpacity }));
    doc.setFillColor(...accent);
    doc.lines(areaVectors, areaPoints[0].x, areaPoints[0].y, [1, 1], 'F', true);
    doc.restoreGraphicsState();
  }
  doc.setDrawColor(...accent);
  doc.setLineWidth(style.lineWidth * scale);
  points.slice(1).forEach((point, index) => doc.line(sx(points[index].x), sy(points[index].y), sx(point.x), sy(point.y)));
  points.forEach((point, index) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...accent);
    doc.setLineWidth(style.linePointStrokeWidth * scale);
    doc.circle(sx(point.x), sy(point.y), style.pointRadius * scale, 'FD');
    drawChartOneLineLabel(doc, family, chartValue(chart.data[index].value, chart), sx(point.x), sy(point.y - style.lineValueOffset), chartTextSize(style.lineValueSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), (chart.data.length > 0 ? plotWidth / Math.max(1, chart.data.length) : plotWidth) * scale, style.foregroundColor, true, 'center');
    drawChartOneLineLabel(doc, family, chart.data[index].label, sx(point.x), sy(plotBottom + style.lineLabelGap), chartTextSize(style.textSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1), (chart.data.length > 0 ? plotWidth / Math.max(1, chart.data.length) : plotWidth) * scale, style.mutedColor, false, 'center');
  });
}

export function createJsPdfChartBlockCapabilities(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionChartStyle,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; renderer: JsPdfCompositionBlockRenderer } {
  if (!Number.isFinite(style.width) || style.width <= 0 || !Number.isFinite(style.height) || style.height <= 0) {
    throw new Error('Chart block style requires positive width and height.');
  }
  if (!Number.isFinite(style.renderWidth) || style.renderWidth <= 0) throw new Error('Chart block style requires a positive render width.');
  if (!Number.isFinite(style.lineAreaOpacity) || style.lineAreaOpacity < 0 || style.lineAreaOpacity > 1) throw new Error('Chart block style requires line area opacity between 0 and 1.');
  return {
    measureBlock(block, box) {
      chartFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= 0 || !Number.isFinite(box.height) || box.height <= 0) throw new Error(`Chart block '${block.id}' has no usable target box.`);
      const scale = Math.min(box.width / style.width, box.height / style.height);
      return { height: style.height * scale, scaled: scale < box.width / style.width };
    },
    renderer(pdf, block, placement) {
      drawCompositionChart(pdf, family, block, placement, style);
    },
  };
}

function tableColumnWidths(pdf: jsPDF, family: string, table: CompositionTable, width: number, style: JsPdfCompositionTableStyle): number[] {
  const columnCount = Math.max(table.head.length, ...table.body.map((row) => row.length), 1);
  pdf.setFont(family, 'normal');
  pdf.setFontSize(style.fontSize);
  const naturalWidths = Array.from({ length: columnCount }, (_, index) => {
    const bodyWidth = Math.max(0, ...table.body.map((row) => pdf.getTextWidth(String(row[index] ?? ''))));
    pdf.setFont(family, 'bold');
    const headWidth = pdf.getTextWidth(String(table.head[index] ?? ''));
    pdf.setFont(family, 'normal');
    return Math.max(bodyWidth, headWidth) + style.cellPadding * 2;
  });
  const naturalTotal = naturalWidths.reduce((sum, item) => sum + item, 0);
  if (!Number.isFinite(naturalTotal) || naturalTotal <= 0) return Array.from({ length: columnCount }, () => width / columnCount);
  return naturalWidths.map((item) => width * item / naturalTotal);
}

function tableLineHeight(style: JsPdfCompositionTableStyle): number {
  return style.fontSize * 25.4 / 72 * style.lineHeightRatio;
}

function tableRowHeight(pdf: jsPDF, family: string, row: Array<string | number>, widths: number[], style: JsPdfCompositionTableStyle, bold: boolean): number {
  pdf.setFont(family, bold ? 'bold' : 'normal');
  pdf.setFontSize(style.fontSize);
  const lineHeight = tableLineHeight(style);
  const lines = row.map((cell, index) => pdf.splitTextToSize(String(cell), Math.max(1, widths[index] - style.cellPadding * 2)) as string[]);
  return Math.max(1, ...lines.map((items) => items.length)) * lineHeight + style.cellPadding * 2;
}

function tableRowsFromBlock(block: CompositionBlock): { table: CompositionTable; head: Array<string | number>; body: Array<Array<string | number>> } {
  const table = tableFromBlock(block);
  return { table, head: table.head, body: table.body };
}

function drawCompositionTable(pdf: jsPDF, family: string, block: CompositionBlock, placement: CompositionPlan['tablePlacements'][number], style: JsPdfCompositionTableStyle): void {
  const { table, head, body } = tableRowsFromBlock(block);
  const widths = tableColumnWidths(pdf, family, table, placement.box.width, style);
  const lineHeight = tableLineHeight(style);
  let y = placement.box.y;
  const drawRow = (row: Array<string | number>, bold: boolean, fill: [number, number, number], rowIndex: number) => {
    const height = tableRowHeight(pdf, family, row, widths, style, bold);
    let x = placement.box.x;
    pdf.setFont(family, bold ? 'bold' : 'normal');
    pdf.setFontSize(style.fontSize);
    pdf.setTextColor(...(bold ? style.headerTextColor : style.textColor));
    row.forEach((cell, index) => {
      const width = widths[index] ?? widths.at(-1)!;
      pdf.setFillColor(...fill);
      pdf.setDrawColor(...style.lineColor);
      pdf.setLineWidth(style.lineWidth);
      pdf.rect(x, y, width, height, 'FD');
      const lines = pdf.splitTextToSize(String(cell), Math.max(1, width - style.cellPadding * 2)) as string[];
      lines.forEach((line, lineIndex) => pdf.text(line, x + style.cellPadding, y + style.cellPadding + lineHeight * (lineIndex + 0.8)));
      x += width;
    });
    y += height;
    return { height, rowIndex };
  };
  if (placement.repeatsHeader || placement.startRow === 0) {
    drawRow(head, true, style.headerFillColor, -1);
  }
  for (let rowIndex = placement.startRow; rowIndex < placement.endRow; rowIndex += 1) {
    drawRow(body[rowIndex] ?? [], false, rowIndex % 2 === 0 ? style.rowFillColor : style.alternateRowFillColor, rowIndex);
  }
}

export function createJsPdfTableBlockCapabilities(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionTableStyle,
): { measureTable: NonNullable<CompositionTextMetrics['measureTable']>; renderer: JsPdfCompositionTableRenderer } {
  if (!Number.isFinite(style.fontSize) || style.fontSize <= 0 || !Number.isFinite(style.lineHeightRatio) || style.lineHeightRatio <= 0 || !Number.isInteger(style.maxRowsPerFragment) || style.maxRowsPerFragment <= 0) {
    throw new Error('Table block style requires positive font, line-height and row-fragment limits.');
  }
  return {
    measureTable(block, box, startRow, options = { repeatHeader: startRow === 0 }) {
      const { table, head, body } = tableRowsFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= style.cellPadding * 2) throw new Error(`Table block '${block.id}' has no usable width.`);
      if (!Number.isInteger(startRow) || startRow < 0 || startRow >= body.length) throw new Error(`Table block '${block.id}' has invalid start row ${startRow}.`);
      const widths = tableColumnWidths(doc, family, table, box.width, style);
      let height = options.repeatHeader || startRow === 0
        ? tableRowHeight(doc, family, head, widths, style, true)
        : 0;
      let endRow = startRow;
      while (endRow < body.length && endRow - startRow < style.maxRowsPerFragment) {
        const nextHeight = tableRowHeight(doc, family, body[endRow] ?? [], widths, style, false);
        if (endRow > startRow && height + nextHeight > box.height) break;
        height += nextHeight;
        endRow += 1;
      }
      return { height, endRow };
    },
    renderer(pdf, block, placement) {
      drawCompositionTable(pdf, family, block, placement, style);
    },
  };
}

function imageFromBlock(block: CompositionBlock): NonNullable<CompositionBlock['image']> {
  if (block.kind !== 'image' || !block.image) throw new Error(`Block '${block.id}' is not an image.`);
  return block.image;
}

function imageWidth(block: CompositionBlock, boxWidth: number): number {
  const image = imageFromBlock(block);
  return image.width === 'full' ? boxWidth : boxWidth * Number.parseFloat(image.width) / 100;
}

function drawRasterChartTextLayer(
  pdf: jsPDF,
  family: string,
  chart: CompositionChart,
  imageBox: { x: number; y: number; width: number; height: number },
  style: JsPdfCompositionChartStyle,
): void {
  const scale = imageBox.width / style.width;
  const renderedFontWidth = style.renderWidth * scale;
  const x = imageBox.x + style.headerX * scale;
  const titleY = imageBox.y + style.headerTitleY * scale;
  const subtitleY = imageBox.y + (chart.title ? style.headerTitleY + style.headerTitleGap : style.headerTitleY) * scale;
  const maxWidth = Math.max(1, (style.width - style.headerX - style.padRight) * scale);

  // Charts are rasterized before they reach the PDF adapter so that their
  // pixels are identical across renderers. Keep the chart heading searchable
  // without painting a second, potentially misaligned text layer.
  if (chart.title) {
    pdf.setFont(family, 'bold');
    pdf.setFontSize(chartTextSize(style.headerTitleSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1));
    pdf.text(oneLine(pdf, chart.title, maxWidth), x, titleY, { renderingMode: 'invisible' });
  }
  if (chart.subtitle) {
    pdf.setFont(family, 'normal');
    pdf.setFontSize(chartTextSize(style.headerSubtitleSize, renderedFontWidth, style.renderWidth, style.minimumFontSize ?? 1));
    pdf.text(oneLine(pdf, chart.subtitle, maxWidth), x, subtitleY, { renderingMode: 'invisible' });
  }
}

function drawCompositionImage(
  pdf: jsPDF,
  family: string,
  block: CompositionBlock,
  placement: CompositionPlan['blockPlacements'][number],
  assets: ReadonlyMap<string, JsPdfCompositionImageAsset>,
  style: JsPdfCompositionImageStyle,
): void {
  const image = imageFromBlock(block);
  const asset = assets.get(image.assetId);
  if (!asset) throw new Error(`Image block '${block.id}' references unresolved asset '${image.assetId}'.`);
  const width = imageWidth(block, placement.box.width);
  pdf.setFont(family, 'normal');
  pdf.setFontSize(style.captionSize);
  const captionBox = placement.captionBox;
  const captionLines = image.caption
    ? pdf.splitTextToSize(image.caption, Math.max(1, (captionBox?.width ?? placement.box.width) - style.captionPaddingX * 2)) as string[]
    : [];
  const captionHeight = captionLines.length > 0
    ? style.captionGap + captionLines.length * style.captionLineHeight + style.captionBottomGap
    : 0;
  const availableImageHeight = Math.max(0, placement.box.height - captionHeight);
  const scale = Math.min(width / asset.width, availableImageHeight / asset.height);
  const fallbackImageBox = {
    x: placement.box.x + (placement.box.width - asset.width * scale) / 2,
    y: placement.box.y,
    width: asset.width * scale,
    height: asset.height * scale,
  };
  const imageBox = placement.imageBox ?? fallbackImageBox;
  pdf.addImage(asset.data, asset.format, imageBox.x, imageBox.y, imageBox.width, imageBox.height);
  if (image.chart && style.chart) drawRasterChartTextLayer(pdf, family, image.chart, imageBox, style.chart);
  const captionFrame = captionBox ?? placement.box;
  let y = captionLines.length > 0
    ? captionFrame.y + captionFrame.height / 2 + style.captionBaselineOffset
      - ((captionLines.length - 1) * style.captionLineHeight) / 2
    : captionFrame.y;
  captionLines.forEach((line) => {
    const align = style.captionAlign ?? 'left';
    const x = align === 'center'
      ? captionFrame.x + captionFrame.width / 2
      : align === 'right'
        ? captionFrame.x + captionFrame.width - style.captionPaddingX
        : captionFrame.x + style.captionPaddingX;
    pdf.text(line, x, y, { align });
    y += style.captionLineHeight;
  });
}

export function createJsPdfImageBlockCapabilities(
  doc: jsPDF,
  family: string,
  assets: ReadonlyMap<string, JsPdfCompositionImageAsset>,
  style: JsPdfCompositionImageStyle,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; renderer: JsPdfCompositionImageRenderer } {
  if (![style.captionGap, style.captionBottomGap, style.captionLineHeight, style.captionBaselineOffset, style.captionSize, style.captionPaddingX].every((value) => Number.isFinite(value) && value >= 0) || style.captionLineHeight <= 0 || style.captionSize <= 0) {
    throw new Error('Image block style requires non-negative gaps and positive caption metrics.');
  }
  return {
    measureBlock(block, box) {
      const image = imageFromBlock(block);
      const asset = assets.get(image.assetId);
      if (!asset) throw new Error(`Image block '${block.id}' references unresolved asset '${image.assetId}'.`);
      if (![asset.width, asset.height].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`Image asset '${image.assetId}' has invalid dimensions.`);
      if (!Number.isFinite(box.width) || box.width <= 0) throw new Error(`Image block '${block.id}' has no usable width.`);
      const width = imageWidth(block, box.width);
      const renderedHeight = asset.height * width / asset.width;
      const captionLines = image.caption ? doc.splitTextToSize(image.caption, Math.max(1, box.width - style.captionPaddingX * 2)) as string[] : [];
      const captionHeight = captionLines.length > 0 ? style.captionGap + captionLines.length * style.captionLineHeight + style.captionBottomGap : 0;
      if (captionHeight >= box.height) throw new Error(`Image block '${block.id}' has no room for its caption in the target slot.`);
      const fittedHeight = Math.min(renderedHeight, box.height - captionHeight);
      return {
        height: fittedHeight + captionHeight,
        scaled: fittedHeight < renderedHeight,
        image: {
          width: width * (fittedHeight / renderedHeight),
          height: fittedHeight,
          captionHeight,
          scale: fittedHeight / renderedHeight,
        },
      };
    },
    renderer(pdf, block, placement) {
      drawCompositionImage(pdf, family, block, placement, assets, style);
    },
  };
}

/**
 * Adapt the real PDF font metrics to the renderer-neutral planner contract.
 * The planner only sees this interface; it never imports or calls jsPDF.
 */
export function createJsPdfTextMetrics(
  doc: jsPDF,
  family: string,
  styles: JsPdfCompositionStyles,
): CompositionTextMetrics {
  // Capture the font geometry once. Planning may ask for the same style many
  // times; this also makes the adapter an explicit measurement overlay rather
  // than letting the planner depend on mutable jsPDF state.
  const measuredLineInkBounds = new Map<string, { top: number; bottom: number }>();
  for (const [name, style] of Object.entries(styles)) measuredLineInkBounds.set(name, measureLineInkBounds(doc, family, style));
  return {
    units: 'mm',
    family,
    measureText(text, style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      applyStyle(doc, family, selected);
      return doc.getTextWidth(textForStyle(text, selected));
    },
    lineHeight(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.lineHeight;
    },
    lineInkBounds(style) {
      const bounds = measuredLineInkBounds.get(style);
      if (!bounds) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return bounds;
    },
    glyphInkBounds(text, style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return measureGlyphInkBounds(doc, family, text, selected);
    },
    textPadding(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return { top: selected.paddingTop ?? 0, bottom: selected.paddingBottom ?? 0 };
    },
    foregroundColor(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textColor;
    },
    glyphBaselineOffset(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.baselineOffset;
    },
    textIndent(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      return selected.textIndent ?? 0;
    },
    textTrailingReserve(style) {
      const selected = styles[style];
      if (!selected) throw new Error(`No jsPDF composition style was provided for '${style}'.`);
      if (!selected.quoteMarks) return 0;
      applyStyle(doc, family, selected);
      doc.setFont(selected.fontFamily ?? family, 'bold');
      doc.setFontSize(selected.quoteMarks.size);
      return doc.getTextWidth(selected.quoteMarks.close) + selected.quoteMarks.gap;
    },
    blockGap(previousStyle, nextStyle) {
      const previous = styles[previousStyle];
      const next = styles[nextStyle];
      if (!previous || !next) throw new Error(`No jsPDF composition style was provided for '${previousStyle}' or '${nextStyle}'.`);
      return Math.max(previous.marginAfter ?? 0, next.marginBefore ?? 0);
    },
  };
}

/**
 * PDF backend: it executes accepted text, atomic-block, table and graphic
 * placements. Asset-backed graphics require prepared image bytes in the
 * backend options; the planner remains independent of that representation.
 */
export function createJsPdfTextBackend(
  doc: jsPDF,
  family: string,
  styles: JsPdfCompositionStyles,
  options: JsPdfCompositionBackendOptions,
): CompositionBackend<Buffer> {
  return {
    render(document: CompositionDocument, plan: CompositionPlan): Buffer {
      const blocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
      const firstPage = plan.pages[0];
      if (firstPage) assertInitialPageSize(doc, firstPage, options.pageSizeTolerance);
      for (const page of plan.pages) {
        if (doc.getNumberOfPages() < page.page) doc.addPage([page.width, page.height]);
      }
      if (plan.tablePlacements.length > 0) {
        if (!options.tableRenderer) throw new Error('No jsPDF composition table renderer was provided.');
        for (const placement of plan.tablePlacements) {
          const block = blocks.get(placement.blockId);
          if (!block) throw new Error(`Composition table placement '${placement.blockId}' has no source block.`);
          doc.setPage(placement.page);
          options.tableRenderer(doc, block, placement);
        }
      }
      if (plan.graphicPlacements.length > 0) {
        if (plan.graphicPlacements.some((graphic) => graphic.paint !== false) && !options.graphicStyle) throw new Error('A graphic style is required to render composition graphics.');
        for (const graphic of plan.graphicPlacements) {
          doc.setPage(graphic.page);
          if (graphic.paint !== false) drawGraphic(doc, graphic, options.graphicStyle!, options.imageAssets);
        }
      }
      for (const placement of plan.blockPlacements) {
        const block = blocks.get(placement.blockId);
        if (!block) throw new Error(`Composition block placement '${placement.blockId}' has no source block.`);
        const renderer = options.blockRenderers?.[placement.kind];
        if (!renderer) throw new Error(`No jsPDF composition block renderer was provided for '${placement.kind}'.`);
        doc.setPage(placement.page);
        renderer(doc, block, placement);
      }
      const renderLine = (line: CompositionPlan['lines'][number]): void => {
        const block = blocks.get(line.blockId);
        if (!block) throw new Error(`Composition line '${line.blockId}' has no source block.`);
        const style = styleFor(styles, block);
        doc.setPage(line.page);
        applyStyle(doc, family, style);
        const renderedText = textForStyle(line.text, style)
          .replaceAll('{{page.number}}', String(line.page))
          .replaceAll('{{page.count}}', String(plan.pages.length));
        const textX = line.textAlign === 'right'
          ? line.box.x + line.box.width
          : line.textAlign === 'center'
            ? line.box.x + line.box.width / 2
            : line.box.x;
        if (style.marker && line.startWord === 0) {
          doc.setFillColor(...style.marker.color);
          doc.circle(line.box.x - (style.textIndent ?? 0) + style.marker.x, line.box.y + style.baselineOffset - style.marker.y, style.marker.radius, 'F');
        }
        applyStyle(doc, family, style);
        doc.text(renderedText, textX, line.box.y + style.baselineOffset, line.textAlign ? { align: line.textAlign } : undefined);
      };
      for (const line of plan.lines.filter((candidate) => candidate.layer !== 'insertion')) renderLine(line);
      // Insertions are painted after the ordinary flow. Their geometry was
      // already reserved as an obstacle, but their content is a separate
      // layer and must not masquerade as another main-flow route fragment.
      for (const line of plan.insertionLines ?? plan.lines.filter((candidate) => candidate.layer === 'insertion')) renderLine(line);
      for (const glyph of plan.glyphPlacements ?? []) {
        const style = styles[glyph.styleName];
        if (!style) throw new Error(`No jsPDF composition style was provided for glyph '${glyph.glyphId}' style '${glyph.styleName}'.`);
        doc.setPage(glyph.page);
        applyStyle(doc, family, style);
        if (glyph.opacity !== undefined) doc.setGState(doc.GState({ opacity: glyph.opacity }));
        doc.text(glyph.text, glyph.box.x, glyph.baselineY);
        if (glyph.opacity !== undefined) doc.setGState(doc.GState({ opacity: 1 }));
      }
      return Buffer.from(doc.output('arraybuffer'));
    },
  };
}
