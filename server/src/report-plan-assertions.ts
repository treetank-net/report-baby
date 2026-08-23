import type { ResolvedBox } from './core/model/resolved-slide-plan.js';
import type { ResolvedReportBlock, ResolvedReportPagePlan, ResolvedReportPlan } from './core/model/resolved-report-plan.js';

export interface ReportPlanAssertionOptions {
  tolerance?: number;
  requireContinuationFill?: boolean;
}

function right(box: ResolvedBox): number {
  return box.x + box.width;
}

function bottom(box: ResolvedBox): number {
  return box.y + box.height;
}

function overlap(left: ResolvedBox, rightBox: ResolvedBox, tolerance: number): boolean {
  return Math.min(right(left), right(rightBox)) - Math.max(left.x, rightBox.x) > tolerance
    && Math.min(bottom(left), bottom(rightBox)) - Math.max(left.y, rightBox.y) > tolerance;
}

function contains(outer: ResolvedBox, inner: ResolvedBox, tolerance: number): boolean {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && right(inner) <= right(outer) + tolerance
    && bottom(inner) <= bottom(outer) + tolerance;
}

function pageBox(page: ResolvedReportPagePlan): ResolvedBox {
  return { x: 0, y: 0, width: page.width, height: page.height };
}

function parentMap(page: ResolvedReportPagePlan): Map<string, ResolvedReportBlock> {
  return new Map(page.blocks.map((block) => [block.id, block]));
}

function isDescendant(block: ResolvedReportBlock, possibleParent: ResolvedReportBlock, blocks: Map<string, ResolvedReportBlock>): boolean {
  let parentId = block.parentId;
  while (parentId) {
    if (parentId === possibleParent.id) return true;
    parentId = blocks.get(parentId)?.parentId;
  }
  return false;
}

function assertPageContainment(page: ResolvedReportPagePlan, tolerance: number): void {
  const frame = pageBox(page);
  for (const block of page.blocks) {
    if (!contains(frame, block.box, tolerance)) {
      throw new Error(`report plan page ${page.page}: block '${block.id}' leaves the page`);
    }
  }
}

function assertPageDisjointness(page: ResolvedReportPagePlan, tolerance: number): void {
  const blocks = parentMap(page);
  for (let leftIndex = 0; leftIndex < page.blocks.length; leftIndex += 1) {
    const left = page.blocks[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < page.blocks.length; rightIndex += 1) {
      const rightBlock = page.blocks[rightIndex];
      if (left.container || rightBlock.container) continue;
      if (isDescendant(left, rightBlock, blocks) || isDescendant(rightBlock, left, blocks)) continue;
      if (overlap(left.box, rightBlock.box, tolerance)) {
        throw new Error(`report plan page ${page.page}: blocks '${left.id}' and '${rightBlock.id}' overlap`);
      }
    }
  }
}

function assertContinuationFill(page: ResolvedReportPagePlan, tolerance: number): void {
  if (!page.continuation) return;
  const flow = page.blocks.find((block) => block.id === 'flow' && !block.parentId);
  if (!flow) return;
  const children = page.blocks.filter((block) => block.parentId === flow.id).sort((left, rightBlock) => left.box.x - rightBlock.box.x);
  if (children.length === 0) return;
  const expectedTop = flow.box.y;
  const expectedBottom = bottom(flow.box);
  for (const child of children) {
    if (Math.abs(child.box.y - expectedTop) > tolerance || Math.abs(bottom(child.box) - expectedBottom) > tolerance) {
      throw new Error(`report plan page ${page.page}: continuation column '${child.id}' does not fill the flow frame`);
    }
  }
}

/** Validate the report layout contract without touching jsPDF or the filesystem. */
export function assertReportPlan(plan: ResolvedReportPlan, options: ReportPlanAssertionOptions = {}): void {
  const tolerance = options.tolerance ?? 0.001;
  for (const page of plan.pages) {
    assertPageContainment(page, tolerance);
    assertPageDisjointness(page, tolerance);
    if (options.requireContinuationFill ?? true) assertContinuationFill(page, tolerance);
  }
}
