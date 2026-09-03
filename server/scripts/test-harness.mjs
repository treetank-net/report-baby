#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// These are the release-facing seams. The individual scripts contain the
// assertions; this registry only decides which checks form a gate.
const suites = {
  composition: [
    ['composition engine contract', 'scripts/test-composition-engine-contract.mjs'],
    ['composition input adapter', 'scripts/test-composition-report-data-adapter.mjs'],
    ['template flow contract', 'scripts/test-template-flow-contract.mjs'],
    ['report plan contract', 'scripts/test-report-plan.mjs'],
    ['text composition engine', 'scripts/test-text-composition-engine.mjs'],
    ['page template adapter', 'scripts/test-page-template-adapter.mjs'],
    ['jsPDF adapter', 'scripts/test-js-pdf-adapter.mjs'],
    ['composition shadow', 'scripts/test-report-composition-shadow.mjs'],
    ['composition oracle', 'scripts/test-report-composition-oracle.mjs'],
    ['composition image', 'scripts/test-report-composition-image.mjs'],
    ['contrast evaluation prototype', 'scripts/test-contrast-evaluation-prototype.mjs'],
    ['editorial numbered flow', 'scripts/test-editorial-numbered-flow.mjs'],
    ['composition page limits', 'scripts/test-composition-page-limits.mjs'],
  ],
  artifacts: [
    ['public MCP behavior', 'scripts/test-public-behavior.mjs'],
    ['public CLI behavior', 'scripts/test-cli.mjs'],
    ['report images', 'scripts/test-report-images.mjs'],
    ['report chrome', 'scripts/test-report-chrome.mjs'],
    ['editorial flow', 'scripts/test-editorial-flow.mjs'],
    ['editorial parity', 'scripts/test-editorial-parity.mjs'],
    ['slide artifacts', 'scripts/test-slide-artifacts.mjs'],
    ['brand contract', 'scripts/test-brand-contract.mjs'],
  ],
  quality: [
    ['composition documentation', 'scripts/test-composition-documentation.mjs'],
    ['manifest contract', 'scripts/test-manifest-contract.mjs'],
    ['manifest consumers', 'scripts/test-showcase-manifest-consumers.mjs'],
    ['input errors', 'scripts/test-input-errors.mjs'],
    ['MCP schema', 'scripts/test-mcp-schema-snapshot.mjs'],
    ['configuration reach', 'scripts/test-config-reach.mjs'],
    ['architecture', 'scripts/architecture-check.mjs'],
    ['script duplication', 'scripts/script-dup.mjs'],
    ['fallback cache', 'scripts/test-fallback-cache.mjs'],
    ['source context', 'scripts/test-source-context.mjs'],
    ['source materialization', 'scripts/test-source-materialization.mjs'],
    ['Markdown normalizer', 'scripts/test-markdown-normalizer.mjs'],
    ['image resolver', 'scripts/test-image-resolver.mjs'],
    ['brand assets', 'scripts/test-brand-assets.mjs'],
    ['brand release template', 'scripts/test-brand-release-template.mjs'],
  ],
};

const args = process.argv.slice(2);
const selectedSuites = args.filter((arg) => arg.startsWith('--suite=')).map((arg) => arg.slice('--suite='.length));
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--suite') selectedSuites.push(args[index + 1]);
}
const shouldList = args.includes('--list');
const shouldBuild = !args.includes('--no-build') && !shouldList;

function fail(message) {
  console.error(`test harness: ${message}`);
  process.exitCode = 2;
}

if (shouldList) {
  for (const [suite, checks] of Object.entries(suites)) {
    console.log(`${suite}:`);
    for (const [label, script] of checks) console.log(`  ${label} (${script})`);
  }
} else {
  const requestedNames = selectedSuites.length > 0 ? selectedSuites : ['composition', 'artifacts'];
  const names = requestedNames.flatMap((name) => name === 'all' ? Object.keys(suites) : [name]);
  const unknown = names.filter((name) => !suites[name]);
  if (unknown.length > 0) {
    fail(`unknown suite(s): ${unknown.join(', ')}. Use --list.`);
  } else {
    const checks = [...new Map(names.flatMap((name) => suites[name]).map(([label, script]) => [script, [label, script]])).values()];
    for (const [, script] of checks) await access(join(root, script));

    async function run(label, command, commandArgs) {
      console.log(`\n[test-harness] ${label}`);
      await new Promise((resolve, reject) => {
        const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
        });
      });
    }

    try {
      if (shouldBuild) await run('build current runtime bundles', npmCommand, ['run', 'build']);
      for (const [label, script] of checks) await run(label, process.execPath, [script]);
      console.log(`\n[test-harness] PASS: ${checks.length} check(s)`);
    } catch (error) {
      console.error(`\n[test-harness] FAIL: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
