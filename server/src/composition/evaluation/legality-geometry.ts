import type { CompositionPlan, CompositionSlot } from '../contracts/engine-contracts.js';
import { graphicIntervalsForLine } from '../geometry/visual-geometry.js';

type RectLike = { x: number; y: number; width: number; height: number };

type StructuredPlacement = Pick<
  CompositionPlan['blockPlacements'][number] | CompositionPlan['tablePlacements'][number],
  'page' | 'slotId' | 'box'
>;

/** Return the floating-point tolerance used by evaluator geometry checks. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep the current geometryTolerance implementation intact until its target seam is extracted.
 */
export function geometryTolerance(...values: number[]): number {
  return Number.EPSILON * Math.max(1, ...values.map((value) => Math.abs(value))) * 64;
}

/** Determine whether one box remains within another, allowing numeric tolerance. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep the current fitsInside implementation intact until its target seam is extracted.
 */
export function fitsInside(inner: RectLike, outer: RectLike): boolean {
  const tolerance = geometryTolerance(inner.x, inner.y, inner.width, inner.height, outer.x, outer.y, outer.width, outer.height);
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

/** Determine whether two boxes overlap using evaluator precision. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep the current overlaps implementation intact until its target seam is extracted.
 */
export function overlaps(a: RectLike, b: RectLike): boolean {
  const horizontal = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const scale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(a.width), Math.abs(a.height), Math.abs(b.x), Math.abs(b.y), Math.abs(b.width), Math.abs(b.height));
  const precision = Number.EPSILON * scale * 32;
  return horizontal > precision && vertical > precision;
}

/** Determine whether a text line enters the painted interval of a wrapping graphic. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep the current lineEntersGraphic implementation intact until its target seam is extracted.
 */
export function lineEntersGraphic(line: CompositionPlan['lines'][number], graphic: CompositionPlan['graphicPlacements'][number]): boolean {
  return graphicIntervalsForLine(graphic, line.box.y, line.box.height).some((interval) => {
    const overlap = Math.min(line.box.x + line.box.width, interval.end) - Math.max(line.box.x, interval.start);
    const scale = Math.max(1, Math.abs(line.box.x), Math.abs(line.box.width), Math.abs(interval.start), Math.abs(interval.end));
    return overlap > Number.EPSILON * scale * 32;
  });
}

/** Determine whether a candidate line occupies a structured block or table in its slot. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep structured placements from being counted as free line capacity.
 */
export function lineEntersStructuredPlacement(
  line: CompositionPlan['lines'][number],
  slot: CompositionSlot,
  placement: StructuredPlacement,
): boolean {
  return placement.page === line.page
    && placement.slotId === slot.id
    && overlaps(line.box, placement.box);
}

/** Count usable complete lines after an existing line, graphics, and structured placements. */
/**
 * @planner-target composition/evaluation/legality-geometry.ts
 * @planner-responsibility Keep the current usableLinesAfter implementation intact until its target seam is extracted.
 */
export function usableLinesAfter(
  line: CompositionPlan['lines'][number],
  slot: CompositionSlot,
  graphics: CompositionPlan['graphicPlacements'],
  structuredPlacements: StructuredPlacement[] = [],
  nextLineHeight = line.box.height,
): number {
  const lineHeight = nextLineHeight;
  if (lineHeight <= 0) return 0;
  let usable = 0;
  for (let y = line.box.y + lineHeight; y + lineHeight <= slot.box.y + slot.box.height + geometryTolerance(y, slot.box.y + slot.box.height); y += lineHeight) {
    const available = graphics.some((graphic) => graphic.page === line.page
      && graphic.slotId !== slot.id
      && graphic.wrap === 'around'
      && lineEntersGraphic({ ...line, box: { ...line.box, y } }, graphic));
    const candidate = { ...line, box: { ...line.box, y } };
    const occupiedByStructuredPlacement = structuredPlacements.some((placement) => lineEntersStructuredPlacement(candidate, slot, placement));
    if (!available && !occupiedByStructuredPlacement) usable += 1;
  }
  return usable;
}
