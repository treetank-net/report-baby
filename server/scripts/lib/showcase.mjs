import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * @test-decision merge-showcase-manifest
 * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
 */
export async function findManifestPaths(root) {
  const manifests = [];
  /**
   * @test-decision merge-showcase-manifest
   * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
   */
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

/**
 * @test-decision merge-showcase-manifest
 * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
 */
export async function forEachManifest(manifests, callback) {
  for (const manifest of manifests) await callback(manifest);
}

/**
 * @test-decision merge-showcase-manifest
 * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
 */
export async function mapManifests(manifests, callback) {
  const values = [];
  await forEachManifest(manifests, async (manifest) => values.push(await callback(manifest)));
  return values;
}

/**
 * @test-decision merge-showcase-manifest
 * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
 */
export function recordFailure(failures, path, message) {
  failures.push(`${path}: ${message}`);
}

/**
 * @test-decision merge-showcase-manifest
 * @test-action Keep one manifest traversal and callback seam; merge consumers through this iterator instead of rescanning the tree.
 */
export function manifestOutputPath(manifestPath, value) {
  return typeof value === 'string' && !value.startsWith('/') ? join(dirname(manifestPath), value) : value;
}
