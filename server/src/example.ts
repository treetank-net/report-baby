import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { readBrandShowcase, resolveBrandContext, type BrandOverrides, type RenderTheme } from './brand.js';
import { renderReportPdf } from './templates.js';
import { renderSlidesPdf, renderSlidesPng, renderSlidesPptx, titleLayoutDiagnostics, type SlideDeck } from './slides.js';
import { resolveSlideDeck } from './slide-context.js';
import { slidePlanSummary } from './slide-plan.js';
import { validateRenderManifest } from './manifest.js';

export { validateRenderManifest };

interface CliArgs {
  kind: 'report' | 'deck' | 'showcase';
  brandRoot: string;
  brand: string;
  input?: string;
  out: string;
  formats: string[];
  surface?: string;
}

function usage(): never {
  console.error(`Usage:
  node server/example-bundle.cjs --kind report|deck --brand-root PATH --brand REF --input FILE --out DIR [--formats pdf,png,pptx]
  node server/example-bundle.cjs --kind showcase --brand-root PATH --brand REF --out DIR [--formats pdf,png,pptx]`);
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) usage();
    const key = token.slice(2).replaceAll('-', '_');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage();
    values[key] = value;
    index += 1;
  }
  if (values.kind !== 'report' && values.kind !== 'deck' && values.kind !== 'showcase') usage();
  if (!values.brand_root || !values.brand || !values.out) usage();
  if (values.kind !== 'showcase' && !values.input) usage();
  return {
    kind: values.kind,
    brandRoot: absolutePath(values.brand_root),
    brand: values.brand,
    input: values.input ? absolutePath(values.input) : undefined,
    out: absolutePath(values.out),
    formats: (values.formats ?? (values.kind === 'report' ? 'pdf' : 'pdf,png,pptx')).split(',').map((format) => format.trim()).filter(Boolean),
    surface: values.surface,
  };
}

function absolutePath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function manifestPath(root: string, filePath: string): string {
  return relative(root, filePath).replaceAll('\\', '/') || '.';
}

function prefixManifestOutputs(rendered: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const outputs = rendered.outputs;
  if (!outputs || typeof outputs !== 'object') return rendered;
  const next = Object.fromEntries(Object.entries(outputs as Record<string, unknown>).map(([key, value]) => [
    key,
    Array.isArray(value)
      ? value.map((item) => typeof item === 'string' ? `${prefix}/${item}` : item)
      : typeof value === 'string' ? `${prefix}/${value}` : value,
  ]));
  return { ...rendered, outputs: next };
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read JSON input ${path}: ${(error as Error).message}`);
  }
}

function brandRefForProfile(baseRef: string, profile?: string): string {
  if (!profile) return baseRef;
  if (profile.startsWith('brand:')) return profile;
  const uri = baseRef.replace(/^brand:\/\//, '').replace(/^brand:/, '');
  const brandId = uri.split('/').filter(Boolean)[0];
  if (!brandId) throw new Error(`Cannot derive brand id from ${baseRef}`);
  return `brand://${brandId}/${profile}`;
}

function themeSummary(theme: RenderTheme): Record<string, unknown> {
  return {
    background: theme.background,
    foreground: theme.foreground,
    primary: theme.primary,
    secondary: theme.secondary,
    muted: theme.muted,
    line: theme.line,
    surface: theme.soft,
    success: theme.success,
    danger: theme.danger,
    warning: theme.warning,
    imageTextColor: theme.imageTextColor,
    imageTextSafeArea: theme.imageTextSafeArea,
    imageScrim: theme.imageScrim,
    fontFamily: theme.fontFamily,
    headingFontFamily: theme.headingFontFamily,
    hasFontAssets: Boolean(theme.fontRegularPath),
    fitStrategy: theme.fitStrategy,
    pptxHeadingScale: theme.pptxHeadingScale,
    minBodyPt: theme.minBodyPt,
    minHeadingPt: theme.minHeadingPt,
    headerStyle: theme.headerStyle,
    reportHeaderStyle: theme.reportHeaderStyle,
    titleAlign: theme.titleAlign,
    titleCase: theme.titleCase,
    titleColor: theme.titleColor,
    titleAccentColor: theme.titleAccentColor,
    titleSubtitleColor: theme.titleSubtitleColor,
    titleLogoWidthPx: theme.titleLogoWidthPx,
    titleLogoHeightPx: theme.titleLogoHeightPx,
    coverBackground: theme.coverBackground,
    radius: theme.radius,
    logoVariant: theme.logoVariant,
    hasLogo: Boolean(theme.logoPath),
    hasLogoMark: Boolean(theme.logoMarkPath),
    lockupModel: { canvasWidthPx: 1600, canvasHeightPx: 900, pixelsPerInch: 120, markWidthPx: 48, titleMarkWidthPx: 58, gapPx: 18 },
    hasBackgroundImage: Boolean(theme.backgroundImagePath),
    hasCoverImage: Boolean(theme.coverImagePath),
    hasReportHeaderImage: Boolean(theme.reportHeaderImagePath),
  };
}

async function renderReportData(args: CliArgs, input: any): Promise<Record<string, unknown>> {
  const inputData = input.data ?? input;
  const template = input.template ?? input.template_ref ?? 'default-report';
  const brandRef = input.brand_ref ?? args.brand;
  const context = await resolveBrandContext(args.brandRoot, {
    brandRef,
    templateRef: input.template_ref ?? template,
    surface: args.surface ?? 'pdf-a4',
    overrides: input.overrides as BrandOverrides | undefined,
  });
  const data = { ...inputData, brand: inputData.brand ?? context.brandName };
  const outputs: Record<string, string> = {};
  const renderWarnings: string[] = [];
  if (args.formats.includes('pdf')) {
    const path = join(args.out, 'report.pdf');
    await writeFile(path, await renderReportPdf(template, data, context.theme, renderWarnings));
    outputs.pdf = manifestPath(args.out, path);
  }
  return {
    outputs,
    diagnostics: { ...context.diagnostics, warnings: [...context.diagnostics.warnings, ...renderWarnings] },
    theme: themeSummary(context.theme),
  };
}

async function renderReportExample(args: CliArgs, input: any): Promise<Record<string, unknown>> {
  return renderReportData(args, input);
}

async function renderDeckData(args: CliArgs, input: any): Promise<Record<string, unknown>> {
  const data = (input.data ?? input) as SlideDeck;
  const resolved = await resolveSlideDeck(data, {
    brandRoot: args.brandRoot,
    brandRef: input.brand_ref ?? args.brand,
    templateRef: input.template_ref,
    surface: args.surface ?? input.surface ?? 'pptx-16x9',
    overrides: input.overrides as BrandOverrides | undefined,
  });
  const deck = resolved.deck;
  const outputs: Record<string, unknown> = {};
  if (args.formats.includes('pdf')) {
    const path = join(args.out, 'slides.pdf');
    await writeFile(path, await renderSlidesPdf(deck, resolved.context.theme));
    outputs.pdf = manifestPath(args.out, path);
  }
  if (args.formats.includes('pptx')) {
    const path = join(args.out, 'slides.pptx');
    await writeFile(path, await renderSlidesPptx(deck, resolved.context.theme));
    outputs.pptx = manifestPath(args.out, path);
  }
  if (args.formats.includes('png')) {
    const directory = join(args.out, 'png');
    await mkdir(directory, { recursive: true });
    const buffers = await renderSlidesPng(deck, undefined, resolved.context.theme);
    const paths: string[] = [];
    for (let index = 0; index < buffers.length; index += 1) {
      const path = join(directory, `slide-${String(index + 1).padStart(2, '0')}.png`);
      await writeFile(path, buffers[index]);
      paths.push(manifestPath(args.out, path));
    }
    outputs.png = paths;
  }
  return {
    outputs,
    diagnostics: resolved.context.diagnostics,
    theme: themeSummary(resolved.context.theme),
    slideDiagnostics: resolved.slideDiagnostics,
    slideThemes: deck.slideThemes?.map((theme) => themeSummary(theme as RenderTheme)),
    slidePlans: deck.slidePlans?.map((plan) => plan ? slidePlanSummary(plan) : undefined),
    slideLayout: deck.slides.map((slide, index) => titleLayoutDiagnostics(slide, deck.slideThemes?.[index] ?? resolved.context.theme)),
  };
}

async function renderDeckExample(args: CliArgs, input: any): Promise<Record<string, unknown>> {
  return renderDeckData(args, input);
}

function showcaseEntries(value: any, singular: string): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [{ id: singular, ...value }];
  return [];
}

function showcaseSlide(slide: any, baseBrand: string): any {
  const content = slide.data && typeof slide.data === 'object' ? slide.data : slide;
  return {
    ...content,
    type: content.type ?? slide.type,
    template_ref: content.template_ref ?? slide.template_ref,
    brand_ref: brandRefForProfile(baseBrand, slide.profile),
    surface: slide.surface,
    overrides: slide.overrides ?? content.overrides,
  };
}

async function renderShowcaseExample(args: CliArgs): Promise<Record<string, unknown>> {
  const showcase = await readBrandShowcase(args.brandRoot, args.brand) as any;
  const reports: unknown[] = [];
  for (const report of showcaseEntries(showcase.reports ?? showcase.report, 'report')) {
    const directory = join(args.out, 'reports', report.id ?? 'report');
    const input = { ...report, brand_ref: brandRefForProfile(args.brand, report.profile), data: report.data ?? report };
    await mkdir(directory, { recursive: true });
    const rendered = await renderReportData({ ...args, kind: 'report', out: directory }, input);
    reports.push({ id: report.id ?? 'report', profile: input.brand_ref, ...prefixManifestOutputs(rendered, `reports/${report.id ?? 'report'}`) });
  }
  const decks: unknown[] = [];
  for (const deck of showcaseEntries(showcase.decks ?? showcase.deck, 'deck')) {
    const directory = join(args.out, 'decks', deck.id ?? 'deck');
    const source = deck.data && typeof deck.data === 'object' ? deck.data : deck;
    const input = {
      ...source,
      brand_ref: brandRefForProfile(args.brand, deck.profile),
      slides: (source.slides ?? []).map((slide: any) => showcaseSlide(slide, args.brand)),
    };
    await mkdir(directory, { recursive: true });
    const rendered = await renderDeckData({ ...args, kind: 'deck', out: directory }, input);
    decks.push({ id: deck.id ?? 'deck', ...prefixManifestOutputs(rendered, `decks/${deck.id ?? 'deck'}`) });
  }
  const metadata = showcase.meta && typeof showcase.meta === 'object' ? showcase.meta : {};
  return { outputs: { reports, decks }, showcase: { reports: reports.length, decks: decks.length, ...metadata } };
}

export async function runExampleCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  await mkdir(args.out, { recursive: true });
  const rendered = args.kind === 'showcase'
    ? await renderShowcaseExample(args)
    : args.kind === 'report'
      ? await renderReportExample(args, await readJson(args.input as string))
      : await renderDeckExample(args, await readJson(args.input as string));
  const manifest = validateRenderManifest({
    schema_version: 1,
    kind: args.kind,
    brand: args.brand,
    brandRoot: args.brandRoot.startsWith(process.cwd()) ? relative(process.cwd(), args.brandRoot).replaceAll('\\', '/') : '<external>',
    input: args.input && args.input.startsWith(process.cwd()) ? relative(process.cwd(), args.input).replaceAll('\\', '/') : undefined,
    formats: args.formats,
    ...rendered,
  });
  await writeFile(join(args.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1]?.endsWith('example-bundle.cjs')) {
  runExampleCli(process.argv.slice(2)).catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
