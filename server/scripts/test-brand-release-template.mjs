#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-brand-release-template-'));
const bundle = join(temporary, 'brand-context.cjs');
const build = runProcess('npx', [
  'esbuild',
  'src/brand-context.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`brand context test bundle failed: ${build.stderr || build.stdout}`);

try {
  const brandRoot = join(temporary, 'brands');
  const releaseRoot = join(brandRoot, 'demo', 'releases', 'release-1');
  await mkdir(join(releaseRoot, 'templates', 'pages'), { recursive: true });
  await mkdir(join(brandRoot, 'demo'), { recursive: true });
  await writeFile(join(brandRoot, 'demo', '_brand.yml'), 'schema_version: 1\nmeta:\n  name: Demo\n');
  await writeFile(join(brandRoot, 'demo', 'active.json'), JSON.stringify({ release: 'release-1' }));
  await writeFile(join(releaseRoot, 'templates', 'pages', 'editorial.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'pages/editorial',
    kind: 'page',
    surface: 'pdf-a4',
    archetype: 'narrative',
    canvas: { width: 1, height: 1, direction: 'ltr' },
    regions: { content: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
    slots: {
      intro: {
        id: 'intro',
        kind: 'text',
        frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        allowedBlockKinds: ['paragraph'],
        grow: { axis: 'y', maxHeight: 0.3, pushes: ['content'] },
      },
      content: {
        id: 'content',
        kind: 'text',
        frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
      },
      footer: {
        id: 'footer',
        kind: 'text',
        frame: { x: 0.1, y: 0.92, width: 0.8, height: 0.04 },
        role: 'footer',
      },
    },
    flows: {
      main: { id: 'main', slots: ['intro'], continuationSlots: ['content'], continuation: 'allowed' },
      footer: { id: 'footer', slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' },
    },
    constraints: { insideCanvas: true, noOverlap: false },
    page: {
      width: 210,
      height: 297,
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      columns: { count: 1, gutter: 0, widths: [174] },
      reservedBands: { footer: { x: 0, y: 0.94, width: 1, height: 0.06 } },
      flowObstacles: [],
      blockFrames: { intro: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, content: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 } },
      blockGrowth: { intro: { axis: 'y', maxHeight: 0.3, pushes: ['content'] } },
      flow: { align: 'left', hyphenate: false, lead: 'intro' },
    },
  }, null, 2));

  const { inspectBrandTemplate } = await import(bundle);
  const inspected = await inspectBrandTemplate(brandRoot, 'brand://demo/primary', 'pages/editorial');
  assert.equal(inspected.compiled.flows.main.continuationSlots?.[0], 'content');
  assert.deepEqual(inspected.compiled.slots.intro.allowedBlockKinds, ['paragraph']);
  assert.deepEqual(inspected.compiled.slots.intro.grow, { axis: 'y', maxHeight: 0.3, pushes: ['content'] });
  assert.deepEqual(inspected.compiled.page?.blockGrowth.intro, { axis: 'y', maxHeight: 0.3, pushes: ['content'] });
  assert.equal(inspected.compiled.page?.flow.lead, 'intro');
  console.log(JSON.stringify({ status: 'passed', template: inspected.templateRef, sourcePath: inspected.sourcePath }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
