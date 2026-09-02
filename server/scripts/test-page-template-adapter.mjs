#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loremIpsum } from 'lorem-ipsum';
import { runProcess } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-page-template-adapter-'));
const compositionBundle = join(temporary, 'composition.cjs');
const templateBundle = join(temporary, 'template.cjs');
const geometryBundle = join(temporary, 'page-geometry.cjs');
const buildComposition = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${compositionBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildComposition.status !== 0) throw new Error(`page template adapter composition bundle failed: ${buildComposition.stderr || buildComposition.stdout}`);
const buildTemplate = runProcess('npx', [
  'esbuild',
  'src/template-contract.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${templateBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildTemplate.status !== 0) throw new Error(`page template adapter template bundle failed: ${buildTemplate.stderr || buildTemplate.stdout}`);
const buildGeometry = runProcess('npx', [
  'esbuild',
  'src/page-geometry.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${geometryBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildGeometry.status !== 0) throw new Error(`page template adapter geometry bundle failed: ${buildGeometry.stderr || buildGeometry.stdout}`);

try {
  const { compositionTemplateFromPageGeometry, compositionDocumentFromInput, createTextCompositionEngine } = await import(compositionBundle);
  const { compileTemplateSource } = await import(templateBundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  await runFixture({ compileTemplateSource, compositionTemplateFromPageGeometry, compositionDocumentFromInput, createTextCompositionEngine, pageGeometryFromTemplate });
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function runFixture({ compileTemplateSource, compositionTemplateFromPageGeometry, compositionDocumentFromInput, createTextCompositionEngine, pageGeometryFromTemplate }) {
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
  assert.equal(template.layouts.length, 2);
  const introSlot = template.layouts[0].slots.find((slot) => slot.id === 'block:intro');
  assert.deepEqual(introSlot?.allowedBlockIds, ['intro']);
  assert.deepEqual(introSlot?.grow?.pushes, ['first:segment-1', 'first:segment-2']);
  assert.equal(template.routes.main.slotsByLayout[template.layouts[1].id].length, geometry.segments.length);
  assert.equal(template.routes.footer.repeat, 'each-page');
  const showcaseSource = parse(await readFile(join(root, 'templates/pages/showcase-report/template.yml'), 'utf8'));
  const showcaseCompiled = compileTemplateSource(showcaseSource);
  const showcaseGeometry = pageGeometryFromTemplate(showcaseCompiled);
  const showcaseTemplate = compositionTemplateFromPageGeometry(showcaseCompiled, showcaseGeometry, { maxPages: 3, includeHeaderFlow: true });
  const lockupSlot = showcaseTemplate.layouts[0].slots.find((slot) => slot.id === 'header-lockup');
  const headerSlot = showcaseTemplate.layouts[1].slots.find((slot) => slot.id === 'header');
  assert.equal(lockupSlot?.kind, 'graphic', 'brand lockup must be a reserved composition box');
  assert.ok(headerSlot && lockupSlot && (
    headerSlot.box.x >= lockupSlot.box.x + lockupSlot.box.width
    || headerSlot.box.x + headerSlot.box.width <= lockupSlot.box.x
    || headerSlot.box.y >= lockupSlot.box.y + lockupSlot.box.height
    || headerSlot.box.y + headerSlot.box.height <= lockupSlot.box.y
  ), 'header text must not collide with the reserved brand lockup');
  assert.ok(!showcaseTemplate.routes.header.slots.includes('header-lockup'), 'reserved lockup must not consume header flow content');
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
  assert.ok(narrativeLines.every((line) => line.page === 1
    ? line.slotId.includes(':first:segment-')
    : line.slotId.includes(':continuation:segment-')), 'a paragraph must not resume in the highlights or unrelated first-page slot; later pages use the declared continuation content slot');
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
  pageSpecificSource.page.continuation = {
    width: 210,
    height: 297,
    margins: { top: 18, right: 17, bottom: 18, left: 17 },
    columns: { count: 3, gutter: 4, widths: [52, 54, 62] },
    reserved_bands: structuredClone(source.page.reserved_bands),
    flow: { align: 'left', hyphenate: false },
  };
  pageSpecificSource.slots.content.continuation_frame = { x: 0.081, y: 0.22, width: 0.838, height: 0.71 };
  const pageSpecificCompiled = compileTemplateSource(pageSpecificSource);
  const pageSpecificGeometry = pageGeometryFromTemplate(pageSpecificCompiled);
  assert.equal(pageSpecificGeometry.continuation?.columns.count, 3);
  const pageSpecificTemplate = compositionTemplateFromPageGeometry(pageSpecificCompiled, pageSpecificGeometry, { maxPages: 3 });
  assert.equal(pageSpecificTemplate.layouts[1].width, pageSpecificGeometry.continuation?.width);
  assert.equal(pageSpecificTemplate.layouts[1].slots.filter((slot) => slot.id.startsWith('continuation:segment-')).length, 3);
  const continuationSegment = pageSpecificGeometry.continuation.segments[0];
  const continuationBox = pageSpecificTemplate.layouts[1].slots.find((slot) => slot.id === 'continuation:segment-1')?.box;
  assert.ok(continuationBox);
  const continuationFrameX = 0.081 * pageSpecificGeometry.continuation.width;
  const continuationFrameRight = 0.919 * pageSpecificGeometry.continuation.width;
  assert.ok(Math.abs(continuationBox.x - continuationFrameX) < 0.001);
  assert.ok(Math.abs(continuationBox.y - 0.22 * pageSpecificGeometry.continuation.height) < 0.001);
  assert.ok(Math.abs(continuationBox.width - (Math.min(continuationSegment.x + continuationSegment.width, continuationFrameRight) - continuationFrameX)) < 0.001);
  assert.ok(Math.abs(continuationBox.height - (continuationSegment.bottom - 0.22 * pageSpecificGeometry.continuation.height)) < 0.001);
  const pageSpecificResult = createTextCompositionEngine(pageSpecificTemplate).plan(document, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.equal(pageSpecificResult.evaluation.status, 'accepted', JSON.stringify(pageSpecificResult.evaluation));
  assert.equal(pageSpecificResult.plan.pages[1]?.layoutId, 'pages/editorial-page-specific-continuation:continuation');
  assert.ok(pageSpecificResult.plan.lines.some((line) => line.page === 2 && line.slotId === '2:continuation:segment-3'), 'page-specific continuation should expose its third text column');

  const result = createTextCompositionEngine(template).plan(document, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.notEqual(result.evaluation.status, 'rejected', JSON.stringify(result.evaluation));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'intro' && line.slotId === '1:block:intro'));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'section-1-body' && line.slotId === '1:first:segment-1'));
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
  genericSource.id = 'pages/editorial-quote-lead';
  genericSource.page.flow.lead = 'quote';
  genericSource.page.blocks = {
    quote: { frame: { x: 0.081, y: 0.24, width: 0.838, height: 0.10 }, grow: { axis: 'y', max_height: 0.69, pushes: ['narrative'] } },
    narrative: genericSource.page.blocks.narrative,
  };
  const genericCompiled = compileTemplateSource(genericSource);
  const genericGeometry = pageGeometryFromTemplate(genericCompiled);
  const genericTemplate = compositionTemplateFromPageGeometry(genericCompiled, genericGeometry, { maxPages: 3 });
  const genericDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'quote', kind: 'paragraph', role: 'quote', text: Array.from({ length: 100 }, (_, index) => `quote${index}`).join(' ') },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'The ordinary body follows a quote lead without knowing anything about intro.' },
    ] } },
  };
  const genericResult = createTextCompositionEngine(genericTemplate).plan(genericDocument, {
    units: 'mm',
    measureText(text) { return text.length * 1.5; },
    lineHeight() { return 5; },
  });
  assert.equal(genericResult.evaluation.status, 'accepted', JSON.stringify(genericResult.evaluation));
  assert.deepEqual(genericTemplate.layouts[0].slots.find((slot) => slot.id === 'block:quote')?.allowedBlockIds, ['quote']);
  assert.ok(genericResult.plan.lines.some((line) => line.blockId === 'quote' && line.slotId === '1:block:quote'));
  assert.ok(genericResult.plan.lines.every((line) => !(line.blockId === 'body' && line.slotId === '1:block:quote')));

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
  assert.ok(metricResult.plan.lines.some((line) => line.blockId === 'section-1-heading' && line.slotId.startsWith('1:first:')));

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
  assert.ok(chartResult.plan.lines.some((line) => line.blockId === 'section-1-heading' && line.slotId.startsWith('1:first:')));

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
