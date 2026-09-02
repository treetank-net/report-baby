#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from 'yaml';
import { pdfContentHash } from './lib/artifact-inspect.mjs';
import { createEditorialNumberedFixture } from './lib/editorial-numbered-fixture.mjs';
import { runProcess } from './lib/process.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-editorial-parity-'));
const rendererBundle = join(temporary, 'report-renderer.cjs');
const sourceBundle = join(temporary, 'source-context.cjs');
const brandBundle = join(temporary, 'brand-context.cjs');
const baselinePath = join(root, '..', 'docs/quality/editorial-baseline.json');
const templateRef = 'pages/editorial-inset-two-column';
const illustrationPath = join(root, 'scripts/fixtures/editorial-neutral-illustration.svg');

function build(entry, output, extra = []) {
  const result = runProcess('npx', [
    'esbuild', entry, '--bundle', '--platform=node', '--target=node18', '--format=cjs', ...extra, `--outfile=${output}`,
  ], { cwd: root, timeout: 30_000 });
  if (result.status !== 0) throw new Error(`editorial parity bundle '${entry}' failed: ${result.stderr || result.stdout}`);
}

build('src/report-renderer.ts', rendererBundle, ['--loader:.wasm=binary', '--loader:.ttf=binary']);
build('src/source-context.ts', sourceBundle);
build('src/brand-context.ts', brandBundle);

try {
  const { renderReportCompositionPdf } = await import(rendererBundle);
  const { defaultRenderTheme } = await import(brandBundle);
  const { createSourceContext } = await import(sourceBundle);
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const fixture = createEditorialNumberedFixture({
    quoteMarkGap: renderConfig.pdf.quote_mark_gap,
    quoteMarkOffsetX: renderConfig.pdf.quote_mark_offset_x,
    quoteMarkOffsetY: renderConfig.pdf.quote_mark_offset_y,
    illustration: {
      blockId: 'intro-illustration',
      assetId: 'editorial-neutral-illustration',
      width: '80%',
      sourceWidthPx: 1600,
      sourceHeightPx: 900,
      asset: {
        id: 'editorial-neutral-illustration',
        source: 'root://editorial-neutral-illustration.svg',
        alt: 'Neutral editorial illustration',
        width: '80%',
        fit: 'contain',
        keep_with_caption: false,
      },
    },
  });
  const sourceContext = createSourceContext({
    contentRoot: dirname(illustrationPath),
    sourceRoot: dirname(illustrationPath),
    brandRoot: dirname(illustrationPath),
  });
  const theme = { ...defaultRenderTheme(), brandName: 'Editorial QA', showReportBrandName: true };
  const result = await renderReportCompositionPdf(templateRef, fixture.input, theme, sourceContext);
  const { composition } = result;
  assert.equal(composition.evaluation.status, 'accepted', JSON.stringify(composition.evaluation));
  assert.equal(composition.plan.residualContent.length, 0, JSON.stringify(composition.plan.residualContent));
  assert.equal(composition.plan.lines.some((line) => line.flowId === 'quotes'), false, 'quotes must remain outside the ordinary flow');
  assert.equal(new Set((composition.plan.insertionLines ?? []).map((line) => line.blockId)).size, 4, 'all authored quotes must be retained');
  assert.equal((composition.plan.glyphPlacements ?? []).filter((glyph) => glyph.source === 'authored').length, 8, 'all authored quote glyphs must be retained');
  assert.ok(composition.plan.flowBarrierBoxCandidates?.some((candidate) => candidate.flowId === 'main'), 'editorial must expose main-flow barrier candidates');
  const illustrationPlacement = composition.plan.blockPlacements.find((placement) => placement.blockId === 'intro-illustration');
  assert.ok(illustrationPlacement, 'editorial illustration must have a planned block placement');
  const illustrationDrawing = result.drawings.find((drawing) => drawing.kind === 'image');
  assert.ok(illustrationDrawing, 'editorial illustration must be rendered');
  assert.ok(illustrationDrawing.width > 0 && illustrationDrawing.height > 0, `editorial illustration drawing must expose geometry: ${JSON.stringify(illustrationDrawing)}`);
  assert.equal(fixture.illustration?.sourceWidthPx, 1600);
  assert.equal(fixture.illustration?.sourceHeightPx, 900);

  const artifactHash = pdfContentHash(result.buffer);
  const summary = {
    schemaVersion: 1,
    template: templateRef,
    brand: theme.brandName,
    fixture: {
      mainWords: fixture.totalMainWords,
      quoteWords: fixture.quoteWordCount,
      headings: fixture.sourceShape.filter((block) => block.kind === 'heading').map((block) => ({ id: block.id, words: block.words })),
      paragraphs: fixture.sourceShape.filter((block) => block.kind === 'paragraph').map((block) => ({ id: block.id, words: block.words })),
      quotes: fixture.sourceShape.filter((block) => block.kind === 'quote').map((block) => ({ id: block.id, words: block.words })),
      illustration: fixture.illustration,
    },
    pages: composition.plan.pages.length,
    pdf: { normalization: 'pdf-content', hash: artifactHash },
  };
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.env.REPORT_BABY_EDITORIAL_BASELINE_UPDATE === '1') await writeFile(baselinePath, serialized);
  else {
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.deepEqual(summary, baseline, 'editorial parity baseline changed');
  }
  if (process.env.REPORT_BABY_ARTIFACT_DIR) {
    await mkdir(process.env.REPORT_BABY_ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.REPORT_BABY_ARTIFACT_DIR, 'editorial.pdf'), result.buffer);
    await writeFile(join(process.env.REPORT_BABY_ARTIFACT_DIR, 'editorial-summary.json'), serialized);
  }
  console.log(JSON.stringify({
    status: 'passed',
    template: templateRef,
    brand: theme.brandName,
    pages: summary.pages,
    mainWords: fixture.totalMainWords,
    quotes: summary.fixture.quotes.length,
    illustration: { box: { x: illustrationDrawing.x, y: illustrationDrawing.y, width: illustrationDrawing.width, height: illustrationDrawing.height }, sourceWidthPx: fixture.illustration?.sourceWidthPx, sourceHeightPx: fixture.illustration?.sourceHeightPx },
    pdfContentHash: artifactHash,
  }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
