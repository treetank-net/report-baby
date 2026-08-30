#!/usr/bin/env node

// PROTOTYPE — replay the existing Report Baby synthetic report corpus through
// the composition kernel and leave all PDFs/PNGs/plans available for review.

import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-report-baby-adapter-v1');
const fixtureDir = join(outputDir, 'fixture-source');
const renderedDir = join(outputDir, 'rendered');
const fixturePath = join(fixtureDir, 'fixtures.json');
const brandRef = process.argv.includes('--brand-ref')
  ? process.argv[process.argv.indexOf('--brand-ref') + 1]
  : 'brand://flux/editorial';
const adapter = join(root, 'scripts', 'prototype-report-baby-adapter.mjs');
const kernel = join(root, 'scripts', 'prototype-composition-kernel.mjs');

await mkdir(outputDir, { recursive: true });
await execFileAsync(process.execPath, [adapter, '--out', fixtureDir], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
await execFileAsync(process.execPath, [kernel, '--fixture-json', fixturePath, '--brand-ref', brandRef, '--out', renderedDir], { cwd: root, maxBuffer: 8 * 1024 * 1024 });

const catalog = JSON.parse(await readFile(fixturePath, 'utf8'));
const reports = JSON.parse(await readFile(join(renderedDir, 'report.json'), 'utf8'));
const byId = new Map(reports.map((report) => [report.fixture, report]));
const checks = [];

function check(id, description, condition) {
  assert.ok(condition, `${id}: ${description}`);
  checks.push({ id, description, status: 'pass' });
}

check('catalog', 'contains the existing Report Baby fixture families', catalog.fixtures.length >= 18);
check('catalog', 'carries real product fixture names', catalog.fixtures.every((fixture) => fixture.source?.productFixture));
check('catalog', 'carries brand references as input metadata', catalog.fixtures.every((fixture) => fixture.brand?.refs?.length === catalog.brandRefs.length));
check('render', 'every adapted fixture is accepted by the composition kernel', reports.every((report) => report.status !== 'rejected'));
check('render', 'every adapted fixture has a PDF artifact', reports.every((report) => typeof report.output === 'string' && report.output.endsWith('.pdf')));

for (const fixture of catalog.fixtures) {
  const report = byId.get(fixture.id);
  check(fixture.id, 'has a kernel report', Boolean(report));
  const plan = JSON.parse(await readFile(join(renderedDir, fixture.id, 'plan.json'), 'utf8'));
  const outcome = JSON.parse(await readFile(join(renderedDir, fixture.id, 'outcome.json'), 'utf8'));
  const plannedBlocks = new Set(plan.lines.map((line) => line.blockId));
  const authoredBlocks = fixture.blocks.filter((block) => block.text?.trim());
  check(fixture.id, 'keeps the product fixture identity in the plan', plan.source?.product?.productFixture === fixture.source.productFixture);
  check(fixture.id, 'keeps brand metadata at the composition boundary', plan.source?.brand?.refs?.length === catalog.brandRefs.length);
  check(fixture.id, 'places every authored text block', authoredBlocks.every((block) => plannedBlocks.has(block.id)));
  check(fixture.id, 'has no hard evaluator violations', report.status !== 'rejected' && plan.violations.length === 0);
  check(fixture.id, 'records renderer font metrics', plan.renderer?.fontRegularLoaded && plan.renderer?.fontBoldLoaded && plan.renderer?.fontFamily);
  await access(join(renderedDir, fixture.id, `${fixture.id}.pdf`));
  await access(join(renderedDir, fixture.id, 'page-1.png'));
}

const multipage = byId.get('report-baby-multipage');
check('multipage', 'keeps continuation pages', multipage.pages >= 2);

const blockImagePlan = JSON.parse(await readFile(join(renderedDir, 'report-baby-inline-image-block', 'plan.json'), 'utf8'));
check('block-image', 'places the image exactly once', blockImagePlan.images.length === 1);
check('block-image', 'preserves the authored asset source', blockImagePlan.images[0]?.source === 'assets/map.png');

const floatImagePlan = JSON.parse(await readFile(join(renderedDir, 'report-baby-inline-image-float', 'plan.json'), 'utf8'));
const floatImage = floatImagePlan.images[0];
const leadTrackWidth = floatImagePlan.pages[0].article.tracks[floatImage.track].width;
check('float-image', 'places the image exactly once', floatImagePlan.images.length === 1);
check('float-image', 'reduces line measure beside the image', floatImagePlan.lines.some((line) => line.y >= floatImage.y && line.y <= floatImage.y + floatImage.height && line.width < leadTrackWidth));
check('float-image', 'does not produce a text/image violation', floatImagePlan.violations.length === 0);

const absoluteImagePlan = JSON.parse(await readFile(join(renderedDir, 'report-baby-absolute-image', 'plan.json'), 'utf8'));
check('absolute-image', 'preserves the page-relative frame', absoluteImagePlan.images[0]?.position?.reference === 'page' && absoluteImagePlan.images[0]?.x === 104 && absoluteImagePlan.images[0]?.y === 82);
check('absolute-image', 'records a placement decision', absoluteImagePlan.decisions.some((decision) => decision.code === 'IMAGE_ABSOLUTE_PLACED'));

const report = {
  status: 'passed',
  brandRef,
  fixtureCount: catalog.fixtures.length,
  checkCount: checks.length,
  reports: reports.map((item) => ({ fixture: item.fixture, status: item.status, pages: item.pages, lines: item.lines, images: item.images, decisions: item.decisions, diagnostics: item.diagnostics, violations: item.violations })),
  capabilities: {
    reportBabyFixtureInput: true,
    multipageContinuation: true,
    blockImagePlacement: true,
    floatImagePlacement: true,
    brandMetadataTransported: true,
    brandFontMetricsApplied: true,
    brandThemeApplied: false,
    realAssetBytesLoaded: false,
    tablesKeptAtomic: true,
    inlineStyledRunsPreserved: false,
  },
  artifacts: { fixturePath, renderedDir },
  checks,
};
await writeFile(join(outputDir, 'report-baby-adapter-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
