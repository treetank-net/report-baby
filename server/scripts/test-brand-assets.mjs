import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'report-baby-brand-assets-'));

async function run(command, args, env = {}) {
  return execFileAsync(command, args, { cwd: root, env: { ...process.env, ...env }, maxBuffer: 1024 * 1024 });
}

try {
  const sourceRoot = join(temp, 'brands');
  await cp(join(root, '..', 'examples', 'brand-showcase', 'brands', 'flux'), join(sourceRoot, 'flux'), { recursive: true });
  const store = join(temp, 'store');
  await run(process.execPath, [
    'brand-tool-bundle.cjs', 'publish',
    '--brand-root', sourceRoot,
    '--brand', 'brand://flux/primary',
    '--store', store,
    '--release', '0.9.3-test',
  ]);
  const validation = await run(process.execPath, [
    'brand-tool-bundle.cjs', 'validate',
    '--brand-root', sourceRoot,
    '--brand', 'brand://flux/primary',
  ]);
  assert.match(validation.stdout, /publish prepares a .*report_header_band derivative/, 'validate does not warn about an oversized raster asset');

  const releaseRoot = join(store, 'flux', 'releases', '0.9.3-test');
  const manifest = JSON.parse(await readFile(join(releaseRoot, 'manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.prepared_assets), 'publish manifest does not record prepared raster assets');
  const hero = manifest.prepared_assets.find((entry) => entry.source?.path === 'assets/backgrounds/hero.png');
  assert.ok(hero, 'publish manifest does not describe the hero raster asset');
  assert.equal(hero.kind, 'prepared-assets');
  const header = hero.derivatives.find((entry) => entry.role === 'report_header_band');
  assert.deepEqual(header?.px, [640, 154], 'report header derivative has no bounded target dimensions');
  assert.ok(header?.path && header.bytes < hero.source.bytes / 5, 'report header derivative was not materially reduced');
  await readFile(join(releaseRoot, 'brand', header.path));

  const preparedOutput = join(temp, 'prepared.pdf');
  await run(process.execPath, ['cli-bundle.cjs', '--json', 'render_report', JSON.stringify({
    template: 'default-report',
    brand_ref: 'brand://flux/primary',
    output_path: preparedOutput,
    data: { title: 'Prepared asset', sections: [{ heading: 'Works', body: 'The prepared asset renders.' }] },
  })], { REPORT_BABY_DATA: temp, REPORT_BABY_BRAND_DIR: store });
  await readFile(preparedOutput);
  assert.ok((await stat(preparedOutput)).size < 300 * 1024, 'prepared report PDF is still larger than 300 KB');
  try {
    const images = await run('pdfimages', ['-list', preparedOutput]);
    assert.match(images.stdout, /\b640\s+154\b/, 'prepared PDF does not embed the bounded report header derivative');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('SKIP: pdfimages not available; prepared asset dimensions were verified in the publish manifest.');
  }

  const fallbackOutput = join(temp, 'fallback.pdf');
  const fallback = await run(process.execPath, ['cli-bundle.cjs', '--json', 'render_report', JSON.stringify({
    template: 'default-report',
    brand_ref: 'brand://flux/primary',
    output_path: fallbackOutput,
    data: { title: 'Unpublished fallback', sections: [{ heading: 'Works', body: 'The fallback still renders.' }] },
  })], {
    REPORT_BABY_DATA: temp,
    REPORT_BABY_BRAND_DIR: join(root, '..', 'examples', 'brand-showcase', 'brands'),
  });
  const fallbackSummary = JSON.parse(fallback.stdout);
  assert.match(JSON.stringify(fallbackSummary), /prepared.*derivative|slower fallback/i, 'unpublished raster fallback did not report its slow path');
  await readFile(fallbackOutput);
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('brand assets: publish derivatives and fallback diagnostics contract OK');
