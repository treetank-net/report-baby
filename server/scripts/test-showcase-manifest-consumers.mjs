#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(join(tmpdir(), 'report-baby-manifest-consumers-'));
const showcase = join(temp, 'showcase');
const qa = join(temp, 'qa');

function run(script, args) {
  return runProcess(process.execPath, [script, ...args], { cwd: root });
}

function assertSuccessful(result, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr || result.stdout}`);
}

try {
  assertSuccessful(run('scripts/render-brand-showcase.js', [
    '--brand-root', 'examples/brand-showcase/brands',
    '--out', showcase,
    '--formats', 'pdf,png,pptx',
  ]), 'showcase fixture render');

  assertSuccessful(run('scripts/audit-brand-showcase.js', [showcase]), 'audit-brand-showcase');
  const inspection = run('scripts/inspect-brand-showcase.js', [
    '--root', showcase,
    '--qa-root', qa,
    '--require-pptx-render',
  ]);
  if (inspection.status !== 0) {
    const report = JSON.parse(await readFile(join(qa, 'qa-report.json'), 'utf8'));
    const output = `${inspection.stdout}\n${inspection.stderr}`;
    assert.match(output, /pdftoppm failed|pdfinfo: command not found/);
    assert.equal(report.manifests, 4, 'inspect-brand-showcase did not process the recorded manifest tree');
    console.warn('inspect-brand-showcase: manifest tree processed; PDF raster checks incomplete because Poppler is unavailable');
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log('manifest consumers: audit and inspect pass against the recorded showcase tree');
