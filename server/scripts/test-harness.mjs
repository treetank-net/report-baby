#!/usr/bin/env node

import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const renderConfig = parse(await readFile(join(root, 'templates', 'render-config.yml'), 'utf8'));
const feedbackConfig = renderConfig.quality?.test_feedback ?? {};

// These are the release-facing seams. The individual scripts contain the
// assertions; this registry only decides which checks form a gate.
const suites = {
  smoke: [
    ['composition engine contract', 'scripts/test-composition-engine-contract.mjs'],
    ['template flow contract', 'scripts/test-template-flow-contract.mjs'],
    ['structure scoring', 'scripts/test-structure-scoring.mjs'],
  ],
  composition: [
    ['composition engine contract', 'scripts/test-composition-engine-contract.mjs'],
    ['composition input adapter', 'scripts/test-composition-report-data-adapter.mjs'],
    ['template flow contract', 'scripts/test-template-flow-contract.mjs'],
    ['report plan contract', 'scripts/test-report-plan.mjs'],
    ['text composition engine', 'scripts/test-text-composition-engine.mjs'],
    ['generic soft insertions', 'scripts/test-generic-soft-insertions.mjs'],
    ['dynamic insertion slots', 'scripts/test-dynamic-insertion-slots.mjs'],
    ['page template adapter', 'scripts/test-page-template-adapter.mjs'],
    ['jsPDF adapter', 'scripts/test-js-pdf-adapter.mjs'],
    ['composition adapter', 'scripts/test-report-composition-adapter.mjs'],
    ['composition oracle', 'scripts/test-report-composition-oracle.mjs'],
    ['composition image', 'scripts/test-report-composition-image.mjs'],
    ['contrast evaluation prototype', 'scripts/test-contrast-evaluation-prototype.mjs'],
    ['editorial numbered flow', 'scripts/test-editorial-numbered-flow.mjs'],
    ['composition page limits', 'scripts/test-composition-page-limits.mjs'],
    ['structure scoring', 'scripts/test-structure-scoring.mjs'],
  ],
  artifacts: [
    ['public MCP behavior', 'scripts/test-public-behavior.mjs'],
    ['dynamic insertion public contract', 'scripts/test-dynamic-insertion-public.mjs'],
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
const timingsArgumentIndex = args.indexOf('--timings');
const timingsArgument = timingsArgumentIndex >= 0 ? args[timingsArgumentIndex + 1] : undefined;
const hasInvalidTimingsArgument = timingsArgumentIndex >= 0
  && (!timingsArgument || timingsArgument.startsWith('--'));
const timingsPathValue = timingsArgument ?? process.env.TEST_TIMINGS_PATH;
const timingsPath = timingsPathValue ? resolve(root, timingsPathValue) : undefined;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--suite') selectedSuites.push(args[index + 1]);
}
const shouldList = args.includes('--list');
const shouldBuild = !args.includes('--no-build') && !shouldList;

let timingWriteFailure;
async function writeTimingEvent(event) {
  if (!timingsPath || timingWriteFailure) return;
  try {
    await appendFile(timingsPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
  } catch (error) {
    timingWriteFailure = error;
    console.error(`test harness: unable to append timing report ${timingsPath}: ${error.message}`);
  }
}

function fail(message) {
  console.error(`test harness: ${message}`);
  process.exitCode = 2;
}

if (hasInvalidTimingsArgument) {
  fail('--timings requires a report path.');
} else if (shouldList) {
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
    const checks = [];
    const seenScripts = new Set();
    const checkOwner = new Map();
    for (const suite of names) {
      for (const [label, script] of suites[suite]) {
        if (seenScripts.has(script)) continue;
        seenScripts.add(script);
        checkOwner.set(script, suite);
        checks.push([label, script, suite]);
      }
    }
    for (const [, script] of checks) await access(join(root, script));

    const suiteStartedAt = performance.now();
    const timingChecks = [];
    function timingSuiteTotals() {
      const timingSuiteNames = shouldBuild ? ['build', ...names] : names;
      return Object.fromEntries(timingSuiteNames.map((name) => {
        const suiteChecks = timingChecks.filter((check) => check.suite === name);
        const total = {
          elapsedMs: suiteChecks.reduce((elapsed, check) => elapsed + check.elapsedMs, 0),
          checks: suiteChecks.length,
        };
        if (name !== 'build') {
          total.skippedDuplicateChecks = suites[name].filter(([, script]) => checkOwner.get(script) !== name).length;
        }
        return [name, total];
      }));
    }
    if (timingsPath) {
      try {
        await mkdir(dirname(timingsPath), { recursive: true });
        await writeFile(timingsPath, '');
        await writeTimingEvent({
          event: 'run-start',
          pid: process.pid,
          requestedSuites: selectedSuites,
          resolvedSuites: names,
          checkCount: checks.length,
          build: shouldBuild,
        });
      } catch (error) {
        timingWriteFailure = error;
        console.error(`test harness: unable to initialize timing report ${timingsPath}: ${error.message}`);
      }
    }
    async function run(label, command, commandArgs, suite = 'build') {
      console.log(`\n[test-harness] ${label}`);
      const startedAt = performance.now();
      const startedAtIso = new Date().toISOString();
      await writeTimingEvent({ event: 'check-start', label, script: commandArgs.at(-1), suite, startedAt: startedAtIso });
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit' });
          child.on('error', reject);
          child.on('close', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
          });
        });
      } catch (error) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        timingChecks.push({ label, suite, elapsedMs, status: 'failed' });
        await writeTimingEvent({ event: 'check-complete', label, script: commandArgs.at(-1), suite, elapsedMs, status: 'failed', error: error.message });
        throw error;
      }
      const elapsedMs = Math.round(performance.now() - startedAt);
      timingChecks.push({ label, suite, elapsedMs, status: 'passed' });
      const warningMs = Number(feedbackConfig.check_warning_ms);
      const warning = Number.isFinite(warningMs) && elapsedMs > warningMs ? ' [over check warning budget]' : '';
      console.log(`[test-harness] ${label}: ${elapsedMs} ms${warning}`);
      await writeTimingEvent({ event: 'check-complete', label, script: commandArgs.at(-1), suite, elapsedMs, status: 'passed', warning: Boolean(warning) });
    }

    try {
      if (shouldBuild) await run('build current runtime bundles', npmCommand, ['run', 'build']);
      for (const [label, script, suite] of checks) await run(label, process.execPath, [script], suite);
      const suiteElapsedMs = Math.round(performance.now() - suiteStartedAt);
      const budgetMs = requestedNames.includes('all') || names.length > 1
        ? Number(feedbackConfig.release_budget_ms)
        : names[0] === 'smoke' ? Number(feedbackConfig.smoke_budget_ms) : undefined;
      const budgetStatus = Number.isFinite(budgetMs) && suiteElapsedMs > budgetMs ? ` [over suite budget ${budgetMs} ms]` : '';
      console.log(`\n[test-harness] PASS: ${checks.length} check(s) in ${suiteElapsedMs} ms${budgetStatus}`);
      await writeTimingEvent({ event: 'run-complete', status: 'passed', elapsedMs: suiteElapsedMs, checkCount: timingChecks.length, plannedCheckCount: checks.length, suiteTotals: timingSuiteTotals(), budgetStatus: budgetStatus || undefined });
      if (budgetStatus) process.exitCode = 1;
    } catch (error) {
      console.error(`\n[test-harness] FAIL: ${error.message}`);
      await writeTimingEvent({ event: 'run-complete', status: 'failed', elapsedMs: Math.round(performance.now() - suiteStartedAt), checkCount: timingChecks.length, plannedCheckCount: checks.length, suiteTotals: timingSuiteTotals(), error: error.message });
      process.exitCode = 1;
    }
  }
}
