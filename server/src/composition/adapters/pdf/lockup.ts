import type { jsPDF } from 'jspdf';
import type { CompositionBlock } from '../../contracts/model.js';
import type { CompositionBlockPlacement, CompositionBox, CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type { JsPdfCompositionBlockCapability, JsPdfCompositionImageAsset, JsPdfCompositionLockupStyle } from '../../contracts/pdf.js';
import { fitContainBox } from '../../geometry/visual-geometry.js';

function lockupFromBlock(block: CompositionBlock): NonNullable<CompositionBlock['lockup']> {
  if (block.kind !== 'lockup' || !block.lockup) throw new Error(`Block '${block.id}' is not a lockup.`);
  return block.lockup;
}

function labelHeight(doc: jsPDF, label: string, style: JsPdfCompositionLockupStyle): number {
  doc.setFontSize(style.nameSize);
  return doc.getTextDimensions(label).h;
}

function lockupLayout(
  doc: jsPDF,
  block: CompositionBlock,
  box: CompositionBox,
  family: string,
  assets: ReadonlyMap<string, JsPdfCompositionImageAsset>,
  style: JsPdfCompositionLockupStyle,
): { mark?: CompositionBox; label?: { x: number; baseline: number; text: string } } {
  const lockup = lockupFromBlock(block);
  const label = lockup.label;
  const asset = lockup.markAssetId ? assets.get(lockup.markAssetId) : undefined;
  if (lockup.markAssetId && !asset) throw new Error(`Lockup '${block.id}' references unresolved asset '${lockup.markAssetId}'.`);
  const markWidth = asset ? Math.min(style.markWidth, box.width) : 0;
  const mark = asset
    ? fitContainBox({ x: box.x, y: box.y, width: markWidth, height: Math.min(style.maxHeight, box.height) }, asset.width, asset.height)
    : undefined;
  const textWidth = label ? (() => { doc.setFont(family, 'bold'); doc.setFontSize(style.nameSize); return doc.getTextWidth(label); })() : 0;
  const naturalWidth = (mark ? mark.width : 0) + (mark && label ? style.gap : 0) + textWidth;
  const scale = naturalWidth > box.width && naturalWidth > 0 ? box.width / naturalWidth : 1;
  const scaledMark = mark ? { ...mark, x: box.x, y: box.y, width: mark.width * scale, height: mark.height * scale } : undefined;
  const textHeight = label ? labelHeight(doc, label, style) * scale : 0;
  const contentHeight = Math.max(scaledMark?.height ?? 0, textHeight);
  const offset = style.verticalAlign === 'middle' ? (box.height - contentHeight) / 2 : style.verticalAlign === 'bottom' ? box.height - contentHeight : 0;
  const baseline = box.y + Math.max(0, offset) + textHeight;
  return {
    ...(scaledMark ? { mark: scaledMark } : {}),
    ...(label ? { label: { x: box.x + (scaledMark?.width ?? 0) + (scaledMark ? style.gap * scale : 0), baseline, text: label } } : {}),
  };
}

export function createJsPdfLockupBlockCapabilities(
  doc: jsPDF,
  family: string,
  assets: ReadonlyMap<string, JsPdfCompositionImageAsset>,
  style: JsPdfCompositionLockupStyle,
): JsPdfCompositionBlockCapability {
  if (![style.markWidth, style.maxHeight, style.gap, style.nameSize].every((value) => Number.isFinite(value) && value >= 0) || style.nameSize <= 0) {
    throw new Error('Lockup block style requires non-negative geometry and a positive name size.');
  }
  return {
    measureBlock(block, box) {
      const lockup = lockupFromBlock(block);
      if (!lockup.markAssetId && !lockup.label) throw new Error(`Lockup '${block.id}' has no mark or label.`);
      const layout = lockupLayout(doc, block, box, family, assets, style);
      const height = Math.max(layout.mark?.height ?? 0, layout.label ? labelHeight(doc, layout.label.text, style) : 0);
      if (!Number.isFinite(height) || height <= 0) throw new Error(`Lockup '${block.id}' has no measurable content.`);
      return { height: Math.min(box.height, height) };
    },
    renderer(pdf, block, placement: CompositionBlockPlacement) {
      const layout = lockupLayout(pdf, block, placement.box, family, assets, style);
      const lockup = lockupFromBlock(block);
      if (layout.mark && lockup.markAssetId) {
        const asset = assets.get(lockup.markAssetId);
        if (!asset) throw new Error(`Lockup '${block.id}' references unresolved asset '${lockup.markAssetId}'.`);
        pdf.addImage(asset.data, asset.format, layout.mark.x, layout.mark.y, layout.mark.width, layout.mark.height);
      }
      if (layout.label) {
        pdf.setFont(family, 'bold');
        pdf.setFontSize(style.nameSize);
        pdf.setTextColor(...style.textColor);
        pdf.text(layout.label.text, layout.label.x, layout.label.baseline);
      }
    },
  };
}
