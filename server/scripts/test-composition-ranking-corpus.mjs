#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { rankingFixtureBuilders } from './lib/composition-ranking-fixtures.mjs';

const corpusPath = join(process.cwd(), 'scripts/fixtures/composition-ranking-corpus.yml');
const corpus = parse(await readFile(corpusPath, 'utf8'));
assert.ok(Array.isArray(corpus) && corpus.length >= 4, 'ranking corpus must contain the reviewed calibration families');
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-ranking-corpus-'));
const bundlePath = join(temporary, 'composition.cjs');
await build({ entryPoints: [join(process.cwd(), 'src/composition/index.ts')], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: bundlePath });
const composition = await import(bundlePath);
const { compareCompositionEvaluations, evaluateCompositionPlan } = composition;
const builders = rankingFixtureBuilders();
const document = { flows: { main: { id: 'main', continuation: 'forbidden', blocks: [] } } };
const evaluated = new Map();
for (const entry of corpus) {
  assert.match(entry.id, /^[a-z0-9-]+$/u);
  assert.equal(entry.variants.length, entry.legal.length, `${entry.id}: each variant needs a legality expectation`);
  assert.ok(entry.order.every((variant) => entry.variants.includes(variant)), `${entry.id}: order must reference declared variants`);
  const legalVariants = entry.variants.filter((_variant, index) => entry.legal[index]);
  assert.deepEqual(new Set(entry.order), new Set(legalVariants), `${entry.id}: illegal candidates cannot appear in the approved order`);
  assert.ok(entry.reasons.length > 0, `${entry.id}: reviewed ranking needs explicit quality reasons`);
  const builder = builders[entry.fixture];
  assert.equal(typeof builder, 'function', `${entry.id}: fixture builder must exist`);
  const variants = builder();
  const evaluations = entry.variants.map((variant, index) => {
    const plan = variants[variant];
    assert.ok(plan, `${entry.id}: fixture is missing variant '${variant}'`);
    const evaluation = evaluateCompositionPlan(document, plan);
    if (!entry.legal[index]) assert.equal(evaluation.status, 'rejected', `${entry.id}/${variant}: illegal fixture must be rejected`);
    if (entry.legal[index]) assert.notEqual(evaluation.status, 'rejected', `${entry.id}/${variant}: legal fixture must be accepted`);
    evaluated.set(`${entry.id}/${variant}`, evaluation);
    return evaluation;
  });
  for (let index = 0; index < entry.order.length - 1; index += 1) {
    const left = evaluated.get(`${entry.id}/${entry.order[index]}`);
    const right = evaluated.get(`${entry.id}/${entry.order[index + 1]}`);
    assert.ok(compareCompositionEvaluations(left, right) <= 0, `${entry.id}: approved order is not produced by the evaluator`);
  }
}
await rm(temporary, { recursive: true, force: true });
console.log(JSON.stringify({ status: 'passed', cases: corpus.length, variants: corpus.reduce((sum, entry) => sum + entry.variants.length, 0) }, null, 2));
