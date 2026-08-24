import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-image-resolver-'));
const output = join(temporary, 'image-resolver.cjs');
const contentRoot = join(root, '..', 'examples/brand-showcase/brands/flux');

try {
  await build({ entryPoints: [join(root, 'src/image-resolver.ts')], bundle: true, platform: 'node', target: 'node18', format: 'cjs', loader: { '.ttf': 'binary', '.wasm': 'binary' }, outfile: output });
  const bundled = await import(output);
  const resolver = bundled.resolveImageAsset ?? bundled.default.resolveImageAsset;
  const sourceModule = await build({ entryPoints: [join(root, 'src/source-context.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: join(temporary, 'source-context.cjs'), write: false });
  const sourceOutput = join(temporary, 'source-context.cjs');
  await writeFile(sourceOutput, sourceModule.outputFiles[0].contents);
  const sourceBundled = await import(sourceOutput);
  const contextFactory = sourceBundled.createSourceContext ?? sourceBundled.default.createSourceContext;
  const context = contextFactory({ contentRoot, sourceRoot: contentRoot, brandRoot: contentRoot });
  const asset = await resolver('assets/backgrounds/hero.png', context);
  assert.equal(asset.format, 'PNG');
  assert.ok(asset.width > 0 && asset.height > 0);
  await assert.rejects(() => resolver('../outside.png', context), /escapes|not found/);
  console.log('image resolver: local PNG validation and root confinement passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
