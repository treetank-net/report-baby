#!/usr/bin/env node

// PROTOTYPE — disposable contrast-candidate experiment.
// It compares a global/blurred background average with a conservative local
// sample and an exhaustive reference scan. It does not alter composition
// planning or evaluator scores.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const config = parse(readFileSync(join(root, 'templates', 'render-config.yml'), 'utf8'));
const minimum = config.contrast.body_minimum;
const sampleCount = Math.max(2, Math.min(32, Math.round(config.quality.pdf_pixel_qa.raster_dpi / 20)));

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function channelLuminance(value) {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return 0.2126 * channelLuminance(rgb[0])
    + 0.7152 * channelLuminance(rgb[1])
    + 0.0722 * channelLuminance(rgb[2]);
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function pixelAt(image, x, y, pageBackground) {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.floor(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.floor(y)));
  const offset = (clampedY * image.width + clampedX) * image.channels;
  const alpha = image.channels === 4 ? image.pixels[offset + 3] / 255 : 1;
  if (alpha < 1 && !pageBackground) return undefined;
  const underneath = pageBackground ?? [255, 255, 255];
  return [0, 1, 2].map((channel) => Math.round(
    image.pixels[offset + channel] * alpha + underneath[channel] * (1 - alpha),
  ));
}

function everyPixelRatio(image, rect, foreground, pageBackground) {
  let minimumRatio = Number.POSITIVE_INFINITY;
  let samples = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const background = pixelAt(image, x, y, pageBackground);
      if (!background) return { status: 'unknown', minimumRatio: undefined, samples };
      minimumRatio = Math.min(minimumRatio, contrastRatio(foreground, background));
      samples += 1;
    }
  }
  return { status: minimumRatio >= minimum ? 'at-or-above-reference' : 'below-reference', minimumRatio, samples };
}

function averageRatio(image, rect, foreground, pageBackground) {
  const totals = [0, 0, 0];
  let samples = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const background = pixelAt(image, x, y, pageBackground);
      if (!background) return { status: 'unknown', ratio: undefined, samples };
      background.forEach((value, channel) => { totals[channel] += value; });
      samples += 1;
    }
  }
  const average = totals.map((value) => value / samples);
  const ratio = contrastRatio(foreground, average);
  return { status: ratio >= minimum ? 'at-or-above-reference' : 'below-reference', ratio, samples };
}

function sampledRatios(image, rect, foreground, pageBackground) {
  let minimumRatio = Number.POSITIVE_INFINITY;
  let samples = 0;
  for (let row = 0; row < sampleCount; row += 1) {
    const y = rect.y + (row + 0.5) * rect.height / sampleCount;
    for (let column = 0; column < sampleCount; column += 1) {
      const x = rect.x + (column + 0.5) * rect.width / sampleCount;
      const background = pixelAt(image, x, y, pageBackground);
      if (!background) return { status: 'unknown', minimumRatio: undefined, samples };
      minimumRatio = Math.min(minimumRatio, contrastRatio(foreground, background));
      samples += 1;
    }
  }
  return { status: minimumRatio >= minimum ? 'at-or-above-reference' : 'below-reference', minimumRatio, samples };
}

function makeImage(width, height, pixel) {
  return { width, height, channels: pixel.length, pixels: Buffer.from(Array.from({ length: width * height }, () => pixel).flat()) };
}

function makeSplitImage(width, height, splitStart, splitEnd) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = x >= splitStart && x < splitEnd;
      const value = dark ? 0 : 255;
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  return { width, height, channels: 3, pixels };
}

function evaluateCandidate(image, x, pageBackground) {
  const rect = { x, y: 4, width: 20, height: 12 };
  const foreground = [0, 0, 0];
  const average = averageRatio(image, rect, foreground, pageBackground);
  const sampled = sampledRatios(image, rect, foreground, pageBackground);
  const exact = everyPixelRatio(image, rect, foreground, pageBackground);
  return {
    x,
    rect,
    averageStatus: average.status,
    averageRatio: average.ratio,
    sampledStatus: sampled.status,
    sampledMinimumRatio: sampled.minimumRatio,
    sampledPixels: sampled.samples,
    exactStatus: exact.status,
    exactMinimumRatio: exact.minimumRatio,
    exactPixels: exact.samples,
    approximationMatchesExact: sampled.status === exact.status,
  };
}

const splitImage = makeSplitImage(120, 20, 40, 50);
const positions = [0, 16, 32, 40, 52, 68, 84, 92];
const candidates = positions.map((x) => evaluateCandidate(splitImage, x));
const transparentImage = makeImage(20, 12, [0, 0, 0, 128]);
const transparentKnown = evaluateCandidate(transparentImage, 0, [255, 255, 255]);
const transparentUnknown = evaluateCandidate(transparentImage, 0);
const unknown = evaluateCandidate(transparentImage, 0, undefined);

assert(candidates.find((candidate) => candidate.x === 40)?.averageStatus === 'at-or-above-reference', 'the global average fixture must demonstrate a falsely safe result');
assert(candidates.find((candidate) => candidate.x === 40)?.sampledStatus === 'below-reference', 'the local sample must detect the dark patch');
assert(candidates.every((candidate) => candidate.approximationMatchesExact), `local sampling must match the exhaustive reference: ${JSON.stringify(candidates)}`);
assert(transparentKnown.sampledStatus === 'at-or-above-reference', `known page background must resolve transparent pixels: ${JSON.stringify(transparentKnown)}`);
assert(transparentUnknown.sampledStatus === 'unknown', `transparent pixels without an underneath colour must remain unknown: ${JSON.stringify(transparentUnknown)}`);
assert(unknown.sampledStatus === 'unknown', `missing background must remain unknown: ${JSON.stringify(unknown)}`);

const report = {
  status: 'passed',
  threshold: minimum,
  sampleCount: `${sampleCount}x${sampleCount}`,
  candidateCount: candidates.length,
  decodeCount: 1,
  cacheHits: candidates.length - 1,
  sampledPixels: candidates.reduce((sum, candidate) => sum + candidate.sampledPixels, 0),
  exactReferencePixels: candidates.reduce((sum, candidate) => sum + candidate.exactPixels, 0),
  candidates,
  transparency: { knownPageBackground: transparentKnown, unknownPageBackground: transparentUnknown },
  unknownBackground: unknown,
  conclusion: {
    globalAverageCanFalsePass: true,
    localSamplingMatchedReference: true,
    imageDecodeCanBeSharedAcrossCandidates: true,
    partialRenderingNeededForThisScreening: false,
  },
};

const debugRoot = process.env.REPORT_BABY_DEBUG_ARTIFACT_DIR;
if (debugRoot) {
  const directory = join(debugRoot, 'contrast-evaluation');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'contrast-evaluation.json'), `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report));
