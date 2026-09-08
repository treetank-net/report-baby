import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionBlockKind, CompositionDocument } from '../../contracts/model.js';
import type { CompositionBackend, CompositionPlan, CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfCompositionBackendOptions,
  JsPdfCompositionBlockCapability,
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionGraphicStyle,
  JsPdfCompositionImageAsset,
  JsPdfCompositionStyles,
} from '../../contracts/pdf.js';
import { fitContainBox } from '../../geometry/visual-geometry.js';
import { applyStyle, styleFor, textForStyle } from './text.js';

/**
 * Combine independently owned atomic-block capabilities without allowing the
 * last registered capability to replace the measurement for every kind.
 * Dispatch is intentionally keyed by the normalized block kind, so a caller
 * can register images, metrics and charts for one plan.
 */
/**
 * @planner-target composition/adapters/pdf/backend.ts
 * @planner-responsibility Keep the current combineJsPdfCompositionBlockCapabilities implementation intact until its target seam is extracted.
 */
export function combineJsPdfCompositionBlockCapabilities(
  capabilities: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockCapability>>,
): { measureBlock: NonNullable<CompositionTextMetrics['measureBlock']>; blockRenderers: Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>> } {
  const blockRenderers = Object.fromEntries(Object.entries(capabilities)
    .filter(([, capability]) => capability !== undefined)
    .map(([kind, capability]) => [kind, capability!.renderer])) as Partial<Record<CompositionBlockKind, JsPdfCompositionBlockRenderer>>;
  return {
    /**
     * @planner-target composition/adapters/pdf/backend.ts
     * @planner-responsibility Keep the current measureBlock implementation intact until its target seam is extracted.
     */
    measureBlock(block, box) {
      const capability = capabilities[block.kind];
      if (!capability) throw new Error(`No jsPDF composition measurement capability was provided for '${block.kind}'.`);
      return capability.measureBlock(block, box);
    },
    blockRenderers,
  };
}

/**
 * @planner-target composition/adapters/pdf/backend.ts
 * @planner-responsibility Keep the current assertInitialPageSize implementation intact until its target seam is extracted.
 */
function assertInitialPageSize(doc: jsPDF, page: CompositionPlan['pages'][number], tolerance: number): void {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('jsPDF composition backend requires a non-negative page-size tolerance.');
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  /**
   * @planner-target composition/adapters/pdf/backend.ts
   * @planner-responsibility Keep the current sameDimension implementation intact until its target seam is extracted.
   */
  const sameDimension = (actual: number, expected: number): boolean => Math.abs(actual - expected)
    <= tolerance + Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 1000;
  if (!sameDimension(width, page.width) || !sameDimension(height, page.height)) {
    throw new Error(`jsPDF page 1 is ${width}x${height}mm but the composition plan requires ${page.width}x${page.height}mm.`);
  }
}

/**
 * @planner-target composition/adapters/pdf/backend.ts
 * @planner-responsibility Keep the current drawGraphic implementation intact until its target seam is extracted.
 */
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

/**
 * PDF backend: it executes accepted text, atomic-block, table and graphic
 * placements. Asset-backed graphics require prepared image bytes in the
 * backend options; the planner remains independent of that representation.
 */
/**
 * @planner-target composition/adapters/pdf/backend.ts
 * @planner-responsibility Keep the current createJsPdfTextBackend implementation intact until its target seam is extracted.
 */
export function createJsPdfTextBackend(
  doc: jsPDF,
  family: string,
  styles: JsPdfCompositionStyles,
  options: JsPdfCompositionBackendOptions,
): CompositionBackend<Buffer> {
  return {
    /**
     * @planner-target composition/adapters/pdf/backend.ts
     * @planner-responsibility Keep the current render implementation intact until its target seam is extracted.
     */
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
      /**
       * @planner-target composition/adapters/pdf/backend.ts
       * @planner-responsibility Keep the current renderLine implementation intact until its target seam is extracted.
       */
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
