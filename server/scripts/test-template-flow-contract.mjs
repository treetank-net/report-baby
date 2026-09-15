#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-template-flow-'));
const bundle = join(temporary, 'contracts.cjs');
const geometryBundle = join(temporary, 'geometry.cjs');
const compositionAdapterBundle = join(temporary, 'page-template.cjs');
await build({
  entryPoints: ['src/template/contracts.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
});
await build({ entryPoints: ['src/template/geometry.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: geometryBundle });
await build({ entryPoints: ['src/composition/adapters/page-template.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: compositionAdapterBundle });

try {
  const { compileTemplateSource, resolvePlan } = await import(bundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  const { compositionTemplateFromPageGeometry } = await import(compositionAdapterBundle);
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
  const dynamicHeaderSource = structuredClone(source);
  dynamicHeaderSource.id = 'pages/dynamic-header-contract';
  dynamicHeaderSource.slots.dynamic = { type: 'text', frame: { x: 0.1, y: 0.05, width: 0.8, height: 0 }, fit_content: true, grow: { axis: 'y', max_height: 0.2, pushes: ['content'] }, role: 'header' };
  dynamicHeaderSource.flows.header = { slots: ['dynamic'], priority: 500, continuation: 'forbidden', repeat: 'each-page' };
  const dynamicHeaderCompiled = compileTemplateSource(dynamicHeaderSource);
  assert.equal(dynamicHeaderCompiled.slots.dynamic.frame.height, 0, 'fit-content slots may start with no reserved height');
  assert.equal(dynamicHeaderCompiled.slots.dynamic.fitContent, true);
  assert.equal(dynamicHeaderCompiled.flows.header.priority, 500, 'flow priority must survive template compilation');
  const capabilitySource = structuredClone(source);
  capabilitySource.id = 'pages/capability-contract';
  capabilitySource.regions = { body: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 } };
  capabilitySource.slots.quote = { type: 'text', region: 'body', frame: { x: 0.1, width: 0.8 }, fit_content: true, placement: { mode: 'fluid-y', region: 'body', max_instances_per_page: 2, distribution: 'balanced' }, role: 'quote' };
  capabilitySource.flows.quotes = { slots: ['quote'], insertion_slots: ['quote'], continuation: 'allowed' };
  const capabilityCompiled = compileTemplateSource(capabilitySource);
  assert.deepEqual(capabilityCompiled.slots.quote.placement, { mode: 'fluid-y', region: 'body', maxInstancesPerPage: 2, distribution: 'balanced' });
  assert.equal(resolvePlan(capabilityCompiled).slotRules.quote.placement.mode, 'fluid-y');
  const capabilityGeometry = pageGeometryFromTemplate(capabilityCompiled);
  const capabilityLayout = compositionTemplateFromPageGeometry(capabilityCompiled, capabilityGeometry, { maxPages: 3 });
  assert.deepEqual(capabilityLayout.routes.quotes?.insertionSlots, ['quote#1', 'quote#2'], 'fluid capabilities must materialize bounded page-local slots');
  assert.deepEqual(capabilityLayout.pageTemplates.find((item) => item.id === capabilityCompiled.id)?.slots.filter((slot) => slot.id.startsWith('quote#')).map((slot) => slot.id), ['quote#1', 'quote#2']);
  assert.throws(() => compileTemplateSource({ ...capabilitySource, slots: { ...capabilitySource.slots, quote: { ...capabilitySource.slots.quote, placement: { mode: 'fluid-y', region: 'body', max_instances_per_page: 0 } } } }), /max_instances_per_page.*positive integer/u);
  assert.throws(
    () => compileTemplateSource({ ...structuredClone(source), slots: { ...source.slots, zero: { type: 'text', frame: { x: 0.1, y: 0.1, width: 0.8, height: 0 } } } }),
    /height must be greater than zero/u,
    'a fixed slot must still reject a zero-height frame',
  );
  assert.equal(compiled.composition.headingKeepWithNextLines, 1, 'template composition policy must preserve the configured heading cluster size');
  assert.deepEqual(compiled.slots.lockup.gap, { value: 12, unit: 'px' }, 'lockup gap must preserve its explicit unit');
  assert.equal(compiled.slots.content.verticalAlign, 'middle', 'slot vertical alignment must survive template compilation');
  assert.deepEqual(compiled.flows.main, { id: 'main', slots: ['content'], continuation: 'allowed' });
  assert.deepEqual(compiled.flows.footer, { id: 'footer', slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' });
  assert.throws(
    () => compileTemplateSource({ ...structuredClone(source), flows: { main: { slots: ['content'], continuation_slots: ['footer'], continuation: 'allowed' }, footer: { slots: ['footer'], continuation: 'forbidden', repeat: 'each-page' } } }),
    /continuation_slots.*no longer supported/u,
    'continuation slots must be rejected in the target contract',
  );
  const insertionSource = structuredClone(source);
  insertionSource.slots.quote = { type: 'text', frame: { x: 0.1, y: 0.4, width: 0.8, height: 0.1 }, role: 'quote', vertical_align: 'middle' };
  insertionSource.flows.quotes = { slots: ['quote'], insertion_slots: ['quote'], continuation: 'allowed' };
  const insertionCompiled = compileTemplateSource(insertionSource);
  assert.deepEqual(insertionCompiled.flows.quotes, { id: 'quotes', slots: ['quote'], insertionSlots: ['quote'], continuation: 'allowed' });
  const atomicInsertionSource = structuredClone(source);
  atomicInsertionSource.slots.metric = { type: 'metric-card', frame: { x: 0.1, y: 0.4, width: 0.3, height: 0.1 }, role: 'metric' };
  atomicInsertionSource.flows.metrics = { slots: ['metric'], insertion_slots: ['metric'], continuation: 'forbidden' };
  const atomicInsertionCompiled = compileTemplateSource(atomicInsertionSource);
  assert.deepEqual(atomicInsertionCompiled.flows.metrics, { id: 'metrics', slots: ['metric'], insertionSlots: ['metric'], continuation: 'forbidden' }, 'non-quote content slots may be declared as insertion slots');
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
    /continuation_slots.*no longer supported/u,
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
