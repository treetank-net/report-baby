import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionChart } from '../../contracts/model.js';
import type { CompositionPlan, CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfCompositionImageAsset,
  JsPdfCompositionImageRenderer,
  JsPdfCompositionImageStyle,
  JsPdfCompositionChartStyle,
} from '../../contracts/pdf.js';
import { chartTextSize } from './chart.js';
import { oneLine } from './text.js';

/**
 * @planner-target composition/adapters/pdf/image.ts
 * @planner-responsibility Keep the current imageFromBlock implementation intact until its target seam is extracted.
 */
function imageFromBlock(block: CompositionBlock): NonNullable<CompositionBlock['image']> {
  if (block.kind !== 'image' || !block.image) throw new Error(`Block '${block.id}' is not an image.`);
  return block.image;
}

/**
 * @planner-target composition/adapters/pdf/image.ts
 * @planner-responsibility Keep the current imageWidth implementation intact until its target seam is extracted.
 */
function imageWidth(block: CompositionBlock, boxWidth: number): number {
  const image = imageFromBlock(block);
  return image.width === 'full' ? boxWidth : boxWidth * Number.parseFloat(image.width) / 100;
}

/**
 * @planner-target composition/adapters/pdf/image.ts
 * @planner-responsibility Keep the current drawRasterChartTextLayer implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/adapters/pdf/image.ts
 * @planner-responsibility Keep the current drawCompositionImage implementation intact until its target seam is extracted.
 */
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

/**
 * @planner-target composition/adapters/pdf/image.ts
 * @planner-responsibility Keep the current createJsPdfImageBlockCapabilities implementation intact until its target seam is extracted.
 */
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
    /**
     * @planner-target composition/adapters/pdf/image.ts
     * @planner-responsibility Keep the current measureBlock implementation intact until its target seam is extracted.
     */
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
    /**
     * @planner-target composition/adapters/pdf/image.ts
     * @planner-responsibility Keep the current renderer implementation intact until its target seam is extracted.
     */
    renderer(pdf, block, placement) {
      drawCompositionImage(pdf, family, block, placement, assets, style);
    },
  };
}
