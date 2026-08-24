import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { renderSvgToPng } from './render-primitives.js';
import { readRenderConfig } from './builtin-template-source.js';
import type { SourceContext } from './source-context.js';

export interface ResolvedImageAsset {
  data: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
  source: string;
}

function dimensionsPng(bytes: Buffer): [number, number] | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function dimensionsJpeg(bytes: Buffer): [number, number] | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    const isFrame = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
    if (isFrame && length >= 7) return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    offset += length;
  }
  return undefined;
}

function svgDimensions(source: string): [number, number] | undefined {
  const root = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return undefined;
  const width = Number.parseFloat(root.match(/\bwidth=["']([0-9.]+)/i)?.[1] ?? '');
  const height = Number.parseFloat(root.match(/\bheight=["']([0-9.]+)/i)?.[1] ?? '');
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return [width, height];
  const viewBox = root.match(/\bviewBox=["']\s*([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s+([0-9.+-]+)\s*["']/i);
  if (!viewBox) return undefined;
  const viewWidth = Number.parseFloat(viewBox[3]);
  const viewHeight = Number.parseFloat(viewBox[4]);
  return Number.isFinite(viewWidth) && Number.isFinite(viewHeight) && viewWidth > 0 && viewHeight > 0 ? [viewWidth, viewHeight] : undefined;
}

function enforceDimensions(width: number, height: number): void {
  const limits = readRenderConfig().images;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Image dimensions are missing or invalid.');
  if (width > limits.maxDimensionPx || height > limits.maxDimensionPx) throw new Error(`Image dimensions exceed the ${limits.maxDimensionPx}px limit.`);
  if (width * height > limits.maxDecodedPixels) throw new Error(`Image decoded area exceeds the ${limits.maxDecodedPixels}-pixel limit.`);
}

async function fetchImage(url: string): Promise<Buffer> {
  const limits = readRenderConfig().images;
  let current = url;
  for (let redirect = 0; redirect <= limits.remoteMaxRedirects; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(limits.remoteTimeoutMs) });
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > limits.maxAssetBytes) throw new Error(`Remote image exceeds the ${limits.maxAssetBytes}-byte limit.`);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Image URL redirect from '${current}' has no location.`);
      if (redirect === limits.remoteMaxRedirects) throw new Error('Image URL exceeded the redirect limit.');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Image URL '${current}' returned HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limits.maxAssetBytes) throw new Error(`Remote image exceeds the ${limits.maxAssetBytes}-byte limit.`);
    return bytes;
  }
  throw new Error('Image URL exceeded the redirect limit.');
}

export async function resolveImageAsset(source: string, context: SourceContext): Promise<ResolvedImageAsset> {
  const limits = readRenderConfig().images;
  if (/^data:/i.test(source)) throw new Error('Data URI image sources are not supported; provide a local path or HTTP(S) URL.');
  let bytes: Buffer;
  if (/^https?:\/\//i.test(source)) bytes = await fetchImage(source);
  else {
    const path = context.resolvePath(source);
    if (!existsSync(path)) throw new Error(`Image source was not found: ${source}`);
    const metadata = await stat(path);
    if (metadata.size > limits.maxAssetBytes) throw new Error(`Image source '${source}' exceeds the ${limits.maxAssetBytes}-byte limit.`);
    bytes = await readFile(path);
  }
  if (bytes.length > limits.maxAssetBytes) throw new Error(`Image source '${source}' exceeds the ${limits.maxAssetBytes}-byte limit.`);

  const png = dimensionsPng(bytes);
  if (png) {
    enforceDimensions(...png);
    return { data: `data:image/png;base64,${bytes.toString('base64')}`, format: 'PNG', width: png[0], height: png[1], source };
  }
  const jpeg = dimensionsJpeg(bytes);
  if (jpeg) {
    enforceDimensions(...jpeg);
    return { data: `data:image/jpeg;base64,${bytes.toString('base64')}`, format: 'JPEG', width: jpeg[0], height: jpeg[1], source };
  }
  const svg = bytes.toString('utf8');
  const dimensions = svgDimensions(svg);
  if (dimensions) {
    enforceDimensions(...dimensions);
    const pngBuffer = await renderSvgToPng(svg, Math.min(dimensions[0], limits.maxDimensionPx));
    const rendered = dimensionsPng(pngBuffer);
    if (!rendered) throw new Error(`SVG image '${source}' could not be rasterized.`);
    enforceDimensions(...rendered);
    return { data: `data:image/png;base64,${pngBuffer.toString('base64')}`, format: 'PNG', width: rendered[0], height: rendered[1], source };
  }
  throw new Error(`Image source '${source}' is not a supported PNG, JPEG, or SVG image.`);
}
