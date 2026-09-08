import type { CompositionRect } from '../contracts/model.js';

/** Return the lower edge of a rectangle in page coordinates. */
/**
 * @planner-target composition/geometry/rectangles.ts
 * @planner-responsibility Keep the current rectBottom implementation intact until its target seam is extracted.
 */
export function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

/** Determine whether one rectangle remains inside another with planner tolerance. */
/**
 * @planner-target composition/geometry/rectangles.ts
 * @planner-responsibility Keep the current rectFitsInside implementation intact until its target seam is extracted.
 */
export function rectFitsInside(inner: CompositionRect, outer: CompositionRect): boolean {
  const scale = Math.max(1, Math.abs(inner.x), Math.abs(inner.y), Math.abs(inner.width), Math.abs(inner.height), Math.abs(outer.x), Math.abs(outer.y), Math.abs(outer.width), Math.abs(outer.height));
  const tolerance = Number.EPSILON * scale * 64;
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
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
