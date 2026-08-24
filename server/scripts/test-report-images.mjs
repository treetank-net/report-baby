import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { zipSync } from 'fflate';
import { parse } from 'yaml';
import { childProcessFailure } from './lib/process.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-report-images-'));
const contentRoot = join(temporary, 'content');
const output = join(temporary, 'report.pdf');

function runCli(input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: temporary, REPORT_BABY_BRAND_DIR: join(temporary, 'brands') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(childProcessFailure('report-image CLI', { status: code, signal, stdout, stderr }))));
    child.stdin.end(JSON.stringify([{ tool: 'render_report', args: input }]));
  });
}

try {
  await cp(join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'), join(contentRoot, 'assets/map.png'), { recursive: true });
  const result = await runCli({
    content_root: contentRoot,
    output_path: output,
    diagnostics: 'full',
    data: {
      title: 'Image report',
      sections: [{ heading: 'Map', body: 'A short introduction.\n\n![Map of the fleet](assets/map.png "Fleet map")' }],
    },
  });
  const structured = JSON.parse(result.stdout.trim().split('\n')[0]);
  assert.equal(structured.path, output);
  assert.ok((await readFile(output)).length > 0);
  assert.equal(structured.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.equal(structured.warnings, undefined);
  const introOutput = join(temporary, 'intro-image-report.pdf');
  const introResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: introOutput,
    diagnostics: 'full',
    data: {
      title: 'Intro image report',
      intro: '![Intro image](root://assets/map.png "Intro caption")\n\nThe lead remains selectable text below the image.',
      sections: [{ heading: 'Editorial body', body: 'The editorial body follows the Markdown-enabled intro block.' }],
    },
  });
  const introContent = JSON.parse(introResult.stdout.trim().split('\n')[0]);
  const introImage = introContent.drawings.find((drawing) => drawing.kind === 'image');
  const introCaption = introContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text === 'Intro caption');
  const introLead = introContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text.includes('lead remains selectable'));
  const editorialTemplate = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const expectedImageTop = editorialTemplate.page.height * editorialTemplate.page.reserved_bands.header.height;
  assert.equal(introContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.ok(introImage && introImage.y < 110, JSON.stringify(introContent.drawings));
  assert.ok(introImage && Math.abs(introImage.y - expectedImageTop) < 0.01, JSON.stringify({ introImage, expectedImageTop }));
  assert.ok(introCaption && introCaption.x > introImage.x, JSON.stringify(introContent.drawings));
  assert.ok(introCaption && introCaption.y > introImage.y + introImage.height, JSON.stringify(introContent.drawings));
  const controlOutput = join(temporary, 'intro-control-report.pdf');
  const controlResult = await runCli({
    template: 'pages/editorial-two-column',
    content_root: contentRoot,
    output_path: controlOutput,
    diagnostics: 'full',
    data: {
      title: 'Intro control report',
      intro: 'The lead remains selectable text below the image.',
      sections: [{ heading: 'Editorial body', body: 'The editorial body follows the Markdown-enabled intro block.' }],
    },
  });
  const controlContent = JSON.parse(controlResult.stdout.trim().split('\n')[0]);
  const controlLead = controlContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text.includes('lead remains selectable'));
  assert.ok(introLead && controlLead && Math.abs(introLead.width - controlLead.width) < 0.01, JSON.stringify({ introLead, controlLead }));
  const structuredOutput = join(temporary, 'structured-report.pdf');
  const structuredResult = await runCli({
    content_root: contentRoot,
    output_path: structuredOutput,
    diagnostics: 'full',
    data: {
      title: 'Structured image report',
      sections: [{ heading: 'Map', content: [{ type: 'image', src: 'assets/map.png', alt: 'Map', caption: 'Structured caption', width: '80%', fit: 'contain' }] }],
    },
  });
  const structuredContent = JSON.parse(structuredResult.stdout.trim().split('\n')[0]);
  assert.equal(structuredContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1, JSON.stringify(structuredContent));
  const archivePath = join(temporary, 'brand-source.zip');
  const hero = await readFile(join(root, '..', 'examples/brand-showcase/brands/flux/assets/backgrounds/hero.png'));
  await writeFile(archivePath, Buffer.from(zipSync({
    'brands/zip/_brand.yml': Buffer.from('schema_version: 1\nmeta:\n  name: ZIP\nlayout:\n  report_image_caption:\n    align: left\n    color: primary\n    padding_x: 4\n'),
    'brands/zip/profiles/primary.yml': Buffer.from('schema_version: 1\n'),
    'brands/zip/assets/map.png': hero,
  })));
  const zipOutput = join(temporary, 'zip-report.pdf');
  const zipResult = await runCli({
    brand_ref: 'brand://zip/profiles/primary',
    brand_source: { zip_path: archivePath, brand_path: 'brands' },
    output_path: zipOutput,
    diagnostics: 'full',
    data: { title: 'ZIP image report', sections: [{ heading: 'Map', body: '![ZIP map](brand://zip/assets/map.png "ZIP caption")' }] },
  });
  const zipContent = JSON.parse(zipResult.stdout.trim().split('\n')[0]);
  const zipImage = zipContent.drawings.find((drawing) => drawing.kind === 'image');
  const zipCaption = zipContent.drawings.find((drawing) => drawing.kind === 'text' && drawing.text === 'ZIP caption');
  assert.equal(zipContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  assert.ok(zipImage && zipCaption && Math.abs(zipCaption.x - (zipImage.x + 4)) < 0.01, JSON.stringify(zipContent.drawings));
  console.log('report images: Markdown image rendered with caption and diagnostics passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
