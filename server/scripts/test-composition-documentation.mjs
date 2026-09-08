#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const configPath = join(root, 'templates/render-config.yml');
const compositionDocsRoot = join(root, '..', 'docs/composition');
const evaluatorPath = join(root, 'src/composition/evaluation/evaluator.ts');
const plannerPath = join(root, 'src/composition/layout/text-planner.ts');
const compositionSourceRoot = join(root, 'src/composition');
const modelPath = join(compositionSourceRoot, 'contracts/model.ts');
const blockKindsDocumentationPath = join(compositionDocsRoot, 'block-kinds.md');

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

const documentedGroups = ['quality', 'composition_score', 'composition_search', 'contrast'];
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
const planner = await readFile(plannerPath, 'utf8');
const evaluatorHardRuleCodes = [...evaluator.matchAll(/error\('([A-Z][A-Z0-9_]*)'/gu)].map((match) => match[1]);
const plannerHardRuleCodes = [...planner.matchAll(/diagnostic\('error', '([A-Z][A-Z0-9_]*)'/gu)].map((match) => match[1]);
const hardRuleCodes = [...evaluatorHardRuleCodes, ...plannerHardRuleCodes];
const missingHardRules = [...new Set(hardRuleCodes)].filter((code) => !documentation.includes(code));
if (missingHardRules.length > 0) {
  throw new Error([
    'Documentation contract failed: every composition hard rule must be listed with its rejection meaning and reason.',
    `Missing hard rules: ${missingHardRules.join(', ')}`,
  ].join('\n'));
}

const pdfCompositionFields = [
  'planner_max_iterations',
  'heading_keep_with_next_lines',
  'widow_min_lines',
  'orphan_min_lines',
  'planner_minimum_fragment_lines',
  'composition_geometry_tolerance',
  'list_item_keep_together',
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

const sourceText = async (relativePath) => readFile(join(compositionSourceRoot, relativePath), 'utf8');
const sourceOwnership = [
  { file: 'layout/text-planner.ts', allowedGroups: [], reason: 'the renderer-neutral planner must receive policy instead of reading YAML' },
  { file: 'layout/planner-candidates.ts', allowedGroups: [], reason: 'candidate geometry must remain independent of configuration loading' },
  { file: 'text/text-layout.ts', allowedGroups: [], reason: 'wrapping must remain independent of configuration loading' },
  { file: 'layout/flow-space.ts', allowedGroups: [], reason: 'barrier geometry must remain independent of configuration loading' },
  { file: 'layout/glyph-objects.ts', allowedGroups: [], reason: 'glyph placement must remain independent of configuration loading' },
  { file: 'geometry/glyph-geometry.ts', allowedGroups: [], reason: 'sampling geometry must receive its inputs through the composition interface' },
  { file: 'layout/page-state.ts', allowedGroups: [], reason: 'route compatibility must remain independent of configuration loading' },
  { file: 'layout/insertion-layout.ts', allowedGroups: [], reason: 'source-order geometry must remain independent of configuration loading' },
  { file: 'evaluation/contrast.ts', allowedGroups: [], reason: 'contrast measurement must receive sampling policy through its provider options' },
  { file: 'evaluation/evaluator.ts', allowedGroups: ['compositionScore', 'contrast'], reason: 'the evaluator owns score interpretation and contrast target policy' },
  { file: 'adapters/text-engine.ts', allowedGroups: ['pdf'], reason: 'the text-engine adapter translates PDF policy into planner policy' },
  { file: 'report-composition-entrypoint.ts', allowedGroups: [], reason: 'the report entrypoint delegates policy translation to the text-engine adapter' },
  { file: 'adapters/render-config.ts', allowedGroups: ['pdf', 'chart'], reason: 'the styles adapter owns renderer style configuration only' },
];
const ownershipViolations = [];
for (const rule of sourceOwnership) {
  const source = await sourceText(rule.file);
  const reads = [...source.matchAll(/readRenderConfig\(\)\.([A-Za-z]+)/gu)].map((match) => match[1]);
  const disallowed = reads.filter((group) => !rule.allowedGroups.includes(group));
  if (disallowed.length > 0) ownershipViolations.push(`${rule.file} reads ${[...new Set(disallowed)].join(', ')}; ${rule.reason}`);
  if (rule.allowedGroups.length === 0 && /readRenderConfig\(|render-config\.yml/gu.test(source)) {
    ownershipViolations.push(`${rule.file} reads render configuration; ${rule.reason}`);
  }
}
if (ownershipViolations.length > 0) {
  throw new Error([
    'Configuration ownership contract failed: composition modules must read only their assigned render-config groups through the documented adapter seam.',
    ...ownershipViolations,
  ].join('\n'));
}

const model = await readFile(modelPath, 'utf8');
const blockKindsDocumentation = await readFile(blockKindsDocumentationPath, 'utf8');
const blockKindsMatch = model.match(/export type CompositionBlockKind = ([^;]+);/u);
const blockKinds = [...(blockKindsMatch?.[1].matchAll(/'([^']+)'/gu) ?? [])].map((match) => match[1]);
const missingBlockKinds = blockKinds.filter((kind) => !new RegExp(`\\b${kind}\\b`, 'u').test(blockKindsDocumentation));
if (missingBlockKinds.length > 0) {
  throw new Error([
    'Documentation contract failed: every CompositionBlockKind must be present in the canonical block-kind map.',
    `Missing block kinds: ${missingBlockKinds.join(', ')}`,
  ].join('\n'));
}

console.log(`PASS: composition documentation covers ${documentedGroups.join(', ')}, ${new Set(hardRuleCodes).size} evaluator hard-rule code(s), ${pdfCompositionFields.length} composition-linked pdf field(s), configuration ownership, and ${blockKinds.length} block kind(s)`);
