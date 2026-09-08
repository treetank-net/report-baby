import { createHash } from 'node:crypto';
import type { CompositionBox, CompositionGlyphSamplingBox, CompositionPlan } from '../engine.js';
import { fitContainBox, imagePixelAtPoint } from '../image-geometry.js';

export type CompositionContrastStatus = 'measured' | 'unknown';

/**
 * Raster representation of an image asset used as a background proxy.
 *
 * This is not the rendered PDF page. Page geometry and Monte Carlo sample
 * positions remain continuous; integer coordinates are only required when
 * looking up a color in this discrete pixel buffer.
 */
export interface CompositionRasterImage {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Uint8Array;
}

export type CompositionRgbColor = [number, number, number];

export interface CompositionContrastGlyphResult {
  glyphIndex: number;
  minimumRatio: number;
  averageRatio: number;
  sampleCount: number;
}

export interface CompositionContrastSampleOptions {
  region: CompositionBox;
  foreground: CompositionRgbColor;
  /** Integer part plus a deterministic Bernoulli trial for the fraction. */
  sampleCount: number;
  /** Stable corpus seed. Candidate geometry is deliberately excluded. */
  sampleSeed?: string;
  /** When present, sample each frame instead of the whole line region. */
  glyphs?: ReadonlyArray<CompositionGlyphSamplingBox>;
  pageBackground?: CompositionRgbColor;
}

export interface CompositionContrastResult {
  status: CompositionContrastStatus;
  minimumRatio?: number;
  averageRatio?: number;
  sampleCount: number;
  worstSample?: { x: number; y: number; ratio: number };
  sampledPoints?: Array<{ x: number; y: number; glyphIndex: number; normalizedX: number; normalizedY: number; ratio: number }>;
  glyphResults?: CompositionContrastGlyphResult[];
  reason?: 'invalid-image' | 'invalid-region' | 'invalid-policy' | 'unknown-alpha-background' | 'asset-raster-missing';
}

export interface CompositionContrastAssessment {
  /** Present for a graphic-scoped assessment; omitted for page-background sampling. */
  graphicId?: string;
  assetId?: string;
  page: number;
  lineCount: number;
  regions: CompositionBox[];
  status: CompositionContrastStatus;
  minimumRatio?: number;
  averageRatio?: number;
  sampleCount: number;
  glyphResults?: CompositionContrastGlyphResult[];
  worstSample?: { x: number; y: number; ratio: number };
  reason?: CompositionContrastResult['reason'] | 'asset-raster-missing';
}

export interface CompositionContrastProviderOptions {
  rasterImages: ReadonlyMap<string, CompositionRasterImage>;
  foreground: CompositionRgbColor;
  sampleCount: number;
  /** SHA-1 (or equivalent stable digest) of the source text corpus. */
  sampleSeed?: string;
  pageBackground?: CompositionRgbColor;
}

export interface CompositionContrastProvider {
  assess(plan: Pick<CompositionPlan, 'graphicPlacements' | 'lines' | 'insertionLines'>): CompositionContrastAssessment[];
}

function channelLuminance(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: CompositionRgbColor): number {
  return 0.2126 * channelLuminance(color[0])
    + 0.7152 * channelLuminance(color[1])
    + 0.0722 * channelLuminance(color[2]);
}

export function contrastRatio(first: CompositionRgbColor, second: CompositionRgbColor): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function validColor(color: CompositionRgbColor | undefined): color is CompositionRgbColor {
  return color !== undefined && [0, 1, 2].every((channel) => Number.isFinite(color[channel]) && color[channel] >= 0 && color[channel] <= 255);
}

function validRegion(image: CompositionRasterImage, region: CompositionBox): boolean {
  return Number.isFinite(region.x)
    && Number.isFinite(region.y)
    && Number.isFinite(region.width)
    && Number.isFinite(region.height)
    && region.x >= 0
    && region.y >= 0
    && region.width > 0
    && region.height > 0
    && region.x + region.width <= image.width
    && region.y + region.height <= image.height;
}

function pixelAt(image: CompositionRasterImage, x: number, y: number, pageBackground?: CompositionRgbColor): CompositionRgbColor | undefined {
  const offset = (y * image.width + x) * image.channels;
  const alpha = image.channels === 4 ? image.pixels[offset + 3] / 255 : 1;
  if (alpha < 1 && !validColor(pageBackground)) return undefined;
  const underneath: CompositionRgbColor = pageBackground ?? [255, 255, 255];
  return [0, 1, 2].map((channel) => Math.round(
    image.pixels[offset + channel] * alpha + underneath[channel] * (1 - alpha),
  )) as CompositionRgbColor;
}

interface SeededRandom {
  next(): number;
}

function seededRandom(seed: string): SeededRandom {
  const digest = createHash('sha1').update(seed).digest();
  let state = digest.readUInt32LE(0) || 0x6d2b79f5;
  return {
    next() {
      state |= 0;
      state = Math.imul(state ^ (state >>> 16), 2246822507);
      state = Math.imul(state ^ (state >>> 13), 3266489909);
      state ^= state >>> 16;
      return (state >>> 0) / 4294967296;
    },
  };
}

function normalizedSampleOffsets(sampleCount: number, random: SeededRandom): Array<{ x: number; y: number }> {
  const whole = Math.floor(sampleCount);
  const fraction = sampleCount - whole;
  const resolvedCount = whole + (fraction > 0 && random.next() < fraction ? 1 : 0);
  return Array.from({ length: resolvedCount }, () => ({ x: random.next() * 2 - 1, y: random.next() * 2 - 1 }));
}

function samplePixelInBox(
  image: CompositionRasterImage,
  box: CompositionBox,
  normalized: { x: number; y: number },
  pageBackground?: CompositionRgbColor,
): { x: number; y: number; color?: CompositionRgbColor } {
  // `image` is a discrete pixel buffer. The random point is continuous, but
  // this standalone raster API must choose one source pixel for its color.
  // The returned coordinates are therefore raster coordinates, unlike the
  // page-space coordinates returned by the provider below.
  const x = Math.max(0, Math.min(image.width - 1, Math.floor(box.x + ((normalized.x + 1) / 2) * box.width)));
  const y = Math.max(0, Math.min(image.height - 1, Math.floor(box.y + ((normalized.y + 1) / 2) * box.height)));
  return { x, y, color: pixelAt(image, x, y, pageBackground) };
}

function sampleGlyphFrames(
  glyphs: readonly CompositionGlyphSamplingBox[],
  foreground: CompositionRgbColor,
  sampleCount: number,
  random: SeededRandom,
  samplePoint: (box: CompositionBox, normalized: { x: number; y: number }) => { x: number; y: number; color?: CompositionRgbColor },
): CompositionContrastResult {
  let minimumRatio = Number.POSITIVE_INFINITY;
  let ratioTotal = 0;
  let samples = 0;
  let worstSample: CompositionContrastResult['worstSample'];
  const sampledPoints: NonNullable<CompositionContrastResult['sampledPoints']> = [];
  const glyphResults: CompositionContrastGlyphResult[] = [];
  for (const [glyphIndex, glyph] of glyphs.entries()) {
    const offsets = normalizedSampleOffsets(sampleCount, random);
    let glyphMinimumRatio = Number.POSITIVE_INFINITY;
    let glyphRatioTotal = 0;
    let glyphSampleCount = 0;
    const glyphForeground = validColor(glyph.foreground) ? glyph.foreground : foreground;
    for (const normalized of offsets) {
      const sample = samplePoint(glyph.box, normalized);
      if (!sample.color) return { status: 'unknown', sampleCount: samples, reason: 'unknown-alpha-background' };
      const ratio = contrastRatio(glyphForeground, sample.color);
      ratioTotal += ratio;
      glyphRatioTotal += ratio;
      glyphMinimumRatio = Math.min(glyphMinimumRatio, ratio);
      if (ratio < minimumRatio) {
        minimumRatio = ratio;
        worstSample = { x: sample.x, y: sample.y, ratio };
      }
      sampledPoints.push({ x: sample.x, y: sample.y, glyphIndex, normalizedX: normalized.x, normalizedY: normalized.y, ratio });
      samples += 1;
      glyphSampleCount += 1;
    }
    if (glyphSampleCount > 0) glyphResults.push({ glyphIndex, minimumRatio: glyphMinimumRatio, averageRatio: glyphRatioTotal / glyphSampleCount, sampleCount: glyphSampleCount });
  }
  if (samples === 0) return { status: 'unknown', sampleCount: 0, reason: 'invalid-policy' };
  return {
    status: 'measured',
    minimumRatio,
    averageRatio: ratioTotal / samples,
    sampleCount: samples,
    ...(worstSample ? { worstSample } : {}),
    sampledPoints,
    glyphResults,
  };
}

export function sampleCompositionContrast(image: CompositionRasterImage, options: CompositionContrastSampleOptions): CompositionContrastResult {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || ![3, 4].includes(image.channels) || image.pixels.length < image.width * image.height * image.channels) {
    return { status: 'unknown', sampleCount: 0, reason: 'invalid-image' };
  }
  if (!validRegion(image, options.region)) return { status: 'unknown', sampleCount: 0, reason: 'invalid-region' };
  if (!validColor(options.foreground) || !Number.isFinite(options.sampleCount) || options.sampleCount <= 0) {
    return { status: 'unknown', sampleCount: 0, reason: 'invalid-policy' };
  }

  let minimumRatio = Number.POSITIVE_INFINITY;
  let ratioTotal = 0;
  let worstSample: CompositionContrastResult['worstSample'];
  let samples = 0;
  const sampledPoints: NonNullable<CompositionContrastResult['sampledPoints']> = [];
  const glyphResults: CompositionContrastGlyphResult[] = [];
  const glyphs = options.glyphs?.filter((glyph) => glyph.box.width > 0 && glyph.box.height > 0) ?? [];
  if (options.glyphs !== undefined && glyphs.length === 0) return { status: 'unknown', sampleCount: 0, reason: 'invalid-region' };
  if (glyphs.length > 0) {
    return sampleGlyphFrames(
      glyphs,
      options.foreground,
      options.sampleCount,
      seededRandom(options.sampleSeed ?? 'report-baby-composition'),
      (box, normalized) => samplePixelInBox(image, box, normalized, options.pageBackground),
    );
  }
  const gridSampleCount = Math.max(1, Math.floor(options.sampleCount));
  for (let row = 0; row < gridSampleCount; row += 1) {
    const y = Math.min(image.height - 1, Math.floor(options.region.y + (row + 0.5) * options.region.height / gridSampleCount));
    for (let column = 0; column < gridSampleCount; column += 1) {
      const x = Math.min(image.width - 1, Math.floor(options.region.x + (column + 0.5) * options.region.width / gridSampleCount));
      const background = pixelAt(image, x, y, options.pageBackground);
      if (!background) return { status: 'unknown', sampleCount: samples, reason: 'unknown-alpha-background' };
      const ratio = contrastRatio(options.foreground, background);
      ratioTotal += ratio;
      if (ratio < minimumRatio) {
        minimumRatio = ratio;
        worstSample = { x, y, ratio };
      }
      samples += 1;
    }
  }
  return {
    status: 'measured',
    minimumRatio,
    sampleCount: samples,
    ...(worstSample ? { worstSample } : {}),
  };
}

function intersection(first: CompositionBox, second: CompositionBox): CompositionBox | undefined {
  const x = Math.max(first.x, second.x);
  const y = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  if (right <= x || bottom <= y) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

function pointInBox(box: CompositionBox, x: number, y: number): boolean {
  return x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
}

function backgroundAtPoint(
  x: number,
  y: number,
  graphics: CompositionPlan['graphicPlacements'],
  rasterImages: ReadonlyMap<string, CompositionRasterImage>,
  pageBackground?: CompositionRgbColor,
): CompositionRgbColor | undefined {
  const base = validColor(pageBackground) ? pageBackground : undefined;
  for (const graphic of [...graphics].reverse()) {
    if (graphic.paint === false || graphic.assetId === undefined || !pointInBox(graphic.box, x, y)) continue;
    const image = rasterImages.get(graphic.assetId);
    if (!image) return undefined;
    const painted = fitContainBox(graphic.box, image.width, image.height);
    const pixel = imagePixelAtPoint(painted, image.width, image.height, x, y);
    if (!pixel) continue;
    // `x` and `y` are continuous page coordinates. Only the lookup into the
    // asset's discrete raster is quantized; the caller keeps the original
    // page coordinates for diagnostics and debug rendering.
    return pixelAt(image, pixel.x, pixel.y, pageBackground);
  }
  return base;
}

function aggregateAssessment(
  graphicId: string | undefined,
  assetId: string | undefined,
  page: number,
  regions: CompositionBox[],
  results: CompositionContrastResult[],
): CompositionContrastAssessment {
  const unknown = results.find((result) => result.status === 'unknown');
  const worst = results
    .filter((result) => result.worstSample !== undefined)
    .sort((first, second) => first.worstSample!.ratio - second.worstSample!.ratio)[0];
  const finiteRatios = results.map((result) => result.minimumRatio).filter((ratio): ratio is number => ratio !== undefined);
  const finiteAverageRatios = results.map((result) => result.averageRatio).filter((ratio): ratio is number => ratio !== undefined);
  const glyphResults = results.flatMap((result) => result.glyphResults ?? []);
  return {
    ...(graphicId === undefined ? {} : { graphicId }),
    ...(assetId === undefined ? {} : { assetId }),
    page,
    lineCount: results.length,
    regions,
    status: unknown ? 'unknown' : 'measured',
    ...(finiteRatios.length > 0 ? { minimumRatio: Math.min(...finiteRatios) } : {}),
    ...(finiteAverageRatios.length > 0 ? { averageRatio: finiteAverageRatios.reduce((sum, ratio) => sum + ratio, 0) / finiteAverageRatios.length } : {}),
    sampleCount: results.reduce((sum, result) => sum + result.sampleCount, 0),
    ...(glyphResults.length > 0 ? { glyphResults } : {}),
    ...(worst?.worstSample ? { worstSample: worst.worstSample } : {}),
    ...(unknown?.reason ? { reason: unknown.reason } : {}),
  };
}

export function createCompositionContrastProvider(options: CompositionContrastProviderOptions): CompositionContrastProvider {
  return {
    assess(plan) {
      const lines = [...plan.lines, ...(plan.insertionLines ?? [])];
      const pages = [...new Set(lines.map((line) => line.page))].sort((left, right) => left - right);
      const random = seededRandom(options.sampleSeed ?? 'report-baby-composition');
      return pages.flatMap((page) => {
        const pageLines = lines.filter((line) => line.page === page);
        const hasGlyphFrames = pageLines.some((line) => (line.glyphSamplingBoxes?.length ?? 0) > 0);
        const frames = pageLines.flatMap((line) => line.glyphSamplingBoxes && line.glyphSamplingBoxes.length > 0
          ? line.glyphSamplingBoxes.filter((glyph) => glyph.box.width > 0 && glyph.box.height > 0)
          : [{ box: line.box, baselineY: line.box.y + line.box.height }]);
        if (frames.length === 0) return [];
        const pageGraphics = plan.graphicPlacements.filter((graphic) => graphic.page === page && graphic.paint !== false && graphic.assetId !== undefined);
        if (!validColor(options.pageBackground) && pageGraphics.length === 0) return [];
        const missingRaster = pageGraphics.find((graphic) => !options.rasterImages.has(graphic.assetId!));
        if (missingRaster && frames.some((frame) => intersection(frame.box, missingRaster.box) !== undefined)) {
          return [aggregateAssessment(undefined, undefined, page, frames.map((frame) => frame.box), [{ status: 'unknown', sampleCount: 0, reason: 'asset-raster-missing' }])];
        }
        const sampledWithFrames = sampleGlyphFrames(
          frames,
          options.foreground,
          options.sampleCount,
          random,
          (box, normalized) => {
            const x = box.x + ((normalized.x + 1) / 2) * box.width;
            const y = box.y + ((normalized.y + 1) / 2) * box.height;
            return { x, y, color: backgroundAtPoint(x, y, pageGraphics, options.rasterImages, options.pageBackground) };
          },
        );
        const sampled = hasGlyphFrames ? sampledWithFrames : { ...sampledWithFrames, glyphResults: undefined };
        return [aggregateAssessment(undefined, undefined, page, frames.map((frame) => frame.box), [sampled])];
      });
    },
  };
}
