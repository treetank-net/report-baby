import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { parse } from 'yaml';
import type { RenderTheme } from '../contracts/render-theme.js';
import { readRenderConfig } from '../template/builtins.js';
import { readTemplateSource } from '../template/contracts.js';
import { assetDataUri, readPreparedAssets } from './assets.js';
import { safeRelativePath } from './paths.js';
import type { BrandOverrides, RenderComposition } from './contracts.js';
import type { BrandSourceDescriptor } from '../source/contracts.js';
import { createSourceContext, type SourceContext } from '../source/context.js';
import { materializeBrandSource } from '../source/materialization.js';
import { colorContrastRatio, defaultRenderTheme, readableInk } from './color.js';
import { clone, isRecord, merge, stringFromTypography, type RecordValue } from './value.js';
import { brandNameFrom, extractTheme } from './theme.js';
import { collectBrandProfiles, collectBrandTemplates } from './discovery.js';

export type { RenderTheme } from '../contracts/render-theme.js';

export type { BrandOverrides } from './contracts.js';
export { colorContrastRatio, defaultRenderTheme, readableInk } from './color.js';
export { assetDataUri } from './assets.js';
export { brandNameFrom } from './theme.js';

export interface BrandDiagnostics {
  brandRef?: string;
  profile?: string;
  templateRef?: string;
  surface?: string;
  appliedOverrides: string[];
  warnings: string[];
}

export interface RenderBrandContext {
  theme: RenderTheme;
  composition: RenderComposition;
  brandName?: string;
  diagnostics: BrandDiagnostics;
  sourceContext?: SourceContext;
}

export interface BrandCapabilities {
  brand_name?: string;
  output_formats: Array<'pdf' | 'png' | 'pptx'>;
  surfaces: string[];
  assets: {
    logo: boolean;
    logo_white: boolean;
    logo_mark: boolean;
    logo_white_mark: boolean;
    background_image: boolean;
    cover_image: boolean;
    report_header_image: boolean;
    font_regular: boolean;
    font_bold: boolean;
  };
  typography: {
    body_family: string;
    heading_family: string;
    embedded_fonts_for_pdf_png: boolean;
  };
  layout: {
    report_header_style: string;
    title_align: string;
    logo_variant: string;
    report_image_caption?: NonNullable<RenderTheme['reportImageCaption']>;
  };
}

async function activeReleaseDirectory(rootDir: string, brandId: string): Promise<string | undefined> {
  const activePath = safeRelativePath(rootDir, join(brandId, 'active.json'));
  if (!existsSync(activePath)) return undefined;
  const active = JSON.parse(await readFile(activePath, 'utf8')) as { release?: string };
  if (typeof active.release !== 'string' || active.release.includes('/') || active.release.includes('\\') || active.release === '.' || active.release === '..') throw new Error(`Invalid active release for brand ${brandId}.`);
  return safeRelativePath(rootDir, join(brandId, 'releases', active.release));
}

async function resolveBrandDirectory(rootDir: string, brandId: string): Promise<string> {
  const direct = safeRelativePath(rootDir, brandId);
  if (documentCandidates(direct).some((candidate) => existsSync(candidate))) return direct;
  const release = await activeReleaseDirectory(rootDir, brandId);
  if (!release) return direct;
  const snapshot = join(release, 'brand');
  if (!documentCandidates(snapshot).some((candidate) => existsSync(candidate))) throw new Error(`Active brand release is missing its brand snapshot: ${snapshot}`);
  return snapshot;
}

function parseDocument(raw: string, filePath: string): RecordValue {
  const parsed = extname(filePath).toLowerCase() === '.json' ? JSON.parse(raw) : parse(raw);
  if (!isRecord(parsed)) throw new Error(`Brand document must contain an object: ${filePath}`);
  return parsed;
}

function validateBrandDocument(document: RecordValue, filePath: string, requireVersion = false): string[] {
  const version = document.schema_version;
  if (version !== undefined && version !== 1) throw new Error(`Unsupported brand schema_version in ${filePath}: ${String(version)} (expected 1)`);
  if (requireVersion && version === undefined) throw new Error(`Brand document ${filePath} must declare schema_version: 1.`);
  const warnings: string[] = [];
  if (version === undefined) warnings.push(`Brand document ${filePath} has no schema_version; treated as legacy v1.`);
  for (const key of ['meta', 'color', 'typography', 'assets']) {
    if (document[key] !== undefined && !isRecord(document[key])) throw new Error(`Brand document ${filePath}.${key} should be an object.`);
  }
  return warnings;
}

async function readDocument(filePath: string, requireVersion = false): Promise<RecordValue> {
  const document = parseDocument(await readFile(filePath, 'utf8'), filePath);
  validateBrandDocument(document, filePath, requireVersion);
  return document;
}

function documentCandidates(directory: string): string[] {
  return [join(directory, '_brand.yml'), join(directory, '_brand.yaml'), join(directory, 'brand.yml'), join(directory, 'brand.yaml'), join(directory, 'brand.json')];
}

async function readFirstDocument(candidates: string[], required: boolean, requireVersion = false): Promise<{ path: string; document: RecordValue } | undefined> {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { path: candidate, document: await readDocument(candidate, requireVersion) };
  }
  if (required) throw new Error(`Brand document not found. Tried: ${candidates.join(', ')}`);
  return undefined;
}

async function readProfile(rootDir: string, brandId: string, profile?: string, seen = new Set<string>()): Promise<{ document: RecordValue; profilePath?: string }> {
  const brandDir = await resolveBrandDirectory(rootDir, brandId);
  const base = await readFirstDocument(documentCandidates(brandDir), true, true);
  if (!base) throw new Error(`Brand document not found for ${brandId}`);
  if (!profile) return { document: base.document };

  // `brand://flux/primary` is a path reference: `flux` selects a directory
  // and `primary` selects `primary.yml` directly inside it. The former
  // implicit `profiles/` lookup is intentionally not part of the contract.
  const profilePath = safeRelativePath(brandDir, `${profile.replace(/\.(ya?ml|json)$/i, '')}.yml`);
  if (seen.has(profilePath)) throw new Error(`Circular brand profile inheritance: ${profile}`);
  seen.add(profilePath);
  const profileDoc = await readDocument(profilePath).catch(async () => {
    const alternatives = [profilePath.replace(/\.yml$/, '.yaml'), profilePath.replace(/\.yml$/, '.json')];
    const found = await readFirstDocument(alternatives, true);
    return found?.document ?? {};
  });
  const extendsValue = typeof profileDoc.extends === 'string' ? profileDoc.extends : undefined;
  const parent = extendsValue ? await readProfile(rootDir, brandId, extendsValue, seen) : { document: base.document };
  const current = { ...profileDoc };
  delete current.extends;
  return { document: merge(parent.document, current), profilePath };
}


function roleFont(document: RecordValue, roleName: string): string | undefined {
  const typography = isRecord(document.typography) ? document.typography : {};
  const roles = isRecord(typography.roles) ? typography.roles : {};
  return stringFromTypography(roles[roleName]);
}

function applyOverrides(theme: RenderTheme, document: RecordValue, overrides: BrandOverrides | undefined, diagnostics: BrandDiagnostics): RenderTheme {
  if (!overrides) return theme;
  const next = { ...theme };
  if (overrides.layout?.density) {
    next.density = overrides.layout.density;
    if (next.density === 'compact') next.bodyScale *= 0.92;
    diagnostics.appliedOverrides.push(`layout.density=${next.density}`);
  }
  if (overrides.typography?.body?.scale !== undefined) {
    next.bodyScale *= overrides.typography.body.scale;
    diagnostics.appliedOverrides.push(`typography.body.scale=${overrides.typography.body.scale}`);
  }
  if (overrides.typography?.heading?.scale !== undefined) {
    next.headingScale *= overrides.typography.heading.scale;
    diagnostics.appliedOverrides.push(`typography.heading.scale=${overrides.typography.heading.scale}`);
  }
  const headingRole = overrides.typography?.heading_role ?? overrides.typography?.heading?.role ?? overrides.emphasis?.role;
  if (headingRole) {
    const family = roleFont(document, headingRole);
    if (family) {
      next.headingFontFamily = family;
      diagnostics.appliedOverrides.push(`typography.heading_role=${headingRole}`);
    } else diagnostics.warnings.push(`Typography role '${headingRole}' was not found in the selected brand.`);
  }
  if (overrides.typography?.body?.family) {
    next.fontFamily = overrides.typography.body.family;
    diagnostics.appliedOverrides.push(`typography.body.family=${next.fontFamily}`);
  }
  if (overrides.typography?.heading?.family) {
    next.headingFontFamily = overrides.typography.heading.family;
    diagnostics.appliedOverrides.push(`typography.heading.family=${next.headingFontFamily}`);
  }
  if (overrides.fit?.strategy === 'shrink-to-fit') {
    const min = overrides.fit.min_body_pt ?? 10;
    if (min < 8) diagnostics.warnings.push('fit.min_body_pt below 8pt was raised to a readable minimum by the renderer.');
    next.bodyScale = Math.max(Math.min(1, min / 16), next.bodyScale * 0.9);
    next.fitStrategy = 'shrink-to-fit';
    next.minBodyPt = Math.max(8, min);
    if (overrides.fit.min_heading_pt !== undefined) next.minHeadingPt = Math.max(12, overrides.fit.min_heading_pt);
    diagnostics.appliedOverrides.push(`fit.strategy=shrink-to-fit:min_body_pt=${Math.max(8, min)}`);
  }
  return next;
}

function parseReference(value: string): { brandId?: string; profile?: string; filePath?: string } {
  const uri = value.startsWith('brand://') ? value.slice('brand://'.length) : value.startsWith('brand:') ? value.slice('brand:'.length) : undefined;
  if (uri !== undefined) {
    const [brandId, ...profileParts] = uri.split('/').filter(Boolean);
    if (!brandId || brandId === '.' || brandId === '..' || brandId.includes('\\')) throw new Error(`Invalid brand reference: ${value}`);
    return { brandId, profile: profileParts.join('/') || undefined };
  }
  return { filePath: value };
}

function sourceGrowthFromCompiled(value: unknown): RecordValue | undefined {
  if (!isRecord(value)) return undefined;
  return {
    axis: value.axis,
    max_height: value.maxHeight,
    ...(value.pushes === undefined ? {} : { pushes: value.pushes }),
  };
}

function sourcePageFromCompiled(value: unknown): RecordValue | undefined {
  if (!isRecord(value)) return undefined;
  const margins = isRecord(value.margins) ? value.margins : {};
  const columns = isRecord(value.columns) ? value.columns : {};
  const reservedBands = isRecord(value.reservedBands) ? value.reservedBands : {};
  const flowObstacles = Array.isArray(value.flowObstacles)
    ? value.flowObstacles.map((obstacle) => isRecord(obstacle) ? { id: obstacle.id, frame: obstacle.frame } : obstacle)
    : value.flowObstacles;
  const blockFrames = isRecord(value.blockFrames) ? value.blockFrames : {};
  const blockGrowth = isRecord(value.blockGrowth) ? value.blockGrowth : {};
  const blocks = Object.fromEntries(Object.entries(blockFrames).map(([id, frame]) => {
    const growth = sourceGrowthFromCompiled(blockGrowth[id]);
    return [id, { frame, ...(growth === undefined ? {} : { grow: growth }) }];
  }));
  const flow = isRecord(value.flow) ? value.flow : {};
  return {
    width: value.width,
    height: value.height,
    margins: { top: margins.top, right: margins.right, bottom: margins.bottom, left: margins.left },
    columns: { count: columns.count, gutter: columns.gutter, widths: columns.widths },
    reserved_bands: reservedBands,
    flow_obstacles: flowObstacles,
    blocks,
    flow: { align: flow.align, hyphenate: flow.hyphenate, ...(flow.lead === undefined ? {} : { lead: flow.lead }) },
  };
}

function sourceSlotFromCompiled(value: unknown): RecordValue {
  const item = isRecord(value) ? value : {};
  const growth = sourceGrowthFromCompiled(item.grow);
  return {
    type: item.kind,
    frame: item.frame,
    ...(item.region === undefined ? {} : { region: item.region }),
    ...(item.role === undefined ? {} : { role: item.role }),
    ...(item.allowedBlockIds === undefined ? {} : { allowed_block_ids: item.allowedBlockIds }),
    ...(item.allowedBlockKinds === undefined ? {} : { allowed_block_kinds: item.allowedBlockKinds }),
    ...(item.textAlign === undefined ? {} : { align: item.textAlign }),
    ...(item.maxLines === undefined ? {} : { max_lines: item.maxLines }),
    ...(item.overflow === undefined ? {} : { overflow: item.overflow }),
    ...(growth === undefined ? {} : { grow: growth }),
  };
}

function rejectLegacyContinuationFields(compiled: RecordValue): void {
  const slots = isRecord(compiled.slots) ? compiled.slots : {};
  for (const [slotId, value] of Object.entries(slots)) {
    if (!isRecord(value)) continue;
    if (value.continuationFrame !== undefined || value.continuation_frame !== undefined) {
      throw new Error(`Brand template '${String(compiled.id)}' slot '${slotId}' uses continuation_frame; define an ordinary slot in the selected page template.`);
    }
  }
  const flows = isRecord(compiled.flows) ? compiled.flows : {};
  for (const [flowId, value] of Object.entries(flows)) {
    if (!isRecord(value)) continue;
    if (value.continuationSlots !== undefined || value.continuation_slots !== undefined) {
      throw new Error(`Brand template '${String(compiled.id)}' flow '${flowId}' uses continuation_slots; list ordinary slots in the selected page template.`);
    }
  }
  const page = isRecord(compiled.page) ? compiled.page : undefined;
  if (page && (page.continuation !== undefined || page.continuationFrame !== undefined || page.continuation_frame !== undefined)) {
    throw new Error(`Brand template '${String(compiled.id)}' uses continuation geometry; select an ordinary page template through the page schedule.`);
  }
}

function sourceFromCompiledTemplate(compiled: RecordValue): RecordValue {
  rejectLegacyContinuationFields(compiled);
  const slots = isRecord(compiled.slots) ? compiled.slots : {};
  const flows = isRecord(compiled.flows) ? compiled.flows : {};
  const sourceFlows = Object.fromEntries(Object.entries(flows).map(([id, value]) => {
    const flow = isRecord(value) ? value : {};
    return [id, {
      slots: flow.slots,
      continuation: flow.continuation,
      ...(flow.repeat === undefined ? {} : { repeat: flow.repeat }),
      ...(flow.startPage === undefined ? {} : { start_page: flow.startPage }),
    }];
  }));
  const page = sourcePageFromCompiled(compiled.page);
  const constraints = isRecord(compiled.constraints) ? compiled.constraints : {};
  return {
    schema_version: 1,
    id: compiled.id,
    kind: compiled.kind,
    surface: compiled.surface,
    ...(compiled.archetype === undefined ? {} : { archetype: compiled.archetype }),
    canvas: compiled.canvas,
    regions: compiled.regions,
    slots: Object.fromEntries(Object.entries(slots).map(([id, value]) => [id, sourceSlotFromCompiled(value)])),
    flows: sourceFlows,
    ...(page === undefined ? {} : { page }),
    ...(compiled.pageTitle === true ? { title_page: true } : {}),
    constraints: { inside_canvas: constraints.insideCanvas ?? true, no_overlap: constraints.noOverlap ?? false },
  };
}

export async function readBrandTemplateSource(
  brandRoot: string,
  brandRef: string | undefined,
  templateRef: string | undefined,
): Promise<{ source: unknown; path: string } | undefined> {
  if (!brandRef || !templateRef || !brandRef.startsWith('brand:')) return undefined;
  const reference = parseReference(brandRef);
  if (!reference.brandId) return undefined;
  const normalizedRef = templateRef.replaceAll('\\', '/');
  if (normalizedRef.startsWith('/') || normalizedRef.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`Invalid brand template reference: ${templateRef}`);
  }
  const brandDir = await resolveBrandDirectory(brandRoot, reference.brandId);
  const activeRelease = await activeReleaseDirectory(brandRoot, reference.brandId);
  if (activeRelease) {
    const compiledPath = join(activeRelease, 'templates', `${normalizedRef}.json`);
    if (existsSync(compiledPath)) {
      const compiled = await readTemplateSource(compiledPath) as RecordValue;
      if (isRecord(compiled) && compiled.schemaVersion === 1 && isRecord(compiled.slots)) {
        return { source: sourceFromCompiledTemplate(compiled), path: compiledPath };
      }
    }
  }
  const base = join(brandDir, 'templates', normalizedRef, 'template.yml');
  const candidates = [base, base.replace(/\.yml$/, '.yaml'), base.replace(/\.yml$/, '.json')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { source: await readTemplateSource(candidate), path: candidate };
  }
  return undefined;
}

export async function listBrandTemplates(brandRoot: string, brandRef: string, brandSource?: BrandSourceDescriptor): Promise<Array<{ templateRef: string; path: string }>> {
  const materialized = await materializeBrandSource(brandSource, brandRoot);
  const reference = parseReference(brandRef);
  if (!reference.brandId) throw new Error(`Template discovery requires a brand URI such as brand://acme/primary: ${brandRef}`);
  const templateRoot = join(await resolveBrandDirectory(materialized.brandRoot, reference.brandId), 'templates');
  const result: Array<{ templateRef: string; path: string }> = [];
  await collectBrandTemplates(templateRoot, templateRoot, result);
  return result.sort((a, b) => a.templateRef.localeCompare(b.templateRef));
}

export async function inspectBrandTemplate(brandRoot: string, brandRef: string, templateRef: string, brandSource?: BrandSourceDescriptor): Promise<{ templateRef: string; sourcePath: string; compiled: import('../template/contracts.js').CompiledTemplate }> {
  const materialized = await materializeBrandSource(brandSource, brandRoot);
  const source = await readBrandTemplateSource(materialized.brandRoot, brandRef, templateRef);
  if (!source) throw new Error(`Brand template '${templateRef}' was not found for ${brandRef}.`);
  const { compileTemplateSource } = await import('../template/contracts.js');
  return { templateRef, sourcePath: source.path, compiled: compileTemplateSource(source.source) };
}

export async function resolveBrandContext(
  brandRoot: string,
  options: { brandRef?: string; templateRef?: string; surface?: string; overrides?: BrandOverrides; brandSourceRoots?: string[]; brandSource?: BrandSourceDescriptor; contentRoot?: string } = {},
): Promise<RenderBrandContext> {
  const diagnostics: BrandDiagnostics = {
    brandRef: options.brandRef,
    templateRef: options.templateRef,
    surface: options.surface,
    appliedOverrides: [],
    warnings: [],
  };
  const materialized = await materializeBrandSource(options.brandSource, brandRoot);
  const sourceContext = createSourceContext({ contentRoot: options.contentRoot ?? materialized.sourceRoot, sourceRoot: materialized.sourceRoot, brandRoot: materialized.brandRoot });
  const effectiveBrandRoot = sourceContext.brandRoot;
  diagnostics.warnings.push(...materialized.warnings);
  if (!options.brandRef) return { theme: applyOverrides(defaultRenderTheme(), {}, options.overrides, diagnostics), composition: { templateRef: 'slides/standard', direction: 'ltr', lockupPlacement: 'top-start', lockupSpacing: 'normal' }, diagnostics, sourceContext };

  const reference = parseReference(options.brandRef);
  let document: RecordValue;
  let profile: string | undefined;
  const documentPath = reference.filePath ? safeRelativePath(effectiveBrandRoot, reference.filePath, 'Brand reference') : undefined;
  if (documentPath) {
    document = await readDocument(documentPath, true);
  } else {
    profile = reference.profile;
    document = (await readProfile(effectiveBrandRoot, reference.brandId as string, profile)).document;
  }
  diagnostics.profile = profile;
  const brandDir = documentPath ? dirname(documentPath) : await resolveBrandDirectory(effectiveBrandRoot, reference.brandId as string);
  const extracted = extractTheme(brandDir, document, options.surface, options.templateRef, options.brandSourceRoots ?? [], readPreparedAssets(brandDir));
  diagnostics.warnings.push(...extracted.warnings);
  const theme = applyOverrides(extracted.theme, document, options.overrides, diagnostics);
  return { theme, composition: extracted.composition, brandName: extracted.brandName, diagnostics, sourceContext };
}

export async function listBrandbooks(brandRoot: string, brandSource?: BrandSourceDescriptor): Promise<Array<{ id: string; name?: string; profiles: string[] }>> {
  const materialized = await materializeBrandSource(brandSource, brandRoot);
  const effectiveRoot = materialized.brandRoot;
  const entries = await readdir(effectiveRoot, { withFileTypes: true }).catch(() => []);
  const result: Array<{ id: string; name?: string; profiles: string[] }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const brandDir = await resolveBrandDirectory(effectiveRoot, entry.name);
    const base = await readFirstDocument(documentCandidates(brandDir), false, true);
    if (!base) continue;
    result.push({
      id: entry.name,
      name: brandNameFrom(base.document),
      profiles: (await collectBrandProfiles(brandDir)).sort(),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function inspectBrand(brandRoot: string, brandRef: string, surface?: string, brandSourceRoots: string[] = [], brandSource?: BrandSourceDescriptor): Promise<RenderBrandContext> {
  return resolveBrandContext(brandRoot, { brandRef, surface, brandSourceRoots, brandSource });
}

export function brandCapabilities(context: RenderBrandContext): BrandCapabilities {
  const theme = context.theme;
  return {
    ...(context.brandName ? { brand_name: context.brandName } : {}),
    output_formats: ['pdf', 'png', 'pptx'],
    surfaces: ['pdf-a4', 'png', 'pptx-16x9'],
    assets: {
      logo: Boolean(theme.logoPath),
      logo_white: Boolean(theme.logoWhitePath),
      logo_mark: Boolean(theme.logoMarkPath),
      logo_white_mark: Boolean(theme.logoWhiteMarkPath),
      background_image: Boolean(theme.backgroundImagePath),
      cover_image: Boolean(theme.coverImagePath),
      report_header_image: Boolean(theme.reportHeaderImagePath),
      font_regular: Boolean(theme.fontRegularPath),
      font_bold: Boolean(theme.fontBoldPath),
    },
    typography: {
      body_family: theme.fontFamily,
      heading_family: theme.headingFontFamily,
      embedded_fonts_for_pdf_png: Boolean(theme.fontRegularPath),
    },
    layout: {
      report_header_style: theme.reportHeaderStyle,
      title_align: theme.titleAlign,
      logo_variant: theme.logoVariant,
      report_image_caption: theme.reportImageCaption,
    },
  };
}

export async function readBrandShowcase(brandRoot: string, brandRef: string): Promise<RecordValue> {
  const reference = parseReference(brandRef);
  if (!reference.brandId) throw new Error(`Showcase requires a brand URI such as brand://acme/primary: ${brandRef}`);
  const brandDir = await resolveBrandDirectory(brandRoot, reference.brandId);
  const document = await readFirstDocument([
    join(brandDir, 'showcase.yml'),
    join(brandDir, 'showcase.yaml'),
    join(brandDir, 'showcase.json'),
  ], true, true);
  if (!document) throw new Error(`Brand showcase not found for ${reference.brandId}`);
  const showcase = isRecord(document.document.showcase) ? document.document.showcase : document.document;
  if (document.document.schema_version !== 1) throw new Error(`Unsupported showcase schema_version for ${reference.brandId}: expected 1`);
  if (showcase.reports !== undefined && !Array.isArray(showcase.reports)) throw new Error(`showcase.reports must be an array for ${reference.brandId}`);
  if (showcase.decks !== undefined && !Array.isArray(showcase.decks)) throw new Error(`showcase.decks must be an array for ${reference.brandId}`);
  for (const deck of [...(Array.isArray(showcase.decks) ? showcase.decks : [])]) {
    if (!isRecord(deck) || !Array.isArray(deck.slides)) throw new Error(`Every showcase deck must contain a slides array for ${reference.brandId}`);
    for (const slide of deck.slides) {
      if (!isRecord(slide) || typeof slide.layout !== 'string' || (slide.brand_ref !== undefined && typeof slide.brand_ref !== 'string')) throw new Error(`Every showcase slide needs a layout and optional brand_ref for ${reference.brandId}`);
    }
  }
  return showcase;
}
