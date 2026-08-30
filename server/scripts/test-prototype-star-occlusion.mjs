#!/usr/bin/env node

// PROTOTYPE — twenty-star occlusion corpus.
// The corpus is intentionally separate from the general composition contract:
// it checks z-order, touching boundaries, unioned barriers, pagination and
// known cross-column limitations as rendered PNG artifacts.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-star-occlusion-corpus');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const pixelQa = join(root, 'scripts', 'test-prototype-pixel-qa.mjs');
const manifest = parse(readFileSync(join(root, 'templates', 'composition-qa-manifest.yml'), 'utf8')).families.star_occlusion;
const cases = manifest.generator_cases;
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

function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  run(generator, ['--case', cases.join(','), '--out', renderRoot]);
  const renderReport = JSON.parse(readFileSync(join(renderRoot, 'report.json'), 'utf8'));
  assert(renderReport.length === manifest.expected_count, `Expected ${manifest.expected_count} rendered cases, got ${renderReport.length}`);
  const expectedFixtures = new Set(manifest.expected_fixtures);
  assert(renderReport.every((entry) => expectedFixtures.has(entry.fixture)), 'Rendered star fixture is missing from independent manifest');
  assert(renderReport.every((entry) => expectedFixtures.delete(entry.fixture)), 'Star manifest contains an unrendered fixture');
  assert(expectedFixtures.size === 0, `Star manifest has unrendered fixtures: ${JSON.stringify([...expectedFixtures])}`);
  const expectedRejected = new Set(manifest.expected_rejected);
  const actualRejected = renderReport.filter((entry) => entry.status === 'rejected').map((entry) => entry.fixture).sort();
  assert(actualRejected.join('|') === [...expectedRejected].sort().join('|'), `Unexpected star rejection set: ${JSON.stringify(actualRejected)}`);
  const accepted = renderReport.filter((entry) => !expectedRejected.has(entry.fixture));
  assert(accepted.every((entry) => entry.status !== 'rejected'), 'An unexpected star-occlusion case was rejected');
  const spanningPlan = JSON.parse(readFileSync(join(renderRoot, 'occlusion15', 'plan.json'), 'utf8'));
  assert(spanningPlan.images.every((image) => image.tracks.length === 2), 'star-spanning-columns: images lost their cross-column track ownership');
  assert(spanningPlan.lines.some((line) => line.track === 'secondary' && line.x > 99 && line.wrap?.imageIds?.length === 2), 'star-spanning-columns: planner did not use the right-side continuation space');
  assert(spanningPlan.evaluation.violations.length === 0, 'star-spanning-columns: accepted plan retains evaluator violations');

  run(pixelQa, ['--root', renderRoot, '--out', pixelRoot]);
  const pixelReport = JSON.parse(readFileSync(join(pixelRoot, 'pixel-qa-report.json'), 'utf8'));
  assert(pixelReport.status === 'passed', `Star occlusion pixel QA failed: ${JSON.stringify(pixelReport.fixtures.filter((fixture) => fixture.errors.length))}`);
  const result = {
    status: 'passed',
    cases: manifest.expected_count,
    accepted: accepted.length,
    knownFailures: [...expectedRejected],
    renderReport: join(renderRoot, 'report.json'),
    pixelReport: join(pixelRoot, 'pixel-qa-report.json'),
  };
  writeFileSync(join(outputRoot, 'occlusion-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main();
