import type { jsPDF } from 'jspdf';
import type { CompositionBlock } from '../../contracts/model.js';
import type { CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionMetricStyle,
} from '../../contracts/pdf.js';
import { oneLine } from './text.js';

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
