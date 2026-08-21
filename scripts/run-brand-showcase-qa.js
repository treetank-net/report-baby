#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const valueFor = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};

const out = resolve(valueFor('--out', 'examples/brand-showcase/generated'));
const brandRoot = resolve(valueFor('--brand-root', 'examples/brand-showcase/brands'));
const qaRoot = resolve(valueFor('--qa-root', '/tmp/report-baby-brand-showcase-qa'));
const formats = valueFor('--formats', 'pdf,png,pptx');

function run(script, scriptArgs) {
  const result = spawnSync(process.execPath, [script, ...scriptArgs], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('scripts/render-brand-showcase.js', ['--brand-root', brandRoot, '--out', out, '--formats', formats]);
run('scripts/audit-brand-showcase.js', [out]);
run('scripts/inspect-brand-showcase.js', ['--root', out, '--qa-root', qaRoot, '--require-pptx-render']);
