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
  const frameEntries: Array<[string, PageSegment]> = Object.entries(page.blockFrames).map(([name, frame]) => {
    let segment = physicalFrame(frame, page.width, page.height);
    const coveringBand = bands
      .filter((band) => band.x < segment.x + segment.width && band.x + band.width > segment.x && band.top <= segment.top && band.bottom > segment.top)
      .sort((left, right) => right.bottom - left.bottom)[0];
    if (coveringBand) {
      const height = segment.bottom - segment.top;
      segment = { ...segment, top: coveringBand.bottom, bottom: coveringBand.bottom + height };
    }
    return [name, segment];
  });
  frameEntries.sort((left, right) => left[1].top - right[1].top);
  const adjustedFrames: Array<[string, PageSegment]> = frameEntries.map(([name, segment], index) => {
    const entries = frameEntries;
    const previous = entries.slice(0, index).map((entry) => entry[1]).filter((candidate) => candidate.x < segment.x + segment.width && candidate.x + candidate.width > segment.x).sort((left, right) => right.bottom - left.bottom)[0];
    if (previous && segment.top < previous.bottom) {
      const height = segment.bottom - segment.top;
      return [name, { ...segment, top: previous.bottom, bottom: previous.bottom + height }];
    }
    return [name, segment];
  });
  const blockFrames: Record<string, PageSegment> = Object.fromEntries(adjustedFrames);
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
    blockFrames,
    flow: page.flow,
    dynamicFlow: true,
  };
}
