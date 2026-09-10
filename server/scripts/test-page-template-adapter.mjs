#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loremIpsum } from 'lorem-ipsum';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';
import { build } from 'esbuild';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-page-template-adapter-'));
const compositionBundle = join(temporary, 'composition/index.cjs');
const templateBundle = join(temporary, 'template/contracts.cjs');
const geometryBundle = join(temporary, 'template/geometry.cjs');
await build({
  entryPoints: ['src/composition/index.ts', 'src/template/contracts.ts', 'src/template/geometry.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: temporary,
  outExtension: { '.js': '.cjs' },
});

try {
  const { compositionTemplateFromPageGeometry, compositionTemplateFromPageTemplateSchedule, compositionDocumentFromInput, createTextCompositionEngine } = await import(compositionBundle);
  const { compileTemplateSource } = await import(templateBundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  await runFixture({ compileTemplateSource, compositionTemplateFromPageGeometry, compositionTemplateFromPageTemplateSchedule, compositionDocumentFromInput, createTextCompositionEngine, pageGeometryFromTemplate });
} finally {
  await rm(temporary, { recursive: true, force: true });
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
 */
async function runFixture({ compileTemplateSource, compositionTemplateFromPageGeometry, compositionTemplateFromPageTemplateSchedule, compositionDocumentFromInput, createTextCompositionEngine, pageGeometryFromTemplate }) {
  const source = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);
  const template = compositionTemplateFromPageGeometry(compiled, geometry, { maxPages: 3 });
  assert.deepEqual(geometry.content, {
    x: compiled.page.margins.left,
    top: compiled.page.margins.top,
    width: compiled.page.width - compiled.page.margins.left - compiled.page.margins.right,
    bottom: compiled.page.height - compiled.page.margins.bottom,
  }, 'page geometry must expose the physical content frame from the template margins');
  assert.equal(geometry.segments.length, compiled.page.columns.count, 'reserved header/footer bands at page boundaries must leave one continuous segment per column');
  assert.ok(geometry.segments.every((segment) => segment.x >= geometry.content.x
    && segment.x + segment.width <= geometry.content.x + geometry.content.width
    && segment.top >= geometry.content.top
    && segment.bottom <= geometry.content.bottom), 'flow segments must stay inside the content frame');

  const obstacleSource = structuredClone(source);
  obstacleSource.id = 'pages/editorial-geometry-obstacle';
  obstacleSource.page.flow_obstacles = [{
    id: 'mid-page-obstacle',
    frame: { x: 0.081, y: 0.45, width: 0.838, height: 0.10 },
  }];
  const obstacleCompiled = compileTemplateSource(obstacleSource);
  const obstacleGeometry = pageGeometryFromTemplate(obstacleCompiled);
  const obstacle = obstacleGeometry.flowObstacles.find((candidate) => candidate.id === 'mid-page-obstacle');
  assert.ok(obstacle, 'template flow obstacle must be present in physical page geometry');
  assert.ok(obstacleGeometry.segments.some((segment) => segment.bottom <= obstacle.frame.top), 'obstacle must leave an upper flow segment');
  assert.ok(obstacleGeometry.segments.some((segment) => segment.top >= obstacle.frame.bottom), 'obstacle must leave a lower flow segment');
  assert.ok(obstacleGeometry.segments.every((segment) => segment.bottom <= obstacle.frame.top || segment.top >= obstacle.frame.bottom), 'flow segments must not overlap the physical obstacle');
  assert.equal(template.layouts.length, 1);
  const introSlot = template.layouts[0].slots.find((slot) => slot.id === 'block:intro');
  assert.deepEqual(introSlot?.allowedBlockIds, ['intro']);
  assert.deepEqual(introSlot?.grow?.pushes, ['content:segment-1', 'content:segment-2']);
  assert.equal(template.routes.main.slotsByLayout[template.layouts[0].id].length, geometry.segments.length + 1);
  assert.equal(template.routes.footer.repeat, 'each-page');
  const showcaseSource = parse(await readFile(join(root, 'templates/pages/showcase-report/template.yml'), 'utf8'));
  const showcaseCompiled = compileTemplateSource(showcaseSource);
  const showcaseGeometry = pageGeometryFromTemplate(showcaseCompiled);
  const showcaseTemplate = compositionTemplateFromPageGeometry(showcaseCompiled, showcaseGeometry, { maxPages: 5, includeHeaderFlow: true });
  const lockupSlot = showcaseTemplate.layouts[0].slots.find((slot) => slot.id === 'header-lockup');
  const headerSlot = showcaseTemplate.layouts[0].slots.find((slot) => slot.id === 'header');
  assert.equal(lockupSlot?.kind, 'block', 'brand lockup must be a normal block slot');
  assert.ok(headerSlot && lockupSlot && (
    headerSlot.box.x >= lockupSlot.box.x + lockupSlot.box.width
    || headerSlot.box.x + headerSlot.box.width <= lockupSlot.box.x
    || headerSlot.box.y >= lockupSlot.box.y + lockupSlot.box.height
    || headerSlot.box.y + headerSlot.box.height <= lockupSlot.box.y
  ), 'header text must not collide with the reserved brand lockup');
  assert.ok(showcaseTemplate.routes.header.slots.includes('header-lockup'), 'lockup must be available to the header flow');
  const dynamicSource = parse(await readFile(join(root, 'templates/pages/editorial-dynamic-chrome/template.yml'), 'utf8'));
  const dynamicCompiled = compileTemplateSource(dynamicSource);
  const dynamicGeometry = pageGeometryFromTemplate(dynamicCompiled);
  const dynamicTemplate = compositionTemplateFromPageGeometry(dynamicCompiled, dynamicGeometry, { maxPages: 3, includeHeaderFlow: true });
  const dynamicHeaderSlot = dynamicTemplate.layouts[0].slots.find((slot) => slot.id === 'header');
  assert.equal(dynamicHeaderSlot?.fitContent, true, 'dynamic chrome header must opt into fit-content sizing');
  assert.equal(dynamicHeaderSlot?.box.height, 0, 'dynamic chrome header must allow a zero-height empty state');
  assert.equal(dynamicTemplate.routes.header.priority, 500, 'header geometry must carry its explicit priority');
  assert.equal(dynamicTemplate.routes.main.priority, 200, 'main geometry must carry its explicit priority');
  const dynamicDocument = compositionDocumentFromInput({
    flows: {
      header: { continuation: 'forbidden', blocks: [{ id: 'dynamic-header', type: 'text', role: 'header', text: 'A deliberately long repeated header that needs more than one line in the narrow dynamic chrome slot.' }] },
      main: { continuation: 'allowed', blocks: [{ id: 'dynamic-main', type: 'text', role: 'body', text: Array.from({ length: 140 }, (_, index) => `main${index}`).join(' ') }] },
      footer: { continuation: 'forbidden', blocks: [] },
    },
  });
  const dynamicResult = createTextCompositionEngine(dynamicTemplate).plan(dynamicDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.2; },
    lineHeight() { return 5; },
  });
  assert.equal(dynamicResult.evaluation.status, 'accepted', JSON.stringify(dynamicResult.evaluation));
  const materializedDynamicHeader = dynamicResult.plan.slots.find((slot) => slot.id === '1:header');
  const materializedDynamicContent = dynamicResult.plan.slots.find((slot) => slot.id === '1:content:segment-1');
  const dynamicContentTemplateBox = dynamicTemplate.layouts[0].slots.find((slot) => slot.id === 'content:segment-1')?.box;
  assert.ok(materializedDynamicHeader && materializedDynamicHeader.box.height > 0, 'dynamic header must grow to its measured content');
  assert.equal(dynamicResult.plan.lines.find((line) => line.blockId === 'dynamic-header')?.priority, 500, 'header placements must carry geometry priority');
  assert.equal(dynamicResult.plan.lines.find((line) => line.blockId === 'dynamic-main')?.priority, 200, 'main placements must carry geometry priority');
  assert.ok(materializedDynamicContent && dynamicContentTemplateBox && materializedDynamicContent.box.y > dynamicContentTemplateBox.y, 'main content must move below the measured header');

  const scheduledTemplate = compositionTemplateFromPageTemplateSchedule([
    { templateRef: compiled.id, compiled, geometry },
    { templateRef: dynamicCompiled.id, compiled: dynamicCompiled, geometry: dynamicGeometry },
  ], [
    { pages: { count: 1 }, template_ref: compiled.id },
    { pages: { from: 2, count: 2 }, template_ref: dynamicCompiled.id },
  ], { maxPages: 3, includeHeaderFlow: true });
  assert.deepEqual(scheduledTemplate.pageTemplateSchedule, [
    { from: 1, to: 1, templateRef: compiled.id, layoutId: compiled.id },
    { from: 2, to: 3, templateRef: dynamicCompiled.id, layoutId: dynamicCompiled.id },
  ], 'scheduled pages must retain their ordinary template references and ranges');
  assert.equal(scheduledTemplate.layouts.find((layout) => layout.id === dynamicCompiled.id)?.firstPageNumber, 2, 'a scheduled template must know the first page on which its first-page-only slots are materialised');
  const scheduledDocument = compositionDocumentFromInput({
    flows: {
      main: { continuation: 'allowed', blocks: [{ id: 'scheduled-body', type: 'text', role: 'body', text: Array.from({ length: 400 }, (_, index) => `scheduled${index}`).join(' ') }] },
    },
  });
  const scheduledResult = createTextCompositionEngine(scheduledTemplate).plan(scheduledDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.2; },
    lineHeight() { return 5; },
  });
  assert.equal(scheduledResult.evaluation.status, 'accepted', JSON.stringify(scheduledResult.evaluation));
  assert.ok(scheduledResult.plan.pages.some((page) => page.page === 1 && page.templateRef === compiled.id), 'scheduled plan must use the first template on page one');
  assert.ok(scheduledResult.plan.pages.some((page) => page.page > 1 && page.templateRef === dynamicCompiled.id), 'scheduled plan must switch to the later template range');
  const emptyDynamicResult = createTextCompositionEngine(dynamicTemplate).plan({ flows: { header: { id: 'header', continuation: 'forbidden', blocks: [] }, main: { id: 'main', continuation: 'allowed', blocks: [{ id: 'empty-header-main', kind: 'paragraph', role: 'body', text: 'main content' }] }, footer: { id: 'footer', continuation: 'forbidden', blocks: [] } } }, {
    units: 'mm',
    measureText(text) { return text.length * 1.2; },
    lineHeight() { return 5; },
  });
  assert.equal(emptyDynamicResult.evaluation.status, 'accepted', JSON.stringify(emptyDynamicResult.evaluation));
  assert.equal(emptyDynamicResult.plan.slots.find((slot) => slot.id === '1:header')?.box.height, 0, 'empty dynamic header must collapse instead of reserving its maximum height');
  const expandingIntroDocument = compositionDocumentFromInput({
    flows: {
      main: {
        continuation: 'allowed',
        blocks: [
          { id: 'intro', type: 'text', role: 'intro', text: 'This deliberately ordinary intro is long enough to require two lines. It must stay together after its slot grows to fit the second line without ejecting the last line into the next slot.' },
          { id: 'metric', type: 'metric', role: 'metric', label: 'Active teams', value: '18.4k' },
        ],
      },
    },
  });
  const expandingIntroResult = createTextCompositionEngine(showcaseTemplate).plan(expandingIntroDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.35; },
    lineHeight(style) { return style === 'intro' ? 5.2 : 5; },
    measureBlock() { return { height: 26 }; },
  });
  assert.equal(expandingIntroResult.evaluation.status, 'accepted', JSON.stringify(expandingIntroResult.evaluation));
  const expandingIntroLines = expandingIntroResult.plan.lines.filter((line) => line.blockId === 'intro');
  assert.equal(expandingIntroLines.length, 2, 'grown intro fixture should produce two lines');
  assert.ok(expandingIntroLines.every((line) => line.slotId === '1:intro'), 'grown intro must not eject its final line into the next slot');
  assert.ok(expandingIntroResult.plan.decisions.some((decision) => decision.code === 'SLOT_GROWN'), 'grown intro should record the layout decision');
  const metricAfterIntro = expandingIntroResult.plan.slots.find((slot) => slot.id === '1:metric-1');
  assert.ok(metricAfterIntro && metricAfterIntro.box.height >= 26, 'a pushed atomic slot must retain its intrinsic height');
  assert.ok(expandingIntroResult.plan.blockPlacements.some((placement) => placement.blockId === 'metric' && placement.page === 1), 'a pushed metric should remain on the first page when its preserved size fits');
  const longNarrativeDocument = compositionDocumentFromInput({
    flows: {
      main: {
        continuation: 'allowed',
        blocks: [
          { id: 'narrative-heading', type: 'heading', role: 'heading', text: 'A narrative heading' },
          { id: 'narrative-body', type: 'text', role: 'body', text: Array.from({ length: 600 }, (_, index) => `word${index + 1}`).join(' ') },
        ],
      },
    },
  });
  const longNarrativeResult = createTextCompositionEngine(showcaseTemplate).plan(longNarrativeDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.35; },
    lineHeight(style) { return style === 'heading' ? 5.2 : 5.2; },
  });
  assert.equal(longNarrativeResult.evaluation.status, 'accepted', JSON.stringify(longNarrativeResult.evaluation));
  const narrativeLines = longNarrativeResult.plan.lines.filter((line) => line.blockId === 'narrative-body');
  assert.ok(narrativeLines.length > 3, 'long narrative should continue past its first body slot');
  assert.ok(narrativeLines.every((line) => line.slotId.includes(':content:segment-')), 'a paragraph must remain in the ordinary named content slots on every page');
  assert.ok(new Set(narrativeLines.map((line) => line.page)).size > 1, 'long narrative should continue on a later page');
  const titleTemplate = compositionTemplateFromPageGeometry(compiled, geometry, { maxPages: 3, includeTitlePage: true });
  assert.equal(titleTemplate.routes.title.continuation, 'forbidden', 'title flow must not spill past the title page');
  assert.equal(titleTemplate.routes.main.startPage, 2, 'main flow must begin after the title page');
  assert.deepEqual(titleTemplate.layouts[0].slots.find((slot) => slot.id === 'title-page-content')?.box, {
    x: compiled.slots['title-page-content'].frame.x * geometry.width,
    y: compiled.slots['title-page-content'].frame.y * geometry.height,
    width: compiled.slots['title-page-content'].frame.width * geometry.width,
    height: compiled.slots['title-page-content'].frame.height * geometry.height,
  }, 'title-page geometry must come from the selected template slots');
  const missingTitleSlotsSource = structuredClone(source);
  delete missingTitleSlotsSource.slots['title-page-content'];
  const missingTitleSlots = compileTemplateSource(missingTitleSlotsSource);
  assert.throws(
    () => compositionTemplateFromPageGeometry(missingTitleSlots, pageGeometryFromTemplate(missingTitleSlots), { maxPages: 3, includeTitlePage: true }),
    /must define 'title-page-content' and 'title-page-footer' slots/u,
  );

  let randomState = 0xface;
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
   */
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const body = Array.from({ length: 100 }, () => loremIpsum({ count: 1, units: 'sentences', sentenceLowerBound: 8, sentenceUpperBound: 14, random })).join(' ');
  const document = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    intro: 'This intro belongs to the intro box.',
    sections: [{ heading: 'A long section', body }],
    footer: 'Prepared for the editorial team.',
  }));

  const pageSpecificSource = structuredClone(source);
  pageSpecificSource.id = 'pages/editorial-page-specific-continuation';
  pageSpecificSource.page.continuation = structuredClone(source.page);
  pageSpecificSource.slots.content.continuation_frame = { x: 0.081, y: 0.22, width: 0.838, height: 0.71 };
  assert.throws(() => compileTemplateSource(pageSpecificSource), /continuation|no longer supported/u, 'legacy continuation geometry must be rejected');

  const result = createTextCompositionEngine(template).plan(document, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.notEqual(result.evaluation.status, 'rejected', JSON.stringify(result.evaluation));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'intro' && line.slotId === '1:block:intro'));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'section-1-body' && line.slotId === '1:content:segment-1'));
  assert.ok(result.plan.lines.every((line) => !(line.blockId === 'section-1-body' && line.slotId === '1:block:intro')));
  assert.ok(result.plan.pages.length >= 2, 'long body should continue onto another page');
  assert.ok(result.plan.lines.some((line) => line.page === 2), 'continuation page should contain body text');
  assert.ok(result.plan.lines.some((line) => line.blockId === 'footer' && line.slotId === '1:flow:footer'), 'footer flow should use the page footer slot');
  assert.deepEqual(result.plan.repeatFlowIds, ['footer']);
  assert.equal(new Set(result.plan.lines.filter((line) => line.blockId === 'footer').map((line) => line.page)).size, result.plan.pages.length, 'repeated footer flow should be planned on every page');
  const overflowingFooter = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    sections: [{ heading: 'Body', body: 'A body block creates the first page.' }],
    footer: Array.from({ length: 80 }, (_, index) => `footer${index + 1}`).join(' '),
  }));
  const overflowingFooterResult = createTextCompositionEngine(template).plan(overflowingFooter, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.equal(overflowingFooterResult.evaluation.status, 'rejected');
  assert.ok(overflowingFooterResult.plan.residualContent.some((item) => item.flowId === 'footer'));

  const genericSource = structuredClone(source);
  genericSource.id = 'pages/editorial-intro-lead';
  genericSource.page.flow.lead = 'intro';
  genericSource.page.blocks = {
    intro: { frame: { x: 0.081, y: 0.24, width: 0.838, height: 0.10 }, grow: { axis: 'y', max_height: 0.69, pushes: ['narrative'] } },
    narrative: genericSource.page.blocks.narrative,
  };
  const genericCompiled = compileTemplateSource(genericSource);
  const genericGeometry = pageGeometryFromTemplate(genericCompiled);
  const genericTemplate = compositionTemplateFromPageGeometry(genericCompiled, genericGeometry, { maxPages: 3 });
  const genericDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'intro', kind: 'paragraph', role: 'intro', text: Array.from({ length: 100 }, (_, index) => `intro${index}`).join(' ') },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'The ordinary body follows an intro lead without knowing anything about quote insertion.' },
    ] } },
  };
  const genericResult = createTextCompositionEngine(genericTemplate).plan(genericDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.equal(genericResult.evaluation.status, 'accepted', JSON.stringify(genericResult.evaluation));
  assert.deepEqual(genericTemplate.layouts[0].slots.find((slot) => slot.id === 'block:intro')?.allowedBlockIds, ['intro']);
  assert.ok(genericResult.plan.lines.some((line) => line.blockId === 'intro' && line.slotId === '1:block:intro'));
  assert.ok(genericResult.plan.lines.every((line) => !(line.blockId === 'body' && line.slotId === '1:block:intro')));

  const metricSource = structuredClone(source);
  metricSource.id = 'pages/editorial-metric-slots';
  metricSource.slots['metric-1'] = { type: 'metric-card', frame: { x: 0.081, y: 0.24, width: 0.39, height: 0.08 } };
  metricSource.slots['metric-2'] = { type: 'metric-card', frame: { x: 0.529, y: 0.24, width: 0.39, height: 0.08 } };
  metricSource.flows.main.slots = ['metric-1', 'metric-2', 'content'];
  const metricCompiled = compileTemplateSource(metricSource);
  const metricGeometry = pageGeometryFromTemplate(metricCompiled);
  const metricTemplate = compositionTemplateFromPageGeometry(metricCompiled, metricGeometry, { maxPages: 2 });
  assert.deepEqual(metricTemplate.layouts[0].slots.filter((slot) => slot.kind === 'block').map((slot) => [slot.id, slot.allowedBlockKinds]), [
    ['metric-1', ['metric']],
    ['metric-2', ['metric']],
  ]);
  const metricDocument = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    kpis: [
      { label: 'Reach', value: 1200 },
      { label: 'Leads', value: 84 },
    ],
    sections: [{ heading: 'Narrative after cards', body: 'The narrative must start in the text segments, never inside a metric card.' }],
  }));
  const metricResult = createTextCompositionEngine(metricTemplate).plan(metricDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
    measureBlock(_block, box) { return { height: Math.min(15, box.height) }; },
  });
  assert.equal(metricResult.evaluation.status, 'accepted', JSON.stringify(metricResult.evaluation));
  assert.deepEqual(metricResult.plan.blockPlacements.map((placement) => placement.blockId), ['metric-1', 'metric-2']);
  assert.ok(metricResult.plan.lines.every((line) => !line.blockId.startsWith('metric-')));
  assert.ok(metricResult.plan.lines.some((line) => line.blockId === 'section-1-heading' && line.slotId.startsWith('1:content:')));

  const chartSource = structuredClone(source);
  chartSource.id = 'pages/editorial-chart-slot';
  chartSource.page.reserved_bands.chart = { x: 0, y: 0.24, width: 1, height: 0.30 };
  chartSource.slots.chart = { type: 'chart', frame: { x: 0.081, y: 0.24, width: 0.838, height: 0.30 }, role: 'chart' };
  chartSource.flows.main.slots = ['chart', 'content'];
  const chartCompiled = compileTemplateSource(chartSource);
  const chartGeometry = pageGeometryFromTemplate(chartCompiled);
  const chartTemplate = compositionTemplateFromPageGeometry(chartCompiled, chartGeometry, { maxPages: 2 });
  assert.deepEqual(chartTemplate.layouts[0].slots.filter((slot) => slot.kind === 'block').map((slot) => [slot.id, slot.allowedBlockKinds]), [
    ['chart', ['chart', 'image']],
  ]);
  const chartDocument = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    charts: [{ type: 'bar', title: 'Reach by channel', data: [{ label: 'Search', value: 12 }, { label: 'Social', value: 8 }] }],
    sections: [{ heading: 'Narrative after chart', body: 'The narrative starts after the chart placement.' }],
  }));
  const chartResult = createTextCompositionEngine(chartTemplate).plan(chartDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
    measureBlock(_block, box) { return { height: Math.min(60, box.height) }; },
  });
  assert.equal(chartResult.evaluation.status, 'accepted', JSON.stringify(chartResult.evaluation));
  assert.deepEqual(chartResult.plan.blockPlacements.map((placement) => placement.blockId), ['chart-1']);
  assert.ok(chartResult.plan.lines.some((line) => line.blockId === 'section-1-heading' && line.slotId.startsWith('1:content:')));

  const tableSource = structuredClone(source);
  tableSource.id = 'pages/editorial-table-slot';
  tableSource.slots.table = { type: 'table', frame: { x: 0.081, y: 0.24, width: 0.838, height: 0.30 }, role: 'table' };
  tableSource.flows.main.slots = ['table', 'content'];
  const tableCompiled = compileTemplateSource(tableSource);
  const tableGeometry = pageGeometryFromTemplate(tableCompiled);
  const tableTemplate = compositionTemplateFromPageGeometry(tableCompiled, tableGeometry, { maxPages: 2 });
  assert.deepEqual(tableTemplate.layouts[0].slots.filter((slot) => slot.kind === 'block').map((slot) => [slot.id, slot.allowedBlockKinds]), [
    ['table', ['table']],
  ]);
  console.log(JSON.stringify({ status: 'passed', layouts: template.layouts.map((item) => item.id), pages: result.plan.pages.length, lines: result.plan.lines.length }, null, 2));
}
