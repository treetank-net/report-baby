#!/usr/bin/env node

// PROTOTYPE TEST — proves that planning can run with a renderer-neutral
// metrics adapter and does not need to construct a jsPDF document.

import { planFixture } from './prototype-composition-kernel.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const metrics = {
  units: 'mm',
  family: 'seam-test-metrics',
  measureText(text, styleName) {
    const glyphWidth = styleName === 'heading' ? 2.4 : styleName === 'intro' ? 2 : 1.5;
    return [...text].length * glyphWidth;
  },
  lineHeight(styleName) {
    return styleName === 'heading' ? 6 : styleName === 'intro' ? 5 : 4;
  },
};

for (const [label, measureText] of [['non-finite', () => Number.NaN], ['negative', () => -1]]) {
  let invalidMetricsRejected = false;
  try {
    planFixture({ id: `invalid-metrics-${label}`, intro: 'invalid metrics', blocks: [], sidebar: [], images: [], writing: { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' }, keeps: [], policies: {} }, {
      units: 'mm',
      measureText,
      lineHeight() { return 4; },
    });
  } catch (error) {
    invalidMetricsRejected = /invalid width/u.test(error.message);
  }
  assert(invalidMetricsRejected, `planner seam accepted ${label} text metrics`);
}

const { plan } = planFixture({
  id: 'planner-seam',
  title: 'Renderer-neutral planner seam',
  intro: 'The planner receives measurements, not a PDF document.',
  blocks: [
    { id: 'heading', type: 'heading', role: 'section_heading', text: 'A heading stays in the plan' },
    { id: 'body', type: 'paragraph', role: 'body', text: 'A short paragraph proves that layout can be calculated with a replaceable metrics adapter.' },
  ],
  sidebar: [],
  images: [],
  writing: { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' },
  keeps: [],
  policies: { profile: 'editorial', maxPages: 8 },
  brand: null,
  source: { productFixture: 'planner-seam' },
}, metrics);

assert(plan.status !== 'rejected', `planner seam unexpectedly rejected: ${JSON.stringify(plan.evaluation)}`);
assert(plan.lines.length > 0, 'planner seam produced no lines');
assert(plan.pages.length === 1, `planner seam expected one page, got ${plan.pages.length}`);
assert(plan.renderer?.fontFamily, 'planner seam did not retain renderer metadata');
console.log(JSON.stringify({ status: 'passed', planner: 'renderer-neutral', lines: plan.lines.length, pages: plan.pages.length }, null, 2));
