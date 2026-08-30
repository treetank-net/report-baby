#!/usr/bin/env node

// PROTOTYPE — disposable PNG-level composition QA.
// It checks the rendered artifact independently from the plan evaluator:
// declared image color becomes a shape mask and dark pixels become a coarse
// text-ink mask. The score is a calibrated risk score, not a statistical
// probability until a corpus of accepted and deliberately broken renders is
// used to calibrate it.

import { inflateSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const inputRoot = resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : '/tmp/report-baby-composition-visual-qa-v1');
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-composition-pixel-qa-v1');
const skipMutation = process.argv.includes('--skip-mutation');
const config = parse(readFileSync(join(root, 'templates', 'composition-pixel-qa-prototype.yml'), 'utf8'));

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function clamp(value, lower, upper) {
  return Math.max(lower, Math.min(upper, value));
}

function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG file');
  let offset = 8;
  let header;
  const data = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = {
      width: chunk.readUInt32BE(0),
      height: chunk.readUInt32BE(4),
      depth: chunk[8],
      colorType: chunk[9],
      interlace: chunk[12],
    };
    if (type === 'IDAT') data.push(chunk);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  if (header.depth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.colorType)) {
    throw new Error(`unsupported PNG variant: depth ${header.depth}, color type ${header.colorType}, interlace ${header.interlace}`);
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < header.height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = line[index];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const predicted = left + up - upLeft;
        const distanceLeft = Math.abs(predicted - left);
        const distanceUp = Math.abs(predicted - up);
        const distanceUpLeft = Math.abs(predicted - upLeft);
        value += distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft
          ? left
          : distanceUp <= distanceUpLeft ? up : upLeft;
      }
      current[index] = value & 0xff;
    }
    previous = current;
  }
  return { ...header, channels, stride, pixels };
}

function pixelAt(image, x, y) {
  const offset = y * image.stride + x * image.channels;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function colorDistance(actual, expected) {
  return Math.max(
    Math.abs(actual[0] - expected[0]),
    Math.abs(actual[1] - expected[1]),
    Math.abs(actual[2] - expected[2]),
  );
}

function expectedPixels(image, page, imageSpec, pageSize = config.page) {
  const scaleX = image.width / pageSize.width_mm;
  const scaleY = image.height / pageSize.height_mm;
  const inset = config.mask.inset_px;
  const outerX0 = imageSpec.x * scaleX;
  const outerY0 = imageSpec.y * scaleY;
  const outerX1 = (imageSpec.x + imageSpec.width) * scaleX;
  const outerY1 = (imageSpec.y + imageSpec.height) * scaleY;
  return {
    x0: clamp(Math.round(outerX0) + inset, 0, image.width - 1),
    y0: clamp(Math.round(outerY0) + inset, 0, image.height - 1),
    x1: clamp(Math.round(outerX1) - inset, 0, image.width - 1),
    y1: clamp(Math.round(outerY1) - inset, 0, image.height - 1),
    outerX0,
    outerY0,
    outerX1,
    outerY1,
    color: imageSpec.color,
    page,
  };
}

function insideShape(imageSpec, box, x, y) {
  if (imageSpec.shape === 'star') {
    const points = [];
    const centerX = (box.outerX0 + box.outerX1) / 2;
    const centerY = (box.outerY0 + box.outerY1) / 2;
    for (let index = 0; index < imageSpec.starPoints * 2; index += 1) {
      const radius = index % 2 === 0 ? 1 : imageSpec.starInnerRatio;
      const angle = -Math.PI / 2 + (index * Math.PI) / imageSpec.starPoints;
      points.push([
        centerX + Math.cos(angle) * ((box.outerX1 - box.outerX0) / 2) * radius,
        centerY + Math.sin(angle) * ((box.outerY1 - box.outerY0) / 2) * radius,
      ]);
    }
    let inside = false;
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      const crosses = (first[1] > y + 0.5) !== (second[1] > y + 0.5);
      if (crosses && x + 0.5 < ((second[0] - first[0]) * ((y + 0.5) - first[1])) / (second[1] - first[1]) + first[0]) inside = !inside;
    }
    return inside;
  }
  if (imageSpec.shape === 'triangle') {
    const progress = clamp((y + 0.5 - box.outerY0) / (box.outerY1 - box.outerY0), 0, 1);
    const fraction = imageSpec.apex === 'bottom' ? 1 - progress : progress;
    const relativeX = imageSpec.side === 'left' ? x + 0.5 - box.outerX0 : box.outerX1 - (x + 0.5);
    return relativeX >= 0 && relativeX <= (box.outerX1 - box.outerX0) * fraction;
  }
  if (imageSpec.shape === 'staircase') {
    const fraction = y + 0.5 < box.outerY0 + (box.outerY1 - box.outerY0) / 2
      ? imageSpec.wrapFractions[0]
      : imageSpec.wrapFractions[1];
    const relativeX = imageSpec.side === 'left' ? x + 0.5 - box.outerX0 : box.outerX1 - (x + 0.5);
    return relativeX >= 0 && relativeX <= (box.outerX1 - box.outerX0) * fraction;
  }
  if (imageSpec.shape !== 'ellipse') return true;
  const centerX = (box.outerX0 + box.outerX1) / 2;
  const centerY = (box.outerY0 + box.outerY1) / 2;
  const radiusX = (box.outerX1 - box.outerX0) / 2;
  const radiusY = (box.outerY1 - box.outerY0) / 2;
  const normalizedX = (x + 0.5 - centerX) / radiusX;
  const normalizedY = (y + 0.5 - centerY) / radiusY;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function insideShapeBoundary(imageSpec, box, x, y) {
  const tolerance = config.mask.shape_boundary_tolerance_px;
  for (let offsetY = -tolerance; offsetY <= tolerance; offsetY += 1) {
    for (let offsetX = -tolerance; offsetX <= tolerance; offsetX += 1) {
      if (insideShape(imageSpec, box, x + offsetX, y + offsetY)) return true;
    }
  }
  return false;
}

function analyzeImage(image, page, imageSpec, occluders = [], pageSize = config.page, expectedOccluded = false) {
  const box = expectedPixels(image, page, imageSpec, pageSize);
  const scanX0 = clamp(Math.floor(box.outerX0), 0, image.width - 1);
  const scanY0 = clamp(Math.floor(box.outerY0), 0, image.height - 1);
  const scanX1 = clamp(Math.ceil(box.outerX1) - 1, 0, image.width - 1);
  const scanY1 = clamp(Math.ceil(box.outerY1) - 1, 0, image.height - 1);
  let visibleShapePixels = 0;
  let matchedShapePixels = 0;
  let darkInkPixels = 0;
  let visibleOutsidePixels = 0;
  let matchedOutsidePixels = 0;
  for (let y = scanY0; y <= scanY1; y += 1) {
    for (let x = scanX0; x <= scanX1; x += 1) {
      const pixel = pixelAt(image, x, y);
      if (occluders.some((occluder) => insideShape(occluder.spec, occluder.box, x, y))) continue;
      if (insideShape(imageSpec, box, x, y)) {
        visibleShapePixels += 1;
        if (colorDistance(pixel, box.color) <= config.mask.color_tolerance) matchedShapePixels += 1;
        if (Math.max(...pixel) <= config.mask.dark_ink_max_channel) darkInkPixels += 1;
      } else if (!insideShapeBoundary(imageSpec, box, x, y)) {
        visibleOutsidePixels += 1;
        if (colorDistance(pixel, box.color) <= config.mask.color_tolerance) matchedOutsidePixels += 1;
      }
    }
  }
  const shapeCoverage = visibleShapePixels ? matchedShapePixels / visibleShapePixels : (expectedOccluded ? 1 : 0);
  const outsideShapeRatio = visibleOutsidePixels ? matchedOutsidePixels / visibleOutsidePixels : 0;
  const inkOverlapRatio = visibleShapePixels ? darkInkPixels / visibleShapePixels : 0;
  const riskScore = clamp(
    (inkOverlapRatio - config.mask.clean_overlap_floor)
      / (config.mask.fail_overlap_ratio - config.mask.clean_overlap_floor),
    0,
    1,
  );
  return {
    image: imageSpec.id,
    page: page + 1,
    bboxPx: { x: box.x0, y: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 },
    expectedOccluded,
    shapeCoverage,
    outsideShapeRatio,
    inkOverlapRatio,
    riskScore,
    classification: riskScore >= 1 ? 'failed' : riskScore > 0 ? 'suspicious' : 'safe',
    shapePass: (expectedOccluded || shapeCoverage >= config.mask.minimum_shape_coverage)
      && outsideShapeRatio <= config.mask.maximum_outside_shape_ratio,
    outsideShapePass: outsideShapeRatio <= config.mask.maximum_outside_shape_ratio,
    overlapPass: riskScore < 1
      && (!config.mask.fail_suspicious_overlap || riskScore === 0),
  };
}

function analyzeZOrder(image, pageIndex, plan, pageSize) {
  const order = plan.qa?.zOrder ?? [];
  const byId = new Map(plan.images.map((imageSpec) => [imageSpec.id, imageSpec]));
  const checks = [];
  const errors = [];
  for (let index = 0; index < order.length - 1; index += 1) {
    const bottom = byId.get(order[index]);
    const top = byId.get(order[index + 1]);
    if (!bottom || !top || bottom.page !== pageIndex || top.page !== pageIndex) continue;
    const bottomBox = expectedPixels(image, pageIndex, bottom, pageSize);
    const topBox = expectedPixels(image, pageIndex, top, pageSize);
    const x0 = Math.max(0, Math.floor(Math.max(bottomBox.outerX0, topBox.outerX0)));
    const y0 = Math.max(0, Math.floor(Math.max(bottomBox.outerY0, topBox.outerY0)));
    const x1 = Math.min(image.width - 1, Math.ceil(Math.min(bottomBox.outerX1, topBox.outerX1)) - 1);
    const y1 = Math.min(image.height - 1, Math.ceil(Math.min(bottomBox.outerY1, topBox.outerY1)) - 1);
    let overlapPixels = 0;
    let topColorPixels = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!insideShape(bottom, bottomBox, x, y) || !insideShape(top, topBox, x, y)) continue;
        const pixel = pixelAt(image, x, y);
        overlapPixels += 1;
        if (colorDistance(pixel, topBox.color) <= config.mask.color_tolerance) topColorPixels += 1;
      }
    }
    const topColorRatio = overlapPixels ? topColorPixels / overlapPixels : 0;
    const check = { bottom: bottom.id, top: top.id, page: pageIndex + 1, overlapPixels, topColorPixels, topColorRatio };
    checks.push(check);
    if (overlapPixels >= config.z_order.minimum_overlap_pixels && topColorRatio < config.z_order.minimum_top_color_ratio) {
      errors.push({ code: 'Z_ORDER_TOP_COLOR_MISMATCH', ...check });
    }
  }
  return { checks, errors };
}

function zOrderMutationGate(directory) {
  const plan = loadPlan(directory);
  const pageSize = plan.pageSize ?? config.page;
  const order = plan.qa?.zOrder ?? [];
  assert(plan.status !== 'rejected' && order.length >= 2, 'Z-order mutation gate needs an accepted ordered image fixture');
  const byId = new Map(plan.images.map((imageSpec) => [imageSpec.id, imageSpec]));
  const testedPairs = [];
  for (let index = 0; index < order.length - 1; index += 1) {
    const bottom = byId.get(order[index]);
    const top = byId.get(order[index + 1]);
    if (!bottom || !top || bottom.page !== top.page) continue;
    const pageIndex = bottom.page;
    const file = join(directory, `page-${pageIndex + 1}.png`);
    const decoded = decodePng(readFileSync(file));
    const mutated = { ...decoded, pixels: Buffer.from(decoded.pixels) };
    const bottomBox = expectedPixels(mutated, pageIndex, bottom, pageSize);
    const topBox = expectedPixels(mutated, pageIndex, top, pageSize);
    const x0 = Math.max(0, Math.floor(Math.max(bottomBox.outerX0, topBox.outerX0)));
    const y0 = Math.max(0, Math.floor(Math.max(bottomBox.outerY0, topBox.outerY0)));
    const x1 = Math.min(mutated.width - 1, Math.ceil(Math.min(bottomBox.outerX1, topBox.outerX1)) - 1);
    const y1 = Math.min(mutated.height - 1, Math.ceil(Math.min(bottomBox.outerY1, topBox.outerY1)) - 1);
    let overlapPixels = 0;
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if (!insideShape(bottom, bottomBox, x, y) || !insideShape(top, topBox, x, y)) continue;
        const offset = y * mutated.stride + x * mutated.channels;
        mutated.pixels[offset] = bottom.color[0];
        mutated.pixels[offset + 1] = bottom.color[1];
        mutated.pixels[offset + 2] = bottom.color[2];
        overlapPixels += 1;
      }
    }
    if (overlapPixels < config.z_order.mutation_minimum_overlap_pixels) {
      testedPairs.push({ bottom: bottom.id, top: top.id, overlapPixels, status: 'no-raster-overlap' });
      continue;
    }
    const result = analyzeZOrder(mutated, pageIndex, plan, pageSize);
    const pairCheck = result.checks.find((check) => check.bottom === bottom.id && check.top === top.id);
    assert(pairCheck && pairCheck.topColorRatio < config.z_order.minimum_top_color_ratio, `Z-order mutation gate did not detect inverted layer pair ${bottom.id} -> ${top.id}: ${JSON.stringify(result)}`);
    testedPairs.push({ bottom: bottom.id, top: top.id, overlapPixels, detected: true });
  }
  return {
    pairs: testedPairs,
    detected: testedPairs.some((pair) => pair.detected),
    status: testedPairs.some((pair) => pair.detected) ? 'passed' : 'no-raster-overlap',
  };
}

function pageFiles(directory) {
  return readdirSync(directory)
    .filter((name) => /^page-\d+\.png$/u.test(name))
    .sort((a, b) => Number(a.match(/\d+/u)[0]) - Number(b.match(/\d+/u)[0]));
}

function planDirectories() {
  return readdirSync(inputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(inputRoot, entry.name))
    .filter((directory) => {
      try {
        readFileSync(join(directory, 'plan.json'));
        return true;
      } catch {
        return false;
      }
    });
}

function loadPlan(directory) {
  return JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
}

function plannedWrapSteps(plan) {
  const grouped = new Map();
  for (const line of plan.lines) {
    if (!line.wrap?.imageId) continue;
    const imageIds = line.wrap.imageIds ?? [line.wrap.imageId];
    const key = `${line.page}:${imageIds.join('+')}`;
    const steps = grouped.get(key) ?? [];
    const previous = steps.at(-1);
    if (!previous || Math.abs(previous.availableX - line.wrap.availableX) > config.mask.wrap_coordinate_tolerance_mm) {
      steps.push({
        image: imageIds,
        page: line.page + 1,
        availableX: line.wrap.availableX,
        availableWidth: line.wrap.availableWidth,
        firstY: line.y,
        lastY: line.y,
        lines: 1,
      });
    } else {
      previous.lastY = line.y;
      previous.lines += 1;
    }
    grouped.set(key, steps);
  }
  return [...grouped.values()].flat();
}

function analyzePlan(directory) {
  const plan = loadPlan(directory);
  const pageSize = plan.pageSize ?? config.page;
  const files = pageFiles(directory);
  const errors = [];
  const expectedRejected = plan.status === 'rejected';
  if (expectedRejected) {
    if (files.length) errors.push({ code: 'REJECTED_PNG_PRESENT', files });
    return { fixture: plan.fixture, status: plan.status, pages: files.length, plannedWrapSteps: plannedWrapSteps(plan), images: [], errors };
  }
  if (files.length !== plan.pages.length) errors.push({ code: 'PNG_PAGE_COUNT_MISMATCH', expected: plan.pages.length, actual: files.length });
  const decoded = files.map((file) => decodePng(readFileSync(join(directory, file))));
  for (const [index, image] of decoded.entries()) {
    if (image.width / config.page.width_mm !== decoded[0].width / config.page.width_mm) errors.push({ code: 'INCONSISTENT_PNG_SCALE', page: index + 1 });
    if (image.width !== decoded[0]?.width || image.height !== decoded[0]?.height) errors.push({ code: 'PNG_DIMENSION_MISMATCH', page: index + 1 });
  }
  const imageResults = [];
  for (const imageSpec of plan.images) {
    const pageIndex = imageSpec.page;
    const page = decoded[pageIndex];
    if (!page) {
      errors.push({ code: 'IMAGE_PAGE_PNG_MISSING', image: imageSpec.id, page: pageIndex + 1 });
      continue;
    }
    const imageIndex = plan.images.indexOf(imageSpec);
    const occluders = plan.images.slice(imageIndex + 1)
      .filter((candidate) => candidate.page === pageIndex)
      .map((candidate) => ({ spec: candidate, box: expectedPixels(page, pageIndex, candidate, pageSize) }));
    const expectedOccluded = plan.qa?.occluded?.includes(imageSpec.id) ?? false;
    const result = analyzeImage(page, pageIndex, imageSpec, occluders, pageSize, expectedOccluded);
    imageResults.push(result);
    if (!result.shapePass) errors.push({ code: 'IMAGE_MASK_NOT_FOUND', image: imageSpec.id, coverage: result.shapeCoverage });
    if (!result.outsideShapePass) {
      errors.push({
        code: 'IMAGE_RENDERED_OUTSIDE_DECLARED_SHAPE',
        image: imageSpec.id,
        outsideShapeRatio: result.outsideShapeRatio,
      });
    }
    if (!result.overlapPass) errors.push({ code: 'PIXEL_TEXT_SHAPE_OVERLAP', image: imageSpec.id, riskScore: result.riskScore, inkOverlapRatio: result.inkOverlapRatio });
  }
  const zOrderResults = decoded.map((image, pageIndex) => analyzeZOrder(image, pageIndex, plan, pageSize));
  const zOrder = zOrderResults.flatMap((result) => result.checks);
  for (const result of zOrderResults) errors.push(...result.errors);
  return { fixture: plan.fixture, status: plan.status, pages: files.length, plannedWrapSteps: plannedWrapSteps(plan), images: imageResults, zOrder, errors };
}

function mutationGate(directory) {
  const plan = loadPlan(directory);
  const pageSize = plan.pageSize ?? config.page;
  assert(plan.status !== 'rejected' && plan.images.length > 0, 'Mutation gate needs an accepted fixture with an image');
  const imageSpec = plan.images[0];
  const file = join(directory, `page-${imageSpec.page + 1}.png`);
  const decoded = decodePng(readFileSync(file));
  const mutated = { ...decoded, pixels: Buffer.from(decoded.pixels) };
  const box = expectedPixels(mutated, imageSpec.page, imageSpec, pageSize);
  const width = Math.min(config.mask.mutation_patch_width_px, box.x1 - box.x0 + 1);
  const height = Math.min(config.mask.mutation_patch_height_px, box.y1 - box.y0 + 1);
  const x0 = box.x0 + Math.floor((box.x1 - box.x0 + 1 - width) / 2);
  const y0 = box.y0 + Math.floor((box.y1 - box.y0 + 1 - height) / 2);
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      const offset = y * mutated.stride + x * mutated.channels;
      mutated.pixels[offset] = 0;
      mutated.pixels[offset + 1] = 0;
      mutated.pixels[offset + 2] = 0;
    }
  }
  const result = analyzeImage(mutated, imageSpec.page, imageSpec, [], pageSize);
  assert(result.riskScore >= 1, `Mutation gate did not detect injected overlap: ${JSON.stringify(result)}`);
  return { image: imageSpec.id, riskScore: result.riskScore, inkOverlapRatio: result.inkOverlapRatio };
}

function main() {
  mkdirSync(outputRoot, { recursive: true });
  const fixtures = planDirectories().map(analyzePlan).sort((a, b) => a.fixture.localeCompare(b.fixture));
  assert(fixtures.length > 0, `No plan.json files found in ${inputRoot}`);
  const mutationDirectory = planDirectories().find((directory) => {
    const plan = loadPlan(directory);
    return plan.status !== 'rejected' && plan.images.length > 0;
  });
  if (!skipMutation) assert(mutationDirectory, `No accepted image fixture available for mutation gate in ${inputRoot}`);
  const mutation = mutationDirectory ? mutationGate(mutationDirectory) : { status: 'skipped', reason: 'no accepted image fixture' };
  const zOrderDirectories = planDirectories().filter((directory) => {
    const plan = loadPlan(directory);
    return plan.status !== 'rejected' && (plan.qa?.zOrder?.length ?? 0) >= 2;
  });
  const zOrderMutation = zOrderDirectories.length
    ? { fixtures: zOrderDirectories.map(zOrderMutationGate), detected: true }
    : { status: 'skipped', reason: 'no accepted ordered image fixture' };
  const report = {
    status: fixtures.some((fixture) => fixture.errors.length) ? 'failed' : 'passed',
    inputRoot,
    config: 'server/templates/composition-pixel-qa-prototype.yml',
    interpretation: 'riskScore is a calibrated heuristic, not a statistical probability',
    fixtures,
    mutationGate: { ...mutation, status: mutation.status ?? 'passed' },
    zOrderMutationGate: { ...zOrderMutation, status: zOrderMutation.status ?? 'passed' },
  };
  writeFileSync(join(outputRoot, 'pixel-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, fixtures: fixtures.length, errors: fixtures.reduce((sum, fixture) => sum + fixture.errors.length, 0), mutationGate: report.mutationGate.status, report: join(outputRoot, 'pixel-qa-report.json') }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main();
