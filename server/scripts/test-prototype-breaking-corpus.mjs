#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — breaking-policy matrix.
// The corpus exercises profile selection, widows/orphans, underfill
// diagnostics, explicit keep clusters and image-aware continuation. PNGs are
// generated for every accepted case; the independent pixel pass is the final
// geometry gate.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-breaking-policy-corpus');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const pixelQa = join(root, 'scripts', 'test-prototype-pixel-qa.mjs');
const manifest = parse(readFileSync(join(root, 'templates', 'composition-qa-manifest.yml'), 'utf8')).families.breaking;
const renderRoot = join(outputRoot, 'rendered');
const pixelRoot = join(outputRoot, 'pixel-qa');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args) {
  execFileSync(process.execPath, [command, ...args], { stdio: 'ignore', timeout: 240000 });
}

function readPlan(fixture) {
  for (const entry of readdirSync(renderRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(renderRoot, entry.name);
    try {
      const plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
      if (plan.fixture === fixture) return { plan, directory };
    } catch {
      // The report is authoritative; unrelated directory contents are ignored.
    }
  }
  fail(`Missing plan for ${fixture}`);
}

function pngDimensions(path) {
  const buffer = readFileSync(path);
  assert(buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', `${path}: not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkCase(plan, entry, directory, expectedRejected, expectedWarning) {
  const qa = plan.qa ?? {};
  assert(plan.source.policy?.profile === qa.profile, `${entry.fixture}: profile was not carried into the plan`);
  const diagnostics = new Set(plan.diagnostics.map((diagnostic) => diagnostic.code));
  if (qa.expectsUnderfillDiagnostic) {
    assert(diagnostics.has('UNDERFILL_PROTECTED_BREAK'), `${entry.fixture}: expected underfill diagnostic`);
  }
  if (qa.expectsSingleLineDiagnostic) {
    assert(diagnostics.has('SINGLE_LINE_CONTINUATION'), `${entry.fixture}: expected single-line diagnostic`);
  }
  if (qa.avoidSingleLineContinuation) {
    assert(!diagnostics.has('SINGLE_LINE_CONTINUATION'), `${entry.fixture}: editorial profile accepted a single-line continuation`);
  }
  if (expectedRejected) {
    assert(plan.status === 'rejected', `${entry.fixture}: strict profile should reject protected underfill`);
    assert(plan.evaluation.violations.some((violation) => violation.code === 'UNDERFILL_PROTECTED_BREAK'), `${entry.fixture}: strict rejection lost its unsatisfied core`);
  } else if (expectedWarning) {
    assert(plan.status === 'accepted-with-warnings', `${entry.fixture}: expected a PDF with warnings, got ${plan.status}`);
    assert(plan.outcome?.warnings?.some((warning) => warning.code === 'UNDERFILL_PROTECTED_BREAK'), `${entry.fixture}: warning lost its underfill cause`);
  } else {
    assert(plan.status !== 'rejected', `${entry.fixture}: unexpected rejection ${JSON.stringify(plan.evaluation.violations)}`);
  }
  if (qa.length === 'long') assert(plan.pages.length >= 2, `${entry.fixture}: long case did not continue to another page`);
  if (plan.status !== 'rejected') {
    if (plan.status === 'accepted-with-warnings') assert(plan.outcome?.warnings?.length > 0, `${entry.fixture}: warning status has no warning details`);
    else assert(plan.evaluation.violations.length === 0, `${entry.fixture}: accepted plan has violations`);
    for (const image of plan.images) {
      assert(plan.images.filter((candidate) => candidate.id === image.id).length === 1, `${entry.fixture}: image placement is not unique`);
    }
    const firstPage = join(directory, 'page-1.png');
    const dimensions = pngDimensions(firstPage);
    assert(dimensions.width === 1600 && dimensions.height === 900, `${entry.fixture}: expected 1600x900, got ${dimensions.width}x${dimensions.height}`);
  }
}

function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  run(generator, ['--preset', 'landscape-1600x900', '--case', 'breaking', '--out', renderRoot]);
  const renderReport = JSON.parse(readFileSync(join(renderRoot, 'report.json'), 'utf8'));
  assert(renderReport.length === manifest.expected_count, `Expected ${manifest.expected_count} breaking-policy cases, got ${renderReport.length}`);
  const expectedRejected = new Set(manifest.expected_rejected);
  const expectedWarnings = new Set(manifest.expected_warnings ?? []);
  const expectedPatterns = manifest.fixture_patterns.map((pattern) => new RegExp(pattern, 'u'));
  for (const entry of renderReport) {
    assert(expectedPatterns.some((pattern) => pattern.test(entry.fixture)), `Fixture is missing from independent manifest: ${entry.fixture}`);
  }
  assert(
    renderReport.filter((entry) => entry.status === 'rejected').map((entry) => entry.fixture).sort().join('|')
      === [...expectedRejected].sort().join('|'),
    `Unexpected breaking-policy rejection set: ${JSON.stringify(renderReport.filter((entry) => entry.status === 'rejected').map((entry) => entry.fixture))}`,
  );
  assert(
    renderReport.filter((entry) => entry.status === 'accepted-with-warnings').map((entry) => entry.fixture).sort().join('|')
      === [...expectedWarnings].sort().join('|'),
    `Unexpected breaking-policy warning set: ${JSON.stringify(renderReport.filter((entry) => entry.status === 'accepted-with-warnings').map((entry) => entry.fixture))}`,
  );
  for (const entry of renderReport) {
    const located = readPlan(entry.fixture);
    checkCase(located.plan, entry, located.directory, expectedRejected.has(entry.fixture), expectedWarnings.has(entry.fixture));
  }
  run(pixelQa, ['--root', renderRoot, '--out', pixelRoot]);
  const pixelReport = JSON.parse(readFileSync(join(pixelRoot, 'pixel-qa-report.json'), 'utf8'));
  assert(pixelReport.status === 'passed', `Breaking-policy pixel QA failed: ${JSON.stringify(pixelReport)}`);
  const result = {
    status: 'passed',
    cases: renderReport.length,
    accepted: renderReport.filter((entry) => entry.status !== 'rejected').length,
    rejected: [...expectedRejected],
    warnings: [...expectedWarnings],
    profiles: [...new Set(renderReport.map((entry) => readPlan(entry.fixture).plan.qa?.profile))],
    renderReport: join(renderRoot, 'report.json'),
    pixelReport: join(pixelRoot, 'pixel-qa-report.json'),
  };
  writeFileSync(join(outputRoot, 'breaking-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main();
