#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createDeterministicLorem, loremHeading, loremParagraph } from './lib/deterministic-lorem.mjs';
import { inspectPdfInk } from './lib/pdf-ink-occupancy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const fixtureRoot = join(repo, 'examples/composition-calibration');
const output = process.argv[2] ? resolve(process.argv[2]) : join(root, 'qa/composition-calibration');
const selectedCase = process.argv[3];
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-article-calibration-'));

/** Materialize one offline article shape; content lengths are authored fixture data. */
function articleInput(source, scenario, renderConfig) {
  const lorem = createDeterministicLorem();
  const main = [];
  const intro = [];
  for (const [index, block] of source.shape.entries()) {
    if (block.kind === 'quote') continue;
    const heading = block.kind === 'heading';
    const text = heading ? loremHeading(lorem, block.words) : loremParagraph(lorem, Math.ceil(block.words * scenario.paragraphScale));
    const destination = index === 0 ? intro : main;
    destination.push({ id: `article-${index}`, type: heading ? 'heading' : 'text', role: heading ? 'heading' : index === 0 ? 'intro' : 'body', text,
      ...(heading ? { keep_with_next_lines: renderConfig.pdf.orphan_min_lines } : {}) });
  }
  const figures = scenario.figures.map((figure, index) => ({ id: `figure-${index}`, type: 'image', role: 'body', atomic: true,
    asset_id: figure.asset, width: figure.width, fit: 'contain', caption: `Synthetic ${figure.asset} diagram; illustrative calibration asset.` }));
  for (const [index, figure] of scenario.figures.entries()) {
    if (figure.placement === 'main') main.splice(Math.floor(main.length / 2), 0, figures[index]);
  }
  return { assets: scenario.figures.map((figure) => ({ id: figure.asset,
    source: `root://examples/composition-calibration/assets/${figure.asset}.svg`, width: figure.width, fit: 'contain' })), flows: {
    header: { blocks: [{ id: 'header-title', type: 'heading', role: 'header', text: scenario.id }, { id: 'header-meta', type: 'text', role: 'header', text: `${scenario.brand} / synthetic article geometry` }] },
    intro: { blocks: intro },
    main: { blocks: main },
    quotes: { blocks: scenario.quotes.map((words, index) => ({ id: `quote-${index}`, type: 'text', role: 'quote', text: loremParagraph(lorem, words) })) },
    visuals: { blocks: figures.filter((_, index) => scenario.figures[index].placement === 'insertion') },
    footer: { blocks: [{ id: 'footer', type: 'text', role: 'footer', text: 'Synthetic calibration candidate' }] },
  } };
}

/** Derive reusable capabilities before planning; no block-to-page overlays. */
function articleTemplate(base, renderConfig) {
  const source = structuredClone(base);
  source.slots.content.allowed_block_kinds = ['heading', 'paragraph', 'image'];
  source.flows.quotes.start_page = renderConfig.composition_calibration.insertion_start_page;
  source.slots['visual-pool'] = { ...structuredClone(source.slots['quote-pool']), type: 'image', role: 'body', allowed_block_kinds: ['image'] };
  source.slots['visual-pool'].placement.rhythm_group = 'article-visuals';
  source.flows.visuals = { ...structuredClone(source.flows.quotes), slots: ['visual-pool'], insertion_slots: ['visual-pool'] };
  return source;
}

/** Read the same showcase palette and font files used by the named brand. */
async function brandAppearance(id, loadRenderFontSet) {
  const directory = join(repo, 'examples/brand-showcase/brands', id);
  const brand = parse(await readFile(join(directory, '_brand.yml'), 'utf8'));
  const light = parse(await readFile(join(directory, 'surfaces/light.yml'), 'utf8'));
  const colors = { ...brand.color, ...light.color };
  const rgb = (key) => {
    const raw = colors[key];
    const hex = raw.startsWith('#') ? raw : colors.palette[raw];
    return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  };
  const fonts = await loadRenderFontSet({ fontFamily: brand.typography.base.family,
    fontRegularPath: join(directory, brand.assets.source_root, brand.assets.font_regular),
    fontBoldPath: join(directory, brand.assets.source_root, brand.assets.font_bold) });
  return { fonts, colors: { foreground: rgb('foreground'), muted: rgb('muted'), primary: rgb('primary'), quote: rgb('secondary') } };
}

try {
  const corpus = JSON.parse(await readFile(join(fixtureRoot, 'corpus.json'), 'utf8'));
  const config = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const scenarios = corpus.cases.filter((scenario) => !selectedCase || scenario.id === selectedCase);
  assert.ok(scenarios.length > 0, 'the requested calibration case must exist');
  await mkdir(output, { recursive: true });
  await build({ entryPoints: ['src/composition/report-composition-entrypoint.ts', 'src/composition/index.ts',
    'src/composition/adapters/pdf/backend.ts', 'src/composition/adapters/pdf/image.ts', 'src/rendering/primitives.ts',
    'src/template/contracts.ts', 'src/template/geometry.ts'].map((path) => join(root, path)),
    bundle: true, platform: 'node', target: 'node18', format: 'cjs', outdir: temporary, outbase: join(root, 'src'),
    outExtension: { '.js': '.cjs' }, loader: { '.wasm': 'binary', '.ttf': 'binary' } });
  const modules = await Promise.all(['composition/report-composition-entrypoint', 'composition/index', 'composition/adapters/pdf/backend',
    'composition/adapters/pdf/image', 'rendering/primitives', 'template/contracts', 'template/geometry'].map((path) => import(join(temporary, `${path}.cjs`))));
  const [{ planReportComposition, compositionStylesFromRenderConfig, compositionImageStyleFromRenderConfig, compositionPdfBackendOptionsFromRenderConfig },
    { renderComposition }, { createJsPdfTextBackend }, { createJsPdfImageBlockCapabilities },
    { newPdf, loadRenderFontSet, renderSvgToPng }, { compileTemplateSource }, { pageGeometryFromTemplate }] = modules;
  const base = parse(await readFile(join(root, 'templates/pages/editorial-dynamic-inset-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(articleTemplate(base, config));
  const geometry = pageGeometryFromTemplate(compiled);
  const assets = new Map();
  for (const id of new Set(scenarios.flatMap((scenario) => scenario.figures.map((figure) => figure.asset)))) {
    const svg = await readFile(join(fixtureRoot, 'assets', `${id}.svg`), 'utf8');
    const data = await renderSvgToPng(svg);
    assets.set(id, { data: data.toString('base64'), format: 'PNG', width: data.readUInt32BE(16), height: data.readUInt32BE(20) });
  }
  const measurements = [];
  for (const scenario of scenarios) {
    const source = corpus.sources.find(({ id }) => id === scenario.source);
    assert.ok(source?.shape.length > 0, `${scenario.id} requires a measured source shape`);
    const input = articleInput(source, scenario, config);
    const appearance = await brandAppearance(scenario.brand, loadRenderFontSet);
    const styles = compositionStylesFromRenderConfig(appearance.colors);
    const makePdf = () => newPdf('portrait', [geometry.width, geometry.height], appearance.fonts);
    const modes = [];
    for (const mode of ['coarse', 'legacy']) {
      const measuringPdf = makePdf();
      const images = createJsPdfImageBlockCapabilities(measuringPdf, appearance.fonts.family, assets, compositionImageStyleFromRenderConfig());
      const policy = mode === 'legacy'
        ? { coarseGeometryFirst: false, searchBudget: { maxInitialCandidates: 1, maxFullPlanRecalculations: 1, maxRefinementRounds: 0 } }
        : { searchBudget: { maxFullPlanRecalculations: config.composition_calibration.max_full_plan_recalculations, maxRefinementRounds: config.composition_calibration.max_refinement_rounds } };
      const result = planReportComposition(measuringPdf, compiled, geometry, input, { family: appearance.fonts.family,
        maxPages: config.pdf.composition_max_pages, styles, measureBlock: images.measureBlock, policy });
      if (mode === 'coarse') assert.notEqual(result.evaluation.status, 'rejected', `${scenario.id} must have a legal production candidate: ${JSON.stringify(result.evaluation.hardViolations)}`);
      const stem = `${scenario.id}-${mode}`;
      const reportPath = join(output, `${stem}.json`);
      await writeFile(reportPath, `${JSON.stringify({ compositionPlan: result.plan, compositionEvaluation: result.evaluation }, null, 2)}\n`);
      const seed = result.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
      const measurement = { mode, status: result.evaluation.status, ...(Number.isFinite(result.evaluation.score) ? { score: result.evaluation.score } : {}),
        scoreUpperBound: result.evaluation.scoreUpperBound, measuredRewardUpperBound: result.evaluation.measuredRewardUpperBound,
        pages: result.plan.pages.length, fullPlanRecalculations: result.plan.trace?.candidateSearch?.fullPlanRecalculations,
        hardViolations: result.evaluation.hardViolations.map(({ code, blockId, page }) => ({ code, blockId, page })),
        scoreComponents: result.evaluation.scoreBreakdown, ...(seed ? { coarseAssignment: seed.assignmentSearch, coarseExactComparison: seed.selectedExactComparison ?? seed.baselineExactComparison } : {}), reportPath };
      if (result.evaluation.status !== 'rejected') {
        const pdf = makePdf();
        const renderer = createJsPdfImageBlockCapabilities(pdf, appearance.fonts.family, assets, compositionImageStyleFromRenderConfig());
        let captionChecks = 0;
        const renderImageWithCaptionCheck = (target, block, placement) => {
          const originalText = target.text;
          const captions = [];
          target.text = function (text, x, y, options) {
            if (options?.renderingMode !== 'invisible') captions.push({ text, x, y });
            return originalText.call(this, text, x, y, options);
          };
          try { renderer.renderer(target, block, placement); }
          finally { target.text = originalText; }
          for (const drawing of captions) {
            const frame = placement.captionBox;
            assert.ok(frame && drawing.x >= frame.x && drawing.x <= frame.x + frame.width
              && drawing.y >= frame.y && drawing.y <= frame.y + frame.height,
            `${stem}/${block.id} must draw each caption baseline inside its measured caption frame: ${JSON.stringify({ drawing, frame })}`);
            captionChecks += 1;
          }
        };
        const artifactPath = join(output, `${stem}.pdf`);
        const bytes = renderComposition(result.document, result, createJsPdfTextBackend(pdf, appearance.fonts.family, styles,
          { ...compositionPdfBackendOptionsFromRenderConfig(), blockRenderers: { image: renderImageWithCaptionCheck } }));
        await writeFile(artifactPath, bytes);
        const ink = await inspectPdfInk({ artifactPath, pages: result.plan.pages, lines: result.plan.lines.map((line) => ({ page: line.page, id: line.blockId, slotId: line.slotId, box: line.box })),
          slots: result.plan.slots.map((slot) => ({ page: slot.page, id: slot.id, box: slot.box })), pageSize: { width: geometry.width, height: geometry.height }, qa: config.quality.pdf_pixel_qa });
        const emptyLines = ink.lineChecks.filter(({ status, inkPixels }) => status !== 'occupied' || inkPixels < config.quality.pdf_pixel_qa.minimum_ink_pixels);
        assert.equal(emptyLines.length, 0, `${stem} must paint text in every measured line box`);
        Object.assign(measurement, { artifactPath, lineChecks: ink.lineChecks.length, occupiedLineChecks: ink.lineChecks.length - emptyLines.length, captionChecks });
      }
      modes.push(measurement);
    }
    const coarse = modes.find(({ mode }) => mode === 'coarse');
    const legacy = modes.find(({ mode }) => mode === 'legacy');
    measurements.push({ id: scenario.id, sourceUrl: source.url, content: source.content, brand: scenario.brand, fontFamily: appearance.fonts.family,
      mainWords: input.flows.main.blocks.filter(({ text }) => text).reduce((sum, { text }) => sum + text.split(/\s+/u).length, 0),
      quoteCount: scenario.quotes.length, figures: scenario.figures, visualPreference: 'pending-review', modes,
      ...(coarse.score === undefined || legacy.score === undefined ? {} : { scoreDelta: coarse.score - legacy.score }) });
    await writeFile(join(output, 'calibration-report.json'), `${JSON.stringify({ status: 'awaiting-visual-preferences', sourceManifest: join(fixtureRoot, 'corpus.json'), measurements }, null, 2)}\n`);
    process.stderr.write(`${scenario.id}: coarse ${coarse.status}, ${coarse.pages} pages, score ${coarse.score ?? 'unavailable'}; legacy ${legacy.status}, ${legacy.pages} pages, score ${legacy.score ?? 'unavailable'}\n`);
  }
  const links = measurements.map((record) => `<section><h2>${record.id}</h2><p>${record.mainWords} main words / ${record.quoteCount} quotes / ${record.figures.length} figures / ${record.fontFamily}</p><p>Preference: pending visual review</p>${record.modes.map((mode) => `<h3>${mode.mode}</h3><p>${mode.status}; score ${mode.score ?? 'unavailable'}; ${mode.pages} pages${mode.artifactPath ? ` / <a href="${mode.artifactPath.split('/').at(-1)}">PDF</a>` : ''} / <a href="${mode.reportPath.split('/').at(-1)}">complete geometry and scoring</a></p><p>Configured reward ceiling: ${mode.scoreUpperBound ?? 'unavailable'}; measured reward ceiling: ${mode.measuredRewardUpperBound ?? 'unavailable'}; painted lines checked: ${mode.lineChecks ?? 'not rendered'}</p><table><thead><tr><th>Component</th><th>Points</th><th>Reward ceiling</th><th>Evidence</th></tr></thead><tbody>${mode.scoreComponents.map((component) => `<tr><td>${component.code}</td><td>${component.points}</td><td>${component.rewardCeiling ?? 'unavailable'}</td><td>${component.rewardEvidence ?? 'unavailable'}</td></tr>`).join('')}</tbody></table>`).join('')}</section>`).join('\n');
  await writeFile(join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Article composition calibration</title><h1>Article composition calibration</h1><p>Source-shaped synthetic text and original diagrams. Scores are observations; new visual preferences require review.</p><p>Reward ceilings are algebraic bounds, not attainable optima or quality percentages. The legacy comparator evaluates one baseline with no refinement; production compares bounded exact candidates.</p>${links}`);
  process.stdout.write(`${JSON.stringify({ status: 'awaiting-visual-preferences', cases: measurements.length, output, report: join(output, 'calibration-report.json') }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
