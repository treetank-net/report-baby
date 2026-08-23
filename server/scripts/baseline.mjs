#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfContentHash, pptxContentHash, sha256 } from './lib/artifact-inspect.mjs';
import { prepareDemoBrandStore } from './lib/brand-store.mjs';
import { runProcess } from './lib/process.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS_PATH = resolve(REPO_ROOT, 'docs/quality/corpus-tier-a.json');
const BASELINE_PATH = resolve(REPO_ROOT, 'docs/quality/baseline.json');
const VISUAL_QA_PATH = resolve(REPO_ROOT, 'server/scripts/visual-qa.mjs');
const FORMAT_ORDER = ['pdf', 'png', 'pptx'];

const args = process.argv.slice(2);
const command = args[0] ?? 'verify';

function option(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : undefined;
}

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`could not read ${path}: ${error.message}`);
  }
}

function normaliseCase(item) {
  if (!item || typeof item.id !== 'string' || typeof item.kind !== 'string' || typeof item.brand !== 'string' || typeof item.profile !== 'string' || !Array.isArray(item.formats)) {
    fail('every corpus case needs id, kind, brand, profile and formats');
  }
  const formats = [...new Set(item.formats)].sort((left, right) => FORMAT_ORDER.indexOf(left) - FORMAT_ORDER.indexOf(right));
  if (!item.id || !['deck', 'report'].includes(item.kind) || formats.length === 0 || formats.some((format) => !FORMAT_ORDER.includes(format))) {
    fail(`invalid corpus case ${item.id}`);
  }
  return { id: item.id, kind: item.kind, brand: item.brand, profile: item.profile, formats };
}

function readCorpus() {
  const corpus = readJson(CORPUS_PATH);
  if (corpus.schemaVersion !== 1 || corpus.tier !== 'A' || !Array.isArray(corpus.cases) || corpus.cases.length === 0) fail('Tier A corpus must have schemaVersion 1, tier A and at least one case');
  const cases = corpus.cases.map(normaliseCase).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(cases.map((item) => item.id)).size !== cases.length) fail('Tier A corpus contains duplicate case ids');
  return cases;
}

function canonicalCases(cases) {
  return JSON.stringify(cases.map(normaliseCase).sort((left, right) => left.id.localeCompare(right.id)));
}

function runVisualQa(templateDir, outputDir, reportPath, brandStore) {
  const qaArgs = [VISUAL_QA_PATH, '--no-office', '--parallel', '4', '--out', outputDir, '--json', reportPath];
  if (templateDir) qaArgs.push('--template-dir', resolve(REPO_ROOT, templateDir));
  const result = runProcess(process.execPath, qaArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env, REPORT_BABY_BRAND_STORE: brandStore },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`visual QA could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const output = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    fail(`visual QA failed with exit ${result.status}: ${output || '(no output)'}`);
  }
  return readJson(reportPath);
}

function artifactPath(kind, format) {
  if (format === 'pdf') return kind === 'deck' ? 'slides.pdf' : 'report.pdf';
  if (format === 'pptx') return 'slides.pptx';
  return null;
}

function hashArtifact(format, buffer) {
  if (format === 'pdf') return { normalization: 'pdf-content', hash: pdfContentHash(buffer) };
  if (format === 'pptx') return { normalization: 'pptx-content', hash: pptxContentHash(buffer) };
  return { normalization: 'raw', hash: sha256(buffer) };
}

function collectArtifacts(cases, report) {
  const reportById = new Map(report.cases.map((item) => [item.id, item]));
  const artifacts = [];
  for (const item of cases) {
    const record = reportById.get(item.id);
    if (!record) fail(`visual QA did not produce corpus case ${item.id}`);
    if (record.kind !== item.kind || record.brand !== item.brand || record.profile !== item.profile || JSON.stringify(record.formats) !== JSON.stringify(item.formats)) {
      fail(`visual QA case metadata changed for ${item.id}`);
    }
    if (record.expect !== 'render' || record.status === 'fail' || record.exitCode !== 0) fail(`visual QA did not render corpus case ${item.id}: ${record.engineMessage || record.status}`);
    const outputDir = join(record.directory, 'out');
    for (const format of item.formats) {
      const directPath = artifactPath(item.kind, format);
      const paths = directPath
        ? [directPath]
        : (existsSync(join(outputDir, 'png')) ? readdirSync(join(outputDir, 'png')).filter((name) => name.endsWith('.png')).sort().map((name) => join('png', name)) : []);
      if (paths.length === 0) fail(`visual QA produced no ${format} artifacts for ${item.id}`);
      for (const relativePath of paths) {
        const absolutePath = join(outputDir, relativePath);
        if (!existsSync(absolutePath)) fail(`missing ${item.id}/${relativePath}`);
        const normalised = hashArtifact(format, readFileSync(absolutePath));
        artifacts.push({ case: item.id, format, path: relativePath, normalization: normalised.normalization, hash: normalised.hash });
      }
    }
  }
  return artifacts.sort((left, right) => `${left.case}/${left.path}`.localeCompare(`${right.case}/${right.path}`));
}

function collectCurrent(cases, templateDir) {
  const outputDir = mkdtempSync(join(tmpdir(), 'report-baby-baseline-'));
  const reportPath = join(outputDir, 'qa-report.json');
  const brandStore = join(outputDir, 'brand-store');
  try {
    prepareDemoBrandStore(REPO_ROOT, brandStore, 'baseline-test');
    const report = runVisualQa(templateDir, outputDir, reportPath, brandStore);
    return { cases, artifacts: collectArtifacts(cases, report) };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function compare(baseline, current) {
  const differences = [];
  if (canonicalCases(baseline.cases) !== canonicalCases(current.cases)) differences.push('corpus case list changed');
  const before = new Map((baseline.artifacts ?? []).map((item) => [`${item.case}/${item.path}`, item]));
  const after = new Map(current.artifacts.map((item) => [`${item.case}/${item.path}`, item]));
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const left = before.get(key);
    const right = after.get(key);
    if (!left) differences.push(`unexpected artifact ${key} (${right.format})`);
    else if (!right) differences.push(`missing artifact ${key} (${left.format})`);
    else if (left.format !== right.format || left.normalization !== right.normalization) differences.push(`${key} format or normalization changed`);
    else if (left.hash !== right.hash) differences.push(`${key} (${left.format}) hash changed: ${left.hash} -> ${right.hash}`);
  }
  return differences;
}

function main() {
  if (!['record', 'verify'].includes(command)) fail(`usage: node server/scripts/baseline.mjs <record|verify> [--template-dir DIR]`);
  const cases = readCorpus();
  if (command === 'verify' && !existsSync(BASELINE_PATH)) fail(`baseline does not exist: ${BASELINE_PATH}`);
  const current = collectCurrent(cases, option('template-dir'));
  if (command === 'record') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ schemaVersion: 1, tier: 'A', cases, artifacts: current.artifacts }, null, 2)}\n`);
    console.log(`baseline record PASS: ${cases.length} case(s), ${current.artifacts.length} artifact(s) written to ${BASELINE_PATH}`);
    return;
  }
  const baseline = readJson(BASELINE_PATH);
  const differences = compare(baseline, current);
  if (differences.length > 0) {
    console.error(`baseline verify FAIL: ${differences.length} difference(s)`);
    for (const difference of differences) console.error(`  ${difference}`);
    process.exitCode = 1;
    return;
  }
  console.log(`baseline verify PASS: ${current.cases.length} case(s), ${current.artifacts.length} artifact(s) identical`);
}

try {
  main();
} catch (error) {
  console.error(`baseline ${command} BLOCKED: ${error.message}`);
  process.exitCode = 1;
}
