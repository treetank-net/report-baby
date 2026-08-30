#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { inspectColumnBalance, inspectPdfSpacing, readPdfLayout } from './lib/pdf-layout-diff.mjs';

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function usage() {
  console.log(`Usage: node scripts/inspect-pdf-layout.mjs --pdf report.pdf [options]

Options:
  --config path.yml  render configuration (default: templates/render-config.yml)
  --json path.json   write machine-readable output
`);
}

const pdfPath = option('pdf');
if (!pdfPath || process.argv.includes('--help')) {
  usage();
  process.exitCode = pdfPath ? 0 : 2;
} else {
  const configPath = resolve(option('config', 'templates/render-config.yml'));
  const config = parse(await readFile(configPath, 'utf8'));
  const settings = config.quality?.layout_diff ?? {};
  const layout = readPdfLayout(pdfPath);
  const report = { pdf: pdfPath, pages: inspectColumnBalance(layout, settings), spacing: inspectPdfSpacing(layout, { ...settings, pointsPerInch: config.canvas?.points_per_inch }) };
  for (const page of report.pages) {
    const summary = page.columns.map((column) => `${column.lineCount} lines/${Math.round(column.inkProxy)} ink`).join(' | ');
    console.log(`page ${page.page}: ${summary}; line-balance ${page.lineBalance}; ink-balance ${page.inkBalance}${page.warnings.length ? ` [warn: ${page.warnings.join(', ')}]` : ' [ok]'}`);
  }
  for (const finding of report.spacing) {
    const label = finding.kind === 'page-edge' ? 'page edge' : 'content';
    console.log(`spacing [${finding.severity}/${label}] p${finding.page}: ${finding.gapMm.toFixed(1)}mm after "${finding.after.slice(0, 48)}" before "${finding.before.slice(0, 48)}"`);
  }
  if (option('json')) await import('node:fs/promises').then(({ writeFile }) => writeFile(resolve(option('json')), `${JSON.stringify(report, null, 2)}\n`));
}
