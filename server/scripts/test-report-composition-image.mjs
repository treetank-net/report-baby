#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-image-'));
const rendererBundle = join(temporary, 'report-renderer.cjs');
const sourceBundle = join(temporary, 'source-context.cjs');

const rendererBuild = runProcess('npx', [
  'esbuild',
  'src/report/renderer.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  '--loader:.wasm=binary',
  '--loader:.ttf=binary',
  `--outfile=${rendererBundle}`,
], { cwd: root, timeout: 30_000 });
if (rendererBuild.status !== 0) throw new Error(`composition image renderer bundle failed: ${rendererBuild.stderr || rendererBuild.stdout}`);

const sourceBuild = runProcess('npx', [
  'esbuild',
  'src/source/context.ts',
  '--bundle',
  '--platform=node',
  '--target=node18',
  '--format=cjs',
  `--outfile=${sourceBundle}`,
], { cwd: root, timeout: 30_000 });
if (sourceBuild.status !== 0) throw new Error(`composition image source bundle failed: ${sourceBuild.stderr || sourceBuild.stdout}`);

try {
  const { renderReportCompositionPdf } = await import(rendererBundle);
  const { createSourceContext } = await import(sourceBundle);
  const imagePath = join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png');
  const sourceContext = createSourceContext({
    contentRoot: dirname(imagePath),
    sourceRoot: dirname(imagePath),
    brandRoot: dirname(imagePath),
  });
  const result = await renderReportCompositionPdf('pages/editorial-two-column', legacyFixtureToCompositionInput({
    title: 'Composition image boundary',
    sections: [{
      heading: 'Text around an image',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Before the image, the paragraph establishes the current text flow. ' },
          { type: 'image', src: 'root://hero.png', alt: 'A prepared rectangular asset', width: '40%', wrap: 'right', caption: 'Prepared asset' },
          { type: 'text', text: ' After the image, the paragraph must use the free interval beside the asset and continue below its boundary. '.repeat(12) },
        ],
      }],
    }],
  }), undefined, sourceContext);

  assert.equal(result.composition.evaluation.status, 'accepted', JSON.stringify(result.composition.evaluation));
  const image = result.drawings.find((drawing) => drawing.kind === 'image');
  const boundary = result.composition.plan.graphicPlacements.find((graphic) => graphic.graphicId.endsWith(':boundary'));
  const afterLines = result.composition.plan.lines.filter((line) => line.blockId.endsWith(':part-2'));
  const afterLinesOnBoundarySlot = afterLines.filter((line) => line.page === boundary?.page && line.slotId === boundary?.slotId);
  assert.ok(image, 'composition backend did not draw the authored image');
  assert.ok(boundary && boundary.paint === false, 'planner boundary must not be painted a second time');
  assert.ok(afterLines.length > 0, 'text after the image was not planned');
  assert.ok(afterLinesOnBoundarySlot.some((line) => line.box.x + line.box.width <= boundary.box.x), 'text beside the wrapped image must remain in the free interval');
  assert.ok(afterLinesOnBoundarySlot.every((line) => line.box.y >= boundary.box.y + boundary.box.height || line.box.x + line.box.width <= boundary.box.x), JSON.stringify({ message: 'text must not enter the image boundary', boundary: boundary.box, lines: afterLinesOnBoundarySlot.map((line) => line.box) }));

  const output = join(temporary, 'composition-image.pdf');
  await writeFile(output, result.buffer);
  assert.equal((await readFile(output)).subarray(0, 5).toString(), '%PDF-');
  const text = runProcess('pdftotext', [output, '-']);
  if (text.status !== 0) throw new Error(text.stderr || 'pdftotext failed');
  const normalizedText = text.stdout.replace(/\s+/gu, ' ');
  assert.match(normalizedText, /Prepared asset/u);
  assert.match(normalizedText, /After the image/u);
  console.log(JSON.stringify({
    status: 'passed',
    pages: result.composition.plan.pages.length,
    imageDrawings: result.drawings.filter((drawing) => drawing.kind === 'image').length,
    boundary: boundary?.box,
    wrappedLines: afterLines.length,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
