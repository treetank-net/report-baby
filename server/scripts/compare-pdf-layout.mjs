#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { comparePdfLayouts, formatPdfLayoutDiff, readPdfLayout } from './lib/pdf-layout-diff.mjs';

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function usage() {
  console.log(`Usage: node scripts/compare-pdf-layout.mjs --expected old.pdf --actual new.pdf [options]

Options:
  --out report.txt       write the human-readable report to a file
  --json report.json     write the machine-readable report to a file
  --fail-on-errors       exit 1 when text is missing, pages differ, or severe findings exist
  --config path.yml      render configuration (default: templates/render-config.yml)
`);
}

const expectedPath = option('expected');
const actualPath = option('actual');
if (flag('help') || !expectedPath || !actualPath) {
  usage();
  process.exitCode = expectedPath && actualPath ? 0 : 2;
} else {
  const configPath = resolve(option('config', 'templates/render-config.yml'));
  const config = parse(await readFile(configPath, 'utf8'));
  const settings = config.quality?.layout_diff ?? {};
  const report = comparePdfLayouts(readPdfLayout(expectedPath), readPdfLayout(actualPath), {
    ...settings,
    pointsPerInch: config.canvas?.points_per_inch ?? 72,
  });
  const formatted = formatPdfLayoutDiff(report, { expected: expectedPath, actual: actualPath });
  console.log(formatted);
  if (option('out')) await writeFile(resolve(option('out')), formatted);
  if (option('json')) await writeFile(resolve(option('json')), `${JSON.stringify({ ...report, expected: expectedPath, actual: actualPath }, null, 2)}\n`);
  if (flag('fail-on-errors') && report.hasErrors) process.exitCode = 1;
}
