import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { zipSync } from 'fflate';

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
    child.on('close', (code, signal) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${stderr || stdout || `CLI exited with code=${code} signal=${signal}`}\nstdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`)));
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
  await writeFile(archivePath, Buffer.from(zipSync({ '_brand.yml': Buffer.from('schema_version: 1\nmeta:\n  name: ZIP\n'), 'assets/map.png': hero })));
  const zipOutput = join(temporary, 'zip-report.pdf');
  const zipResult = await runCli({
    brand_source: { zip_path: archivePath },
    output_path: zipOutput,
    diagnostics: 'full',
    data: { title: 'ZIP image report', sections: [{ heading: 'Map', body: '![ZIP map](brand://assets/map.png)' }] },
  });
  const zipContent = JSON.parse(zipResult.stdout.trim().split('\n')[0]);
  assert.equal(zipContent.drawings.filter((drawing) => drawing.kind === 'image').length, 1);
  console.log('report images: Markdown image rendered with caption and diagnostics passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
