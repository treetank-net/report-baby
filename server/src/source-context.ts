import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { BrandSourceDescriptor, ContentReference, SourceNamespace } from './source-contract.js';
import { parseContentReference, sourceDescriptorKind } from './source-contract.js';

export interface SourceContextOptions {
  contentRoot: string;
  sourceRoot: string;
  brandRoot: string;
}

export interface SourceContext {
  readonly contentRoot: string;
  readonly sourceRoot: string;
  readonly brandRoot: string;
  resolvePath(reference: string): string;
  parse(reference: string): ContentReference;
}

export interface RequestSourceContextOptions {
  configuredBrandRoot: string;
  contentRoot?: string;
  brandSource?: BrandSourceDescriptor;
}

function isInside(root: string, candidate: string): boolean {
  const rootRelative = relative(root, candidate);
  return rootRelative === '' || (!rootRelative.startsWith('..') && !isAbsolute(rootRelative));
}

function rootFor(namespace: SourceNamespace, context: SourceContextOptions): string {
  if (namespace === 'root') return context.contentRoot;
  if (namespace === 'brand') return context.brandRoot;
  return context.sourceRoot;
}

export function createSourceContext(options: SourceContextOptions): SourceContext {
  const roots = {
    contentRoot: resolve(options.contentRoot),
    sourceRoot: resolve(options.sourceRoot),
    brandRoot: resolve(options.brandRoot),
  };
  return {
    ...roots,
    parse: parseContentReference,
    resolvePath(reference: string): string {
      const parsed = parseContentReference(reference);
      if (parsed.kind === 'remote') throw new Error(`Remote content reference cannot be resolved as a local path: ${reference}`);
      const root = rootFor(parsed.namespace, roots);
      const candidate = resolve(root, parsed.path);
      if (!isInside(root, candidate)) throw new Error(`Content reference '${reference}' escapes its ${parsed.namespace} root.`);
      return candidate;
    },
  };
}

export function createRequestSourceContext(options: RequestSourceContextOptions): SourceContext {
  const sourceRoot = options.brandSource ? sourceRootForDescriptor(options.brandSource) : resolve(options.configuredBrandRoot);
  const requestedBrandPath = options.brandSource?.brand_path ?? '.';
  const brandRoot = resolve(sourceRoot, requestedBrandPath);
  if (!isInside(sourceRoot, brandRoot)) throw new Error(`brand_path escapes the materialized source root: ${requestedBrandPath}`);
  return createSourceContext({
    contentRoot: options.contentRoot ?? sourceRoot,
    sourceRoot,
    brandRoot,
  });
}

export function sourceRootForDescriptor(source: BrandSourceDescriptor): string {
  if ('directory_path' in source) return resolve(source.directory_path);
  throw new Error(`Source transport '${sourceDescriptorKind(source)}' is not materialized yet.`);
}

export function assertSourceRootExists(context: SourceContext): void {
  if (!existsSync(context.sourceRoot)) throw new Error(`Materialized source root does not exist: ${context.sourceRoot}`);
  if (!existsSync(context.brandRoot)) throw new Error(`Selected brand root does not exist: ${context.brandRoot}`);
}
