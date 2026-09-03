#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const configPath = join(root, 'templates/render-config.yml');
const compositionDocsRoot = join(root, '..', 'docs/composition');
const evaluatorPath = join(root, 'src/composition/evaluator.ts');

function leafPaths(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function fieldName(path) {
  return path.split('.').at(-1);
}

const config = parse(await readFile(configPath, 'utf8'));
const docNames = (await readdir(compositionDocsRoot))
  .filter((name) => name.endsWith('.md'))
  .sort();
const documentation = (await Promise.all(docNames.map((name) => readFile(join(compositionDocsRoot, name), 'utf8')))).join('\n');

const documentedGroups = ['quality', 'composition_score', 'composition_search'];
const missingFields = [];
for (const group of documentedGroups) {
  const fields = leafPaths(config[group]);
  for (const path of fields) {
    const name = fieldName(path);
    const escapedName = name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${escapedName}\\b`, 'u').test(documentation)) missingFields.push(path);
  }
}

if (missingFields.length > 0) {
  throw new Error([
    'Documentation contract failed: every element in the documented configuration groups must have its meaning and interactions with other fields documented in English.',
    `Missing fields: ${missingFields.join(', ')}`,
  ].join('\n'));
}

const evaluator = await readFile(evaluatorPath, 'utf8');
const hardRuleCodes = [...evaluator.matchAll(/error\('([A-Z][A-Z0-9_]*)'/gu)].map((match) => match[1]);
const missingHardRules = [...new Set(hardRuleCodes)].filter((code) => !documentation.includes(code));
if (missingHardRules.length > 0) {
  throw new Error([
    'Documentation contract failed: every evaluator hard rule must be listed with its rejection meaning and reason.',
    `Missing hard rules: ${missingHardRules.join(', ')}`,
  ].join('\n'));
}

const pdfCompositionFields = [
  'planner_max_iterations',
  'planner_minimum_fragment_lines',
  'composition_geometry_tolerance',
  'composition_max_pages',
  'plan_coverage_max_gap',
];
const missingPdfFields = pdfCompositionFields.filter((field) => !new RegExp(`\\b${field}\\b`, 'u').test(documentation));
if (missingPdfFields.length > 0) {
  throw new Error([
    'Documentation contract failed: PDF fields that implement composition rules must explain their interaction with the planner or hard gate.',
    `Missing fields: ${missingPdfFields.join(', ')}`,
  ].join('\n'));
}

console.log(`PASS: composition documentation covers ${documentedGroups.join(', ')}, ${new Set(hardRuleCodes).size} evaluator hard-rule code(s), and ${pdfCompositionFields.length} composition-linked pdf field(s)`);
