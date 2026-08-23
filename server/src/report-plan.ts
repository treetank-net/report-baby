import type { RenderTheme } from './core/model/render-theme.js';
import type { ResolvedReportBlock, ResolvedReportPagePlan, ResolvedReportPlan, ReportPlanRole } from './core/model/resolved-report-plan.js';
import type { ReportData } from './report-renderer.js';
import type { PageGeometry, PageSegment } from './page-geometry.js';

export interface ResolveReportPlanInput {
  templateRef: string;
  data: ReportData;
  theme: RenderTheme;
  geometry: PageGeometry;
  pageCount?: number;
}

function box(segment: PageSegment): { x: number; y: number; width: number; height: number } {
  return { x: segment.x, y: segment.top, width: segment.width, height: segment.bottom - segment.top };
}

function block(id: string, role: ReportPlanRole, segment: PageSegment, column?: number, parentId?: string, container = false): ResolvedReportBlock {
  return { id, role, box: box(segment), ...(column === undefined ? {} : { column }), ...(parentId ? { parentId } : {}), ...(container ? { container } : {}) };
}

function flowBlocks(geometry: PageGeometry, parentId: string | undefined, top: number, bottom: number): ResolvedReportBlock[] {
  return geometry.segments
    .map((segment) => ({ ...segment, top: Math.max(segment.top, top), bottom }))
    .filter((segment) => segment.bottom > segment.top)
    .map((segment, index) => block(`flow-${index + 1}`, 'flow', segment, index + 1, parentId));
}

function logicalBlocks(data: ReportData, frame: PageSegment): ResolvedReportBlock[] {
  const blocks: ResolvedReportBlock[] = [];
  if (data.kpis?.length) blocks.push(block('kpis', 'kpis', frame, undefined, 'flow', true));
  if (data.charts?.length) blocks.push(block('charts', 'charts', frame, undefined, 'flow', true));
  if (data.sections?.length) blocks.push(block('sections', 'section', frame, undefined, 'flow', true));
  if (data.table) blocks.push(block('table', 'table', frame, undefined, 'flow', true));
  if (data.highlights?.length) blocks.push(block('highlights', 'highlights', frame, undefined, 'flow', true));
  return blocks;
}

function firstPageFlowTop(geometry: PageGeometry, data: ReportData, narrative: PageSegment): number {
  if (data.intro) return narrative.top;
  return geometry.bands.header?.bottom ?? geometry.content.top;
}

function pageBlocks(input: ResolveReportPlanInput, page: number): ResolvedReportBlock[] {
  const { geometry, data } = input;
  const blocks: ResolvedReportBlock[] = [];
  if (geometry.bands.header) {
    const header = page === 1
      ? geometry.bands.header
      : { ...geometry.bands.header, bottom: Math.max(geometry.bands.header.top, geometry.continuationTop ?? geometry.bands.header.bottom) };
    blocks.push(block('header', 'header', header));
  }
  if (geometry.bands.footer) blocks.push(block('footer', 'footer', geometry.bands.footer));
  if (page === 1 && geometry.blockFrames.intro && data.intro) blocks.push(block('intro', 'intro', geometry.blockFrames.intro));
  const narrative = geometry.blockFrames.narrative;
  if (narrative && page === 1) {
    const firstPageFlow: PageSegment = {
      ...narrative,
      top: firstPageFlowTop(geometry, data, narrative),
      bottom: geometry.bands.footer?.top ?? geometry.continuationBottom ?? geometry.content.bottom,
    };
    blocks.push(block('flow', 'flow', firstPageFlow, undefined, undefined, true));
    blocks.push(...flowBlocks(geometry, 'flow', firstPageFlow.top, firstPageFlow.bottom));
    blocks.push(...logicalBlocks(data, firstPageFlow));
  } else if (narrative) {
    const continuation: PageSegment = {
      x: narrative.x,
      top: Math.max(geometry.continuationTop ?? 0, geometry.bands.header?.bottom ?? geometry.content.top),
      width: narrative.width,
      bottom: Math.min(geometry.continuationBottom ?? Number.POSITIVE_INFINITY, geometry.bands.footer?.top ?? geometry.content.bottom),
    };
    blocks.push(block('flow', 'flow', continuation, undefined, undefined, true));
    blocks.push(...flowBlocks(geometry, 'flow', continuation.top, continuation.bottom));
    blocks.push(...logicalBlocks(data, continuation));
  } else {
    const top = page === 1
      ? geometry.bands.header?.bottom ?? geometry.content.top
      : Math.max(geometry.continuationTop ?? 0, geometry.bands.header?.bottom ?? geometry.content.top);
    const bottom = geometry.continuationBottom ?? geometry.bands.footer?.top ?? geometry.content.bottom;
    const flow: PageSegment = { x: geometry.content.x, top, width: geometry.content.width, bottom };
    blocks.push(block('flow', 'flow', flow, undefined, undefined, true));
    blocks.push(...flowBlocks(geometry, 'flow', top, bottom));
    blocks.push(...logicalBlocks(data, flow));
  }
  return blocks;
}

/**
 * Resolve the page-level contract before any jsPDF drawing occurs.
 *
 * The first version intentionally describes the reusable page geometry and
 * flow allocation. A later render pass may add concrete continuation pages,
 * but it must preserve these boxes and their roles.
 */
export function resolveReportPlan(input: ResolveReportPlanInput): ResolvedReportPlan {
  const pageCount = Math.max(1, Math.floor(input.pageCount ?? 1));
  return {
    schemaVersion: 1,
    templateRef: input.templateRef,
    pages: Array.from({ length: pageCount }, (_, index): ResolvedReportPagePlan => ({
      page: index + 1,
      width: input.geometry.width,
      height: input.geometry.height,
      continuation: index > 0,
      blocks: pageBlocks(input, index + 1),
    })),
  };
}

export function reportPlanSummary(plan: ResolvedReportPlan): Record<string, unknown> {
  return {
    schemaVersion: plan.schemaVersion,
    templateRef: plan.templateRef,
    pages: plan.pages.map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      continuation: page.continuation,
      blocks: page.blocks,
    })),
  };
}
