import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { readRenderConfig } from '../template/builtins.js';
import type { PreparedAssetEntry, PreparedAssetsManifest } from './asset-preparation.js';
import { asString, isRecord, type RecordValue } from './value.js';
import { isInside, safeRelativePath } from './paths.js';

function assetRoot(brandDir: string, sourceRoot: string | undefined, brandSourceRoots: string[]): string {
  if (!sourceRoot) return brandDir;
  if (!isAbsolute(sourceRoot)) return resolve(brandDir, sourceRoot);
  const candidate = resolve(sourceRoot);
  if (!brandSourceRoots.some((root) => isInside(root, candidate))) {
    throw new Error(`Brand assets.source_root is an absolute path that is not allow-listed: ${sourceRoot}. Add it to REPORT_BABY_BRAND_SOURCE_ROOTS or use a path relative to the brand directory.`);
  }
  return candidate;
}

export function assetPath(brandDir: string, document: RecordValue, key: string, brandSourceRoots: string[]): string | undefined {
  const assets = isRecord(document.assets) ? document.assets : {};
  const requested = asString(assets[key]);
  if (!requested) return undefined;
  const root = assetRoot(brandDir, asString(assets.source_root), brandSourceRoots);
  const path = safeRelativePath(root, requested, `Brand asset '${key}'`);
  return existsSync(path) ? path : undefined;
}

export function assetWarnings(brandDir: string, document: RecordValue, brandSourceRoots: string[]): string[] {
  const assets = isRecord(document.assets) ? document.assets : {};
  const requested = ['logo', 'logo_white', 'logo_mark', 'logo_white_mark', 'background_image', 'cover_image', 'report_header_image', 'font_regular', 'font_bold', 'font_glyph_regular', 'font_glyph_bold'];
  return requested.flatMap((key) => {
    if (!asString(assets[key])) return [];
    return assetPath(brandDir, document, key, brandSourceRoots) ? [] : [`Brand asset '${key}' was not found.`];
  });
}

export function oversizedRasterWarnings(brandDir: string, document: RecordValue, brandSourceRoots: string[]): string[] {
  const assets = isRecord(document.assets) ? document.assets : {};
  const targets = [
    ['background_image', ['report_header_band', 'slide_background']],
    ['cover_image', ['cover']],
    ['report_header_image', ['report_header_band']],
  ] as const;
  const config = readRenderConfig().assets;
  const multiplier = config.assetPreparationWarningMultiplier;
  const targetDimensions = {
    report_header_band: [config.reportHeaderBandWidthPx, config.reportHeaderBandHeightPx],
    slide_background: [config.slideBackgroundWidthPx, config.slideBackgroundHeightPx],
    cover: [config.coverWidthPx, config.coverHeightPx],
  } as const;
  return targets.flatMap(([assetKey, roles]) => {
    const path = assetPath(brandDir, document, assetKey, brandSourceRoots);
    if (!path || extname(path).toLowerCase() !== '.png' || !isRecord(assets)) return [];
    try {
      const header = readFileSync(path);
      if (header.length < 24 || header.readUInt32BE(0) !== 0x89504e47 || header.readUInt32BE(4) !== 0x0d0a1a0a) return [];
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      for (const role of roles) {
        const [targetWidth, targetHeight] = targetDimensions[role];
        if (targetWidth && targetHeight && (width > targetWidth * multiplier || height > targetHeight * multiplier)) return [`Raster asset '${relative(brandDir, path).replaceAll('\\', '/')}' is ${width}x${height}; publish prepares a ${role} derivative at ${targetWidth}x${targetHeight}.`];
      }
      return [];
    } catch {
      return [];
    }
  });
}

const sourceHashCache = new Map<string, string>();

export function readPreparedAssets(brandDir: string): PreparedAssetsManifest | undefined {
  const path = join(brandDir, '_prepared', 'manifest.json');
  if (!existsSync(path)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PreparedAssetsManifest;
    return manifest.kind === 'prepared-assets' && manifest.schema_version === 1 && Array.isArray(manifest.assets) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

function sourceHash(path: string): string {
  const metadata = statSync(path);
  const key = `${path}|${metadata.mtimeMs}|${metadata.size}`;
  const cached = sourceHashCache.get(key);
  if (cached) return cached;
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  sourceHashCache.set(key, hash);
  return hash;
}

export function preparedImagePath(brandDir: string, originalPath: string | undefined, role: string, manifest: PreparedAssetsManifest | undefined): { path?: string; warning?: string } {
  if (!originalPath || !['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(extname(originalPath).toLowerCase())) return { path: originalPath };
  const relativeSource = relative(brandDir, originalPath).replaceAll('\\', '/');
  const entry = manifest?.assets.find((item: PreparedAssetEntry) => item.source.path === relativeSource);
  const derivative = entry?.derivatives.find((item) => item.role === role);
  if (entry && derivative && existsSync(join(brandDir, derivative.path))) {
    try {
      if (sourceHash(originalPath) === entry.source.sha256) return { path: join(brandDir, derivative.path) };
    } catch {
      // Fall through to the original asset with a diagnostic below.
    }
  }
  return { path: originalPath, warning: `Raster asset '${relativeSource}' has no valid prepared '${role}' derivative; using the slower fallback path.` };
}

const assetUriCache = new Map<string, string>();

export async function assetDataUri(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined;
  const extension = extname(filePath).toLowerCase();
  const mime = extension === '.svg' ? 'image/svg+xml' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.avif' ? 'image/avif' : 'image/png';
  const metadata = statSync(filePath);
  const cacheKey = `${filePath}|${metadata.mtimeMs}|${metadata.size}`;
  const cached = assetUriCache.get(cacheKey);
  if (cached) return cached;
  let content = await readFile(filePath);
  if (mime === 'image/svg+xml') content = Buffer.from(content.toString('utf8').replaceAll(/var\(--fill-0,\s*white\)/g, '#ffffff'));
  const uri = `data:${mime};base64,${content.toString('base64')}`;
  assetUriCache.set(cacheKey, uri);
  return uri;
}
