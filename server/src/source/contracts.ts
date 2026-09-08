export type BrandSourceDescriptor =
  | { directory_path: string; brand_path?: string }
  | { zip_path: string; brand_path?: string }
  | { zip_url: string; brand_path?: string }
  | { git_url: string; brand_path?: string; ref?: string };

export type SourceNamespace = 'root' | 'brand' | 'source';

export interface PathReference {
  kind: 'path';
  namespace: SourceNamespace;
  path: string;
}

export interface RemoteReference {
  kind: 'remote';
  url: string;
}

export type ContentReference = PathReference | RemoteReference;

const NAMESPACES: SourceNamespace[] = ['root', 'brand', 'source'];

export function parseContentReference(value: string): ContentReference {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Content reference must not be empty.');

  if (/^https?:\/\//i.test(trimmed)) return { kind: 'remote', url: trimmed };

  const namespace = NAMESPACES.find((candidate) => trimmed.toLowerCase().startsWith(`${candidate}://`));
  if (namespace) {
    const path = trimmed.slice(namespace.length + 3).replaceAll('\\', '/');
    if (!path || path.startsWith('/')) throw new Error(`Content reference '${value}' has an empty or absolute ${namespace} path.`);
    return { kind: 'path', namespace, path };
  }

  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) throw new Error(`Absolute content paths are not allowed: ${value}`);
  return { kind: 'path', namespace: 'root', path: trimmed.replaceAll('\\', '/') };
}

export function sourceDescriptorKind(source: BrandSourceDescriptor): 'directory' | 'zip' | 'git' {
  if ('directory_path' in source) return 'directory';
  if ('zip_path' in source || 'zip_url' in source) return 'zip';
  return 'git';
}
