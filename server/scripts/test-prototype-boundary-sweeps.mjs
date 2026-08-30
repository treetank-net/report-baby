#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — exact line-capacity sweep.
// Each profile receives the same fixed-width text and the same four local
// capacities. The outer assertions do not use the planner's diagnostics as an
// oracle: they inspect the persisted line locations and keep cluster directly.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-boundary-sweep');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const pixelQa = join(root, 'scripts', 'test-prototype-pixel-qa.mjs');
const manifest = parse(readFileSync(join(root, 'templates', 'composition-qa-manifest.yml'), 'utf8')).families.boundary_sweep;
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

function planFor(profile, state) {
  return JSON.parse(readFileSync(join(renderRoot, `boundary-${profile}-${state}`, 'plan.json'), 'utf8'));
}

function sameFragment(first, second) {
  return first && second && first.page === second.page && first.region === second.region && first.track === second.track;
}

function checkCase(profile, state, expectedMiddleFillerLines) {
  const plan = planFor(profile, state);
  const prefix = `boundary-${profile}-${state}`;
  const heading = plan.lines.find((line) => line.blockId === `${prefix}-heading`);
  const body = plan.lines.filter((line) => line.blockId === `${prefix}-body`).sort((a, b) => a.startWord - b.startWord);
  const fillerInMiddle = plan.lines.filter((line) => line.blockId === `${prefix}-filler` && line.track === 'middle');
  assert(heading, `${prefix}: heading is missing`);
  assert(body.length >= 2, `${prefix}: body does not have two lines to keep`);
  assert(fillerInMiddle.length === expectedMiddleFillerLines, `${prefix}: expected ${expectedMiddleFillerLines} filler lines in middle, got ${fillerInMiddle.length}`);
  const kept = sameFragment(heading, body[0]) && sameFragment(heading, body[1]);
  assert(kept === manifest.expected_keep[state], `${prefix}: expected keep=${manifest.expected_keep[state]}, got ${kept}`);
  assert(heading.track === manifest.expected_heading_tracks[state], `${prefix}: expected heading in ${manifest.expected_heading_tracks[state]}, got ${heading.track}`);
  const expectedRejected = manifest.expected_rejected.includes(plan.fixture);
  const expectedWarning = manifest.expected_warnings?.includes(plan.fixture) ?? false;
  if (expectedRejected) {
    assert(plan.status === 'rejected', `${prefix}: expected explicit rejection`);
    assert(plan.evaluation.violations.some((violation) => violation.code === 'UNDERFILL_PROTECTED_BREAK'), `${prefix}: rejection lost underfill cause`);
  } else if (expectedWarning) {
    assert(plan.status === 'accepted-with-warnings', `${prefix}: expected a PDF with warnings, got ${plan.status}`);
    assert(plan.outcome?.warnings?.some((warning) => warning.code === 'UNDERFILL_PROTECTED_BREAK'), `${prefix}: warning lost underfill cause`);
  } else {
    assert(plan.status !== 'rejected', `${prefix}: unexpected rejection ${JSON.stringify(plan.evaluation.violations)}`);
  }
  return {
    fixture: plan.fixture,
    profile,
    state,
    middleFillerLines: fillerInMiddle.length,
    headingFragment: `${heading.page}:${heading.region}:${heading.track}`,
    firstBodyFragment: `${body[0].page}:${body[0].region}:${body[0].track}`,
    kept,
    decisions: plan.decisions.map((decision) => decision.code),
  };
}

function main() {
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  run(generator, ['--preset', 'landscape-1600x900', '--case', 'boundary', '--out', renderRoot]);
  const renderReport = JSON.parse(readFileSync(join(renderRoot, 'report.json'), 'utf8'));
  assert(renderReport.length === manifest.expected_count, `Expected ${manifest.expected_count} boundary cases, got ${renderReport.length}`);
  const results = [];
  for (const profile of manifest.expected_profiles) {
    for (const [index, state] of manifest.expected_states.entries()) {
      results.push(checkCase(profile, state, manifest.expected_middle_filler_lines[index]));
    }
  }
  run(pixelQa, ['--root', renderRoot, '--out', pixelRoot, '--skip-mutation']);
  const pixelReport = JSON.parse(readFileSync(join(pixelRoot, 'pixel-qa-report.json'), 'utf8'));
  assert(pixelReport.status === 'passed', `Boundary pixel QA failed: ${JSON.stringify(pixelReport)}`);
  const report = {
    status: 'passed',
    cases: results.length,
    profiles: manifest.expected_profiles,
    states: manifest.expected_states,
    results,
    renderReport: join(renderRoot, 'report.json'),
    pixelReport: join(pixelRoot, 'pixel-qa-report.json'),
  };
  writeFileSync(join(outputRoot, 'boundary-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: report.cases, renderReport: report.renderReport, pixelReport: report.pixelReport }, null, 2));
}

main();
