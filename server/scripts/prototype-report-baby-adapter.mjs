#!/usr/bin/env node

// PROTOTYPE — adapter from the existing Report Baby synthetic corpus to the
// composition-kernel fixture schema. It deliberately keeps the product
// renderer untouched and writes an external fixture catalog for the kernel.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  editorialRegressionReport,
  gapTighteningReport,
  inlineMarkupReport,
  multipageReport,
  pageFillReport,
  standardReport,
} from './lib/fixtures.mjs';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const root = resolve(here, '..');
const outputDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join('/tmp', 'report-baby-composition-report-fixtures'));
const outputPath = join(outputDir, 'fixtures.json');
const prototypeConfig = parse(await readFile(join(root, 'templates', 'composition-pixel-qa-prototype.yml'), 'utf8'));

const editorialPolicy = prototypeConfig.breaking_profiles.editorial;

function words(value) {
  return String(value ?? '').trim().split(/\s+/u).filter(Boolean);
}

function stripMarkdownImage(value) {
  return String(value ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function imageFromMarkdown(id, value, anchorBlock, options = {}) {
  const match = String(value ?? '').match(/!\[[^\]]*\]\(([^\s)]+)/u);
  if (!match) return null;
  return {
    id,
    source: match[1],
    shape: options.shape ?? 'rectangle',
    color: options.color ?? [212, 112, 84],
    anchorBlock,
    width: options.width ?? 46,
    height: options.height ?? 56,
    side: options.side ?? 'right',
    mode: options.mode ?? 'block',
    placement: 'flow',
    position: options.position ?? { mode: 'flow', reference: 'anchor-box', wrap: true },
    wrapFractions: options.wrapFractions ?? [0.48, 0.78],
    apex: options.apex ?? 'top',
    starPoints: options.starPoints ?? 5,
    starInnerRatio: options.starInnerRatio ?? 0.45,
    defer: false,
    keepWithAnchor: false,
    scaleToFit: true,
  };
}

function block(id, type, role, text, extra = {}) {
  return { id, type, role, text: String(text ?? '').trim(), ...extra };
}

function reportToFixture(id, report, options = {}) {
  const data = report.data ?? {};
  const blocks = [];
  const images = [];
  const pushSection = (section, index) => {
    const sectionId = `${id}-section-${index + 1}`;
    const heading = section.heading ?? `Section ${index + 1}`;
    blocks.push(block(`${sectionId}-heading`, 'heading', 'section_heading', heading, { keepNext: { lines: 3 } }));
    const body = String(section.body ?? section.text ?? '').trim();
    const rawParagraphs = body.split(/\n\s*\n/u);
    rawParagraphs.forEach((rawParagraph, paragraphIndex) => {
      const paragraph = stripMarkdownImage(rawParagraph);
      const bodyId = `${sectionId}-body-${paragraphIndex + 1}`;
      if (paragraph) blocks.push(block(bodyId, 'paragraph', 'body', paragraph));
      const anchorBlock = paragraph ? bodyId : blocks.at(-1)?.id ?? `${sectionId}-heading`;
      const image = imageFromMarkdown(`${sectionId}-image-${paragraphIndex + 1}`, rawParagraph, anchorBlock, options.image);
      if (image) images.push(image);
    });
  };

  (data.sections ?? []).forEach(pushSection);

  if (data.table) {
    const tableId = `${id}-table`;
    blocks.push(block(`${tableId}-heading`, 'heading', 'section_heading', data.table.caption ?? 'Table', { keepNext: { lines: 2 } }));
    const rows = [data.table.head ?? [], ...(data.table.body ?? [])]
      .map((row) => row.map((cell) => String(cell)).join(' · '))
      .filter(Boolean);
    blocks.push(block(tableId, 'table', 'table', rows.join(' '), { atomic: true }));
  }

  if (data.highlights?.length) {
    const highlightsId = `${id}-highlights`;
    blocks.push(block(`${highlightsId}-heading`, 'heading', 'section_heading', data.highlights_title ?? 'Highlights', { keepNext: { lines: 2 } }));
    data.highlights.forEach((item, index) => blocks.push(block(`${highlightsId}-${index + 1}`, 'list-item', 'body', `• ${item}`, { marker: true })));
  }

  const sectionsText = (data.sections ?? []).map((section) => `${section.heading ?? ''} ${section.body ?? ''}`).join(' ');
  const estimatedWords = words(sectionsText).length + words(data.intro).length;
  return {
    id,
    title: data.title ?? id,
    intro: data.intro ?? 'Synthetic Report Baby fixture adapted to the composition kernel.',
    blocks,
    sidebar: options.sidebar ?? [],
    images,
    writing: { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' },
    keeps: [],
    policies: { ...editorialPolicy, profile: 'editorial', maxPages: 8 },
    brand: options.brand ?? null,
    source: {
      productFixture: options.productFixture ?? id,
      template: report.template,
      estimatedWords,
      sourceKinds: [
        ...(data.sections?.length ? ['sections'] : []),
        ...(data.table ? ['table-adapted-as-text'] : []),
        ...(data.highlights?.length ? ['highlights-adapted-as-list'] : []),
        ...(images.length ? ['markdown-image'] : []),
      ],
    },
    qa: {
      family: 'report-baby-adapter',
      productFixture: options.productFixture ?? id,
      expected: 'pass',
      expectedStatus: options.expectedStatus,
      claims: options.claims ?? [],
      unsupportedSemantics: options.unsupportedSemantics ?? [],
    },
  };
}

const reports = [
  ...'ABCDEFGHI'.split('').map((variant) => [
    `report-baby-editorial-${variant.toLowerCase()}`,
    editorialRegressionReport(variant),
    { productFixture: `editorialRegressionReport(${variant})` },
  ]),
  ['report-baby-standard', standardReport(), { productFixture: 'standardReport()' }],
  ['report-baby-multipage', multipageReport(), { productFixture: 'multipageReport()' }],
  ['report-baby-inline-markup', inlineMarkupReport(), {
    productFixture: 'inlineMarkupReport()',
    unsupportedSemantics: ['styled-inline-runs are carried as plain source text in this adapter'],
  }],
  ['report-baby-page-fill-section', pageFillReport('section'), { productFixture: "pageFillReport('section')" }],
  ['report-baby-page-fill-highlights', pageFillReport('highlights'), { productFixture: "pageFillReport('highlights')" }],
  ['report-baby-page-fill-table', pageFillReport('table'), { productFixture: "pageFillReport('table')", unsupportedSemantics: ['table atomicity is represented as text, not a table fragment'] }],
  ['report-baby-gap-tightening', gapTighteningReport(), { productFixture: 'gapTighteningReport()' }],
  ['report-baby-inline-image-block', {
    template: 'pages/editorial-two-column',
    data: {
      title: 'Image report',
      sections: [{ heading: 'Map', body: 'A short introduction.\n\n![Map of the fleet](assets/map.png "Fleet map")' }],
    },
  }, {
    productFixture: 'test-report-images.mjs / Markdown image',
    image: { mode: 'block', shape: 'rectangle' },
    claims: ['image is placed once as a block and text remains selectable around it'],
    unsupportedSemantics: ['brand asset bytes are not loaded by the composition prototype'],
  }],
  ['report-baby-inline-image-float', {
    template: 'pages/editorial-two-column',
    data: {
      title: 'Float image report',
      sections: [{ heading: 'Map', body: `${'A paragraph before the image. '.repeat(12)}\n\n![Map of the fleet](assets/map.png "Fleet map")\n\n${'A paragraph after the image. '.repeat(26)}` }],
    },
  }, {
    productFixture: 'test-report-images.mjs / adapted float variant',
    image: { mode: 'float', shape: 'ellipse', width: 32, height: 48 },
    claims: ['image exclusion changes available line width without entering the image mask'],
    unsupportedSemantics: ['current production renderer treats this image as a block, not a float'],
  }],
  ['report-baby-absolute-image', {
    template: 'pages/editorial-two-column',
    data: {
      title: 'Absolute image frame report',
      sections: [{ heading: 'Anchored frame', body: `${'Text that should flow around an explicitly placed image frame. '.repeat(28)}\n\n![Decorative frame](assets/frame.png "Decorative frame")\n\n${'The continuation should keep the same reading order after the frame. '.repeat(24)}` }],
    },
  }, {
    productFixture: 'prototype absolute image extension',
    image: {
      mode: 'float',
      shape: 'star',
      width: 32,
      height: 48,
      position: { mode: 'absolute', reference: 'page', page: 0, frame: { x: 104, y: 82, width: 32, height: 48 }, wrap: true },
    },
    claims: ['absolute image frame is evaluated relative to the page rectangle', 'shape remains the exclusion geometry'],
    unsupportedSemantics: ['current production renderer has no equivalent absolute shape exclusion'],
  }],
];

const brandRefs = ['brand://flux/editorial', 'brand://orbit/primary', 'brand://parcelia/editorial', 'brand://pyrus/editorial'];
const fixtures = reports.map(([id, report, options]) => reportToFixture(id, report, { ...options, brand: { refs: brandRefs } }));

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  source: 'Report Baby server/scripts/lib/fixtures.mjs',
  brandRefs,
  fixtures,
}, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, fixtureCount: fixtures.length, productFixtures: fixtures.map((fixture) => fixture.source.productFixture) }, null, 2));
