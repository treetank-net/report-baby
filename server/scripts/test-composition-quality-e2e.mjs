#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-quality-e2e-'));
const bundles = {
  adapter: join(temporary, 'composition/report-composition-entrypoint.cjs'),
  backend: join(temporary, 'composition/index.cjs'),
  pdfBackend: join(temporary, 'composition/adapters/pdf/backend.cjs'),
  primitives: join(temporary, 'rendering/primitives.cjs'),
  template: join(temporary, 'template/contracts.cjs'),
  geometry: join(temporary, 'template/geometry.cjs'),
};

async function buildPlanningBundles() {
  await build({
    entryPoints: [
      'src/composition/report-composition-entrypoint.ts',
      'src/composition/index.ts',
      'src/composition/adapters/pdf/backend.ts',
      'src/rendering/primitives.ts',
      'src/template/contracts.ts',
      'src/template/geometry.ts',
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir: temporary,
    outExtension: { '.js': '.cjs' },
    loader: { '.wasm': 'binary', '.ttf': 'binary' },
  });
}

function qualitySource(source) {
  const result = structuredClone(source);
  result.regions = { body: { x: 0.081, y: 0.25, width: 0.838, height: 0.68 } };
  delete result.slots['quote-a'];
  delete result.slots['quote-b'];
  delete result.slots['quote-c'];
  result.slots['quote-capability'] = {
    type: 'text',
    region: 'body',
    frame: { x: 0.081, y: 0.34, width: 0.838, height: 0.36 },
    role: 'quote',
    fit_content: true,
    placement: { mode: 'fluid-y', region: 'body', max_instances_per_page: 2, distribution: 'balanced' },
  };
  result.flows.quotes.slots = ['quote-capability'];
  result.flows.quotes.insertion_slots = ['quote-capability'];
  return result;
}

function assertSpacingEvidence(result) {
  const spacing = result.plan.spacing;
  assert.ok(spacing, 'an end-to-end plan must expose renderer-neutral spacing evidence');
  assert.equal(spacing.pages.length, result.plan.pages.length, 'spacing report must cover every planned page');
  assert.equal(spacing.slots.length, result.plan.slots.length, 'spacing report must cover every materialized slot');
  assert.ok(spacing.observations.some((observation) => observation.kind === 'region'), 'spacing report must expose region observations');
  const insertionPlacements = result.plan.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:'));
  const insertionObservations = spacing.observations.filter((observation) => observation.kind === 'insertion-rhythm');
  assert.equal(insertionObservations.length, insertionPlacements.length, 'every insertion obstacle must have rhythm evidence');
  for (const observation of insertionObservations) {
    assert.ok(observation.owner && observation.cause, 'insertion rhythm must identify its responsible layer and cause');
    assert.ok(observation.templateRef, 'insertion rhythm must identify the supplying template');
    assert.ok(Number.isFinite(observation.metrics.referenceGap), 'insertion rhythm must expose a numeric reference gap');
    assert.ok(observation.profile === 'normal' || observation.profile === 'compact' || observation.profile === 'open', 'insertion rhythm must expose a known profile');
  }
  for (const slot of spacing.slots) {
    assert.ok(slot.owner && slot.cause, `slot ${slot.slotId} must identify its responsible layer and cause`);
    assert.ok(slot.templateRef, `slot ${slot.slotId} must identify the supplying template`);
    const area = slot.box.width * slot.box.height;
    assert.ok(Number.isFinite(slot.occupiedArea) && Number.isFinite(slot.emptyArea), `slot ${slot.slotId} must expose numeric area evidence`);
    assert.ok(Math.abs(slot.occupiedArea + slot.emptyArea - area) < 1e-6, `slot ${slot.slotId} area evidence must partition its envelope`);
  }
  const expectedQualityCodes = [
    'sibling-column-imbalance',
    'empty-regions',
    'insertion-symmetry',
    'insertion-distribution',
    'spacing-rhythm',
    'narrow-text-interval',
    'fit-content-envelope',
    'footer-gap',
    'main-start-delay',
    'element-proximity',
    'glyph-overlap',
  ];
  const scoreCodes = new Set(result.evaluation.scoreBreakdown.map((component) => component.code));
  for (const code of expectedQualityCodes) assert.ok(scoreCodes.has(code), `evaluation must include quality component ${code}`);
  for (const suggestion of result.evaluation.suggestions ?? []) {
    assert.ok(suggestion.evidence, `suggestion ${suggestion.code} must include measured evidence`);
    assert.ok(Array.isArray(suggestion.remedies) && suggestion.remedies.length > 0, `suggestion ${suggestion.code} must include remediation`);
    assert.ok(suggestion.why, `suggestion ${suggestion.code} must explain the violation`);
  }
}

await buildPlanningBundles();

try {
  const { planReportComposition, compositionPdfBackendOptionsFromRenderConfig, compositionStylesFromRenderConfig } = await import(bundles.adapter);
  const { renderComposition, evaluateCompositionPlan } = await import(bundles.backend);
  const { createJsPdfTextBackend } = await import(bundles.pdfBackend);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-inset-two-column/template.yml'), 'utf8'));
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const compiled = compileTemplateSource(qualitySource(source));
  const geometry = pageGeometryFromTemplate(compiled);
  const fixture = createEditorialNumberedFixture({
    quoteMarkGap: renderConfig.pdf.quote_mark_gap,
    quoteMarkOffsetX: renderConfig.pdf.quote_mark_offset_x,
    quoteMarkOffsetY: renderConfig.pdf.quote_mark_offset_y,
  });
  const styles = compositionStylesFromRenderConfig({
    foreground: [25, 51, 79],
    muted: [88, 106, 131],
    primary: [42, 110, 166],
    quote: [232, 117, 61],
  });
  const pdf = newPdf('portrait', [geometry.width, geometry.height]);
  const result = planReportComposition(
    pdf,
    compiled,
    geometry,
    fixture.input,
    { family: 'DejaVu', maxPages: 6, styles },
  );
  assert.equal(result.evaluation.status, 'accepted', JSON.stringify(result.evaluation));
  assert.deepEqual(result.plan.residualContent, [], JSON.stringify(result.plan.residualContent));
  const quoteSlots = result.plan.slots.filter((slot) => slot.id.includes('quote-capability#'));
  assert.ok(quoteSlots.length > 0, 'fluid insertion capability must materialize page-local slot instances in the actual plan');
  assert.ok(quoteSlots.every((slot) => slot.id.includes('#1') || slot.id.includes('#2')), 'fluid capability must stay bounded to its declared per-page capacity');
  assert.ok(result.plan.insertionLines?.length >= 4, 'the real editorial fixture must place all authored quote insertions');
  assert.ok((result.plan.trace?.candidateSearch?.generatedCandidates ?? 0) >= 2, 'a dynamic intro must produce an earliest-slot and an optional skip-first insertion candidate');
  assertSpacingEvidence(result);
  const proximityPlan = structuredClone(result.plan);
  proximityPlan.spacing.observations.push({
    kind: 'element-proximity',
    page: 1,
    from: { kind: 'block', id: 'intro-lead', flowId: 'intro', blockId: 'intro-lead', slotId: '1:intro' },
    to: { kind: 'graphic', id: 'insertion:quote-near-intro', flowId: 'quotes', blockId: 'quote-near-intro', slotId: '1:quote-capability#1' },
    fromBox: { x: 20, y: 40, width: 170, height: 18 },
    toBox: { x: 20, y: 59, width: 170, height: 12 },
    metrics: { gap: 1, minimumGap: 6, deficit: 5, movementNeeded: 5, movementBudget: 8 },
    movementAvailable: true,
    reasons: ['elements-too-close'],
  });
  const proximityEvaluation = evaluateCompositionPlan(result.document, proximityPlan);
  const proximitySuggestion = proximityEvaluation.suggestions?.find((suggestion) => suggestion.code === 'ELEMENTS_TOO_CLOSE');
  assert.ok(proximitySuggestion, 'a measured pairwise gap must become a public evaluator suggestion');
  assert.equal(proximitySuggestion.evidence.records[0].fromBox.y, 40, 'the public suggestion must expose measured geometry');
  assert.equal(proximitySuggestion.evidence.records[0].to.blockId, 'quote-near-intro', 'the public suggestion must name both source elements');
  const artifact = renderComposition(result.document, result, createJsPdfTextBackend(
    pdf,
    'DejaVu',
    styles,
    compositionPdfBackendOptionsFromRenderConfig(),
  ));
  const artifactPath = '/tmp/report-baby-composition-quality-e2e.pdf';
  await writeFile(artifactPath, artifact);
  assert.equal(artifact.subarray(0, 5).toString(), '%PDF-', 'the representative composition must render as a PDF');
  console.log(JSON.stringify({
    status: 'passed',
    mode: 'plan-and-representative-artifact',
    pages: result.plan.pages.length,
    insertionSlots: quoteSlots.length,
    insertionLines: result.plan.insertionLines?.length ?? 0,
    observations: result.plan.spacing?.observations.length ?? 0,
    scoreBreakdown: result.evaluation.scoreBreakdown.map(({ code, value, points }) => ({ code, value, points })),
    suggestions: result.evaluation.suggestions?.map(({ code, why, remedies, evidence }) => ({ code, why, remedies, evidence })) ?? [],
    artifactPath,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
