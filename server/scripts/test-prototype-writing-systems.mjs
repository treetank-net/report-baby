#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — unsupported writing systems must fail closed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-writing-systems-prototype');
const renderRoot = join(outputRoot, 'rendered');
const cases = [
  { key: 'unsupportedArabicBidi', fixture: 'unsupported-arabic-bidi', direction: 'rtl', writingMode: 'horizontal-tb', script: 'Arab' },
  { key: 'unsupportedCjkVertical', fixture: 'unsupported-cjk-vertical', direction: 'ltr', writingMode: 'vertical-rl', script: 'Jpan' },
  { key: 'unsupportedVerticalLr', fixture: 'unsupported-vertical-lr', direction: 'ltr', writingMode: 'vertical-lr', script: 'Latn' },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function planFor(key) {
  return JSON.parse(readFileSync(join(renderRoot, key, 'plan.json'), 'utf8'));
}

function main() {
  mkdirSync(outputRoot, { recursive: true });
  execFileSync(process.execPath, [join(root, 'scripts', 'prototype-composition-kernel.mjs'), '--case', cases.map((item) => item.key).join(','), '--out', renderRoot], { stdio: 'inherit' });
  const results = cases.map((item) => {
    const plan = planFor(item.key);
    const violation = plan.evaluation.violations.find((candidate) => candidate.code === 'UNSUPPORTED_WRITING_SYSTEM');
    const files = readdirSync(join(renderRoot, item.key));
    assert(plan.status === 'rejected', `${item.fixture}: expected rejected, got ${plan.status}`);
    assert(violation, `${item.fixture}: missing UNSUPPORTED_WRITING_SYSTEM`);
    assert(violation.direction === item.direction, `${item.fixture}: direction mismatch`);
    assert(violation.writingMode === item.writingMode, `${item.fixture}: writing mode mismatch`);
    assert(violation.script === item.script, `${item.fixture}: script mismatch`);
    assert(!files.some((file) => file.endsWith('.pdf') || /^page-\d+\.png$/u.test(file)), `${item.fixture}: rejected writing system produced an artifact`);
    return { fixture: item.fixture, status: plan.status, violation: violation.code, writing: plan.source.writing, artifact: 'none' };
  });
  const report = { status: 'passed', cases: results };
  writeFileSync(join(outputRoot, 'writing-systems-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, cases: results.length, report: join(outputRoot, 'writing-systems-report.json') }, null, 2));
}

main();
