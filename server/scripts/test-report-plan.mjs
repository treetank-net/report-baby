import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-plan-'));
const bundle = join(temporary, 'report-plan.mjs');
const assertionsBundle = join(temporary, 'report-plan-assertions.mjs');
const build = runProcess('npx', ['esbuild', 'src/report-plan.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`report plan test bundle failed: ${build.stderr || build.stdout}`);
const assertionsBuild = runProcess('npx', ['esbuild', 'src/report-plan-assertions.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${assertionsBundle}`], { cwd: root, timeout: 30_000 });
if (assertionsBuild.status !== 0) throw new Error(`report plan assertions test bundle failed: ${assertionsBuild.stderr || assertionsBuild.stdout}`);

try {
  const { resolveReportPlan } = await import(bundle);
  const { assertReportPlan } = await import(assertionsBundle);
  const geometry = {
    width: 210,
    height: 297,
    margin: 18,
    margins: { top: 18, right: 17, bottom: 18, left: 17 },
    content: { x: 17, top: 18, width: 176, bottom: 279 },
    bands: {
      header: { x: 0, top: 0, width: 210, bottom: 53.46 },
      footer: { x: 0, top: 276.21, width: 210, bottom: 297 },
    },
    continuationTop: 43,
    continuationBottom: 276.21,
    segments: [
      { x: 17, top: 53.46, width: 85, bottom: 276.21 },
      { x: 108, top: 53.46, width: 85, bottom: 276.21 },
    ],
    blockFrames: {
      intro: { x: 17.01, top: 71.28, width: 175.98, bottom: 101 },
      narrative: { x: 17.01, top: 103.95, width: 175.98, bottom: 261.09 },
    },
    flow: { align: 'justify', hyphenate: true },
    dynamicFlow: true,
  };
  const theme = { minBodyPt: 8 };
  const plan = resolveReportPlan({
    templateRef: 'pages/editorial-two-column',
    theme,
    geometry,
    data: {
      title: 'Plan contract',
      intro: 'A lead paragraph.',
      sections: [{ heading: 'Body', body: 'Text.' }],
      table: { head: ['A'], body: [['1']] },
      highlights: ['One'],
    },
    pageCount: 2,
  });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.templateRef, 'pages/editorial-two-column');
  assert.ok(plan.pages.length >= 2, 'long-flow plans must expose continuation pages');
  const first = plan.pages[0];
  assert.deepEqual(first.blocks.filter((item) => !item.parentId).map((item) => item.id), ['header', 'footer', 'intro', 'flow']);
  assert.deepEqual(first.blocks.filter((item) => item.parentId === 'flow' && item.column !== undefined).map((item) => item.column), [1, 2]);
  assert.ok(first.blocks.some((item) => item.id === 'sections' && item.container), 'sections must be represented as a logical container');
  assert.ok(first.blocks.some((item) => item.id === 'table' && item.container), 'table must be represented as a logical container');
  assert.ok(first.blocks.some((item) => item.id === 'highlights' && item.container), 'highlights must be represented as a logical container');
  assert.ok(first.blocks.find((item) => item.id === 'footer'), 'footer must be a planned block');
  assertReportPlan(plan);
  for (const page of plan.pages) {
    for (const item of page.blocks) {
      assert.ok(item.box.x >= 0 && item.box.y >= 0, `${item.id} starts outside the page`);
      assert.ok(item.box.x + item.box.width <= page.width, `${item.id} exceeds page width`);
      assert.ok(item.box.y + item.box.height <= page.height, `${item.id} exceeds page height`);
    }
  }
  assert.throws(
    () => assertReportPlan({ ...plan, pages: [{ ...first, blocks: [...first.blocks, { id: 'broken', role: 'table', box: { x: 0, y: 0, width: 1, height: 1 } }] }] }),
    /blocks 'header' and 'broken' overlap/,
    'overlapping blocks must be rejected',
  );
  assert.throws(
    () => assertReportPlan({ ...plan, pages: [{ ...first, blocks: [...first.blocks, { id: 'outside', role: 'table', box: { x: 0, y: 0, width: first.width + 1, height: 1 } }] }] }),
    /block 'outside' leaves the page/,
    'out-of-page blocks must be rejected',
  );
  console.log(`report plan: ${plan.pages.length} page(s), ${first.blocks.length} first-page block(s)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
