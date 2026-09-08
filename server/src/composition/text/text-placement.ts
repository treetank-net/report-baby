import type {
  CompositionBlock,
  CompositionSlotTemplate,
} from '../model.js';
import type {
  CompositionLine,
  CompositionPlacement,
  CompositionSlot,
  CompositionTextMetrics,
} from '../engine.js';
import { glyphSamplingBoxes } from '../glyph-sampling.js';
import { rectBottom } from '../geometry/rectangles.js';
import type { WrappedLine } from './text-wrapping.js';

export interface TextPlacementPage {
  page: number;
  slots: Map<string, CompositionSlot>;
}

type LinePlacementGeometry = {
  firstY: number;
  lastBottom: number;
  left: number;
  right: number;
  verticalOffset: number;
};

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Calculate the shared placement geometry for a batch of wrapped lines.
 */
function linePlacementGeometry(
  slot: CompositionSlot,
  definition: CompositionSlotTemplate,
  lines: WrappedLine[],
  lineHeightValue: number,
  padding: { top: number; bottom: number },
): LinePlacementGeometry {
  const box = slot.box;
  const first = lines[0];
  const last = lines.at(-1)!;
  const contentHeight = (last.lineOffset - first.lineOffset + 1) * lineHeightValue;
  const freeHeight = Math.max(0, box.height - padding.top - padding.bottom - contentHeight);
  const verticalOffset = definition.verticalAlign === 'middle'
    ? freeHeight / 2
    : definition.verticalAlign === 'bottom'
      ? freeHeight
      : 0;
  return {
    firstY: box.y + padding.top + first.lineOffset * lineHeightValue + verticalOffset,
    lastBottom: box.y + padding.top + (last.lineOffset + 1) * lineHeightValue + verticalOffset,
    left: Math.min(...lines.map((line) => line.x)),
    right: Math.max(...lines.map((line) => line.x + line.width)),
    verticalOffset,
  };
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Resolve the aligned x-coordinate for one wrapped line.
 */
function alignedLineX(definition: CompositionSlotTemplate, line: WrappedLine): number {
  return definition.textAlign === 'right'
    ? line.x + line.width - line.naturalWidth
    : definition.textAlign === 'center'
      ? line.x + (line.width - line.naturalWidth) / 2
      : line.x;
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Append renderer-neutral line records for one placed line batch.
 */
function appendPlacedLines(
  pageState: TextPlacementPage,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  flowId: string,
  routeIndex: number | undefined,
  lines: WrappedLine[],
  lineHeightValue: number,
  padding: { top: number; bottom: number },
  verticalOffset: number,
  outputLines: CompositionLine[],
  layer: 'flow' | 'insertion',
): void {
  const slot = pageState.slots.get(definition.id)!;
  lines.forEach((line) => {
    const lineY = slot.box.y + padding.top + line.lineOffset * lineHeightValue + verticalOffset;
    const textX = alignedLineX(definition, line);
    outputLines.push({
      blockId: block.id,
      flowId,
      slotId: slot.id,
      page: pageState.page,
      ...(routeIndex === undefined ? {} : { routeIndex }),
      text: line.text,
      box: {
        x: line.x,
        y: lineY,
        width: line.width,
        height: lineHeightValue,
      },
      ...(definition.textAlign ? { textAlign: definition.textAlign } : {}),
      naturalWidth: line.naturalWidth,
      startWord: line.startWord,
      endWord: line.endWord,
      glyphSamplingBoxes: glyphSamplingBoxes(metrics, block, line.text, textX, lineY, line.naturalWidth, lineHeightValue),
      ...(layer === 'flow' ? {} : { layer }),
    });
  });
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Update slot occupancy after line placement.
 */
function markLinePlacementOccupancy(slot: CompositionSlot, lastBottom: number): void {
  slot.state = lastBottom >= rectBottom(slot.box) ? 'exhausted' : 'partial';
}

/**
 * @planner-target composition/text-placement.ts
 * @planner-responsibility Place wrapped lines, then update slot occupancy.
 */
export function placeLines(
  pageState: TextPlacementPage,
  definition: CompositionSlotTemplate,
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  flowId: string,
  routeIndex: number | undefined,
  lines: WrappedLine[],
  lineHeightValue: number,
  placements: CompositionPlacement[],
  outputLines: CompositionLine[],
  layer: 'flow' | 'insertion' = 'flow',
  padding: { top: number; bottom: number } = { top: 0, bottom: 0 },
): void {
  const slot = pageState.slots.get(definition.id);
  if (!slot || lines.length === 0) return;
  const geometry = linePlacementGeometry(slot, definition, lines, lineHeightValue, padding);
  placements.push({
    id: `placement:${placements.length + 1}`,
    blockId: block.id,
    slotId: slot.id,
    page: pageState.page,
    ...(routeIndex === undefined ? {} : { routeIndex }),
    box: { x: geometry.left, y: geometry.firstY, width: geometry.right - geometry.left, height: geometry.lastBottom - geometry.firstY },
    startWord: lines[0].startWord,
    endWord: lines.at(-1)!.endWord,
    ...(layer === 'flow' ? {} : { layer }),
  });
  appendPlacedLines(pageState, definition, block, metrics, flowId, routeIndex, lines, lineHeightValue, padding, geometry.verticalOffset, outputLines, layer);
  markLinePlacementOccupancy(slot, geometry.lastBottom);
}
