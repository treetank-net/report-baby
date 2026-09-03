#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runProcess } from './lib/process.mjs';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';
import { inspectColumnBalance, readPdfLayout } from './lib/pdf-layout-diff.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-editorial-numbered-'));
const shadowBundle = join(temporary, 'shadow.cjs');
const backendBundle = join(temporary, 'composition.cjs');
const primitivesBundle = join(temporary, 'primitives.cjs');
const templateBundle = join(temporary, 'template.cjs');
const geometryBundle = join(temporary, 'geometry.cjs');
const debugArtifactDirectory = process.env.REPORT_BABY_DEBUG_ARTIFACT_DIR
  ? join(process.env.REPORT_BABY_DEBUG_ARTIFACT_DIR, 'editorial-numbered-flow')
  : undefined;

function plannedLines(plan) {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function assertFlowBarrierBoxCandidates(result) {
  const candidates = result.plan.flowBarrierBoxCandidates ?? [];
  assert.ok(candidates.length > 0, 'editorial plan must expose flow barrier box candidates');
  assert.ok(result.plan.decisions.some((decision) => decision.code === 'FLOW_BARRIER_BOXES_CONSUMED'), 'editorial planner must consume flow barrier box candidates while wrapping text');
  for (const candidate of candidates) {
    assert.equal(typeof candidate.flowId, 'string');
    assert.ok(candidate.previousSourceId || candidate.nextSourceId);
    assert.ok(candidate.box.width > 0 && candidate.box.height > 0, `flow barrier box candidate must have a positive box: ${JSON.stringify(candidate)}`);
    for (const sourceId of [candidate.previousSourceId, candidate.nextSourceId].filter(Boolean)) {
      const source = result.plan.graphicPlacements.find((graphic) => graphic.graphicId === sourceId && graphic.page === candidate.page);
      assert.ok(source, `flow barrier box candidate must reference an existing graphic: ${JSON.stringify(candidate)}`);
    }
    const placement = result.plan.flowPlacements.find((flowPlacement) => flowPlacement.id === candidate.placementId && flowPlacement.page === candidate.page);
    assert.ok(placement, `flow barrier box candidate must reference an existing flow placement: ${JSON.stringify(candidate)}`);
    assert.ok(candidate.box.x >= placement.box.x && candidate.box.x + candidate.box.width <= placement.box.x + placement.box.width);
    assert.ok(candidate.box.y >= placement.box.y && candidate.box.y + candidate.box.height <= placement.box.y + placement.box.height);
  }
  assert.ok(candidates.some((candidate) => candidate.flowId === 'main' && (candidate.previousSourceId?.startsWith('insertion:') || candidate.nextSourceId?.startsWith('insertion:'))), 'editorial main flow must expose at least one insertion candidate');
}

function assertOrdinaryLinesRespectFlowBarrierBoxCandidates(result) {
  const candidatesByPlacement = new Map();
  for (const candidate of result.plan.flowBarrierBoxCandidates ?? []) {
    const group = candidatesByPlacement.get(candidate.placementId) ?? [];
    group.push(candidate);
    candidatesByPlacement.set(candidate.placementId, group);
  }
  for (const placement of result.plan.flowPlacements ?? []) {
    const candidates = candidatesByPlacement.get(placement.id);
    if (!candidates) continue;
    const lines = result.plan.lines.filter((line) => line.page === placement.page && line.slotId === placement.slotId);
    for (const line of lines) {
      assert.ok(candidates.some((candidate) => line.box.y >= candidate.box.y
        && line.box.y + line.box.height <= candidate.box.y + candidate.box.height),
      `ordinary line escaped its consumed flow barrier candidate: ${JSON.stringify({ line, candidates })}`);
    }
  }
}

function build(entry, output, extra = []) {
  const result = runProcess('npx', [
    'esbuild', entry, '--bundle', '--platform=node', '--target=node18', '--format=cjs', ...extra, `--outfile=${output}`,
  ], { cwd: root, timeout: 30_000 });
  if (result.status !== 0) throw new Error(`numbered-flow bundle '${entry}' failed: ${result.stderr || result.stdout}`);
}

build('src/composition/report-shadow.ts', shadowBundle);
build('src/composition/index.ts', backendBundle);
build('src/render-primitives.ts', primitivesBundle, ['--loader:.wasm=binary', '--loader:.ttf=binary']);
build('src/template-contract.ts', templateBundle);
build('src/page-geometry.ts', geometryBundle);

function numberedTokens(text, prefixes) {
  const pattern = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  return [...text.matchAll(new RegExp(`\\b(?:${pattern})\\d{4}\\b`, 'gu'))].map((match) => match[0]);
}

function numbers(tokens) {
  return tokens.map((token) => Number(token.match(/\d{4}$/u)?.[0]));
}

function pdfWords(path) {
  const result = runProcess('pdftotext', ['-bbox-layout', path, '-']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const words = [];
  let page = 0;
  for (const pageMatch of result.stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu)) {
    for (const wordMatch of pageMatch[1].matchAll(/<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gu)) {
      words.push({ page, xMin: Number(wordMatch[1]), yMin: Number(wordMatch[2]), xMax: Number(wordMatch[3]), yMax: Number(wordMatch[4]), text: wordMatch[5].replace(/<[^>]+>/gu, '') });
    }
    page += 1;
  }
  return words;
}

function normalizedPdfToken(value) {
  return value.toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, '');
}

function assertRenderedHeaderLinesStayInsidePlan(pdfPath, result, toleranceMm) {
  const words = pdfWords(pdfPath).filter((word) => word.page === 0);
  const titleLines = result.plan.lines.filter((line) => line.flowId === 'header' && line.blockId === 'header-overflow-title');
  assert.ok(titleLines.length > 0, 'header overflow regression must produce planned title lines');
  const pointPerMm = 72 / 25.4;
  const tolerance = toleranceMm * pointPerMm;
  for (const line of titleLines) {
    const expected = line.text.split(/\s+/u).map(normalizedPdfToken).filter(Boolean);
    const actual = words.filter((word) => expected.includes(normalizedPdfToken(word.text)));
    assert.equal(actual.length, expected.length, `PDF must retain every word from header line '${line.text}'`);
    const left = line.box.x * pointPerMm - tolerance;
    const right = (line.box.x + line.box.width) * pointPerMm + tolerance;
    assert.ok(actual.every((word) => word.xMin >= left && word.xMax <= right), `rendered header line escaped its plan box: ${JSON.stringify({ line, actual, left, right })}`);
  }
}

function assertRenderedHeaderMetaStaysInsidePlan(pdfPath, result, toleranceMm) {
  const words = pdfWords(pdfPath).filter((word) => word.page === 0);
  const metaLine = result.plan.lines.find((line) => line.flowId === 'header' && line.blockId === 'header-meta');
  assert.ok(metaLine, 'header metadata regression must produce a planned metadata line');
  const expected = metaLine.text.split(/\s+/u).map(normalizedPdfToken).filter(Boolean);
  const actual = words.filter((word) => expected.includes(normalizedPdfToken(word.text)));
  assert.equal(actual.length, expected.length, `PDF must retain every word from header metadata '${metaLine.text}'`);
  const pointPerMm = 72 / 25.4;
  const tolerance = toleranceMm * pointPerMm;
  const left = metaLine.box.x * pointPerMm - tolerance;
  const top = metaLine.box.y * pointPerMm - tolerance;
  const right = (metaLine.box.x + metaLine.box.width) * pointPerMm + tolerance;
  const bottom = (metaLine.box.y + metaLine.box.height) * pointPerMm + tolerance;
  assert.ok(actual.every((word) => word.xMin >= left && word.xMax <= right && word.yMin >= top && word.yMax <= bottom), `rendered header metadata escaped its plan box: ${JSON.stringify({ metaLine, actual, left, top, right, bottom })}`);
}

function decodePpm(buffer) {
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'P6', 'raster output must be an RGB PPM');
  let offset = 2;
  const token = () => {
    while (offset < buffer.length && /\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 35) {
      while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      return token();
    }
    const start = offset;
    while (offset < buffer.length && !/\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
    return buffer.subarray(start, offset).toString('ascii');
  };
  const width = Number(token());
  const height = Number(token());
  const maxValue = Number(token());
  while (offset < buffer.length && /\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
  assert.equal(maxValue, 255, 'raster output must use 8-bit RGB channels');
  const pixels = buffer.subarray(offset);
  assert.ok(pixels.length >= width * height * 3, `raster output is truncated: ${pixels.length} < ${width * height * 3}`);
  return { width, height, pixels };
}

function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 3;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function inkProfileInBox(image, box, pageSize, qa) {
  const scaleX = image.width / pageSize.width;
  const scaleY = image.height / pageSize.height;
  const inset = qa.rectangle_inset_px;
  const x0 = Math.max(0, Math.floor(box.x * scaleX) + inset);
  const y0 = Math.max(0, Math.floor(box.y * scaleY) + inset);
  const x1 = Math.min(image.width - 1, Math.ceil((box.x + box.width) * scaleX) - inset);
  const y1 = Math.min(image.height - 1, Math.ceil((box.y + box.height) * scaleY) - inset);
  const background = pixelAt(image, 0, 0);
  let count = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const rowInk = [];
  for (let y = y0; y <= y1; y += 1) {
    let rowCount = 0;
    let rowMinX = Number.POSITIVE_INFINITY;
    let rowMaxX = Number.NEGATIVE_INFINITY;
    for (let x = x0; x <= x1; x += 1) {
      const pixel = pixelAt(image, x, y);
      const isInk = Math.max(
        Math.abs(pixel[0] - background[0]),
        Math.abs(pixel[1] - background[1]),
        Math.abs(pixel[2] - background[2]),
      ) >= qa.background_delta_min;
      if (isInk) {
        count += 1;
        rowCount += 1;
        rowMinX = Math.min(rowMinX, x);
        rowMaxX = Math.max(rowMaxX, x);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (rowCount > 0) rowInk.push({ y, inkPixels: rowCount, minX: rowMinX, maxX: rowMaxX });
  }
  const bands = [];
  for (const row of rowInk) {
    const previous = bands.at(-1);
    if (previous && row.y === previous.endY + 1) {
      previous.endY = row.y;
      previous.inkPixels += row.inkPixels;
      previous.minX = Math.min(previous.minX, row.minX);
      previous.maxX = Math.max(previous.maxX, row.maxX);
    } else bands.push({ startY: row.y, endY: row.y, inkPixels: row.inkPixels, minX: row.minX, maxX: row.maxX });
  }
  const toMm = (value, scale) => value / scale;
  const boxMm = {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
  return {
    status: count === 0 ? 'empty' : 'occupied',
    inkPixels: count,
    boxMm,
    boundsPx: count === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    boundsMm: count === 0 ? null : {
      x: toMm(minX, scaleX),
      y: toMm(minY, scaleY),
      width: toMm(maxX - minX + 1, scaleX),
      height: toMm(maxY - minY + 1, scaleY),
    },
    rowBands: bands.map((band) => ({
      x: toMm(band.minX ?? minX, scaleX),
      y: toMm(band.startY, scaleY),
      width: toMm((band.maxX ?? maxX) - (band.minX ?? minX) + 1, scaleX),
      height: toMm(band.endY - band.startY + 1, scaleY),
      inkPixels: band.inkPixels,
    })),
  };
}

function inkPixelsInBox(image, box, pageSize, qa) {
  return inkProfileInBox(image, box, pageSize, qa).inkPixels;
}

async function assertRenderedInk(artifactPath, result, geometry, renderConfig, directory) {
  const qa = renderConfig.quality.pdf_pixel_qa;
  assert.ok(qa && Number.isFinite(qa.raster_dpi), 'render config must define quality.pdf_pixel_qa');
  const rasterDirectory = await mkdtemp(join(temporary, 'ink-raster-'));
  const prefix = join(rasterDirectory, 'page');
  const raster = runProcess('pdftoppm', [
    '-f', '1',
    '-l', String(result.plan.pages.length),
    '-r', String(qa.raster_dpi),
    artifactPath,
    prefix,
  ], { cwd: root, timeout: 30_000 });
  assert.equal(raster.status, 0, raster.stderr || raster.stdout);

  const images = result.plan.pages.map((page) => {
    const path = `${prefix}-${page.page}.ppm`;
    return { page: page.page, image: decodePpm(readFileSync(path)) };
  });
  const checks = [];
  const mainLines = plannedLines(result.plan).filter((line) => !line.blockId.startsWith('header') && !line.blockId.startsWith('footer'));
  for (const line of mainLines) {
    const image = images.find((candidate) => candidate.page === line.page)?.image;
    assert.ok(image, `missing raster page ${line.page}`);
    const profile = inkProfileInBox(image, line.box, geometry, qa);
    const check = { page: line.page, blockId: line.blockId, slotId: line.slotId, startWord: line.startWord, endWord: line.endWord, ...profile };
    checks.push(check);
    assert.ok(profile.boxMm && profile.boundsMm && profile.rowBands.length > 0, `planned line has no positional ink profile: ${JSON.stringify(check)}`);
    assert.ok(profile.inkPixels >= qa.minimum_ink_pixels, `planned line has no rendered ink: ${JSON.stringify(check)}`);
  }

  const slotChecks = result.plan.slots
    .filter((slot) => slot.id.includes(':segment-') || slot.id.endsWith(':intro') || slot.id.includes(':quote-'))
    .filter((slot) => !slot.id.includes(':quote-') || result.plan.graphicPlacements.some((graphic) => graphic.slotId === slot.id && graphic.wrap === 'around') || mainLines.some((line) => line.slotId === slot.id))
    .map((slot) => {
      const lines = mainLines.filter((line) => line.slotId === slot.id);
      const image = images.find((candidate) => candidate.page === slot.page)?.image;
      assert.ok(image, `missing raster page ${slot.page}`);
      return {
        page: slot.page,
        slotId: slot.id,
        state: slot.state,
        lineCount: lines.length,
        ...inkProfileInBox(image, slot.box, geometry, qa),
      };
    });
  for (const check of slotChecks.filter((item) => item.lineCount > 0)) {
    assert.ok(check.boxMm && check.boundsMm && check.rowBands.length > 0, `planned text slot has no positional ink profile: ${JSON.stringify(check)}`);
    assert.ok(check.inkPixels >= qa.minimum_ink_pixels, `planned text slot is visually empty: ${JSON.stringify(check)}`);
  }
  const report = {
    coordinateSystem: {
      unit: 'mm',
      origin: 'top-left of page',
      pageWidth: geometry.width,
      pageHeight: geometry.height,
      note: 'boxMm and boundsMm are page coordinates; rowBands are occupied raster runs within boxMm',
    },
    rasterDpi: qa.raster_dpi,
    backgroundDeltaMin: qa.background_delta_min,
    minimumInkPixels: qa.minimum_ink_pixels,
    lineChecks: checks,
    slotChecks,
  };
  if (directory) await writeFile(join(directory, 'ink-occupancy.json'), JSON.stringify(report, null, 2));
  return report;
}

function assertExactNumberSet(actual, expected, message) {
  const sortedActual = [...actual].sort((a, b) => a - b);
  assert.deepEqual(sortedActual, expected, message);
}

function routeForPage(template, page) {
  const layout = template.layouts.find((candidate) => candidate.id === page.layoutId);
  const route = template.routes.main;
  const slots = route.slotsByLayout?.[layout?.id ?? ''] ?? route.slots;
  return { layout, slots };
}

function assertNoInternalRouteGaps(result) {
  const collapsed = new Set(result.plan.decisions
    .filter((decision) => decision.code === 'OPTIONAL_INSERTION_COLLAPSED' && typeof decision.page === 'number' && typeof decision.routeIndex === 'number')
    .map((decision) => `${decision.page}:${decision.routeIndex}`));
  const blocked = new Set(result.plan.decisions
    .filter((decision) => decision.code === 'FLOW_SEGMENT_BLOCKED_BY_INSERTION' && typeof decision.page === 'number' && typeof decision.routeIndex === 'number')
    .map((decision) => `${decision.page}:${decision.routeIndex}`));
  for (const page of result.plan.pages) {
    const { layout, slots } = routeForPage(result.template, page);
    const occupied = new Set(result.plan.lines
      .filter((line) => line.flowId === 'main' && line.page === page.page && line.routeIndex !== undefined)
      .map((line) => line.routeIndex));
    const ordered = [...occupied].sort((a, b) => a - b);
    if (ordered.length < 2) continue;
    for (let index = ordered[0]; index <= ordered.at(-1); index += 1) {
      if (occupied.has(index) || collapsed.has(`${page.page}:${index}`) || blocked.has(`${page.page}:${index}`)) continue;
      const slotId = slots[index];
      const definition = layout?.slots.find((slot) => slot.id === slotId);
      if (definition?.kind === 'block') continue;
      assert.equal(definition?.allowedRoles?.includes('quote'), true, `page ${page.page} has an unfilled non-quote route segment ${index} before later content`);
    }
  }
}

function assertNoEmptyContinuationColumn(result) {
  const mainLines = result.plan.lines.filter((line) => line.flowId === 'main' && !line.blockId.startsWith('header') && !line.blockId.startsWith('footer'));
  for (const page of result.plan.pages.slice(0, -1)) {
    const pageLines = mainLines.filter((line) => line.page === page.page);
    if (pageLines.length === 0) continue;
    const segmentLines = result.plan.slots
      .filter((slot) => slot.page === page.page && slot.id.includes(':segment-'))
      .map((slot) => ({ slotId: slot.id, slot, lines: pageLines.filter((line) => line.slotId === slot.id) }))
      .sort((left, right) => left.slot.box.x - right.slot.box.x);
    if (segmentLines.length < 2) continue;
    assert.ok(segmentLines[0].lines.length > 0, `page ${page.page} entered a later column without using the first column`);
    assert.ok(segmentLines[1].lines.length > 0, `page ${page.page} left the second column empty before continuing the flow to the next page`);
  }
}

function assertFlowPlacementRegistryMatchesPlan(result) {
  const registry = result.plan.flowPlacements ?? [];
  const allPlannedLines = plannedLines(result.plan);
  const routedTextSlots = result.plan.slots.filter((slot) => slot.kind === 'text'
    && slot.flowId !== undefined
    && slot.routeIndex !== undefined);
  assert.equal(
    new Set(registry.map((placement) => placement.id)).size,
    registry.length,
    'flow placement registry must not contain duplicate placement ids',
  );
  assert.deepEqual(
    new Set(registry.map((placement) => placement.slotId)),
    new Set(routedTextSlots.map((slot) => slot.id)),
    'flow placement registry must include every routed text slot, including empty capacity',
  );
  for (const placement of registry) {
    const lines = allPlannedLines.filter((line) => line.flowId === placement.flowId && line.slotId === placement.slotId);
    const blockIds = [...new Set(lines.map((line) => line.blockId))];
    assert.equal(placement.hasContent, lines.length > 0, `flow placement ${placement.id} hasContent must match its actual lines`);
    assert.equal(placement.lineCount, lines.length, `flow placement ${placement.id} lineCount must match its actual lines`);
    assert.deepEqual(placement.blockIds, blockIds, `flow placement ${placement.id} must identify its actual blocks`);
    assert.ok(Number.isFinite(placement.box.x) && Number.isFinite(placement.box.y)
      && placement.box.width > 0 && placement.box.height > 0,
    `flow placement ${placement.id} must expose usable geometry`);
    assert.ok(lines.every((line) => line.routeIndex === undefined || line.routeIndex === placement.routeIndex), `flow placement ${placement.id} must own all routed lines from its route index`);
  }
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function writeDebugArtifacts(directory, result, fixture, artifact) {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'numbered-editorial.pdf'), artifact);
  await writeFile(join(directory, 'plan.json'), JSON.stringify(result.plan, null, 2));
  await writeFile(join(directory, 'fixture-summary.json'), JSON.stringify({
    totalMainWords: fixture.totalMainWords,
    tokenPrefixes: fixture.tokenPrefixes,
    sourceShape: fixture.sourceShape,
    quoteIds: fixture.sourceShape.filter((block) => block.role === 'quote').map((block) => block.id),
  }, null, 2));
  for (const page of result.plan.pages) {
    const slots = result.plan.slots.filter((slot) => slot.page === page.page);
    const flowLines = result.plan.lines.filter((line) => line.page === page.page);
    const insertionLines = (result.plan.insertionLines ?? []).filter((line) => line.page === page.page);
    const lines = [...flowLines, ...insertionLines];
    const layout = result.template.layouts.find((candidate) => candidate.id === page.layoutId);
    const slotInfo = slots.map((slot) => {
      const rawId = slot.id.replace(/^\d+:/u, '');
      const definition = layout?.slots.find((candidate) => candidate.id === rawId);
      const slotLines = lines.filter((line) => line.slotId === slot.id);
      const bottom = slotLines.reduce((value, line) => Math.max(value, line.box.y + line.box.height), slot.box.y);
      return {
        id: slot.id,
        state: slot.state,
        kind: definition?.kind,
        role: definition?.allowedRoles?.[0],
        lineCount: slotLines.length,
        inkProxy: slotLines.reduce((value, line) => value + line.box.width * line.box.height, 0),
        usedHeight: Math.max(0, bottom - slot.box.y),
      };
    });
    await writeFile(join(directory, `debug-page-${page.page}.json`), JSON.stringify({
      page: page.page,
      layoutId: page.layoutId,
      slots: slotInfo,
      flowPlacements: (result.plan.flowPlacements ?? []).filter((placement) => placement.page === page.page),
    }, null, 2));
    const slotSvg = slots.map((slot) => {
      const rawId = slot.id.replace(/^\d+:/u, '');
      const definition = layout?.slots.find((candidate) => candidate.id === rawId);
      const quote = definition?.allowedRoles?.includes('quote');
      const slotLines = lines.filter((line) => line.slotId === slot.id);
      const activeQuote = !quote || result.plan.graphicPlacements.some((graphic) => graphic.page === page.page && graphic.slotId === slot.id && graphic.wrap === 'around') || slotLines.length > 0;
      if (!activeQuote) return '';
      const fill = quote ? '#fff0e8' : '#eaf3ff';
      const stroke = quote ? '#e8753d' : '#4e86b8';
      const activeObstacle = result.plan.graphicPlacements.some((graphic) => graphic.page === page.page && graphic.slotId === slot.id && graphic.wrap === 'around');
      const opacity = activeObstacle ? 0.24 : 0.08;
      const dash = activeObstacle ? '0' : '2 1';
      const labelY = Math.max(14, slot.box.y - 0.8);
      return `<rect x="${slot.box.x}" y="${slot.box.y}" width="${slot.box.width}" height="${slot.box.height}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-dasharray="${dash}"/><text x="${slot.box.x + 1}" y="${labelY}" font-size="2.4" fill="${stroke}">${escapeXml(`${rawId} · ${slot.state} · ${slotLines.length} lines`)}</text>`;
    }).join('');
    const lineSvg = lines.map((line) => {
      const color = line.flowId === 'quotes' ? '#e8753d' : line.flowId === 'intro' ? '#2a6ea6' : '#19334f';
      return `<rect x="${line.box.x}" y="${line.box.y}" width="${line.box.width}" height="${line.box.height}" fill="${color}" fill-opacity="0.24"/><text x="${line.box.x}" y="${line.box.y + 3.4}" font-size="2.2" fill="#122a43">${escapeXml(`${line.flowId}:${line.blockId} · r${line.routeIndex ?? '-'} · ${line.startWord}-${line.endWord}`)}</text>`;
    }).join('');
    const obstacleSvg = result.plan.graphicPlacements
      .filter((graphic) => graphic.page === page.page && graphic.wrap === 'around')
      .map((graphic) => `<rect x="${graphic.box.x}" y="${graphic.box.y}" width="${graphic.box.width}" height="${graphic.box.height}" fill="#f07b42" fill-opacity="0.18" stroke="#e8753d" stroke-width="0.7"/><text x="${graphic.box.x + 1}" y="${graphic.box.y + 5}" font-size="2.4" fill="#c45728">obstacle · ${escapeXml(graphic.graphicId)}</text>`)
      .join('');
    const segmentSummary = slots
      .filter((slot) => slot.id.includes(':segment-'))
      .map((slot) => `${slot.id.replace(/^\d+:/u, '')}: ${flowLines.filter((line) => line.slotId === slot.id).length}`)
      .join(' · ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297"><rect width="210" height="297" fill="white"/><text x="17" y="7" font-size="4" font-family="sans-serif" font-weight="bold">DEBUG PAGE ${page.page} · continuous flow + obstacles</text><text x="17" y="12" font-size="2.6" font-family="sans-serif" fill="#19334f">ordinary flow: ${escapeXml(segmentSummary || 'none')} · orange lines = insertion layer · pale boxes = capacity</text>${slotSvg}${obstacleSvg}${lineSvg}</svg>`;
    await writeFile(join(directory, `debug-page-${page.page}.svg`), svg);
  }
}

try {
  const { planReportCompositionShadow, compositionStylesFromRenderConfig, compositionPdfBackendOptionsFromRenderConfig } = await import(shadowBundle);
  const { compareCompositionEvaluations, evaluateCompositionPlan } = await import(backendBundle);
  const { createJsPdfTextBackend, renderComposition } = await import(backendBundle);
  const { newPdf } = await import(primitivesBundle);
  const { compileTemplateSource } = await import(templateBundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-inset-two-column/template.yml'), 'utf8'));
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const template = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(template);
  const fixture = createEditorialNumberedFixture({
    quoteMarkGap: renderConfig.pdf.quote_mark_gap,
    quoteMarkOffsetX: renderConfig.pdf.quote_mark_offset_x,
    quoteMarkOffsetY: renderConfig.pdf.quote_mark_offset_y,
  });
  assert.ok(fixture.totalMainWords >= 1000, `fixture must contain at least 1000 main-flow words, got ${fixture.totalMainWords}`);
  assert.equal(fixture.sourceShape.filter((block) => block.role === 'quote').length, 4, 'fixture must retain all four authored quote insertions');

  const pdf = newPdf('portrait', [geometry.width, geometry.height]);
  const result = planReportCompositionShadow(pdf, template, geometry, fixture.input, {
    family: 'DejaVu',
    maxPages: 12,
    styles: compositionStylesFromRenderConfig({
      foreground: [25, 51, 79],
      muted: [88, 106, 131],
      primary: [42, 110, 166],
      quote: [232, 117, 61],
    }),
  });
  const fixedQuote = result.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-market');
  assert.ok(fixedQuote, 'editorial fixture must expose the quote selected for movable-position search');
  const movableQuoteWindow = geometry.height * renderConfig.composition_search.movable_quote_window_ratio;
  const movableQuotePolicy = {
    movableInsertionBounds: {
      'quotes:quote-market': {
        bounds: {
          x: fixedQuote.box.x,
          y: fixedQuote.box.y - movableQuoteWindow,
          width: fixedQuote.box.width,
          height: fixedQuote.box.height + (2 * movableQuoteWindow),
        },
        axis: 'y',
        preferred: { y: fixedQuote.box.y },
        candidateCount: renderConfig.composition_search.movable_quote_candidate_count,
        refinementRounds: renderConfig.composition_search.movable_quote_refinement_rounds,
        refinementCandidateCount: renderConfig.composition_search.movable_quote_refinement_candidate_count,
      },
    },
  };
  const movablePdf = newPdf('portrait', [geometry.width, geometry.height]);
  const movableResult = planReportCompositionShadow(movablePdf, template, geometry, fixture.input, {
    family: 'DejaVu',
    maxPages: 12,
    policy: movableQuotePolicy,
    styles: compositionStylesFromRenderConfig({
      foreground: [25, 51, 79],
      muted: [88, 106, 131],
      primary: [42, 110, 166],
      quote: [232, 117, 61],
    }),
  });
  const movableEvaluationPhase = movableResult.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  const movableCandidates = movableEvaluationPhase?.details?.candidates ?? [];
  assert.equal(movableResult.evaluation.status, 'accepted', JSON.stringify(movableResult.evaluation));
  assert.ok(movableCandidates.length >= renderConfig.composition_search.movable_quote_candidate_count, 'movable quote search must evaluate its configured coarse candidates');
  assert.ok(movableCandidates.some((candidate) => candidate.refinementRound === 1), 'movable quote search must evaluate a local refinement round');
  assert.ok(movableCandidates.every((candidate) => candidate.status === 'accepted'), 'movable quote candidates must remain legal');
  assert.ok(new Set(movableCandidates.map((candidate) => candidate.score)).size > 1, 'movable quote search must distinguish candidate quality');
  const orphanScore = (candidate) => candidate.scoreBreakdown?.find((component) => component.code === 'orphan-lines');
  assert.equal(orphanScore(result.evaluation)?.value, 1, 'the fixed reference placement must count the existing isolated paragraph fragment');
  const selectedCandidate = movableCandidates.find((candidate) => candidate.index === movableEvaluationPhase.details.selectedCandidate);
  assert.ok(orphanScore(selectedCandidate)?.value <= orphanScore(result.evaluation)?.value, 'the selected movable quote must not increase the number of isolated paragraph fragments');
  const lowerWindowCandidate = movableCandidates.find((candidate) => {
    const placement = candidate.insertionPlacements?.find((item) => item.graphicId === 'insertion:quote-market');
    return placement && Math.abs(placement.box.y - (fixedQuote.box.y - movableQuoteWindow)) <= renderConfig.pdf.composition_geometry_tolerance;
  });
  assert.equal(orphanScore(lowerWindowCandidate)?.value, 2, 'the lower movable quote candidate must expose both isolated paragraph fragments');
  assert.deepEqual(orphanScore(lowerWindowCandidate)?.details?.orphans?.map((orphan) => orphan.text), ['elit0380', 'est0437 mollit0438'], 'the orphan score must identify both detached lines in the real fixture');
  assert.ok(movableResult.evaluation.score >= result.evaluation.score, `movable quote search must not score below fixed placement: ${JSON.stringify({ fixed: result.evaluation.score, movable: movableResult.evaluation.score })}`);
  const movableQuote = movableResult.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-market');
  assert.ok(movableQuote, 'movable quote result must retain the quote placement');
  assert.ok(Math.abs(movableQuote.box.y - fixedQuote.box.y) <= movableQuoteWindow + renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm, 'selected movable quote must remain inside its configured micro-window');
  if (movableResult.evaluation.score === result.evaluation.score) assert.ok(Math.abs(movableQuote.box.y - fixedQuote.box.y) <= renderConfig.pdf.composition_geometry_tolerance, 'a score tie must preserve the preferred fixed quote position');
  if (debugArtifactDirectory) {
    await mkdir(debugArtifactDirectory, { recursive: true });
    const movableArtifact = renderComposition(movableResult.document, movableResult, createJsPdfTextBackend(movablePdf, 'DejaVu', compositionStylesFromRenderConfig({
      foreground: [25, 51, 79],
      muted: [88, 106, 131],
      primary: [42, 110, 166],
      quote: [232, 117, 61],
    }), compositionPdfBackendOptionsFromRenderConfig()));
    await writeFile(join(debugArtifactDirectory, 'numbered-editorial-movable-quote.pdf'), movableArtifact);
    await writeFile(join(debugArtifactDirectory, 'numbered-editorial-movable-quote-plan.json'), JSON.stringify(movableResult.plan, null, 2));
    await writeFile(join(debugArtifactDirectory, 'numbered-editorial-movable-quote-candidates.json'), JSON.stringify({
      fixedScore: result.evaluation.score,
      movableScore: movableResult.evaluation.score,
      scoreDelta: movableResult.evaluation.score - result.evaluation.score,
      fixedScoreBreakdown: result.evaluation.scoreBreakdown,
      movableScoreBreakdown: movableResult.evaluation.scoreBreakdown,
      fixedQuoteY: fixedQuote.box.y,
      selectedQuoteY: movableQuote.box.y,
      movableQuoteWindow,
      candidates: movableCandidates.map((candidate) => ({
        index: candidate.index,
        refinementRound: candidate.refinementRound,
        score: candidate.score,
        scoreBreakdown: candidate.scoreBreakdown,
        status: candidate.status,
        reflowPasses: candidate.reflowPasses,
        insertionPlacements: candidate.insertionPlacements,
      })),
    }, null, 2));
    const selectedCandidateIndex = movableEvaluationPhase.details.selectedCandidate;
    const debugPdf = movablePdf;
    debugPdf.setPage(fixedQuote.page);
    for (const candidate of movableCandidates) {
      const candidatePlacement = candidate.insertionPlacements?.find((placement) => placement.graphicId === 'insertion:quote-market');
      if (!candidatePlacement || candidatePlacement.page !== fixedQuote.page) continue;
      const selected = candidate.index === selectedCandidateIndex;
      debugPdf.setDrawColor(...(selected ? [220, 20, 60] : [232, 117, 61]));
      debugPdf.setLineWidth(selected
        ? renderConfig.composition_debug.candidate_selected_line_width
        : renderConfig.composition_debug.candidate_line_width);
      if (typeof debugPdf.GState === 'function' && typeof debugPdf.setGState === 'function') debugPdf.setGState(new debugPdf.GState({
        opacity: selected ? 1 : renderConfig.composition_debug.candidate_alternative_opacity,
      }));
      debugPdf.rect(candidatePlacement.box.x, candidatePlacement.box.y, candidatePlacement.box.width, candidatePlacement.box.height, 'S');
      if (typeof debugPdf.GState === 'function' && typeof debugPdf.setGState === 'function') debugPdf.setGState(new debugPdf.GState({ opacity: 1 }));
      debugPdf.setTextColor(...(selected ? [220, 20, 60] : [232, 117, 61]));
      debugPdf.setFont('helvetica', selected ? 'bold' : 'normal');
      debugPdf.setFontSize(renderConfig.composition_debug.candidate_label_size);
      debugPdf.text(`${selected ? 'SELECTED' : 'candidate'} ${candidate.index} · score ${candidate.score.toFixed(2)}`, renderConfig.composition_debug.page_padding, Math.max(renderConfig.composition_debug.page_padding, candidatePlacement.box.y - renderConfig.composition_debug.candidate_label_gap));
    }
    await writeFile(join(debugArtifactDirectory, 'numbered-editorial-movable-quote-candidates-debug.pdf'), Buffer.from(debugPdf.output('arraybuffer')));
  }
  assert.equal(result.template.headingKeepWithNextLines, 1, 'editorial template must configure one protected body line after a heading');
  const continuationLayout = result.template.layouts.find((layout) => layout.id.endsWith(':continuation'));
  const continuationRoute = result.template.routes.main.slotsByLayout?.[continuationLayout?.id ?? ''] ?? [];
  assert.equal(continuationRoute.filter((slotId) => slotId.includes(':segment-')).length, 2, 'main flow must retain one segment per column');
  assert.equal(result.template.routes.main.insertionSlots, undefined, 'main flow must not own quote insertions');
  assert.deepEqual(result.template.routes.quotes.insertionSlots, ['quote-a', 'quote-b', 'quote-c'], 'quotes must be declared as a separate obstacle flow with three per-page insertion slots');
  assert.deepEqual(result.template.routes.intro.slots, ['intro'], 'intro Markdown image and lead must share a dedicated flow');
  assert.equal(result.template.routes.chart, undefined, 'editorial inset template must not reserve a chart section');
  if (debugArtifactDirectory) await writeFile(join(debugArtifactDirectory, 'plan-trace.json'), JSON.stringify(result.plan.trace ?? {}, null, 2));
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.residualContent.length, 0, JSON.stringify(result.plan.residualContent));
  assert.deepEqual(result.evaluation.hardViolations, [], 'accepted editorial must expose no hard violations');
  assert.ok(Number.isFinite(result.evaluation.score), 'accepted editorial must expose a finite score');
  assert.ok(result.evaluation.scoreBreakdown.some((component) => component.code === 'column-balance'), 'editorial score must explain column balance');
  assert.ok(result.evaluation.scoreBreakdown.some((component) => component.code === 'heading-following-line'), 'editorial score must explain heading following text');
  const traceBeforeReevaluation = structuredClone(result.plan.trace);
  const firstReevaluation = evaluateCompositionPlan(result.document, result.plan);
  const secondReevaluation = evaluateCompositionPlan(result.document, result.plan);
  assert.deepEqual(secondReevaluation, firstReevaluation, 'evaluating the same plan twice must be deterministic');
  assert.deepEqual(result.plan.trace, traceBeforeReevaluation, 'evaluation must not mutate the plan trace');
  const incompleteTraceBlocks = (result.plan.trace?.blocks ?? []).filter((block) => block.status !== 'placed');
  assert.deepEqual(incompleteTraceBlocks, [], `every authored block must be present in the final plan: ${JSON.stringify(incompleteTraceBlocks)}`);
  const mainFlowPlacements = (result.plan.flowPlacements ?? []).filter((placement) => placement.flowId === 'main');
  assert.ok(mainFlowPlacements.length > 0, 'plan must register every main-flow placement, including empty capacity');
  assert.ok(mainFlowPlacements.every((placement, index, placements) => index === 0
    || placement.page > placements[index - 1].page
    || placement.page === placements[index - 1].page && placement.routeIndex > placements[index - 1].routeIndex), 'flow placements must be registered in page and route order');
  const illegalEmptyPlacements = [];
  for (const flowId of new Set((result.plan.flowPlacements ?? []).map((placement) => placement.flowId))) {
    const placements = (result.plan.flowPlacements ?? []).filter((placement) => placement.flowId === flowId);
    const occupied = placements.flatMap((placement, index) => placement.hasContent ? [index] : []);
    if (occupied.length < 2) continue;
    for (const placement of placements.slice(occupied[0], occupied.at(-1) + 1)) {
      if (!placement.hasContent && placement.state !== 'exhausted' && placement.blockedBy.length === 0) illegalEmptyPlacements.push(placement.slotId);
    }
  }
  assert.deepEqual(illegalEmptyPlacements, [], `accepted plan must not contain an unblocked empty placement between content: ${JSON.stringify(illegalEmptyPlacements)}`);
  assertFlowPlacementRegistryMatchesPlan(result);
  const occupiedMainPlacementIndex = mainFlowPlacements.findIndex((placement, index, placements) => placement.hasContent
    && placement.blockedBy.length === 0
    && index > 0
    && index < placements.length - 1
    && placements.slice(0, index).some((candidate) => candidate.hasContent)
    && placements.slice(index + 1).some((candidate) => candidate.hasContent));
  assert.ok(occupiedMainPlacementIndex >= 0, 'fixture must expose an occupied main-flow placement with content on both sides');
  const invalidPlan = structuredClone(result.plan);
  const invalidMainPlacements = invalidPlan.flowPlacements.filter((placement) => placement.flowId === 'main');
  const invalidTarget = invalidMainPlacements[occupiedMainPlacementIndex];
  invalidTarget.hasContent = false;
  invalidTarget.blockIds = [];
  invalidTarget.lineCount = 0;
  const invalidEvaluation = evaluateCompositionPlan(result.document, invalidPlan);
  assert.equal(invalidEvaluation.status, 'rejected', 'an empty placement between occupied placements must reject the plan');
  assert.ok(invalidEvaluation.diagnostics.some((diagnostic) => diagnostic.code === 'EMPTY_FLOW_PLACEMENT'), 'empty placement rejection must be explicit');
  assert.throws(
    () => renderComposition(result.document, { plan: invalidPlan, evaluation: invalidEvaluation }, createJsPdfTextBackend(pdf, 'DejaVu', compositionStylesFromRenderConfig({
      foreground: [25, 51, 79],
      muted: [88, 106, 131],
      primary: [42, 110, 166],
      quote: [232, 117, 61],
    }), compositionPdfBackendOptionsFromRenderConfig())),
    /rejected and cannot be rendered/u,
    'a plan rejected for an empty placement must not reach the PDF backend',
  );
  const fakeContentPlan = structuredClone(result.plan);
  const fakeContentPlacement = fakeContentPlan.flowPlacements.find((placement) => !placement.hasContent);
  assert.ok(fakeContentPlacement, 'fixture must expose an empty flow placement for metadata validation');
  fakeContentPlacement.hasContent = true;
  const fakeContentEvaluation = evaluateCompositionPlan(result.document, fakeContentPlan);
  assert.equal(fakeContentEvaluation.status, 'rejected', 'a placement marked as occupied without content must reject the plan');
  assert.ok(fakeContentEvaluation.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_PLACEMENT_CONTENT_MISMATCH'), 'fake placement occupancy must be explicit');
  assert.ok(fakeContentEvaluation.hardViolations.some((diagnostic) => diagnostic.code === 'FLOW_PLACEMENT_CONTENT_MISMATCH'), 'hard violations must include fake placement occupancy');
  assert.equal(fakeContentEvaluation.score, Number.NEGATIVE_INFINITY, 'an illegal plan must never win through its quality score');
  const legalLowScore = { status: 'accepted', hardViolations: [], score: 101, residualContent: [] };
  const legalHighScore = { status: 'accepted', hardViolations: [], score: 102, residualContent: [] };
  const illegalHighScore = { status: 'rejected', hardViolations: [{ code: 'synthetic', severity: 'error' }], score: 999, residualContent: [] };
  assert.ok(compareCompositionEvaluations(legalHighScore, legalLowScore) < 0, 'a legal higher-score plan must be preferred');
  assert.ok(compareCompositionEvaluations(legalLowScore, illegalHighScore) < 0, 'a legal plan must beat an illegal plan regardless of score');
  assert.equal(compareCompositionEvaluations(legalLowScore, { ...legalLowScore }), 0, 'equal evaluations must tie deterministically');
  const invalidPlacementGeometryPlan = structuredClone(result.plan);
  const invalidPlacementGeometry = invalidPlacementGeometryPlan.flowPlacements.find((placement) => placement.hasContent);
  assert.ok(invalidPlacementGeometry, 'fixture must expose an occupied flow placement for geometry validation');
  invalidPlacementGeometry.box.x += invalidPlacementGeometry.box.width + 1;
  const invalidPlacementGeometryEvaluation = evaluateCompositionPlan(result.document, invalidPlacementGeometryPlan);
  assert.equal(invalidPlacementGeometryEvaluation.status, 'rejected', 'a flow placement outside its slot must reject the plan');
  assert.ok(invalidPlacementGeometryEvaluation.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_PLACEMENT_OUTSIDE_SLOT'), 'out-of-slot flow placement must be explicit');
  const invalidBarrierCandidatePlan = structuredClone(result.plan);
  const invalidBarrierCandidate = invalidBarrierCandidatePlan.flowBarrierBoxCandidates.find((candidate) => candidate.flowId === 'main');
  assert.ok(invalidBarrierCandidate, 'fixture must expose a main-flow barrier candidate for geometry validation');
  const invalidBarrierPlacement = invalidBarrierCandidatePlan.flowPlacements.find((placement) => placement.id === invalidBarrierCandidate.placementId && placement.page === invalidBarrierCandidate.page);
  assert.ok(invalidBarrierPlacement, 'barrier candidate must reference a placement for geometry validation');
  invalidBarrierCandidate.box.y = invalidBarrierPlacement.box.y + invalidBarrierPlacement.box.height + 1;
  const invalidBarrierCandidateEvaluation = evaluateCompositionPlan(result.document, invalidBarrierCandidatePlan);
  assert.equal(invalidBarrierCandidateEvaluation.status, 'rejected', 'a barrier candidate outside its flow placement must reject the plan');
  assert.ok(invalidBarrierCandidateEvaluation.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_BARRIER_CANDIDATE_OUTSIDE_PLACEMENT'), 'out-of-placement barrier candidate must be explicit');
  assert.ok(renderConfig.pdf.planner_max_iterations >= 2, 'render config must allow several obstacle-planning passes');
  assert.ok(result.plan.decisions.some((decision) => decision.code === 'PLANNER_PASS_COMPLETED'), 'editorial fixture must record its obstacle-planning pass');
  const evaluationPhase = result.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  assert.ok(evaluationPhase?.details?.candidates?.length >= 1, 'editorial fixture must record evaluated planner candidates');
  assert.equal(result.plan.lines.some((line) => line.layer === 'insertion'), false, 'ordinary flow must not contain insertion lines');
  assert.equal(new Set((result.plan.insertionLines ?? []).map((line) => line.blockId)).size, 4, 'all four authored quotes must be present in the insertion layer');
  assert.equal((result.plan.insertionLines ?? []).every((line) => line.flowId === 'quotes'), true, 'quote text must remain in the quote flow');
  assert.equal(result.plan.lines.some((line) => line.blockId.startsWith('quote-')), false, 'quote text must never enter the main flow');
  const quoteGlyphs = (result.plan.glyphPlacements ?? []).filter((glyph) => glyph.targetType === 'block' && result.document.flows.quotes.blocks.some((block) => block.id === glyph.targetId));
  assert.equal(quoteGlyphs.length, 8, 'each of the four quote blocks must resolve its opening and closing glyph object');
  assert.ok(quoteGlyphs.every((glyph) => glyph.source === 'authored'), 'quote marks must come from explicit authored glyph objects');
  assert.ok(quoteGlyphs.filter((glyph) => glyph.anchor === 'text-end').every((glyph) => glyph.anchorMeasureStyleName === undefined), 'closing quote glyphs must anchor to the visible quote text width');
  assert.ok(quoteGlyphs.every((glyph) => glyph.box.width > 0 && glyph.box.height > 0 && Number.isFinite(glyph.baselineY)), 'quote glyph objects must expose measurable geometry and baseline');
  const tracedQuote = result.plan.trace?.blocks.find((block) => block.blockId === 'quote-market');
  assert.ok(tracedQuote?.sourceText && tracedQuote.fragments.every((fragment) => fragment.text), 'plan trace must expose source and placed insertion text');
  const introBlockIds = new Set(fixture.sourceShape.filter((block) => block.role === 'intro').map((block) => block.id));
  const introLines = result.plan.lines.filter((line) => introBlockIds.has(line.blockId));
  assert.ok(introLines.length > 0, 'numbered fixture must place its intro content');
  assert.equal(introLines.every((line) => line.slotId.endsWith(':intro')), true, 'intro content must use the semantic intro slot instead of ordinary column flow');
  const continuationRight = result.plan.slots.find((slot) => slot.id === '2:continuation:segment-2');
  const firstDriverLine = result.plan.lines.find((line) => line.page === 2 && line.blockId === 'body-drivers-1');
  assert.ok(continuationRight && firstDriverLine, 'fixture must create both continuation columns and place the drivers block on the continuation page');
  assert.ok(Number.isInteger(firstDriverLine.routeIndex) && firstDriverLine.slotId.includes(':segment-'), 'the drivers block must enter through the main flow route, not by a separate block placement');
  const dieselObstacle = result.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-diesel');
  const rightColumnBeforeDieselQuote = result.plan.lines.some((line) => line.page === 3
    && line.flowId === 'main'
    && line.routeIndex === 1
    && dieselObstacle
    && line.box.y + line.box.height <= dieselObstacle.box.y + renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm);
  assert.ok(rightColumnBeforeDieselQuote, 'the second column must use the available band above the diesel quote instead of inheriting the first column resumeY');
  const physicalLineOrder = new Map();
  for (const line of plannedLines(result.plan).filter((candidate) => candidate.flowId === 'main' || candidate.flowId === 'quotes')) {
    const group = physicalLineOrder.get(line.blockId) ?? [];
    group.push(line);
    physicalLineOrder.set(line.blockId, group);
  }
  for (const [blockId, lines] of physicalLineOrder) {
    const orderedLines = [...lines].sort((left, right) => left.page - right.page || (left.routeIndex ?? Number.MAX_SAFE_INTEGER) - (right.routeIndex ?? Number.MAX_SAFE_INTEGER) || left.box.y - right.box.y || left.box.x - right.box.x);
    let nextWord = 0;
    for (const line of orderedLines) {
      assert.equal(line.startWord, nextWord, `block ${blockId} must advance its words in physical column order`);
      nextWord = line.endWord;
    }
  }
  assertExactNumberSet(numbers(numberedTokens(plannedLines(result.plan).map((line) => line.text).join(' '), fixture.tokenPrefixes)), Array.from({ length: fixture.totalMainWords }, (_, index) => index + 1), 'planner must retain every numbered word exactly once');
  const quoteTolerance = renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm;
  const insertionGroups = new Map();
  for (const line of result.plan.insertionLines ?? []) {
    const group = insertionGroups.get(line.slotId) ?? [];
    group.push(line);
    insertionGroups.set(line.slotId, group);
  }
  for (const [slotId, lines] of insertionGroups) {
    const slot = result.plan.slots.find((candidate) => candidate.id === slotId);
    assert.ok(slot, `quote line references missing slot ${slotId}`);
    const lineTop = Math.min(...lines.map((line) => line.box.y));
    const lineBottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
    const lineCenter = (lineTop + lineBottom) / 2;
    const slotCenter = slot.box.y + slot.box.height / 2;
    assert.ok(Math.abs(lineCenter - slotCenter) <= quoteTolerance, `quote is not vertically centered: ${JSON.stringify({ slotId, lineTop, lineBottom, slot: slot.box, quoteTolerance })}`);
  }
  assertNoInternalRouteGaps(result);
  assertNoEmptyContinuationColumn(result);
  assertFlowBarrierBoxCandidates(result);
  assertOrdinaryLinesRespectFlowBarrierBoxCandidates(result);

  const artifact = renderComposition(result.document, result, createJsPdfTextBackend(pdf, 'DejaVu', compositionStylesFromRenderConfig({
    foreground: [25, 51, 79],
    muted: [88, 106, 131],
    primary: [42, 110, 166],
    quote: [232, 117, 61],
  }), compositionPdfBackendOptionsFromRenderConfig()));
  const artifactPath = join(temporary, 'numbered-editorial.pdf');
  await writeFile(artifactPath, artifact);
  if (debugArtifactDirectory) await writeDebugArtifacts(debugArtifactDirectory, result, fixture, artifact);
  const inkOccupancy = await assertRenderedInk(artifactPath, result, geometry, renderConfig, debugArtifactDirectory);
  const tokenPattern = new RegExp(`^(?:${fixture.tokenPrefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})\\d{4}$`, 'u');
  const words = pdfWords(artifactPath).filter((word) => tokenPattern.test(word.text));
  assertExactNumberSet(numbers(words.map((word) => word.text)), Array.from({ length: fixture.totalMainWords }, (_, index) => index + 1), 'final PDF must contain every numbered word exactly once');

  const headerOverflowInput = structuredClone(fixture.input);
  headerOverflowInput.flows.header.blocks[0] = {
    id: 'header-overflow-title',
    type: 'heading',
    role: 'header',
    text: 'Kierowców brakuje już niemal w każdym powiecie. Branża stawia na technologie i nowe kompetencje',
  };
  const headerOverflowPdf = newPdf('portrait', [geometry.width, geometry.height]);
  const headerOverflow = planReportCompositionShadow(headerOverflowPdf, template, geometry, headerOverflowInput, { family: 'DejaVu', maxPages: 12 });
  assert.equal(headerOverflow.evaluation.status, 'accepted', JSON.stringify(headerOverflow.evaluation));
  const headerOverflowArtifact = renderComposition(headerOverflow.document, headerOverflow, createJsPdfTextBackend(headerOverflowPdf, 'DejaVu', compositionStylesFromRenderConfig({
    foreground: [25, 51, 79],
    muted: [88, 106, 131],
    primary: [42, 110, 166],
    quote: [232, 117, 61],
  }), compositionPdfBackendOptionsFromRenderConfig()));
  const headerOverflowPath = join(temporary, 'header-overflow-regression.pdf');
  await writeFile(headerOverflowPath, headerOverflowArtifact);
  assertRenderedHeaderLinesStayInsidePlan(headerOverflowPath, headerOverflow, renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm);
  assertRenderedHeaderMetaStaysInsidePlan(headerOverflowPath, headerOverflow, renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm);

  const columnBalance = inspectColumnBalance(readPdfLayout(artifactPath), renderConfig.quality.layout_diff);
  if (debugArtifactDirectory) await writeFile(join(debugArtifactDirectory, 'column-balance.json'), JSON.stringify(columnBalance, null, 2));

  const authoredBlockOrder = new Map(fixture.sourceShape.map((block, index) => [block.id, index]));
  const planNumbers = numbers(numberedTokens(plannedLines(result.plan)
    .sort((left, right) => (authoredBlockOrder.get(left.blockId) ?? Number.MAX_SAFE_INTEGER) - (authoredBlockOrder.get(right.blockId) ?? Number.MAX_SAFE_INTEGER) || left.startWord - right.startWord)
    .map((line) => line.text).join(' '), fixture.tokenPrefixes));
  assert.deepEqual(planNumbers, Array.from({ length: fixture.totalMainWords }, (_, index) => index + 1), 'planner reading order must be monotonically increasing');
  console.log(JSON.stringify({
    status: 'passed',
    pages: result.plan.pages.length,
    mainWords: fixture.totalMainWords,
    quotes: fixture.sourceShape.filter((block) => block.role === 'quote').length,
    lines: result.plan.lines.length,
    reflowCandidates: evaluationPhase?.details?.candidates?.map((candidate) => ({ index: candidate.index, reflowPasses: candidate.reflowPasses })) ?? [],
    totalReflowPasses: (evaluationPhase?.details?.candidates ?? []).reduce((sum, candidate) => sum + candidate.reflowPasses, 0),
    columnBalance,
    inkChecks: inkOccupancy.lineChecks.length,
    occupiedInkRegions: inkOccupancy.lineChecks.filter((check) => check.status === 'occupied').length,
    emptyCheckedSlots: inkOccupancy.slotChecks.filter((check) => check.status === 'empty').map((check) => check.slotId),
    artifactPath,
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
