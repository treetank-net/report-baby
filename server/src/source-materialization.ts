import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { unzipSync } from 'fflate';
import { getConfigDir } from './config.js';
import { readRenderConfig } from './builtin-template-source.js';
import type { BrandSourceDescriptor } from './source-contract.js';

const execFileAsync = promisify(execFile);

export interface MaterializedSource {
  sourceRoot: string;
  brandRoot: string;
  kind: 'directory' | 'zip' | 'git';
  cacheKey?: string;
  warnings: string[];
}

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  externalAttributes: number;
  isDirectory: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const value = relative(root, candidate);
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
}

function sourceBrandRoot(sourceRoot: string, brandPath: string | undefined): string {
  const selected = resolve(sourceRoot, brandPath ?? '.');
  if (!isInside(resolve(sourceRoot), selected)) throw new Error(`brand_path escapes the materialized source root: ${brandPath}`);
  return selected;
}

function u16(bytes: Buffer, offset: number): number {
  return bytes.readUInt16LE(offset);
}

function u32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32LE(offset);
}

function zipPath(name: string): string {
  const normalized = name.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error(`ZIP entry has an absolute path: ${name}`);
  const parts = normalized.split('/');
  if (parts.some((part, index) => part === '..' || (part === '' && index !== parts.length - 1) || part === '.')) throw new Error(`ZIP entry contains an unsafe path: ${name}`);
  return normalized;
}

function isNestedArchive(name: string): boolean {
  return /\.(?:zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name.replace(/\/$/, ''));
}

function zipEntries(bytes: Buffer): ZipEntry[] {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = bytes.lastIndexOf(eocdSignature, Math.max(0, bytes.length - 22));
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('ZIP archive is missing its end-of-central-directory record.');
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0 || u16(bytes, eocd + 8) !== u16(bytes, eocd + 10)) throw new Error('Multi-disk ZIP archives are not supported.');
  const entryCount = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported.');
  if (centralOffset + centralSize > bytes.length) throw new Error('ZIP central directory exceeds the archive.');

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || u32(bytes, offset) !== 0x02014b50) throw new Error('ZIP central directory contains an invalid entry.');
    const flags = u16(bytes, offset + 8);
    const compressedSize = u32(bytes, offset + 20);
    const uncompressedSize = u32(bytes, offset + 24);
    const nameLength = u16(bytes, offset + 28);
    const extraLength = u16(bytes, offset + 30);
    const commentLength = u16(bytes, offset + 32);
    const externalAttributes = u32(bytes, offset + 38);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('ZIP entry metadata exceeds the archive.');
    if (flags & 0x1) throw new Error('Encrypted ZIP entries are not supported.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw new Error('ZIP64 entry sizes are not supported.');
    const name = (flags & 0x800 ? new TextDecoder().decode(nameBytes) : nameBytes.toString('latin1'));
    const safeName = zipPath(name);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0xf000) === 0xa000) throw new Error(`ZIP symlink entries are not supported: ${name}`);
    entries.push({ name: safeName, compressedSize, uncompressedSize, externalAttributes, isDirectory: safeName.endsWith('/') });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function validateZip(entries: ZipEntry[], archiveBytes: number): void {
  const limits = readRenderConfig().sources;
  if (entries.length > limits.zipMaxEntries) throw new Error(`ZIP archive contains ${entries.length} entries; maximum is ${limits.zipMaxEntries}.`);
  const nestedArchives = entries.filter((entry) => isNestedArchive(entry.name));
  if (nestedArchives.length > limits.zipMaxNestedArchives) throw new Error(`ZIP archive contains ${nestedArchives.length} nested archive entries; maximum is ${limits.zipMaxNestedArchives}.`);
  let total = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > limits.zipMaxFileBytes) throw new Error(`ZIP entry '${entry.name}' exceeds the per-file limit.`);
    total += entry.uncompressedSize;
    if (total > limits.zipMaxTotalBytes) throw new Error(`ZIP archive exceeds the total extracted-size limit.`);
    if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.zipMaxCompressionRatio) throw new Error(`ZIP entry '${entry.name}' exceeds the compression-ratio limit.`);
    if (entry.compressedSize > archiveBytes) throw new Error(`ZIP entry '${entry.name}' exceeds the archive size.`);
  }
}

async function extractZip(bytes: Buffer, destination: string): Promise<void> {
  const entries = zipEntries(bytes);
  validateZip(entries, bytes.length);
  const extracted = unzipSync(new Uint8Array(bytes));
  for (const entry of entries) {
    const target = resolve(destination, entry.name);
    if (!isInside(resolve(destination), target)) throw new Error(`ZIP entry escapes extraction root: ${entry.name}`);
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true });
      continue;
    }
    const content = extracted[entry.name];
    if (!content) throw new Error(`ZIP entry was not extracted: ${entry.name}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function fetchZip(url: string): Promise<Buffer> {
  const maxRedirects = readRenderConfig().images.remoteMaxRedirects;
  const timeoutMs = readRenderConfig().images.remoteTimeoutMs;
  let current = url;
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`ZIP URL redirect from '${current}' has no location.`);
      if (redirect === maxRedirects) throw new Error(`ZIP URL exceeded the redirect limit.`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`ZIP URL '${current}' returned HTTP ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error(`ZIP URL exceeded the redirect limit.`);
}

async function materializeZip(bytes: Buffer): Promise<{ sourceRoot: string; cacheKey: string }> {
  const cacheKey = createHash('sha256').update(bytes).digest('hex');
  const cacheRoot = join(getConfigDir(), 'source-cache');
  const sourceRoot = join(cacheRoot, `zip-${cacheKey}`);
  if (existsSync(join(sourceRoot, '.report-baby-source-complete'))) return { sourceRoot, cacheKey };
  await mkdir(cacheRoot, { recursive: true });
  const staging = await mkdtemp(join(cacheRoot, '.zip-staging-'));
  try {
    await extractZip(bytes, staging);
    await writeFile(join(staging, '.report-baby-source-complete'), `${cacheKey}\n`);
    try {
      await rename(staging, sourceRoot);
    } catch (error: any) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      await rm(staging, { recursive: true, force: true });
    }
    return { sourceRoot, cacheKey };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function materializeGit(source: Extract<BrandSourceDescriptor, { git_url: string }>): Promise<{ sourceRoot: string; cacheKey: string }> {
  const cacheRoot = join(getConfigDir(), 'source-cache');
  await mkdir(cacheRoot, { recursive: true });
  const staging = await mkdtemp(join(cacheRoot, '.git-staging-'));
  await rm(staging, { recursive: true, force: true });
  const args = ['clone', '--depth', '1'];
  if (source.ref) args.push('--branch', source.ref);
  args.push(source.git_url, staging);
  try {
    await execFileAsync('git', args, { maxBuffer: 1024 * 1024 });
    const { stdout } = await execFileAsync('git', ['-C', staging, 'rev-parse', 'HEAD'], { maxBuffer: 1024 * 1024 });
    const commit = stdout.trim();
    const cacheKey = createHash('sha256').update(JSON.stringify([source.git_url, commit])).digest('hex');
    const sourceRoot = join(cacheRoot, `git-${cacheKey}`);
    if (existsSync(join(sourceRoot, '.report-baby-source-complete'))) {
      await rm(staging, { recursive: true, force: true });
      return { sourceRoot, cacheKey };
    }
    await writeFile(join(staging, '.report-baby-source-complete'), `${cacheKey}\n`);
    try {
      await rename(staging, sourceRoot);
    } catch (error: any) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      await rm(staging, { recursive: true, force: true });
    }
    return { sourceRoot, cacheKey };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function materializeBrandSource(source: BrandSourceDescriptor | undefined, configuredBrandRoot: string): Promise<MaterializedSource> {
  if (!source) {
    const sourceRoot = resolve(configuredBrandRoot);
    return { sourceRoot, brandRoot: sourceRoot, kind: 'directory', warnings: [] };
  }
  if ('directory_path' in source) {
    const sourceRoot = resolve(source.directory_path);
    return { sourceRoot, brandRoot: sourceBrandRoot(sourceRoot, source.brand_path), kind: 'directory', warnings: [] };
  }
  const materialized = 'zip_path' in source
    ? await materializeZip(await readFile(resolve(source.zip_path)))
    : 'zip_url' in source
      ? await materializeZip(await fetchZip(source.zip_url))
      : await materializeGit(source);
  return {
    sourceRoot: materialized.sourceRoot,
    brandRoot: sourceBrandRoot(materialized.sourceRoot, source.brand_path),
    kind: 'zip_path' in source || 'zip_url' in source ? 'zip' : 'git',
    cacheKey: materialized.cacheKey,
    warnings: [],
  };
}
