import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function findManifestPaths(root) {
  const manifests = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name === 'manifest.json') manifests.push(path);
    }
  }
  await visit(root);
  return manifests.sort();
}

export function manifestOutputPath(manifestPath, value) {
  return typeof value === 'string' && !value.startsWith('/') ? join(dirname(manifestPath), value) : value;
}
