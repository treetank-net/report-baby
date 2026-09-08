import type { CompositionBox, CompositionGraphicPlacement } from '../contracts/engine-contracts.js';

export interface CompositionInterval {
  start: number;
  end: number;
}

/** Return the painted image bounds for an image fitted with `contain`. */
/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current fitContainBox implementation intact until its target seam is extracted.
 */
export function fitContainBox(container: CompositionBox, sourceWidth: number, sourceHeight: number): CompositionBox {
  const scale = Math.min(container.width / sourceWidth, container.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: container.x + (container.width - width) / 2,
    y: container.y + (container.height - height) / 2,
    width,
    height,
  };
}

/** Map a page-space point to a source-raster pixel inside a painted image box. */
/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current imagePixelAtPoint implementation intact until its target seam is extracted.
 */
export function imagePixelAtPoint(
  paintedBox: CompositionBox,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
): { x: number; y: number } | undefined {
  if (x < paintedBox.x || x >= paintedBox.x + paintedBox.width || y < paintedBox.y || y >= paintedBox.y + paintedBox.height) return undefined;
  return {
    x: Math.max(0, Math.min(imageWidth - 1, Math.floor((x - paintedBox.x) * imageWidth / paintedBox.width))),
    y: Math.max(0, Math.min(imageHeight - 1, Math.floor((y - paintedBox.y) * imageHeight / paintedBox.height))),
  };
}

/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current polygonPoints implementation intact until its target seam is extracted.
 */
export function polygonPoints(graphic: CompositionGraphicPlacement): Array<{ x: number; y: number }> {
  if (graphic.points && graphic.points.length >= 3) return graphic.points;
  if (graphic.shape === 'polygon') return [];
  if (graphic.shape === 'star' && (!Number.isInteger(graphic.vertexCount) || !graphic.innerRatio)) return [];
  const { x, y, width, height } = graphic.box;
  if (graphic.shape === 'triangle') return [
    { x: x + width / 2, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  const pointCount = graphic.shape === 'star' ? graphic.vertexCount! * 2 : 4;
  const points: Array<{ x: number; y: number }> = [];
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const outerRadiusX = width / 2;
  const outerRadiusY = height / 2;
  for (let index = 0; index < pointCount; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / pointCount;
    const radius = graphic.shape === 'star' && index % 2 === 1 ? graphic.innerRatio! : 1;
    points.push({ x: centerX + Math.cos(angle) * outerRadiusX * radius, y: centerY + Math.sin(angle) * outerRadiusY * radius });
  }
  return points;
}

/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current mergeIntervals implementation intact until its target seam is extracted.
 */
function mergeIntervals(intervals: CompositionInterval[]): CompositionInterval[] {
  const sorted = intervals.filter((interval) => interval.end > interval.start).sort((left, right) => left.start - right.start);
  const merged: CompositionInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) merged.push({ ...interval });
    else previous.end = Math.max(previous.end, interval.end);
  }
  return merged;
}

/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current polygonIntervals implementation intact until its target seam is extracted.
 */
function polygonIntervals(points: Array<{ x: number; y: number }>, y: number): CompositionInterval[] {
  const intersections: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    if ((first.y <= y && second.y > y) || (second.y <= y && first.y > y)) {
      intersections.push(first.x + ((y - first.y) / (second.y - first.y)) * (second.x - first.x));
    }
  }
  intersections.sort((left, right) => left - right);
  const intervals: CompositionInterval[] = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) intervals.push({ start: intersections[index], end: intersections[index + 1] });
  return intervals;
}

/** Return the exact horizontal shape intervals intersected by one line box. */
/**
 * @planner-target composition/geometry/visual-geometry.ts
 * @planner-responsibility Keep the current graphicIntervalsForLine implementation intact until its target seam is extracted.
 */
export function graphicIntervalsForLine(graphic: CompositionGraphicPlacement, y: number, lineHeight: number): CompositionInterval[] {
  const top = graphic.box.y;
  const bottom = graphic.box.y + graphic.box.height;
  if (bottom <= y || top >= y + lineHeight) return [];
  if (graphic.shape === 'rectangle') return [{ start: graphic.box.x, end: graphic.box.x + graphic.box.width }];
  if (graphic.shape === 'ellipse') {
    const centerY = graphic.box.y + graphic.box.height / 2;
    const radiusY = graphic.box.height / 2;
    const radiusX = graphic.box.width / 2;
    const nearestY = Math.max(centerY - radiusY, Math.min(centerY + radiusY, y + lineHeight / 2));
    const ratio = Math.max(0, 1 - ((nearestY - centerY) / radiusY) ** 2);
    const halfWidth = radiusX * Math.sqrt(ratio);
    return [{ start: graphic.box.x + radiusX - halfWidth, end: graphic.box.x + radiusX + halfWidth }];
  }
  const points = polygonPoints(graphic);
  const overlapTop = Math.max(top, y);
  const overlapBottom = Math.min(bottom, y + lineHeight);
  const overlapMiddle = overlapTop + (overlapBottom - overlapTop) / 2;
  return mergeIntervals([
    ...polygonIntervals(points, overlapTop),
    ...polygonIntervals(points, overlapMiddle),
    ...polygonIntervals(points, overlapBottom),
  ]);
}
