import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { inspectBrand, inspectBrandTemplate, listBrandTemplates } from './brand-context.js';
import { prepareBrandAssets } from './asset-preparation.js';
import { readBuiltinTemplateText } from './builtin-template-source.js';
import { getBrandSourceRoots } from './config.js';
import { runExampleCli } from './example.js';
import { SERVER_VERSION } from './version.js';

function valueFor(args: string[], flag: string, fallback?: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function required(args: string[], flag: string): string {
  const value = valueFor(args, flag);
  if (!value) throw new Error(`Missing ${flag}.`);
  return value;
}

function help(): never {
  console.error(`Usage:
  node scripts/brand-tool.js init --out PATH --brand NAME [--name DISPLAY NAME] [--preset starter|campaign]
  node scripts/brand-tool.js set --brand-root PATH --brand brand://path/to/profile --path color.primary --value VALUE [--file profile|brand|showcase]
  node scripts/brand-tool.js validate --brand-root PATH --brand brand://path/to/profile
  node scripts/brand-tool.js template inspect --brand-root PATH --brand brand://path/to/profile --template slides/title
  node scripts/brand-tool.js template copy --brand-root PATH --brand brand://path/to/profile --from slides/two-column --to slides/two-column
  node scripts/brand-tool.js preview --kind report|deck --brand-root PATH --brand brand://path/to/profile --input FILE --out DIR --formats pdf,png,pptx
  node scripts/brand-tool.js publish --brand-root PATH --brand brand://path/to/profile --store DIR --release VERSION`);
  process.exit(2);
}

function absolute(value: string): string {
  return resolve(value);
}

function brandParts(brandRef: string): { brandId: string; profileId: string } {
  const normalized = brandRef.replace(/^brand:\/\//, '').replace(/^brand:/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 1) throw new Error(`Invalid brand reference '${brandRef}'. Expected brand://path/to/profile.`);
  return { brandId: parts[0], profileId: parts.slice(1).join('/') || 'primary' };
}

function safeBrandPath(brandDir: string, requested: string): string {
  const path = resolve(brandDir, requested);
  const relativePath = relative(brandDir, path);
  if (!relativePath || relativePath.startsWith('..') || relativePath.startsWith('/') || relativePath.includes('..')) {
    throw new Error(`Refusing to edit a path outside the brand directory: ${requested}`);
  }
  return path;
}

function yamlValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function starterBrandSource(name: string, preset: string): string {
  const campaign = preset === 'campaign';
  const colors = campaign ? {
    navy: '#0b2f4a', blue: '#2bb2ef', cyan: '#7ed7f2', orange: '#f28c28', fog: '#123d5d', line: '#285575', ink: '#f8fbff', muted: '#b8c7d5', success: '#73d39b', danger: '#ff9f9f', warning: '#ffd27a',
  } : {
    navy: '#13233f', blue: '#2563eb', cyan: '#0ea5e9', orange: '#f97316', fog: '#f4f7fb', line: '#dbe4f0', ink: '#13233f', muted: '#637089', success: '#12805c', danger: '#b42318', warning: '#8a5a00',
  };
  return `schema_version: 1
x-provenance:
  kind: generated-starter
  source: report-baby brand-tool init
meta:
  name: ${JSON.stringify(name)}
  short: ${JSON.stringify(name)}
  description: A neutral starter brand generated for report-baby prototyping.
color:
  palette:
    navy: "${colors.navy}"
    blue: "${colors.blue}"
    cyan: "${colors.cyan}"
    orange: "${colors.orange}"
    fog: "${colors.fog}"
    line: "${colors.line}"
    ink: "${colors.ink}"
  background: "${campaign ? colors.navy : '#ffffff'}"
  foreground: ink
  primary: blue
  secondary: ${campaign ? 'orange' : 'cyan'}
  muted: "${colors.muted}"
  surface: fog
  line: line
  success: "${colors.success}"
  danger: "${colors.danger}"
  warning: "${colors.warning}"
  series: [blue, cyan, orange, navy]
typography:
  base: { family: "DejaVu Sans" }
  headings: { family: "DejaVu Sans" }
  roles:
    display: { family: "DejaVu Sans" }
assets:
  source_root: assets
  logo: logos/logo.svg
  logo_white: logos/logo-white.svg
  logo_mark: logos/logo-mark.svg
  logo_white_mark: logos/logo-white-mark.svg
layout:
  header_style: ${campaign ? 'dark-band' : 'plain'}
  title_align: left
  title_case: normal
  heading_weight: 700
  body_weight: 400
  radius: 10
  logo_variant: ${campaign ? 'white' : 'default'}
  image_text_color: "#ffffff"
`;
}

function starterProfileSource(preset: string): string {
  const campaign = preset === 'campaign';
  return `schema_version: 1
layout:
  header_style: ${campaign ? 'dark-band' : 'plain'}
  title_align: left
  title_case: normal
  heading_weight: 700
  body_weight: 400
  radius: 10
  logo_variant: ${campaign ? 'white' : 'default'}
  pptx_heading_scale: 1
assets:
  background_image: null
`;
}

function starterTemplateSource(): string {
  return `schema_version: 1
id: slides/primary
kind: slide
archetype: title
surface: slide-16x9
canvas:
  direction: ltr
regions:
  hero: { frame: { x: 0.06, y: 0.06, width: 0.88, height: 0.70 } }
  content: { frame: { x: 0.06, y: 0.18, width: 0.82, height: 0.56 } }
slots:
  lockup: { type: lockup, frame: { x: 0.06, y: 0.06, width: 0.03625, height: 0.0533333333 } }
  lockup-name: { type: text, frame: { x: 0.115, y: 0.06, width: 0.22, height: 0.0533333333 }, role: lockup-name, max_lines: 1, overflow: shrink-to-fit }
  eyebrow: { type: text, region: content, frame: { x: 0.06, y: 0.22, width: 0.70, height: 0.06 }, max_lines: 1, overflow: reject }
  title: { type: text, region: content, frame: { x: 0.06, y: 0.31, width: 0.70, height: 0.20 }, role: heading-display, max_lines: 2, overflow: shrink-to-fit }
  subtitle: { type: text, region: content, frame: { x: 0.06, y: 0.56, width: 0.70, height: 0.12 }, role: body, max_lines: 2, overflow: shrink-to-fit }
constraints:
  inside_canvas: true
  no_overlap: true
`;
}

function starterCasesSource(): string {
  return `schema_version: 1
template_ref: slides/primary
cases:
  - id: baseline
    description: Short title and subtitle on the default surface.
  - id: long-copy
    description: Long title and subtitle must shrink or wrap inside their slots.
  - id: rtl
    description: Change canvas.direction to rtl when the brand supports Arabic or Hebrew.
`;
}

function starterShowcaseSource(name: string): string {
  return `schema_version: 1
showcase:
  meta:
    complexity: basic
    description: A generated starter with one profile, one owned title template and one dependable surface.
  reports:
    - id: primary-report
      profile: primary
      data:
        title: ${JSON.stringify(`${name} signal review`)}
        subtitle: A starter report generated from the brandbook
        period: Q2 2026
        intro: This report is intentionally ordinary. Change the profile, assets and template, then render it again to see which decisions belong to the brand.
        kpis:
          - { label: Active teams, value: 18.4k, delta: +12.8%, trend: up, note: vs. previous quarter }
          - { label: Activation, value: 64.2%, delta: +6.4 pp, trend: up, note: first-week cohort }
          - { label: Expansion, value: €2.8m, delta: +18.1%, trend: up, note: qualified pipeline }
        charts:
          - { type: line, title: Weekly active teams, subtitle: A steady climb, data: [{ label: W1, value: 11200 }, { label: W2, value: 12400 }, { label: W3, value: 13900 }, { label: W4, value: 15400 }, { label: W5, value: 18400 }] }
        sections:
          - { heading: The first useful signal, body: Keep the content simple while the visual system is being authored. The point of this fixture is to make the effect of each brand decision easy to see. }
        highlights: [Replace the sample logo., Add a real profile only for a real use case., Inspect PDF, PNG and PPTX before publishing.]
        footer: ${name} starter · report-baby
  decks:
    - id: primary-deck
      footer: ${name} starter · Q2 2026
      slides:
        - { type: title, template_ref: slides/primary, profile: primary, data: { eyebrow: Q2 2026 / STARTER BRAND, title: ${JSON.stringify(`${name} signal review`)}, subtitle: Edit this title template in your brandbook } }
        - { type: metrics, profile: primary, data: { title: The primary signal board, subtitle: Start here, then add only the surfaces the brand really needs, body: The renderer consumes the brandbook; it does not decide the identity for you., callout: Change one value, render again and compare the result., metrics: [{ label: Active teams, value: 18.4k, delta: +12.8%, trend: up }, { label: Activation, value: 64.2%, delta: +6.4 pp, trend: up }, { label: Expansion, value: €2.8m, delta: +18.1%, trend: up }] } }
        - { type: narrative, profile: primary, data: { title: A useful first iteration, body: Once this output looks intentional, add a second profile or a brand-owned template for a real communication mode., highlights: [Keep tokens semantic., Keep geometry in templates., Use showcase data to prove the brand.] } }
`;
}

function starterReadmeSource(name: string, preset: string, brandId: string): string {
  return `# ${name} brand starter

This directory was generated by \`report-baby brand-tool init\`. It is a working
brandbook, not a renderer fixture. Replace the sample logo, adjust the primary
profile and render the showcase before adding more complexity.

Preset: \`${preset}\`

## First loop

From the report-baby checkout:

\`\`\`bash
node scripts/brand-tool.js validate --brand-root . --brand brand://${brandId}/primary
node scripts/brand-tool.js preview --kind showcase --brand-root . --brand brand://${brandId}/primary --out ./prototype --formats pdf,png,pptx
\`\`\`

Edit \`_brand.yml\` for shared identity, \`primary.yml\` for a surface
variant, \`templates/slides/primary/template.yml\` for box positions and
\`showcase.yml\` for the examples that prove the brand.

The generated files contain no customer assets. Replace the SVG logo before
using this brand in a real deliverable.
`;
}

function logoSvg(name: string, white: boolean, markOnly: boolean): string {
  const color = white ? '#ffffff' : '#2563eb';
  const accent = white ? '#f28c28' : '#0ea5e9';
  const title = markOnly ? '' : `<text x="62" y="34" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="700" fill="${color}">${xmlEscape(name)}</text>`;
  const width = markOnly ? 48 : 260;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48" viewBox="0 0 ${width} 48"><circle cx="24" cy="24" r="17" fill="${color}" opacity="0.16"/><path d="M9 31 22 11l7 12 7-9" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="36" cy="14" r="4" fill="${accent}"/>${title}</svg>\n`;
}

async function init(args: string[]): Promise<void> {
  const out = absolute(required(args, '--out'));
  const brandId = required(args, '--brand');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(brandId)) throw new Error(`Brand name '${brandId}' must contain lowercase letters, numbers and hyphens only.`);
  const name = valueFor(args, '--name', brandId.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()))!;
  const preset = valueFor(args, '--preset', 'starter')!;
  if (preset !== 'starter' && preset !== 'campaign') throw new Error(`Unknown preset '${preset}'. Use starter or campaign.`);
  const brandDir = join(out, brandId);
  if (existsSync(brandDir)) throw new Error(`Brand directory already exists: ${brandDir}`);
  await mkdir(brandDir, { recursive: true });
  await mkdir(join(brandDir, 'templates', 'slides', 'primary'), { recursive: true });
  await mkdir(join(brandDir, 'assets', 'logos'), { recursive: true });
  await writeFile(join(brandDir, '_brand.yml'), starterBrandSource(name, preset));
  await writeFile(join(brandDir, 'primary.yml'), starterProfileSource(preset));
  await writeFile(join(brandDir, 'templates', 'slides', 'primary', 'template.yml'), starterTemplateSource());
  await writeFile(join(brandDir, 'templates', 'slides', 'primary', 'cases.yml'), starterCasesSource());
  await writeFile(join(brandDir, 'showcase.yml'), starterShowcaseSource(name));
  await writeFile(join(brandDir, 'README.md'), starterReadmeSource(name, preset, brandId));
  await writeFile(join(brandDir, 'assets', 'logos', 'logo.svg'), logoSvg(name, false, false));
  await writeFile(join(brandDir, 'assets', 'logos', 'logo-white.svg'), logoSvg(name, true, false));
  await writeFile(join(brandDir, 'assets', 'logos', 'logo-mark.svg'), logoSvg(name, false, true));
  await writeFile(join(brandDir, 'assets', 'logos', 'logo-white-mark.svg'), logoSvg(name, true, true));
  console.log(JSON.stringify({ created: true, brand: `brand://${brandId}/primary`, directory: brandDir, preset, next: [`node scripts/brand-tool.js validate --brand-root ${out} --brand brand://${brandId}/primary`, `node scripts/brand-tool.js preview --kind showcase --brand-root ${out} --brand brand://${brandId}/primary --out ./prototype --formats pdf,png,pptx`] }, null, 2));
}

async function setValue(args: string[]): Promise<void> {
  const brandRoot = absolute(required(args, '--brand-root'));
  const brandRef = required(args, '--brand');
  const path = required(args, '--path');
  const value = required(args, '--value');
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) throw new Error(`Invalid path '${path}'. Use dot-separated YAML keys, for example color.primary.`);
  const { brandId, profileId } = brandParts(brandRef);
  const brandDir = safeBrandPath(brandRoot, brandId);
  const fileKind = valueFor(args, '--file', 'profile')!;
  const requested = fileKind === 'brand' ? '_brand.yml' : fileKind === 'showcase' ? 'showcase.yml' : fileKind === 'profile' ? `${profileId}.yml` : fileKind;
  const filePath = safeBrandPath(brandDir, requested);
  if (!existsSync(filePath)) throw new Error(`Brand file does not exist: ${filePath}`);
  const document = parseDocument(await readFile(filePath, 'utf8'));
  if (document.errors.length > 0) throw new Error(`Cannot parse ${filePath}: ${document.errors.map((error) => error.message).join('; ')}`);
  document.setIn(path.split('.'), yamlValue(value));
  await writeFile(filePath, document.toString());
  console.log(JSON.stringify({ updated: true, file: filePath, path, value: yamlValue(value) }, null, 2));
}

async function validate(args: string[]): Promise<void> {
  const brandRoot = absolute(required(args, '--brand-root'));
  const brandRef = required(args, '--brand');
  const templates = await listBrandTemplates(brandRoot, brandRef);
  const brand = await inspectBrand(brandRoot, brandRef, undefined, getBrandSourceRoots());
  const compiled = [];
  for (const template of templates) compiled.push(await inspectBrandTemplate(brandRoot, brandRef, template.templateRef));
  console.log(JSON.stringify({ valid: true, brand_ref: brandRef, template_count: compiled.length, templates: compiled.map((item) => ({ template_ref: item.templateRef, surface: item.compiled.surface, kind: item.compiled.kind })), diagnostics: brand.diagnostics }, null, 2));
}

async function copyTemplate(args: string[]): Promise<void> {
  const brandRoot = absolute(required(args, '--brand-root'));
  const brandRef = required(args, '--brand');
  const from = required(args, '--from');
  const to = required(args, '--to');
  if (!/^slides\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(from) || !/^slides\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(to)) {
    throw new Error('Built-in and target templates must use a safe slide reference such as slides/two-column.');
  }
  const { brandId } = brandParts(brandRef);
  const brandDir = safeBrandPath(brandRoot, brandId);
  const destinationDirectory = safeBrandPath(brandDir, join('templates', to));
  const destination = join(destinationDirectory, 'template.yml');
  if (existsSync(destination)) throw new Error(`Brand template already exists: ${destination}`);
  const source = readBuiltinTemplateText(from);
  await mkdir(destinationDirectory, { recursive: true });
  await writeFile(destination, source.text);
  console.log(JSON.stringify({ copied: true, from, to, source: source.path, destination }, null, 2));
}

async function publish(args: string[]): Promise<void> {
  const brandRoot = absolute(required(args, '--brand-root'));
  const brandRef = required(args, '--brand');
  const store = absolute(required(args, '--store'));
  const release = required(args, '--release');
  const brandId = brandRef.replace(/^brand:\/\//, '').replace(/^brand:/, '').split('/')[0];
  const templates = await listBrandTemplates(brandRoot, brandRef);
  const brand = await inspectBrand(brandRoot, brandRef, undefined, getBrandSourceRoots());
  const releaseDir = join(store, brandId, 'releases', release);
  if (existsSync(releaseDir)) throw new Error(`Release already exists and is immutable: ${releaseDir}`);
  const compiledDir = join(releaseDir, 'templates');
  await mkdir(compiledDir, { recursive: true });
  const sourceBrandDir = join(brandRoot, brandId);
  await cp(sourceBrandDir, join(releaseDir, 'brand'), { recursive: true });
  const preparedAssets = await prepareBrandAssets(join(releaseDir, 'brand'), SERVER_VERSION);
  const entries = [];
  for (const template of templates) {
    const item = await inspectBrandTemplate(brandRoot, brandRef, template.templateRef);
    const output = join(compiledDir, `${template.templateRef}.json`);
    await mkdir(resolve(output, '..'), { recursive: true });
    await writeFile(output, `${JSON.stringify(item.compiled, null, 2)}\n`);
    entries.push({ template_ref: template.templateRef, source: template.path, compiled: output });
  }
  const manifest = { schema_version: 1, brand: brandId, release, source_brand_root: brandRoot, templates: entries, prepared_assets: preparedAssets.assets, diagnostics: brand.diagnostics };
  await writeFile(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const active = join(store, brandId, 'active.json');
  const activeTemp = `${active}.tmp-${process.pid}`;
  await writeFile(activeTemp, `${JSON.stringify({ brand: brandId, release, manifest: join('releases', release, 'manifest.json') }, null, 2)}\n`);
  await rename(activeTemp, active);
  console.log(JSON.stringify({ published: true, active, release: releaseDir, template_count: entries.length }, null, 2));
}

async function main(argv: string[]): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (command === 'init') return init([subcommand, ...rest].filter(Boolean));
  if (command === 'set') return setValue([subcommand, ...rest].filter(Boolean));
  if (command === 'validate') return validate([subcommand, ...rest].filter(Boolean));
  if (command === 'template' && subcommand === 'inspect') return runInspect(rest);
  if (command === 'template' && subcommand === 'copy') return copyTemplate(rest);
  if (command === 'preview') return runExampleCli([subcommand, ...rest].filter(Boolean));
  if (command === 'publish') return publish([subcommand, ...rest].filter(Boolean));
  help();
}

async function runInspect(args: string[]): Promise<void> {
  const brandRoot = absolute(required(args, '--brand-root'));
  const brandRef = required(args, '--brand');
  const templateRef = required(args, '--template');
  console.log(JSON.stringify(await inspectBrandTemplate(brandRoot, brandRef, templateRef), null, 2));
}

if (process.argv[1]?.endsWith('brand-tool-bundle.cjs')) {
  main(process.argv.slice(2)).catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}

export { main as runBrandToolCli };
