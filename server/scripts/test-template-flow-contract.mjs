#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-template-flow-'));
const bundle = join(temporary, 'template-contract.cjs');
const geometryBundle = join(temporary, 'page-geometry.cjs');
const build = runProcess('npx', [
  'esbuild',
  'src/template/contracts.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`template contract test bundle failed: ${build.stderr || build.stdout}`);
const geometryBuild = runProcess('npx', [
  'esbuild',
  'src/template/geometry.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${geometryBundle}`,
], { cwd: root, timeout: 30_000 });
if (geometryBuild.status !== 0) throw new Error(`page geometry test bundle failed: ${geometryBuild.stderr || geometryBuild.stdout}`);

try {
  const { compileTemplateSource, resolvePlan } = await import(bundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  const source = {
    schema_version: 1,
    id: 'pages/flow-contract',
    kind: 'page',
    surface: 'pdf-a4',
    composition: { heading_keep_with_next_lines: 1 },
    canvas: { direction: 'ltr' },
    page: {
      width: 210,
      height: 297,
      margins: { top: 18, right: 17, bottom: 18, left: 17 },
      columns: { count: 1 },
      reserved_bands: {},
      flow_obstacles: [{ id: 'hero-image-boundary', frame: { x: 0.1, y: 0.4, width: 0.8, height: 0.12 } }],
      blocks: {
        intro: { frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, grow: { axis: 'y', max_height: 0.7, pushes: ['content'] } },
        content: { frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 } },
      },
      flow: { align: 'left', hyphenate: false, lead: 'intro' },
    },
    slots: {
      lockup: { type: 'lockup', frame: { x: 0.1, y: 0.02, width: 0.3, height: 0.05 }, gap: '12px' },
      content: { type: 'text', frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, role: 'column', vertical_align: 'middle' },
      footer: { type: 'text', frame: { x: 0.1, y: 0.92, width: 0.8, height: 0.04 }, role: 'footer' },
    },
    flows: {
      main: { slots: ['content'], continuation: 'allowed' },
      footer: { slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' },
    },
    constraints: { inside_canvas: true, no_overlap: false },
  };
  const compiled = compileTemplateSource(source);
  assert.equal(compiled.composition.headingKeepWithNextLines, 1, 'template composition policy must preserve the configured heading cluster size');
  assert.deepEqual(compiled.slots.lockup.gap, { value: 12, unit: 'px' }, 'lockup gap must preserve its explicit unit');
  assert.equal(compiled.slots.content.verticalAlign, 'middle', 'slot vertical alignment must survive template compilation');
  assert.deepEqual(compiled.flows.main, { id: 'main', slots: ['content'], continuation: 'allowed' });
  assert.deepEqual(compiled.flows.footer, { id: 'footer', slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' });
  const pageSpecific = compileTemplateSource({ ...structuredClone(source), flows: { main: { slots: ['content'], continuation_slots: ['footer'], continuation: 'allowed' }, footer: { slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' } } });
  assert.deepEqual(pageSpecific.flows.main, { id: 'main', slots: ['content'], continuationSlots: ['footer'], continuation: 'allowed' });
  const insertionSource = structuredClone(source);
  insertionSource.slots.quote = { type: 'text', frame: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 }, role: 'quote', vertical_align: 'middle' };
  insertionSource.flows.quotes = { slots: ['quote'], insertion_slots: ['quote'], continuation: 'allowed' };
  const insertionCompiled = compileTemplateSource(insertionSource);
  assert.deepEqual(insertionCompiled.flows.quotes, { id: 'quotes', slots: ['quote'], insertionSlots: ['quote'], continuation: 'allowed' });
  assert.throws(
    () => compileTemplateSource({ ...insertionSource, flows: { ...insertionSource.flows, main: { slots: ['content', 'quote'], insertion_slots: ['quote'], continuation: 'allowed' } } }),
    /main.*insertion_slots.*separate insertion flow/u,
    'the main flow must not own insertion slots',
  );
  assert.throws(
    () => compileTemplateSource({ ...insertionSource, flows: { ...insertionSource.flows, quotes: { slots: ['quote'], insertion_slots: ['missing'], continuation: 'allowed' } } }),
    /insertion_slots.*references unknown slot 'missing'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...insertionSource, flows: { ...insertionSource.flows, quotes: { slots: ['quote'], insertion_slots: ['footer'], continuation: 'allowed' } } }),
    /insertion_slots.*slot 'footer' must also be listed in slots/u,
  );
  const defaultContinuation = compileTemplateSource({ ...structuredClone(source), flows: { main: { slots: ['content'] }, footer: { slots: ['footer'], repeat: 'each-page' } } });
  assert.equal(defaultContinuation.flows.main.continuation, 'allowed', 'main flow must continue by default');
  assert.equal(defaultContinuation.flows.footer.continuation, 'allowed', 'generic flow defaults to continuation; template repetition policy decides footer behavior');
  assert.deepEqual(compiled.page.blockGrowth.intro, { axis: 'y', maxHeight: 0.7, pushes: ['content'] });
  assert.equal(compiled.page.flow.lead, 'intro');
  assert.deepEqual(compiled.page.flowObstacles, [{ id: 'hero-image-boundary', frame: { x: 0.1, y: 0.4, width: 0.8, height: 0.12 } }]);
  const geometry = pageGeometryFromTemplate(compiled);
  assert.equal(geometry.flowObstacles[0].id, 'hero-image-boundary');
  assert.equal(geometry.segments.some((segment) => segment.top < geometry.flowObstacles[0].frame.bottom && segment.bottom > geometry.flowObstacles[0].frame.top), false, 'text segment must not cross a declared image boundary');
  assert.deepEqual(resolvePlan(compiled).flows, compiled.flows);
  assert.throws(
    () => compileTemplateSource({ ...source, flows: { main: { slots: ['missing'], continuation: 'allowed' } } }),
    /references unknown slot 'missing'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, flows: { main: { slots: ['content'], continuation_slots: ['missing'], continuation: 'allowed' } } }),
    /continuation_slots.*references unknown slot 'missing'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, page: { ...source.page, flow_obstacles: { invalid: true } } }),
    /flow_obstacles.*must be an array/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, flows: { main: { slots: ['content'], continuation: 'sometimes' } } }),
    /must be 'allowed' or 'forbidden'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, flows: { footer: { slots: ['footer'], continuation: 'forbidden', repeat: 'always' } } }),
    /must be 'each-page'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, slots: { ...source.slots, content: { ...source.slots.content, vertical_align: 'diagonal' } } }),
    /vertical_align.*must be 'top', 'middle' or 'bottom'/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, slots: { ...source.slots, lockup: { ...source.slots.lockup, gap: 'normal' } } }),
    /slots\.lockup\.gap.*must use a number with %, px or mm/u,
  );
  assert.throws(
    () => compileTemplateSource({ ...source, page: { ...source.page, blocks: { intro: { frame: { x: 0.1, y: 0.8, width: 0.8, height: 0.1 }, grow: { axis: 'y', max_height: 0.4 } } } } }),
    /must keep the growing block inside the normalized canvas/u,
  );
  console.log(JSON.stringify({ status: 'passed', flows: Object.keys(compiled.flows) }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
