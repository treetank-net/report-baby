import type { jsPDF } from 'jspdf';
import type { CompositionBlock } from '../../contracts/model.js';
import type { CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfInlineFontCoverage,
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionMetricStyle,
} from '../../contracts/pdf.js';
import { applyInlineTextStyle, drawInlineText, oneLine } from './text.js';

/**
 * @planner-target composition/adapters/pdf/metric.ts
 * @planner-responsibility Keep the current metricFromBlock implementation intact until its target seam is extracted.
 */
function metricFromBlock(block: CompositionBlock): NonNullable<CompositionBlock['metric']> {
  if (block.kind !== 'metric' || !block.metric) throw new Error(`Block '${block.id}' is not a metric.`);
  return block.metric;
}

/**
 * @planner-target composition/adapters/pdf/metric.ts
 * @planner-responsibility Keep the current createJsPdfMetricBlockCapabilities implementation intact until its target seam is extracted.
 */
export function createJsPdfMetricBlockCapabilities(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionMetricStyle,
  inlineFontCoverage?: JsPdfInlineFontCoverage,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; renderer: JsPdfCompositionBlockRenderer } {
  if (!Number.isFinite(style.height) || style.height <= 0) throw new Error('Metric block style requires a positive height.');
  return {
    /**
     * @planner-target composition/adapters/pdf/metric.ts
     * @planner-responsibility Keep the current measureBlock implementation intact until its target seam is extracted.
     */
    measureBlock(block, box) {
      metricFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= style.padding * 2) throw new Error(`Metric block '${block.id}' has no usable width.`);
      return { height: style.height };
    },
    /**
     * @planner-target composition/adapters/pdf/metric.ts
     * @planner-responsibility Keep the current renderer implementation intact until its target seam is extracted.
     */
    renderer(pdf, block, placement) {
      const metric = metricFromBlock(block);
      const contentWidth = placement.box.width - style.padding * 2;
      pdf.setFillColor(...style.fillColor);
      pdf.setDrawColor(...style.drawColor);
      pdf.setLineWidth(style.lineWidth);
      pdf.roundedRect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, style.radius, style.radius, 'FD');
      const label = String(metric.label).toUpperCase();
      applyInlineTextStyle(pdf, family, { fontSize: style.labelSize, lineHeight: 0, baselineOffset: 0, fontStyle: 'bold', textColor: style.labelColor }, label, { text: label, marks: ['strong'] }, inlineFontCoverage);
      pdf.setFontSize(style.labelSize);
      pdf.setTextColor(...style.labelColor);
      pdf.text(oneLine(pdf, label, contentWidth), placement.box.x + style.padding, placement.box.y + style.labelY);
      const value = String(metric.value);
      applyInlineTextStyle(pdf, family, { fontSize: style.valueSize, lineHeight: 0, baselineOffset: 0, fontStyle: 'bold', textColor: style.valueColor }, value, { text: value, marks: ['strong'] }, inlineFontCoverage);
      pdf.setFontSize(style.valueSize);
      pdf.setTextColor(...style.valueColor);
      pdf.text(oneLine(pdf, value, contentWidth), placement.box.x + style.padding, placement.box.y + style.valueY);
      if (metric.delta) {
        const deltaText = `${metric.trend === 'down' ? '▼ ' : metric.trend === 'up' ? '▲ ' : ''}${metric.delta}`;
        const deltaColor = metric.trend === 'down'
          ? style.trendDownColor
          : metric.trend === 'up'
            ? style.trendUpColor
            : metric.trend === 'flat'
              ? style.trendFlatColor
              : style.deltaColor;
        applyInlineTextStyle(pdf, family, { fontSize: style.deltaSize, lineHeight: 0, baselineOffset: 0, fontStyle: 'bold', textColor: deltaColor }, deltaText, { text: deltaText, marks: ['strong'] }, inlineFontCoverage);
        pdf.setFontSize(style.deltaSize);
        pdf.setTextColor(...deltaColor);
        pdf.text(oneLine(pdf, deltaText, contentWidth), placement.box.x + style.padding, placement.box.y + style.deltaY);
      }
      if (metric.note) {
        const note = String(metric.note);
        const noteStyle = { fontSize: style.noteSize, lineHeight: 0, baselineOffset: 0, fontStyle: 'normal' as const, textColor: style.noteColor };
        applyInlineTextStyle(pdf, family, noteStyle, note, { text: note, marks: [] }, inlineFontCoverage);
        pdf.setFontSize(style.noteSize);
        pdf.setTextColor(...style.noteColor);
        const fittedNote = oneLine(pdf, note, contentWidth);
        drawInlineText(pdf, family, noteStyle, fittedNote, placement.box.x + style.padding, placement.box.y + style.noteY, { text: fittedNote, marks: [] }, inlineFontCoverage);
      }
    },
  };
}
