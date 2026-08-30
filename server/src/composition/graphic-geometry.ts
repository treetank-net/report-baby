import type { CompositionGraphicPlacement } from './engine.js';

export interface CompositionInterval {
  start: number;
  end: number;
}

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
