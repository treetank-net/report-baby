import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-cli-'));
const env = { ...process.env, REPORT_BABY_DATA: outputDir };

function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

try {
  const listed = await run(['--list']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /render_report/);
  assert.match(listed.stdout, /render_slides_pptx/);
  assert.match(listed.stdout, /inspect_brand/);

  const outputPath = join(outputDir, 'cli-report.pdf');
  const rendered = await run(['render_report'], JSON.stringify({
    template: 'default-report',
    output_path: outputPath,
    data: { title: 'CLI contract', sections: [{ heading: 'Works', body: 'The one-shot adapter rendered this report.' }] },
  }));
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.equal(rendered.stdout.trim(), outputPath);
  assert.equal((await readFile(outputPath)).subarray(0, 5).toString(), '%PDF-');

  const brandedPath = join(outputDir, 'branded-report.pdf');
  const branded = await run([
    '--brand-url', join(root, '..'),
    '--brand-path', 'examples/brand-showcase/brands',
    'render_report',
  ], JSON.stringify({
    template: 'default-report',
    brand_ref: 'brand://flux/primary',
    output_path: brandedPath,
    data: { title: 'Fetched brand', sections: [{ heading: 'Works', body: 'The cached sparse checkout resolved the brand.' }] },
  }));
  assert.equal(branded.code, 0, branded.stderr);
  assert.equal(branded.stdout.trim(), brandedPath);
  assert.equal((await readFile(brandedPath)).subarray(0, 5).toString(), '%PDF-');
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log('CLI contract: all-tools listing and report render OK');
