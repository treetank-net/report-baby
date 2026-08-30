#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — independent PDF artifact parity.
// This is intentionally weaker than a full glyph-box oracle: it verifies that
// an accepted plan produced a PDF with the declared page geometry and that the
// selectable text layer contains the complete source token multiset from the
// fixture-owned source snapshot, never from the generated plan.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const inputRoot = resolve(process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : '/tmp/report-baby-breaking-policy-corpus-v9/rendered');
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-composition-pdf-parity');
const config = parse(readFileSync(join(root, 'templates', 'composition-pixel-qa-prototype.yml'), 'utf8'));

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function normalizeToken(token) {
  return token.toLocaleLowerCase('und').replace(/[^\p{L}\p{N}]+/gu, '');
}

function tokenCounts(text) {
  const counts = new Map();
  for (const token of text.split(/\s+/u).map(normalizeToken).filter(Boolean)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
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

function pdfInfo(pdfPath) {
  const output = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  const pages = Number(output.match(/^Pages:\s+(\d+)$/mu)?.[1]);
  const size = output.match(/^Page size:\s+([\d.]+) x ([\d.]+) pts(?:\s+\([^\n]+\))?$/mu);
  assert(Number.isFinite(pages) && size, `${pdfPath}: pdfinfo did not expose pages and page size`);
  return { pages, widthPoints: Number(size[1]), heightPoints: Number(size[2]) };
}

function missingTokens(expected, actual) {
  const missing = [];
  for (const [token, count] of expected) {
    const deficit = count - (actual.get(token) ?? 0);
    if (deficit > 0) missing.push({ token, count: deficit });
  }
  return missing;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

function pdfWords(pdfPath) {
  const xml = execFileSync('pdftotext', ['-bbox-layout', pdfPath, '-'], { encoding: 'utf8' });
  const words = [];
  const pages = /<page\b[^>]*>([\s\S]*?)<\/page>/gu;
  let pageIndex = 0;
  let pageMatch;
  while ((pageMatch = pages.exec(xml))) {
    const body = pageMatch[1];
    const wordPattern = /<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gu;
    let wordMatch;
    while ((wordMatch = wordPattern.exec(body))) {
      words.push({
        page: pageIndex,
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        text: decodeXml(wordMatch[5].replace(/<[^>]+>/gu, '')),
      });
    }
    pageIndex += 1;
  }
  return words;
}

function lineBoxParity(plan, pdfPath) {
  const pointsToMm = 25.4 / 72;
  const toleranceMm = config.pdf_parity.points_tolerance * pointsToMm;
  const lineBoxes = plan.lines.map((line) => ({
    page: line.page,
    x0: line.x - toleranceMm,
    y0: line.y - toleranceMm,
    x1: line.x + line.width + toleranceMm,
    y1: line.y + line.height + toleranceMm,
    remaining: tokenCounts(line.text),
  }));
  const words = pdfWords(pdfPath);
  let matched = 0;
  const errors = [];
  for (const word of words) {
    const token = normalizeToken(word.text);
    if (!token) continue;
    const x0 = word.xMin * pointsToMm;
    const y0 = word.yMin * pointsToMm;
    const x1 = word.xMax * pointsToMm;
    const y1 = word.yMax * pointsToMm;
    const candidates = lineBoxes.filter((line) => line.page === word.page
      && x0 >= line.x0 && x1 <= line.x1 && y0 >= line.y0 && y1 <= line.y1
      && (line.remaining.get(token) ?? 0) > 0);
    if (!candidates.length) continue;
    candidates.sort((first, second) => (first.y1 - first.y0) - (second.y1 - second.y0));
    const line = candidates[0];
    line.remaining.set(token, line.remaining.get(token) - 1);
    matched += 1;
  }
  const missing = [];
  for (const line of lineBoxes) {
    for (const [token, count] of line.remaining) {
      if (count > 0) missing.push({ page: line.page + 1, token, count });
    }
  }
  if (missing.length) errors.push({ code: 'PDF_LINE_TEXT_MISSING', missing: missing.slice(0, 20), missingCount: missing.length });
  return { expectedWords: lineBoxes.reduce((sum, line) => sum + [...line.remaining.values()].reduce((lineSum, count) => lineSum + count, 0), 0) + matched, matchedWords: matched, missingCount: missing.length, errors };
}

function checkPlan(directory) {
  const plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
  const sourcePath = join(directory, 'source.json');
  let source;
  try {
    source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  } catch {
    return { fixture: plan.fixture, status: plan.status, artifact: 'missing-source', errors: [{ code: 'SOURCE_SNAPSHOT_MISSING' }] };
  }
  if (source.fixture !== plan.fixture) {
    return { fixture: plan.fixture, status: plan.status, artifact: 'source-fixture-mismatch', errors: [{ code: 'SOURCE_FIXTURE_MISMATCH', sourceFixture: source.fixture }] };
  }
  const pdf = readdirSync(directory).find((name) => name.endsWith('.pdf'));
  if (plan.status === 'rejected') {
    return {
      fixture: plan.fixture,
      status: plan.status,
      artifact: pdf ? 'unexpected-pdf' : 'none',
      errors: pdf ? [{ code: 'REJECTED_PDF_PRESENT', pdf }] : [],
    };
  }
  const errors = [];
  if (!pdf) return { fixture: plan.fixture, status: plan.status, artifact: 'missing-pdf', errors: [{ code: 'ACCEPTED_PDF_MISSING' }] };
  const pdfPath = join(directory, pdf);
  const info = pdfInfo(pdfPath);
  const pageSize = plan.pageSize ?? config.page;
  const expectedWidthPoints = pageSize.width_mm * 72 / 25.4;
  const expectedHeightPoints = pageSize.height_mm * 72 / 25.4;
  const tolerance = config.pdf_parity.points_tolerance;
  if (info.pages !== plan.pages.length) errors.push({ code: 'PDF_PAGE_COUNT_MISMATCH', expected: plan.pages.length, actual: info.pages });
  if (Math.abs(info.widthPoints - expectedWidthPoints) > tolerance || Math.abs(info.heightPoints - expectedHeightPoints) > tolerance) {
    errors.push({ code: 'PDF_PAGE_SIZE_MISMATCH', expected: { widthPoints: expectedWidthPoints, heightPoints: expectedHeightPoints }, actual: info });
  }
  const text = execFileSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8' });
  const expected = tokenCounts([
    source.title,
    source.intro,
    ...(source.blocks ?? []).map((block) => block.text),
  ].join(' '));
  const sourceTokenCount = [...expected.values()].reduce((sum, count) => sum + count, 0);
  if (sourceTokenCount === 0) errors.push({ code: 'SOURCE_SNAPSHOT_EMPTY' });
  const missing = missingTokens(expected, tokenCounts(text));
  if (missing.length) errors.push({ code: 'PDF_TEXT_LAYER_INCOMPLETE', missing: missing.slice(0, 20), missingCount: missing.length });
  const lineParity = lineBoxParity(plan, pdfPath);
  errors.push(...lineParity.errors);
  return {
    fixture: plan.fixture,
    status: plan.status,
    artifact: pdf,
    pdf: info,
    sourceTokenCount,
    missingTokenKinds: missing.length,
    lineParity,
    errors,
  };
}

function main() {
  mkdirSync(outputRoot, { recursive: true });
  const fixtures = planDirectories().map(checkPlan).sort((a, b) => a.fixture.localeCompare(b.fixture));
  assert(fixtures.length > 0, `No plan.json files found in ${inputRoot}`);
  const report = {
    status: fixtures.some((fixture) => fixture.errors.length) ? 'failed' : 'passed',
    inputRoot,
    fixtures,
  };
  writeFileSync(join(outputRoot, 'pdf-parity-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, fixtures: fixtures.length, errors: fixtures.reduce((sum, fixture) => sum + fixture.errors.length, 0), report: join(outputRoot, 'pdf-parity-report.json') }, null, 2));
  if (report.status !== 'passed') process.exitCode = 1;
}

main();
