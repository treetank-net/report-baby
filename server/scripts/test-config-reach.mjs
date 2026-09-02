import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pdfContentHash } from './lib/artifact-inspect.mjs';
import { runProcess } from './lib/process.mjs';
import { fail } from './lib/fail.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const repoRoot = resolve(new URL('../..', import.meta.url).pathname);
const serverRoot = join(repoRoot, 'server');
const sourceTemplateRoot = join(serverRoot, 'templates');
const bundle = join(serverRoot, 'example-bundle.cjs');
const pageTemplate = 'pages/editorial-two-column/template.yml';

const input = {
  template_ref: 'pages/editorial-two-column',
  data: {
    title: 'Configuration reach',
    intro: 'A configured page should change when its geometry changes.',
    sections: [{ heading: 'Flow', body: 'This paragraph exercises the configured measure. '.repeat(42) }],
    highlights: ['A measured change'],
    footer: 'Configuration reach',
  },
};

const variants = {
  margins: (source) => source.replace(
    'margins: { top: 18, right: 17, bottom: 18, left: 17 }',
    'margins: { top: 18, right: 22, bottom: 18, left: 22 }',
  ).replace('widths: [85, 85]', 'widths: [80, 80]'),
  columns: (source) => source.replace('count: 2', 'count: 1').replace('gutter: 6', 'gutter: 0').replace('widths: [85, 85]', 'widths: [176]'),
  gutter: (source) => source.replace('gutter: 6', 'gutter: 12').replace('widths: [85, 85]', 'widths: [82, 82]'),
  widths: (source) => source.replace('widths: [85, 85]', 'widths: [80, 90]'),
  reservedHeader: (source) => source.replace('height: 0.18', 'height: 0.30'),
  reservedFooter: (source) => source.replace('y: 0.93, width: 1, height: 0.07', 'y: 0.88, width: 1, height: 0.12'),
  introFrame: (source) => source.replace('x: 0.081, y: 0.24', 'x: 0.081, y: 0.28'),
  contentFrame: (source) => source.replace(
    'frame: { x: 0.081, y: 0.18, width: 0.838, height: 0.75 }',
    'frame: { x: 0.081, y: 0.18, width: 0.838, height: 0.63 }',
  ),
};

async function render(templateRoot, outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const inputPath = join(outputRoot, 'input.json');
  await writeFile(inputPath, `${JSON.stringify({ ...input, data: legacyFixtureToCompositionInput(input.data) })}\n`);
  const result = runProcess(process.execPath, [bundle, '--kind', 'report', '--brand-root', join(repoRoot, 'examples/brand-showcase/brands'), '--brand', 'brand://flux/primary', '--input', inputPath, '--out', outputRoot, '--formats', 'pdf'], {
    cwd: serverRoot,
    env: { ...process.env, REPORT_BABY_TEMPLATE_DIR: templateRoot },
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail(`render failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  const pdf = await readFile(join(outputRoot, 'report.pdf'));
  const manifest = JSON.parse(await readFile(join(outputRoot, 'manifest.json'), 'utf8'));
  return { hash: pdfContentHash(pdf), score: manifest.compositionEvaluation?.score };
}

const workRoot = await mkdtemp(join(tmpdir(), 'report-baby-config-reach-'));
try {
  const source = await readFile(join(sourceTemplateRoot, pageTemplate), 'utf8');
  const baseRoot = join(workRoot, 'base-templates');
  const baseOut = join(workRoot, 'base-output');
  await cp(sourceTemplateRoot, baseRoot, { recursive: true });
  const baseline = await render(baseRoot, baseOut);
  const changed = [];
  for (const [name, mutate] of Object.entries(variants)) {
    const variantRoot = join(workRoot, `${name}-templates`);
    const outputRoot = join(workRoot, `${name}-output`);
    await cp(sourceTemplateRoot, variantRoot, { recursive: true });
    await writeFile(join(variantRoot, pageTemplate), mutate(source));
    const rendered = await render(variantRoot, outputRoot);
    if (rendered.hash === baseline.hash) fail(`geometry field '${name}' did not change the rendered PDF (${createHash('sha256').update(rendered.hash).digest('hex')})`);
    changed.push(name);
  }
  const scoreRoot = join(workRoot, 'score-config-templates');
  const scoreOut = join(workRoot, 'score-config-output');
  await cp(sourceTemplateRoot, scoreRoot, { recursive: true });
  const scoreConfigPath = join(scoreRoot, 'render-config.yml');
  const scoreConfig = await readFile(scoreConfigPath, 'utf8');
  await writeFile(scoreConfigPath, scoreConfig.replace('composition_score:\n  base: 100', 'composition_score:\n  base: 321'));
  const changedScore = await render(scoreRoot, scoreOut);
  if (changedScore.hash !== baseline.hash) fail('changing composition score configuration unexpectedly changed the PDF artifact');
  if (!Number.isFinite(baseline.score) || !Number.isFinite(changedScore.score) || changedScore.score === baseline.score) {
    fail(`composition score configuration did not reach the evaluator (${JSON.stringify({ baseline: baseline.score, changed: changedScore.score })})`);
  }
  console.log(`config reach PASS: ${changed.length} page geometry mutations changed the normalized PDF and score configuration changed only evaluation score`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
