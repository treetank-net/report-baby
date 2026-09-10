import type { PageGeometry, PageSegment } from '../../template/geometry.js';
import type { CompositionBlock, CompositionDocument } from '../contracts/model.js';
import type {
  CompositionBox,
  CompositionPlan,
  CompositionPlanSpacingReport,
  CompositionPageGeometryReport,
  CompositionSlotSpacingReport,
  CompositionTextPlacementSpacingReport,
  CompositionTextSpacingReport,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { plannedLines } from '../layout/plan-lines.js';
import { lineHeight, styleFor, textMargins, textPadding } from '../text/text-layout.js';

function boxFromSegment(segment: PageSegment): CompositionBox {
  return { x: segment.x, y: segment.top, width: segment.width, height: segment.bottom - segment.top };
}

function bottom(box: CompositionBox): number {
  return box.y + box.height;
}

function right(box: CompositionBox): number {
  return box.x + box.width;
}

function unionBoxes(boxes: CompositionBox[]): CompositionBox | undefined {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const rightEdge = Math.max(...boxes.map(right));
  const bottomEdge = Math.max(...boxes.map(bottom));
  return { x: left, y: top, width: rightEdge - left, height: bottomEdge - top };
}

function columnBoxes(geometry: PageGeometry): CompositionBox[] {
  const height = geometry.content.bottom - geometry.content.top;
  let x = geometry.margins.left;
  return geometry.columns.widths.map((width) => {
    const column = { x, y: geometry.content.top, width, height };
    x += width + geometry.columns.gutter;
    return column;
  });
}

function pageGeometryReport(page: CompositionPlan['pages'][number], geometry: PageGeometry): CompositionPageGeometryReport {
  return {
    page: page.page,
    layoutId: page.layoutId,
    ...(page.templateRef === undefined ? {} : { templateRef: page.templateRef }),
    pageBox: { x: 0, y: 0, width: geometry.width, height: geometry.height },
    margins: { ...geometry.margins },
    contentBox: boxFromSegment(geometry.content),
    bands: Object.fromEntries(Object.entries(geometry.bands).map(([name, segment]) => [name, boxFromSegment(segment)])),
    segments: geometry.segments.map(boxFromSegment),
    columns: columnBoxes(geometry),
  };
}

function pageGeometryFor(page: CompositionPlan['pages'][number], geometry: PageGeometry): PageGeometry {
  return geometry;
}

function blockMap(document: CompositionDocument): Map<string, CompositionBlock> {
  return new Map(Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => [block.id, block] as const)));
}

function textSpacing(metrics: CompositionTextMetrics, block: CompositionBlock): CompositionTextSpacingReport {
  const styleName = styleFor(block);
  const baselineOffset = metrics.glyphBaselineOffset?.(styleName);
  const textIndent = metrics.textIndent?.(styleName);
  return {
    styleName,
    lineHeight: lineHeight(metrics, block),
    ...(baselineOffset === undefined ? {} : { baselineOffset }),
    padding: textPadding(metrics, block),
    margin: textMargins(metrics, block),
    ...(textIndent === undefined || textIndent === 0 ? {} : { textIndent }),
  };
}

function staticBandGaps(slot: CompositionPlan['slots'][number], geometry: PageGeometry): { fromHeader?: number; toFooter?: number } | undefined {
  const gaps: { fromHeader?: number; toFooter?: number } = {};
  const header = geometry.bands.header;
  const footer = geometry.bands.footer;
  if (header) gaps.fromHeader = slot.box.y - header.bottom;
  if (footer) gaps.toFooter = footer.top - bottom(slot.box);
  return Object.keys(gaps).length === 0 ? undefined : gaps;
}

function slotContentBoxes(plan: CompositionPlan, slotId: string): CompositionBox[] {
  return [
    ...plannedLines(plan).filter((line) => line.slotId === slotId).map((line) => line.box),
    ...plan.blockPlacements.filter((placement) => placement.slotId === slotId).map((placement) => placement.box),
    ...plan.tablePlacements.filter((placement) => placement.slotId === slotId).map((placement) => placement.box),
    ...plan.graphicPlacements.filter((placement) => placement.slotId === slotId).map((placement) => placement.box),
  ];
}

function slotSpacingReport(
  plan: CompositionPlan,
  slot: CompositionPlan['slots'][number],
  geometry: PageGeometry,
  linesBySlot: Map<string, CompositionTextSpacingReport[]>,
): CompositionSlotSpacingReport {
  const occupiedBox = unionBoxes(slotContentBoxes(plan, slot.id));
  const occupiedHeight = occupiedBox ? Math.max(0, bottom(occupiedBox) - slot.box.y) : 0;
  const remainingHeight = Math.max(0, slot.box.height - occupiedHeight);
  const styles = linesBySlot.get(slot.id) ?? [];
  const bandGaps = staticBandGaps(slot, geometry);
  return {
    page: slot.page,
    slotId: slot.id,
    regionId: slot.regionId,
    ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
    box: { ...slot.box },
    ...(occupiedBox ? { occupiedBox } : {}),
    occupiedHeight,
    remainingHeight,
    gapBefore: occupiedBox ? occupiedBox.y - slot.box.y : 0,
    gapAfter: occupiedBox ? bottom(slot.box) - bottom(occupiedBox) : slot.box.height,
    ...(bandGaps ? { staticBandGaps: bandGaps } : {}),
    ...(styles.length > 0 ? { textStyles: styles } : {}),
  };
}

interface TextGroup {
  block: CompositionBlock;
  lines: ReturnType<typeof plannedLines>;
  spacing: CompositionTextSpacingReport;
}

function textGroups(plan: CompositionPlan, document: CompositionDocument, metrics: CompositionTextMetrics): TextGroup[] {
  const blocks = blockMap(document);
  const groups = new Map<string, TextGroup>();
  for (const line of plannedLines(plan)) {
    const block = blocks.get(line.blockId);
    if (!block) continue;
    const layer = line.layer ?? 'flow';
    const key = `${line.page}:${line.slotId}:${line.blockId}:${layer}`;
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    groups.set(key, { block, lines: [line], spacing: textSpacing(metrics, block) });
  }
  return [...groups.values()];
}

function textPlacementReports(
  plan: CompositionPlan,
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  geometryByPage: Map<number, PageGeometry>,
): CompositionTextPlacementSpacingReport[] {
  const groups = textGroups(plan, document, metrics);
  const groupsBySlot = new Map<string, TextGroup[]>();
  for (const group of groups) {
    const line = group.lines[0];
    const key = `${line.page}:${line.slotId}`;
    groupsBySlot.set(key, [...(groupsBySlot.get(key) ?? []), group]);
  }
  const reports: CompositionTextPlacementSpacingReport[] = [];
  for (const slotGroups of groupsBySlot.values()) {
    const page = slotGroups[0].lines[0].page;
    const slotId = slotGroups[0].lines[0].slotId;
    const actualSlot = plan.slots.find((candidate) => candidate.id === slotId);
    if (!actualSlot) continue;
    const pageGeometry = geometryByPage.get(page);
    const footer = pageGeometry?.bands.footer;
    const ordered = [...slotGroups].sort((left, right) => {
      const leftBox = unionBoxes(left.lines.map((line) => line.box))!;
      const rightBox = unionBoxes(right.lines.map((line) => line.box))!;
      return leftBox.y - rightBox.y || leftBox.x - rightBox.x;
    });
    ordered.forEach((group, index) => {
      const box = unionBoxes(group.lines.map((line) => line.box));
      if (!box) return;
      const previous = index > 0 ? unionBoxes(ordered[index - 1].lines.map((line) => line.box)) : undefined;
      const next = index + 1 < ordered.length ? unionBoxes(ordered[index + 1].lines.map((line) => line.box)) : undefined;
      const layer = group.lines[0].layer;
      reports.push({
        blockId: group.lines[0].blockId,
        flowId: group.lines[0].flowId,
        page,
        slotId,
        ...(layer === undefined ? {} : { layer }),
        box,
        slotBox: { ...actualSlot.box },
        lineCount: group.lines.length,
        spacing: group.spacing,
        gapBefore: previous ? box.y - bottom(previous) : box.y - actualSlot.box.y,
        gapAfter: next ? next.y - bottom(box) : bottom(actualSlot.box) - bottom(box),
        ...(footer ? { gapToFooter: footer.top - bottom(box) } : {}),
      });
    });
  }
  return reports;
}

function textStylesBySlot(plan: CompositionPlan, document: CompositionDocument, metrics: CompositionTextMetrics): Map<string, CompositionTextSpacingReport[]> {
  const blocks = blockMap(document);
  const styles = new Map<string, CompositionTextSpacingReport[]>();
  for (const line of plannedLines(plan)) {
    const block = blocks.get(line.blockId);
    if (!block) continue;
    const spacing = textSpacing(metrics, block);
    const entries = styles.get(line.slotId) ?? [];
    if (!entries.some((entry) => JSON.stringify(entry) === JSON.stringify(spacing))) entries.push(spacing);
    styles.set(line.slotId, entries);
  }
  return styles;
}

/** Attach static geometry and measured spacing facts to a report composition plan. */
export function attachPlanSpacingReport(
  plan: CompositionPlan,
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  geometry: PageGeometry,
): void {
  const geometryByPage = new Map(plan.pages.map((page) => [page.page, pageGeometryFor(page, geometry)]));
  const pages = plan.pages.map((page) => pageGeometryReport(page, geometryByPage.get(page.page)!));
  const stylesBySlot = textStylesBySlot(plan, document, metrics);
  const slots = plan.slots.map((slot) => slotSpacingReport(plan, slot, geometryByPage.get(slot.page)!, stylesBySlot));
  plan.spacing = {
    pages,
    slots,
    textPlacements: textPlacementReports(plan, document, metrics, geometryByPage),
  } satisfies CompositionPlanSpacingReport;
}

/** Add gaps against the resolved chrome projection when the renderer has attached it. */
export function attachResolvedChromeSpacingReport(plan: CompositionPlan): void {
  if (!plan.spacing) return;
  for (const slot of plan.spacing.slots) {
    const page = plan.pages.find((candidate) => candidate.page === slot.page);
    const chrome = page?.chrome;
    if (!chrome) continue;
    const gaps: { fromHeader?: number; toFooter?: number } = {};
    if (chrome.headerBand) gaps.fromHeader = slot.box.y - (chrome.headerBand.y + chrome.headerBand.height);
    if (chrome.footerRule) gaps.toFooter = chrome.footerRule.y - bottom(slot.box);
    if (Object.keys(gaps).length > 0) slot.chromeBandGaps = gaps;
  }
}
