#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';
import { createDeterministicLorem, loremWords } from './lib/deterministic-lorem.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-dynamic-slots-'));
const bundle = join(temporary, 'composition.cjs');
const build = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`dynamic insertion test bundle failed: ${build.stderr || build.stdout}`);

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
 */
function fixture() {
  const lorem = createDeterministicLorem();
  return {
    template: {
      maxPages: 5,
      layouts: [{ id: 'article', width: 100, height: 100, slots: [
        { id: 'main', regionId: 'main', flowId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 90 }, allowedRoles: ['body'] },
      ] }],
      routes: { main: { slots: ['main'], layouts: ['article'], continuation: 'allowed' } },
    },
    document: {
      flows: {
        main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'story', kind: 'paragraph', role: 'body', text: loremWords(lorem, 1000) }] },
        quotes: { id: 'quotes', continuation: 'forbidden', blocks: Array.from({ length: 7 }, (_, index) => ({ id: `quote-${index + 1}`, kind: 'paragraph', role: 'quote', text: `Quote ${index + 1}: ${loremWords(lorem, 4)}.` })) },
      },
    },
    metrics: {
      units: 'mm',
      family: 'test',
      measureText(text) { return text.length; },
      lineHeight() { return 5; },
      textPadding() { return { top: 0, bottom: 0 }; },
    },
    requests: {
      insertion_flows: [{
        flow_id: 'quotes',
        start_page: 1,
        repeat: 'each-page',
        continuation: 'forbidden',
        slots: [
          { id: 'quote-top', frame: { x: 0.1, y: 0.2, width: 0.8, height: 'auto' }, allowed_roles: ['quote'] },
          { id: 'quote-bottom', frame: { x: 0.1, y: 0.55, width: 0.8, height: 'auto' }, allowed_roles: ['quote'] },
        ],
      }],
    },
  };
}

try {
  const { applyDynamicInsertionRequests, createTextCompositionEngine } = await import(bundle);
  const { template, document, metrics, requests } = fixture();
  const overlaid = applyDynamicInsertionRequests(template, document, requests);
  assert.equal(template.pageSlotOverlays, undefined, 'request overlays must not mutate the reusable template');
  assert.equal(Object.keys(overlaid.pageSlotOverlays ?? {}).length, 5, 'a repeated pool must materialize five page overlays');
  assert.deepEqual(overlaid.pageSlotOverlays?.[1]?.map((slot) => slot.id), ['quote-top', 'quote-bottom']);
  assert.equal(overlaid.routes.quotes?.insertionSlots?.length, 2, 'the request creates one insertion route with a two-slot pool');

  const result = createTextCompositionEngine(overlaid).plan(document, metrics);
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.residualContent.length, 0, JSON.stringify(result.plan.residualContent));
  assert.equal(result.plan.pages.length, 5, 'the main story must use the five-page fixture');
  const dynamicSlots = result.plan.slots.filter((slot) => slot.id.endsWith(':quote-top') || slot.id.endsWith(':quote-bottom'));
  assert.equal(dynamicSlots.length, 10, 'two request-owned slot instances must materialize on each of five pages');
  assert.equal(result.plan.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:')).length, 7, 'only the seven authored quotes reserve insertion obstacles');
  assert.deepEqual(
    result.plan.insertionLines?.map((line) => line.blockId),
    ['quote-1', 'quote-2', 'quote-3', 'quote-4', 'quote-5', 'quote-6', 'quote-7'],
    'seven quotes should consume the repeated two-slot pool in authored order',
  );
  assert.deepEqual(
    result.plan.insertionLines?.map((line) => line.slotId?.replace(/^\d+:/u, '')),
    ['quote-top', 'quote-bottom', 'quote-top', 'quote-bottom', 'quote-top', 'quote-bottom', 'quote-top'],
  );

  const scheduledTemplate = {
    ...template,
    layouts: [
      template.layouts[0],
      { id: 'sidebar-page', width: 100, height: 100, slots: [...template.layouts[0].slots, { id: 'sidebar', regionId: 'sidebar', kind: 'text', box: { x: 5, y: 5, width: 30, height: 30 } }] },
    ],
    pageTemplateSchedule: [
      { from: 1, to: 2, templateRef: 'article', layoutId: 'article' },
      { from: 3, templateRef: 'sidebar-page', layoutId: 'sidebar-page' },
    ],
  };
  const scheduledOverlay = applyDynamicInsertionRequests(scheduledTemplate, document, {
    insertion_flows: [{ flow_id: 'quotes', start_page: 3, slots: [{ id: 'scheduled-quote', frame: { x: 0.45, y: 0.2, width: 0.45, height: 'auto' }, allowed_roles: ['quote'] }] }],
  });
  assert.deepEqual(scheduledOverlay.routes.quotes?.slotsByLayout?.article, [], 'a page-3 overlay must not be advertised on earlier template layouts');
  assert.deepEqual(scheduledOverlay.routes.quotes?.slotsByLayout?.['sidebar-page'], ['scheduled-quote'], 'a page-3 overlay must be advertised on the selected template layout');
  const scheduledResult = createTextCompositionEngine(scheduledOverlay).plan(document, metrics);
  assert.ok(scheduledResult.plan.insertionLines?.some((line) => line.blockId === 'quote-1' && line.page === 3 && line.slotId === '3:scheduled-quote'), 'the page-3 overlay must be available on its selected page');
  assert.ok(!scheduledResult.plan.insertionLines?.some((line) => line.slotId === '1:scheduled-quote' || line.slotId === '2:scheduled-quote'), 'the page-3 overlay must not be available before its selected page');

  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'main', slots: [{ id: 'bad', frame: { x: 0, y: 0, width: 0.5, height: 0.2 } }] }] }),
    /cannot be 'main'/u,
    'main must remain reserved for the primary text flow',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', start_page: 6, slots: [{ id: 'bad-page', frame: { x: 0, y: 0, width: 0.5, height: 0.2 } }] }] }),
    /outside the template range/u,
    'a request cannot address a page beyond maxPages',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'main', frame: { x: 0, y: 0, width: 0.5, height: 0.2 } }] }] }),
    /already in use/u,
    'request slots cannot shadow template-owned slots',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'bad-frame', frame: { x: 0.8, y: 0, width: 0.5, height: 0.2 } }] }] }),
    /outside the page/u,
    'a request frame must remain inside normalized page bounds',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'fixed-auto', frame: { x: 0, y: 0, width: 0.5, height: 'auto' }, sizing: { mode: 'fixed' } }] }] }),
    /numeric frame.height/u,
    'fixed slots require an explicit numeric height',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'missing', slots: [{ id: 'missing-flow', frame: { x: 0, y: 0, width: 0.5, height: 0.2 } }] }] }),
    /not present in the document/u,
    'a request cannot invent a content flow',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'dup', frame: { x: 0, y: 0, width: 0.5, height: 0.2 } }] }, { flow_id: 'quotes', slots: [{ id: 'dup', frame: { x: 0, y: 0.5, width: 0.5, height: 0.2 } }] }] }),
    /already in use/u,
    'slot identifiers must be unique for the entire request',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'unknown-push', frame: { x: 0, y: 0, width: 0.5, height: 'auto' }, sizing: { mode: 'fit-content', pushes: ['not-a-slot'] } }] }] }),
    /unknown request slot/u,
    'growth policies cannot push a slot outside their request pool',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'overlap-a', frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 }, sizing: { mode: 'fixed' } }, { id: 'overlap-b', frame: { x: 0.1, y: 0.3, width: 0.8, height: 0.2 }, sizing: { mode: 'fixed' } }] }] }),
    /overlaps dynamic slot/u,
    'two fixed dynamic frames cannot overlap without an explicit growth relation',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertions: [
      { flow_id: 'quotes', block_id: 'quote-1', page: 1, frame: { x: 0, y: 0, width: 0.5, height: 0.2 } },
      { flow_id: 'quotes', block_id: 'quote-1', page: 2, frame: { x: 0, y: 0, width: 0.5, height: 0.2 } },
    ] }),
    /more than one one-off/u,
    'one authored block cannot be assigned by two one-off requests',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'unknown-block', frame: { x: 0, y: 0, width: 0.5, height: 0.2 }, allowed_block_ids: ['not-in-quotes'] }] }] }),
    /does not allow any block/u,
    'an allow-list cannot point at a block absent from the requested flow',
  );
  assert.throws(
    () => applyDynamicInsertionRequests(template, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'below-content', frame: { x: 0, y: 0.95, width: 0.5, height: 0.1 }, sizing: { mode: 'fixed' } }] }] }),
    /below the page/u,
    'a fixed box cannot extend beyond the page content boundary',
  );
  const oneOff = applyDynamicInsertionRequests(template, document, { insertions: [
    { flow_id: 'quotes', block_id: 'quote-1', page: 1, frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } },
    { flow_id: 'quotes', block_id: 'quote-2', page: 2, frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } },
  ] });
  assert.equal(oneOff.routes.quotes?.insertionSlots?.length, 2, 'multiple one-off requests for one flow must accumulate rather than overwrite their route');
  const protectedTemplate = {
    ...template,
    layouts: [{ ...template.layouts[0], slots: [...template.layouts[0].slots, { id: 'ad', regionId: 'chrome', kind: 'graphic', reserved: true, box: { x: 10, y: 20, width: 80, height: 10 } }] }],
  };
  assert.throws(
    () => applyDynamicInsertionRequests(protectedTemplate, document, { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'over-ad', frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 } }] }] }),
    /overlaps protected slot/u,
    'dynamic content cannot cover a reserved or graphic slot',
  );
  const tooManyQuotes = fixture();
  tooManyQuotes.document.flows.quotes.blocks.push({ id: 'quote-8', kind: 'paragraph', role: 'quote', text: 'An eighth quote.' }, { id: 'quote-9', kind: 'paragraph', role: 'quote', text: 'A ninth quote.' }, { id: 'quote-10', kind: 'paragraph', role: 'quote', text: 'A tenth quote.' }, { id: 'quote-11', kind: 'paragraph', role: 'quote', text: 'An eleventh quote.' });
  const capacity = createTextCompositionEngine(applyDynamicInsertionRequests(tooManyQuotes.template, tooManyQuotes.document, tooManyQuotes.requests)).plan(tooManyQuotes.document, tooManyQuotes.metrics);
  assert.equal(capacity.evaluation.status, 'rejected', 'eleven quotes cannot fit a five-page pool of ten slots');
  assert.ok(capacity.plan.diagnostics.some((diagnostic) => diagnostic.code === 'INSERTION_PLAN_MISSING'), JSON.stringify(capacity.plan.diagnostics));
  const fixed = fixture();
  fixed.document.flows.quotes.blocks = [{ id: 'fixed-quote', kind: 'paragraph', role: 'quote', text: 'This quote is deliberately too long for a fixed box. '.repeat(12) }];
  fixed.requests = { insertion_flows: [{ flow_id: 'quotes', slots: [{ id: 'fixed', frame: { x: 0.1, y: 0.2, width: 0.8, height: 0.02 }, allowed_roles: ['quote'], sizing: { mode: 'fixed', max_height: 0.02 } }] }] };
  const fixedResult = createTextCompositionEngine(applyDynamicInsertionRequests(fixed.template, fixed.document, fixed.requests)).plan(fixed.document, fixed.metrics);
  assert.equal(fixedResult.evaluation.status, 'rejected', 'fixed insertion boxes reject content overflow');
  assert.ok(fixedResult.plan.diagnostics.some((diagnostic) => diagnostic.code === 'INSERTION_OVERFLOW'), JSON.stringify(fixedResult.plan.diagnostics));

  console.log(JSON.stringify({ status: 'passed', pages: result.plan.pages.length, quotes: result.plan.insertionLines?.length, slotsPerPage: 2 }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
