import type { CompositionBox, CompositionPlan } from './engine.js';

export type CompositionContrastStatus = 'pass' | 'fail' | 'unknown';

export interface CompositionRasterImage {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Uint8Array;
}

export type CompositionRgbColor = [number, number, number];

export interface CompositionContrastSampleOptions {
  region: CompositionBox;
  foreground: CompositionRgbColor;
  minimumRatio: number;
  sampleCount: number;
  pageBackground?: CompositionRgbColor;
}

export interface CompositionContrastResult {
  status: CompositionContrastStatus;
  minimumRatio?: number;
  sampleCount: number;
  worstSample?: { x: number; y: number; ratio: number };
  reason?: 'invalid-image' | 'invalid-region' | 'invalid-policy' | 'unknown-alpha-background';
}

export interface CompositionContrastAssessment {
  graphicId: string;
  assetId: string;
  page: number;
  lineCount: number;
  regions: CompositionBox[];
  status: CompositionContrastStatus;
  requiredRatio: number;
  minimumRatio?: number;
  sampleCount: number;
  worstSample?: { x: number; y: number; ratio: number };
  reason?: CompositionContrastResult['reason'] | 'asset-raster-missing';
}

export interface CompositionContrastProviderOptions {
  rasterImages: ReadonlyMap<string, CompositionRasterImage>;
  foreground: CompositionRgbColor;
  minimumRatio: number;
  sampleCount: number;
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

export function sampleCompositionContrast(image: CompositionRasterImage, options: CompositionContrastSampleOptions): CompositionContrastResult {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || ![3, 4].includes(image.channels) || image.pixels.length < image.width * image.height * image.channels) {
    return { status: 'unknown', sampleCount: 0, reason: 'invalid-image' };
  }
  if (!validRegion(image, options.region)) return { status: 'unknown', sampleCount: 0, reason: 'invalid-region' };
  if (!validColor(options.foreground) || !Number.isFinite(options.minimumRatio) || options.minimumRatio <= 0 || !Number.isInteger(options.sampleCount) || options.sampleCount < 1) {
    return { status: 'unknown', sampleCount: 0, reason: 'invalid-policy' };
  }

  let minimumRatio = Number.POSITIVE_INFINITY;
  let worstSample: CompositionContrastResult['worstSample'];
  let samples = 0;
  for (let row = 0; row < options.sampleCount; row += 1) {
    const y = Math.min(image.height - 1, Math.floor(options.region.y + (row + 0.5) * options.region.height / options.sampleCount));
    for (let column = 0; column < options.sampleCount; column += 1) {
      const x = Math.min(image.width - 1, Math.floor(options.region.x + (column + 0.5) * options.region.width / options.sampleCount));
      const background = pixelAt(image, x, y, options.pageBackground);
      if (!background) return { status: 'unknown', sampleCount: samples, reason: 'unknown-alpha-background' };
      const ratio = contrastRatio(options.foreground, background);
      if (ratio < minimumRatio) {
        minimumRatio = ratio;
        worstSample = { x, y, ratio };
      }
      samples += 1;
    }
  }
  return {
    status: minimumRatio >= options.minimumRatio ? 'pass' : 'fail',
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

function paintedImageBox(graphic: { box: CompositionBox }, image: CompositionRasterImage): CompositionBox {
  const scale = Math.min(graphic.box.width / image.width, graphic.box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: graphic.box.x + (graphic.box.width - width) / 2,
    y: graphic.box.y + (graphic.box.height - height) / 2,
    width,
    height,
  };
}

function imageRegion(pageRegion: CompositionBox, painted: CompositionBox, image: CompositionRasterImage): CompositionBox {
  return {
    x: (pageRegion.x - painted.x) * image.width / painted.width,
    y: (pageRegion.y - painted.y) * image.height / painted.height,
    width: pageRegion.width * image.width / painted.width,
    height: pageRegion.height * image.height / painted.height,
  };
}

function aggregateAssessment(
  graphicId: string,
  assetId: string,
  page: number,
  regions: CompositionBox[],
  results: CompositionContrastResult[],
  requiredRatio: number,
): CompositionContrastAssessment {
  const failing = results.find((result) => result.status === 'fail');
  const unknown = results.find((result) => result.status === 'unknown');
  const worst = results
    .filter((result) => result.worstSample !== undefined)
    .sort((first, second) => first.worstSample!.ratio - second.worstSample!.ratio)[0];
  const finiteRatios = results.map((result) => result.minimumRatio).filter((ratio): ratio is number => ratio !== undefined);
  return {
    graphicId,
    assetId,
    page,
    lineCount: results.length,
    regions,
    status: failing ? 'fail' : unknown ? 'unknown' : 'pass',
    requiredRatio,
    ...(finiteRatios.length > 0 ? { minimumRatio: Math.min(...finiteRatios) } : {}),
    sampleCount: results.reduce((sum, result) => sum + result.sampleCount, 0),
    ...(worst?.worstSample ? { worstSample: worst.worstSample } : {}),
    ...(failing?.reason ? { reason: failing.reason } : unknown?.reason ? { reason: unknown.reason } : {}),
  };
}

export function createCompositionContrastProvider(options: CompositionContrastProviderOptions): CompositionContrastProvider {
  return {
    assess(plan) {
      const lines = [...plan.lines, ...(plan.insertionLines ?? [])];
      return plan.graphicPlacements.flatMap((graphic) => {
        if (graphic.paint === false || graphic.assetId === undefined) return [];
        const image = options.rasterImages.get(graphic.assetId);
        const painted = image ? paintedImageBox(graphic, image) : graphic.box;
        const pageRegions = lines
          .filter((line) => line.page === graphic.page)
          .map((line) => intersection(line.box, painted))
          .filter((region): region is CompositionBox => region !== undefined);
        if (pageRegions.length === 0) return [];
        if (!image) {
          return [{
            graphicId: graphic.graphicId,
            assetId: graphic.assetId,
            page: graphic.page,
            lineCount: pageRegions.length,
            regions: pageRegions,
            status: 'unknown' as const,
            requiredRatio: options.minimumRatio,
            sampleCount: 0,
            reason: 'asset-raster-missing' as const,
          }];
        }
        const results = pageRegions.map((region) => sampleCompositionContrast(image, {
          region: imageRegion(region, painted, image),
          foreground: options.foreground,
          minimumRatio: options.minimumRatio,
          sampleCount: options.sampleCount,
          ...(options.pageBackground === undefined ? {} : { pageBackground: options.pageBackground }),
        }));
        return [aggregateAssessment(graphic.graphicId, graphic.assetId, graphic.page, pageRegions, results, options.minimumRatio)];
      });
    },
  };
}
