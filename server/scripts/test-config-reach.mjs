import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pdfContentHash } from './lib/artifact-inspect.mjs';
import { runProcess } from './lib/process.mjs';

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
  reservedHeader: (source) => source.replace('height: 0.18', 'height: 0.30'),
  introFrame: (source) => source.replace('height: 0.10', 'height: 0.14'),
};

function fail(message) {
  throw new Error(message);
}

async function render(templateRoot, outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const inputPath = join(outputRoot, 'input.json');
  await writeFile(inputPath, `${JSON.stringify(input)}\n`);
  const result = runProcess(process.execPath, [bundle, '--kind', 'report', '--brand-root', join(repoRoot, 'examples/brand-showcase/brands'), '--brand', 'brand://flux/primary', '--input', inputPath, '--out', outputRoot, '--formats', 'pdf'], {
    cwd: serverRoot,
    env: { ...process.env, REPORT_BABY_TEMPLATE_DIR: templateRoot },
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) fail(`render failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  const pdf = await readFile(join(outputRoot, 'report.pdf'));
  return pdfContentHash(pdf);
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
    const hash = await render(variantRoot, outputRoot);
    if (hash === baseline) fail(`geometry field '${name}' did not change the rendered PDF (${createHash('sha256').update(hash).digest('hex')})`);
    changed.push(name);
  }
  console.log(`config reach PASS: ${changed.length} page geometry mutations changed the normalized PDF`);
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
