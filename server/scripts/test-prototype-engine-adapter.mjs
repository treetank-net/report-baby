#!/usr/bin/env node

// Proves that the semantic composition-engine input is only a naming seam:
// adapting the same fixture must produce the same plan as the legacy kernel.

import assert from 'node:assert/strict';
import { createPrototypePlanner, planFixture } from './prototype-composition-kernel.mjs';
import { documentFromLegacyFixture, legacyFixtureFromDocument, planComposition, planCompositionContract } from './lib/composition-engine.mjs';

const metrics = {
  units: 'mm',
  family: 'adapter-parity-metrics',
  measureText(text, styleName) {
    const glyphWidth = styleName === 'heading' ? 2.4 : styleName === 'intro' ? 2 : 1.5;
    return [...text].length * glyphWidth;
  },
  lineHeight(styleName) {
    return styleName === 'heading' ? 6 : styleName === 'intro' ? 5 : 4;
  },
};

const fixture = {
  id: 'composition-engine-adapter-parity',
  title: 'Composition engine adapter parity',
  intro: 'A semantic document should produce the same plan as its legacy fixture.',
  blocks: [
    { id: 'heading', type: 'heading', role: 'section_heading', text: 'A heading remains in the same place', keepNext: { lines: 2 } },
    { id: 'body', type: 'paragraph', role: 'body', text: 'The adapter changes names and shape, not the planner output.' },
  ],
  sidebar: [
    { id: 'side', type: 'paragraph', role: 'sidebar', text: 'Sidebar content remains on its own flow.' },
  ],
  images: [],
  writing: { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' },
  keeps: [],
  policies: { profile: 'editorial', maxPages: 8 },
  brand: null,
  source: { productFixture: 'composition-engine-adapter-parity' },
};

const before = structuredClone(fixture);
const legacyPlan = planFixture(fixture, metrics).plan;
const document = documentFromLegacyFixture(fixture);
const adaptedPlan = planComposition(document, metrics).plan;
const contractResult = planCompositionContract(document, metrics);

assert.deepStrictEqual(fixture, before, 'adapter mutated the legacy fixture');
assert.equal('blocks' in document, false, 'semantic document still exposes legacy blocks');
assert.equal('sidebar' in document, false, 'semantic document still exposes legacy sidebar');
assert.deepStrictEqual(adaptedPlan, legacyPlan, 'semantic adapter changed the plan output');
assert.equal(contractResult.evaluation.status, 'accepted');
assert.equal(contractResult.plan.pages.length, legacyPlan.pages.length);
assert.equal(contractResult.plan.lines.length, legacyPlan.lines.length);
assert.equal(contractResult.plan.slots.length, legacyPlan.pages.reduce((total, page) => total + page.article.tracks.length + 1, 0));
assert.ok(contractResult.plan.placements.length >= contractResult.plan.lines.length);
assert.ok(contractResult.plan.slots.some((slot) => slot.state === 'partial' || slot.state === 'exhausted'), 'used slots must expose their occupancy state');
assert.ok(contractResult.plan.slots.some((slot) => slot.state === 'open'), 'unused slots must remain available');
assert.equal(contractResult.raw.plan.fixture, legacyPlan.fixture);

const semanticBlocks = {
  id: 'semantic-blocks',
  writing: fixture.writing,
  keeps: [],
  policies: fixture.policies,
  images: [],
  flows: {
    main: {
      blocks: [
        { id: 'semantic-heading', kind: 'heading', role: 'heading', text: 'A semantic heading', keepWithNextLines: 2 },
        { id: 'semantic-body', kind: 'paragraph', role: 'body', text: 'A semantic paragraph.' },
      ],
    },
    sidebar: { blocks: [] },
  },
};
const translated = legacyFixtureFromDocument(semanticBlocks);
assert.equal(translated.blocks[0].type, 'heading');
assert.equal(translated.blocks[0].role, 'section_heading');
assert.deepEqual(translated.blocks[0].keepNext, { lines: 2 });
assert.equal(translated.blocks[1].type, 'paragraph');
const semanticPlan = planComposition(semanticBlocks, metrics).plan;
assert.notEqual(semanticPlan.status, 'rejected', 'semantic block translation should remain plannable');
assert.ok(semanticPlan.lines.some((line) => line.blockId === 'semantic-heading'));
assert.ok(semanticPlan.lines.some((line) => line.blockId === 'semantic-body'));

const injectedPlanner = createPrototypePlanner({
  preset: 'injected-test-layout',
  page: { width: 180, height: 240, margin: { top: 10, right: 10, bottom: 10, left: 10 } },
  template: {
    id: 'injected-test-layout',
    header: { min: 8, preferred: 8, max: 8, lines: 1 },
    footer: { min: 6, preferred: 6, max: 6, lines: 1 },
    bodyGap: 3,
    articleSidebarGap: 4,
    articleWidth: 120,
    sidebarWidth: 36,
    articleTracks: [{ id: 'lead', width: 58 }, { id: 'secondary', width: 58 }],
    trackGap: 4,
    flow: { align: 'left', wrapGap: 1, minimumTextWidth: 12 },
    maxPages: 2,
  },
});
const injectedPlan = injectedPlanner(translated, metrics).plan;
assert.equal(injectedPlan.preset, 'injected-test-layout');
assert.deepEqual(injectedPlan.pageSize, { width_mm: 180, height_mm: 240 });
assert.equal(injectedPlan.pages[0].article.tracks[0].width, 58);

const remainderFixture = {
  ...translated,
  id: 'composition-engine-remainder-range',
  blocks: [{
    id: 'remainder-block',
    type: 'paragraph',
    role: 'body',
    text: `${'word '.repeat(5000).trim()}`,
  }],
  sidebar: [],
  policies: { ...translated.policies, maxPages: 1 },
};
const remainderResult = planCompositionContract(documentFromLegacyFixture(remainderFixture), metrics);
const remainder = remainderResult.plan.residualContent.find((item) => item.blockId === 'remainder-block');
assert.ok(remainder, 'partial planning must expose residual content');
assert.ok(remainder.consumed && remainder.remaining, 'residual content must expose word ranges');
assert.equal(remainder.consumed.start, 0);
assert.equal(remainder.remaining.start, remainder.consumed.end);
assert.equal(remainder.remaining.end, 5000);
assert.ok(remainder.lastLegalSlotId, 'residual content must retain the last legal target');

assert.throws(
  () => legacyFixtureFromDocument({ flows: { main: { blocks: [] }, footer: { blocks: [{ id: 'footer', kind: 'paragraph', role: 'footer', text: 'Footer' }] } } }),
  /cannot route flow 'footer'/u,
  'unsupported flows must not be silently discarded',
);

console.log(JSON.stringify({
  status: 'passed',
  adapter: 'semantic-to-legacy-kernel',
  pages: adaptedPlan.pages.length,
  lines: adaptedPlan.lines.length,
  decisions: adaptedPlan.decisions.length,
}, null, 2));
