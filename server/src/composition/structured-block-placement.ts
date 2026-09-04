import type {
  CompositionBlock,
  CompositionRect,
  CompositionSlotTemplate,
} from './model.js';
import type {
  CompositionBlockMeasurement,
  CompositionBlockPlacement,
  CompositionDiagnostic,
  CompositionPlan,
  CompositionSlot,
  CompositionTableMeasurement,
  CompositionTextMetrics,
} from './engine.js';
import { compositionStyleName } from './style-name.js';
import { isAtomicBlock } from './route-slots.js';

export interface StructuredBlockPage {
  page: number;
  slots: Map<string, CompositionSlot>;
}

export interface StructuredBlockCursor {
  blockIndex: number;
  startWord: number;
  startRow: number;
  page: number;
  routeIndex: number;
}

export interface StructuredBlockPlacementContext {
  pageState: StructuredBlockPage;
  definition: CompositionSlotTemplate;
  block: CompositionBlock;
  flowId: string;
  routeIndex: number;
  plan: CompositionPlan;
  cursor: StructuredBlockCursor;
  blocksLength: number;
  availableRouteSlots: string[];
  metrics: CompositionTextMetrics;
  geometryTolerance: number;
  previousBlockInSlot: (slotId: string, blockId: string) => CompositionBlock | undefined;
  contentStartBottom: (slot: CompositionSlot) => number;
  advanceCursor: (cursor: StructuredBlockCursor, routeSlotsForPage: string[]) => void;
  growSlot: (requiredBottom: number) => void;
}

function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

function diagnostic(
  severity: CompositionDiagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<CompositionDiagnostic> = {},
): CompositionDiagnostic {
  return { severity, code, message, ...extra };
}

function placeAtomicBlock(
  pageState: StructuredBlockPage,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  measurement: CompositionBlockMeasurement,
  routeIndex: number,
  blockPlacements: CompositionBlockPlacement[],
  graphicPlacements: CompositionPlan['graphicPlacements'],
  top = pageState.slots.get(definition.id)?.box.y ?? definition.box.y,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  const placement: CompositionBlockPlacement = {
    id: `block-placement:${blockPlacements.length + 1}`,
    blockId: block.id,
    kind: block.kind,
    slotId: slot.id,
    page: pageState.page,
    routeIndex,
    box: { x: slot.box.x, y: top, width: slot.box.width, height: measurement.height },
  };
  if (block.kind === 'image' && measurement.image) {
    const imageX = block.image?.wrap === 'left'
      ? slot.box.x
      : block.image?.wrap === 'right'
        ? slot.box.x + slot.box.width - measurement.image.width
        : slot.box.x + (slot.box.width - measurement.image.width) / 2;
    placement.imageBox = {
      x: imageX,
      y: top,
      width: measurement.image.width,
      height: measurement.image.height,
    };
    if (measurement.image.captionHeight > 0) {
      placement.captionBox = {
        x: imageX,
        y: top + measurement.image.height,
        width: measurement.image.width,
        height: measurement.image.captionHeight,
      };
    }
    placement.scale = measurement.image.scale;
    if (block.image?.wrap === 'left' || block.image?.wrap === 'right') {
      graphicPlacements.push({
        id: `graphic:${block.id}:boundary`,
        graphicId: `${block.id}:boundary`,
        slotId: slot.id,
        page: pageState.page,
        shape: 'rectangle',
        wrap: 'around',
        paint: false,
        box: { x: imageX, y: top, width: measurement.image.width, height: measurement.height },
      });
    }
  }
  blockPlacements.push(placement);
  const canGrowFurther = definition.kind === 'text'
    && definition.grow?.axis === 'y'
    && rectBottom(slot.box) < definition.box.y + definition.grow.maxHeight - Number.EPSILON;
  slot.state = top + measurement.height >= rectBottom(slot.box) && !canGrowFurther ? 'exhausted' : 'partial';
}

function placeTableFragment(
  pageState: StructuredBlockPage,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  measurement: CompositionTableMeasurement,
  startRow: number,
  repeatsHeader: boolean,
  routeIndex: number,
  tablePlacements: CompositionPlan['tablePlacements'],
  top = pageState.slots.get(definition.id)?.box.y ?? definition.box.y,
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot) return;
  tablePlacements.push({
    id: `table-placement:${tablePlacements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    page: pageState.page,
    routeIndex,
    box: { x: slot.box.x, y: top, width: slot.box.width, height: measurement.height },
    startRow,
    endRow: measurement.endRow,
    repeatsHeader,
  });
  slot.state = 'exhausted';
}

/**
 * Place a table fragment or an atomic block and advance the flow cursor.
 *
 * Returning false means the current block belongs to the ordinary text path.
 * Every structured-block branch returns true, including error and push
 * decisions, so the caller can continue its placement loop unchanged.
 */
export function placeStructuredBlock(context: StructuredBlockPlacementContext): boolean {
  const {
    pageState,
    definition,
    block,
    flowId,
    routeIndex,
    plan,
    cursor,
    blocksLength,
    availableRouteSlots,
    metrics,
    geometryTolerance,
    previousBlockInSlot,
    contentStartBottom,
    advanceCursor,
    growSlot,
  } = context;

  if (block.kind === 'table') {
    const table = block.table;
    if (!table || !metrics.measureTable) {
      plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_UNAVAILABLE', `No renderer-neutral table measurement is available for '${block.id}'.`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id }));
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      cursor.startRow = 0;
      return true;
    }
    if (table.body.length === 0) {
      plan.decisions.push({ code: 'EMPTY_TABLE_SKIPPED', flowId, blockId: block.id, slotId: definition.id });
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      cursor.startRow = 0;
      return true;
    }
    const slot = pageState.slots.get(definition.id)!;
    const tablePrevious = definition.kind === 'text' ? previousBlockInSlot(slot.id, block.id) : undefined;
    const tableGap = tablePrevious ? metrics.blockGap?.(compositionStyleName(tablePrevious), compositionStyleName(block)) ?? 0 : 0;
    const tableTop = definition.kind === 'text'
      ? contentStartBottom(slot) + tableGap
      : slot.box.y;
    const tableBox = { ...slot.box, y: tableTop, height: Math.max(0, rectBottom(slot.box) - tableTop) };
    const repeatsHeader = cursor.startRow > 0
      && !plan.tablePlacements.some((placement) => placement.blockId === block.id && placement.page === pageState.page);
    let measurement: CompositionTableMeasurement;
    try {
      measurement = metrics.measureTable(block, tableBox, cursor.startRow, { repeatHeader: repeatsHeader });
    } catch (cause) {
      plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_FAILED', `Measurement failed for table '${block.id}': ${cause instanceof Error ? cause.message : String(cause)}`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id, details: { startRow: cursor.startRow } }));
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      cursor.startRow = 0;
      return true;
    }
    const rowCount = table.body.length;
    if (!Number.isFinite(measurement.height) || measurement.height <= 0 || !Number.isInteger(measurement.endRow) || measurement.endRow <= cursor.startRow || measurement.endRow > rowCount) {
      plan.diagnostics.push(diagnostic('error', 'TABLE_MEASUREMENT_INVALID', `Table '${block.id}' returned an invalid fragment.`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id, details: { startRow: cursor.startRow, endRow: measurement.endRow, height: measurement.height, rowCount } }));
      cursor.blockIndex += 1;
      cursor.startWord = 0;
      cursor.startRow = 0;
      return true;
    }
    const availableHeight = rectBottom(slot.box) - tableTop;
    if (measurement.height > availableHeight) {
      plan.decisions.push({ code: 'TABLE_FRAGMENT_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, startRow: cursor.startRow, reason: 'table-fragment-does-not-fit' });
      advanceCursor(cursor, availableRouteSlots);
      return true;
    }
    placeTableFragment(pageState, definition, block, measurement, cursor.startRow, repeatsHeader, routeIndex, plan.tablePlacements, tableTop);
    plan.decisions.push({ code: 'TABLE_FRAGMENT_PLACED', flowId, blockId: block.id, slotId: slot.id, page: pageState.page, startRow: cursor.startRow, endRow: measurement.endRow, repeatsHeader });
    cursor.startWord = 0;
    if (measurement.endRow >= rowCount) {
      cursor.blockIndex += 1;
      cursor.startRow = 0;
    } else {
      cursor.startRow = measurement.endRow;
    }
    if (definition.kind !== 'text' || tableTop + measurement.height >= rectBottom(slot.box)) advanceCursor(cursor, availableRouteSlots);
    return true;
  }

  if (definition.kind !== 'block' && block.kind !== 'image' && !isAtomicBlock(block)) return false;
  if (!isAtomicBlock(block)) {
    plan.diagnostics.push(diagnostic('error', 'NON_ATOMIC_BLOCK_IN_BLOCK_SLOT', `Block slot '${definition.id}' cannot place non-atomic block '${block.id}'.`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id }));
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    return true;
  }
  if (!metrics.measureBlock) {
    plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_UNAVAILABLE', `No renderer-neutral measurement is available for atomic block '${block.id}'.`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id }));
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    return true;
  }
  const slot = pageState.slots.get(definition.id)!;
  const previous = definition.kind === 'text' ? previousBlockInSlot(slot.id, block.id) : undefined;
  const blockGap = previous ? metrics.blockGap?.(compositionStyleName(previous), compositionStyleName(block)) ?? 0 : 0;
  const blockTop = definition.kind === 'text'
    ? contentStartBottom(slot) + blockGap
    : slot.box.y;
  const blockMeasureBottom = definition.kind === 'text' && definition.grow?.axis === 'y'
    ? definition.box.y + definition.grow.maxHeight
    : rectBottom(slot.box);
  const blockBox = { ...slot.box, y: blockTop, height: Math.max(0, blockMeasureBottom - blockTop) };
  let measurement: CompositionBlockMeasurement;
  try {
    measurement = metrics.measureBlock(block, blockBox);
  } catch (cause) {
    plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_FAILED', `Measurement failed for atomic block '${block.id}': ${cause instanceof Error ? cause.message : String(cause)}`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id }));
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    return true;
  }
  if (!Number.isFinite(measurement.height) || measurement.height <= 0) {
    plan.diagnostics.push(diagnostic('error', 'BLOCK_MEASUREMENT_INVALID', `Atomic block '${block.id}' returned an invalid height.`, { flowId, blockId: block.id, page: pageState.page, slotId: definition.id, details: { height: measurement.height } }));
    cursor.blockIndex += 1;
    cursor.startWord = 0;
    return true;
  }
  if (definition.kind === 'text' && definition.grow?.axis === 'y') growSlot(blockTop + measurement.height);
  const availableBlockHeight = rectBottom(slot.box) - blockTop;
  if (measurement.height > availableBlockHeight + geometryTolerance) {
    plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'atomic-block-does-not-fit' });
    advanceCursor(cursor, availableRouteSlots);
    return true;
  }
  if (blockTop + measurement.height > rectBottom(slot.box) + geometryTolerance) {
    plan.decisions.push({ code: 'BLOCK_PUSHED_TO_NEXT_SLOT', flowId, blockId: block.id, slotId: slot.id, reason: 'atomic-block-does-not-fit-after-existing-content' });
    advanceCursor(cursor, availableRouteSlots);
    return true;
  }
  placeAtomicBlock(pageState, definition, block, measurement, routeIndex, plan.blockPlacements, plan.graphicPlacements, blockTop);
  if (measurement.scaled) {
    plan.decisions.push({ code: block.kind === 'image' ? 'IMAGE_SCALED_TO_FIT' : 'BLOCK_SCALED_TO_FIT', flowId, blockId: block.id, slotId: slot.id, page: pageState.page, reason: 'atomic-block-natural-height-exceeds-slot-height' });
  }
  plan.decisions.push({ code: 'ATOMIC_BLOCK_PLACED', flowId, blockId: block.id, slotId: slot.id, page: pageState.page, height: measurement.height });
  cursor.blockIndex += 1;
  cursor.startWord = 0;
  if (cursor.blockIndex < blocksLength && definition.kind !== 'text') advanceCursor(cursor, availableRouteSlots);
  return true;
}
