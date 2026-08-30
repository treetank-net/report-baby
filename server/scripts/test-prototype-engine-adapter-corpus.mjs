#!/usr/bin/env node

// Replay the existing Report Baby adapter corpus through the semantic engine
// seam. The legacy kernel remains the parity oracle until its implementation
// is moved behind the seam.

import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFixture } from './prototype-composition-kernel.mjs';
import { documentFromLegacyFixture, planComposition, planCompositionContract } from './lib/composition-engine.mjs';

const execFileAsync = promisify(execFile);
const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const root = resolve(here, '..');
const outputDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join('/tmp', 'report-baby-composition-engine-adapter-corpus'));
const fixtureDir = join(outputDir, 'fixture-source');
const fixturePath = join(fixtureDir, 'fixtures.json');
const adapter = join(root, 'scripts', 'prototype-report-baby-adapter.mjs');

const metrics = {
  units: 'mm',
  family: 'adapter-corpus-metrics',
  measureText(text, styleName) {
    const glyphWidth = styleName === 'heading' ? 2.4 : styleName === 'intro' ? 2 : 1.5;
    return [...text].length * glyphWidth;
  },
  lineHeight(styleName) {
    return styleName === 'heading' ? 6 : styleName === 'intro' ? 5 : 4;
  },
};

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await execFileAsync(process.execPath, [adapter, '--out', fixtureDir], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
const catalog = JSON.parse(await readFile(fixturePath, 'utf8'));

let lineCount = 0;
for (const fixture of catalog.fixtures) {
  const legacyPlan = planFixture(fixture, metrics).plan;
  const semanticDocument = documentFromLegacyFixture(fixture);
  const adaptedPlan = planComposition(semanticDocument, metrics).plan;
  const contractResult = planCompositionContract(semanticDocument, metrics);
  assert.deepStrictEqual(adaptedPlan, legacyPlan, `${fixture.id}: semantic adapter changed the plan`);
  assert.equal(contractResult.plan.pages.length, legacyPlan.pages.length, `${fixture.id}: normalized plan changed page count`);
  assert.equal(contractResult.plan.lines.length, legacyPlan.lines.length, `${fixture.id}: normalized plan changed line count`);
  assert.ok(contractResult.plan.lines.every((line) => contractResult.plan.slots.some((slot) => slot.id === line.slotId)), `${fixture.id}: normalized line points to a missing slot`);
  assert.equal(contractResult.evaluation.status, legacyPlan.status === 'rejected' ? 'rejected' : legacyPlan.status === 'accepted-with-warnings' ? 'accepted-with-warnings' : 'accepted', `${fixture.id}: normalized status changed`);
  assert.equal(semanticDocument.flows.main.blocks.length, fixture.blocks.length, `${fixture.id}: main flow changed size`);
  assert.equal(semanticDocument.flows.sidebar.blocks.length, fixture.sidebar.length, `${fixture.id}: sidebar flow changed size`);
  lineCount += adaptedPlan.lines.length;
}

console.log(JSON.stringify({
  status: 'passed',
  fixtures: catalog.fixtures.length,
  lines: lineCount,
  oracle: 'legacy-kernel-plan',
}, null, 2));
