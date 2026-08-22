#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { runProcess as run } from '../server/scripts/lib/process.mjs';
import { findOfficeConverter } from '../server/scripts/lib/office.mjs';

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const root = resolve(valueFor('--root', 'examples/brand-showcase/generated'));
const qaRoot = resolve(valueFor('--qa-root', '/tmp/report-baby-brand-showcase-qa'));
const qaStage = `${qaRoot}.staging-${process.pid}`;
const requirePptxRender = args.includes('--require-pptx-render');
const manifests = [];
const failures = [];
const findings = [];

async function walk(directory) {
  const entries = await import('node:fs/promises').then(({ readdir }) => readdir(directory, { withFileTypes: true })).catch(() => []);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name === 'manifest.json') manifests.push(path);
  }
}

function fail(path, message) {
  failures.push(`${path}: ${message}`);
}

function outputPath(manifestPath, value) {
  return typeof value === 'string' && !value.startsWith('/') ? join(dirname(manifestPath), value) : value;
}

function parsePdfInfo(path) {
  const result = run('pdfinfo', [path]);
  if (result.status !== 0) return { available: false, error: result.stderr.trim() };
  const values = {};
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/^([^:]+):\s+(.*)$/);
    if (match) values[match[1].trim()] = match[2].trim();
  }
  return { available: true, pages: Number(values.Pages ?? 0), pageSize: values['Page size'] };
}

function parsePdfFonts(path) {
  const result = run('pdffonts', [path]);
  if (result.status !== 0) return { available: false, names: [] };
  const names = result.stdout.split('\n').slice(2).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
  return { available: true, names };
}

function fontToken(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function gateExpectedPptxFonts(path, fonts, expectedFamily) {
  if (!expectedFamily || !fonts.available) return;
  const expected = fontToken(expectedFamily);
  const names = fonts.names.map(fontToken);
  if (!names.some((name) => name.includes(expected))) fail(path, `PPTX round-trip did not embed expected font family '${expectedFamily}': ${fonts.names.join(', ')}`);
  const hasBold = names.some((name) => name.includes(`${expected}bold`) || name.includes(`${expected}-bold`));
  const variableUbuntu = expected === 'ubuntusans';
  if (!hasBold && !variableUbuntu) fail(path, `PPTX round-trip did not expose a bold face for '${expectedFamily}': ${fonts.names.join(', ')}`);
}

function pngDimensions(path) {
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function renderPdfPages(pdfPath, outputDir, basename, mode = 'slide') {
  await mkdir(outputDir, { recursive: true });
  const prefix = join(outputDir, basename);
  const rasterArgs = mode === 'slide' ? ['-scale-to-x', '1600', '-scale-to-y', '900'] : ['-r', '150'];
  const result = run('pdftoppm', ['-png', ...rasterArgs, pdfPath, prefix]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `pdftoppm failed for ${pdfPath}`);
  return (await readdir(outputDir)).filter((name) => name.startsWith(`${basename}-`) && name.endsWith('.png')).sort().map((name) => join(outputDir, name));
}

function makeContactSheet(paths, outputPath) {
  const existing = paths.filter((path) => existsSync(path));
  if (existing.length < 2) return;
  run('montage', [...existing, '-thumbnail', '480x270', '-tile', '2x', '-geometry', '+8+8', outputPath]);
}

function makeDiff(left, right, outputPath) {
  if (!existsSync(left) || !existsSync(right)) return null;
  const leftSize = pngDimensions(left);
  const rightSize = pngDimensions(right);
  if (!leftSize || !rightSize || leftSize.width !== rightSize.width || leftSize.height !== rightSize.height) {
    return { metric: null, changedPixelRatio: null, status: 2, output: outputPath, error: `PNG dimensions differ: ${JSON.stringify(leftSize)} vs ${JSON.stringify(rightSize)}` };
  }
  const result = run('compare', ['-metric', 'AE', '-fuzz', '5%', left, right, outputPath]);
  const metric = Number.parseInt(`${result.stderr} ${result.stdout}`.match(/\d+/)?.[0] ?? '0', 10);
  const pixels = leftSize ? leftSize.width * leftSize.height : 0;
  const ratio = pixels > 0 ? metric / pixels : null;
  return { metric, changedPixelRatio: ratio, status: result.status, output: outputPath };
}

function makeRegionDiff(left, right, region, outputPath) {
  const x = Math.max(0, Math.round(region.x));
  const y = Math.max(0, Math.round(region.y));
  const width = Math.max(1, Math.round(region.width));
  const height = Math.max(1, Math.round(region.height));
  const leftCrop = `${outputPath}.left.png`;
  const rightCrop = `${outputPath}.right.png`;
  const geometry = `${width}x${height}+${x}+${y}`;
  const leftResult = run('convert', [left, '-crop', geometry, '+repage', leftCrop]);
  const rightResult = run('convert', [right, '-crop', geometry, '+repage', rightCrop]);
  if (leftResult.status !== 0 || rightResult.status !== 0) return null;
  return makeDiff(leftCrop, rightCrop, outputPath);
}

const MAX_CHANGED_PIXEL_RATIO = 0.35;

function gateDiff(path, diff) {
  if (!diff) return;
  if (diff.status !== 0 && diff.status !== 1) {
    fail(path, diff.error ?? 'image comparison failed');
    return;
  }
  if (diff.changedPixelRatio === null) return;
  if (diff.changedPixelRatio > MAX_CHANGED_PIXEL_RATIO) fail(path, `round-trip differs in ${(diff.changedPixelRatio * 100).toFixed(1)}% of pixels (limit ${(MAX_CHANGED_PIXEL_RATIO * 100).toFixed(0)}%)`);
}

function gateRegionDiff(path, diff, regionName) {
  if (!diff) return;
  if (diff.status !== 0 && diff.status !== 1) {
    fail(path, `${regionName} comparison failed: ${diff.error ?? 'unknown error'}`);
    return;
  }
  if (diff.changedPixelRatio !== null && diff.changedPixelRatio > 0.12) {
    fail(path, `${regionName} differs in ${(diff.changedPixelRatio * 100).toFixed(1)}% of pixels (limit 12%)`);
  }
}

function pptxBreakCount(path, slideNumber) {
  const result = run('unzip', ['-p', path, `ppt/slides/slide${slideNumber}.xml`]);
  if (result.status !== 0) return { available: false, count: 0, error: result.stderr.trim() };
  const textShapes = result.stdout.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? [];
  const count = textShapes.reduce((total, shape) => total + Math.max(0, (shape.match(/<a:p[ >]/g) ?? []).length - 1), 0);
  return { available: true, count };
}

function stableQaPaths(value) {
  if (typeof value === 'string') return value.replaceAll(qaStage, qaRoot);
  if (Array.isArray(value)) return value.map(stableQaPaths);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stableQaPaths(item)]));
  return value;
}

async function inspectManifest(manifestPath, converter) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const brandDir = dirname(manifestPath);
  const qaDir = join(qaStage, basename(brandDir));
  await mkdir(qaDir, { recursive: true });
  await mkdir(join(qaDir, 'comparisons'), { recursive: true });
  const beforeFailures = failures.length;
  const record = { manifest: manifestPath, brand: manifest.brand, schema_version: manifest.schema_version, native: [], reports: [], pptx: [], manualReview: 'required' };
  if (manifest.schema_version !== 1) fail(manifestPath, `unsupported manifest schema_version: ${manifest.schema_version}`);

  for (const report of manifest.outputs?.reports ?? []) {
    const reportPdf = outputPath(manifestPath, report.outputs?.pdf);
    if (!reportPdf) continue;
    const info = parsePdfInfo(reportPdf);
    const fonts = parsePdfFonts(reportPdf);
    const pngDir = join(qaDir, 'reports-png');
    let pngs = [];
    try { pngs = await renderPdfPages(reportPdf, pngDir, report.id ?? 'report', 'report'); } catch (error) { fail(reportPdf, error.message); }
    if (!info.available || info.pages !== pngs.length || pngs.length === 0) fail(reportPdf, `PDF page/raster count mismatch: pdf=${info.pages}, png=${pngs.length}`);
    record.reports.push({ id: report.id, pdf: reportPdf, pdfInfo: info, fonts, png: pngs, pngDimensions: pngs.map(pngDimensions) });
  }

  for (const deck of manifest.outputs?.decks ?? []) {
    const nativePdf = outputPath(manifestPath, deck.outputs?.pdf);
    if (nativePdf) {
      const info = parsePdfInfo(nativePdf);
      const fonts = parsePdfFonts(nativePdf);
      const nativePngDir = join(qaDir, 'native-pdf-png');
      let nativePngs = [];
      try { nativePngs = await renderPdfPages(nativePdf, nativePngDir, deck.id); } catch (error) { fail(nativePdf, error.message); }
      const directPngs = (deck.outputs?.png ?? []).map((path) => outputPath(manifestPath, path));
      if (info.available && info.pages !== nativePngs.length) fail(nativePdf, `native PDF page count ${info.pages} does not match rasterized pages ${nativePngs.length}`);
      if (directPngs.length !== nativePngs.length) fail(nativePdf, `native PDF page count ${nativePngs.length} does not match direct PNG count ${directPngs.length}`);
      const nativeComparisons = [];
      for (let page = 0; page < directPngs.length; page += 1) {
        if (!nativePngs[page]) continue;
        const label = `${deck.id}-page-${String(page + 1).padStart(2, '0')}`;
        const contactSheet = join(qaDir, 'comparisons', `${label}-direct-vs-pdf.png`);
        const diff = join(qaDir, 'comparisons', `${label}-direct-vs-pdf-diff.png`);
        makeContactSheet([directPngs[page], nativePngs[page]], contactSheet);
        const diffResult = makeDiff(directPngs[page], nativePngs[page], diff);
        gateDiff(nativePdf, diffResult);
        nativeComparisons.push({ page: page + 1, contactSheet, diff: diffResult });
      }
      record.native.push({ id: deck.id, pdf: nativePdf, pdfInfo: info, fonts, png: nativePngs, pngDimensions: nativePngs.map(pngDimensions), comparisons: nativeComparisons });
    }
    const pptxPath = outputPath(manifestPath, deck.outputs?.pptx);
    if (!pptxPath) continue;
    const item = { id: deck.id, pptx: pptxPath, converter, status: 'not-rendered' };
    if (converter) {
      const pptxPdfDir = join(qaDir, 'pptx-as-pdf');
      await mkdir(pptxPdfDir, { recursive: true });
      const result = run(converter.command, [...converter.prefixArgs, '--headless', '--convert-to', 'pdf', '--outdir', pptxPdfDir, pptxPath]);
      const convertedPdf = join(pptxPdfDir, `${pptxPath.split('/').at(-1).replace(/\.pptx$/i, '.pdf')}`);
      if (result.status !== 0 || !existsSync(convertedPdf)) {
        item.status = 'conversion-failed';
        fail(pptxPath, result.stderr.trim() || result.stdout.trim() || `PPTX converter exited with status ${result.status} without creating a PDF`);
      } else {
        let pptxPngs = [];
        try { pptxPngs = await renderPdfPages(convertedPdf, join(qaDir, 'pptx-as-png'), deck.id); } catch (error) { fail(convertedPdf, error.message); }
        item.status = 'rendered';
        item.pdf = convertedPdf;
        item.pdfInfo = parsePdfInfo(convertedPdf);
        item.fonts = parsePdfFonts(convertedPdf);
        gateExpectedPptxFonts(pptxPath, item.fonts, deck.theme?.fontFamily);
        const textLayoutChecks = [];
        for (const [slideIndex, layout] of (deck.slideLayout ?? []).entries()) {
          if (layout.titleLines <= 0 && layout.subtitleLines <= 0) continue;
          const expectedBreaks = Math.max(0, layout.titleLines - 1) + Math.max(0, layout.subtitleLines - 1);
          const actualBreaks = pptxBreakCount(pptxPath, slideIndex + 1);
          textLayoutChecks.push({ slide: slideIndex + 1, expectedBreaks, actualBreaks: actualBreaks.count });
          if (!actualBreaks.available) fail(pptxPath, `could not inspect title line breaks on slide ${slideIndex + 1}: ${actualBreaks.error}`);
          else if (actualBreaks.count !== expectedBreaks) fail(pptxPath, `PPTX title line-break count on slide ${slideIndex + 1} (${actualBreaks.count}) differs from shared layout count (${expectedBreaks})`);
        }
        item.png = pptxPngs;
        item.pngDimensions = pptxPngs.map(pngDimensions);
        item.textLayoutChecks = textLayoutChecks;
        item.comparisons = [];
        const directPngs = (deck.outputs?.png ?? []).map((path) => outputPath(manifestPath, path));
        if (pptxPngs.length !== directPngs.length) fail(pptxPath, `PPTX raster page count ${pptxPngs.length} does not match direct PNG count ${directPngs.length}`);
        for (let page = 0; page < directPngs.length; page += 1) {
          if (!pptxPngs[page]) continue;
          const label = `${deck.id}-page-${String(page + 1).padStart(2, '0')}`;
          const contactSheet = join(qaDir, 'comparisons', `${label}-direct-vs-pptx.png`);
          const diff = join(qaDir, 'comparisons', `${label}-direct-vs-pptx-diff.png`);
          makeContactSheet([directPngs[page], pptxPngs[page]], contactSheet);
          const diffResult = makeDiff(directPngs[page], pptxPngs[page], diff);
          gateDiff(pptxPath, diffResult);
          const regions = [];
          const slotBoxes = deck.slidePlans?.[page]?.slotBoxes ?? {};
          // Logo rasters are re-sampled by LibreOffice even when geometry is
          // identical; compare the lockup name and its declared geometry,
          // while leaving the bitmap itself to the whole-slide diff.
          for (const regionName of ['lockup-name', 'title', 'subtitle', 'footer']) {
            const region = slotBoxes[regionName];
            if (!region) continue;
            const regionDiff = join(qaDir, 'comparisons', `${label}-${regionName}-diff.png`);
            const regionResult = makeRegionDiff(directPngs[page], pptxPngs[page], region, regionDiff);
            gateRegionDiff(pptxPath, regionResult, `slide ${page + 1} ${regionName}`);
            regions.push({ name: regionName, region, diff: regionResult });
          }
          item.comparisons.push({ page: page + 1, contactSheet, diff: diffResult, regions });
        }
      }
    } else {
      item.status = 'converter-unavailable';
      findings.push(`${pptxPath}: PPTX→PDF→PNG was not executed because no LibreOffice CLI or Flatpak installation was found.`);
    }
    record.pptx.push(item);
  }

  const status = failures.length > beforeFailures ? 'FAIL' : !converter ? 'INCOMPLETE' : 'READY_FOR_MANUAL_REVIEW';
  record.status = status;
  // Keep the final writes resilient when an external cleanup removes an empty
  // QA directory while a long LibreOffice conversion is still running.
  await mkdir(qaDir, { recursive: true });
  await writeFile(join(qaDir, 'measurements.json'), `${JSON.stringify(stableQaPaths(record), null, 2)}\n`);
  await writeFile(join(qaDir, 'findings.md'), `# QA findings — ${manifest.brand}\n\nStatus: **${status}**\n\n${findings.filter((finding) => finding.includes(brandDir)).map((finding) => `- ${finding}`).join('\n') || '- No automated findings. Manual visual review is still required.'}\n`);
  await writeFile(join(qaDir, 'verdict.json'), `${JSON.stringify({ status, manualReview: 'required', converter }, null, 2)}\n`);
  return record;
}

await walk(root);
await rm(qaStage, { recursive: true, force: true });
await mkdir(qaStage, { recursive: true });
const converter = findOfficeConverter(join(qaStage, 'libreoffice-profile'), { filesystemDirectory: qaStage });
const records = [];
for (const manifest of manifests.sort()) records.push(await inspectManifest(manifest, converter));
if (manifests.length === 0) fail(root, 'no manifest.json files found');
if (requirePptxRender && !converter) fail(root, 'PPTX→PDF converter is required but no LibreOffice CLI or Flatpak installation was found');

const report = {
  root,
  converter: converter?.label ?? null,
  status: failures.length > 0 ? 'FAIL' : !converter ? 'INCOMPLETE' : 'READY_FOR_MANUAL_REVIEW',
  manifests: records.length,
  findings,
  failures,
};
await writeFile(join(qaStage, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await rm(qaRoot, { recursive: true, force: true });
await rename(qaStage, qaRoot);
if (failures.length > 0) {
  console.error(`Showcase inspection failed (${failures.length} issue(s))`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (!converter) {
  console.warn(`Showcase inspection incomplete: ${records.length} manifest(s) inspected; PPTX→PDF converter unavailable.`);
  process.exitCode = 2;
} else {
  console.log(`Showcase inspection ready for manual review: ${records.length} manifest(s), converter ${converter.label}.`);
}
