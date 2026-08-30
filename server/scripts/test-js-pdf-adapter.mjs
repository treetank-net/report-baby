#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsPDF } from 'jspdf';
import { parse } from 'yaml';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-js-pdf-adapter-'));
const bundle = join(temporary, 'composition.cjs');
const build = runProcess('npx', [
  'esbuild',
  'src/composition/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundle}`,
], { cwd: root, timeout: 30_000 });
if (build.status !== 0) throw new Error(`jsPDF adapter bundle failed: ${build.stderr || build.stdout}`);

try {
  const { createJsPdfChartBlockCapabilities, createJsPdfImageBlockCapabilities, createJsPdfMetricBlockCapabilities, createJsPdfTableBlockCapabilities, createJsPdfTextBackend, createJsPdfTextMetrics, createTextCompositionEngine, renderComposition } = await import(bundle);
  const template = {
    maxPages: 2,
    layouts: [
      { id: 'first', width: 100, height: 100, slots: [
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 8, y: 8, width: 42, height: 24 } },
        { id: 'graphic', regionId: 'main', kind: 'graphic', box: { x: 25, y: 8, width: 10, height: 10 } },
      ] },
      { id: 'continuation', width: 100, height: 100, slots: [{ id: 'body', regionId: 'main', kind: 'text', box: { x: 8, y: 8, width: 42, height: 24 } }] },
    ],
    routes: { main: { slots: ['body'], layouts: ['first', 'continuation'], continuation: 'allowed' } },
  };
  const document = {
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [{ id: 'body', kind: 'paragraph', role: 'body', text: 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(3) }],
      },
    },
    graphics: [{ id: 'star', slotId: 'graphic', shape: 'star', vertexCount: 5, innerRatio: 0.45, wrap: 'around', page: 1 }],
  };
  const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const styles = {
    body: { fontSize: 9, lineHeight: 6, baselineOffset: 4.5, fontStyle: 'normal' },
  };
  const metrics = createJsPdfTextMetrics(pdf, 'helvetica', styles);
  const result = createTextCompositionEngine(template).plan(document, metrics);
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.pages.length, 2);
  assert.equal(result.plan.graphicPlacements.length, 1);
  const backendOptions = { pageSizeTolerance: renderConfig.pdf.page_size_tolerance, graphicStyle: { fillColor: [210, 90, 60], drawColor: [30, 30, 30], lineWidth: 0.2 } };
  const artifact = renderComposition(document, result, createJsPdfTextBackend(pdf, 'helvetica', styles, backendOptions));
  const output = join(temporary, 'composition.pdf');
  await writeFile(output, artifact);
  assert.ok(artifact.length > 0);
  assert.equal(artifact.subarray(0, 5).toString(), '%PDF-');
  assert.equal(pdf.getNumberOfPages(), 2);
  const firstPageText = runProcess('pdftotext', ['-f', '1', '-l', '1', output, '-']);
  const secondPageText = runProcess('pdftotext', ['-f', '2', '-l', '2', output, '-']);
  assert.equal(firstPageText.status, 0, firstPageText.stderr);
  assert.equal(secondPageText.status, 0, secondPageText.stderr);
  assert.match(firstPageText.stdout, /Lorem/u);
  assert.match(secondPageText.stdout, /Lorem/u);

  const graphicAssetDocument = structuredClone(document);
  graphicAssetDocument.assets = [{ id: 'photo-1', source: 'fixture.png', width: 'full', fit: 'contain', keepWithCaption: false }];
  graphicAssetDocument.graphics[0] = { ...graphicAssetDocument.graphics[0], assetId: 'photo-1', shape: 'rectangle' };
  const graphicAssetPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const graphicAssetResult = createTextCompositionEngine(template).plan(graphicAssetDocument, createJsPdfTextMetrics(graphicAssetPdf, 'helvetica', styles));
  assert.equal(graphicAssetResult.evaluation.status, 'accepted', JSON.stringify(graphicAssetResult.evaluation));
  const fixtureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const graphicAssetArtifact = renderComposition(graphicAssetDocument, graphicAssetResult, createJsPdfTextBackend(graphicAssetPdf, 'helvetica', styles, {
    ...backendOptions,
    imageAssets: new Map([['photo-1', { data: fixtureImage, format: 'PNG', width: 1, height: 1 }]]),
  }));
  const graphicAssetOutput = join(temporary, 'graphic-asset.pdf');
  await writeFile(graphicAssetOutput, graphicAssetArtifact);
  const graphicAssetList = runProcess('pdfimages', ['-list', graphicAssetOutput]);
  assert.equal(graphicAssetList.status, 0, graphicAssetList.stderr);
  assert.match(graphicAssetList.stdout, /image\s+no/u);
  const transparentBoundaryGraphic = structuredClone(graphicAssetDocument);
  transparentBoundaryGraphic.graphics[0].shape = 'ellipse';
  const transparentBoundaryPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const transparentBoundaryResult = createTextCompositionEngine(template).plan(transparentBoundaryGraphic, createJsPdfTextMetrics(transparentBoundaryPdf, 'helvetica', styles));
  assert.equal(transparentBoundaryResult.evaluation.status, 'accepted', JSON.stringify(transparentBoundaryResult.evaluation));
  assert.equal(transparentBoundaryResult.evaluation.diagnostics.some((item) => item.code === 'LINE_GRAPHIC_OVERLAP'), false);
  const transparentBoundaryArtifact = renderComposition(transparentBoundaryGraphic, transparentBoundaryResult, createJsPdfTextBackend(transparentBoundaryPdf, 'helvetica', styles, {
    ...backendOptions,
    imageAssets: new Map([['photo-1', { data: fixtureImage, format: 'PNG', width: 1, height: 1 }]]),
  }));
  const transparentBoundaryOutput = join(temporary, 'graphic-asset-ellipse-boundary.pdf');
  await writeFile(transparentBoundaryOutput, transparentBoundaryArtifact);
  const transparentBoundaryList = runProcess('pdfimages', ['-list', transparentBoundaryOutput]);
  assert.equal(transparentBoundaryList.status, 0, transparentBoundaryList.stderr);
  assert.match(transparentBoundaryList.stdout, /image\s+no/u);

  const captionPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const captionStyle = { captionGap: 2, captionBottomGap: 2, captionLineHeight: 4, captionSize: 6, captionPaddingX: 1.5 };
  const captionCapabilities = createJsPdfImageBlockCapabilities(captionPdf, 'helvetica', new Map([['photo-1', {
    data: fixtureImage,
    format: 'PNG',
    width: 320,
    height: 180,
  }]]), captionStyle);
  const imageBlock = {
    id: 'captioned-image',
    kind: 'image',
    role: 'body',
    atomic: true,
    image: { assetId: 'photo-1', width: 'full', fit: 'contain', caption: 'Measured caption', keepWithCaption: true },
  };
  const imageBox = { x: 8, y: 8, width: 42, height: 28 };
  const imageMeasurement = captionCapabilities.measureBlock(imageBlock, imageBox);
  assert.equal(imageMeasurement.height, 28);
  assert.equal(imageMeasurement.scaled, true);
  const imageCalls = [];
  const originalAddImage = captionPdf.addImage.bind(captionPdf);
  captionPdf.addImage = (...args) => {
    imageCalls.push(args);
    return originalAddImage(...args);
  };
  captionCapabilities.renderer(captionPdf, imageBlock, { id: 'image-placement', blockId: imageBlock.id, kind: 'image', slotId: '1:image', page: 1, box: imageBox });
  assert.equal(imageCalls.length, 1);
  assert.ok(imageCalls[0][5] <= 20, 'caption must reserve height before image scaling');

  const atomicTemplate = {
    maxPages: 1,
    layouts: [{ id: 'atomic', width: 100, height: 100, slots: [
      { id: 'metric', regionId: 'metrics', kind: 'block', allowedBlockKinds: ['metric'], box: { x: 8, y: 8, width: 42, height: 24 } },
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 8, y: 38, width: 84, height: 50 } },
    ] }],
    routes: { main: { slots: ['metric', 'body'], layouts: ['atomic'], continuation: 'forbidden' } },
  };
  const atomicDocument = {
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'metric-1', kind: 'metric', role: 'metric', atomic: true, metric: { label: 'Reach', value: 1200 } },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'The body follows the measured atomic block.' },
    ] } },
  };
  const atomicPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const atomicMetrics = createJsPdfTextMetrics(atomicPdf, 'helvetica', styles);
  const metricCapabilities = createJsPdfMetricBlockCapabilities(atomicPdf, 'helvetica', {
    fillColor: [230, 240, 250],
    drawColor: [30, 30, 30],
    labelColor: [80, 80, 80],
    valueColor: [20, 20, 20],
    deltaColor: [20, 120, 60],
    radius: 2,
    lineWidth: 0.2,
    padding: 2,
    labelY: 6,
    valueY: 13,
    deltaY: 18,
    height: 18,
    labelSize: 6,
    valueSize: 10,
    deltaSize: 6,
  });
  atomicMetrics.measureBlock = metricCapabilities.measureBlock;
  const atomicResult = createTextCompositionEngine(atomicTemplate).plan(atomicDocument, atomicMetrics);
  assert.equal(atomicResult.evaluation.status, 'accepted', JSON.stringify(atomicResult.evaluation));
  const atomicArtifact = renderComposition(atomicDocument, atomicResult, createJsPdfTextBackend(atomicPdf, 'helvetica', styles, {
    pageSizeTolerance: renderConfig.pdf.page_size_tolerance,
    blockRenderers: { metric: metricCapabilities.renderer },
  }));
  const atomicOutput = join(temporary, 'atomic.pdf');
  await writeFile(atomicOutput, atomicArtifact);
  const atomicText = runProcess('pdftotext', [atomicOutput, '-']);
  assert.equal(atomicText.status, 0, atomicText.stderr);
  assert.match(atomicText.stdout, /REACH/u);
  assert.match(atomicText.stdout, /1200/u);
  assert.match(atomicText.stdout, /body follows/u);
  const atomicBbox = runProcess('pdftotext', ['-bbox', atomicOutput, '-']);
  assert.equal(atomicBbox.status, 0, atomicBbox.stderr);
  const reachWord = atomicBbox.stdout.match(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"[^>]*>REACH<\/word>/u);
  assert.ok(reachWord, 'metric label should have a selectable bbox');
  const reachBox = reachWord.slice(1).map(Number);
  const metricBox = atomicResult.plan.blockPlacements[0].box;
  const pointsToMm = (value) => value * 25.4 / 72;
  assert.ok(pointsToMm(reachBox[0]) >= metricBox.x);
  assert.ok(pointsToMm(reachBox[2]) <= metricBox.x + metricBox.width);
  assert.ok(pointsToMm(reachBox[1]) >= metricBox.y);
  assert.ok(pointsToMm(reachBox[3]) <= metricBox.y + metricBox.height);
  assert.throws(
    () => renderComposition(atomicDocument, atomicResult, createJsPdfTextBackend(new jsPDF({ unit: 'mm', format: [100, 100] }), 'helvetica', styles, { pageSizeTolerance: renderConfig.pdf.page_size_tolerance })),
    /No jsPDF composition block renderer was provided for 'metric'/u,
  );
  assert.throws(
    () => renderComposition(document, result, createJsPdfTextBackend(new jsPDF({ unit: 'mm', format: 'a4' }), 'helvetica', styles, { pageSizeTolerance: renderConfig.pdf.page_size_tolerance })),
    /page 1 is .* but the composition plan requires 100x100mm/u,
  );

  const chartTemplate = {
    maxPages: 1,
    layouts: [{ id: 'chart', width: 100, height: 100, slots: [
      { id: 'chart', regionId: 'chart', kind: 'block', allowedBlockKinds: ['chart'], box: { x: 8, y: 8, width: 84, height: 58 } },
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 8, y: 70, width: 84, height: 22 } },
    ] }],
    routes: { main: { slots: ['chart', 'body'], layouts: ['chart'], continuation: 'forbidden' } },
  };
  const chartDocument = {
    flows: { main: { id: 'main', continuation: 'forbidden', blocks: [
      { id: 'chart-1', kind: 'chart', role: 'chart', atomic: true, chart: { type: 'bar', title: 'Reach by channel', subtitle: 'Qualified visits', prefix: '', suffix: '', data: [{ label: 'Search', value: 12 }, { label: 'Social', value: 8 }] } },
      { id: 'body', kind: 'paragraph', role: 'body', text: 'The body follows the chart.' },
    ] } },
  };
  const chartPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const chartMetrics = createJsPdfTextMetrics(chartPdf, 'helvetica', styles);
  const chartStyle = renderConfig.chart;
  const chartCapabilities = createJsPdfChartBlockCapabilities(chartPdf, 'helvetica', {
    fillColor: [250, 250, 250], drawColor: [210, 210, 210], foregroundColor: [20, 30, 45], mutedColor: [90, 100, 115], gridColor: [220, 225, 232],
    palette: [[40, 100, 220], [230, 130, 50]],
    width: chartStyle.width, height: chartStyle.height, renderWidth: chartStyle.render_width,
    headerTitleY: chartStyle.header_title_y, headerTitleSize: chartStyle.header_title_size, headerSubtitleSize: chartStyle.header_subtitle_size,
    headerTitleGap: chartStyle.header_title_gap, headerBottomGap: chartStyle.header_bottom_gap, headerX: chartStyle.header_x, headerEmptyTop: chartStyle.header_empty_top,
    padLeft: chartStyle.pad_left, padRight: chartStyle.pad_right, padBottom: chartStyle.pad_bottom, ticks: chartStyle.ticks,
    barRadius: chartStyle.bar_radius, valueOffset: chartStyle.value_offset, lineWidth: chartStyle.line_width, pointRadius: chartStyle.point_radius,
    textSize: chartStyle.text_size, barSlotRatio: chartStyle.bar_slot_ratio, barMaxWidth: chartStyle.bar_max_width, barValueSize: chartStyle.bar_value_size,
    barLabelSize: chartStyle.bar_label_size, barLabelGap: chartStyle.bar_label_gap, tickLabelOffset: chartStyle.tick_label_offset,
    lineAreaOpacity: chartStyle.line_area_opacity,
    tickLabelBaseline: chartStyle.tick_label_baseline, tickLabelSize: chartStyle.tick_label_size, gridLineWidth: chartStyle.grid_line_width,
    lineLabelGap: chartStyle.line_label_gap, lineLabelSize: chartStyle.line_label_size, lineValueOffset: chartStyle.line_value_offset, lineValueSize: chartStyle.line_value_size,
    linePointStrokeWidth: chartStyle.line_point_stroke_width,
  });
  chartMetrics.measureBlock = chartCapabilities.measureBlock;
  const chartResult = createTextCompositionEngine(chartTemplate).plan(chartDocument, chartMetrics);
  assert.equal(chartResult.evaluation.status, 'accepted', JSON.stringify(chartResult.evaluation));
  assert.equal(chartResult.plan.blockPlacements.length, 1);
  const chartArtifact = renderComposition(chartDocument, chartResult, createJsPdfTextBackend(chartPdf, 'helvetica', styles, {
    pageSizeTolerance: renderConfig.pdf.page_size_tolerance,
    blockRenderers: { chart: chartCapabilities.renderer },
  }));
  const chartOutput = join(temporary, 'chart.pdf');
  await writeFile(chartOutput, chartArtifact);
  const chartText = runProcess('pdftotext', [chartOutput, '-']);
  assert.equal(chartText.status, 0, chartText.stderr);
  assert.match(chartText.stdout, /Reach by channel/u);
  assert.match(chartText.stdout, /Search/u);
  assert.match(chartText.stdout, /12/u);
  for (const type of ['line', 'pie']) {
    const variantDocument = structuredClone(chartDocument);
    variantDocument.flows.main.blocks[0].chart.type = type;
    const variantPdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    const variantMetrics = createJsPdfTextMetrics(variantPdf, 'helvetica', styles);
    variantMetrics.measureBlock = chartCapabilities.measureBlock;
    const variantResult = createTextCompositionEngine(chartTemplate).plan(variantDocument, variantMetrics);
    assert.equal(variantResult.evaluation.status, 'accepted', JSON.stringify(variantResult.evaluation));
    const variantArtifact = renderComposition(variantDocument, variantResult, createJsPdfTextBackend(variantPdf, 'helvetica', styles, {
      pageSizeTolerance: renderConfig.pdf.page_size_tolerance,
      blockRenderers: { chart: chartCapabilities.renderer },
    }));
    const variantOutput = join(temporary, `chart-${type}.pdf`);
    await writeFile(variantOutput, variantArtifact);
    const variantText = runProcess('pdftotext', [variantOutput, '-']);
    assert.equal(variantText.status, 0, variantText.stderr);
    assert.match(variantText.stdout, /Reach by channel/u);
    assert.match(variantText.stdout, /Search/u);
  }
  const smallChartTemplate = structuredClone(chartTemplate);
  smallChartTemplate.layouts[0].slots[0].box.height = 20;
  smallChartTemplate.layouts[0].slots[1].box.y = 32;
  smallChartTemplate.layouts[0].slots[1].box.height = 60;
  const smallChartResult = createTextCompositionEngine(smallChartTemplate).plan(chartDocument, chartMetrics);
  assert.equal(smallChartResult.evaluation.status, 'accepted', JSON.stringify(smallChartResult.evaluation));
  assert.ok(smallChartResult.plan.blockPlacements[0].box.height <= 20);
  assert.ok(smallChartResult.plan.decisions.some((decision) => decision.code === 'BLOCK_SCALED_TO_FIT' && decision.blockId === 'chart-1'));
  assert.throws(
    () => renderComposition(chartDocument, chartResult, createJsPdfTextBackend(new jsPDF({ unit: 'mm', format: [100, 100] }), 'helvetica', styles, { pageSizeTolerance: renderConfig.pdf.page_size_tolerance })),
    /No jsPDF composition block renderer was provided for 'chart'/u,
  );

  const tablePdfTemplate = {
    maxPages: 2,
    layouts: [
      { id: 'table-opening', width: 100, height: 100, slots: [{ id: 'table', regionId: 'table', kind: 'block', allowedBlockKinds: ['table'], box: { x: 8, y: 8, width: 84, height: 25 } }] },
      { id: 'table-continuation', width: 100, height: 100, slots: [
        { id: 'table', regionId: 'table', kind: 'block', allowedBlockKinds: ['table'], box: { x: 8, y: 8, width: 84, height: 25 } },
        { id: 'body', regionId: 'main', kind: 'text', box: { x: 8, y: 38, width: 84, height: 50 } },
      ] },
    ],
    routes: { main: { slots: ['table'], slotsByLayout: { 'table-continuation': ['table', 'body'] }, layouts: ['table-opening', 'table-continuation'], continuation: 'allowed' } },
  };
  const tableDocument = {
    flows: { main: { id: 'main', continuation: 'allowed', blocks: [
      { id: 'table-1', kind: 'table', role: 'table', table: { head: ['Channel', 'Reach'], body: [['Search', 12], ['Social', 8], ['Email', 5], ['Direct', 3]] } },
      { id: 'table-body', kind: 'paragraph', role: 'body', text: 'The narrative follows the final table fragment.' },
    ] } },
  };
  const tablePdf = new jsPDF({ unit: 'mm', format: [100, 100] });
  const tableMetrics = createJsPdfTextMetrics(tablePdf, 'helvetica', styles);
  const tableCapabilities = createJsPdfTableBlockCapabilities(tablePdf, 'helvetica', {
    headerFillColor: [35, 80, 150], headerTextColor: [255, 255, 255], rowFillColor: [248, 250, 252], alternateRowFillColor: [235, 240, 248],
    textColor: [20, 30, 45], lineColor: [180, 190, 205], fontSize: 7, lineHeightRatio: 1.2, cellPadding: 1.5, lineWidth: 0.2, maxRowsPerFragment: 2,
  });
  tableMetrics.measureTable = tableCapabilities.measureTable;
  const tableResult = createTextCompositionEngine(tablePdfTemplate).plan(tableDocument, tableMetrics);
  assert.equal(tableResult.evaluation.status, 'accepted', JSON.stringify(tableResult.evaluation));
  assert.deepEqual(tableResult.plan.tablePlacements.map((placement) => [placement.page, placement.startRow, placement.endRow, placement.repeatsHeader]), [[1, 0, 2, false], [2, 2, 4, true]]);
  const tableArtifact = renderComposition(tableDocument, tableResult, createJsPdfTextBackend(tablePdf, 'helvetica', styles, {
    pageSizeTolerance: renderConfig.pdf.page_size_tolerance,
    tableRenderer: tableCapabilities.renderer,
  }));
  const tableOutput = join(temporary, 'table.pdf');
  await writeFile(tableOutput, tableArtifact);
  const tableText = runProcess('pdftotext', [tableOutput, '-']);
  assert.equal(tableText.status, 0, tableText.stderr);
  assert.match(tableText.stdout, /Channel/u);
  assert.match(tableText.stdout, /Direct/u);
  assert.match(tableText.stdout, /narrative follows/u);
  assert.throws(
    () => renderComposition(tableDocument, tableResult, createJsPdfTextBackend(new jsPDF({ unit: 'mm', format: [100, 100] }), 'helvetica', styles, { pageSizeTolerance: renderConfig.pdf.page_size_tolerance })),
    /No jsPDF composition table renderer was provided/u,
  );
  console.log(JSON.stringify({ status: 'passed', pages: pdf.getNumberOfPages(), bytes: artifact.length }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
