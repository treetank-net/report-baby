#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bundle from '../example-bundle.cjs';
import { brandContractDeck } from './lib/fixtures.mjs';

const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-manifest-'));
const inputPath = join(outputDir, 'deck.json');
const renderDir = join(outputDir, 'rendered');
await writeFile(inputPath, `${JSON.stringify(brandContractDeck(), null, 2)}\n`);

try {
  await bundle.runExampleCli([
    '--kind', 'deck',
    '--brand-root', '../examples/brand-showcase/brands',
    '--brand', 'brand://orbit/primary',
    '--input', inputPath,
    '--out', renderDir,
    '--formats', 'png,pptx',
  ]);

  const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.kind, 'deck');
  assert.equal(manifest.slidePlans.length, 2);
  assert.doesNotThrow(() => bundle.validateRenderManifest(manifest));

  const drifted = { ...manifest, slidePlans: manifest.slidePlans.map((plan) => ({ ...plan, slotBoxes: undefined })) };
  assert.throws(() => bundle.validateRenderManifest(drifted), /slotBoxes/);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log('manifest contract: rendered manifest validates and drift is rejected');
