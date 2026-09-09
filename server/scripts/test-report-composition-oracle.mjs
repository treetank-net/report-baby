#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { parse } from 'yaml';
import { runProcess } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';
import { extractPdfText, extractPdfWords } from './lib/pdf-text.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-oracle-'));
const reportBundle = join(temporary, 'report-renderer.cjs');
const adapterBundle = join(temporary, 'report-composition-entrypoint.cjs');
const backendBundle = join(temporary, 'composition.cjs');
const primitivesBundle = join(temporary, 'render-primitives.cjs');
const templateBundle = join(temporary, 'template.cjs');
const geometryBundle = join(temporary, 'geometry.cjs');
const parityConfig = parse(await readFile(join(root, 'templates/composition-pixel-qa-prototype.yml'), 'utf8'));

/**
 * @test-decision merge-shared-bundle
 * @test-action Merge into one shared test-bundle helper so each check does not invoke esbuild independently.
 */
function build(entry, output, extra = []) {
  const result = runProcess('npx', [
    'esbuild',
    entry,
    '--bundle',
    '--platform=node',
    '--target=node18',
    '--format=cjs',
    ...extra,
    `--outfile=${output}`,
  ], { cwd: root, timeout: 30_000 });
  if (result.status !== 0) throw new Error(`oracle comparison bundle '${entry}' failed: ${result.stderr || result.stdout}`);
}

build('src/report/renderer.ts', reportBundle, ['--loader:.wasm=binary', '--loader:.ttf=binary']);
build('src/composition/report-composition-entrypoint.ts', adapterBundle);
build('src/composition/index.ts', backendBundle);
build('src/rendering/primitives.ts', primitivesBundle, ['--loader:.wasm=binary', '--loader:.ttf=binary']);
build('src/template/contracts.ts', templateBundle);
build('src/template/geometry.ts', geometryBundle);

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function normalizeToken(token) {
  return token.toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function tokenCounts(text) {
  const counts = new Map();
  for (const token of text.split(/\s+/u).map(normalizeToken).filter(Boolean)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function joinHyphenatedLines(text) {
  return text.replace(/-\s*\n/gu, '');
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function missingTokens(expected, actual) {
  return [...expected].flatMap(([token, count]) => {
    const missing = count - (actual.get(token) ?? 0);
    return missing > 0 ? [{ token, count: missing }] : [];
  });
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function pdfPages(pdfPath) {
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  return Number(info.match(/^Pages:\s+(\d+)$/mu)?.[1]);
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function fixturePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4;
      raw[pixel] = 35;
      raw[pixel + 1] = 110;
      raw[pixel + 2] = 205;
      raw[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @test-decision visual-gate
 * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
 */
function lineBoxParity(plan, pdfPath) {
  const toleranceMm = parityConfig.pdf_parity.points_tolerance * 25.4 / 72;
  // This oracle compares the narrative/footer token stream below. Header
  // chrome is painted by the report renderer and has a dedicated rendered
  // bounds regression in the editorial-flow harness; mixing it here makes
  // the oracle compare two different contracts.
  const lines = plan.lines.filter((line) => line.flowId === 'main' || line.flowId === 'footer').map((line) => ({
    page: line.page - 1,
    x0: line.box.x - toleranceMm,
    y0: line.box.y - toleranceMm,
    x1: line.box.x + line.box.width + toleranceMm,
    y1: line.box.y + line.box.height + toleranceMm,
    remaining: tokenCounts(line.text.replaceAll('{{page.number}}', '').replaceAll('{{page.count}}', '')),
  }));
  const words = extractPdfWords(pdfPath);
  for (const word of words) {
    const token = normalizeToken(word.text);
    if (!token) continue;
    const x0 = word.xMin * 25.4 / 72;
    const y0 = word.yMin * 25.4 / 72;
    const x1 = word.xMax * 25.4 / 72;
    const y1 = word.yMax * 25.4 / 72;
    const candidate = lines.find((line) => line.page === word.page
      && x0 >= line.x0 && x1 <= line.x1 && y0 >= line.y0 && y1 <= line.y1
      && (line.remaining.get(token) ?? 0) > 0);
    if (candidate) candidate.remaining.set(token, candidate.remaining.get(token) - 1);
  }
  return lines.flatMap((line) => [...line.remaining].flatMap(([token, count]) => count > 0 ? [{ token, count, page: line.page + 1 }] : []));
}

try {
  const { renderReportCompositionPdf, renderReportPdfDetailed } = await import(reportBundle);
  const { createJsPdfTextBackend, createTextCompositionEngine, renderComposition } = await import(backendBundle);
  const { compositionPdfBackendOptionsFromRenderConfig, planReportComposition } = await import(adapterBundle);
  const { newPdf } = await import(primitivesBundle);
  const { compileTemplateSource } = await import(templateBundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  const emptyPdfPath = join(temporary, 'empty-text.pdf');
  const emptyPdf = newPdf();
  await writeFile(emptyPdfPath, Buffer.from(emptyPdf.output('arraybuffer')));
  assert.equal(extractPdfText(emptyPdfPath).trim(), '', 'a valid PDF without text must be distinguishable from a decoder failure');
  const malformedPdfPath = join(temporary, 'malformed.pdf');
  await writeFile(malformedPdfPath, Buffer.from('not a PDF document', 'utf8'));
  assert.throws(() => extractPdfText(malformedPdfPath), (error) => error?.code === 'PDF_TEXT_EXTRACTION_FAILED', 'a failed PDF decoder must have a dedicated extraction error');
  const source = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);
  const body = Array.from({ length: 720 }, (_, index) => `sentinel${String(index + 1).padStart(4, '0')}`).join(' ');
  const data = {
    brand: 'Composition Lab',
    title: 'A production chrome fixture',
    subtitle: 'Metadata is rendered by the transitional product chrome.',
    period: '2026 Q3',
    intro: 'The same intro is rendered by both the legacy oracle and the composition adapter.',
    sections: [{ heading: 'A comparable narrative section', body }],
    footer: 'Oracle comparison fixture',
  };
  const input = legacyFixtureToCompositionInput(data);
  const oracle = await renderReportPdfDetailed('pages/editorial-two-column', input);
  const oraclePath = join(temporary, 'oracle.pdf');
  await writeFile(oraclePath, oracle.buffer);
  assert.equal(oracle.diagnostics.composition?.evaluation.status, 'accepted', 'public editorial rendering must execute an accepted composition plan');
  assert.ok((oracle.diagnostics.composition?.plan.lines.length ?? 0) > 0, 'public editorial rendering must expose concrete planner lines');
  const compositionPdf = newPdf();
  const composition = planReportComposition(compositionPdf, compiled, geometry, input, { family: 'DejaVu', maxPages: 3 });
  assert.equal(composition.evaluation.status, 'accepted', JSON.stringify(composition.evaluation));
  const compositionArtifact = renderComposition(composition.document, composition, createJsPdfTextBackend(compositionPdf, 'DejaVu', (await import(adapterBundle)).compositionStylesFromRenderConfig(), compositionPdfBackendOptionsFromRenderConfig()));
  const compositionPath = join(temporary, 'composition.pdf');
  await writeFile(compositionPath, compositionArtifact);
  const expectedText = [...composition.document.flows.main.blocks, ...(composition.document.flows.footer?.blocks ?? [])].map((block) => block.text ?? '').join(' ');
  const compositionText = extractPdfText(compositionPath, ['-layout']);
  const oracleText = extractPdfText(oraclePath, ['-layout']);
  const expected = tokenCounts(expectedText.replaceAll('{{page.number}}', '').replaceAll('{{page.count}}', ''));
  const oracleCounts = tokenCounts(joinHyphenatedLines(oracleText));
  const report = {
    oraclePages: pdfPages(oraclePath),
    compositionPages: pdfPages(compositionPath),
    pageDelta: pdfPages(compositionPath) - pdfPages(oraclePath),
    oracleMissingTokens: missingTokens(expected, oracleCounts),
    oracleExtraTokens: missingTokens(oracleCounts, expected),
    compositionMissingTokens: missingTokens(expected, tokenCounts(compositionText)),
    compositionLineBoxMissing: lineBoxParity(composition.plan, compositionPath),
  };
  const plannedText = composition.plan.lines
    .filter((line) => line.flowId === 'main' || line.flowId === 'footer')
    .map((line) => line.text)
    .join(' ');
  report.planMissingTokens = missingTokens(expected, tokenCounts(plannedText));
  assert.equal(report.oracleMissingTokens.length, 0, JSON.stringify(report));
  assert.equal(report.compositionMissingTokens.length, 0, JSON.stringify(report));
  assert.equal(report.planMissingTokens.length, 0, JSON.stringify(report));
  assert.equal(report.compositionLineBoxMissing.length, 0, JSON.stringify(report));

  const numberedInsetTemplate = {
    maxPages: 1,
    layouts: [{ id: 'numbered-inset', width: 100, height: 100, slots: [
      { id: 'left-before', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'right-before', regionId: 'main', kind: 'text', box: { x: 55, y: 5, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'left-after', regionId: 'main', kind: 'text', box: { x: 5, y: 45, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'right-after', regionId: 'main', kind: 'text', box: { x: 55, y: 45, width: 40, height: 20 }, allowedRoles: ['body'] },
      { id: 'quote-b', regionId: 'quotes', kind: 'text', box: { x: 5, y: 70, width: 90, height: 10 }, allowedRoles: ['quote'] },
    ] }],
    routes: {
      main: { slots: ['left-before', 'left-after', 'right-before', 'right-after'], layouts: ['numbered-inset'], continuation: 'forbidden' },
      quotes: { slots: ['quote-b'], insertionSlots: ['quote-b'], layouts: ['numbered-inset'], continuation: 'forbidden' },
    },
  };
  const numberedHeadingWords = ['lorem1', 'lorem2'];
  const numberedBodyWords = Array.from({ length: 6 }, (_, index) => `lorem${index + numberedHeadingWords.length + 1}`);
  const numberedTailWords = Array.from({ length: 4 }, (_, index) => `lorem${index + numberedHeadingWords.length + numberedBodyWords.length + 1}`);
  const numberedInsetDocument = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'numbered-heading', kind: 'paragraph', role: 'body', text: numberedHeadingWords.join(' ') },
      { id: 'numbered-body', kind: 'paragraph', role: 'body', text: numberedBodyWords.join(' ') },
      { id: 'numbered-tail', kind: 'paragraph', role: 'body', text: numberedTailWords.join(' ') },
      ] },
      quotes: { id: 'quotes', continuation: 'forbidden', blocks: [{ id: 'numbered-quote', kind: 'paragraph', role: 'quote', text: 'quote-0001 quote-0002' }] },
    },
  };
  const numberedMetrics = {
    units: 'mm',
    family: 'oracle',
    measureText(text) { return text.length * 2.2; },
    lineHeight() { return 10; },
  };
  const numberedComposition = createTextCompositionEngine(numberedInsetTemplate).plan(numberedInsetDocument, numberedMetrics);
  assert.equal(numberedComposition.evaluation.status, 'accepted', JSON.stringify(numberedComposition.evaluation));
  const plannedNumberedTokens = numberedComposition.plan.lines
    .flatMap((line) => line.text.match(/lorem\d+/gu) ?? []);
  assert.deepEqual(plannedNumberedTokens, [...numberedHeadingWords, ...numberedBodyWords, ...numberedTailWords], 'the plan must retain numbered source order across the insertion');
  const numberedPdf = newPdf('portrait', [numberedInsetTemplate.layouts[0].width, numberedInsetTemplate.layouts[0].height]);
  const numberedArtifact = renderComposition(numberedInsetDocument, numberedComposition, createJsPdfTextBackend(numberedPdf, 'DejaVu', (await import(adapterBundle)).compositionStylesFromRenderConfig(), compositionPdfBackendOptionsFromRenderConfig()));
  const numberedPdfPath = join(temporary, 'numbered-inset.pdf');
  await writeFile(numberedPdfPath, numberedArtifact);
  const numberedPdfWords = extractPdfWords(numberedPdfPath).filter((word) => /^lorem\d+$/u.test(word.text));
  const numberedExpectedSet = [...numberedHeadingWords, ...numberedBodyWords, ...numberedTailWords].sort();
  assert.deepEqual(numberedPdfWords.map((word) => word.text).sort(), numberedExpectedSet, 'every numbered word must reach the final PDF');
  const numberedEntries = numberedPdfWords.map((word) => ({ number: Number(word.text.slice(5)), x: word.xMin, y: word.yMin }));
  const numberedLeftSlot = numberedComposition.plan.slots.find((slot) => slot.id === '1:left-before');
  const numberedRightSlot = numberedComposition.plan.slots.find((slot) => slot.id === '1:right-before');
  assert.ok(numberedLeftSlot && numberedRightSlot, 'numbered PDF fixture must expose both column slots');
  const pointsPerMm = 72 / 25.4;
  const numberedColumnBoundary = ((numberedLeftSlot.box.x + numberedLeftSlot.box.width) + numberedRightSlot.box.x) / 2 * pointsPerMm;
  /**
   * @test-decision visual-gate
   * @test-action Move PDF token/box/oracle work to one compatibility/showcase gate; use plan lines and placements for fast assertions.
   */
  const leftOfPdfEntry = (entry) => entry.x < numberedColumnBoundary;
  assert.deepEqual(numberedEntries.filter(leftOfPdfEntry).map((entry) => entry.number).sort((a, b) => a - b), [...numberedHeadingWords, ...numberedBodyWords].map((word) => Number(word.slice(5))).sort((a, b) => a - b), 'the first column must contain the complete heading and body stream');
  assert.deepEqual(numberedEntries.filter((entry) => !leftOfPdfEntry(entry)).map((entry) => entry.number).sort((a, b) => a - b), numberedTailWords.map((word) => Number(word.slice(5))).sort((a, b) => a - b), 'the second column must start only after the first stream is complete');
  for (const right of numberedEntries.filter((entry) => !leftOfPdfEntry(entry))) {
    for (const left of numberedEntries.filter((entry) => leftOfPdfEntry(entry) && right.y <= entry.y)) {
      assert.ok(right.number > left.number, `PDF number ${right.number} must not appear to the right and above number ${left.number}`);
    }
  }
  const integrated = await renderReportCompositionPdf('pages/editorial-two-column', input);
  const integratedPath = join(temporary, 'integrated-composition.pdf');
  await writeFile(integratedPath, integrated.buffer);
  const integratedText = extractPdfText(integratedPath, ['-layout']);
  assert.match(integratedText, /sentinel0001/u);
  assert.match(integratedText, /Oracle comparison fixture/u);
  assert.match(integratedText, /A production chrome fixture/u);
  assert.match(integratedText, /COMPOSITION LAB/u);
  assert.match(integratedText, /2026 Q3/u);
  assert.ok(integrated.composition.plan.pages.length >= 2);
  for (let page = 1; page <= integrated.composition.plan.pages.length; page += 1) {
    const pageText = extractPdfText(integratedPath, ['-f', String(page), '-l', String(page)]);
    assert.equal((pageText.match(/Oracle comparison fixture/gu) ?? []).length, 1, `footer should be repeated once on page ${page}`);
  }

  const authoredImagePath = join(temporary, 'authored.png');
  await writeFile(authoredImagePath, fixturePng(320, 180));
  const tallImagePath = join(temporary, 'tall-authored.png');
  await writeFile(tallImagePath, fixturePng(320, 1200));
  const authoredImageData = {
    sections: [{
      heading: 'Authored image in the flow',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Text before the authored image.' },
          { type: 'image', src: 'root://authored.png', alt: 'Blue fixture', caption: 'A measured authored image.' },
          { type: 'text', text: 'Text after the authored image must remain in the flow.' },
        ],
      }],
    }],
    footer: 'Authored image fixture',
  };
  const authoredImageContext = { resolvePath(reference) {
    if (reference === 'root://authored.png') return authoredImagePath;
    if (reference === 'root://tall-authored.png') return tallImagePath;
    assert.fail(`unexpected image reference: ${reference}`);
  } };
  const authoredImage = await renderReportCompositionPdf('pages/editorial-two-column', legacyFixtureToCompositionInput(authoredImageData), undefined, authoredImageContext);
  assert.equal(authoredImage.composition.evaluation.status, 'accepted', JSON.stringify(authoredImage.composition.evaluation));
  const authoredImagePlacement = authoredImage.composition.plan.blockPlacements.find((placement) => placement.kind === 'image');
  assert.ok(authoredImagePlacement?.imageBox, 'image placement should expose its resolved image box');
  assert.ok(authoredImagePlacement?.captionBox, 'captioned image should expose its resolved caption box');
  assert.ok(authoredImage.composition.plan.pages.length >= 1);
  const authoredImagePdfPath = join(temporary, 'authored-image.pdf');
  await writeFile(authoredImagePdfPath, authoredImage.buffer);
  const authoredImageText = extractPdfText(authoredImagePdfPath, ['-layout']);
  assert.match(authoredImageText, /Text before the authored image/u);
  assert.match(authoredImageText, /A measured authored image/u);
  assert.match(authoredImageText, /Text after the authored image must remain\s+in the flow/u);
  const imageList = execFileSync('pdfimages', ['-list', authoredImagePdfPath], { encoding: 'utf8' });
  assert.match(imageList, /image\s+no/u);
  assert.match(imageList, /320\s+180/u);
  const introAuthoredImage = await renderReportCompositionPdf('pages/editorial-two-column', legacyFixtureToCompositionInput({
    intro: 'Intro text before the image.\n\n![Intro fixture](root://authored.png)\n\nIntro text after the image.',
    footer: 'Intro image fixture',
  }), undefined, authoredImageContext);
  assert.equal(introAuthoredImage.composition.evaluation.status, 'accepted', JSON.stringify(introAuthoredImage.composition.evaluation));
  assert.deepEqual(introAuthoredImage.composition.plan.blockPlacements.filter((placement) => placement.kind === 'image').length, 1);
  assert.ok(introAuthoredImage.composition.plan.lines.some((line) => line.text.includes('Intro text before')));
  assert.ok(introAuthoredImage.composition.plan.lines.some((line) => line.text.includes('Intro text after')));
  const tallImage = await renderReportCompositionPdf('pages/editorial-two-column', legacyFixtureToCompositionInput({
    sections: [{ heading: 'Tall authored image', content: [{ type: 'image', src: 'root://tall-authored.png', alt: 'Tall blue fixture' }] }],
    footer: 'Tall authored image fixture',
  }), undefined, authoredImageContext);
  assert.equal(tallImage.composition.evaluation.status, 'accepted', JSON.stringify(tallImage.composition.evaluation));
  assert.ok(tallImage.composition.plan.decisions.some((decision) => decision.code === 'IMAGE_SCALED_TO_FIT'));
  const tallPlacement = tallImage.composition.plan.blockPlacements.find((placement) => placement.kind === 'image');
  const tallSlot = tallPlacement && tallImage.composition.plan.slots.find((slot) => slot.id === tallPlacement.slotId);
  assert.ok(tallPlacement && tallSlot && tallPlacement.box.height <= tallSlot.box.height);

  const quoteDocument = {
    flows: {
      main: { id: 'main', blocks: [] },
      quotes: {
        id: 'quotes',
        blocks: [{ id: 'quote-fixture', kind: 'paragraph', role: 'quote', text: 'A quote keeps both marks inside its editorial frame.' }],
      },
    },
  };
  const quoteStyles = (await import(adapterBundle)).compositionStylesFromRenderConfig({ foreground: [0, 0, 0], muted: [100, 100, 100], primary: [1, 92, 146], quote: [1, 92, 146] });
  const quotePlan = {
    pages: [{ page: 1, layoutId: 'quote-fixture', width: 210, height: 297 }],
    slots: [{ id: '1:quote', page: 1, regionId: 'quotes', box: { x: 17, y: 40, width: 176, height: 20 }, state: 'partial' }],
    placements: [{ id: 'quote-placement', blockId: 'quote-fixture', slotId: '1:quote', page: 1, routeIndex: 0, box: { x: 25, y: 40, width: 168, height: 11.2 }, startWord: 0, endWord: 9 }],
    blockPlacements: [],
    tablePlacements: [],
    graphicPlacements: [],
    glyphPlacements: [
      {
        id: 'glyph-placement:quote-fixture:open-quote:1',
        glyphId: 'quote-fixture:open-quote',
        targetType: 'block',
        targetId: 'quote-fixture',
        flowId: 'quotes',
        page: 1,
        slotId: '1:quote',
        text: '“',
        styleName: 'quote-mark',
        anchor: 'text-start',
        box: { x: 17, y: 40, width: 4, height: quoteStyles['quote-mark'].lineHeight },
        baselineY: 40 + quoteStyles['quote-mark'].baselineOffset,
      },
      {
        id: 'glyph-placement:quote-fixture:close-quote:1',
        glyphId: 'quote-fixture:close-quote',
        targetType: 'block',
        targetId: 'quote-fixture',
        flowId: 'quotes',
        page: 1,
        slotId: '1:quote',
        text: '”',
        styleName: 'quote-mark',
        anchor: 'text-end',
        box: { x: 185, y: 40, width: 4, height: quoteStyles['quote-mark'].lineHeight },
        baselineY: 40 + quoteStyles['quote-mark'].baselineOffset,
      },
    ],
    lines: [{ blockId: 'quote-fixture', flowId: 'quotes', slotId: '1:quote', page: 1, routeIndex: 0, text: 'A quote keeps both marks inside its editorial frame.', box: { x: 25, y: 40, width: 168, height: 11.2 }, naturalWidth: 0, startWord: 0, endWord: 9 }],
    decisions: [],
    diagnostics: [],
    residualContent: [],
  };
  const quotePdf = newPdf();
  const quoteArtifact = createJsPdfTextBackend(quotePdf, 'DejaVu', quoteStyles, compositionPdfBackendOptionsFromRenderConfig()).render(quoteDocument, quotePlan);
  const quotePdfPath = join(temporary, 'quote-fixture.pdf');
  await writeFile(quotePdfPath, quoteArtifact);
  const quoteWords = extractPdfWords(quotePdfPath);
  const openingMarks = quoteWords.filter((word) => word.text === '“');
  const closingMarks = quoteWords.filter((word) => word.text === '”');
  assert.equal(openingMarks.length, 1, 'quote fixture must emit one opening glyph');
  assert.equal(closingMarks.length, 1, 'quote fixture must emit one closing glyph');
  const quoteLine = quotePlan.lines[0];
  const quoteSlot = quotePlan.slots[0];
  const quoteTolerance = 1;
  const openingX = openingMarks[0].xMin * 25.4 / 72;
  const closingX = closingMarks[0].xMax * 25.4 / 72;
  assert.ok(openingX >= quoteSlot.box.x - quoteTolerance, 'opening glyph must stay inside the quote slot');
  assert.ok(closingX <= quoteSlot.box.x + quoteSlot.box.width + quoteTolerance, 'closing glyph must stay inside the quote slot');
  console.log(JSON.stringify({ status: 'passed', ...report }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
