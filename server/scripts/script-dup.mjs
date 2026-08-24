#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const CHECK = process.argv.includes('--check');
const SCRIPT_ROOTS = [join(ROOT, 'scripts'), join(ROOT, 'server', 'scripts')];
const FIXTURE_CONSUMERS = [
  'scripts/test-brand-contract.js',
  'server/scripts/test-public-behavior.mjs',
  'server/scripts/visual-qa.mjs',
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = [...new Set(SCRIPT_ROOTS.flatMap(sourceFiles))].sort();
const sources = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]));
const relativePath = (path) => relative(ROOT, path);

function definitions(pattern) {
  return files.filter((path) => pattern.test(sources.get(path)));
}

function functionBodies(source) {
  const matches = [];
  const header = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  for (const match of source.matchAll(header)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    let escaped = false;
    let end = start;
    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '\'' || character === '"' || character === '`') {
        quote = character;
        continue;
      }
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
    if (depth === 0) matches.push({ name: match[1], body: source.slice(start, end - 1) });
  }
  return matches;
}

function normaliseBody(body) {
  return body.replace(/\s+/g, ' ').trim();
}

const officeDefinitions = definitions(/(?:export\s+)?function\s+findOfficeConverter\s*\(/);
const fixtureModule = join(ROOT, 'server', 'scripts', 'lib', 'fixtures.mjs');
const fixtureConsumers = FIXTURE_CONSUMERS.filter((path) => sources.has(join(ROOT, path)) && /lib\/fixtures\.mjs/.test(sources.get(join(ROOT, path))));
const processOwners = files.filter((path) => /spawnSync\s*\(/.test(sources.get(path)));
const processImports = files.filter((path) => /from ['"]node:child_process['"]/.test(sources.get(path)) && /spawnSync\s*\(/.test(sources.get(path)));
const directManifestLoops = files.filter((path) => !path.endsWith('/showcase.mjs') && /for\s*\(\s*const\s+\w+\s+of\s+manifests\b/.test(sources.get(path)));
const sharedManifestIteratorUses = files.filter((path) => /(?:forEachManifest|mapManifests)\s*\(/.test(sources.get(path)) && !path.endsWith('/showcase.mjs'));

const bodyOwners = new Map();
for (const [path, source] of sources) {
  for (const { name, body } of functionBodies(source)) {
    const key = normaliseBody(body);
    if (!key) continue;
    const owners = bodyOwners.get(key) ?? [];
    owners.push(`${relativePath(path)}:${name}`);
    bodyOwners.set(key, owners);
  }
}
const identicalBodies = [...bodyOwners.values()].filter((owners) => new Set(owners.map((owner) => owner.split(':')[0])).size > 1);

const checks = [
  { name: 'findOfficeConverter implementations', actual: officeDefinitions.length, expected: 1, details: officeDefinitions.map(relativePath) },
  { name: 'fixture builder module', actual: existsSync(fixtureModule) && fixtureConsumers.length === FIXTURE_CONSUMERS.length ? 1 : 0, expected: 1, details: fixtureConsumers },
  { name: 'showcase iterations outside shared iterator', actual: directManifestLoops.length, expected: 0, details: directManifestLoops.map(relativePath) },
  { name: 'shared showcase iterator consumers', actual: sharedManifestIteratorUses.length, expected: 2, details: sharedManifestIteratorUses.map(relativePath) },
  { name: 'process runner owners', actual: processOwners.length, expected: 1, details: processOwners.map(relativePath) },
  { name: 'process runner imports', actual: processImports.length, expected: 1, details: processImports.map(relativePath) },
  { name: 'identical function bodies across files', actual: identicalBodies.length, expected: 0, details: identicalBodies },
];

for (const check of checks) console.log(`${check.name}: ${check.actual}/${check.expected}${check.details.length ? ` (${check.details.join(', ')})` : ''}`);
if (CHECK && checks.some((check) => check.actual !== check.expected)) process.exitCode = 1;
