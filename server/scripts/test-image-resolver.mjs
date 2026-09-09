import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { runProcess } from './lib/process.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-image-resolver-'));
const bundleDirectory = join(temporary, 'bundles');
const output = join(bundleDirectory, 'image-resolver.cjs');
const rasterOutput = join(bundleDirectory, 'image-raster.cjs');
const compositionOutput = join(bundleDirectory, 'composition.cjs');
const sourceOutput = join(bundleDirectory, 'source-context.cjs');
const contentRoot = join(root, '..', 'examples/brand-showcase/brands/flux');
const webpFixture = join(temporary, 'fixture.webp');
const avifFixture = join(temporary, 'fixture.avif');

try {
  await build({
    entryPoints: [
      { in: join(root, 'src/rendering/image-resolver.ts'), out: 'image-resolver' },
      { in: join(root, 'src/rendering/image-raster.ts'), out: 'image-raster' },
      { in: join(root, 'src/composition/index.ts'), out: 'composition' },
      { in: join(root, 'src/source/context.ts'), out: 'source-context' },
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    loader: { '.ttf': 'binary', '.wasm': 'binary' },
    outdir: bundleDirectory,
    outExtension: { '.js': '.cjs' },
  });
  const bundled = await import(output);
  const rasterBundled = await import(rasterOutput);
  const composition = await import(compositionOutput);
  const resolver = bundled.resolveImageAsset ?? bundled.default.resolveImageAsset;
  const decodePngDataUri = rasterBundled.decodePngDataUri ?? rasterBundled.default.decodePngDataUri;
  const createCompositionContrastProvider = composition.createCompositionContrastProvider ?? composition.default.createCompositionContrastProvider;
  const sourceBundled = await import(sourceOutput);
  const contextFactory = sourceBundled.createSourceContext ?? sourceBundled.default.createSourceContext;
  const context = contextFactory({ contentRoot, sourceRoot: contentRoot, brandRoot: contentRoot });
  const asset = await resolver('assets/backgrounds/hero.png', context);
  assert.equal(asset.format, 'PNG');
  assert.ok(asset.width > 0 && asset.height > 0);
  const raster = decodePngDataUri(asset.data);
  assert.ok(raster, 'resolved PNG must be decodable once for composition screening');
  assert.equal(raster.width, asset.width);
  assert.equal(raster.height, asset.height);
  assert.equal(raster.pixels.length, raster.width * raster.height * raster.channels);
  const provider = createCompositionContrastProvider({
    rasterImages: new Map([['hero', raster]]),
    foreground: [0, 0, 0],
    sampleCount: 6,
  });
  const findings = provider.assess({
    lines: [{ blockId: 'body', flowId: 'main', slotId: 'text', page: 1, text: 'body', box: { x: 20, y: 20, width: 150, height: 10 }, naturalWidth: 150, startWord: 0, endWord: 1 }],
    insertionLines: [],
    graphicPlacements: [{ id: 'graphic:hero', graphicId: 'hero', assetId: 'hero', slotId: 'graphic', page: 1, shape: 'rectangle', wrap: 'none', box: { x: 0, y: 0, width: 200, height: 100 } }],
  });
  assert.equal(findings.length, 1);
  assert.notEqual(findings[0].status, 'unknown', 'a resolved real PNG must produce a contrast result');
  assert.ok((findings[0].minimumRatio ?? 0) > 0);
  const fixtureContext = contextFactory({ contentRoot: temporary, sourceRoot: temporary, brandRoot: temporary });
  const webpBuild = runProcess('ffmpeg', ['-v', 'error', '-i', join(contentRoot, 'assets/backgrounds/hero.png'), '-frames:v', '1', webpFixture]);
  if (webpBuild.status !== 0) throw new Error(`unable to create WebP fixture: ${webpBuild.stderr || webpBuild.stdout}`);
  const avifBuild = runProcess('ffmpeg', ['-v', 'error', '-i', join(contentRoot, 'assets/backgrounds/hero.png'), '-frames:v', '1', avifFixture]);
  if (avifBuild.status !== 0) throw new Error(`unable to create AVIF fixture: ${avifBuild.stderr || avifBuild.stdout}`);
  const webp = await resolver('fixture.webp', fixtureContext);
  const avif = await resolver('fixture.avif', fixtureContext);
  for (const [format, converted] of [['WebP', webp], ['AVIF', avif]]) {
    assert.equal(converted.format, 'PNG', `${format} must be normalized to the renderer-neutral PNG raster contract`);
    assert.equal(converted.width, asset.width);
    assert.equal(converted.height, asset.height);
    const convertedRaster = decodePngDataUri(converted.data);
    assert.ok(convertedRaster, `${format} output must be decodable for contrast screening`);
  }
  await assert.rejects(() => resolver('../outside.png', context), /escapes|not found/);
  console.log('image resolver: local PNG/WebP/AVIF validation, raster normalization and root confinement passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
