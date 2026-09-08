import type { CompositionRect } from '../model.js';

/** Return the lower edge of a rectangle in page coordinates. */
/**
 * @planner-target composition/geometry/rectangles.ts
 * @planner-responsibility Keep the current rectBottom implementation intact until its target seam is extracted.
 */
export function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

/** Determine whether two rectangles overlap using the planner tolerance. */
/**
 * @planner-target composition/geometry/rectangles.ts
 * @planner-responsibility Keep the current rectsOverlap implementation intact until its target seam is extracted.
 */
export function rectsOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(first.width), Math.abs(first.height), Math.abs(second.x), Math.abs(second.y), Math.abs(second.width), Math.abs(second.height));
  return horizontal > Number.EPSILON * scale * 32 && vertical > Number.EPSILON * scale * 32;
}
