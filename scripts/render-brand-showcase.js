#!/usr/bin/env node
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const brandRoot = resolve(valueFor('--brand-root', 'examples/brand-showcase/brands'));
const out = resolve(valueFor('--out', '/tmp/report-baby-brand-showcase'));
const formats = valueFor('--formats', 'pdf,png,pptx');
const staging = join(out, `.staging-${process.pid}`);
const brands = (await readdir(brandRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
  .filter((entry) => existsSync(join(brandRoot, entry.name, '_brand.yml')))
  .map((entry) => entry.name)
  .sort();

if (brands.length === 0) {
  console.error(`No brand directories found in ${brandRoot}`);
  process.exit(1);
}

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const brand of brands) {
  const stagedBrand = join(staging, brand);
  const result = spawnSync(process.execPath, [
    'scripts/render-example.js',
    '--kind', 'showcase',
    '--brand-root', brandRoot,
    '--brand', `brand://${brand}/primary`,
    '--out', stagedBrand,
    '--formats', formats,
  ], { stdio: 'inherit' });
  if (result.status !== 0) {
    await rm(staging, { recursive: true, force: true });
    process.exit(result.status ?? 1);
  }
  await rm(join(out, brand), { recursive: true, force: true });
  await rename(stagedBrand, join(out, brand));
}
await rm(staging, { recursive: true, force: true });

console.log(`Rendered ${brands.length} brand showcase(s) to ${out}`);
