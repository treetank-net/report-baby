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

/** Return the shared area of two rectangles, or no rectangle when they only touch. */
export function rectIntersection(first: CompositionRect, second: CompositionRect): CompositionRect | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return right <= x || bottom <= y ? undefined : { x, y, width: right - x, height: bottom - y };
}

/** Return the shared area of two rectangles in square page units. */
export function rectIntersectionArea(first: CompositionRect, second: CompositionRect): number {
  const intersection = rectIntersection(first, second);
  return intersection ? intersection.width * intersection.height : 0;
}

/** Return the area covered by a rectangle union without double-counting overlaps. */
export function rectUnionArea(rectangles: CompositionRect[]): number {
  const valid = rectangles.filter((rect) => rect.width > 0 && rect.height > 0);
  if (valid.length === 0) return 0;
  const xEdges = [...new Set(valid.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((left, right) => left - right);
  let area = 0;
  for (let index = 0; index < xEdges.length - 1; index += 1) {
    const left = xEdges[index];
    const right = xEdges[index + 1];
    if (right <= left) continue;
    const intervals = valid
      .filter((rect) => rect.x < right && rect.x + rect.width > left)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((first, second) => first[0] - second[0]);
    let covered = 0;
    let start = Number.NaN;
    let end = Number.NaN;
    for (const [top, bottom] of intervals) {
      if (Number.isNaN(start)) {
        start = top;
        end = bottom;
      } else if (top > end) {
        covered += end - start;
        start = top;
        end = bottom;
      } else {
        end = Math.max(end, bottom);
      }
    }
    if (!Number.isNaN(start)) covered += end - start;
    area += (right - left) * covered;
  }
  return area;
}
