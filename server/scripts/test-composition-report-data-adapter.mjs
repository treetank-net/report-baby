import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-data-'));
const bundle = join(temporary, 'composition/index.cjs');
const schemaBundle = join(temporary, 'contracts/input/schema.cjs');
await build({
  entryPoints: ['src/composition/index.ts', 'src/contracts/input/schema.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: temporary,
  outExtension: { '.js': '.cjs' },
});

try {
  const composition = await import(bundle);
  const { compositionInputSchema } = await import(schemaBundle);
  const { compositionDocumentFromInput } = composition.default ?? composition;
  const legacyFixture = {
    title: 'A semantic report',
    subtitle: 'The public input remains compact.',
    period: 'Q3',
    intro: 'Lead **text** and *emphasis* with an inline image.\n\nSecond paragraph.',
    kpis: [{ label: 'Reach', value: 1200, delta: '+12%', trend: 'up', note: 'Compared with Q2' }],
    charts: [{ type: 'bar', title: 'Reach by channel', data: [{ label: 'Web', value: 700 }] }],
    sections: [{ heading: 'A section', body: 'Section body.\n\n![A map](assets/map.png "Map")\n\n<div>Unsupported authored markup</div>', level: 1 }],
    table: { caption: 'A table', head: ['Name'], body: [['Ada']] },
    highlights_title: 'Highlights',
    highlights: ['First highlight', 'Second highlight'],
    footer: 'Prepared for the editorial team.',
  };
  const input = legacyFixtureToCompositionInput(legacyFixture);
  const document = compositionDocumentFromInput(input);

  assert.deepEqual(Object.keys(document.flows), ['main', 'header', 'footer']);
  assert.deepEqual(document.flows.main.blocks.map((block) => block.id), [
    'intro',
    'metric-1',
    'chart-1',
    'section-1-heading',
    'section-1-body',
    'section-1-body:image-1',
    'table-heading',
    'table',
    'highlights-heading',
    'highlight-1',
    'highlight-2',
  ]);
  assert.deepEqual(document.flows.main.blocks.map((block) => block.kind), [
    'paragraph',
    'metric',
    'chart',
    'heading',
    'paragraph',
    'image',
    'heading',
    'table',
    'heading',
    'list-item',
    'list-item',
  ]);
  assert.equal(document.flows.main.blocks[0].kind, 'paragraph');
  assert.match(document.flows.main.blocks[0].text, /Lead text and emphasis with an inline image/);
  assert.deepEqual(document.flows.main.blocks[0].inlineRuns?.map(({ text, marks }) => ({ text, marks })), [
    { text: 'Lead ', marks: [] },
    { text: 'text', marks: ['strong'] },
    { text: ' and ', marks: [] },
    { text: 'emphasis', marks: ['emphasis'] },
    { text: ' with an inline image.\nSecond paragraph.', marks: [] },
  ], 'normalized inline AST must survive the composition adapter as renderer-neutral runs');
  assert.equal(document.flows.main.blocks[1].metric.value, 1200);
  assert.equal(document.flows.main.blocks[2].chart.data[0].label, 'Web');
  assert.equal(document.flows.main.blocks[3].level, 1);
  const imageBlock = document.flows.main.blocks[5];
  const imageNode = imageBlock.content.find((node) => node.type === 'image');
  assert.equal(imageNode.src, 'assets/map.png');
  assert.equal(imageBlock.kind, 'image');
  assert.equal(imageBlock.image.assetId, 'section-1-body:asset-1');
  assert.deepEqual(document.assets, [{ id: 'section-1-body:asset-1', source: 'assets/map.png', alt: 'A map', caption: 'Map', width: 'full', fit: 'contain', keepWithCaption: true }]);
  assert.equal(document.diagnostics.length, 1);
  assert.match(document.diagnostics[0], /Unsupported raw HTML/);
  assert.equal(document.flows.main.blocks[6].atomic, undefined);
  assert.equal(document.flows.main.blocks[10].text, 'Second highlight');
  assert.equal(document.flows.footer.continuation, 'forbidden');

  const publicGraphicInput = compositionInputSchema.parse({
    flows: { main: { blocks: [{ type: 'text', id: 'graphic-body', text: 'Text around the authored graphic.' }] } },
    assets: [{ id: 'hero-asset', source: 'assets/hero.png' }],
    graphics: [{ id: 'hero-panel', asset_id: 'hero-asset', slot_id: 'hero-slot', shape: 'rectangle', wrap: 'around', page: 1, size: { width: 20, height: 10 }, alt: 'Hero panel' }],
  });
  const publicGraphicDocument = compositionDocumentFromInput(publicGraphicInput);
  assert.deepEqual(publicGraphicDocument.graphics, [{
    id: 'hero-panel',
    assetId: 'hero-asset',
    slotId: 'hero-slot',
    size: { width: 20, height: 10 },
    shape: 'rectangle',
    wrap: 'around',
    page: 1,
    alt: 'Hero panel',
  }]);
  assert.throws(
    () => compositionInputSchema.parse({ flows: { main: { blocks: [{ type: 'text', role: 'quote', text: 'Inline quotes are no longer main-flow content.' }] } } }),
    /main flow cannot contain quote blocks/u,
    'public input must put quotes in a separate flow',
  );

  const empty = compositionDocumentFromInput({ flows: { main: { blocks: [], continuation: 'allowed' } } });
  assert.deepEqual(Object.keys(empty.flows), ['main']);
  assert.deepEqual(empty.flows.main.blocks, []);
  const nestedImage = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    sections: [{ heading: 'Nested image', content: [{ type: 'paragraph', content: [{ type: 'strong', content: [
      { type: 'text', text: 'Before' },
      { type: 'image', src: 'assets/nested.png', alt: 'Nested' },
      { type: 'text', text: 'After' },
    ] }] }] }],
  }));
  assert.deepEqual(nestedImage.flows.main.blocks.map((block) => block.kind), ['heading', 'paragraph', 'image', 'paragraph']);
  assert.deepEqual(nestedImage.assets?.map((asset) => asset.id), ['section-1-body:asset-1']);
  const introImage = compositionDocumentFromInput(legacyFixtureToCompositionInput({
    intro: 'Lead text before the image.\n\n![Intro fixture](assets/intro.png)\n\nLead text after the image.',
  }));
  assert.deepEqual(introImage.flows.main.blocks.map((block) => block.kind), ['paragraph', 'image', 'paragraph']);
  assert.deepEqual(introImage.assets?.map((asset) => asset.id), ['intro:asset-1']);
  console.log(JSON.stringify({ status: 'passed', flows: Object.keys(document.flows), blocks: document.flows.main.blocks.length }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
