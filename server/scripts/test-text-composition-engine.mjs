#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loremIpsum } from 'lorem-ipsum';
import { parse } from 'yaml';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-text-engine-'));
const bundle = join(temporary, 'composition.cjs');
const primitivesBundle = join(temporary, 'render-primitives.cjs');

function plannedLines(plan) {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}
const build = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`text composition engine test bundle failed: ${build.stderr || build.stdout}`);
const primitivesBuild = runProcess('npx', [
  'esbuild',
  'src/render-primitives.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  '--loader:.wasm=binary',
  '--loader:.ttf=binary',
  `--outfile=${primitivesBundle}`,
], { cwd: root, timeout: 30_000 });
if (primitivesBuild.status !== 0) throw new Error(`text composition render bundle failed: ${primitivesBuild.stderr || primitivesBuild.stdout}`);

function decodePpm(buffer) {
  assert.equal(buffer.subarray(0, 2).toString('ascii'), 'P6', 'pixel QA must receive RGB PPM output');
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
  assert.equal(maxValue, 255, 'pixel QA must use 8-bit RGB channels');
  return { width, height, pixels: buffer.subarray(offset) };
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
  const rows = [];
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
      if (!isInk) continue;
      count += 1;
      rowCount += 1;
      rowMinX = Math.min(rowMinX, x);
      rowMaxX = Math.max(rowMaxX, x);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (rowCount > 0) rows.push({ y, count: rowCount, minX: rowMinX, maxX: rowMaxX });
  }
  const bands = [];
  for (const row of rows) {
    const previous = bands.at(-1);
    if (previous && row.y === previous.endY + 1) {
      previous.endY = row.y;
      previous.inkPixels += row.count;
      previous.minX = Math.min(previous.minX, row.minX);
      previous.maxX = Math.max(previous.maxX, row.maxX);
    } else bands.push({ startY: row.y, endY: row.y, inkPixels: row.count, minX: row.minX, maxX: row.maxX });
  }
  const toMm = (value, scale) => value / scale;
  return {
    status: count === 0 ? 'empty' : 'occupied',
    inkPixels: count,
    boxMm: { x: box.x, y: box.y, width: box.width, height: box.height },
    boundsMm: count === 0 ? null : {
      x: toMm(minX, scaleX),
      y: toMm(minY, scaleY),
      width: toMm(maxX - minX + 1, scaleX),
      height: toMm(maxY - minY + 1, scaleY),
    },
    rowBands: bands.map((band) => ({
      x: toMm(band.minX, scaleX),
      y: toMm(band.startY, scaleY),
      width: toMm(band.maxX - band.minX + 1, scaleX),
      height: toMm(band.endY - band.startY + 1, scaleY),
      inkPixels: band.inkPixels,
    })),
  };
}

function pdfWords(path) {
  const result = runProcess('pdftotext', ['-bbox-layout', path, '-']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const pointsToMm = 25.4 / 72;
  const words = [];
  let page = 0;
  for (const pageMatch of result.stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu)) {
    for (const wordMatch of pageMatch[1].matchAll(/<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gu)) {
      words.push({ page, xMin: Number(wordMatch[1]) * pointsToMm, yMin: Number(wordMatch[2]) * pointsToMm, xMax: Number(wordMatch[3]) * pointsToMm, yMax: Number(wordMatch[4]) * pointsToMm, text: wordMatch[5].replace(/<[^>]+>/gu, '') });
    }
    page += 1;
  }
  return words;
}

function assertPdfSpatialOrder(words, fixture, qa) {
  const tokenPattern = new RegExp(`^(?:${fixture.prefixes.join('|')})\\d{4}$`, 'u');
  const tokens = words.filter((word) => tokenPattern.test(word.text));
  assert.equal(tokens.length, fixture.expectedWords, 'final PDF must contain every numbered word exactly once');
  const numbers = tokens.map((word) => Number(word.text.slice(-4)));
  assert.deepEqual([...new Set(numbers)].sort((a, b) => a - b), Array.from({ length: fixture.expectedWords }, (_, index) => index + 1), 'final PDF numbered words must be complete');
  const byPage = new Map();
  for (const word of tokens) byPage.set(word.page, [...(byPage.get(word.page) ?? []), word]);
  for (const [page, pageWords] of byPage) {
    const left = pageWords.filter((word) => word.xMin < fixture.dividerX).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
    const right = pageWords.filter((word) => word.xMin >= fixture.dividerX).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
    const ordered = [...left, ...right].map((word) => Number(word.text.slice(-4)));
    assert.deepEqual(ordered, [...ordered].sort((a, b) => a - b), `page ${page + 1} must read top-to-bottom, then left-to-right by column`);
    if (left.length > 0 && right.length > 0) {
      const leftMaximum = Math.max(...left.map((word) => Number(word.text.slice(-4))));
      const rightMinimum = Math.min(...right.map((word) => Number(word.text.slice(-4))));
      assert.ok(leftMaximum < rightMinimum, `page ${page + 1} must exhaust the left column before entering the right column`);
    }
    if (!fixture.pagesWithObstacles.includes(page + 1)) continue;
    for (const obstacle of fixture.obstacles) {
      for (const word of pageWords) {
        const tolerance = fixture.obstacleBoundaryTolerance;
        const overlaps = word.xMin < obstacle.x + obstacle.width - tolerance && word.xMax > obstacle.x + tolerance
          && word.yMin < obstacle.y + obstacle.height - tolerance && word.yMax > obstacle.y + tolerance;
        assert.equal(overlaps, false, `page ${page + 1} word ${word.text} (${word.xMin.toFixed(2)},${word.yMin.toFixed(2)}-${word.xMax.toFixed(2)},${word.yMax.toFixed(2)}) must not overlap obstacle ${obstacle.id} (${obstacle.x},${obstacle.y}-${obstacle.x + obstacle.width},${obstacle.y + obstacle.height})`);
      }
    }
  }
  const globallyOrdered = [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, pageWords]) => {
      const left = pageWords.filter((word) => word.xMin < fixture.dividerX).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
      const right = pageWords.filter((word) => word.xMin >= fixture.dividerX).sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
      return [...left, ...right];
    })
    .map((word) => Number(word.text.slice(-4)));
  assert.deepEqual(globallyOrdered, Array.from({ length: fixture.expectedWords }, (_, index) => index + 1), 'final PDF must preserve source order across pages and columns');
  assert.equal(qa.minimum_ink_pixels > 0, true, 'pixel QA must require positive ink');
}

async function writeNumberedPixelArtifacts(directory, result, document, artifact, pixelChecks) {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'numbered-obstacle-pixel-qa.pdf'), artifact);
  await writeFile(join(directory, 'numbered-obstacle-plan.json'), JSON.stringify(result.plan, null, 2));
  await writeFile(join(directory, 'numbered-obstacle-pixel-occupancy.json'), JSON.stringify({
    coordinateSystem: {
      unit: 'mm',
      origin: 'top-left of page',
      pageWidth: result.plan.pages[0]?.width,
      pageHeight: result.plan.pages[0]?.height,
      note: 'boxMm is the expected zone; boundsMm and rowBands are measured raster ink positions',
    },
    checks: pixelChecks,
  }, null, 2));
  for (const page of result.plan.pages) {
    const lines = plannedLines(result.plan).filter((line) => line.page === page.page);
    const obstacles = result.plan.graphicPlacements.filter((graphic) => graphic.page === page.page && graphic.wrap === 'around');
    const lineSvg = lines.map((line) => `<rect x="${line.box.x}" y="${line.box.y}" width="${line.box.width}" height="${line.box.height}" fill="#16263a" fill-opacity="0.24"/><text x="${line.box.x}" y="${line.box.y + line.box.height * 0.75}" font-size="1.1" fill="#16263a">${line.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</text>`).join('');
    const obstacleSvg = obstacles.map((graphic) => `<rect x="${graphic.box.x}" y="${graphic.box.y}" width="${graphic.box.width}" height="${graphic.box.height}" fill="#f07b42" fill-opacity="0.22" stroke="#e8753d" stroke-width="0.35"/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/><text x="2" y="1.5" font-size="1.5" font-family="sans-serif" font-weight="bold">DEBUG PAGE ${page.page} · continuous flow + obstacles</text>${obstacleSvg}${lineSvg}</svg>`;
    await writeFile(join(directory, `numbered-obstacle-debug-page-${page.page}.svg`), svg);
  }
  if (document.graphics?.length === 0) throw new Error('numbered obstacle debug artifact lost its obstacle graphics');
}

try {
  const { createJsPdfTextBackend, createJsPdfTextMetrics, createTextCompositionEngine, evaluateCompositionPlan, renderComposition } = await import(bundle);
  const { newPdf } = await import(primitivesBundle);
  let randomState = 0x5eed;
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const bodyText = Array.from({ length: 11 }, () => loremIpsum({
    count: 1,
    units: 'sentences',
    sentenceLowerBound: 6,
    sentenceUpperBound: 12,
    random,
  })).join(' ');
  const template = {
    maxPages: 2,
    layouts: [
      {
        id: 'opening',
        width: 100,
        height: 100,
        slots: [
          { id: 'main-a', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 30 } },
          { id: 'main-b', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 30 } },
          { id: 'sidebar', regionId: 'sidebar', flowId: 'sidebar', kind: 'text', box: { x: 75, y: 45, width: 20, height: 45 } },
        ],
      },
      {
        id: 'continuation',
        width: 100,
        height: 100,
        slots: [
          { id: 'main-a', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 28, height: 80 } },
          { id: 'main-b', regionId: 'main', kind: 'text', box: { x: 38, y: 5, width: 28, height: 80 } },
          { id: 'main-c', regionId: 'main', kind: 'text', box: { x: 71, y: 5, width: 24, height: 80 } },
          { id: 'sidebar', regionId: 'sidebar', flowId: 'sidebar', kind: 'text', box: { x: 5, y: 90, width: 90, height: 5 } },
        ],
      },
    ],
    routes: {
      main: {
        slots: ['main-a', 'main-b'],
        slotsByLayout: { continuation: ['main-a', 'main-b', 'main-c'] },
        layouts: ['opening', 'continuation'],
        continuation: 'allowed',
      },
      sidebar: { slots: ['sidebar'], layouts: ['opening'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [
          { id: 'intro', kind: 'paragraph', role: 'intro', text: 'A short editorial introduction that takes two lines.' },
          { id: 'heading', kind: 'heading', role: 'heading', text: 'A heading', keepWithNextLines: 2 },
          { id: 'body', kind: 'paragraph', role: 'body', text: bodyText },
        ],
      },
      sidebar: {
        id: 'sidebar',
        continuation: 'forbidden',
        blocks: [{ id: 'side', kind: 'paragraph', role: 'sidebar', text: 'sidebar content remains local' }],
      },
    },
  };
  const metrics = {
    units: 'mm',
    family: 'test',
    measureText(text) { return text.length; },
    lineHeight() { return 10; },
  };
  const result = createTextCompositionEngine(template, { minimumLinesAtStart: 2, minimumLinesAtEnd: 2 }).plan(document, metrics);
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.pages.length, 2);
  assert.ok(result.plan.lines.some((line) => line.page === 2 && line.slotId === '2:main-c'), 'continuation layout must expose its third column');
  assert.ok(result.plan.decisions.some((decision) => ['KEEP_CLUSTER_PUSHED', 'KEEP_CLUSTER_RELAXED'].includes(decision.code)), 'keep cluster decision should be visible');
  assert.ok(result.plan.slots.some((slot) => slot.id === '1:main-a' && slot.state !== 'open'));
  assert.ok(result.plan.trace?.phases.some((phase) => phase.name === 'preflight'));
  assert.ok(result.plan.trace?.phases.some((phase) => phase.name === 'flow-placement'));
  assert.ok(result.plan.trace?.blocks.some((block) => block.blockId === 'body' && block.fragments.length > 0), 'plan trace must group fragments by source block');
  assert.ok(result.plan.trace?.slots.some((slot) => slot.slotId === '1:main-a' && slot.lineCount > 0), 'plan trace must expose slot occupancy');
  assert.equal(result.plan.residualContent.length, 0);
  assert.equal(result.evaluation.diagnostics.some((item) => item.code === 'LINE_OVERLAP'), false);
  const spacingReflowPhases = result.plan.trace?.phases.filter((phase) => phase.name === 'reflow') ?? [];
  const spacingEvaluationPhase = result.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  assert.equal(spacingReflowPhases.length, 1, 'a plan without insertions needs one stability check, not a second full reflow');
  assert.equal(spacingEvaluationPhase?.details?.candidates?.length, 1, 'a stable plan without insertions must produce one candidate');

  const boundaryReflowTemplate = {
    maxPages: 1,
    layouts: [{ id: 'boundary-reflow', width: 100, height: 100, slots: [
      { id: 'body-before', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 40 }, allowedRoles: ['body'] },
      { id: 'quote-a', regionId: 'main', kind: 'text', box: { x: 5, y: 20, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'quote-b', regionId: 'main', kind: 'text', box: { x: 5, y: 60, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'body-after', regionId: 'main', kind: 'text', box: { x: 5, y: 75, width: 90, height: 20 }, allowedRoles: ['body'] },
    ] }],
    routes: {
      main: {
        slots: ['body-before', 'quote-a', 'body-after', 'quote-b'],
        insertionSlots: ['quote-a', 'quote-b'],
        layouts: ['boundary-reflow'],
        continuation: 'forbidden',
      },
    },
  };
  const boundaryReflow = createTextCompositionEngine(boundaryReflowTemplate, { maxPlanningIterations: 2 }).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'boundary-before', kind: 'paragraph', role: 'body', text: Array.from({ length: 20 }, (_, index) => `before${index}`).join(' ') },
      { id: 'boundary-quote', kind: 'paragraph', role: 'quote', text: 'The quote must move below the preceding content.' },
      { id: 'boundary-after', kind: 'paragraph', role: 'body', text: 'Content after the moved quote.' },
    ] } },
  }, metrics);
  assert.equal(boundaryReflow.evaluation.status, 'accepted', JSON.stringify(boundaryReflow.evaluation));
  const boundaryQuotePlacement = boundaryReflow.plan.insertionLines?.find((line) => line.blockId === 'boundary-quote');
  assert.ok(boundaryQuotePlacement?.slotId.endsWith(':quote-b'), `boundary quote must move to the later insertion slot: ${JSON.stringify(boundaryQuotePlacement)}`);
  const boundaryReflowPhases = boundaryReflow.plan.trace?.phases.filter((phase) => phase.name === 'reflow') ?? [];
  const boundaryEvaluationPhase = boundaryReflow.plan.trace?.phases.findLast((phase) => phase.name === 'evaluation');
  assert.equal(boundaryReflowPhases.length, 1, 'the selected stabilized candidate must expose its own reflow pass');
  assert.equal(boundaryEvaluationPhase?.details?.candidates?.length, 2, 'a proposal change must expose both full plans to the evaluator');
  assert.deepEqual(boundaryEvaluationPhase.details.candidates.map((candidate) => candidate.status), ['rejected', 'accepted'], 'the first boundary plan must fail source-order evaluation before the moved quote is accepted');
  assert.deepEqual(boundaryEvaluationPhase.details.candidates.map((candidate) => candidate.reflowPasses), [1, 1], 'each full candidate must expose its reflow cost');

  const spacingTemplate = {
    maxPages: 1,
    layouts: [{ id: 'spacing', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 80 } }] }],
    routes: { main: { slots: ['body'], layouts: ['spacing'], continuation: 'forbidden' } },
  };
  const spacingDocument = {
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'spacing-heading', kind: 'heading', role: 'heading', text: 'Heading' },
      { id: 'spacing-body', kind: 'paragraph', role: 'body', text: 'Body paragraph' },
      { id: 'spacing-list', kind: 'list-item', role: 'body', text: 'List item' },
    ] } },
  };
  const spacingResult = createTextCompositionEngine(spacingTemplate).plan(spacingDocument, {
    ...metrics,
    blockGap(previousStyle, nextStyle) {
      return previousStyle === 'heading' && nextStyle === 'body' ? 5 : previousStyle === 'body' && nextStyle === 'list-item' ? 3 : 0;
    },
  });
  assert.equal(spacingResult.evaluation.status, 'accepted', JSON.stringify(spacingResult.evaluation));
  const spacingLines = new Map(spacingResult.plan.lines.map((line) => [line.blockId, line]));
  assert.ok(spacingLines.get('spacing-body').box.y >= spacingLines.get('spacing-heading').box.y + spacingLines.get('spacing-heading').box.height + 5, 'heading-to-body spacing must be applied in the planner');
  assert.ok(spacingLines.get('spacing-list').box.y >= spacingLines.get('spacing-body').box.y + spacingLines.get('spacing-body').box.height + 3, 'body-to-list spacing must be applied in the planner');
  assert.ok(Math.abs(spacingLines.get('spacing-list').box.y - spacingLines.get('spacing-body').box.y - spacingLines.get('spacing-body').box.height - 3) < 0.001, 'body-to-list spacing must remain a fractional configured gap instead of a full extra line');

  const obstacleInsideHeadingClusterTemplate = {
    maxPages: 1,
    layouts: [{ id: 'obstacle-inside-heading-cluster', width: 100, height: 100, slots: [
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 90 }, allowedRoles: ['heading', 'body'] },
      { id: 'quote', regionId: 'quotes', kind: 'text', box: { x: 5, y: 35, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['body'], layouts: ['obstacle-inside-heading-cluster'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], layouts: ['obstacle-inside-heading-cluster'], continuation: 'forbidden' },
    },
  };
  const obstacleInsideHeadingCluster = createTextCompositionEngine(obstacleInsideHeadingClusterTemplate, { headingKeepWithNextLines: 3 }).plan({
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [
        { id: 'cluster-heading', kind: 'heading', role: 'heading', keepWithNextLines: 3, text: 'Heading cluster first second third fourth' },
        { id: 'cluster-body', kind: 'paragraph', role: 'body', text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.' },
      ] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'cluster-quote', kind: 'paragraph', role: 'quote', text: 'A short quote blocks the cluster.' }] },
    },
  }, { ...metrics, lineHeight() { return 10; } });
  assert.equal(obstacleInsideHeadingCluster.evaluation.status, 'accepted', JSON.stringify(obstacleInsideHeadingCluster.evaluation));
  const clusterFixtureObstacle = obstacleInsideHeadingCluster.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:cluster-quote');
  const clusterFixtureLines = obstacleInsideHeadingCluster.plan.lines.filter((line) => ['cluster-heading', 'cluster-body'].includes(line.blockId));
  assert.ok(clusterFixtureObstacle, 'heading-cluster fixture must expose the quote as an exclusion obstacle');
  assert.ok(clusterFixtureLines.length > 0, 'heading-cluster fixture must place the main flow');
  assert.ok(clusterFixtureLines.every((line) => line.box.y >= clusterFixtureObstacle.box.y + clusterFixtureObstacle.box.height), `a heading and its first three lead lines must move below an obstacle that intersects the cluster: ${JSON.stringify({ obstacle: clusterFixtureObstacle.box, lines: clusterFixtureLines.map((line) => ({ blockId: line.blockId, y: line.box.y, text: line.text })), decisions: obstacleInsideHeadingCluster.plan.decisions.filter((decision) => decision.blockId?.startsWith('cluster-')) })}`);
  assert.ok(obstacleInsideHeadingCluster.plan.decisions.some((decision) => ['HEADING_CLUSTER_PUSHED_BELOW_OBSTACLE', 'HEADING_CLUSTER_PUSHED_TO_NEXT_SLOT'].includes(decision.code)), 'planner must record the hard heading-cluster decision when an obstacle intersects the lead probe');

  const deferredQuoteTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'opening', width: 100, height: 100, slots: [
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 40 }, allowedRoles: ['body', 'heading'] },
      ] },
      { id: 'continuation', width: 100, height: 100, slots: [
        { id: 'quote', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 20 }, allowedRoles: ['quote'] },
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 30, width: 90, height: 60 }, allowedRoles: ['body', 'heading'] },
      ] },
    ],
    routes: {
      main: {
        slots: ['body'],
        slotsByLayout: { continuation: ['quote', 'body'] },
        layouts: ['opening', 'continuation'],
        continuation: 'allowed',
      },
    },
  };
  const deferredQuote = createTextCompositionEngine(deferredQuoteTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'deferred-intro', kind: 'paragraph', role: 'body', text: 'Intro text.' },
      { id: 'deferred-quote', kind: 'paragraph', role: 'quote', text: 'A quote becomes a useful insertion.' },
      { id: 'deferred-body', kind: 'paragraph', role: 'body', text: Array.from({ length: 100 }, (_, index) => `body${index}`).join(' ') },
    ] } },
  }, metrics);
  assert.equal(deferredQuote.evaluation.status, 'accepted', JSON.stringify(deferredQuote.evaluation));
  assert.ok(deferredQuote.plan.decisions.some((decision) => decision.code === 'INSERTION_DEFERRED' && decision.blockId === 'deferred-quote'), 'a quote without an opening insertion slot must be explicitly deferred');
  assert.ok(deferredQuote.plan.decisions.some((decision) => decision.code === 'DEFERRED_INSERTION_PLACED' && decision.blockId === 'deferred-quote'), 'a deferred quote must be placed on the next legal page');
  assert.ok(deferredQuote.plan.lines.some((line) => line.blockId === 'deferred-body' && line.page === 1), 'ordinary article flow should use the opening page after deferring the quote');
  assert.ok(plannedLines(deferredQuote.plan).some((line) => line.blockId === 'deferred-quote' && line.page === 2 && line.slotId === '2:quote'), 'the quote should occupy the continuation insertion slot');
  assert.ok(deferredQuote.plan.lines.some((line) => line.blockId === 'deferred-body' && line.page === 2 && line.slotId === '2:body'), 'article flow should resume after the continuation quote');
  assert.equal(deferredQuote.plan.residualContent.length, 0);

  const optionalInsertionTemplate = {
    maxPages: 1,
    layouts: [{ id: 'optional-insertion', width: 100, height: 100, slots: [
      { id: 'body-before', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 40 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'main', kind: 'text', box: { x: 5, y: 45, width: 90, height: 20 }, allowedRoles: ['quote'] },
      { id: 'body-after', regionId: 'main', kind: 'text', box: { x: 5, y: 65, width: 90, height: 30 }, allowedRoles: ['body'] },
    ] }],
    routes: { main: { slots: ['body-before', 'quote', 'body-after'], layouts: ['optional-insertion'], continuation: 'forbidden' } },
  };
  const optionalInsertion = createTextCompositionEngine(optionalInsertionTemplate).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'optional-before', kind: 'paragraph', role: 'body', text: Array.from({ length: 40 }, (_, index) => `before${index}`).join(' ') },
      { id: 'optional-after', kind: 'paragraph', role: 'body', text: 'After the unused insertion.' },
    ] } },
  }, metrics);
  assert.equal(optionalInsertion.evaluation.status, 'accepted', JSON.stringify(optionalInsertion.evaluation));
  assert.ok(optionalInsertion.plan.decisions.some((decision) => decision.code === 'OPTIONAL_INSERTION_COLLAPSED'), 'unused insertion slots should collapse instead of reserving an empty band');
  const optionalAfter = optionalInsertion.plan.lines.find((line) => line.blockId === 'optional-after');
  assert.ok(optionalAfter && Math.abs(optionalAfter.box.y - 65) < 0.001, 'content after an unused insertion must keep its fixed route geometry');
  assert.equal(optionalInsertion.plan.slots.find((slot) => slot.id === '1:quote')?.state, 'exhausted', 'a collapsed insertion must not remain an open visual box');

  const loremEditorialFixture = {
    flows: {
      main: {
        id: 'main',
        continuation: 'forbidden',
        blocks: [
          { id: 'lorem-intro', kind: 'paragraph', role: 'intro', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vel justo sed erat posuere luctus.' },
          { id: 'lorem-quote-1', kind: 'paragraph', role: 'quote', text: 'Praesent commodo cursus magna, vel scelerisque nisl consectetur et.' },
          { id: 'lorem-body-1', kind: 'paragraph', role: 'body', text: 'Vestibulum id ligula porta felis euismod semper. Donec ullamcorper nulla non metus auctor fringilla.' },
          { id: 'lorem-quote-2', kind: 'paragraph', role: 'quote', text: 'Curabitur blandit tempus porttitor. Maecenas faucibus mollis interdum.' },
          { id: 'lorem-body-2', kind: 'paragraph', role: 'body', text: 'Aenean lacinia bibendum nulla sed consectetur. Cras mattis consectetur purus sit amet fermentum.' },
        ],
      },
    },
  };
  const loremEditorialTemplate = {
    maxPages: 1,
    layouts: [{ id: 'lorem-editorial', width: 100, height: 100, slots: [
      { id: 'intro', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 10 }, allowedRoles: ['intro'] },
      { id: 'quote-1', regionId: 'main', kind: 'text', box: { x: 5, y: 20, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'body-1', regionId: 'main', kind: 'text', box: { x: 5, y: 35, width: 40, height: 25 }, allowedRoles: ['body'] },
      { id: 'quote-2', regionId: 'main', kind: 'text', box: { x: 5, y: 65, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'body-2', regionId: 'main', kind: 'text', box: { x: 5, y: 80, width: 90, height: 15 }, allowedRoles: ['body'] },
    ] }],
    routes: { main: { slots: ['intro', 'quote-1', 'body-1', 'quote-2', 'body-2'], layouts: ['lorem-editorial'], continuation: 'forbidden' } },
  };
  const loremEditorial = createTextCompositionEngine(loremEditorialTemplate).plan(loremEditorialFixture, { ...metrics, lineHeight() { return 5; } });
  assert.equal(loremEditorial.evaluation.status, 'accepted', JSON.stringify(loremEditorial.evaluation));
  const loremVisualKeys = loremEditorial.plan.lines
    .filter((line) => line.flowId === 'main')
    .map((line) => `${line.page}:${line.routeIndex}:${line.box.y}:${line.box.x}`);
  assert.deepEqual(loremVisualKeys, [...loremVisualKeys].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })), 'lorem editorial placements must follow route order');
  const malformedOrder = structuredClone(loremEditorial.plan);
  const laterLine = malformedOrder.lines.find((line) => line.blockId === 'lorem-body-2');
  assert.ok(laterLine, 'lorem fixture must place the second body block');
  laterLine.routeIndex = 0;
  const malformedEvaluation = evaluateCompositionPlan(loremEditorialFixture, malformedOrder);
  assert.equal(malformedEvaluation.status, 'rejected');
  assert.ok(malformedEvaluation.diagnostics.some((item) => item.code === 'CONTENT_ORDER_VIOLATION'), 'evaluator must reject a later block moved before its preceding content');
  const malformedQuotes = structuredClone(loremEditorial.plan);
  for (const line of malformedQuotes.lines) {
    if (line.blockId === 'lorem-quote-1') line.routeIndex = 4;
    if (line.blockId === 'lorem-quote-2') line.routeIndex = 1;
  }
  const malformedQuoteEvaluation = evaluateCompositionPlan(loremEditorialFixture, malformedQuotes);
  assert.equal(malformedQuoteEvaluation.status, 'rejected');
  assert.ok(malformedQuoteEvaluation.diagnostics.some((item) => item.code === 'QUOTE_ORDER_VIOLATION'), 'evaluator must reject quotes that appear in reverse order');
  const malformedGap = structuredClone(loremEditorial.plan);
  const remapToSecondPage = (item) => ({ ...item, page: 2, slotId: item.slotId.replace(/^1:/u, '2:') });
  malformedGap.slots = malformedGap.slots.map((slot) => ({ ...slot, page: 2, id: slot.id.replace(/^1:/u, '2:') }));
  malformedGap.lines = malformedGap.lines.map(remapToSecondPage);
  malformedGap.placements = malformedGap.placements.map(remapToSecondPage);
  malformedGap.blockPlacements = malformedGap.blockPlacements.map(remapToSecondPage);
  malformedGap.tablePlacements = malformedGap.tablePlacements.map(remapToSecondPage);
  for (const line of malformedGap.lines) {
    if (line.blockId === 'lorem-body-2') line.routeIndex = 6;
  }
  const malformedGapEvaluation = evaluateCompositionPlan(loremEditorialFixture, malformedGap);
  assert.equal(malformedGapEvaluation.status, 'rejected');
  assert.ok(malformedGapEvaluation.diagnostics.some((item) => item.code === 'ROUTE_SEGMENT_GAP'), 'evaluator must report an empty route segment before later content');
  const emptyFlowSlot = structuredClone(loremEditorial.plan);
  emptyFlowSlot.lines = emptyFlowSlot.lines.filter((line) => line.slotId !== '1:body-1');
  emptyFlowSlot.placements = emptyFlowSlot.placements.filter((placement) => placement.slotId !== '1:body-1');
  emptyFlowSlot.slots = emptyFlowSlot.slots.map((slot) => slot.id === '1:body-1' ? { ...slot, state: 'open' } : slot);
  const emptyFlowSlotEvaluation = evaluateCompositionPlan(loremEditorialFixture, emptyFlowSlot);
  assert.equal(emptyFlowSlotEvaluation.status, 'rejected');
  assert.ok(emptyFlowSlotEvaluation.diagnostics.some((item) => item.code === 'EMPTY_FLOW_SLOT'), 'evaluator must report a skipped non-obstructed flow slot');

  const preplannedInsertionTemplate = {
    maxPages: 2,
    layouts: [1, 2].map((page) => ({ id: `preplanned-insertion-${page}`, width: 100, height: 100, slots: [
      { id: 'left', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 90 }, allowedRoles: ['body'] },
      { id: 'right', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 90 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'main', kind: 'text', box: { x: 5, y: 35, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] })),
    routes: {
      main: {
        slots: ['left', 'right'],
        insertionSlots: ['quote'],
        layouts: ['preplanned-insertion-1', 'preplanned-insertion-2'],
        slotsByLayout: { 'preplanned-insertion-2': ['left', 'right'] },
        continuation: 'allowed',
      },
    },
  };
  const preplannedInsertion = createTextCompositionEngine(preplannedInsertionTemplate, { maxPlanningIterations: 2 }).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'preplanned-before', kind: 'paragraph', role: 'body', text: Array.from({ length: 12 }, (_, index) => `before${index}`).join(' ') },
      { id: 'preplanned-quote', kind: 'paragraph', role: 'quote', text: 'quote insertion is measured before the main flow resumes' },
      { id: 'preplanned-after', kind: 'paragraph', role: 'body', text: Array.from({ length: 60 }, (_, index) => `after${index}`).join(' ') },
    ] } },
  }, metrics);
  assert.equal(preplannedInsertion.evaluation.status, 'accepted', JSON.stringify(preplannedInsertion.evaluation));
  assert.ok(preplannedInsertion.plan.insertionLines?.some((line) => line.blockId === 'preplanned-quote' && line.layer === 'insertion'), 'quote must be planned in the insertion layer');
  assert.equal(preplannedInsertion.plan.lines.some((line) => line.blockId === 'preplanned-quote'), false, 'insertion text must not be part of ordinary main-flow lines');
  assert.ok(preplannedInsertion.plan.decisions.some((decision) => decision.code === 'INSERTION_LAYER_PLACED'));
  assert.ok(preplannedInsertion.plan.trace?.phases.some((phase) => phase.name === 'insertion-placement'));

  const fitContentInsertionTemplate = {
    maxPages: 1,
    layouts: [{ id: 'fit-content-insertion', width: 100, height: 100, slots: [
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 90 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'quotes', kind: 'text', box: { x: 5, y: 40, width: 90, height: 30 }, allowedRoles: ['quote'], verticalAlign: 'middle', fitContent: true, grow: { axis: 'y', maxHeight: 40 } },
    ] }],
    routes: {
      main: { slots: ['body'], layouts: ['fit-content-insertion'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], layouts: ['fit-content-insertion'], continuation: 'forbidden' },
    },
  };
  const fitContentInsertion = createTextCompositionEngine(fitContentInsertionTemplate).plan({
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'fit-body', kind: 'paragraph', role: 'body', text: Array.from({ length: 30 }, (_, index) => `body${index}`).join(' ') }] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'fit-quote', kind: 'paragraph', role: 'quote', text: 'A short quote remains prominent without a large empty box.' }] },
    },
  }, metrics);
  assert.equal(fitContentInsertion.evaluation.status, 'accepted', JSON.stringify(fitContentInsertion.evaluation));
  const fitQuoteSlot = fitContentInsertion.plan.slots.find((slot) => slot.id === '1:quote');
  const fitQuoteObstacle = fitContentInsertion.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:fit-quote');
  assert.ok(fitQuoteSlot && fitQuoteSlot.box.height < 30, 'fit-content insertion must shrink below its initial frame when the quote is short');
  assert.ok(fitQuoteObstacle && fitQuoteSlot && fitQuoteObstacle.box.height === fitQuoteSlot.box.height, 'the exclusion obstacle must use the measured quote height');

  const repositionedInsertionTemplate = {
    maxPages: 1,
    layouts: [{ id: 'repositioned-insertion', width: 100, height: 100, slots: [
      { id: 'body-before', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 15 }, allowedRoles: ['body'] },
      { id: 'body-gap', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 15 }, allowedRoles: ['body'] },
      { id: 'quote', regionId: 'main', kind: 'text', box: { x: 5, y: 25, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'body-after', regionId: 'main', kind: 'text', box: { x: 5, y: 40, width: 90, height: 20 }, allowedRoles: ['body'] },
    ] }],
    routes: { main: { slots: ['body-before', 'body-gap', 'quote', 'body-after'], layouts: ['repositioned-insertion'], continuation: 'forbidden' } },
  };
  const orderedInsertion = createTextCompositionEngine(repositionedInsertionTemplate).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'repositioned-before', kind: 'paragraph', role: 'body', text: 'First material.' },
      { id: 'repositioned-quote', kind: 'paragraph', role: 'quote', text: 'An editorial insertion can move below a balanced column break.' },
      { id: 'repositioned-after', kind: 'paragraph', role: 'body', text: 'Second material fills the otherwise empty earlier segment.' },
    ] } },
  }, metrics);
  assert.equal(orderedInsertion.evaluation.status, 'rejected', JSON.stringify(orderedInsertion.evaluation));
  assert.ok(orderedInsertion.evaluation.diagnostics.some((item) => item.code === 'EMPTY_FLOW_PLACEMENT'), 'an empty placement between earlier and later content must reject the route');

  const numberedInsetTemplate = {
    maxPages: 1,
    layouts: [{ id: 'numbered-inset', width: 100, height: 100, slots: [
      { id: 'left-before', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'right-before', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'quote-a', regionId: 'main', kind: 'text', box: { x: 5, y: 20, width: 90, height: 10 }, allowedRoles: ['quote'] },
      { id: 'left-after', regionId: 'main', kind: 'text', box: { x: 5, y: 35, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'right-after', regionId: 'main', kind: 'text', box: { x: 55, y: 35, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'quote-b', regionId: 'main', kind: 'text', box: { x: 5, y: 70, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: { main: { slots: ['left-before', 'quote-a', 'left-after', 'quote-b', 'right-before', 'right-after'], layouts: ['numbered-inset'], continuation: 'forbidden' } },
  };
  const numberedWords = Array.from({ length: 16 }, (_, index) => `word-${String(index + 1).padStart(4, '0')}`);
  const numberedTailWords = Array.from({ length: 8 }, (_, index) => `word-${String(index + numberedWords.length + 1).padStart(4, '0')}`);
  const numberedInset = createTextCompositionEngine(numberedInsetTemplate).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'numbered-body', kind: 'paragraph', role: 'body', text: numberedWords.join(' ') },
      { id: 'numbered-quote', kind: 'paragraph', role: 'quote', text: 'quote-0001 quote-0002' },
      { id: 'numbered-tail', kind: 'paragraph', role: 'body', text: numberedTailWords.join(' ') },
    ] } },
  }, metrics);
  assert.equal(numberedInset.evaluation.status, 'accepted', JSON.stringify(numberedInset.evaluation));
  const numberedBodyLines = numberedInset.plan.lines.filter((line) => line.blockId === 'numbered-body');
  const numberedQuoteLines = plannedLines(numberedInset.plan).filter((line) => line.blockId === 'numbered-quote');
  const numberedTailLines = numberedInset.plan.lines.filter((line) => line.blockId === 'numbered-tail');
  assert.equal(numberedBodyLines.length > 0, true, 'numbered inset fixture must place the body');
  assert.equal(numberedQuoteLines.length > 0, true, 'numbered inset fixture must place the quote');
  assert.equal(numberedTailLines.length > 0, true, 'numbered inset fixture must place the tail');
  assert.ok(numberedBodyLines.every((line) => line.box.x < 50), 'a body before an insertion must finish in the left column before using the right column');
  assert.ok(Math.max(...numberedBodyLines.map((line) => line.box.y + line.box.height)) <= Math.min(...numberedQuoteLines.map((line) => line.box.y)), 'the body must finish before its following quote is painted');
  assert.ok(numberedQuoteLines.every((line) => line.slotId === '1:quote-b'), 'the quote must move to the later insertion slot when quote-a would cause an early column jump');
  assert.equal(numberedInset.plan.slots.find((slot) => slot.id === '1:quote-a')?.state, 'exhausted', 'an unused early insertion slot must collapse instead of reserving a blank band');
  assert.ok(numberedTailLines.every((line) => line.box.x >= 50), 'content after the quote may enter the right column only after the left column is exhausted');
  const numberedEntries = [...numberedBodyLines, ...numberedTailLines].flatMap((line) => (line.text.match(/word-\d{4}/gu) ?? []).map((text) => ({ number: Number(text.slice(-4)), x: line.box.x, y: line.box.y })));
  for (const right of numberedEntries.filter((entry) => entry.x >= 50)) {
    for (const left of numberedEntries.filter((entry) => entry.x < 50 && right.y <= entry.y)) {
      assert.ok(right.number > left.number, `number ${right.number} must not appear to the right and above number ${left.number}`);
    }
  }
  const numberedTextTokens = [...numberedBodyLines, ...numberedTailLines].flatMap((line) => line.text.match(/word-\d{4}/gu) ?? []);
  assert.deepEqual(numberedTextTokens, [...numberedWords, ...numberedTailWords], 'numbered words must remain complete and in source order');
  for (const slotId of ['1:left-before', '1:left-after']) {
    const slot = numberedInset.plan.slots.find((candidate) => candidate.id === slotId);
    const slotLines = numberedBodyLines.filter((line) => line.slotId === slotId);
    assert.ok(slot && slotLines.length > 0 && slot.state === 'exhausted', `${slotId} must be exhausted before the right column starts`);
    const lastBottom = Math.max(...slotLines.map((line) => line.box.y + line.box.height));
    assert.ok(slot && slot.box.y + slot.box.height - lastBottom < 5, `${slotId} must not leave a free line before the right column starts`);
  }
  const malformedInset = structuredClone(numberedInset.plan);
  const splitBodyLine = malformedInset.lines.findLast((line) => line.blockId === 'numbered-body');
  assert.ok(splitBodyLine, 'numbered fixture must have a final body line to mutate');
  splitBodyLine.slotId = '1:right-before';
  splitBodyLine.routeIndex = 4;
  splitBodyLine.box = { x: 55, y: 5, width: 40, height: 10 };
  const malformedInsetEvaluation = evaluateCompositionPlan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'numbered-body', kind: 'paragraph', role: 'body', text: numberedWords.join(' ') },
      { id: 'numbered-quote', kind: 'paragraph', role: 'quote', text: 'quote-0001 quote-0002' },
      { id: 'numbered-tail', kind: 'paragraph', role: 'body', text: numberedTailWords.join(' ') },
    ] } },
  }, malformedInset);
  assert.equal(malformedInsetEvaluation.status, 'rejected');
  assert.ok(malformedInsetEvaluation.diagnostics.some((item) => item.code === 'BLOCK_SPLITS_ACROSS_INSERTION'), 'evaluator must reject a block split by a quote insertion');

  const continuousObstacleTemplate = {
    maxPages: 3,
    layouts: [{ id: 'continuous-obstacle', width: 100, height: 100, slots: [
      { id: 'left', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 90 } },
      { id: 'right', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 90 } },
      { id: 'obstacle', regionId: 'main', kind: 'graphic', box: { x: 5, y: 35, width: 90, height: 10 } },
    ] }],
    routes: { main: { slots: ['left', 'right'], layouts: ['continuous-obstacle'], continuation: 'allowed' } },
  };
  const continuousObstacleWords = Array.from({ length: 180 }, (_, index) => `lorem${String(index + 1).padStart(4, '0')}`);
  const continuousObstacle = createTextCompositionEngine(continuousObstacleTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'continuous-body', kind: 'paragraph', role: 'body', text: continuousObstacleWords.join(' ') }] } },
    graphics: [1, 2, 3].map((page) => ({ id: `obstacle-${page}`, slotId: 'obstacle', shape: 'rectangle', wrap: 'around', page })),
  }, metrics);
  assert.equal(continuousObstacle.evaluation.status, 'accepted', JSON.stringify(continuousObstacle.evaluation));
  assert.equal(continuousObstacle.plan.pages.length, 3, 'continuous obstacle fixture must exercise three pages');
  assert.equal(continuousObstacle.plan.graphicPlacements.length, 3, 'each page must materialize its full-width obstacle');
  assert.equal(continuousObstacle.evaluation.diagnostics.some((item) => item.code === 'LINE_GRAPHIC_OVERLAP'), false);
  const continuousNumbers = continuousObstacle.plan.lines
    .filter((line) => line.blockId === 'continuous-body')
    .flatMap((line) => (line.text.match(/lorem\d{4}/gu) ?? []).map((token) => Number(token.slice(-4))));
  assert.deepEqual(continuousNumbers, continuousObstacleWords.map((_, index) => index + 1), 'continuous obstacle flow must preserve every numbered word in source order');
  for (const page of continuousObstacle.plan.pages) {
    const pageLines = continuousObstacle.plan.lines.filter((line) => line.blockId === 'continuous-body' && line.page === page.page);
    const leftLines = pageLines.filter((line) => line.box.x < 50);
    const rightLines = pageLines.filter((line) => line.box.x >= 50);
    assert.ok(leftLines.length > 0, `page ${page.page} must use the left column`);
    if (page.page < 3) assert.ok(rightLines.length > 0, `page ${page.page} must use the right column after exhausting the left`);
    const beforeObstacle = leftLines.filter((line) => line.box.y + line.box.height <= 35);
    const afterObstacle = leftLines.filter((line) => line.box.y >= 45);
    assert.ok(beforeObstacle.length > 0 && afterObstacle.length > 0, `page ${page.page} must continue down the same column around its obstacle`);
    if (page.page < 3) {
      const rightBeforeObstacle = rightLines.filter((line) => line.box.y + line.box.height <= 35);
      const rightAfterObstacle = rightLines.filter((line) => line.box.y >= 45);
      assert.ok(rightBeforeObstacle.length > 0 && rightAfterObstacle.length > 0, `page ${page.page} must fill both right-column zones around its obstacle`);
    }
    assert.equal(pageLines.some((line) => line.box.y < 45 && line.box.y + line.box.height > 35), false, `page ${page.page} has text inside the obstacle band`);
    if (rightLines.length > 0) {
      const leftNumbers = leftLines.flatMap((line) => (line.text.match(/lorem\d{4}/gu) ?? []).map((token) => Number(token.slice(-4))));
      const rightNumbers = rightLines.flatMap((line) => (line.text.match(/lorem\d{4}/gu) ?? []).map((token) => Number(token.slice(-4))));
      assert.ok(Math.min(...rightNumbers) > Math.max(...leftNumbers), `page ${page.page} entered the right column before the left flow was exhausted`);
    }
  }

  const pixelFixture = parse(await readFile(join(root, 'templates/composition-pixel-qa-prototype.yml'), 'utf8')).numbered_flow;
  const pdfRenderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const numberedObstacleTemplate = {
    maxPages: pixelFixture.max_pages,
    layouts: [{ id: 'numbered-obstacle', width: pixelFixture.page.width, height: pixelFixture.page.height, slots: [
      { id: 'left', regionId: 'main', kind: 'text', box: pixelFixture.columns.left },
      { id: 'right', regionId: 'main', kind: 'text', box: pixelFixture.columns.right },
      ...pixelFixture.obstacles.map((obstacle) => ({ id: obstacle.id, regionId: 'main', kind: 'text', allowedRoles: ['quote'], box: { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height } })),
    ] }],
    routes: {
      main: { slots: ['left', 'right'], layouts: ['numbered-obstacle'], continuation: 'allowed' },
      quotes: { slots: [], insertionSlots: pixelFixture.obstacles.map((obstacle) => obstacle.id), layouts: ['numbered-obstacle'], continuation: 'allowed' },
    },
  };
  const numberedWordBases = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'integer', 'vivamus', 'praesent', 'commodo'];
  const numberedObstacleWords = Array.from({ length: pixelFixture.expected_words }, (_, index) => `${numberedWordBases[index % numberedWordBases.length]}${String(index + 1).padStart(4, '0')}`);
  const numberedQuoteWords = Array.from({ length: pixelFixture.expected_pages_with_obstacles.length * pixelFixture.obstacles.length }, (_, index) => ({
    id: `numbered-quote-${index + 1}`,
    text: Array.from({ length: 8 }, (_, wordIndex) => `quote${index + 1}${String(wordIndex + 1).padStart(4, '0')}`).join(' '),
  }));
  const numberedBlocks = [{ id: 'numbered-body', kind: 'paragraph', role: 'body', text: numberedObstacleWords.join(' ') }];
  const numberedObstacleDocument = {
    flows: {
      main: { id: 'main', continuation: 'allowed', blocks: numberedBlocks },
      quotes: { id: 'quotes', continuation: 'allowed', blocks: numberedQuoteWords.map((quote) => ({ id: quote.id, kind: 'paragraph', role: 'quote', text: quote.text })) },
    },
  };
  assert.equal(pixelFixture.expected_words, numberedObstacleWords.length, 'pixel fixture word count must match the numbered planner fixture');
  const numberedStyles = {
    body: {
      fontSize: pixelFixture.text_style.font_size,
      lineHeight: pixelFixture.text_style.line_height,
      baselineOffset: pixelFixture.text_style.baseline_offset,
      fontStyle: 'normal',
      textColor: [12, 24, 40],
    },
    quote: {
      fontSize: pixelFixture.text_style.font_size,
      lineHeight: pixelFixture.text_style.line_height,
      baselineOffset: pixelFixture.text_style.baseline_offset,
      fontStyle: 'normal',
      textColor: pixelFixture.obstacle_style.draw_color,
    },
  };
  const numberedPlannerPdf = newPdf('portrait', [pixelFixture.page.width, pixelFixture.page.height]);
  const numberedMetrics = createJsPdfTextMetrics(numberedPlannerPdf, 'DejaVu', numberedStyles);
  const numberedObstacle = createTextCompositionEngine(numberedObstacleTemplate).plan(numberedObstacleDocument, numberedMetrics);
  assert.equal(numberedObstacle.evaluation.status, 'accepted', JSON.stringify(numberedObstacle.evaluation));
  assert.equal(numberedObstacle.plan.pages.length, pixelFixture.max_pages, 'the numbered obstacle fixture must occupy its configured page count');
  const numberedBodyIds = new Set(numberedBlocks.filter((block) => block.role === 'body').map((block) => block.id));
  const numberedObstacleLines = numberedObstacle.plan.lines.filter((line) => numberedBodyIds.has(line.blockId));
  const numberedInsertionLines = (numberedObstacle.plan.insertionLines ?? []).filter((line) => line.flowId === 'quotes');
  const numberedObstaclePattern = new RegExp(`(?:${numberedWordBases.join('|')})\\d{4}`, 'gu');
  const numberedBodyInk = numberedMetrics.lineInkBounds('body');
  for (const line of numberedObstacleLines) {
    const inkTop = line.box.y + numberedBodyInk.top;
    const inkBottom = line.box.y + numberedBodyInk.bottom;
    for (const obstacle of numberedObstacle.plan.graphicPlacements.filter((graphic) => graphic.wrap === 'around' && graphic.page === line.page)) {
      const horizontalOverlap = line.box.x < obstacle.box.x + obstacle.box.width && line.box.x + line.box.width > obstacle.box.x;
      const verticalOverlap = inkTop < obstacle.box.y + obstacle.box.height && inkBottom > obstacle.box.y;
      assert.equal(horizontalOverlap && verticalOverlap, false, `planned text ink must not overlap ${obstacle.graphicId}: ${JSON.stringify({ line: line.box, inkTop, inkBottom, obstacle: obstacle.box })}`);
    }
  }
  for (const obstacle of numberedObstacle.plan.graphicPlacements.filter((graphic) => graphic.wrap === 'around')) {
    for (const column of ['left', 'right']) {
      const columnLines = numberedObstacleLines
        .filter((line) => line.page === obstacle.page && (column === 'left' ? line.box.x < pixelFixture.columns.divider_x : line.box.x >= pixelFixture.columns.divider_x))
        .filter((line) => line.box.y + numberedBodyInk.top >= obstacle.box.y + obstacle.box.height)
        .sort((left, right) => left.box.y - right.box.y);
      const firstAfterObstacle = columnLines[0];
      assert.ok(firstAfterObstacle, `${column} column on page ${obstacle.page} must resume after ${obstacle.graphicId}`);
      assert.ok(
        Math.abs((firstAfterObstacle.box.y + numberedBodyInk.top) - (obstacle.box.y + obstacle.box.height)) <= pixelFixture.obstacle_boundary_tolerance,
        `${column} column must use the ${obstacle.graphicId} lower boundary as a line-placement candidate: ${JSON.stringify({ line: firstAfterObstacle.box, inkTop: numberedBodyInk.top, obstacle: obstacle.box })}`,
      );
    }
  }
  assert.deepEqual(numberedObstacleLines.flatMap((line) => line.text.match(numberedObstaclePattern) ?? []), numberedObstacleWords, 'the 1000-word obstacle fixture must retain source order');
  assert.deepEqual(
    [...new Set(numberedInsertionLines.map((line) => line.blockId))],
    numberedQuoteWords.map((quote) => quote.id),
    'quote insertions must remain a separate, authored stream in source order',
  );
  const numberedQuotePattern = /quote[1-4]\d{4}/gu;
  assert.deepEqual(
    numberedInsertionLines.flatMap((line) => line.text.match(numberedQuotePattern) ?? []),
    numberedQuoteWords.flatMap((quote) => quote.text.match(numberedQuotePattern) ?? []),
    'every numbered quote word must be painted in the insertion layer in source order',
  );
  assert.equal(numberedObstacle.plan.lines.some((line) => numberedQuoteWords.some((quote) => quote.id === line.blockId)), false, 'quote text must never masquerade as ordinary column flow');
  const obstacleZones = (page) => Object.fromEntries(pixelFixture.expected_zones.map((zone) => [zone.id, numberedObstacleLines.filter((line) => {
    if (line.page !== page) return false;
    const lineRight = line.box.x + line.box.width;
    const lineBottom = line.box.y + line.box.height;
    return line.box.x >= zone.x && lineRight <= zone.x + zone.width && line.box.y >= zone.y && lineBottom <= zone.y + zone.height;
  })]));
  for (const page of pixelFixture.expected_pages_with_obstacles) {
    const zones = obstacleZones(page);
    for (const [zone, lines] of Object.entries(zones)) assert.ok(lines.length > 0, `numbered obstacle page ${page} zone ${zone} must contain text ink`);
    const leftNumbers = numberedObstacleLines.filter((line) => line.page === page && line.box.x < pixelFixture.columns.divider_x).flatMap((line) => (line.text.match(numberedObstaclePattern) ?? []).map((token) => Number(token.slice(-4))));
    const rightNumbers = numberedObstacleLines.filter((line) => line.page === page && line.box.x >= pixelFixture.columns.divider_x).flatMap((line) => (line.text.match(numberedObstaclePattern) ?? []).map((token) => Number(token.slice(-4))));
    assert.ok(Math.min(...rightNumbers) > Math.max(...leftNumbers), `numbered obstacle page ${page} must exhaust the left column before entering the right`);
  }
  assert.ok(numberedObstacleLines.some((line) => line.page === pixelFixture.max_pages && line.box.x < pixelFixture.columns.divider_x) && numberedObstacleLines.some((line) => line.page === pixelFixture.max_pages && line.box.x >= pixelFixture.columns.divider_x), 'numbered obstacle final page must fill both final columns');

  const numberedPdf = newPdf('portrait', [pixelFixture.page.width, pixelFixture.page.height]);
  const rasterPdf = join(temporary, 'numbered-obstacle-pixel-qa.pdf');
  await writeFile(rasterPdf, renderComposition(
    numberedObstacleDocument,
    numberedObstacle,
    createJsPdfTextBackend(numberedPdf, 'DejaVu', numberedStyles, {
      pageSizeTolerance: pdfRenderConfig.pdf.page_size_tolerance,
      graphicStyle: {
        fillColor: pixelFixture.obstacle_style.fill_color,
        drawColor: pixelFixture.obstacle_style.draw_color,
        lineWidth: pixelFixture.obstacle_style.line_width,
      },
    }),
  ));
  const rasterDirectory = await mkdtemp(join(temporary, 'numbered-obstacle-raster-'));
  const rasterPrefix = join(rasterDirectory, 'page');
  const rasterized = runProcess('pdftoppm', [
    '-f', '1',
    '-l', String(pixelFixture.max_pages),
    '-r', String(pdfRenderConfig.quality.pdf_pixel_qa.raster_dpi),
    rasterPdf,
    rasterPrefix,
  ], { cwd: root, timeout: 30_000 });
  assert.equal(rasterized.status, 0, rasterized.stderr || rasterized.stdout);
  const rasterPages = Array.from({ length: pixelFixture.max_pages }, (_, index) => decodePpm(readFileSync(`${rasterPrefix}-${index + 1}.ppm`)));
  const pixelChecks = [];
  for (const page of pixelFixture.expected_pages_with_obstacles) {
    const image = rasterPages[page - 1];
    for (const zone of pixelFixture.expected_zones) {
      const profile = inkProfileInBox(image, zone, pixelFixture.page, pdfRenderConfig.quality.pdf_pixel_qa);
      const check = { page, zone: zone.id, ...profile };
      pixelChecks.push(check);
      assert.ok(profile.boxMm && profile.boundsMm && profile.rowBands.length > 0, `required obstacle-flow zone has no positional ink profile: ${JSON.stringify(check)}`);
      assert.ok(profile.inkPixels >= pdfRenderConfig.quality.pdf_pixel_qa.minimum_ink_pixels, `required obstacle-flow zone is visually empty: ${JSON.stringify(check)}`);
    }
  }
  for (const [index, column] of pixelFixture.expected_final_columns.entries()) {
    const page = pixelFixture.max_pages;
    const profile = inkProfileInBox(rasterPages[page - 1], column, pixelFixture.page, pdfRenderConfig.quality.pdf_pixel_qa);
    const check = { page, zone: column.id, ...profile };
    pixelChecks.push(check);
    assert.ok(profile.boxMm && profile.boundsMm && profile.rowBands.length > 0, `final page column has no positional ink profile: ${JSON.stringify(check)}`);
    assert.ok(profile.inkPixels >= pdfRenderConfig.quality.pdf_pixel_qa.minimum_ink_pixels, `final page column ${index + 1} is visually empty: ${JSON.stringify(check)}`);
  }
  for (const line of numberedInsertionLines) {
    const profile = inkProfileInBox(rasterPages[line.page - 1], line.box, pixelFixture.page, pdfRenderConfig.quality.pdf_pixel_qa);
    const check = { page: line.page, zone: `insertion:${line.blockId}`, ...profile };
    pixelChecks.push(check);
    assert.ok(profile.boxMm && profile.boundsMm && profile.rowBands.length > 0, `quote insertion has no positional ink profile: ${JSON.stringify(check)}`);
    assert.ok(profile.inkPixels >= pdfRenderConfig.quality.pdf_pixel_qa.minimum_ink_pixels, `quote insertion is visually empty: ${JSON.stringify(check)}`);
  }
  await writeNumberedPixelArtifacts(process.env.REPORT_BABY_ARTIFACT_DIR, numberedObstacle, numberedObstacleDocument, await readFile(rasterPdf), pixelChecks);
  const extractedNumberedWords = pdfWords(rasterPdf);
  assertPdfSpatialOrder(extractedNumberedWords, {
    expectedWords: pixelFixture.expected_words,
    dividerX: pixelFixture.columns.divider_x,
    prefixes: numberedWordBases,
    obstacles: pixelFixture.obstacles,
    pagesWithObstacles: pixelFixture.expected_pages_with_obstacles,
    obstacleBoundaryTolerance: pixelFixture.obstacle_boundary_tolerance,
  }, pdfRenderConfig.quality.pdf_pixel_qa);
  const quoteTokenPattern = /^quote[1-4]\d{4}$/u;
  const expectedQuoteTokens = numberedQuoteWords.flatMap((quote) => quote.text.split(/\s+/u));
  const extractedQuoteTokens = extractedNumberedWords.filter((word) => quoteTokenPattern.test(word.text));
  assert.deepEqual(extractedQuoteTokens.map((word) => word.text).sort(), expectedQuoteTokens.slice().sort(), 'final PDF must contain every numbered quote word exactly once');
  for (const word of extractedQuoteTokens) {
    const quoteNumber = Number(word.text.slice(5, 6));
    const expectedLine = numberedInsertionLines.find((line) => line.blockId === `numbered-quote-${quoteNumber}`);
    assert.ok(expectedLine, `final PDF quote word ${word.text} has no planned insertion line`);
    const expectedSlot = numberedObstacle.plan.slots.find((slot) => slot.id === expectedLine?.slotId);
    assert.ok(expectedSlot, `final PDF quote word ${word.text} has no planned insertion slot`);
    assert.equal(word.page, expectedLine.page - 1, `final PDF quote word ${word.text} moved to another page`);
    const placementTolerance = pdfRenderConfig.quality.pdf_pixel_qa.placement_tolerance_mm;
    assert.ok(word.xMin >= expectedSlot.box.x - placementTolerance && word.xMax <= expectedSlot.box.x + expectedSlot.box.width + placementTolerance
      && word.yMin >= expectedSlot.box.y - placementTolerance && word.yMax <= expectedSlot.box.y + expectedSlot.box.height + placementTolerance,
    `final PDF quote word ${word.text} left its planned insertion box`);
  }

  const continuousQuoteTemplate = {
    maxPages: 1,
    layouts: [{ id: 'continuous-quote', width: 100, height: 100, slots: [
      { id: 'left', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 90 } },
      { id: 'right', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 90 } },
      { id: 'quote-a', regionId: 'main', kind: 'text', box: { x: 5, y: 35, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: { main: { slots: ['left', 'right'], insertionSlots: ['quote-a'], layouts: ['continuous-quote'], continuation: 'forbidden' } },
  };
  const continuousQuoteDocument = {
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'quote-before', kind: 'paragraph', role: 'body', text: 'word-0001 word-0002 word-0003 word-0004 word-0005 word-0006 word-0007 word-0008' },
      { id: 'quote-insertion', kind: 'paragraph', role: 'quote', text: 'A quote sits inside the continuous route.' },
      { id: 'quote-after', kind: 'paragraph', role: 'body', text: Array.from({ length: 40 }, (_, index) => `word-${String(index + 9).padStart(4, '0')}`).join(' ') },
    ] } },
  };
  const continuousQuote = createTextCompositionEngine(continuousQuoteTemplate).plan(continuousQuoteDocument, metrics);
  assert.equal(continuousQuote.evaluation.status, 'accepted', JSON.stringify(continuousQuote.evaluation));
  assert.ok(continuousQuote.plan.insertionLines?.some((line) => line.blockId === 'quote-insertion' && line.slotId === '1:quote-a'), 'an insertion that fits below the current flow must stay on the current page');
  assert.equal(continuousQuote.plan.lines.some((line) => line.blockId === 'quote-insertion'), false, 'an insertion must not masquerade as an ordinary flow line');
  assert.ok(continuousQuote.plan.graphicPlacements.some((graphic) => graphic.graphicId === 'insertion:quote-insertion' && graphic.wrap === 'around'), 'a placed quote must become a planner-only obstacle');
  const quoteObstacle = continuousQuote.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:quote-insertion');
  const beforeQuoteLine = continuousQuote.plan.lines.find((line) => line.blockId === 'quote-before');
  assert.ok(quoteObstacle && beforeQuoteLine && beforeQuoteLine.box.y + beforeQuoteLine.box.height <= quoteObstacle.box.y, 'content before an insertion must remain above its obstacle');
  assert.ok(continuousQuote.plan.lines.some((line) => line.blockId === 'quote-after' && line.slotId === '1:left' && line.box.y >= 45), 'following text must continue below the quote in the same column');
  assert.ok(continuousQuote.plan.lines.some((line) => line.blockId === 'quote-after' && line.slotId === '1:right'), 'following text must enter the right column only after the left column is consumed');

  const wrongInsertionOrder = structuredClone(continuousQuote.plan);
  const movedPredecessor = wrongInsertionOrder.lines.find((line) => line.blockId === 'quote-before');
  assert.ok(movedPredecessor, 'source-order fixture must expose the predecessor line');
  movedPredecessor.box.y = 50;
  const wrongInsertionEvaluation = evaluateCompositionPlan(continuousQuoteDocument, wrongInsertionOrder);
  assert.equal(wrongInsertionEvaluation.status, 'rejected');
  assert.ok(wrongInsertionEvaluation.diagnostics.some((item) => item.code === 'INSERTION_SOURCE_ORDER_VIOLATION'), 'evaluator must reject content moved below its insertion');

  const impossibleInsertionDocument = structuredClone(continuousQuoteDocument);
  impossibleInsertionDocument.flows.main.blocks[0].text = Array.from({ length: 20 }, (_, index) => `before-${String(index + 1).padStart(4, '0')}`).join(' ');
  const impossibleInsertion = createTextCompositionEngine(continuousQuoteTemplate).plan(impossibleInsertionDocument, metrics);
  assert.equal(impossibleInsertion.evaluation.status, 'rejected');
  assert.ok(impossibleInsertion.evaluation.diagnostics.some((item) => ['INSERTION_PRECEDENCE_CONFLICT', 'INSERTION_SOURCE_ORDER_VIOLATION', 'MAX_PAGES_EXCEEDED'].includes(item.code)), `planner must reject an insertion that cannot preserve source order above its obstacle: ${JSON.stringify(impossibleInsertion.evaluation)}`);

  const defaultHeadingKeepTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'default-heading-first', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 30 } }] },
      { id: 'default-heading-continuation', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 40 } }] },
    ],
    routes: { main: { slots: ['body'], slotsByLayout: { 'default-heading-continuation': ['body'] }, layouts: ['default-heading-first', 'default-heading-continuation'], continuation: 'allowed' } },
  };
  const defaultHeadingKeepDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'default-heading-prefill', kind: 'paragraph', role: 'body', text: Array.from({ length: 12 }, (_, index) => `prefill${String(index + 1).padStart(4, '0')}`).join(' ') },
      { id: 'default-heading', kind: 'heading', role: 'heading', text: 'Education' },
      { id: 'default-heading-body', kind: 'paragraph', role: 'body', text: Array.from({ length: 30 }, (_, index) => `lead${String(index + 1).padStart(4, '0')}`).join(' ') },
    ] } },
  };
  const defaultHeadingKeep = createTextCompositionEngine(defaultHeadingKeepTemplate, { headingKeepWithNextLines: 3 }).plan(defaultHeadingKeepDocument, metrics);
  assert.equal(defaultHeadingKeep.evaluation.status, 'accepted', JSON.stringify(defaultHeadingKeep.evaluation));
  const defaultHeadingLines = defaultHeadingKeep.plan.lines.filter((line) => line.blockId === 'default-heading');
  const defaultLeadLines = defaultHeadingKeep.plan.lines.filter((line) => line.blockId === 'default-heading-body');
  assert.ok(defaultHeadingLines.length > 0 && defaultLeadLines.length >= 3, 'default heading fixture must place heading and three lead lines');
  assert.equal(defaultHeadingLines[0].page, defaultLeadLines[0].page, 'default heading must stay with the first three lead lines on the same page');
  assert.equal(defaultHeadingLines[0].slotId, defaultLeadLines[0].slotId, 'default heading must stay with the first three lead lines in the same placement');
  assert.ok(defaultHeadingKeep.plan.decisions.some((decision) => decision.code === 'KEEP_CLUSTER_PUSHED'), 'default heading policy must push the heading cluster instead of placing an orphan heading');

  const headingClusterTemplate = {
    maxPages: 1,
    layouts: [{ id: 'heading-cluster', width: 100, height: 100, slots: [
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 95 }, allowedRoles: ['body', 'heading'] },
      { id: 'quote', regionId: 'quotes', kind: 'text', box: { x: 5, y: 25, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['body'], layouts: ['heading-cluster'], continuation: 'forbidden' },
      quotes: { slots: ['quote'], insertionSlots: ['quote'], layouts: ['heading-cluster'], continuation: 'forbidden' },
    },
  };
  const headingClusterDocument = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [
        { id: 'cluster-heading', kind: 'heading', role: 'heading', text: Array.from({ length: 20 }, (_, index) => `heading${String(index + 1).padStart(4, '0')}`).join(' ') },
        { id: 'cluster-body', kind: 'paragraph', role: 'body', text: Array.from({ length: 24 }, (_, index) => `body${String(index + 1).padStart(4, '0')}`).join(' ') },
      ] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'cluster-quote', kind: 'paragraph', role: 'quote', text: 'A quote is an obstacle, not a route segment.' }] },
    },
  };
  const headingCluster = createTextCompositionEngine(headingClusterTemplate, { headingKeepWithNextLines: 3, maxPlanningIterations: 2 }).plan(headingClusterDocument, metrics);
  assert.equal(headingCluster.evaluation.status, 'accepted', JSON.stringify(headingCluster.evaluation));
  const clusterObstacle = headingCluster.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'insertion:cluster-quote');
  const clusterHeadingLines = headingCluster.plan.lines.filter((line) => line.blockId === 'cluster-heading');
  const clusterBodyLines = headingCluster.plan.lines.filter((line) => line.blockId === 'cluster-body');
  assert.ok(clusterObstacle && clusterHeadingLines.length > 0 && clusterBodyLines.length >= 3, 'heading cluster fixture must place its obstacle, heading, and lead text');
  const clusterLines = [...clusterHeadingLines, ...clusterBodyLines.slice(0, 3)].sort((left, right) => left.box.y - right.box.y);
  assert.ok(clusterLines.every((line) => line.box.y >= clusterObstacle.box.y + clusterObstacle.box.height), 'heading plus three lead lines must not be split by an insertion obstacle');
  assert.ok(clusterLines.every((line, index) => index === 0 || Math.abs(line.box.y - clusterLines[index - 1].box.y - line.box.height) < 0.001), 'heading plus three lead lines must occupy one continuous text band');

  const earlyColumnAdvance = structuredClone(result.plan);
  const continuedLines = earlyColumnAdvance.lines.filter((line) => line.blockId === 'body' && line.page === 2);
  assert.ok(continuedLines.length >= 2, 'flow fixture must continue one block across route segments');
  const firstContinued = continuedLines.findLast((line) => line.routeIndex === continuedLines[0].routeIndex);
  const firstContinuedSlot = earlyColumnAdvance.slots.find((slot) => slot.id === firstContinued.slotId);
  assert.ok(firstContinuedSlot, 'continued flow fixture must expose its first slot');
  firstContinued.box.height = Math.max(1, firstContinued.box.height - 21);
  const earlyColumnEvaluation = evaluateCompositionPlan(document, earlyColumnAdvance);
  assert.equal(earlyColumnEvaluation.status, 'rejected');
  assert.ok(earlyColumnEvaluation.diagnostics.some((item) => item.code === 'FLOW_COLUMN_ADVANCE_EARLY'), 'a continued block must exhaust the current column before entering the next one');

  const quoteMetrics = {
    ...metrics,
    textIndent(style) { return style === 'quote' ? 8 : 0; },
    textTrailingReserve(style) { return style === 'quote' ? 5 : 0; },
  };
  const quoteWrapTemplate = {
    maxPages: 1,
    layouts: [{ id: 'quote-wrap', width: 100, height: 100, slots: [{ id: 'quote', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 20 }, allowedRoles: ['quote'] }] }],
    routes: { main: { slots: ['quote'], layouts: ['quote-wrap'], continuation: 'forbidden' } },
  };
  const quoteWrap = createTextCompositionEngine(quoteWrapTemplate).plan({ flows: { main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'quote-wrap-block', kind: 'paragraph', role: 'quote', text: 'The closing mark must have room inside the quote line.' }] } } }, quoteMetrics);
  assert.equal(quoteWrap.evaluation.status, 'accepted', JSON.stringify(quoteWrap.evaluation));
  const quoteWrapLine = quoteWrap.plan.lines.at(-1);
  assert.ok(quoteWrapLine && quoteWrapLine.naturalWidth + 5 <= quoteWrapLine.box.width, 'quote wrapping must reserve room for the closing glyph');

  const incompletePlan = structuredClone(result.plan);
  incompletePlan.lines.pop();
  const incompleteEvaluation = evaluateCompositionPlan(document, incompletePlan);
  assert.equal(incompleteEvaluation.status, 'rejected');
  assert.ok(incompleteEvaluation.diagnostics.some((item) => item.code === 'CONTENT_NOT_FULLY_PLACED' || item.code === 'CONTENT_COVERAGE_GAP'));
  const warned = createTextCompositionEngine(template).plan({ ...document, diagnostics: ['Input contained a recoverable normalization warning.'] }, metrics);
  assert.equal(warned.evaluation.status, 'accepted-with-warnings');

  const graphicTemplate = structuredClone(template);
  graphicTemplate.layouts[0].slots.push({ id: 'hero-graphic', regionId: 'main', kind: 'graphic', box: { x: 20, y: 15, width: 18, height: 10 } });
  const glyphDocument = {
    ...document,
    glyphs: [
      { id: 'heading-decoration', target: { kind: 'block', id: 'heading' }, text: '◆', styleName: 'heading', anchor: 'text-start', anchorAlignment: 'end', targetMode: 'first-line', offsetX: 2 },
      { id: 'graphic-decoration', target: { kind: 'graphic', id: 'hero-oval' }, text: '✦', styleName: 'body', anchor: 'box', targetMode: 'box', offsetX: 2, offsetY: 1, clampToTarget: true, opacity: 0.35 },
    ],
  };
  const graphicResult = createTextCompositionEngine(graphicTemplate).plan({ ...glyphDocument, graphics: [{ id: 'hero-oval', slotId: 'hero-graphic', shape: 'ellipse', wrap: 'around', page: 1 }] }, metrics);
  assert.equal(graphicResult.evaluation.status, 'accepted', JSON.stringify(graphicResult.evaluation));
  assert.equal(graphicResult.plan.graphicPlacements.length, 1);
  assert.equal(graphicResult.plan.glyphPlacements.length, 2, 'authored glyphs must resolve against both block and graphic targets');
  assert.ok(graphicResult.plan.glyphPlacements.some((glyph) => glyph.source === 'authored' && glyph.targetType === 'block' && glyph.targetId === 'heading' && glyph.anchor === 'text-start'), 'a glyph may attach to the first line of a text block');
  const headingGlyph = graphicResult.plan.glyphPlacements.find((glyph) => glyph.glyphId === 'heading-decoration');
  const headingLine = graphicResult.plan.lines.find((line) => line.blockId === 'heading');
  assert.ok(headingGlyph && headingLine && Math.abs(headingGlyph.box.x + headingGlyph.box.width + 2 - headingLine.box.x) < 0.001, 'an end-aligned glyph must sit before the text-start anchor with its configured gap');
  const graphicGlyph = graphicResult.plan.glyphPlacements.find((glyph) => glyph.targetType === 'graphic');
  assert.ok(graphicGlyph && graphicGlyph.box.x >= 20 && graphicGlyph.box.y >= 16 && graphicGlyph.opacity === 0.35, 'a glyph may attach to a graphic box with offsets and opacity');
  assert.equal(graphicResult.evaluation.diagnostics.some((item) => item.code === 'LINE_GRAPHIC_OVERLAP'), false);
  const linesBesideGraphic = graphicResult.plan.lines.filter((line) => line.page === 1 && line.box.y < 25 && line.box.y + line.box.height > 15);
  assert.ok(linesBesideGraphic.some((line) => line.box.x + line.box.width <= 20 || line.box.x >= 38), 'text beside the graphic must use a non-overlapping interval');
  for (const shape of ['rectangle', 'triangle', 'star', 'polygon']) {
    const shapeTemplate = structuredClone(template);
    shapeTemplate.layouts[0].slots.push({ id: 'shape', regionId: 'main', kind: 'graphic', box: { x: 20, y: 15, width: 18, height: 10 } });
    const graphic = shape === 'star'
      ? { id: shape, slotId: 'shape', shape, vertexCount: 5, innerRatio: 0.45, page: 1 }
      : shape === 'polygon'
        ? { id: shape, slotId: 'shape', shape, points: [{ x: 0, y: 0 }, { x: 1, y: 0.2 }, { x: 0.75, y: 1 }, { x: 0, y: 0.8 }], page: 1 }
        : { id: shape, slotId: 'shape', shape, page: 1 };
    const shapeResult = createTextCompositionEngine(shapeTemplate).plan({ ...document, graphics: [graphic] }, metrics);
    assert.equal(shapeResult.evaluation.status, 'accepted', `${shape} should be accepted: ${JSON.stringify(shapeResult.evaluation)}`);
    assert.equal(shapeResult.plan.graphicPlacements.length, 1);
    assert.equal(shapeResult.evaluation.diagnostics.some((item) => item.code === 'LINE_GRAPHIC_OVERLAP'), false);
  }

  const assetGraphicDocument = {
    ...document,
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: true }],
    graphics: [{ id: 'photo-placement', assetId: 'photo-1', slotId: 'hero-graphic', shape: 'rectangle', page: 1 }],
  };
  const assetGraphicResult = createTextCompositionEngine(graphicTemplate).plan(assetGraphicDocument, metrics);
  assert.equal(assetGraphicResult.evaluation.status, 'accepted', JSON.stringify(assetGraphicResult.evaluation));
  assert.equal(assetGraphicResult.plan.graphicPlacements[0].assetId, 'photo-1');
  const missingAssetResult = createTextCompositionEngine(graphicTemplate).plan({ ...document, graphics: [{ id: 'missing-photo', assetId: 'not-in-document', slotId: 'hero-graphic', shape: 'rectangle', page: 1 }] }, metrics);
  assert.equal(missingAssetResult.evaluation.status, 'rejected');
  assert.ok(missingAssetResult.evaluation.diagnostics.some((item) => item.code === 'GRAPHIC_ASSET_NOT_FOUND'));
  const inlineAssetResult = createTextCompositionEngine(graphicTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'inline-image', kind: 'paragraph', role: 'body', text: 'Text beside an inline image', assetIds: ['photo-1'] }] } },
    assets: assetGraphicDocument.assets,
  }, metrics);
  assert.equal(inlineAssetResult.evaluation.status, 'rejected');
  assert.ok(inlineAssetResult.evaluation.diagnostics.some((item) => item.code === 'UNSUPPORTED_INLINE_ASSET'));

  const imageFlowTemplate = {
    maxPages: 1,
    layouts: [{ id: 'image-flow', width: 100, height: 100, slots: [
      { id: 'main-a', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 80 } },
      { id: 'main-b', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 80 } },
    ] }],
    routes: { main: { slots: ['main-a', 'main-b'], layouts: ['image-flow'], continuation: 'forbidden' } },
  };
  const imageDocument = {
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'before-image', kind: 'paragraph', role: 'body', text: 'Text before the image.' },
      { id: 'image', kind: 'image', role: 'body', atomic: true, image: { assetId: 'photo-1', width: 'full', fit: 'contain', keepWithCaption: false } },
      { id: 'after-image', kind: 'paragraph', role: 'body', text: 'Text after the image stays in the flow.' },
    ] } },
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  };
  const imageMetrics = { ...metrics, measureBlock() { return { height: 20 }; } };
  const imageResult = createTextCompositionEngine(imageFlowTemplate).plan(imageDocument, imageMetrics);
  assert.equal(imageResult.evaluation.status, 'accepted', JSON.stringify(imageResult.evaluation));
  assert.equal(imageResult.plan.blockPlacements[0].kind, 'image');
  const imagePlacement = imageResult.plan.blockPlacements[0];
  const afterImageLine = imageResult.plan.lines.find((line) => line.blockId === 'after-image');
  assert.equal(afterImageLine?.slotId, imagePlacement.slotId);
  assert.ok(afterImageLine && afterImageLine.box.y >= imagePlacement.box.y + imagePlacement.box.height);
  const missingImage = createTextCompositionEngine(imageFlowTemplate).plan({
    ...imageDocument,
    assets: [],
  }, imageMetrics);
  assert.equal(missingImage.evaluation.status, 'rejected');
  assert.ok(missingImage.evaluation.diagnostics.some((item) => item.code === 'IMAGE_ASSET_NOT_FOUND'));

  const imageContinuationTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'image-opening', width: 100, height: 100, slots: [
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 30 } },
      ] },
      { id: 'image-continuation', width: 100, height: 100, slots: [
        { id: 'image', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 25 } },
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 50, y: 5, width: 45, height: 80 } },
      ] },
    ],
    routes: {
      main: {
        slots: ['body'],
        slotsByLayout: { 'image-continuation': ['image', 'body'] },
        layouts: ['image-opening', 'image-continuation'],
        continuation: 'allowed',
      },
    },
  };
  const imageContinuation = createTextCompositionEngine(imageContinuationTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'before', kind: 'paragraph', role: 'body', text: 'The first-page paragraph deliberately occupies two measured lines.' },
      { id: 'image', kind: 'image', role: 'body', atomic: true, image: { assetId: 'photo-1', width: 'full', fit: 'contain', keepWithCaption: false } },
      { id: 'after', kind: 'paragraph', role: 'body', text: 'The continuation paragraph follows the whole image without splitting it.' },
    ] } },
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  }, { ...imageMetrics, measureBlock() { return { height: 20 }; } });
  assert.equal(imageContinuation.evaluation.status, 'accepted', JSON.stringify(imageContinuation.evaluation));
  assert.equal(imageContinuation.plan.pages.length, 2);
  assert.deepEqual(imageContinuation.plan.blockPlacements.map((placement) => [placement.blockId, placement.page, placement.slotId]), [['image', 2, '2:image']]);
  assert.ok(imageContinuation.plan.lines.some((line) => line.blockId === 'before' && line.page === 1));
  assert.ok(imageContinuation.plan.lines.some((line) => line.blockId === 'after' && line.page === 2 && line.slotId === '2:body'));
  assert.equal(imageContinuation.plan.residualContent.length, 0);

  const imageSameSlotTemplate = {
    maxPages: 1,
    layouts: [{ id: 'image-same-slot', width: 100, height: 100, slots: [
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 70 } },
    ] }],
    routes: { main: { slots: ['body'], layouts: ['image-same-slot'], continuation: 'forbidden' } },
  };
  const imageSameSlot = createTextCompositionEngine(imageSameSlotTemplate).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'before', kind: 'paragraph', role: 'body', text: 'Text before the small image.' },
      { id: 'image', kind: 'image', role: 'body', atomic: true, image: { assetId: 'photo-1', width: 'full', fit: 'contain', keepWithCaption: false } },
      { id: 'after', kind: 'paragraph', role: 'body', text: 'Text after the small image uses the remaining space.' },
    ] } },
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  }, { ...imageMetrics, measureBlock() { return { height: 20 }; } });
  assert.equal(imageSameSlot.evaluation.status, 'accepted', JSON.stringify(imageSameSlot.evaluation));
  const sameSlotImage = imageSameSlot.plan.blockPlacements[0];
  const sameSlotAfter = imageSameSlot.plan.lines.find((line) => line.blockId === 'after');
  assert.equal(sameSlotImage.slotId, '1:body');
  assert.equal(sameSlotAfter?.slotId, '1:body');
  assert.ok(sameSlotAfter && sameSlotAfter.box.y >= sameSlotImage.box.y + sameSlotImage.box.height);

  const growableAtomicTemplate = {
    maxPages: 1,
    layouts: [{ id: 'growable-atomic', width: 210, height: 297, slots: [
      { id: 'intro', regionId: 'intro', kind: 'text', box: { x: 17.01, y: 56.43, width: 175.98, height: 14.85 }, allowedRoles: ['intro'], allowedBlockKinds: ['image', 'paragraph'], grow: { axis: 'y', maxHeight: 220 } },
    ] }],
    routes: { intro: { slots: ['intro'], layouts: ['growable-atomic'], continuation: 'forbidden' } },
  };
  const growableAtomic = createTextCompositionEngine(growableAtomicTemplate, { geometryTolerance: 0.01 }).plan({
    flows: { intro: { id: 'intro', continuation: 'forbidden', blocks: [
      { id: 'hero', kind: 'image', role: 'intro', atomic: true, image: { assetId: 'photo-1', width: 'full', fit: 'contain', keepWithCaption: false } },
      { id: 'lead', kind: 'paragraph', role: 'intro', text: 'The lead must remain in the same growable intro flow after the image.' },
    ] } },
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  }, { ...imageMetrics, measureBlock() { return { height: 125.8943897216274, image: { width: 175.98, height: 125.8943897216274, captionHeight: 0, scale: 1 } }; } });
  assert.equal(growableAtomic.evaluation.status, 'accepted', JSON.stringify(growableAtomic.evaluation));
  assert.equal(growableAtomic.plan.blockPlacements[0].slotId, '1:intro');
  assert.ok(growableAtomic.plan.lines.some((line) => line.blockId === 'lead' && line.slotId === '1:intro'), 'content after a growable image must remain in the intro flow');

  const wrappedImageResult = createTextCompositionEngine(imageSameSlotTemplate).plan({
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'before', kind: 'paragraph', role: 'body', text: 'Text before the wrapped image.' },
      { id: 'image', kind: 'image', role: 'body', atomic: true, image: { assetId: 'photo-1', width: '40%', fit: 'contain', wrap: 'right', keepWithCaption: false } },
      { id: 'after', kind: 'paragraph', role: 'body', text: 'This paragraph must use the free interval to the left of the wrapped image before returning to the full slot below it.' },
    ] } },
    assets: [{ id: 'photo-1', source: 'assets/photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  }, { ...imageMetrics, measureBlock() { return { height: 20, image: { width: 36, height: 20, captionHeight: 0, scale: 1 } }; } });
  assert.equal(wrappedImageResult.evaluation.status, 'accepted', JSON.stringify(wrappedImageResult.evaluation));
  const wrappedBoundary = wrappedImageResult.plan.graphicPlacements.find((graphic) => graphic.graphicId === 'image:boundary');
  assert.ok(wrappedBoundary && wrappedBoundary.paint === false, 'wrapped images need a planner-only exclusion boundary');
  const wrappedAfterLine = wrappedImageResult.plan.lines.find((line) => line.blockId === 'after');
  assert.ok(wrappedAfterLine && wrappedBoundary && wrappedAfterLine.box.x + wrappedAfterLine.box.width <= wrappedBoundary.box.x, 'text beside a right-wrapped image must stay in the left interval');

  const largeGraphicTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'first', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 80 } }, { id: 'large', regionId: 'main', kind: 'graphic', box: { x: 5, y: 5, width: 90, height: 80 } }] },
      { id: 'continuation', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 80 } }] },
    ],
    routes: { main: { slots: ['body'], layouts: ['first', 'continuation'], continuation: 'allowed' } },
  };
  const largeGraphicResult = createTextCompositionEngine(largeGraphicTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Text starts below a full-page graphic.' }] } },
    graphics: [{ id: 'large-rectangle', slotId: 'large', shape: 'rectangle', page: 1 }],
  }, metrics);
  assert.equal(largeGraphicResult.evaluation.status, 'accepted', JSON.stringify(largeGraphicResult.evaluation));
  assert.equal(largeGraphicResult.plan.graphicPlacements.length, 1);
  assert.ok(largeGraphicResult.plan.lines.every((line) => line.page === 2), 'text must move below a graphic that covers the entire first slot');

  const lateGraphicTemplate = structuredClone(template);
  lateGraphicTemplate.layouts[1].slots.push({ id: 'late-graphic', regionId: 'main', kind: 'graphic', box: { x: 70, y: 70, width: 20, height: 20 } });
  const lateGraphicResult = createTextCompositionEngine(lateGraphicTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'short', kind: 'paragraph', role: 'body', text: 'The text fits on page one.' }] } },
    graphics: [{ id: 'page-two-star', slotId: 'late-graphic', shape: 'star', vertexCount: 5, innerRatio: 0.45, page: 2 }],
  }, metrics);
  assert.equal(lateGraphicResult.evaluation.status, 'accepted', JSON.stringify(lateGraphicResult.evaluation));
  assert.equal(lateGraphicResult.plan.pages.length, 2, 'an explicit page-two graphic must materialize its page');
  assert.equal(lateGraphicResult.plan.graphicPlacements[0].slotId, '2:late-graphic');
  const invalidGraphicResult = createTextCompositionEngine(lateGraphicTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [] } },
    graphics: [{ id: 'invalid-star', slotId: 'late-graphic', shape: 'star', page: 2 }],
  }, metrics);
  assert.equal(invalidGraphicResult.evaluation.status, 'rejected');
  assert.ok(invalidGraphicResult.evaluation.diagnostics.some((item) => item.code === 'GRAPHIC_SHAPE_PARAMETER_INVALID'));
  const artifact = renderComposition(document, result, { render: (_document, plan) => ({ pages: plan.pages.length, lines: plan.lines.length }) });
  assert.deepEqual(artifact, { pages: 2, lines: result.plan.lines.length });

  const unsupported = createTextCompositionEngine(template, {}).plan({
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [{ id: 'chart', kind: 'chart', role: 'chart', chart: { type: 'bar', data: [{ label: 'A', value: 1 }] } }],
      },
    },
  }, metrics);
  assert.equal(unsupported.evaluation.status, 'rejected');
  assert.ok(unsupported.evaluation.diagnostics.some((item) => item.code === 'BLOCK_MEASUREMENT_UNAVAILABLE'));

  const atomicTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'atomic-opening', width: 100, height: 100, slots: [
        { id: 'metric', regionId: 'metrics', kind: 'block', allowedBlockKinds: ['metric'], box: { x: 5, y: 5, width: 40, height: 20 } },
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 30, width: 90, height: 60 } },
      ] },
      { id: 'atomic-continuation', width: 100, height: 100, slots: [
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 85 } },
      ] },
    ],
    routes: { main: { slots: ['metric', 'body'], slotsByLayout: { 'atomic-continuation': ['body'] }, layouts: ['atomic-opening', 'atomic-continuation'], continuation: 'allowed' } },
  };
  const atomicDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'metric-1', kind: 'metric', role: 'metric', atomic: true, metric: { label: 'Reach', value: 1200, delta: '+12%', trend: 'up' } },
      { id: 'atomic-body', kind: 'paragraph', role: 'body', text: 'Body text follows the atomic metric block and must never be drawn inside it.' },
    ] } },
  };
  const atomicMetrics = {
    ...metrics,
    measureBlock(block, box) {
      assert.equal(block.kind, 'metric');
      assert.equal(box.width, 40);
      return { height: 18 };
    },
  };
  const atomicResult = createTextCompositionEngine(atomicTemplate).plan(atomicDocument, atomicMetrics);
  assert.equal(atomicResult.evaluation.status, 'accepted', JSON.stringify(atomicResult.evaluation));
  assert.deepEqual(atomicResult.plan.blockPlacements.map((placement) => [placement.blockId, placement.slotId, placement.box.height]), [['metric-1', '1:metric', 18]]);
  assert.ok(atomicResult.plan.lines.every((line) => line.blockId !== 'metric-1'));
  assert.ok(atomicResult.plan.lines.some((line) => line.blockId === 'atomic-body' && line.slotId === '1:body'));
  assert.ok(atomicResult.plan.decisions.some((decision) => decision.code === 'ATOMIC_BLOCK_PLACED'));
  const incompleteAtomicPlan = structuredClone(atomicResult.plan);
  incompleteAtomicPlan.blockPlacements = [];
  const incompleteAtomicEvaluation = evaluateCompositionPlan(atomicDocument, incompleteAtomicPlan);
  assert.equal(incompleteAtomicEvaluation.status, 'rejected');
  assert.ok(incompleteAtomicEvaluation.diagnostics.some((item) => item.code === 'ATOMIC_BLOCK_NOT_FULLY_PLACED'));

  const noAtomicMeasurement = createTextCompositionEngine(atomicTemplate).plan(atomicDocument, metrics);
  assert.equal(noAtomicMeasurement.evaluation.status, 'rejected');
  assert.ok(noAtomicMeasurement.evaluation.diagnostics.some((item) => item.code === 'BLOCK_MEASUREMENT_UNAVAILABLE'));

  const tooTallAtomic = createTextCompositionEngine({
    ...atomicTemplate,
    layouts: atomicTemplate.layouts.map((layout) => layout.id === 'atomic-opening'
      ? { ...layout, slots: layout.slots.map((slot) => slot.id === 'metric' ? { ...slot, box: { ...slot.box, height: 10 } } : slot) }
      : layout),
  }).plan(atomicDocument, atomicMetrics);
  assert.equal(tooTallAtomic.evaluation.status, 'rejected');
  assert.equal(tooTallAtomic.plan.blockPlacements.length, 0);
  assert.ok(tooTallAtomic.plan.decisions.some((decision) => decision.code === 'BLOCK_PUSHED_TO_NEXT_SLOT' && decision.reason === 'atomic-block-does-not-fit'));

  const atomicBackendCalls = [];
  const atomicArtifact = renderComposition(atomicDocument, atomicResult, {
    render(_document, plan) {
      for (const placement of plan.blockPlacements) atomicBackendCalls.push(placement);
      return { blockPlacements: plan.blockPlacements.length };
    },
  });
  assert.deepEqual(atomicArtifact, { blockPlacements: 1 });
  assert.equal(atomicBackendCalls[0].kind, 'metric');

  const tableTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'table-opening', width: 100, height: 100, slots: [
        { id: 'table-opening', regionId: 'table', kind: 'block', allowedBlockKinds: ['table'], box: { x: 5, y: 5, width: 90, height: 24 } },
      ] },
      { id: 'table-continuation', width: 100, height: 100, slots: [
        { id: 'table-continuation', regionId: 'table', kind: 'block', allowedBlockKinds: ['table'], box: { x: 5, y: 5, width: 90, height: 30 } },
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 40, width: 90, height: 50 } },
      ] },
    ],
    routes: { main: { slots: ['table-opening'], slotsByLayout: { 'table-continuation': ['table-continuation', 'body'] }, layouts: ['table-opening', 'table-continuation'], continuation: 'allowed' } },
  };
  const tableDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'table-1', kind: 'table', role: 'table', table: { head: ['Channel', 'Reach'], body: [['Search', 12], ['Social', 8], ['Email', 5], ['Direct', 3]], caption: 'Reach by channel' } },
      { id: 'table-body', kind: 'paragraph', role: 'body', text: 'Narrative follows the final table fragment.' },
    ] } },
  };
  const tableMetrics = {
    ...metrics,
    measureTable(block, box, startRow) {
      assert.equal(block.kind, 'table');
      assert.equal(box.width, 90);
      return startRow === 0 ? { height: 20, endRow: 2 } : { height: 24, endRow: 4 };
    },
  };
  const tableResult = createTextCompositionEngine(tableTemplate).plan(tableDocument, tableMetrics);
  assert.equal(tableResult.evaluation.status, 'accepted', JSON.stringify(tableResult.evaluation));
  assert.deepEqual(tableResult.plan.tablePlacements.map((placement) => [placement.page, placement.startRow, placement.endRow, placement.repeatsHeader]), [[1, 0, 2, false], [2, 2, 4, true]]);
  assert.ok(tableResult.plan.lines.some((line) => line.blockId === 'table-body' && line.page === 2 && line.slotId === '2:body'));

  const samePageTableTemplate = {
    maxPages: 2,
    layouts: [1, 2].map((page) => ({ id: `same-page-table-${page}`, width: 100, height: 100, slots: [
      { id: 'table-opening', regionId: 'table', kind: 'block', allowedBlockKinds: ['table'], box: { x: 5, y: 5, width: 90, height: 24 } },
      { id: 'table-content', regionId: 'table', kind: 'text', allowedBlockKinds: ['table'], box: { x: 5, y: 35, width: 90, height: 50 } },
    ] })),
    routes: { main: { slots: ['table-opening', 'table-content'], slotsByLayout: { 'same-page-table-2': ['table-opening', 'table-content'] }, layouts: ['same-page-table-1', 'same-page-table-2'], continuation: 'allowed' } },
  };
  const samePageTableDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'same-page-table', kind: 'table', role: 'table', table: { head: ['Signal', 'Movement'], body: [['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5], ['F', 6], ['G', 7], ['H', 8], ['I', 9], ['J', 10]], caption: 'Signals' } },
    ] } },
  };
  const samePageTableCalls = [];
  const samePageTableMetrics = {
    ...metrics,
    measureTable(_block, box, startRow, options) {
      samePageTableCalls.push({ boxY: box.y, startRow, repeatHeader: options.repeatHeader });
      return { height: startRow === 6 ? 30 : 20, endRow: Math.min(startRow + 2, 10) };
    },
  };
  const samePageTableResult = createTextCompositionEngine(samePageTableTemplate).plan(samePageTableDocument, samePageTableMetrics);
  assert.equal(samePageTableResult.evaluation.status, 'accepted', JSON.stringify(samePageTableResult.evaluation));
  assert.deepEqual(samePageTableResult.plan.tablePlacements.map((placement) => [placement.page, placement.startRow, placement.endRow, placement.repeatsHeader]), [[1, 0, 2, false], [1, 2, 4, false], [1, 4, 6, false], [2, 6, 8, true], [2, 8, 10, false]]);
  assert.deepEqual(samePageTableCalls.map((call) => call.repeatHeader), [false, false, false, false, true, true, false]);

  const incompleteTablePlan = structuredClone(tableResult.plan);
  incompleteTablePlan.tablePlacements.pop();
  const incompleteTableEvaluation = evaluateCompositionPlan(tableDocument, incompleteTablePlan);
  assert.equal(incompleteTableEvaluation.status, 'rejected');
  assert.ok(incompleteTableEvaluation.diagnostics.some((item) => item.code === 'TABLE_NOT_FULLY_PLACED' || item.code === 'TABLE_ROW_COVERAGE_GAP'));
  const oversizedTable = createTextCompositionEngine({
    ...tableTemplate,
    layouts: tableTemplate.layouts.map((layout) => ({ ...layout, slots: layout.slots.map((slot) => slot.id.startsWith('table') ? { ...slot, box: { ...slot.box, height: 10 } } : slot) })),
  }).plan(tableDocument, {
    ...tableMetrics,
    measureTable() { return { height: 40, endRow: 1 }; },
  });
  assert.equal(oversizedTable.evaluation.status, 'rejected');
  assert.ok(oversizedTable.evaluation.diagnostics.some((item) => item.code === 'MAX_PAGES_EXCEEDED' || item.code === 'TABLE_NOT_FULLY_PLACED'));
  assert.deepEqual(oversizedTable.plan.residualContent[0]?.remainingRows, { start: 0, end: 4 });

  const kpiSlots = ['metric-1', 'metric-2', 'metric-3'];
  const kpiLayout = (id) => ({
    id,
    width: 100,
    height: 100,
    slots: kpiSlots.map((slotId, index) => ({ id: slotId, regionId: 'metrics', kind: 'block', allowedBlockKinds: ['metric'], box: { x: 5 + index * 30, y: 5, width: 25, height: 20 } })),
  });
  const kpiTemplate = {
    maxPages: 2,
    layouts: [kpiLayout('kpi-opening'), kpiLayout('kpi-continuation')],
    routes: { main: { slots: kpiSlots, slotsByLayout: { 'kpi-continuation': kpiSlots }, layouts: ['kpi-opening', 'kpi-continuation'], continuation: 'allowed' } },
  };
  const metricDocument = (count) => ({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: Array.from({ length: count }, (_, index) => ({ id: `metric-${index + 1}`, kind: 'metric', role: 'metric', atomic: true, metric: { label: `Metric ${index + 1}`, value: index + 1 } })) } },
  });
  for (const count of [0, 1, 2, 3]) {
    const result = createTextCompositionEngine(kpiTemplate).plan(metricDocument(count), { ...metrics, measureBlock() { return { height: 18 }; } });
    assert.equal(result.evaluation.status, 'accepted', `metric count ${count}: ${JSON.stringify(result.evaluation)}`);
    assert.equal(result.plan.blockPlacements.length, count);
    assert.ok(result.plan.blockPlacements.every((placement) => placement.page === 1));
  }
  const fourMetrics = createTextCompositionEngine(kpiTemplate).plan(metricDocument(4), { ...metrics, measureBlock() { return { height: 18 }; } });
  assert.equal(fourMetrics.evaluation.status, 'accepted', JSON.stringify(fourMetrics.evaluation));
  assert.deepEqual(fourMetrics.plan.blockPlacements.map((placement) => placement.page), [1, 1, 1, 2]);
  const sevenMetrics = createTextCompositionEngine(kpiTemplate).plan(metricDocument(7), { ...metrics, measureBlock() { return { height: 18 }; } });
  assert.equal(sevenMetrics.evaluation.status, 'rejected');
  assert.ok(sevenMetrics.evaluation.diagnostics.some((item) => item.code === 'MAX_PAGES_EXCEEDED' || item.code === 'ATOMIC_BLOCK_NOT_FULLY_PLACED'));

  const introOnlyTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'intro-only', width: 100, height: 100, slots: [{ id: 'intro', regionId: 'intro', kind: 'text', box: { x: 5, y: 5, width: 90, height: 10 }, allowedRoles: ['intro'] }] },
      { id: 'body-only', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 80 } }] },
    ],
    routes: { main: { slots: ['intro'], slotsByLayout: { 'body-only': ['body'] }, layouts: ['intro-only', 'body-only'], continuation: 'allowed' } },
  };
  const pushed = createTextCompositionEngine(introOnlyTemplate, {}).plan({
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [
          { id: 'intro', kind: 'paragraph', role: 'intro', text: 'intro' },
          { id: 'body', kind: 'paragraph', role: 'body', text: 'body content starts only after the intro box has ended' },
        ],
      },
    },
  }, metrics);
  assert.equal(pushed.evaluation.status, 'accepted');
  assert.ok(pushed.plan.decisions.some((decision) => decision.code === 'BLOCK_PUSHED_TO_NEXT_PAGE' && decision.blockId === 'body'));
  assert.ok(pushed.plan.lines.some((line) => line.blockId === 'body' && line.page === 2 && line.slotId === '2:body'));

  const growingBoxTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'opening', width: 100, height: 100, slots: [
        { id: 'intro', regionId: 'intro', kind: 'text', box: { x: 5, y: 5, width: 20, height: 10 }, allowedRoles: ['intro'], grow: { axis: 'y', maxHeight: 50, pushes: ['main-a', 'main-b'] } },
        { id: 'main-a', regionId: 'main', kind: 'text', box: { x: 5, y: 15, width: 40, height: 70 } },
        { id: 'main-b', regionId: 'main', kind: 'text', box: { x: 55, y: 15, width: 40, height: 70 } },
      ] },
      { id: 'continuation', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 80 } }] },
    ],
    routes: { main: { slots: ['intro', 'main-a', 'main-b'], slotsByLayout: { continuation: ['body'] }, layouts: ['opening', 'continuation'], continuation: 'allowed' } },
  };
  const growingBox = createTextCompositionEngine(growingBoxTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'intro', kind: 'paragraph', role: 'intro', text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega' },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'The following body must use the space left after the ordinary intro box grows.' },
    ] } },
  }, metrics);
  assert.equal(growingBox.evaluation.status, 'accepted', JSON.stringify(growingBox.evaluation));
  const grownIntro = growingBox.plan.slots.find((slot) => slot.id === '1:intro');
  const shiftedColumn = growingBox.plan.slots.find((slot) => slot.id === '1:main-a');
  assert.ok(grownIntro && grownIntro.box.height > 10, 'an ordinary growing box should expand to fit its content');
  assert.ok(shiftedColumn && shiftedColumn.box.y > 15 && shiftedColumn.box.height < 70, 'pushed slots should move down and lose the consumed height');
  assert.ok(growingBox.plan.decisions.some((decision) => decision.code === 'SLOT_GROWN'));

  const exhaustedColumnsTemplate = structuredClone(growingBoxTemplate);
  exhaustedColumnsTemplate.layouts[0].slots[0].grow.maxHeight = 80;
  const exhaustedColumns = createTextCompositionEngine(exhaustedColumnsTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'intro', kind: 'paragraph', role: 'intro', text: Array.from({ length: 90 }, (_, index) => `intro${index}`).join(' ') },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'Body must continue on the next page when the lead box consumes every opening column.' },
    ] } },
  }, metrics);
  assert.equal(exhaustedColumns.evaluation.status, 'accepted', JSON.stringify(exhaustedColumns.evaluation));
  assert.ok(exhaustedColumns.plan.lines.some((line) => line.blockId === 'body' && line.page === 2 && line.slotId === '2:body'));
  assert.equal(exhaustedColumns.plan.slots.find((slot) => slot.id === '1:main-a')?.box.height, 0);

  const invalidGrowthTemplate = structuredClone(growingBoxTemplate);
  invalidGrowthTemplate.layouts[0].slots[0].grow.pushes = ['not-a-slot'];
  const invalidGrowth = createTextCompositionEngine(invalidGrowthTemplate).plan({
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'intro', kind: 'paragraph', role: 'intro', text: 'intro content' }] } },
  }, metrics);
  assert.equal(invalidGrowth.evaluation.status, 'rejected');
  assert.ok(invalidGrowth.evaluation.diagnostics.some((item) => item.code === 'GROW_TARGET_NOT_FOUND'));

  const forbidden = createTextCompositionEngine(template, {}).plan({
    flows: { sidebar: { id: 'sidebar', continuation: 'forbidden', blocks: [{ id: 'too-long', kind: 'paragraph', role: 'sidebar', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty' }] } },
  }, metrics);
  assert.equal(forbidden.evaluation.status, 'rejected');
  assert.ok(forbidden.evaluation.diagnostics.some((item) => item.code === 'RESIDUAL_CONTENT'));
  assert.ok(forbidden.plan.residualContent[0].remaining);
  assert.throws(() => renderComposition(document, forbidden, { render: () => 'must not render' }), /rejected/u);
  console.log(JSON.stringify({
    status: 'passed',
    pages: result.plan.pages.length,
    lines: result.plan.lines.length,
    slots: result.plan.slots.length,
    continuousObstaclePages: continuousObstacle.plan.pages.length,
    continuousObstacleWords: continuousObstacleWords.length,
    continuousObstaclePlacements: continuousObstacle.plan.graphicPlacements.length,
    numberedObstaclePages: numberedObstacle.plan.pages.length,
    numberedObstacleWords: numberedObstacleWords.length,
    numberedObstaclePixelZones: pixelChecks.length,
    numberedObstacleArtifact: process.env.REPORT_BABY_ARTIFACT_DIR ? join(process.env.REPORT_BABY_ARTIFACT_DIR, 'numbered-obstacle-pixel-qa.pdf') : undefined,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
