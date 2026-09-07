#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = resolve(SCRIPT_DIRECTORY, '../src/composition/flow-planner.ts');
const DEFAULT_MARKER = 'planFlow';

function printHelp() {
  console.log(`Usage: node scripts/flow-planner-coverage-report.mjs <coverage-directory> [options]

Reads JSON files produced by NODE_V8_COVERAGE and reports function-level
execution for named functions declared in flow-planner.ts.

Options:
  --source <path>       Planner source file (default: src/composition/flow-planner.ts)
  --marker <name>       Function identifying a planner bundle (default: ${DEFAULT_MARKER})
  --json                Emit machine-readable JSON instead of the text report
  --help                Show this help

Example:
  NODE_V8_COVERAGE=/tmp/report-baby-coverage npm run test:composition -- --no-build
  node scripts/flow-planner-coverage-report.mjs /tmp/report-baby-coverage
`);
}

function parseArgs(argv) {
  const options = {
    coverageDirectory: undefined,
    source: DEFAULT_SOURCE,
    marker: DEFAULT_MARKER,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--json') {
      options.json = true;
      continue;
    }
    if (argument === '--source' || argument === '--marker') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--')) throw new Error(`Unknown option '${argument}'.`);
    if (options.coverageDirectory !== undefined) throw new Error('Only one coverage directory may be provided.');
    options.coverageDirectory = argument;
  }
  return options;
}

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path);
  }
  return files.sort();
}

function sourceFunctions(sourceText) {
  const declaration = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  return [...sourceText.matchAll(declaration)].map((match) => ({
    name: match[1],
    line: sourceText.slice(0, match.index).split('\n').length,
  }));
}

function functionKey(entry) {
  const firstRange = entry.ranges?.[0];
  return `${entry.functionName}:${firstRange?.startOffset ?? 'unknown'}:${firstRange?.endOffset ?? 'unknown'}`;
}

function mergeCoverageFunction(functions, entry) {
  const key = functionKey(entry);
  const previous = functions.get(key);
  if (!previous) {
    functions.set(key, {
      functionName: entry.functionName,
      ranges: entry.ranges ?? [],
    });
    return;
  }
  previous.ranges = previous.ranges.map((range, index) => ({
    ...range,
    count: Math.max(Number(range.count) || 0, Number(entry.ranges?.[index]?.count) || 0),
  }));
}

function functionWasEntered(entry) {
  return (entry.ranges ?? []).some((range) => Number(range.count) > 0);
}

function functionInvocationCount(entry) {
  return Math.max(0, ...(entry.ranges ?? []).map((range) => Number(range.count) || 0));
}

async function readCoverage(options) {
  const files = await jsonFiles(options.coverageDirectory);
  const scriptsByUrl = new Map();
  let sourceMapCacheFiles = 0;
  let ignoredFiles = 0;
  for (const file of files) {
    let coverage;
    try {
      coverage = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      ignoredFiles += 1;
      continue;
    }
    if (coverage['source-map-cache'] && Object.keys(coverage['source-map-cache']).length > 0) sourceMapCacheFiles += 1;
    if (!Array.isArray(coverage.result)) {
      ignoredFiles += 1;
      continue;
    }
    for (const script of coverage.result) {
      if (!script.url || !Array.isArray(script.functions)) continue;
      if (!script.functions.some((entry) => entry.functionName === options.marker)) continue;
      const existing = scriptsByUrl.get(script.url) ?? { url: script.url, functions: new Map(), files: new Set() };
      existing.files.add(file);
      for (const entry of script.functions) mergeCoverageFunction(existing.functions, entry);
      scriptsByUrl.set(script.url, existing);
    }
  }
  return { files, scripts: [...scriptsByUrl.values()], sourceMapCacheFiles, ignoredFiles };
}

function reportResults(functionDeclarations, plannerScripts) {
  return functionDeclarations.map((declaration) => {
    const definitions = plannerScripts.flatMap((script) => [...script.functions.values()]
      .filter((entry) => entry.functionName === declaration.name));
    const entered = definitions.some(functionWasEntered);
    const invocations = definitions.reduce((sum, entry) => sum + functionInvocationCount(entry), 0);
    const ambiguous = definitions.length > plannerScripts.length || plannerScripts.some((script) => {
      const sameName = [...script.functions.values()].filter((entry) => entry.functionName === declaration.name);
      return sameName.length > 1;
    });
    let status = 'absent-from-planner-bundle';
    if (definitions.length > 0) status = ambiguous ? 'ambiguous-name' : entered ? 'entered' : 'never-entered';
    return {
      name: declaration.name,
      line: declaration.line,
      status,
      definitions: definitions.length,
      invocations,
    };
  });
}

function summarize(results) {
  return results.reduce((summary, result) => {
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    return summary;
  }, {});
}

function printTextReport(report) {
  const { summary } = report;
  console.log('Flow planner coverage audit (function level)');
  console.log(`Coverage files: ${report.coverageFiles}`);
  console.log(`Planner bundle scripts: ${report.plannerScripts}`);
  console.log(`Source functions: ${report.sourceFunctions}`);
  console.log(`Entered: ${summary.entered ?? 0}`);
  console.log(`Never entered: ${summary['never-entered'] ?? 0}`);
  console.log(`Ambiguous names: ${summary['ambiguous-name'] ?? 0}`);
  console.log(`Absent from planner bundle: ${summary['absent-from-planner-bundle'] ?? 0}`);
  if (report.sourceMapCacheFiles === 0) console.log('Source maps: not present in coverage files; mapping is by function name only.');
  else console.log(`Source-map cache files: ${report.sourceMapCacheFiles}`);

  const neverEntered = report.functions.filter((result) => result.status === 'never-entered');
  if (neverEntered.length > 0) {
    console.log('\nPotentially uncalled functions:');
    for (const result of neverEntered) console.log(`  ${result.name} (flow-planner.ts:${result.line})`);
  }
  const ambiguous = report.functions.filter((result) => result.status === 'ambiguous-name');
  if (ambiguous.length > 0) {
    console.log('\nNeeds source-map confirmation because the bundle has multiple functions with the same name:');
    for (const result of ambiguous) console.log(`  ${result.name} (flow-planner.ts:${result.line})`);
  }
  console.log('\nInterpretation: never-entered is a deletion candidate, not proof. This report does not establish branch/path coverage.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.coverageDirectory) throw new Error('Coverage directory is required. Use --help for usage.');
  const coverageDirectory = resolve(options.coverageDirectory);
  const sourcePath = resolve(options.source);
  const sourceText = await readFile(sourcePath, 'utf8');
  const coverage = await readCoverage({ ...options, coverageDirectory });
  const functions = reportResults(sourceFunctions(sourceText), coverage.scripts);
  const report = {
    coverageDirectory,
    sourcePath,
    coverageFiles: coverage.files.length,
    plannerScripts: coverage.scripts.length,
    sourceFunctions: functions.length,
    sourceMapCacheFiles: coverage.sourceMapCacheFiles,
    ignoredCoverageFiles: coverage.ignoredFiles,
    summary: summarize(functions),
    functions,
  };
  if (coverage.scripts.length === 0) {
    report.warning = `No planner bundle was identified by function marker '${options.marker}'. Use an unminified bundle or pass --marker.`;
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printTextReport(report);
}

main().catch((error) => {
  console.error(`flow-planner coverage: ${error.message}`);
  process.exitCode = 1;
});
