#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temp = await mkdtemp('/tmp/report-baby-brand-contract-');
const input = join(temp, 'deck.json');
const output = join(temp, 'rendered');
const longTitle = 'A deliberately long title that must be fitted into the selected brand safe area';
const deck = {
  title: 'Contract test',
  footer: 'Brand contract test',
  overrides: { fit: { strategy: 'shrink-to-fit', min_heading_pt: 24, min_body_pt: 10 } },
  slides: [
    { type: 'title', title: longTitle, subtitle: 'The title uses the same resolved profile in PNG and PPTX.', brand_ref: 'brand://orbit/primary' },
    { type: 'metrics', title: 'A second brand on the same deck', subtitle: 'Per-slide profile selection is part of the public contract.', brand_ref: 'brand://pyrus/surfaces/light', metrics: [{ label: 'Signal', value: '64.2%', delta: '+6.4 pp', trend: 'up' }] },
  ],
};

await writeFile(input, `${JSON.stringify(deck, null, 2)}\n`);
const exampleBundle = process.env.REPORT_BABY_EXAMPLE_BUNDLE || 'server/example-bundle.cjs';

function run(args, env) {
  return spawnSync(process.execPath, [exampleBundle, ...args], { cwd: root, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
}

function runBrandTool(args) {
  return spawnSync(process.execPath, ['scripts/brand-tool.js', ...args], { cwd: root, encoding: 'utf8' });
}

const starterRoot = join(temp, 'starter-brands');
const starterInit = runBrandTool(['init', '--out', starterRoot, '--brand', 'northstar', '--name', 'Northstar', '--preset', 'campaign']);
if (starterInit.status !== 0) throw new Error(`brand-tool init failed: ${starterInit.stderr || starterInit.stdout}`);
for (const file of ['_brand.yml', 'profiles/primary.yml', 'showcase.yml', 'templates/slides/primary/template.yml', 'templates/slides/primary/cases.yml', 'assets/logos/logo.svg']) {
  try { await readFile(join(starterRoot, 'northstar', file)); } catch (error) { throw new Error(`brand-tool init did not create ${file}: ${error}`); }
}
const starterValidation = runBrandTool(['validate', '--brand-root', starterRoot, '--brand', 'brand://northstar/primary']);
if (starterValidation.status !== 0) throw new Error(`generated starter did not validate: ${starterValidation.stderr || starterValidation.stdout}`);
const starterSet = runBrandTool(['set', '--brand-root', starterRoot, '--brand', 'brand://northstar/primary', '--path', 'layout.title_align', '--value', 'center']);
if (starterSet.status !== 0) throw new Error(`brand-tool set failed: ${starterSet.stderr || starterSet.stdout}`);
if (!(await readFile(join(starterRoot, 'northstar/profiles/primary.yml'), 'utf8')).includes('title_align: center')) throw new Error('brand-tool set did not update the selected profile');
const starterPreview = runBrandTool(['preview', '--kind', 'showcase', '--brand-root', starterRoot, '--brand', 'brand://northstar/primary', '--out', join(temp, 'starter-preview'), '--formats', 'pdf,png,pptx']);
if (starterPreview.status !== 0) throw new Error(`generated starter preview failed: ${starterPreview.stderr || starterPreview.stdout}`);
for (const file of ['reports/primary-report/report.pdf', 'decks/primary-deck/slides.pdf', 'decks/primary-deck/slides.pptx', 'decks/primary-deck/png/slide-01.png']) {
  try { await readFile(join(temp, 'starter-preview', file)); } catch (error) { throw new Error(`starter preview did not create ${file}: ${error}`); }
}

const titleReportInput = join(temp, 'title-report.json');
await writeFile(titleReportInput, JSON.stringify({
  title_page: {
    eyebrow: 'NORTHSTAR · CAMPAIGN',
    title: 'A report with a real cover',
    subtitle: 'The report body starts on the following page.',
    period: 'Q2 2026',
  },
  title: 'A report with a real cover',
  intro: 'The title page is separate from the report content.',
  kpis: [{ label: 'Reach', value: '184k', delta: '+23%', trend: 'up' }],
  footer: 'Northstar showcase',
}, null, 2));
const titleReport = run(['--kind', 'report', '--brand-root', starterRoot, '--brand', 'brand://northstar/primary', '--input', titleReportInput, '--out', join(temp, 'title-report'), '--formats', 'pdf']);
if (titleReport.status !== 0) throw new Error(`title-page report render failed: ${titleReport.stderr || titleReport.stdout}`);
const titleReportPdf = await readFile(join(temp, 'title-report', 'report.pdf'));
const pageObjects = titleReportPdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [];
if (pageObjects.length < 2) throw new Error(`title-page report did not create a separate cover and content page (found ${pageObjects.length} pages)`);

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

const rendered = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', input, '--out', output, '--formats', 'png,pptx']);
if (rendered.status !== 0) throw new Error(`fit/per-slide contract render failed: ${rendered.stderr || rendered.stdout}`);
const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
if (manifest.schema_version !== 1) throw new Error('contract manifest has no schema_version=1');
if (manifest.slideThemes?.length !== 2) throw new Error('contract render did not resolve both slide themes');
if (manifest.slideThemes[0].fontFamily === manifest.slideThemes[1].fontFamily && manifest.slideThemes[0].primary === manifest.slideThemes[1].primary) throw new Error('per-slide brand_ref did not change the resolved theme');
if (!manifest.outputs?.pptx || !manifest.outputs?.png?.length) throw new Error('contract render did not produce editable and raster outputs');

const ownedTemplateInput = join(temp, 'owned-template.json');
await writeFile(ownedTemplateInput, JSON.stringify({
  slides: [{ type: 'title', title: 'Brand-owned title', subtitle: 'The layout comes from the brand directory.', template_ref: 'slides/title' }],
}, null, 2));
const ownedTemplate = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://flux/primary', '--input', ownedTemplateInput, '--out', join(temp, 'owned-template'), '--formats', 'png,pptx']);
if (ownedTemplate.status !== 0) throw new Error(`brand-owned template render failed: ${ownedTemplate.stderr || ownedTemplate.stdout}`);
const ownedManifest = JSON.parse(await readFile(join(temp, 'owned-template', 'manifest.json'), 'utf8'));
const ownedPlan = ownedManifest.slidePlans?.[0];
if (ownedPlan?.sourceTemplate?.id !== 'slides/title' || ownedPlan?.templateRef !== 'slides/title') throw new Error(`brand-owned template was not compiled: ${JSON.stringify(ownedPlan)}`);
if (ownedPlan.titleLayout?.titleBaselineY === 390) throw new Error('brand-owned template did not change the extracted title geometry');
for (const slot of ['lockup', 'lockup-name', 'eyebrow', 'image', 'title', 'subtitle']) if (!ownedPlan.slotBoxes?.[slot]) throw new Error(`brand-owned plan is missing rendered slot '${slot}'`);

const baseOwnedPng = await digest(join(temp, 'owned-template', 'png', 'slide-01.png'));
const baseOwnedPptx = await digest(join(temp, 'owned-template', 'slides.pptx'));
const slotMutations = {
  lockup: ['width: 0.03625', 'width: 0.045'],
  'lockup-name': ['x: 0.115, y: 0.06, width: 0.18', 'x: 0.14, y: 0.06, width: 0.10'],
  image: ['x: 0.64, y: 0.06, width: 0.30', 'x: 0.68, y: 0.06, width: 0.26'],
  eyebrow: ['x: 0.06, y: 0.23, width: 0.50', 'x: 0.06, y: 0.25, width: 0.45'],
  title: ['x: 0.06, y: 0.33, width: 0.50', 'x: 0.06, y: 0.35, width: 0.46'],
  subtitle: ['x: 0.06, y: 0.59, width: 0.50', 'x: 0.06, y: 0.61, width: 0.46'],
};
for (const [slot, [before, after]] of Object.entries(slotMutations)) {
  const mutationRoot = join(temp, `slot-${slot}-brands`);
  await cp(join(root, 'examples', 'brand-showcase', 'brands', 'flux'), join(mutationRoot, 'flux'), { recursive: true });
  const mutationTemplate = join(mutationRoot, 'flux', 'templates', 'slides', 'title', 'template.yml');
  const source = await readFile(mutationTemplate, 'utf8');
  if (!source.includes(before)) throw new Error(`slot mutation '${slot}' did not find its source frame`);
  await writeFile(mutationTemplate, source.replace(before, after));
  const mutationOutput = join(temp, `slot-${slot}-render`);
  const mutated = run(['--kind', 'deck', '--brand-root', mutationRoot, '--brand', 'brand://flux/primary', '--input', ownedTemplateInput, '--out', mutationOutput, '--formats', 'png,pptx']);
  if (mutated.status !== 0) throw new Error(`slot '${slot}' mutation render failed: ${mutated.stderr || mutated.stdout}`);
  if (await digest(join(mutationOutput, 'png', 'slide-01.png')) === baseOwnedPng) throw new Error(`slot '${slot}' did not change the rendered PNG`);
  if (await digest(join(mutationOutput, 'slides.pptx')) === baseOwnedPptx) throw new Error(`slot '${slot}' did not change the rendered PPTX`);
}

const metricsInput = join(temp, 'metrics-template.json');
await writeFile(metricsInput, JSON.stringify({
  slides: [{ type: 'metrics', template_ref: 'slides/metrics-3', title: 'Metrics template', subtitle: 'Three explicit cards', body: 'The body is also brand-owned.', callout: 'The callout has its own frame.', metrics: [{ label: 'Active', value: '18.4k', delta: '+12.8%', trend: 'up' }, { label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up' }, { label: 'Expansion', value: '€2.8m', delta: '+18.1%', trend: 'up' }] }],
}, null, 2));
const metricsBaseOutput = join(temp, 'metrics-template');
const metricsBase = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://flux/primary', '--input', metricsInput, '--out', metricsBaseOutput, '--formats', 'png,pptx']);
if (metricsBase.status !== 0) throw new Error(`brand-owned metrics template render failed: ${metricsBase.stderr || metricsBase.stdout}`);
const metricsManifest = JSON.parse(await readFile(join(metricsBaseOutput, 'manifest.json'), 'utf8'));
const metricsPlan = metricsManifest.slidePlans?.[0];
if (metricsPlan?.sourceTemplate?.archetype !== 'metrics' || metricsPlan?.templateRef !== 'slides/metrics-3') throw new Error(`metrics template was not compiled: ${JSON.stringify(metricsPlan)}`);
for (const slot of ['metric-1', 'metric-2', 'metric-3', 'body', 'callout']) if (!metricsPlan.slotBoxes?.[slot]) throw new Error(`metrics plan is missing rendered slot '${slot}'`);
if (metricsPlan.slotRules?.body?.maxLines !== 3 || metricsPlan.slotRules?.callout?.maxLines !== 2) throw new Error('metrics slot text rules were not exposed in the resolved plan');
const metricsBasePng = await digest(join(metricsBaseOutput, 'png', 'slide-01.png'));
const metricsBasePptx = await digest(join(metricsBaseOutput, 'slides.pptx'));
for (const [slot, [before, after]] of Object.entries({
  'metric-1': ['x: 0.05, y: 0.30, width: 0.27', 'x: 0.05, y: 0.30, width: 0.24'],
  'metric-2': ['x: 0.365, y: 0.30, width: 0.27', 'x: 0.39, y: 0.30, width: 0.24'],
  'metric-3': ['x: 0.68, y: 0.30, width: 0.27', 'x: 0.71, y: 0.30, width: 0.24'],
})) {
  const mutationRoot = join(temp, `metrics-${slot}-brands`);
  await cp(join(root, 'examples', 'brand-showcase', 'brands', 'flux'), join(mutationRoot, 'flux'), { recursive: true });
  const mutationTemplate = join(mutationRoot, 'flux', 'templates', 'slides', 'metrics-3', 'template.yml');
  const source = await readFile(mutationTemplate, 'utf8');
  if (!source.includes(before)) throw new Error(`metrics slot mutation '${slot}' did not find its source frame`);
  await writeFile(mutationTemplate, source.replace(before, after));
  const mutationOutput = join(temp, `metrics-${slot}-render`);
  const mutated = run(['--kind', 'deck', '--brand-root', mutationRoot, '--brand', 'brand://flux/primary', '--input', metricsInput, '--out', mutationOutput, '--formats', 'png,pptx']);
  if (mutated.status !== 0) throw new Error(`metrics slot '${slot}' mutation render failed: ${mutated.stderr || mutated.stdout}`);
  if (await digest(join(mutationOutput, 'png', 'slide-01.png')) === metricsBasePng) throw new Error(`metrics slot '${slot}' did not change the rendered PNG`);
  if (await digest(join(mutationOutput, 'slides.pptx')) === metricsBasePptx) throw new Error(`metrics slot '${slot}' did not change the rendered PPTX`);
}
for (const [slot, [before, after]] of Object.entries({
  title: ['x: 0.05, y: 0.12, width: 0.90', 'x: 0.06, y: 0.12, width: 0.88'],
  subtitle: ['x: 0.05, y: 0.18, width: 0.90', 'x: 0.07, y: 0.18, width: 0.86'],
  body: ['x: 0.05, y: 0.60, width: 0.90', 'x: 0.05, y: 0.61, width: 0.88'],
  callout: ['x: 0.05, y: 0.76, width: 0.90', 'x: 0.05, y: 0.78, width: 0.88'],
})) {
  const mutationRoot = join(temp, `metrics-${slot}-brands`);
  await cp(join(root, 'examples', 'brand-showcase', 'brands', 'flux'), join(mutationRoot, 'flux'), { recursive: true });
  const mutationTemplate = join(mutationRoot, 'flux', 'templates', 'slides', 'metrics-3', 'template.yml');
  const source = await readFile(mutationTemplate, 'utf8');
  if (!source.includes(before)) throw new Error(`metrics text slot mutation '${slot}' did not find its source frame`);
  await writeFile(mutationTemplate, source.replace(before, after));
  const mutationOutput = join(temp, `metrics-${slot}-render`);
  const mutated = run(['--kind', 'deck', '--brand-root', mutationRoot, '--brand', 'brand://flux/primary', '--input', metricsInput, '--out', mutationOutput, '--formats', 'png,pptx']);
  if (mutated.status !== 0) throw new Error(`metrics text slot '${slot}' mutation render failed: ${mutated.stderr || mutated.stdout}`);
  if (await digest(join(mutationOutput, 'png', 'slide-01.png')) === metricsBasePng) throw new Error(`metrics text slot '${slot}' did not change the rendered PNG`);
  if (await digest(join(mutationOutput, 'slides.pptx')) === metricsBasePptx) throw new Error(`metrics text slot '${slot}' did not change the rendered PPTX`);
}
for (const [region, [before, after]] of Object.entries({
  header: ['frame: { x: 0.05, y: 0.04, width: 0.90, height: 0.20 }', 'frame: { x: 0.07, y: 0.04, width: 0.86, height: 0.20 }'],
  footer: ['frame: { x: 0.05, y: 0.93, width: 0.90, height: 0.04 }', 'frame: { x: 0.07, y: 0.93, width: 0.86, height: 0.04 }'],
})) {
  const mutationRoot = join(temp, `metrics-${region}-region-brands`);
  await cp(join(root, 'examples', 'brand-showcase', 'brands', 'flux'), join(mutationRoot, 'flux'), { recursive: true });
  const mutationTemplate = join(mutationRoot, 'flux', 'templates', 'slides', 'metrics-3', 'template.yml');
  const source = await readFile(mutationTemplate, 'utf8');
  if (!source.includes(before)) throw new Error(`metrics region mutation '${region}' did not find its source frame`);
  await writeFile(mutationTemplate, source.replace(before, after));
  const mutationOutput = join(temp, `metrics-${region}-region-render`);
  const mutated = run(['--kind', 'deck', '--brand-root', mutationRoot, '--brand', 'brand://flux/primary', '--input', metricsInput, '--out', mutationOutput, '--formats', 'png,pptx']);
  if (mutated.status !== 0) throw new Error(`metrics region '${region}' mutation render failed: ${mutated.stderr || mutated.stdout}`);
  if (await digest(join(mutationOutput, 'png', 'slide-01.png')) === metricsBasePng) throw new Error(`metrics region '${region}' did not change the rendered PNG`);
  if (await digest(join(mutationOutput, 'slides.pptx')) === metricsBasePptx) throw new Error(`metrics region '${region}' did not change the rendered PPTX`);
}
for (const field of ['label', 'value', 'delta', 'note']) {
  const longMetrics = JSON.parse(await readFile(metricsInput, 'utf8'));
  longMetrics.slides[0].metrics[0][field] = `${'very-long-metric-content-'.repeat(40)}${field}`;
  const longInput = join(temp, `metrics-long-${field}.json`);
  await writeFile(longInput, JSON.stringify(longMetrics, null, 2));
  const longOutput = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://flux/primary', '--input', longInput, '--out', join(temp, `metrics-long-${field}`), '--formats', 'png,pptx']);
  if (longOutput.status === 0) throw new Error(`long metric ${field} was silently allowed to escape its card`);
}
for (const field of ['body', 'callout']) {
  const longCopy = JSON.parse(await readFile(metricsInput, 'utf8'));
  longCopy.slides[0][field] = 'long-unbroken-content-'.repeat(220);
  const longInput = join(temp, `metrics-long-${field}.json`);
  await writeFile(longInput, JSON.stringify(longCopy, null, 2));
  const longOutput = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://flux/primary', '--input', longInput, '--out', join(temp, `metrics-long-${field}`), '--formats', 'png,pptx']);
  if (longOutput.status === 0) throw new Error(`long metric ${field} was silently allowed to escape its slot`);
}

const snapshotWorktree = join(temp, 'snapshot-worktree');
await cp(join(root, 'examples', 'brand-showcase', 'brands', 'flux'), join(snapshotWorktree, 'flux'), { recursive: true });
const snapshotStore = join(temp, 'snapshot-store');
const publishSnapshot = spawnSync(process.execPath, ['scripts/brand-tool.js', 'publish', '--brand-root', snapshotWorktree, '--brand', 'brand://flux/primary', '--store', snapshotStore, '--release', '0.1.0'], { cwd: root, encoding: 'utf8' });
if (publishSnapshot.status !== 0) throw new Error(`snapshot publish failed: ${publishSnapshot.stderr || publishSnapshot.stdout}`);
const snapshotTemplatePath = join(snapshotWorktree, 'flux', 'templates', 'slides', 'title', 'template.yml');
const changedSource = (await readFile(snapshotTemplatePath, 'utf8')).replace('y: 0.33', 'y: 0.10');
await writeFile(snapshotTemplatePath, changedSource);
const snapshotRender = run(['--kind', 'deck', '--brand-root', snapshotStore, '--brand', 'brand://flux/primary', '--input', ownedTemplateInput, '--out', join(temp, 'snapshot-render'), '--formats', 'png']);
if (snapshotRender.status !== 0) throw new Error(`snapshot render failed: ${snapshotRender.stderr || snapshotRender.stdout}`);
const snapshotManifest = JSON.parse(await readFile(join(temp, 'snapshot-render', 'manifest.json'), 'utf8'));
if ((snapshotManifest.slidePlans?.[0]?.titleLayout?.titleBaselineY ?? 0) < 300) throw new Error('published snapshot was affected by a later working-tree template change');

const rtlInput = join(temp, 'rtl.json');
await writeFile(rtlInput, JSON.stringify({
  direction: 'rtl',
  template_ref: 'slides/centered-title',
  overrides: { layout: { lockup_position: 'top-end', lockup_spacing: 'compact' } },
  slides: [
    { type: 'title', title: 'RTL title plan', subtitle: 'The logical start and end are resolved once.' },
    { type: 'metrics', title: 'RTL metrics', metrics: [{ label: 'Signal', value: '64.2%', delta: '+6.4 pp', trend: 'up' }, { label: 'Teams', value: '18.4k' }], body: 'The body follows the same logical start.', callout: 'The callout follows the reading direction.' },
    { type: 'table', title: 'RTL table', head: ['Signal', 'Owner'], body: [['+6.4 pp', 'Product'], ['+14%', 'Lifecycle']] },
    { type: 'narrative', title: 'RTL narrative', body: 'Narrative content uses the logical end of the content box.', highlights: ['First highlight', 'Second highlight'] },
    { type: 'conclusions', title: 'RTL conclusions', items: ['Keep the source data order.', 'Mirror the visual reading order.'] },
  ],
}, null, 2));
const rtl = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', rtlInput, '--out', join(temp, 'rtl'), '--formats', 'png,pptx']);
if (rtl.status !== 0) throw new Error(`RTL/template contract render failed: ${rtl.stderr || rtl.stdout}`);
const rtlManifest = JSON.parse(await readFile(join(temp, 'rtl', 'manifest.json'), 'utf8'));
const rtlPlan = rtlManifest.slidePlans?.[0];
if (rtlPlan?.templateRef !== 'slides/centered-title' || rtlPlan.direction !== 'rtl' || rtlPlan.lockup?.physicalSide !== 'left' || rtlPlan.lockup?.spacing !== 'compact') throw new Error(`RTL/template plan was not resolved: ${JSON.stringify(rtlPlan)}`);
if (rtlManifest.slidePlans?.some((plan) => plan?.direction !== 'rtl' || plan.lockup?.physicalSide !== 'left')) throw new Error('RTL direction was not applied to every slide plan');
if (rtlManifest.outputs?.png?.length !== 5 || !rtlManifest.outputs?.pptx) throw new Error('RTL contract did not render every content kind to PNG and PPTX');

const unknownTemplateInput = join(temp, 'unknown-template.json');
await writeFile(unknownTemplateInput, JSON.stringify({ template_ref: 'slides/not-real', slides: [{ type: 'title', title: 'Unknown template' }] }, null, 2));
const unknownTemplate = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', unknownTemplateInput, '--out', join(temp, 'unknown-template'), '--formats', 'png']);
if (unknownTemplate.status === 0) throw new Error('an unknown slide template was silently accepted');

const unfitInput = join(temp, 'unfit.json');
await writeFile(unfitInput, JSON.stringify({ ...deck, overrides: undefined }, null, 2));
const unfit = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', unfitInput, '--out', join(temp, 'unfit'), '--formats', 'png']);
if (unfit.status === 0) throw new Error('an overflowing title without shrink-to-fit was silently accepted');

const tableInput = join(temp, 'table-overflow.json');
await writeFile(tableInput, JSON.stringify({ slides: [{ type: 'table', title: 'Too much table', head: ['A'], body: Array.from({ length: 11 }, (_, index) => [`Row ${index + 1}`]) }] }, null, 2));
const tableOverflow = run(['--kind', 'deck', '--brand-root', 'examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', tableInput, '--out', join(temp, 'table-overflow'), '--formats', 'png']);
if (tableOverflow.status === 0) throw new Error('a table exceeding the pagination-free limit was silently accepted');

const invalidRoot = join(temp, 'invalid-brands', 'broken');
await mkdir(invalidRoot, { recursive: true });
await writeFile(join(invalidRoot, '_brand.yml'), 'schema_version: 1\nmeta:\n  name: Broken\nlayout:\n  image_text_safe_area: { x: 0.1, y: 0.1, width: 0, height: 0.5 }\n');
const invalidInput = join(temp, 'invalid-safe-area.json');
await writeFile(invalidInput, JSON.stringify({ slides: [{ type: 'title', title: 'Invalid safe area' }] }, null, 2));
const invalidSafeArea = run(['--kind', 'deck', '--brand-root', join(temp, 'invalid-brands'), '--brand', 'brand://broken/primary', '--input', invalidInput, '--out', join(temp, 'invalid-safe-area'), '--formats', 'png']);
if (invalidSafeArea.status === 0) throw new Error('a zero-sized image safe area was silently accepted');

const invalidTemplateRoot = join(temp, 'invalid-template-brands', 'broken', 'templates', 'slides', 'bad');
await mkdir(invalidTemplateRoot, { recursive: true });
await writeFile(join(temp, 'invalid-template-brands', 'broken', '_brand.yml'), 'schema_version: 1\nmeta:\n  name: Broken template\n');
await writeFile(join(invalidTemplateRoot, 'template.yml'), `schema_version: 1
id: slides/bad
kind: slide
surface: slide-16x9
slots:
  title: { type: text, frame: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 } }
  image: { type: image, frame: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 } }
constraints: { no_overlap: true }
`);
const invalidTemplate = spawnSync(process.execPath, ['scripts/brand-tool.js', 'validate', '--brand-root', join(temp, 'invalid-template-brands'), '--brand', 'brand://broken/primary'], { cwd: root, encoding: 'utf8' });
if (invalidTemplate.status === 0) throw new Error('an overlapping brand template was silently accepted');

const boundaryInput = join(temp, 'boundary-report.json');
await writeFile(boundaryInput, JSON.stringify({ title: 'Path boundary', intro: 'The renderer must stay inside its configured roots.' }, null, 2));
const embeddedFont = join(root, 'server', 'src', 'assets', 'font.ttf');

async function boundaryBrandRoot(name, assets) {
  const brandRoot = join(temp, name);
  await mkdir(join(brandRoot, 'guarded'), { recursive: true });
  await writeFile(join(brandRoot, 'guarded', '_brand.yml'), `schema_version: 1\nmeta:\n  name: Guarded\n${assets ? `assets:\n${assets.map((line) => `  ${line}`).join('\n')}\n` : ''}`);
  return brandRoot;
}

function renderBoundary(brandRoot, brandRef, name, env) {
  const out = join(temp, name);
  const result = run(['--kind', 'report', '--brand-root', brandRoot, '--brand', brandRef, '--input', boundaryInput, '--out', out, '--formats', 'pdf'], env);
  return { ...result, out };
}

const outsideBrandDir = join(temp, 'outside-brand');
await mkdir(outsideBrandDir, { recursive: true });
await writeFile(join(outsideBrandDir, '_brand.yml'), 'schema_version: 1\nmeta:\n  name: Outside\n');
const plainBrandRoot = await boundaryBrandRoot('boundary-brands');
const absoluteBrandRef = renderBoundary(plainBrandRoot, join(outsideBrandDir, '_brand.yml'), 'absolute-brand-ref');
if (absoluteBrandRef.status === 0) throw new Error('an absolute brand_ref pointing outside the brand root was accepted');
if (!`${absoluteBrandRef.stderr}${absoluteBrandRef.stdout}`.includes('Brand reference escapes configured root')) throw new Error(`absolute brand_ref was rejected without an explanatory error: ${absoluteBrandRef.stderr || absoluteBrandRef.stdout}`);
const insideBrandRef = renderBoundary(plainBrandRoot, join('guarded', '_brand.yml'), 'inside-brand-ref');
if (insideBrandRef.status !== 0) throw new Error(`a file-shaped brand_ref inside the brand root was rejected: ${insideBrandRef.stderr || insideBrandRef.stdout}`);

const relativeAssetRoot = await boundaryBrandRoot('relative-source-root-brands', ['source_root: assets', 'font_regular: fonts/body.ttf']);
await mkdir(join(relativeAssetRoot, 'guarded', 'assets', 'fonts'), { recursive: true });
await cp(embeddedFont, join(relativeAssetRoot, 'guarded', 'assets', 'fonts', 'body.ttf'));
const relativeAssets = renderBoundary(relativeAssetRoot, 'brand://guarded', 'relative-source-root');
if (relativeAssets.status !== 0) throw new Error(`a relative assets.source_root was rejected: ${relativeAssets.stderr || relativeAssets.stdout}`);
const relativeManifest = JSON.parse(await readFile(join(relativeAssets.out, 'manifest.json'), 'utf8'));
if (relativeManifest.theme?.hasFontAssets !== true) throw new Error('a relative assets.source_root did not resolve its font asset');

const externalAssetRoot = join(temp, 'external-assets');
await mkdir(join(externalAssetRoot, 'fonts'), { recursive: true });
await cp(embeddedFont, join(externalAssetRoot, 'fonts', 'body.ttf'));
const externalBrandRoot = await boundaryBrandRoot('external-source-root-brands', [`source_root: ${externalAssetRoot}`, 'font_regular: fonts/body.ttf']);
const unlistedSourceRoot = renderBoundary(externalBrandRoot, 'brand://guarded', 'unlisted-source-root');
if (unlistedSourceRoot.status === 0) throw new Error('an absolute assets.source_root outside the allow-list was accepted');
if (!`${unlistedSourceRoot.stderr}${unlistedSourceRoot.stdout}`.includes('not allow-listed')) throw new Error(`an unlisted absolute source_root was rejected without an explanatory error: ${unlistedSourceRoot.stderr || unlistedSourceRoot.stdout}`);
const allowedSourceRoot = renderBoundary(externalBrandRoot, 'brand://guarded', 'allowed-source-root', { REPORT_BABY_BRAND_SOURCE_ROOTS: externalAssetRoot });
if (allowedSourceRoot.status !== 0) throw new Error(`an allow-listed absolute assets.source_root was rejected: ${allowedSourceRoot.stderr || allowedSourceRoot.stdout}`);
const allowedManifest = JSON.parse(await readFile(join(allowedSourceRoot.out, 'manifest.json'), 'utf8'));
if (allowedManifest.theme?.hasFontAssets !== true) throw new Error('an allow-listed absolute assets.source_root did not resolve its font asset');

const leakedFontDir = join(temp, 'leaked-assets');
await mkdir(leakedFontDir, { recursive: true });
await cp(embeddedFont, join(leakedFontDir, 'secret.ttf'));
const absoluteAssetRoot = await boundaryBrandRoot('absolute-asset-brands', [`source_root: ${externalAssetRoot}`, `font_regular: ${join(leakedFontDir, 'secret.ttf')}`]);
const absoluteAsset = renderBoundary(absoluteAssetRoot, 'brand://guarded', 'absolute-asset', { REPORT_BABY_BRAND_SOURCE_ROOTS: externalAssetRoot });
if (absoluteAsset.status === 0) throw new Error('an absolute asset path outside every allowed root was accepted');
if (!`${absoluteAsset.stderr}${absoluteAsset.stdout}`.includes("Brand asset 'font_regular' escapes configured root")) throw new Error(`an out-of-root asset path was rejected without an explanatory error: ${absoluteAsset.stderr || absoluteAsset.stdout}`);
const unrootedAbsoluteAsset = renderBoundary(await boundaryBrandRoot('unrooted-asset-brands', [`background_image: ${join(leakedFontDir, 'secret.ttf')}`]), 'brand://guarded', 'unrooted-absolute-asset');
if (unrootedAbsoluteAsset.status === 0) throw new Error('an absolute asset path without any source_root was accepted');

await rm(temp, { recursive: true, force: true });
console.log('Brand contract tests passed: per-slide profiles, templates, RTL content planning, fit strategy, shared bundle, overflow rejection, invalid safe-area rejection and path-boundary rejection.');
