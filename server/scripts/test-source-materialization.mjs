import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-source-materialization-'));
const modulePath = join(temporary, 'source-materialization.cjs');
const sourceData = join(temporary, 'data');
process.env.REPORT_BABY_DATA = sourceData;

try {
  await build({ entryPoints: [join(root, 'src/source-materialization.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: modulePath });
  const bundled = await import(modulePath);
  const materializeBrandSource = bundled.materializeBrandSource ?? bundled.default.materializeBrandSource;
  const archive = Buffer.from(zipSync({
    'brands/flux/_brand.yml': Buffer.from('schema_version: 1\nmeta:\n  name: Flux\n'),
    'brands/flux/assets/map.png': Buffer.from('png-placeholder'),
  }));
  const zipPath = join(temporary, 'brand.zip');
  await writeFile(zipPath, archive);
  const materialized = await materializeBrandSource({ zip_path: zipPath, brand_path: 'brands/flux' }, join(temporary, 'configured'));
  assert.equal(await readFile(join(materialized.brandRoot, '_brand.yml'), 'utf8'), 'schema_version: 1\nmeta:\n  name: Flux\n');
  const repeated = await materializeBrandSource({ zip_path: zipPath, brand_path: 'brands/flux' }, join(temporary, 'configured'));
  assert.equal(repeated.sourceRoot, materialized.sourceRoot);
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => materializeBrandSource({ zip_path: zipPath, brand_path: 'brands/flux' }, join(temporary, 'configured'))));
  assert.equal(new Set(concurrent.map((item) => item.sourceRoot)).size, 1);

  const traversalPath = join(temporary, 'traversal.zip');
  await writeFile(traversalPath, Buffer.from(zipSync({ '../escape.txt': Buffer.from('blocked') })));
  await assert.rejects(() => materializeBrandSource({ zip_path: traversalPath }, join(temporary, 'configured')), /unsafe path|escapes/);

  const nestedPath = join(temporary, 'nested.zip');
  await writeFile(nestedPath, Buffer.from(zipSync({ 'nested.zip': Buffer.from('blocked') })));
  await assert.rejects(() => materializeBrandSource({ zip_path: nestedPath }, join(temporary, 'configured')), /nested archive entries/i);
  console.log('source materialization: ZIP extraction, cache reuse, traversal and nested archive checks passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
