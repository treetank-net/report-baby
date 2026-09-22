#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { loremIpsum } from 'lorem-ipsum';
import { runProcess } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-adapter-'));
const bundle = join(temporary, 'composition-adapter.cjs');
const backendBundle = join(temporary, 'composition.cjs');
const primitivesBundle = join(temporary, 'render-primitives.cjs');
const templateBundle = join(temporary, 'template.cjs');
const geometryBundle = join(temporary, 'geometry.cjs');
const buildComposition = runProcess('npx', [
  'esbuild',
  'src/composition/report-composition-entrypoint.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (buildComposition.status !== 0) throw new Error(`composition adapter bundle failed: ${buildComposition.stderr || buildComposition.stdout}`);
const buildBackend = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${backendBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildBackend.status !== 0) throw new Error(`composition backend bundle failed: ${buildBackend.stderr || buildBackend.stdout}`);
const buildPrimitives = runProcess('npx', [
  'esbuild',
  'src/rendering/primitives.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  '--loader:.wasm=binary',
  '--loader:.ttf=binary',
  `--outfile=${primitivesBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildPrimitives.status !== 0) throw new Error(`render primitives bundle failed: ${buildPrimitives.stderr || buildPrimitives.stdout}`);
const buildTemplate = runProcess('npx', [
  'esbuild',
  'src/template/contracts.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${templateBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildTemplate.status !== 0) throw new Error(`composition adapter template bundle failed: ${buildTemplate.stderr || buildTemplate.stdout}`);
const buildGeometry = runProcess('npx', [
  'esbuild',
  'src/template/geometry.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${geometryBundle}`,
], { cwd: root, timeout: 30_000 });
if (buildGeometry.status !== 0) throw new Error(`composition adapter geometry bundle failed: ${buildGeometry.stderr || buildGeometry.stdout}`);

try {
  const { compositionChartStyleFromRenderConfig, compositionGraphicStyleFromRenderConfig, compositionMetricStyleFromRenderConfig, compositionPdfBackendOptionsFromRenderConfig, compositionStylesFromRenderConfig, compositionTableStyleFromRenderConfig, planReportComposition } = await import(bundle);
  const { combineJsPdfCompositionBlockCapabilities, createJsPdfChartBlockCapabilities, createJsPdfMetricBlockCapabilities, createJsPdfTableBlockCapabilities, createJsPdfTextBackend, renderComposition } = await import(backendBundle);
  const { newPdf } = await import(primitivesBundle);
  const { compileTemplateSource } = await import(templateBundle);
  const { pageGeometryFromTemplate } = await import(geometryBundle);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);
  const pdf = newPdf();
  let randomState = 0x51ade;
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
   */
  const random = () => {
    randomState = (1664525 * randomState + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const intro = Array.from({ length: 12 }, () => loremIpsum({ count: 1, units: 'sentences', sentenceLowerBound: 8, sentenceUpperBound: 14, random })).join(' ');
  const body = Array.from({ length: 70 }, () => loremIpsum({ count: 1, units: 'sentences', sentenceLowerBound: 8, sentenceUpperBound: 14, random })).join(' ');
  const result = planReportComposition(pdf, compiled, geometry, legacyFixtureToCompositionInput({
    intro,
    sections: [{ heading: 'A measured continuation', body }],
    footer: 'Prepared for the editorial team.',
  }), { family: 'DejaVu', maxPages: 3 });
  assert.notEqual(result.evaluation.status, 'rejected', JSON.stringify(result.evaluation));
  assert.equal(result.plan.trace?.phases.filter((phase) => phase.name === 'evaluation').length, 1, 'the report composition result must contain one evaluation phase');
  assert.ok(result.plan.pages.length >= 2, 'semantic flow input should continue onto a second page');
  assert.ok(result.plan.lines.some((line) => line.blockId === 'intro' && line.slotId === '1:block:intro'));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'section-1-heading'));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'section-1-body' && line.page === 2));
  assert.ok(result.plan.lines.some((line) => line.blockId === 'footer' && line.slotId === '1:flow:footer'));
  assert.ok(result.plan.decisions.some((decision) => decision.code === 'SLOT_GROWN' && decision.blockId === 'intro'));
  assert.equal(result.metrics.family, 'DejaVu');
  const styles = compositionStylesFromRenderConfig();
  const artifact = renderComposition(result.document, result, createJsPdfTextBackend(pdf, 'DejaVu', styles, compositionPdfBackendOptionsFromRenderConfig()));
  const artifactPath = join(temporary, 'composition.pdf');
  await writeFile(artifactPath, artifact);
  assert.equal(artifact.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.getNumberOfPages(), result.plan.pages.length);

  const variantSource = structuredClone(source);
  variantSource.id = 'pages/editorial-variant';
  const variantCompiled = compileTemplateSource(variantSource);
  const variantGeometry = pageGeometryFromTemplate(variantCompiled);
  const variantPdf = newPdf('portrait', [geometry.width, geometry.height]);
  const variantResult = planReportComposition(variantPdf, compiled, geometry, legacyFixtureToCompositionInput({
    intro,
    sections: [{ heading: 'A measured continuation', body }],
    footer: 'Prepared for the editorial team.',
  }), {
    family: 'DejaVu',
    maxPages: 3,
    layout: [
      { pages: { count: { min: 1, max: 2 } }, template: compiled.id },
      { pages: 'remaining', template: variantCompiled.id },
    ],
    pageTemplateSources: [
      { templateRef: compiled.id, compiled, geometry },
      { templateRef: variantCompiled.id, compiled: variantCompiled, geometry: variantGeometry },
    ],
  });
  assert.notEqual(variantResult.evaluation.status, 'rejected', JSON.stringify(variantResult.evaluation));
  assert.ok(variantResult.plan.trace?.candidateSearch?.layoutVariant, 'selected layout variant must remain visible in the candidate trace');
  assert.ok(variantResult.plan.pages.some((page) => page.templateRef !== undefined
    && variantResult.plan.trace?.candidateSearch?.layoutVariant?.includes(page.templateRef)), 'the selected plan must use a template identity reported by the search trace');

  const graphicSource = structuredClone(source);
  graphicSource.id = 'pages/editorial-public-graphic-composition';
  graphicSource.slots['public-graphic'] = { type: 'graphic', frame: { x: 0.40, y: 0.35, width: 0.20, height: 0.10 } };
  const graphicCompiled = compileTemplateSource(graphicSource);
  const graphicGeometry = pageGeometryFromTemplate(graphicCompiled);
  const graphicPdf = newPdf('portrait', [graphicGeometry.width, graphicGeometry.height]);
  const graphicResult = planReportComposition(graphicPdf, graphicCompiled, graphicGeometry, {
    flows: { main: { blocks: [{ id: 'graphic-public-body', type: 'text', text: 'A public authored graphic is planned and rendered through the same composition path.' }] } },
    graphics: [{ id: 'public-panel', slot_id: 'public-graphic', shape: 'rectangle', size: { width: 20, height: 10 } }],
    glyphs: [{ id: 'public-panel-glyph', target: { kind: 'graphic', id: 'public-panel' }, text: '+', style: 'body', anchor: 'box', target_mode: 'box' }],
  }, { family: 'DejaVu', maxPages: 1 });
  assert.equal(graphicResult.evaluation.status, 'accepted', JSON.stringify(graphicResult.evaluation));
  assert.deepEqual(graphicResult.plan.graphicPlacements.map((placement) => placement.graphicId), ['public-panel']);
  assert.ok(graphicResult.plan.glyphPlacements.some((glyph) => glyph.targetType === 'graphic' && glyph.targetId === 'public-panel'), 'a public glyph must resolve against the final authored graphic placement');
  const graphicArtifact = renderComposition(graphicResult.document, graphicResult, createJsPdfTextBackend(graphicPdf, 'DejaVu', styles, {
    ...compositionPdfBackendOptionsFromRenderConfig(),
    graphicStyle: compositionGraphicStyleFromRenderConfig({ fillColor: [235, 240, 248], drawColor: [38, 71, 108] }),
  }));
  assert.equal(graphicArtifact.subarray(0, 5).toString(), '%PDF-');

  const unsupported = planReportComposition(newPdf(), compiled, geometry, legacyFixtureToCompositionInput({
    title: 'This title needs the report chrome backend.',
    kpis: [{ label: 'Reach', value: '184k' }],
    sections: [{ heading: 'Body', body: 'The body is still represented, but the title and KPI are not.' }],
  }), { family: 'DejaVu', maxPages: 3 });
  assert.equal(unsupported.evaluation.status, 'rejected');
  assert.equal(unsupported.evaluation.diagnostics.some((item) => item.code === 'UNSUPPORTED_REPORT_FIELD' && item.details?.field === 'title'), false);
  assert.ok(unsupported.evaluation.diagnostics.some((item) => item.code === 'BLOCK_MEASUREMENT_UNAVAILABLE'));
  assert.throws(() => renderComposition(unsupported.document, unsupported, createJsPdfTextBackend(newPdf(), 'DejaVu', styles)), /rejected/u);

  const metricSource = structuredClone(source);
  metricSource.id = 'pages/editorial-metric-composition';
  metricSource.page.reserved_bands.metrics = { x: 0, y: 0.20, width: 1, height: 0.11 };
  metricSource.slots['metric-1'] = { type: 'metric-card', frame: { x: 0.081, y: 0.20, width: 0.39, height: 0.11 } };
  metricSource.slots['metric-2'] = { type: 'metric-card', frame: { x: 0.529, y: 0.20, width: 0.39, height: 0.11 } };
  metricSource.flows.main.slots = ['metric-1', 'metric-2', 'content'];
  const metricCompiled = compileTemplateSource(metricSource);
  const metricGeometry = pageGeometryFromTemplate(metricCompiled);
  const metricPdf = newPdf('portrait', [metricGeometry.width, metricGeometry.height]);
  const metricCapabilities = createJsPdfMetricBlockCapabilities(metricPdf, 'DejaVu', compositionMetricStyleFromRenderConfig({
    fillColor: [235, 240, 248],
    drawColor: [180, 190, 205],
    labelColor: [90, 100, 115],
    valueColor: [25, 35, 50],
    deltaColor: [20, 120, 70],
  }));
  const metricResult = planReportComposition(metricPdf, metricCompiled, metricGeometry, legacyFixtureToCompositionInput({
    kpis: [
      { label: 'Reach', value: 1200, delta: '+12%', trend: 'up' },
      { label: 'Leads', value: 84 },
    ],
    sections: [{ heading: 'Narrative after cards', body: 'The narrative begins after the declared metric slots.' }],
  }), { family: 'DejaVu', maxPages: 2, measureBlock: metricCapabilities.measureBlock });
  assert.equal(metricResult.evaluation.status, 'accepted', JSON.stringify(metricResult.evaluation));
  assert.deepEqual(metricResult.plan.blockPlacements.map((placement) => placement.blockId), ['metric-1', 'metric-2']);

  const chartSource = structuredClone(source);
  chartSource.id = 'pages/editorial-chart-composition';
  chartSource.page.reserved_bands.chart = { x: 0, y: 0.20, width: 1, height: 0.36 };
  chartSource.slots.chart = { type: 'chart', frame: { x: 0.081, y: 0.20, width: 0.838, height: 0.36 }, role: 'chart' };
  chartSource.flows.main.slots = ['chart', 'content'];
  const chartCompiled = compileTemplateSource(chartSource);
  const chartGeometry = pageGeometryFromTemplate(chartCompiled);
  const chartPdf = newPdf('portrait', [chartGeometry.width, chartGeometry.height]);
  const chartCapabilities = createJsPdfChartBlockCapabilities(chartPdf, 'DejaVu', compositionChartStyleFromRenderConfig({
    fillColor: [250, 250, 250],
    drawColor: [205, 212, 222],
    foregroundColor: [25, 35, 50],
    mutedColor: [90, 100, 115],
    gridColor: [225, 230, 238],
    palette: [[50, 110, 210], [210, 110, 70], [80, 155, 100]],
  }));
  const chartResult = planReportComposition(chartPdf, chartCompiled, chartGeometry, legacyFixtureToCompositionInput({
    charts: [{ type: 'bar', title: 'Reach by channel', subtitle: 'Qualified visits', data: [{ label: 'Search', value: 12 }, { label: 'Social', value: 8 }] }],
    sections: [{ heading: 'Narrative after chart', body: 'A chart is an atomic block and the narrative starts in the remaining text band.' }],
  }), { family: 'DejaVu', maxPages: 2, measureBlock: chartCapabilities.measureBlock });
  assert.equal(chartResult.evaluation.status, 'accepted', JSON.stringify(chartResult.evaluation));
  assert.deepEqual(chartResult.plan.blockPlacements.map((placement) => placement.blockId), ['chart-1']);
  assert.equal(chartResult.document.flows.main.blocks.find((block) => block.kind === 'chart')?.kind, 'chart');
  const chartPlacement = chartResult.plan.blockPlacements.find((placement) => placement.blockId === 'chart-1');
  assert.ok(chartPlacement, 'chart should have a semantic block placement');
  assert.ok(chartPlacement.box.width <= chartSource.slots.chart.frame.width * chartGeometry.width + 0.001);
  assert.ok(chartPlacement.box.height <= chartSource.slots.chart.frame.height * chartGeometry.height + 0.001);

  const fluxSource = parse(await readFile(join(root, 'templates/pages/showcase-report/template.yml'), 'utf8'));
  const fluxCompiled = compileTemplateSource(fluxSource);
  const fluxGeometry = pageGeometryFromTemplate(fluxCompiled);
  const fluxPdf = newPdf('portrait', [fluxGeometry.width, fluxGeometry.height]);
  const fluxMetricCapabilities = createJsPdfMetricBlockCapabilities(fluxPdf, 'DejaVu', compositionMetricStyleFromRenderConfig({
    fillColor: [235, 240, 248],
    drawColor: [180, 190, 205],
    labelColor: [90, 100, 115],
    valueColor: [25, 35, 50],
    deltaColor: [20, 120, 70],
  }));
  const fluxChartCapabilities = createJsPdfChartBlockCapabilities(fluxPdf, 'DejaVu', compositionChartStyleFromRenderConfig({
    fillColor: [250, 250, 250],
    drawColor: [205, 212, 222],
    foregroundColor: [25, 35, 50],
    mutedColor: [90, 100, 115],
    gridColor: [225, 230, 238],
    palette: [[50, 110, 210], [210, 110, 70], [80, 155, 100]],
  }));
  const fluxIntro = Array.from({ length: 2 }, () => loremIpsum({ count: 1, units: 'sentences', sentenceLowerBound: 8, sentenceUpperBound: 12, random })).join(' ');
  const fluxBody = Array.from({ length: 2 }, () => loremIpsum({ count: 1, units: 'sentences', sentenceLowerBound: 14, sentenceUpperBound: 18, random })).join(' ');
  const fluxInput = {
    flows: {
      main: {
        continuation: 'allowed',
        blocks: [
          { id: 'intro', type: 'text', role: 'intro', text: fluxIntro },
          { id: 'metric-1', type: 'metric', role: 'metric', label: 'Reach', value: '184k', delta: '+12%', trend: 'up' },
          { id: 'metric-2', type: 'metric', role: 'metric', label: 'Leads', value: '12.4k', delta: '+8%', trend: 'up' },
          { id: 'metric-3', type: 'metric', role: 'metric', label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up' },
          { id: 'chart-1', type: 'chart', role: 'chart', chart_type: 'bar', title: 'Reach by channel', subtitle: 'Qualified visits', data: [{ label: 'Search', value: 12 }, { label: 'Social', value: 8 }] },
          { id: 'body-heading', type: 'heading', role: 'heading', text: 'What changed', keep_with_next_lines: 2 },
          { id: 'body', type: 'text', role: 'body', text: fluxBody },
        ],
      },
    },
  };
  const fluxCapabilities = combineJsPdfCompositionBlockCapabilities({
    metric: { measureBlock: fluxMetricCapabilities.measureBlock, renderer: fluxMetricCapabilities.renderer },
    chart: { measureBlock: fluxChartCapabilities.measureBlock, renderer: fluxChartCapabilities.renderer },
  });
  const fluxResult = planReportComposition(fluxPdf, fluxCompiled, fluxGeometry, fluxInput, {
    family: 'DejaVu',
    maxPages: 2,
    measureBlock: fluxCapabilities.measureBlock,
  });
  assert.notEqual(fluxResult.evaluation.status, 'rejected', JSON.stringify(fluxResult.evaluation));
  assert.deepEqual(fluxResult.plan.blockPlacements.map((placement) => placement.blockId), ['metric-1', 'metric-2', 'metric-3', 'chart-1']);
  assert.equal(fluxResult.plan.lines.filter((line) => line.blockId === 'body').every((line) => line.page === 1), true);
  assert.equal(fluxResult.plan.decisions.some((decision) => decision.code === 'BLOCK_CONTINUED' && decision.blockId === 'body'), false);
  assert.equal(fluxResult.plan.decisions.some((decision) => decision.code === 'KEEP_CLUSTER_PUSHED' && decision.blockId === 'body-heading'), false);

  const tableSource = structuredClone(source);
  tableSource.id = 'pages/editorial-table-composition';
  tableSource.page.reserved_bands.table = { x: 0, y: 0.20, width: 1, height: 0.36 };
  tableSource.slots.table = { type: 'table', frame: { x: 0.081, y: 0.20, width: 0.838, height: 0.36 }, role: 'table' };
  tableSource.flows.main.slots = ['content', 'table'];
  const tableCompiled = compileTemplateSource(tableSource);
  const tableGeometry = pageGeometryFromTemplate(tableCompiled);
  const tablePdf = newPdf('portrait', [tableGeometry.width, tableGeometry.height]);
  const tableCapabilities = createJsPdfTableBlockCapabilities(tablePdf, 'DejaVu', compositionTableStyleFromRenderConfig({
    headerFillColor: [35, 80, 150],
    headerTextColor: [255, 255, 255],
    rowFillColor: [248, 250, 252],
    alternateRowFillColor: [235, 240, 248],
    textColor: [20, 30, 45],
    lineColor: [180, 190, 205],
  }));
  const tableResult = planReportComposition(tablePdf, tableCompiled, tableGeometry, legacyFixtureToCompositionInput({
    table: {
      head: ['Channel', 'Reach'],
      body: Array.from({ length: 10 }, (_, index) => [`Channel ${index + 1}`, index + 1]),
      caption: 'Reach by channel',
    },
    sections: [{ heading: 'Narrative after table', body: 'The narrative follows all row fragments.' }],
  }), { family: 'DejaVu', maxPages: 3, measureTable: tableCapabilities.measureTable });
  assert.equal(tableResult.evaluation.status, 'accepted', JSON.stringify(tableResult.evaluation));
  assert.equal(tableResult.plan.tablePlacements.length, 2);
  assert.deepEqual(tableResult.plan.tablePlacements.map((placement) => [placement.startRow, placement.endRow, placement.repeatsHeader]), [[0, 6, false], [6, 10, true]]);

  const tableGapSource = structuredClone(source);
  tableGapSource.id = 'pages/editorial-table-gap-composition';
  tableGapSource.slots.content.allowed_block_kinds = ['paragraph', 'table'];
  tableGapSource.flows.main.slots = ['content'];
  const tableGapCompiled = compileTemplateSource(tableGapSource);
  const tableGapGeometry = pageGeometryFromTemplate(tableGapCompiled);
  const tableGapPdf = newPdf('portrait', [tableGapGeometry.width, tableGapGeometry.height]);
  const tableGapCapabilities = createJsPdfTableBlockCapabilities(tableGapPdf, 'DejaVu', compositionTableStyleFromRenderConfig({
    headerFillColor: [35, 80, 150],
    headerTextColor: [255, 255, 255],
    rowFillColor: [248, 250, 252],
    alternateRowFillColor: [235, 240, 248],
    textColor: [20, 30, 45],
    lineColor: [180, 190, 205],
  }));
  const tableGapResult = planReportComposition(tableGapPdf, tableGapCompiled, tableGapGeometry, {
    flows: {
      main: {
        continuation: 'forbidden',
        blocks: [
          { id: 'table-gap-body', type: 'text', role: 'body', text: 'The narrative block must leave the configured body margin before the following table.' },
          { id: 'table-gap-table', type: 'table', role: 'table', head: ['Signal', 'Owner'], body: [['Adoption', 'Product']] },
        ],
      },
    },
  }, { family: 'DejaVu', maxPages: 1, measureTable: tableGapCapabilities.measureTable });
  assert.equal(tableGapResult.evaluation.status, 'accepted', JSON.stringify(tableGapResult.evaluation));
  const tableGapBodyLine = tableGapResult.plan.lines.find((line) => line.blockId === 'table-gap-body');
  const tableGapPlacement = tableGapResult.plan.tablePlacements.find((placement) => placement.blockId === 'table-gap-table');
  assert.ok(tableGapBodyLine && tableGapPlacement);
  assert.ok(tableGapPlacement.box.y >= tableGapBodyLine.box.y + tableGapBodyLine.box.height + (styles.body.marginAfter ?? 0) - 0.001, 'table must honor the configured gap after preceding text');
  console.log(JSON.stringify({
    status: 'passed',
    evaluation: result.evaluation.status,
    pages: result.plan.pages.length,
    lines: result.plan.lines.length,
    footerSlot: result.plan.lines.find((line) => line.blockId === 'footer')?.slotId,
    metricPlacements: metricResult.plan.blockPlacements.length,
    chartPlacements: chartResult.plan.blockPlacements.length,
    tablePlacements: tableResult.plan.tablePlacements.length,
    artifactBytes: artifact.length,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
