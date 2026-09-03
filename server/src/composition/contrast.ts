import type { CompositionBox } from './engine.js';

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
