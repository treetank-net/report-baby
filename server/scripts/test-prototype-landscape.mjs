#!/usr/bin/env node

// PROTOTYPE — landscape 1600x900 smoke corpus.
// This checks that page geometry, multi-column flow, short-section keeps and
// multi-page continuation survive outside the A4 portrait preset.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-landscape-1600x900');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const pixelQa = join(root, 'scripts', 'test-prototype-pixel-qa.mjs');
const cases = ['short', 'triangleWrap', 'multiShapeCollage', 'landscapeThreePages', 'landscapeShortSections', 'landscapeTitleParagraphs'];
const renderRoot = join(outputRoot, 'rendered');
const pixelRoot = join(outputRoot, 'pixel-qa');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args) {
  execFileSync(process.execPath, [command, ...args], { stdio: 'ignore', timeout: 120000 });
}

function pngDimensions(path) {
  const buffer = readFileSync(path);
  assert(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${path}: not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertNoStrandedHeadings(path) {
  const plan = JSON.parse(readFileSync(path, 'utf8'));
  for (const keep of plan.source.keeps ?? []) {
    if (keep.strength !== 'required') continue;
    const subjectLines = plan.lines.filter((line) => line.blockId === keep.subject);
    const companionLines = plan.lines.filter((line) => line.blockId === keep.companion);
    if (!subjectLines.length || !companionLines.length) continue;
    const first = subjectLines[0];
    const required = keep.whole ? companionLines : companionLines.slice(0, keep.lines ?? 1);
    const sameFragment = required.every((line) => line.page === first.page && line.region === first.region && line.track === first.track);
    assert(sameFragment, `${plan.fixture}: stranded keep ${keep.id}`);
  }
}

function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  run(generator, ['--preset', 'landscape-1600x900', '--case', cases.join(','), '--out', renderRoot]);
  const renderReport = JSON.parse(readFileSync(join(renderRoot, 'report.json'), 'utf8'));
  assert(renderReport.length === cases.length, `Expected ${cases.length} landscape cases, got ${renderReport.length}`);
  const threePages = renderReport.find((entry) => entry.fixture === 'landscape-three-pages');
  assert(threePages.pages >= 3, `Expected at least three landscape pages, got ${threePages.pages}`);
  for (const [index, entry] of renderReport.entries()) {
    if (entry.status === 'rejected') fail(`Unexpected landscape rejection: ${entry.fixture}`);
    const firstPng = join(renderRoot, cases[index], 'page-1.png');
    const dimensions = pngDimensions(firstPng);
    assert(dimensions.width === 1600 && dimensions.height === 900, `${entry.fixture}: expected 1600x900 PNG, got ${dimensions.width}x${dimensions.height}`);
    const planPath = join(renderRoot, cases[index], 'plan.json');
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    if (plan.qa?.noStrandedHeadings) assertNoStrandedHeadings(planPath);
  }
  run(pixelQa, ['--root', renderRoot, '--out', pixelRoot]);
  const pixelReport = JSON.parse(readFileSync(join(pixelRoot, 'pixel-qa-report.json'), 'utf8'));
  assert(pixelReport.status === 'passed', `Landscape pixel QA failed: ${JSON.stringify(pixelReport.fixtures.filter((fixture) => fixture.errors.length))}`);
  const result = {
    status: 'passed',
    preset: 'landscape-1600x900',
    cases: cases.length,
    threePageFixture: { fixture: threePages.fixture, pages: threePages.pages },
    renderReport: join(renderRoot, 'report.json'),
    pixelReport: join(pixelRoot, 'pixel-qa-report.json'),
  };
  writeFileSync(join(outputRoot, 'landscape-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main();
