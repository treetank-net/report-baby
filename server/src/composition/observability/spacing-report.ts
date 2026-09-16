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
  CompositionSpacingObservation,
} from '../contracts/engine-contracts.js';
import { plannedLines } from '../layout/plan-lines.js';
import { lineHeight, styleFor, textMargins, textPadding } from '../text/text-layout.js';
import { readRenderConfig } from '../../template/builtins.js';
import { rectUnionArea } from '../geometry/rectangles.js';
import { elementProximityReports } from './proximity-report.js';

function boxFromSegment(segment: PageSegment): CompositionBox {
  return { x: segment.x, y: segment.top, width: segment.width, height: segment.bottom - segment.top };
}

function bottom(box: CompositionBox): number {
  return box.y + box.height;
}

function right(box: CompositionBox): number {
  return box.x + box.width;
}

function templateRefForPage(plan: CompositionPlan, page: number): string | undefined {
  const pagePlan = plan.pages.find((candidate) => candidate.page === page);
  return pagePlan?.templateRef ?? pagePlan?.pageTemplateId;
}

function slotAttribution(slot: CompositionPlan['slots'][number]): {
  owner: 'template' | 'input' | 'chrome';
  cause: string;
} {
  if (slot.flowId === 'header') return { owner: 'chrome', cause: 'header-band' };
  if (slot.flowId === 'footer') return { owner: 'chrome', cause: 'footer-band' };
  if (slot.id.includes(':request:') || slot.id.startsWith('request:')) return { owner: 'input', cause: 'input-request-overlay' };
  if (slot.fitContent === true) return {
    owner: 'template',
    cause: slot.growthMaxHeight === undefined ? 'fit-content-slot' : 'fit-content-growth-envelope',
  };
  return { owner: 'template', cause: 'static-slot-frame' };
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
    pageTemplateId: page.pageTemplateId,
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
  const contentBoxes = slotContentBoxes(plan, slot.id);
  const occupiedBox = unionBoxes(contentBoxes);
  const occupiedArea = Math.min(slot.box.width * slot.box.height, rectUnionArea(contentBoxes.map((box) => ({
    x: Math.max(slot.box.x, box.x),
    y: Math.max(slot.box.y, box.y),
    width: Math.max(0, Math.min(slot.box.x + slot.box.width, box.x + box.width) - Math.max(slot.box.x, box.x)),
    height: Math.max(0, Math.min(slot.box.y + slot.box.height, box.y + box.height) - Math.max(slot.box.y, box.y)),
  }))));
  const emptyArea = Math.max(0, slot.box.width * slot.box.height - occupiedArea);
  const occupiedHeight = occupiedBox ? Math.max(0, bottom(occupiedBox) - slot.box.y) : 0;
  const remainingHeight = Math.max(0, slot.box.height - occupiedHeight);
  const styles = linesBySlot.get(slot.id) ?? [];
  const bandGaps = staticBandGaps(slot, geometry);
  const pageTemplateRef = templateRefForPage(plan, slot.page);
  const attribution = slotAttribution(slot);
  return {
    page: slot.page,
    slotId: slot.id,
    regionId: slot.regionId,
    ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
    ...(pageTemplateRef === undefined ? {} : { templateRef: pageTemplateRef }),
    box: { ...slot.box },
    ...(occupiedBox ? { occupiedBox } : {}),
    occupiedArea,
    emptyArea,
    occupiedHeight,
    remainingHeight,
    gapBefore: occupiedBox ? occupiedBox.y - slot.box.y : 0,
    gapAfter: occupiedBox ? bottom(slot.box) - bottom(occupiedBox) : slot.box.height,
    ...(slot.spacingProfile === undefined ? {} : { profile: slot.spacingProfile }),
    ...(slot.fitContent === undefined ? {} : { fitContent: slot.fitContent }),
    ...(slot.growthMaxHeight === undefined ? {} : { growthMaxHeight: slot.growthMaxHeight }),
    ...(slot.placement === undefined ? {} : { placement: slot.placement }),
    owner: attribution.owner,
    cause: attribution.cause,
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

function verticalGapBefore(box: CompositionBox, lines: ReturnType<typeof plannedLines>): number | undefined {
  const candidates = lines
    .filter((line) => bottom(line.box) <= box.y && horizontalOverlap(line.box, box))
    .map((line) => box.y - bottom(line.box));
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

function verticalGapAfter(box: CompositionBox, lines: ReturnType<typeof plannedLines>): number | undefined {
  const candidates = lines
    .filter((line) => line.box.y >= bottom(box) && horizontalOverlap(line.box, box))
    .map((line) => line.box.y - bottom(box));
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

function horizontalOverlap(first: CompositionBox, second: CompositionBox): boolean {
  return Math.min(right(first), right(second)) > Math.max(first.x, second.x);
}

function textIntervalsBeside(
  plan: CompositionPlan,
  page: number,
  obstacle: CompositionBox,
): Array<{ x: number; width: number }> {
  const intervals: Array<{ x: number; width: number }> = [];
  for (const slot of plan.slots.filter((candidate) => candidate.page === page && candidate.kind === 'text' && horizontalOverlap(candidate.box, obstacle))) {
    const leftWidth = Math.max(0, obstacle.x - slot.box.x);
    const rightWidth = Math.max(0, right(slot.box) - right(obstacle));
    if (leftWidth > 0) intervals.push({ x: slot.box.x, width: leftWidth });
    if (rightWidth > 0) intervals.push({ x: right(obstacle), width: rightWidth });
  }
  return intervals;
}

type InsertionPlacement = CompositionPlan['graphicPlacements'][number];

function insertionPlacements(plan: CompositionPlan): InsertionPlacement[] {
  return plan.graphicPlacements.filter((graphic) => graphic.graphicId.startsWith('insertion:'));
}

function slotForInsertion(plan: CompositionPlan, placement: InsertionPlacement): CompositionPlan['slots'][number] | undefined {
  return plan.slots.find((slot) => slot.id === placement.slotId);
}

function insertionsInRegion(plan: CompositionPlan, placement: InsertionPlacement, regionId: string): InsertionPlacement[] {
  return insertionPlacements(plan)
    .filter((candidate) => candidate.page === placement.page && slotForInsertion(plan, candidate)?.regionId === regionId)
    .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
}

function insertionIndex(placements: InsertionPlacement[], placement: InsertionPlacement): number {
  return placements.findIndex((candidate) => candidate.graphicId === placement.graphicId
    && candidate.slotId === placement.slotId
    && candidate.box.x === placement.box.x
    && candidate.box.y === placement.box.y);
}

function insertionTextGaps(placement: InsertionPlacement, ordinaryLines: ReturnType<typeof plannedLines>): { before?: number; after?: number } {
  const pageLines = ordinaryLines.filter((line) => line.page === placement.page);
  return {
    before: verticalGapBefore(placement.box, pageLines),
    after: verticalGapAfter(placement.box, pageLines),
  };
}

function insertionNeighbourGaps(
  placement: InsertionPlacement,
  peers: InsertionPlacement[],
): { previous?: number; next?: number } {
  const index = insertionIndex(peers, placement);
  const previous = index > 0 ? peers[index - 1] : undefined;
  const next = index >= 0 && index + 1 < peers.length ? peers[index + 1] : undefined;
  return {
    ...(previous ? { previous: placement.box.y - bottom(previous.box) } : {}),
    ...(next ? { next: next.box.y - bottom(placement.box) } : {}),
  };
}

function insertionExplanations(placement: InsertionPlacement, geometry: PageGeometry, gaps: { before?: number; after?: number }): string[] | undefined {
  const explanations: string[] = [];
  if (gaps.before === undefined || gaps.after === undefined) explanations.push('content-boundary');
  if (geometry.bands.header && placement.box.y <= geometry.bands.header.bottom) explanations.push('chrome');
  return explanations.length > 0 ? [...new Set(explanations)] : undefined;
}

function insertionAttribution(
  plan: CompositionPlan,
  placement: InsertionPlacement,
  slot: CompositionPlan['slots'][number],
): { owner: 'template' | 'input' | 'planner'; cause: string; templateRef?: string } {
  const templateRef = templateRefForPage(plan, placement.page);
  const movable = plan.movableInsertionFrames?.some((frame) => frame.page === placement.page
    && frame.flowId === (slot.flowId ?? '')
    && frame.blockId === placement.graphicId.replace(/^insertion:/u, ''));
  if (movable) return { owner: 'planner', cause: 'planner-selected-insertion-position', ...(templateRef === undefined ? {} : { templateRef }) };
  if (slot.id.includes(':request:') || slot.id.startsWith('request:')) return { owner: 'input', cause: 'input-requested-insertion-frame', ...(templateRef === undefined ? {} : { templateRef }) };
  const mode = slot.placement?.mode;
  const cause = mode === 'fluid-y'
    ? 'template-fluid-insertion-capability'
    : mode === 'anchored-fit-content'
      ? 'template-anchored-insertion-capability'
      : 'template-fixed-insertion-slot';
  return { owner: 'template', cause, ...(templateRef === undefined ? {} : { templateRef }) };
}

function buildInsertionRhythmReport(
  plan: CompositionPlan,
  placement: InsertionPlacement,
  slot: CompositionPlan['slots'][number],
  geometry: PageGeometry,
  ordinaryLines: ReturnType<typeof plannedLines>,
): CompositionSpacingObservation {
  const region = boxFromSegment(geometry.content);
  const textGaps = insertionTextGaps(placement, ordinaryLines);
  const neighbourGaps = insertionNeighbourGaps(placement, insertionsInRegion(plan, placement, slot.regionId));
  const explanations = insertionExplanations(placement, geometry, textGaps);
  const intervals = textIntervalsBeside(plan, placement.page, placement.box);
  const attribution = insertionAttribution(plan, placement, slot);
  const profile = slot.spacingProfile ?? 'normal';
  const profileTargets = readRenderConfig().compositionScore;
  const referenceGap = profile === 'compact'
    ? profileTargets.spacingProfileCompactTargetMm
    : profile === 'open'
      ? profileTargets.spacingProfileOpenTargetMm
      : profileTargets.spacingProfileNormalTargetMm;
  return {
    kind: 'insertion-rhythm',
    page: placement.page,
    ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
    slotId: placement.slotId,
    blockId: placement.graphicId.replace(/^insertion:/u, ''),
    graphicId: placement.graphicId,
    regionId: slot.regionId,
    profile,
    owner: attribution.owner,
    cause: attribution.cause,
    ...(attribution.templateRef === undefined ? {} : { templateRef: attribution.templateRef }),
    box: { ...placement.box },
    metrics: {
      ...(textGaps.before === undefined ? {} : { beforeTextGap: textGaps.before }),
      ...(textGaps.after === undefined ? {} : { afterTextGap: textGaps.after }),
      ...(textGaps.before === undefined || textGaps.after === undefined ? {} : { textGapAsymmetry: Math.abs(textGaps.before - textGaps.after) }),
      regionStartGap: Math.max(0, placement.box.y - region.y),
      regionEndGap: Math.max(0, bottom(region) - bottom(placement.box)),
      ...(neighbourGaps.previous === undefined ? {} : { previousInsertionGap: neighbourGaps.previous }),
      ...(neighbourGaps.next === undefined ? {} : { nextInsertionGap: neighbourGaps.next }),
      referenceGap,
    },
    ...(explanations === undefined ? {} : { reasons: explanations }),
    ...(intervals.length === 0 ? {} : { intervals }),
  };
}

function insertionRhythmForPlacement(
  plan: CompositionPlan,
  placement: InsertionPlacement,
  geometryByPage: Map<number, PageGeometry>,
  ordinaryLines: ReturnType<typeof plannedLines>,
): CompositionSpacingObservation | undefined {
  const slot = slotForInsertion(plan, placement);
  const geometry = geometryByPage.get(placement.page);
  if (!slot || !geometry) return undefined;
  return buildInsertionRhythmReport(plan, placement, slot, geometry, ordinaryLines);
}

function insertionRhythmReports(
  plan: CompositionPlan,
  geometryByPage: Map<number, PageGeometry>,
): CompositionSpacingObservation[] {
  const ordinaryLines = plannedLines(plan).filter((line) => line.layer !== 'insertion');
  return insertionPlacements(plan)
    .map((placement) => insertionRhythmForPlacement(plan, placement, geometryByPage, ordinaryLines))
    .filter((report): report is CompositionSpacingObservation => report !== undefined);
}

function regionSpacingObservations(slots: CompositionSlotSpacingReport[]): CompositionSpacingObservation[] {
  return slots.map((slot) => ({
    kind: 'region' as const,
    page: slot.page,
    regionId: slot.regionId,
    slotId: slot.slotId,
    ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
    ...(slot.templateRef === undefined ? {} : { templateRef: slot.templateRef }),
    ...(slot.box ? { box: { ...slot.box } } : {}),
    metrics: {
      occupiedHeight: slot.occupiedHeight,
      remainingHeight: slot.remainingHeight,
      gapBefore: slot.gapBefore,
      gapAfter: slot.gapAfter,
    },
    ...(slot.profile === undefined ? {} : { profile: slot.profile }),
    ...(slot.owner === undefined ? {} : { owner: slot.owner }),
    ...(slot.cause === undefined ? {} : { cause: slot.cause }),
    ...(slot.flowId === 'header' || slot.flowId === 'footer' ? { reasons: ['chrome'] } : {}),
  }));
}

function obstacleSpacingObservations(plan: CompositionPlan): CompositionSpacingObservation[] {
  return plan.graphicPlacements.filter((placement) => !placement.graphicId.startsWith('insertion:')).map((placement) => ({
    kind: 'obstacle' as const,
    page: placement.page,
    slotId: placement.slotId,
    graphicId: placement.graphicId,
    box: { ...placement.box },
    metrics: { width: placement.box.width, height: placement.box.height },
    reasons: ['graphic-obstacle'],
  }));
}

/** Attach static geometry and measured spacing facts to a report composition plan. */
export function attachPlanSpacingReport(
  plan: CompositionPlan,
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  geometry: PageGeometry,
  geometryForPage: (page: CompositionPlan['pages'][number]) => PageGeometry = () => geometry,
): void {
  const geometryByPage = new Map(plan.pages.map((page) => [page.page, pageGeometryFor(page, geometryForPage(page))]));
  const pages = plan.pages.map((page) => pageGeometryReport(page, geometryByPage.get(page.page)!));
  const stylesBySlot = textStylesBySlot(plan, document, metrics);
  const slots = plan.slots.map((slot) => slotSpacingReport(plan, slot, geometryByPage.get(slot.page)!, stylesBySlot));
  plan.spacing = {
    pages,
    slots,
    textPlacements: textPlacementReports(plan, document, metrics, geometryByPage),
    observations: [
      ...regionSpacingObservations(slots),
      ...obstacleSpacingObservations(plan),
      ...insertionRhythmReports(plan, geometryByPage),
      ...elementProximityReports(plan, document),
    ],
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
