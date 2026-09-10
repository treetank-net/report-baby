#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { prepareDemoBrandStore } from './lib/brand-store.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const bundle = process.env.REPORT_BABY_TEST_BUNDLE ?? 'cli-bundle.cjs';
const config = parse(await readFile(join(root, 'templates', 'render-config.yml'), 'utf8'));
const templateConfig = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
const mmToPt = config.canvas.points_per_inch / 25.4;
const tolerance = config.pdf.composition_geometry_tolerance * mmToPt + 1;

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function decodeXml(value) {
  return value.replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"');
}

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function parseBbox(xml) {
  return [...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/gu)].map((pageMatch, index) => {
    /**
     * @test-decision visual-gate
     * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
     */
    const pageNumber = (name) => Number(new RegExp(`${name}="([\\d.-]+)"`, 'u').exec(pageMatch[1])?.[1]);
    return {
    page: index + 1,
    width: pageNumber('width'),
    words: [...pageMatch[2].matchAll(/<word\s+([^>]+)>([\s\S]*?)<\/word>/gu)].map((wordMatch) => {
      /**
       * @test-decision visual-gate
       * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
       */
      const number = (name) => Number(new RegExp(`${name}="([\\d.-]+)"`, 'u').exec(wordMatch[1])?.[1]);
      return { text: decodeXml(wordMatch[2]), xMin: number('xMin'), yMin: number('yMin'), xMax: number('xMax'), yMax: number('yMax') };
    }),
  };
  });
}

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function render(request, outputPath, brandStore, renderArtifact = true) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, '--json', 'render_report'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: join(outputPath, '..'), REPORT_BABY_BRAND_STORE: brandStore },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code !== 0) return reject(new Error(`report chrome render failed (${code}): ${stderr || stdout}`));
      if (!renderArtifact) return resolve({ result: JSON.parse(stdout) });
      try {
        const { stdout: bbox } = await execFileAsync('pdftotext', ['-bbox-layout', outputPath, '-']);
        const { stdout: text } = await execFileAsync('pdftotext', [outputPath, '-']);
        resolve({ result: JSON.parse(stdout), pages: parseBbox(bbox), textPages: text.split('\f') });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ ...request, ...(renderArtifact ? { output_path: outputPath } : { dry_run: true }), diagnostics: 'full' }));
  });
}

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function placement(plan, flowId, page) {
  return plan.flowPlacements.find((candidate) => candidate.flowId === flowId && candidate.page === page && candidate.hasContent);
}

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function wordsContaining(page, marker) {
  return page.words.filter((word) => word.text.includes(marker));
}

/**
 * @test-decision visual-gate
 * @test-action Keep only one representative backend artifact smoke in the release path; merge repeated PDF/image checks into the showcase visual gate.
 */
function assertWordInPlacement(page, marker, planned, label) {
  assert.ok(planned, `${label} marker ${marker} has no planned placement on page ${page.page}`);
  const words = wordsContaining(page, marker);
  assert.equal(words.length, 1, `${label} marker ${marker} should occur once on page ${page.page}`);
  const word = words[0];
  const box = planned.box;
  const x = word.xMin / mmToPt;
  const y = word.yMin / mmToPt;
  assert.ok(x >= box.x - tolerance && x <= box.x + box.width + tolerance, `${label} marker ${marker} escaped planned x bounds`);
  assert.ok(y >= box.y - tolerance && y <= box.y + box.height + tolerance, `${label} marker ${marker} escaped planned y bounds`);
}

const work = await mkdtemp(join(tmpdir(), 'report-baby-chrome-'));
const brandStore = join(work, 'brand-store');
prepareDemoBrandStore(join(root, '..'), brandStore, 'chrome-test');
try {
  const outputPath = join(work, 'chrome.pdf');
  const body = 'MAIN_CONTENT_ANCHOR ' + Array.from({ length: 480 }, (_, index) => `content${index}`).join(' ');
  const rendered = await render({
    template_ref: 'pages/editorial-two-column',
    brand_ref: 'brand://orbit/primary',
    data: { flows: {
      header: { continuation: 'forbidden', blocks: [
        { type: 'heading', role: 'header', text: 'CHROME_HEADER_ANCHOR' },
        { type: 'text', role: 'header', text: 'CHROME_HEADER_SUBTITLE' },
      ] },
      main: { continuation: 'allowed', blocks: [
        { type: 'heading', role: 'heading', text: 'MAIN_HEADING_ANCHOR', keep_with_next_lines: 1 },
        { type: 'text', role: 'body', text: body },
      ] },
      footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'CHROME_FOOTER_ANCHOR' }] },
    } },
  }, outputPath, brandStore);

  assert.equal(rendered.result.compositionEvaluation.status, 'accepted', JSON.stringify(rendered.result.compositionEvaluation));
  const plan = rendered.result.compositionPlan;
  assert.equal(rendered.pages.length, plan.pages.length, 'PDF page count must match composition plan');
  assert.ok(rendered.pages.length >= 2, 'chrome fixture must exercise a continuation page');

  const mainPlacements = plan.flowPlacements.filter((candidate) => candidate.flowId === 'main' && candidate.hasContent);
  assert.ok(mainPlacements.length > 0, 'main flow must have planned placements');
  assert.ok(plan.spacing && plan.spacing.pages.length === plan.pages.length, 'composition plan must expose static page geometry for spacing analysis');
  assert.ok(plan.spacing.slots.length >= plan.slots.length, 'spacing report must cover every materialized slot');
  const spacingPage = plan.spacing.pages[0];
  assert.deepEqual(spacingPage.margins, templateConfig.page.margins, 'spacing report must expose template page margins');
  const spacingMainSlot = plan.spacing.slots.find((candidate) => candidate.slotId === mainPlacements[0].slotId);
  assert.ok(spacingMainSlot && Number.isFinite(spacingMainSlot.remainingHeight), 'spacing report must expose slot occupancy and remaining height');
  assert.ok(spacingMainSlot?.chromeBandGaps && Number.isFinite(spacingMainSlot.chromeBandGaps.toFooter), 'rendered spacing report must expose resolved chrome boundary gaps');
  assert.ok(spacingMainSlot?.textStyles?.some((style) => style.styleName === 'body' && style.lineHeight > 0), 'spacing report must expose body line-height and text spacing');
  assert.ok(plan.spacing.textPlacements.some((placement) => placement.flowId === 'header' && placement.spacing.baselineOffset !== undefined), 'spacing report must expose header text metrics');
  assert.ok(plan.spacing.textPlacements.some((placement) => placement.flowId === 'footer' && placement.gapToFooter !== undefined), 'spacing report must expose footer boundary gaps');
  const mainPage = rendered.pages.find((page) => wordsContaining(page, 'MAIN_CONTENT_ANCHOR').length > 0);
  assert.ok(mainPage, 'main content marker must be rendered');
  assertWordInPlacement(mainPage, 'MAIN_CONTENT_ANCHOR', mainPlacements.find((candidate) => candidate.page === mainPage.page), 'main');

  const header = placement(plan, 'header', 1);
  assert.ok(header, 'header flow must have a planned placement on page 1');
  assertWordInPlacement(rendered.pages[0], 'CHROME_HEADER_ANCHOR', header, 'header');
  assertWordInPlacement(rendered.pages[0], 'CHROME_HEADER_SUBTITLE', header, 'header');

  for (const page of rendered.pages) {
    const pagePlan = plan.pages[page.page - 1];
    assert.ok(pagePlan?.chrome, `composition plan must expose chrome geometry on page ${page.page}`);
    assert.ok(pagePlan.chrome.footerRule, `composition plan must expose footer rule geometry on page ${page.page}`);
    assert.ok(pagePlan.chrome.pageNumber, `composition plan must expose page number geometry on page ${page.page}`);
    const footer = placement(plan, 'footer', page.page);
    assert.ok(footer, `footer flow must have a planned placement on page ${page.page}`);
    assertWordInPlacement(page, 'CHROME_FOOTER_ANCHOR', footer, 'footer');
    assert.match(rendered.textPages[page.page - 1] ?? '', new RegExp(`\\b${page.page}\\s*/\\s*${rendered.pages.length}\\b`, 'u'), `page ${page.page} number is missing`);
    const pageWidthMm = plan.pages[page.page - 1].width;

    const footerLine = rendered.result.drawings.find((drawing) => drawing.page === page.page && drawing.kind === 'line'
      && Math.abs(drawing.x - pagePlan.chrome.footerRule.x) <= tolerance
      && Math.abs(drawing.y - pagePlan.chrome.footerRule.y) <= tolerance
      && drawing.width > pageWidthMm * 0.7);
    assert.ok(footerLine, `footer rule must align with planned chrome on page ${page.page}: ${JSON.stringify({ chrome: pagePlan.chrome, lines: rendered.result.drawings.filter((drawing) => drawing.page === page.page && drawing.kind === 'line' && drawing.width > pageWidthMm * 0.7) })}`);
    assert.ok(Math.abs(footerLine.x - config.pdf.margin) <= tolerance, `footer rule starts outside configured margin on page ${page.page}`);
    assert.ok(Math.abs((footerLine.x + footerLine.width) - (pageWidthMm - config.pdf.margin)) <= tolerance, `footer rule ends outside configured margin on page ${page.page}: ${JSON.stringify(footerLine)}`);
  }

  const logoDrawings = rendered.result.drawings.filter((drawing) => drawing.kind === 'image');
  assert.ok(logoDrawings.length >= rendered.pages.length, 'report chrome must draw the lockup on every page');
  assert.equal(wordsContaining(mainPage, 'MAIN_CONTENT_ANCHOR').length, 1, 'main anchor must be rendered once');
  assert.equal(wordsContaining(rendered.pages[0], 'CHROME_HEADER_ANCHOR').length, 1, 'header anchor must not duplicate on first page');

  const dynamicOutputPath = join(work, 'dynamic-chrome.pdf');
  const dynamicRendered = await render({
    template_ref: 'pages/editorial-dynamic-chrome',
    brand_ref: 'brand://orbit/primary',
    data: { flows: {
      header: { continuation: 'forbidden', blocks: [
        { type: 'lockup', id: 'dynamic-lockup', role: 'header', lockup: { mark_asset_id: 'header-mark', label: 'Orbit Logistics' } },
        { type: 'text', role: 'header', text: 'DYNAMIC_HEADER_ANCHOR with a deliberately long title that wraps inside the fit-content header.' },
      ] },
      main: { continuation: 'allowed', blocks: [{ type: 'text', role: 'body', text: Array.from({ length: 260 }, (_, index) => `dynamic${index}`).join(' ') }] },
      footer: { continuation: 'forbidden', blocks: [] },
    }, assets: [{ id: 'header-mark', source: 'brand://orbit/releases/chrome-test/brand/assets/logos/logo-mark.svg' }] },
  }, dynamicOutputPath, brandStore, false);
  assert.equal(dynamicRendered.result.compositionEvaluation.status, 'accepted', JSON.stringify(dynamicRendered.result.compositionEvaluation));
  const dynamicPlan = dynamicRendered.result.compositionPlan;
  const dynamicLockup = dynamicPlan.blockPlacements.find((placement) => placement.kind === 'lockup' && placement.page === 1);
  assert.ok(dynamicLockup, 'dynamic header lockup must be planned as a block placement');
  const dynamicHeaderPlacement = dynamicPlan.flowPlacements.find((candidate) => candidate.flowId === 'header' && candidate.hasContent);
  const dynamicHeaderSlot = dynamicPlan.slots.find((slot) => slot.id === '1:header');
  assert.ok(dynamicHeaderPlacement && dynamicHeaderSlot && dynamicHeaderSlot.box.height > 0, 'dynamic header must be materialized with measured height');
  assert.ok(dynamicPlan.pages[0].chrome.headerBand.height >= dynamicHeaderSlot.box.y + dynamicHeaderSlot.box.height - tolerance, 'dynamic chrome band must contain the measured header box');
  assert.ok(dynamicPlan.pages[0].chrome.headerRule && dynamicPlan.pages[0].chrome.headerRule.y >= dynamicHeaderSlot.box.y + dynamicHeaderSlot.box.height - tolerance, 'dynamic chrome rule must follow the measured header box');
  assert.ok(dynamicPlan.pages[0].chrome.headerRule && dynamicPlan.pages[0].chrome.headerRule.y - (dynamicHeaderSlot.box.y + dynamicHeaderSlot.box.height) >= config.pdf.header_bottom_gap - tolerance, 'dynamic chrome rule must preserve the configured gap below header content');
  assert.ok(dynamicRendered.result.compositionEvaluation.scoreBreakdown.some((component) => component.code === 'header-spacing'), 'composition evaluation must expose header spacing');
  const dynamicMainPlacement = dynamicPlan.flowPlacements.find((candidate) => candidate.flowId === 'main' && candidate.hasContent && candidate.page === 1);
  assert.ok(dynamicMainPlacement && dynamicHeaderSlot && dynamicMainPlacement.box.y >= dynamicHeaderSlot.box.y + dynamicHeaderSlot.box.height - tolerance, 'main flow must start below dynamic header geometry');
  for (const page of dynamicPlan.pages) {
    const pageHeader = dynamicPlan.slots.find((slot) => slot.id === `${page.page}:header`);
    const pageMain = dynamicPlan.flowPlacements.find((candidate) => candidate.flowId === 'main' && candidate.hasContent && candidate.page === page.page);
    if (pageHeader && pageMain && pageHeader.box.height > 0) {
      assert.ok(pageMain.box.y >= pageHeader.box.y + pageHeader.box.height - tolerance, `main flow must start below dynamic header on page ${page.page}`);
    }
  }

  console.log(JSON.stringify({ status: 'passed', pages: rendered.pages.length, footerRules: rendered.pages.length, logoDrawings: logoDrawings.length, planFlowPlacements: plan.flowPlacements.length }, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
