import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { prepareDemoBrandStore } from './lib/brand-store.mjs';
import { childProcessFailure } from './lib/process.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const bundle = process.env.REPORT_BABY_TEST_BUNDLE ?? 'cli-bundle.cjs';
let brandStore;
const config = parseYaml(readFileSync(join(root, 'templates', 'render-config.yml'), 'utf8')).pdf;
const editorialTemplate = parseYaml(readFileSync(join(root, 'templates', 'pages/editorial-two-column/template.yml'), 'utf8')).page;

function parseBbox(xml) {
  return [...xml.matchAll(/<page width="([0-9.]+)" height="([0-9.]+)">([\s\S]*?)<\/page>/g)].map((match, pageIndex) => ({
    pageIndex,
    width: Number(match[1]),
    height: Number(match[2]),
    words: [...match[3].matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]*)<\/word>/g)].map((word) => ({
      xMin: Number(word[1]), yMin: Number(word[2]), xMax: Number(word[3]), yMax: Number(word[4]), text: word[5],
    })),
  }));
}

async function render(input, outputPath) {
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
      if (code !== 0) return reject(new Error(childProcessFailure('report CLI', { status: code, stdout, stderr })));
      try {
        const result = JSON.parse(stdout);
        const { stdout: bbox } = await execFileAsync('pdftotext', ['-bbox-layout', outputPath, '-']);
        resolve({ result, pages: parseBbox(bbox) });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ ...input, output_path: outputPath, diagnostics: 'full' }));
  });
}

function scale(planPage, pdfPage) {
  return pdfPage.width / planPage.width;
}

function assertFooterExclusion(rendered, footerText) {
  const plan = rendered.result.reportPlan;
  const footerTokens = new Set(`${footerText} /`.split(/\s+/));
  for (const page of rendered.pages) {
    const planned = plan?.pages[page.pageIndex];
    const factor = page.width / (planned?.width ?? config.page_width);
    const footerTop = (planned?.blocks.find((block) => block.id === 'footer')?.box.y ?? config.footer_y - config.footer_font_size) * factor;
    for (const word of page.words.filter((item) => item.yMin >= footerTop)) {
      assert.ok(footerTokens.has(word.text) || /^\d+$/.test(word.text), `page ${page.pageIndex + 1}: non-footer word '${word.text}' entered the planned footer box at y=${word.yMin.toFixed(2)}pt`);
    }
  }
}

function assertContinuationStartsAtFlow(rendered) {
  const plan = rendered.result.reportPlan;
  const lineAllowance = (config.body_line_height + config.section_heading_line_height) * (rendered.pages[1].width / (plan?.pages[1]?.width ?? editorialTemplate.width)) * 2;
  for (const page of rendered.pages.slice(1)) {
    const planned = plan?.pages[page.pageIndex];
    const factor = page.width / (planned?.width ?? editorialTemplate.width);
    const flowTop = (planned?.blocks.find((block) => block.id === 'flow' && !block.parentId)?.box.y ?? editorialTemplate.reserved_bands.header.height * editorialTemplate.height) * factor;
    const firstBody = page.words.find((word) => /^Body\d+$/.test(word.text));
    assert.ok(firstBody, `page ${page.pageIndex + 1}: continuation body marker is missing`);
    assert.ok(firstBody.yMin <= flowTop + lineAllowance, `page ${page.pageIndex + 1}: flow starts ${ (firstBody.yMin - flowTop).toFixed(2) }pt below its planned top`);
  }
}

function assertDrawingsContained(rendered) {
  const plan = rendered.result.reportPlan;
  assert.ok(Array.isArray(rendered.result.drawings) && rendered.result.drawings.length > 0, 'full diagnostics did not return recorded drawings');
  for (const drawing of rendered.result.drawings) {
    const page = plan.pages[drawing.page - 1];
    if (!page || drawing.kind === 'rect' && drawing.x === 0 && drawing.y === 0 && drawing.width >= page.width && drawing.height >= page.height) continue;
    const tolerance = 0.75;
    const fits = page.blocks.some((block) => drawing.x >= block.box.x - tolerance
      && drawing.y >= block.box.y - tolerance
      && drawing.x + drawing.width <= block.box.x + block.box.width + tolerance
      && drawing.y + drawing.height <= block.box.y + block.box.height + tolerance);
    assert.ok(fits, `page ${drawing.page}: ${drawing.kind} drawing '${drawing.text ?? ''}' at ${drawing.x.toFixed(2)},${drawing.y.toFixed(2)} size ${drawing.width.toFixed(2)}x${drawing.height.toFixed(2)} leaves every planned block`);
  }
}

try {
  await execFileAsync('pdftotext', ['-v']);
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('SKIP: pdftotext not available; install poppler-utils to run report layout regressions.');
    process.exit(0);
  }
  throw error;
}

const work = await mkdtemp(join(tmpdir(), 'report-baby-layout-'));
brandStore = join(work, 'brand-store');
prepareDemoBrandStore(join(root, '..'), brandStore, 'layout-test');
try {
  const tableReport = {
    template: 'default-report',
    brand_ref: 'brand://orbit/primary',
    data: {
      title: 'Table footer regression',
      sections: [{ heading: 'Context', body: 'Short context.' }],
      table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 70 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 100}`]), caption: 'Dane' },
      footer: 'layout-test',
    },
  };
  const continuationReport = {
    template: 'pages/editorial-two-column',
    brand_ref: 'brand://orbit/primary',
    data: {
      title: 'Continuation top regression',
      sections: Array.from({ length: 6 }, (_, index) => ({ heading: `Section ${index + 1}`, body: `${Array.from({ length: 320 }, (_, word) => `Body${word + index * 320}`).join(' ')}.` })),
      footer: 'layout-test',
    },
  };
  const editorialTableReport = {
    template: 'pages/editorial-two-column',
    brand_ref: 'brand://orbit/primary',
    data: {
      title: 'Editorial table footer regression',
      sections: Array.from({ length: 4 }, (_, index) => ({ heading: `Section ${index + 1}`, body: `${Array.from({ length: 90 }, (_, word) => `Context${word + index * 90}`).join(' ')}.` })),
      table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 20 }, (_, index) => [`Tabela ${index + 1}`, `${index + 100}`]), caption: 'Dane tabeli' },
      footer: 'layout-test',
    },
  };
  const reproC = {
    template: 'pages/editorial-two-column',
    brand_ref: 'brand://flux/primary',
    data: {
      title: 'Tabela w przeplywie',
      sections: Array.from({ length: 4 }, (_, index) => ({ heading: `S${index + 1}`, body: 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny przewozow dlugodystansowych. '.repeat(2) })),
      table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 6 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 11}`]), caption: 'Dane' },
      footer: 'layout-test',
    },
  };
  const footerCollisionReport = {
    template: 'pages/editorial-two-column',
    brand_ref: 'brand://flux/primary',
    data: {
      title: 'Stopka',
      sections: [{ heading: 'Body', body: 'Short context.' }],
      footer: 'Streszczenie artykulu: transport drogowy i rynek przewozow w Europie Srodkowej, dane za pierwszy kwartal 2026 roku',
    },
  };
  const table = await render(tableReport, join(work, 'table.pdf'));
  const continuation = await render(continuationReport, join(work, 'continuation.pdf'));
  const editorialTable = await render(editorialTableReport, join(work, 'editorial-table.pdf'));
  const c = await render(reproC, join(work, 'repro-c.pdf'));
  const footerCollisions = await Promise.all(['flux', 'orbit', 'parcelia', 'pyrus'].map((brand) => render({
    ...footerCollisionReport,
    brand_ref: `brand://${brand}/primary`,
  }, join(work, `footer-collision-${brand}.pdf`))));
  assertFooterExclusion(table, tableReport.data.footer);
  assertFooterExclusion(editorialTable, editorialTableReport.data.footer);
  assertContinuationStartsAtFlow(continuation);
  assertDrawingsContained(editorialTable);
  assertDrawingsContained(continuation);
  assert.equal(c.pages.length, 1, 'reproducer C must fit on one page');
  for (const [index, footerCollision] of footerCollisions.entries()) {
    const footerNumbers = footerCollision.pages.flatMap((page) => page.words.filter((word) => /^\d+$/.test(word.text)));
    const footerWords = footerCollision.pages.flatMap((page) => page.words.filter((word) => word.yMin >= 285 && !/^\d+$/.test(word.text)));
    assert.ok(footerNumbers.length > 0, `footer page number is missing for ${['flux', 'orbit', 'parcelia', 'pyrus'][index]}`);
    for (const word of footerWords) {
      assert.ok(!footerNumbers.some((number) => word.xMax > number.xMin && number.xMax > word.xMin && word.yMax > number.yMin && number.yMax > word.yMin), `footer word '${word.text}' overlaps the page number for ${['flux', 'orbit', 'parcelia', 'pyrus'][index]}`);
    }
  }
  assert.equal(table.result.reportPlan?.pages.length ?? table.pages.length, table.pages.length, 'table diagnostics page count disagrees with PDF');
  assert.equal(continuation.result.reportPlan.pages.length, continuation.pages.length, 'continuation diagnostics page count disagrees with PDF');
  console.log(`report layout: footer containment, coverage, and continuation flow PASS (${table.pages.length + editorialTable.pages.length + continuation.pages.length + c.pages.length + footerCollisions.reduce((sum, item) => sum + item.pages.length, 0)} pages)`);
} finally {
  await rm(work, { recursive: true, force: true });
}
