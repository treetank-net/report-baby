import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, dirname, extname } from 'node:path';
import { deflateSync } from 'node:zlib';
import { readRenderConfig } from '../template/builtins.js';
import { decodePng, type PngRaster } from '../rendering/image-raster.js';

export interface PreparedAssetSource {
  path: string;
  bytes: number;
  px: [number, number];
  sha256: string;
}

export interface PreparedAssetDerivative {
  role: string;
  path: string;
  px: [number, number];
  dpi: number;
  crop: [number, number, number, number];
  bytes: number;
}

export interface PreparedAssetEntry {
  kind: 'prepared-assets';
  source: PreparedAssetSource;
  derivatives: PreparedAssetDerivative[];
  generatedAt: string;
  toolVersion: string;
}

export interface PreparedAssetsManifest {
  schema_version: 1;
  kind: 'prepared-assets';
  assets: PreparedAssetEntry[];
}

type PngImage = PngRaster;

interface PreparedTarget {
  role: string;
  width: number;
  height: number;
  dpi: number;
  anchorY: number;
}

const preparedImageCache = new Map<string, Buffer>();

export function clearPreparedAssetCache(): void {
  preparedImageCache.clear();
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const body = Buffer.concat([name, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function encodePng(image: PngImage): Buffer {
  const rowBytes = image.width * image.channels;
  const raw = Buffer.alloc(image.height * (rowBytes + 1));
  for (let y = 0; y < image.height; y += 1) {
    const target = y * (rowBytes + 1);
    raw[target] = 0;
    image.pixels.copy(raw, target + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = image.channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

export function preparePngBuffer(source: Buffer, width: number, height: number, anchorY: number): Buffer | undefined {
  try {
    return encodePng(resizeCover(decodePng(source), { role: 'runtime', width, height, dpi: 0, anchorY }).image);
  } catch {
    return undefined;
  }
}

function cropForTarget(source: PngImage, target: PreparedTarget): [number, number, number, number] {
  const sourceAspect = source.width / source.height;
  const targetAspect = target.width / target.height;
  if (Math.abs(sourceAspect - targetAspect) < 0.0001) return [0, 0, 1, 1];
  if (sourceAspect > targetAspect) {
    const width = source.height * targetAspect;
    const left = (source.width - width) / 2;
    return [left / source.width, 0, width / source.width, 1];
  }
  const height = source.width / targetAspect;
  const top = Math.max(0, Math.min(source.height - height, (source.height - height) * target.anchorY));
  return [0, top / source.height, 1, height / source.height];
}

function resizeCover(source: PngImage, target: PreparedTarget): { image: PngImage; crop: [number, number, number, number] } {
  const crop = cropForTarget(source, target);
  const sourceX = crop[0] * source.width;
  const sourceY = crop[1] * source.height;
  const sourceWidth = crop[2] * source.width;
  const sourceHeight = crop[3] * source.height;
  const pixels = Buffer.alloc(target.width * target.height * source.channels);
  for (let y = 0; y < target.height; y += 1) {
    const sy = sourceY + (y + 0.5) * sourceHeight / target.height - 0.5;
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sy)));
    const y1 = Math.max(0, Math.min(source.height - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, sy - Math.floor(sy)));
    for (let x = 0; x < target.width; x += 1) {
      const sx = sourceX + (x + 0.5) * sourceWidth / target.width - 0.5;
      const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sx)));
      const x1 = Math.max(0, Math.min(source.width - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, sx - Math.floor(sx)));
      for (let channel = 0; channel < source.channels; channel += 1) {
        const a = source.pixels[(y0 * source.width + x0) * source.channels + channel];
        const b = source.pixels[(y0 * source.width + x1) * source.channels + channel];
        const c = source.pixels[(y1 * source.width + x0) * source.channels + channel];
        const d = source.pixels[(y1 * source.width + x1) * source.channels + channel];
        pixels[(y * target.width + x) * source.channels + channel] = Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
      }
    }
  }
  return { image: { width: target.width, height: target.height, channels: source.channels, pixels }, crop };
}

function targets(): PreparedTarget[] {
  const config = readRenderConfig().assets;
  return [
    { role: 'report_header_band', width: config.reportHeaderBandWidthPx, height: config.reportHeaderBandHeightPx, dpi: config.reportHeaderBandDpi, anchorY: config.reportHeaderBandAnchorY },
    { role: 'slide_background', width: config.slideBackgroundWidthPx, height: config.slideBackgroundHeightPx, dpi: config.slideBackgroundDpi, anchorY: config.slideBackgroundAnchorY },
    { role: 'cover', width: config.coverWidthPx, height: config.coverHeightPx, dpi: config.coverDpi, anchorY: config.coverAnchorY },
  ];
}

async function rasterFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await rasterFiles(path));
    else if (entry.isFile() && ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(entry.name).toLowerCase())) result.push(path);
  }
  return result;
}

function safeDerivativePath(relativeSource: string, role: string): string {
  return `_prepared/${relativeSource.slice(0, -extname(relativeSource).length)}.${role}.png`;
}

export async function prepareBrandAssets(brandDir: string, toolVersion: string): Promise<PreparedAssetsManifest> {
  const entries: PreparedAssetEntry[] = [];
  const sourceRoot = join(brandDir, 'assets');
  for (const sourcePath of await rasterFiles(sourceRoot)) {
    const sourceBytes = await readFile(sourcePath);
    let decoded: PngImage;
    try {
      decoded = decodePng(sourceBytes);
    } catch {
      continue;
    }
    const sourceRelative = relative(brandDir, sourcePath).replaceAll('\\', '/');
    const source: PreparedAssetSource = {
      path: sourceRelative,
      bytes: sourceBytes.length,
      px: [decoded.width, decoded.height],
      sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    };
    const derivatives: PreparedAssetDerivative[] = [];
    for (const target of targets()) {
      const metadata = await stat(sourcePath);
      const key = `${sourcePath}|${metadata.mtimeMs}|${target.width}x${target.height}|${target.dpi}`;
      let prepared = preparedImageCache.get(key);
      const crop = cropForTarget(decoded, target);
      if (!prepared) {
        prepared = encodePng(resizeCover(decoded, target).image);
        preparedImageCache.set(key, prepared);
      }
      const derivativeRelative = safeDerivativePath(sourceRelative, target.role);
      const derivativePath = join(brandDir, derivativeRelative);
      await mkdir(dirname(derivativePath), { recursive: true });
      await writeFile(derivativePath, prepared);
      derivatives.push({ role: target.role, path: derivativeRelative, px: [target.width, target.height], dpi: target.dpi, crop, bytes: prepared.length });
    }
    entries.push({ kind: 'prepared-assets', source, derivatives, generatedAt: new Date().toISOString(), toolVersion });
  }
  const manifest: PreparedAssetsManifest = { schema_version: 1, kind: 'prepared-assets', assets: entries };
  await mkdir(join(brandDir, '_prepared'), { recursive: true });
  await writeFile(join(brandDir, '_prepared', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
