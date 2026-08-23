import type { CompiledTemplate, NormalizedFrame } from './template-contract.js';

export interface PageSegment {
  x: number;
  top: number;
  width: number;
  bottom: number;
}

export interface PageGeometry {
  width: number;
  height: number;
  margin: number;
  margins: { top: number; right: number; bottom: number; left: number };
  content: PageSegment;
  segments: PageSegment[];
  bands: Record<string, PageSegment>;
  continuationTop?: number;
  continuationBottom?: number;
  blockFrames: Record<string, PageSegment>;
  flow: { align: 'justify' | 'left'; hyphenate: boolean };
  dynamicFlow: boolean;
}

function physicalFrame(frame: NormalizedFrame, width: number, height: number): PageSegment {
  return {
    x: frame.x * width,
    top: frame.y * height,
    width: frame.width * width,
    bottom: (frame.y + frame.height) * height,
  };
}

function columnSegments(
  x: number,
  width: number,
  top: number,
  bottom: number,
  bands: PageSegment[],
): PageSegment[] {
  let cursor = top;
  const result: PageSegment[] = [];
  for (const band of bands
    .filter((candidate) => candidate.x < x + width && candidate.x + candidate.width > x)
    .sort((left, right) => left.top - right.top)) {
    const bandTop = Math.max(top, band.top);
    const bandBottom = Math.min(bottom, band.bottom);
    if (bandBottom <= cursor) continue;
    if (bandTop > cursor) result.push({ x, top: cursor, width, bottom: bandTop });
    cursor = Math.max(cursor, bandBottom);
    if (cursor >= bottom) break;
  }
  if (cursor < bottom) result.push({ x, top: cursor, width, bottom });
  return result.filter((segment) => segment.bottom > segment.top);
}

export function pageGeometryFromTemplate(compiled: CompiledTemplate): PageGeometry {
  const page = compiled.page;
  if (!page) throw new Error(`Page template '${compiled.id}' is missing compiled geometry.`);
  const top = page.margins.top;
  const bottom = page.height - page.margins.bottom;
  const bands = Object.values(page.reservedBands).map((frame) => physicalFrame(frame, page.width, page.height));
  const segments: PageSegment[] = [];
  let x = page.margins.left;
  for (const width of page.columns.widths) {
    segments.push(...columnSegments(x, width, top, bottom, bands));
    x += width + page.columns.gutter;
  }
  if (segments.length === 0) throw new Error(`Page template '${compiled.id}' leaves no usable flow area between margins and reserved bands.`);
  const content: PageSegment = {
    x: page.margins.left,
    top,
    width: page.width - page.margins.left - page.margins.right,
    bottom,
  };
  return {
    width: page.width,
    height: page.height,
    margin: page.margins.left,
    margins: page.margins,
    content,
    segments,
    bands: Object.fromEntries(Object.entries(page.reservedBands).map(([name, frame]) => [name, physicalFrame(frame, page.width, page.height)])),
    continuationTop: bands.find((band) => band.top === 0)?.bottom,
    continuationBottom: bands.find((band) => band.bottom === page.height)?.top,
    blockFrames: Object.fromEntries(Object.entries(page.blockFrames).map(([name, frame]) => [name, physicalFrame(frame, page.width, page.height)])),
    flow: page.flow,
    dynamicFlow: true,
  };
}
