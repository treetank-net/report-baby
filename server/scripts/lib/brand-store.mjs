import { join } from 'node:path';
import { runProcess } from './process.mjs';

const BRANDS = ['flux', 'orbit', 'parcelia', 'pyrus'];

export function prepareDemoBrandStore(repoRoot, store, release = 'test') {
  const brandRoot = join(repoRoot, 'examples', 'brand-showcase', 'brands');
  const bundle = join(repoRoot, 'server', 'brand-tool-bundle.cjs');
  for (const brand of BRANDS) {
    const result = runProcess(process.execPath, [
      bundle,
      'publish',
      '--brand-root', brandRoot,
      '--brand', `brand://${brand}/primary`,
      '--store', store,
      '--release', release,
    ], { cwd: repoRoot, timeout: 120_000 });
    if (result.status !== 0) throw new Error(`could not prepare demo brand ${brand}: ${result.stderr || result.stdout || result.error?.message || `exit ${result.status}`}`);
  }
  return store;
}
