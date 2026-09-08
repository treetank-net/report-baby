import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionChart } from '../../contracts/model.js';
import type { CompositionPlan, CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionChartStyle,
} from '../../contracts/pdf.js';
import { oneLine } from './text.js';

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartFromBlock implementation intact until its target seam is extracted.
 */
function chartFromBlock(block: CompositionBlock): CompositionChart {
  if (block.kind !== 'chart' || !block.chart) throw new Error(`Block '${block.id}' is not a chart.`);
  if (block.chart.data.some((datum) => !Number.isFinite(datum.value))) throw new Error(`Chart '${block.id}' contains a non-finite value.`);
  return block.chart;
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartHeaderTop implementation intact until its target seam is extracted.
 */
function chartHeaderTop(chart: CompositionChart, style: JsPdfCompositionChartStyle): number {
  if (!chart.title && !chart.subtitle) return style.headerEmptyTop;
  let y = style.headerTitleY;
  if (chart.title) y += chart.subtitle ? style.headerTitleGap : 0;
  if (chart.subtitle) y += style.headerSubtitleSize;
  return y + style.headerBottomGap;
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartTextSize implementation intact until its target seam is extracted.
 */
export function chartTextSize(size: number, renderedWidth: number, renderWidth: number, minimumFontSize: number): number {
  return Math.max(Number.isFinite(minimumFontSize) ? minimumFontSize : 1, size * renderedWidth / renderWidth * 72 / 25.4);
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartValue implementation intact until its target seam is extracted.
 */
function chartValue(value: number, chart: CompositionChart): string {
  const rounded = Math.round(value * 100) / 100;
  return `${chart.prefix ?? ''}${rounded}${chart.suffix ?? ''}`;
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartPalette implementation intact until its target seam is extracted.
 */
function chartPalette(style: JsPdfCompositionChartStyle, index: number): [number, number, number] {
  return style.palette[index % Math.max(1, style.palette.length)] ?? style.foregroundColor;
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current chartColor implementation intact until its target seam is extracted.
 */
function chartColor(value: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!value) return fallback;
  const normalized = value.replace('#', '');
  if (!/^[\da-f]{6}$/iu.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current drawChartLabel implementation intact until its target seam is extracted.
 */
function drawChartLabel(doc: jsPDF, family: string, text: string, x: number, y: number, size: number, color: [number, number, number], bold = false): void {
  doc.setFont(family, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(text, x, y);
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current drawChartOneLineLabel implementation intact until its target seam is extracted.
 */
function drawChartOneLineLabel(doc: jsPDF, family: string, text: string, x: number, y: number, size: number, maxWidth: number, color: [number, number, number], bold = false, align: 'left' | 'center' = 'left'): void {
  doc.setFont(family, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  doc.text(oneLine(doc, text, Math.max(1, maxWidth)), x, y, { align });
}

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current drawCompositionChart implementation intact until its target seam is extracted.
 */
function drawCompositionChart(doc: jsPDF, family: string, block: CompositionBlock, placement: CompositionPlan['blockPlacements'][number], style: JsPdfCompositionChartStyle): void {
  const chart = chartFromBlock(block);
  const scale = Math.min(placement.box.width / style.width, placement.box.height / style.height);
  const renderedFontWidth = style.renderWidth * scale;
  const renderedWidth = style.width * scale;
  const renderedHeight = style.height * scale;
  const originX = placement.box.x + (placement.box.width - renderedWidth) / 2;
  const originY = placement.box.y + (placement.box.height - renderedHeight) / 2;
  /**
   * @planner-target composition/adapters/pdf/chart.ts
   * @planner-responsibility Keep the current sx implementation intact until its target seam is extracted.
   */
  const sx = (value: number) => originX + value * scale;
  /**
   * @planner-target composition/adapters/pdf/chart.ts
   * @planner-responsibility Keep the current sy implementation intact until its target seam is extracted.
   */
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
  /**
   * @planner-target composition/adapters/pdf/chart.ts
   * @planner-responsibility Keep the current yFor implementation intact until its target seam is extracted.
   */
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

/**
 * @planner-target composition/adapters/pdf/chart.ts
 * @planner-responsibility Keep the current createJsPdfChartBlockCapabilities implementation intact until its target seam is extracted.
 */
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
    /**
     * @planner-target composition/adapters/pdf/chart.ts
     * @planner-responsibility Keep the current measureBlock implementation intact until its target seam is extracted.
     */
    measureBlock(block, box) {
      chartFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= 0 || !Number.isFinite(box.height) || box.height <= 0) throw new Error(`Chart block '${block.id}' has no usable target box.`);
      const scale = Math.min(box.width / style.width, box.height / style.height);
      return { height: style.height * scale, scaled: scale < box.width / style.width };
    },
    /**
     * @planner-target composition/adapters/pdf/chart.ts
     * @planner-responsibility Keep the current renderer implementation intact until its target seam is extracted.
     */
    renderer(pdf, block, placement) {
      drawCompositionChart(pdf, family, block, placement, style);
    },
  };
}
