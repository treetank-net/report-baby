#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-soft-insertions-'));
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
if (build.status !== 0) throw new Error(`soft insertion test bundle failed: ${build.stderr || build.stdout}`);

try {
  const { createTextCompositionEngine, createTextCompositionPlanner, evaluateCompositionPlan } = await import(bundle);
  const template = {
    maxPages: 1,
    layouts: [{ id: 'atomic-insertions', width: 100, height: 140, slots: [
      { id: 'body', regionId: 'main', kind: 'text', box: { x: 5, y: 5, width: 90, height: 30 }, allowedRoles: ['body'] },
      { id: 'metric', regionId: 'insertions', kind: 'block', box: { x: 5, y: 40, width: 20, height: 30 }, allowedRoles: ['metric'], allowedBlockKinds: ['metric'], fitContent: true },
      { id: 'chart', regionId: 'insertions', kind: 'block', box: { x: 30, y: 40, width: 30, height: 20 }, allowedRoles: ['chart'], allowedBlockKinds: ['chart'] },
      { id: 'image', regionId: 'insertions', kind: 'block', box: { x: 65, y: 40, width: 30, height: 20 }, allowedRoles: ['body'], allowedBlockKinds: ['image'] },
      { id: 'table', regionId: 'insertions', kind: 'block', box: { x: 5, y: 70, width: 90, height: 30 }, allowedRoles: ['table'], allowedBlockKinds: ['table'], fitContent: true, grow: { axis: 'y', maxHeight: 40 } },
    ] }],
    routes: {
      main: { slots: ['body'], continuation: 'forbidden' },
      insertions: { slots: ['metric', 'chart', 'image', 'table'], insertionSlots: ['metric', 'chart', 'image', 'table'], continuation: 'forbidden' },
    },
  };
  const document = {
    flows: {
      main: { id: 'main', continuation: 'forbidden', blocks: [{ id: 'body-copy', kind: 'paragraph', role: 'body', text: 'The ordinary text must remain in main and wrap around insertion obstacles.' }] },
      insertions: { id: 'insertions', continuation: 'forbidden', blocks: [
        { id: 'metric-card', kind: 'metric', role: 'metric', atomic: true, metric: { label: 'Revenue', value: 42 } },
        { id: 'chart-block', kind: 'chart', role: 'chart', atomic: true, chart: { type: 'bar', data: [{ label: 'A', value: 1 }] } },
        { id: 'image-block', kind: 'image', role: 'body', atomic: true, image: { assetId: 'photo', width: 'full', fit: 'contain', keepWithCaption: false } },
        { id: 'table-block', kind: 'table', role: 'table', table: { head: ['Name'], body: [['A'], ['B']] } },
      ] },
    },
    assets: [{ id: 'photo', source: 'photo.png', width: 'full', fit: 'contain', keepWithCaption: false }],
  };
  const metrics = {
    units: 'mm',
    family: 'test',
    measureText(text) { return text.length; },
    lineHeight() { return 5; },
    textPadding() { return { top: 0, bottom: 0 }; },
    measureBlock(block) { return { height: block.kind === 'image' ? 16 : 12 }; },
    measureTable(block, box) { return { height: box.height >= 40 ? 20 : 30, endRow: block.table.body.length }; },
  };
  const result = createTextCompositionEngine(template).plan(document, metrics);
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.equal(result.plan.residualContent.length, 0, JSON.stringify(result.plan.residualContent));
  assert.deepEqual(new Set(result.plan.blockPlacements.map((placement) => placement.blockId)), new Set(['metric-card', 'chart-block', 'image-block']), 'all atomic insertion kinds must be placed through block capabilities');
  assert.deepEqual(result.plan.tablePlacements.map((placement) => placement.blockId), ['table-block'], 'table insertion must use the table placement contract');
  const metricSlot = result.plan.slots.find((slot) => slot.id === '1:metric');
  const metricObstacle = result.plan.graphicPlacements.find((placement) => placement.graphicId === 'insertion:metric-card');
  assert.ok(metricSlot && metricSlot.box.height < 30, 'fit-content metric insertion must shrink to its measured height');
  assert.ok(metricObstacle && metricSlot && metricObstacle.box.height === metricSlot.box.height, 'metric exclusion obstacle must use the measured height');
  const tableSlot = result.plan.slots.find((slot) => slot.id === '1:table');
  const tableObstacle = result.plan.graphicPlacements.find((placement) => placement.graphicId === 'insertion:table-block');
  assert.equal(tableSlot?.box.height, 20, 'fit-content table insertion must measure against its auto-growth limit before fitting');
  assert.ok(tableObstacle && tableSlot && tableObstacle.box.height === tableSlot.box.height, 'table exclusion obstacle must use the fitted table height');
  assert.equal(result.plan.insertionLines?.length ?? 0, 0, 'atomic and table insertions must not be fabricated as text lines');
  assert.equal(result.plan.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:')).length, 4, 'every insertion kind must reserve one text-flow obstacle');
  assert.ok(result.plan.decisions.filter((decision) => decision.code === 'INSERTION_LAYER_PLACED').length === 4, 'every insertion kind must expose one placement decision');
  const rechecked = evaluateCompositionPlan(document, result.plan);
  assert.equal(rechecked.status, 'accepted', JSON.stringify(rechecked));
  const movable = createTextCompositionEngine(template, {
    movableInsertionBounds: {
      'insertions:metric-card': {
        bounds: { x: 5, y: 40, width: 20, height: 30 },
        axis: 'y',
        candidateCount: 2,
      },
    },
  }).plan(document, metrics);
  const metricPositions = createTextCompositionPlanner(template, {
    movableInsertionBounds: {
      'insertions:metric-card': {
        bounds: { x: 5, y: 40, width: 20, height: 30 },
        axis: 'y',
        candidateCount: 2,
      },
    },
  }).planCandidates(document, metrics);
  assert.equal(movable.evaluation.status, 'accepted', JSON.stringify(movable.evaluation));
  assert.equal(metricPositions.length, 2, 'atomic insertion kinds must use the same bounded candidate seam');
  assert.equal(new Set(metricPositions.map((candidate) => candidate.blockPlacements.find((placement) => placement.blockId === 'metric-card')?.box.y)).size, 2, 'atomic insertion candidates must move the measured block box');
  console.log(JSON.stringify({
    status: 'passed',
    blockPlacements: result.plan.blockPlacements.map((placement) => placement.kind),
    tablePlacements: result.plan.tablePlacements.length,
    insertionObstacles: result.plan.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:')).length,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
