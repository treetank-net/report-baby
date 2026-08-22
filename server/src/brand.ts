import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { RenderTheme } from './core/model/render-theme.js';
import { logicalDirection, logicalPlacement, logicalSpacing, type LockupPlacement, type LockupSpacing, type SlideTemplateRef, type TextDirection } from './slide-templates.js';
import { readTemplateSource } from './template-source.js';

export type { RenderTheme } from './core/model/render-theme.js';

export interface BrandOverrides {
  fit?: {
    strategy?: 'none' | 'shrink-to-fit';
    min_body_pt?: number;
    min_heading_pt?: number;
  };
  layout?: {
    density?: 'comfortable' | 'compact';
    lockup_position?: LockupPlacement;
    lockup_spacing?: LockupSpacing;
  };
  typography?: {
    body?: { scale?: number; family?: string; role?: string };
    heading?: { scale?: number; family?: string; role?: string };
    heading_role?: string;
  };
  emphasis?: { role?: string };
}

export interface BrandDiagnostics {
  brandRef?: string;
  profile?: string;
  templateRef?: string;
  surface?: string;
  appliedOverrides: string[];
  warnings: string[];
}

export interface RenderComposition {
  templateRef: SlideTemplateRef;
  direction: TextDirection;
  lockupPlacement: LockupPlacement;
  lockupSpacing: LockupSpacing;
}

export interface RenderBrandContext {
  theme: RenderTheme;
  composition: RenderComposition;
  brandName?: string;
  diagnostics: BrandDiagnostics;
}

interface RecordValue {
  [key: string]: unknown;
}

const DEFAULT_THEME: RenderTheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  primary: '#2563eb',
  secondary: '#0ea5e9',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f8fafc',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f59e0b',
  palette: ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e'],
  fontFamily: 'DejaVu Sans',
  headingFontFamily: 'DejaVu Sans',
  bodyScale: 1,
  headingScale: 1,
  pptxHeadingScale: 1,
  fitStrategy: 'none',
  minBodyPt: 10,
  minHeadingPt: 18,
  density: 'comfortable',
  headerStyle: 'plain',
  reportHeaderStyle: 'plain',
  showReportBrandName: true,
  titleAlign: 'left',
  titleCase: 'normal',
  titleColor: '#ffffff',
  titleAccentColor: '#ffffff',
  titleSubtitleColor: '#ffffff',
  titleLogoWidthPx: 210,
  titleLogoHeightPx: 48,
  headingWeight: 700,
  bodyWeight: 400,
  radius: 10,
  logoVariant: 'default',
  backgroundImageOpacity: 0.16,
  imageTextColor: '#ffffff',
  imageTextSafeArea: { x: 0.05, y: 0.18, width: 0.58, height: 0.55 },
};

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

function merge(base: RecordValue, overlay: RecordValue): RecordValue {
  const output = clone(base);
  for (const [key, value] of Object.entries(overlay)) {
    if (isRecord(output[key]) && isRecord(value)) output[key] = merge(output[key] as RecordValue, value);
    else output[key] = clone(value);
  }
  return output;
}

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function safeRelativePath(rootDir: string, requested: string, subject = 'Brand path'): string {
  const candidate = resolve(rootDir, requested);
  const root = resolve(rootDir);
  if (!isInside(root, candidate)) throw new Error(`${subject} escapes configured root: ${requested}`);
  return candidate;
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

  const profilePath = safeRelativePath(brandDir, join('profiles', profile.replace(/\.(ya?ml|json)$/i, '') + '.yml'));
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

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function selectVariant(value: unknown, surface?: string): unknown {
  if (!isRecord(value)) return value;
  const isDark = Boolean(surface?.toLowerCase().includes('dark'));
  return value[isDark ? 'dark' : 'light'] ?? value.default ?? value;
}

function resolveColor(value: unknown, palette: RecordValue, surface?: string, seen = new Set<string>()): string | undefined {
  const selected = selectVariant(value, surface);
  if (typeof selected !== 'string') return undefined;
  if (selected.startsWith('#') || selected.startsWith('rgb') || selected.startsWith('hsl')) return selected;
  if (seen.has(selected)) return undefined;
  const paletteValue = palette[selected];
  if (paletteValue === undefined) return selected;
  seen.add(selected);
  return resolveColor(paletteValue, palette, surface, seen);
}

function stringFromTypography(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return asString(value.family);
  return undefined;
}

function brandNameFrom(document: RecordValue): string | undefined {
  const meta = document.meta;
  if (typeof meta === 'string') return meta;
  if (!isRecord(meta)) return undefined;
  return asString(meta.name) ?? asString(meta.short) ?? (isRecord(meta.name) ? asString(meta.name.short) ?? asString(meta.name.full) : undefined);
}

function assetRoot(brandDir: string, sourceRoot: string | undefined, brandSourceRoots: string[]): string {
  if (!sourceRoot) return brandDir;
  if (!isAbsolute(sourceRoot)) return resolve(brandDir, sourceRoot);
  const candidate = resolve(sourceRoot);
  if (!brandSourceRoots.some((root) => isInside(root, candidate))) {
    throw new Error(`Brand assets.source_root is an absolute path that is not allow-listed: ${sourceRoot}. Add it to REPORT_BABY_BRAND_SOURCE_ROOTS or use a path relative to the brand directory.`);
  }
  return candidate;
}

function assetPath(brandDir: string, document: RecordValue, key: string, brandSourceRoots: string[]): string | undefined {
  const assets = isRecord(document.assets) ? document.assets : {};
  const requested = asString(assets[key]);
  if (!requested) return undefined;
  const root = assetRoot(brandDir, asString(assets.source_root), brandSourceRoots);
  const path = safeRelativePath(root, requested, `Brand asset '${key}'`);
  return existsSync(path) ? path : undefined;
}

function assetWarnings(brandDir: string, document: RecordValue, brandSourceRoots: string[]): string[] {
  const assets = isRecord(document.assets) ? document.assets : {};
  const requested = ['logo', 'logo_white', 'logo_mark', 'logo_white_mark', 'background_image', 'cover_image', 'report_header_image', 'font_regular', 'font_bold'];
  return requested.flatMap((key) => {
    if (!asString(assets[key])) return [];
    return assetPath(brandDir, document, key, brandSourceRoots) ? [] : [`Brand asset '${key}' was not found.`];
  });
}

function extractTheme(brandDir: string, document: RecordValue, surface: string | undefined, brandSourceRoots: string[]): { theme: RenderTheme; composition: RenderComposition; brandName?: string; warnings: string[] } {
  const color = isRecord(document.color) ? document.color : {};
  const palette = isRecord(color.palette) ? color.palette : {};
  const role = (name: string, fallback: string) => resolveColor(color[name], palette, surface) ?? fallback;
  const typography = isRecord(document.typography) ? document.typography : {};
  const fonts = Array.isArray(typography.fonts) ? typography.fonts : [];
  const baseFont = stringFromTypography(typography.base) ?? (isRecord(fonts[0]) ? asString(fonts[0].family) : undefined) ?? DEFAULT_THEME.fontFamily;
  const headingFont = stringFromTypography(typography.headings) ?? baseFont;
  const namedColors = Object.values(palette).map((item) => resolveColor(item, palette, surface)).filter((item): item is string => Boolean(item));
  const series = Array.isArray(color.series)
    ? color.series.map((item) => resolveColor(item, palette, surface)).filter((item): item is string => Boolean(item))
    : [];
  const paletteValues = [...new Set(series.length > 0 ? series : namedColors)].slice(0, 8);
  const warnings: string[] = [];
  if (document.schema_version === undefined) warnings.push('Brand document has no schema_version; treated as legacy v1.');
  const fontRegularPath = assetPath(brandDir, document, 'font_regular', brandSourceRoots);
  const fontBoldPath = assetPath(brandDir, document, 'font_bold', brandSourceRoots);
  if (baseFont !== DEFAULT_THEME.fontFamily || headingFont !== DEFAULT_THEME.headingFontFamily) {
    warnings.push(fontRegularPath
      ? `Font '${baseFont}'/'${headingFont}' is loaded from brand assets for PDF, PNG and editable outputs.`
      : `Font '${baseFont}'/'${headingFont}' is selected for editable outputs; no font asset was provided, so raster/PDF falls back to embedded DejaVu Sans.`);
  }
  const layout = isRecord(document.layout) ? document.layout : {};
  const composition: RenderComposition = {
    templateRef: typeof layout.slide_template === 'string' && layout.slide_template.length > 0 ? layout.slide_template : 'slides/standard',
    direction: logicalDirection(layout.direction),
    lockupPlacement: logicalPlacement(layout.lockup_position),
    lockupSpacing: logicalSpacing(layout.lockup_spacing),
  };
  const headerStyle = asString(layout.header_style);
  const reportHeaderStyle = asString(layout.report_header_style) ?? headerStyle;
  const showReportBrandName = layout.show_report_brand_name !== false;
  const titleAlign = asString(layout.title_align);
  const titleCase = asString(layout.title_case);
  const titleColor = resolveColor(layout.title_color, palette, surface) ?? DEFAULT_THEME.titleColor;
  const titleAccentColor = resolveColor(layout.title_accent_color, palette, surface) ?? titleColor;
  const titleSubtitleColor = resolveColor(layout.title_subtitle_color, palette, surface) ?? titleColor;
  const titleLogoWidthPx = typeof layout.title_logo_width_px === 'number' ? Math.max(100, Math.min(320, layout.title_logo_width_px)) : DEFAULT_THEME.titleLogoWidthPx;
  const titleLogoHeightPx = typeof layout.title_logo_height_px === 'number' ? Math.max(20, Math.min(80, layout.title_logo_height_px)) : DEFAULT_THEME.titleLogoHeightPx;
  const coverBackground = resolveColor(layout.cover_background, palette, surface);
  const logoVariant = asString(layout.logo_variant);
  const backgroundImageOpacity = typeof layout.background_image_opacity === 'number' ? layout.background_image_opacity : DEFAULT_THEME.backgroundImageOpacity;
  const imageTextColor = resolveColor(layout.image_text_color, palette, surface) ?? DEFAULT_THEME.imageTextColor;
  const safeArea = isRecord(layout.image_text_safe_area) ? layout.image_text_safe_area : {};
  const imageTextSafeArea = {
    x: typeof safeArea.x === 'number' ? safeArea.x : DEFAULT_THEME.imageTextSafeArea.x,
    y: typeof safeArea.y === 'number' ? safeArea.y : DEFAULT_THEME.imageTextSafeArea.y,
    width: typeof safeArea.width === 'number' ? safeArea.width : DEFAULT_THEME.imageTextSafeArea.width,
    height: typeof safeArea.height === 'number' ? safeArea.height : DEFAULT_THEME.imageTextSafeArea.height,
  };
  if ([imageTextSafeArea.x, imageTextSafeArea.y, imageTextSafeArea.width, imageTextSafeArea.height].some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || imageTextSafeArea.width <= 0
    || imageTextSafeArea.height <= 0
    || imageTextSafeArea.x + imageTextSafeArea.width > 1
    || imageTextSafeArea.y + imageTextSafeArea.height > 1) {
    throw new Error(`Invalid layout.image_text_safe_area in ${brandDir}; values must be normalized and stay within 0..1.`);
  }
  const scrim = isRecord(layout.image_scrim) ? layout.image_scrim : undefined;
  const imageScrimColor = scrim ? resolveColor(scrim.color, palette, surface) : undefined;
  const imageScrim = imageScrimColor ? { color: imageScrimColor, opacity: Math.max(0, Math.min(1, typeof scrim?.opacity === 'number' ? scrim.opacity : 0.12)) } : undefined;
  const headingScale = typeof layout.heading_scale === 'number' ? Math.max(0.5, Math.min(1.5, layout.heading_scale)) : DEFAULT_THEME.headingScale;
  const bodyScale = typeof layout.body_scale === 'number' ? Math.max(0.5, Math.min(1.5, layout.body_scale)) : DEFAULT_THEME.bodyScale;
  const pptxHeadingScale = typeof layout.pptx_heading_scale === 'number' ? Math.max(0.85, Math.min(1.15, layout.pptx_heading_scale)) : DEFAULT_THEME.pptxHeadingScale;
  warnings.push(...assetWarnings(brandDir, document, brandSourceRoots));
  return {
    brandName: brandNameFrom(document),
    warnings,
    composition,
    theme: {
      ...DEFAULT_THEME,
      background: role('background', DEFAULT_THEME.background),
      foreground: role('foreground', DEFAULT_THEME.foreground),
      primary: role('primary', paletteValues[0] ?? DEFAULT_THEME.primary),
      secondary: role('secondary', paletteValues[1] ?? DEFAULT_THEME.secondary),
      muted: role('muted', DEFAULT_THEME.muted),
      line: role('line', DEFAULT_THEME.line),
      soft: role('surface', DEFAULT_THEME.soft),
      success: role('success', DEFAULT_THEME.success),
      danger: role('danger', DEFAULT_THEME.danger),
      warning: role('warning', DEFAULT_THEME.warning),
      palette: paletteValues.length >= 2 ? paletteValues : DEFAULT_THEME.palette,
      fontFamily: baseFont,
      headingFontFamily: headingFont,
      bodyScale,
      headingScale,
      pptxHeadingScale,
      headerStyle: headerStyle === 'accent-band' || headerStyle === 'dark-band' || headerStyle === 'image-band' ? headerStyle : DEFAULT_THEME.headerStyle,
      reportHeaderStyle: reportHeaderStyle === 'accent-band' || reportHeaderStyle === 'dark-band' || reportHeaderStyle === 'image-band' ? reportHeaderStyle : DEFAULT_THEME.reportHeaderStyle,
      showReportBrandName,
      titleAlign: titleAlign === 'center' ? 'center' : DEFAULT_THEME.titleAlign,
      titleCase: titleCase === 'upper' ? 'upper' : DEFAULT_THEME.titleCase,
      titleColor,
      titleAccentColor,
      titleSubtitleColor,
      titleLogoWidthPx,
      titleLogoHeightPx,
      coverBackground,
      headingWeight: typeof layout.heading_weight === 'number' ? layout.heading_weight : DEFAULT_THEME.headingWeight,
      bodyWeight: typeof layout.body_weight === 'number' ? layout.body_weight : DEFAULT_THEME.bodyWeight,
      radius: typeof layout.radius === 'number' ? layout.radius : DEFAULT_THEME.radius,
      logoVariant: logoVariant === 'white' ? 'white' : DEFAULT_THEME.logoVariant,
      logoPath: assetPath(brandDir, document, 'logo', brandSourceRoots),
      logoWhitePath: assetPath(brandDir, document, 'logo_white', brandSourceRoots),
      logoMarkPath: assetPath(brandDir, document, 'logo_mark', brandSourceRoots),
      logoWhiteMarkPath: assetPath(brandDir, document, 'logo_white_mark', brandSourceRoots),
      backgroundImagePath: assetPath(brandDir, document, 'background_image', brandSourceRoots),
      coverImagePath: assetPath(brandDir, document, 'cover_image', brandSourceRoots),
      reportHeaderImagePath: assetPath(brandDir, document, 'report_header_image', brandSourceRoots),
      backgroundImageOpacity: Math.max(0, Math.min(1, backgroundImageOpacity)),
      imageTextColor,
      imageTextSafeArea,
      imageScrim,
      fontRegularPath,
      fontBoldPath,
    },
  };
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
        const source = {
          schema_version: 1,
          id: compiled.id,
          kind: compiled.kind,
          surface: compiled.surface,
          archetype: compiled.archetype,
          canvas: compiled.canvas,
          regions: compiled.regions,
          slots: Object.fromEntries(Object.entries(compiled.slots).map(([id, slot]) => {
            const item = slot as RecordValue;
            return [id, { type: item.kind, frame: item.frame, region: item.region, role: item.role, max_lines: item.maxLines, overflow: item.overflow }];
          })),
          constraints: { inside_canvas: isRecord(compiled.constraints) ? compiled.constraints.insideCanvas : true, no_overlap: isRecord(compiled.constraints) ? compiled.constraints.noOverlap : false },
        };
        return { source, path: compiledPath };
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

export async function listBrandTemplates(brandRoot: string, brandRef: string): Promise<Array<{ templateRef: string; path: string }>> {
  const reference = parseReference(brandRef);
  if (!reference.brandId) throw new Error(`Template discovery requires a brand URI such as brand://acme/primary: ${brandRef}`);
  const templateRoot = join(await resolveBrandDirectory(brandRoot, reference.brandId), 'templates');
  const { readdir } = await import('node:fs/promises');
  const result: Array<{ templateRef: string; path: string }> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /^template\.(ya?ml|json)$/i.test(entry.name)) {
        const id = relative(templateRoot, directory).replaceAll('\\', '/');
        if (id) result.push({ templateRef: id, path });
      }
    }
  }
  await walk(templateRoot);
  return result.sort((a, b) => a.templateRef.localeCompare(b.templateRef));
}

export async function inspectBrandTemplate(brandRoot: string, brandRef: string, templateRef: string): Promise<{ templateRef: string; sourcePath: string; compiled: import('./template-source.js').CompiledTemplate }> {
  const source = await readBrandTemplateSource(brandRoot, brandRef, templateRef);
  if (!source) throw new Error(`Brand template '${templateRef}' was not found for ${brandRef}.`);
  const { compileTemplateSource } = await import('./template-source.js');
  return { templateRef, sourcePath: source.path, compiled: compileTemplateSource(source.source) };
}

function parseHexColor(value: string | undefined): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return undefined;
  const raw = match[1].length === 3 ? match[1].split('').map((part) => part + part).join('') : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16)) as [number, number, number];
}

function channelLuminance(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

export function colorContrastRatio(foreground: string | undefined, background: string | undefined): number | undefined {
  const first = parseHexColor(foreground);
  const second = parseHexColor(background);
  if (!first || !second) return undefined;
  const luminance = (channels: [number, number, number]) => 0.2126 * channelLuminance(channels[0]) + 0.7152 * channelLuminance(channels[1]) + 0.0722 * channelLuminance(channels[2]);
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableInk(background: string | undefined, candidates: Array<string | undefined>, minimum: number): string {
  const scored = candidates
    .map((candidate) => ({ candidate, ratio: colorContrastRatio(candidate, background) }))
    .filter((entry): entry is { candidate: string; ratio: number } => Boolean(entry.candidate) && entry.ratio !== undefined);
  const preferred = scored.find((entry) => entry.ratio >= minimum);
  if (preferred) return preferred.candidate;
  const best = scored.reduce<{ candidate: string; ratio: number } | undefined>((winner, entry) => (!winner || entry.ratio > winner.ratio ? entry : winner), undefined);
  return best?.candidate ?? candidates.find((candidate): candidate is string => Boolean(candidate)) ?? '#ffffff';
}

export function defaultRenderTheme(): RenderTheme {
  return { ...DEFAULT_THEME, palette: [...DEFAULT_THEME.palette], imageTextSafeArea: { ...DEFAULT_THEME.imageTextSafeArea } };
}

export async function assetDataUri(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const extension = extname(filePath).toLowerCase();
  const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
  let content = await readFile(filePath);
  if (mime === 'image/svg+xml') {
    content = Buffer.from(content.toString('utf8').replaceAll(/var\(--fill-0,\s*white\)/g, '#ffffff'));
  }
  return `data:${mime};base64,${content.toString('base64')}`;
}

export async function resolveBrandContext(
  brandRoot: string,
  options: { brandRef?: string; templateRef?: string; surface?: string; overrides?: BrandOverrides; brandSourceRoots?: string[] } = {},
): Promise<RenderBrandContext> {
  const diagnostics: BrandDiagnostics = {
    brandRef: options.brandRef,
    templateRef: options.templateRef,
    surface: options.surface,
    appliedOverrides: [],
    warnings: [],
  };
  if (!options.brandRef) return { theme: applyOverrides(defaultRenderTheme(), {}, options.overrides, diagnostics), composition: { templateRef: 'slides/standard', direction: 'ltr', lockupPlacement: 'top-start', lockupSpacing: 'normal' }, diagnostics };

  const reference = parseReference(options.brandRef);
  let document: RecordValue;
  let profile: string | undefined;
  const documentPath = reference.filePath ? safeRelativePath(brandRoot, reference.filePath, 'Brand reference') : undefined;
  if (documentPath) {
    document = await readDocument(documentPath, true);
  } else {
    profile = reference.profile;
    document = (await readProfile(brandRoot, reference.brandId as string, profile)).document;
  }
  diagnostics.profile = profile;
  const brandDir = documentPath ? dirname(documentPath) : await resolveBrandDirectory(brandRoot, reference.brandId as string);
  const extracted = extractTheme(brandDir, document, options.surface, options.brandSourceRoots ?? []);
  diagnostics.warnings.push(...extracted.warnings);
  const theme = applyOverrides(extracted.theme, document, options.overrides, diagnostics);
  return { theme, composition: extracted.composition, brandName: extracted.brandName, diagnostics };
}

export async function listBrandbooks(brandRoot: string): Promise<Array<{ id: string; name?: string; profiles: string[] }>> {
  const { readdir } = await import('node:fs/promises');
  async function profileNames(directory: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) names.push(...await profileNames(join(directory, entry.name), relative));
      else if (entry.isFile() && /\.(ya?ml|json)$/i.test(entry.name)) names.push(relative.replace(/\.(ya?ml|json)$/i, ''));
    }
    return names;
  }
  const entries = await readdir(brandRoot, { withFileTypes: true }).catch(() => []);
  const result: Array<{ id: string; name?: string; profiles: string[] }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const brandDir = await resolveBrandDirectory(brandRoot, entry.name);
    const base = await readFirstDocument(documentCandidates(brandDir), false, true);
    if (!base) continue;
    const profileDir = join(brandDir, 'profiles');
    result.push({
      id: entry.name,
      name: brandNameFrom(base.document),
      profiles: (await profileNames(profileDir)).sort(),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

export async function inspectBrand(brandRoot: string, brandRef: string, surface?: string, brandSourceRoots: string[] = []): Promise<RenderBrandContext> {
  return resolveBrandContext(brandRoot, { brandRef, surface, brandSourceRoots });
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
      if (!isRecord(slide) || typeof slide.type !== 'string' || (slide.profile !== undefined && typeof slide.profile !== 'string')) throw new Error(`Every showcase slide needs a type and optional profile for ${reference.brandId}`);
    }
  }
  return showcase;
}
