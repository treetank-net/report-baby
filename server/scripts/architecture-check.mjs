import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(new URL('..', import.meta.url).pathname, 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (extname(entry.name) === '.ts') files.push(path);
  }
  return files;
}

function display(path) {
  return relative(root, path).replaceAll('\\', '/');
}

function resolveLocal(from, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  // TypeScript sources use Node-style `.js` specifiers so that the emitted
  // ESM graph is executable. Resolve that suffix back to the source module
  // before checking `.ts` files; otherwise every local edge becomes invisible
  // to this guard (`brand-context.js.ts` never exists).
  const sourceSpecifier = specifier.replace(/\.(?:js|mjs|cjs)$/, '');
  const base = resolve(dirname(from), sourceSpecifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, join(base, 'index.ts')];
  return candidates.find((candidate) => files.has(candidate));
}

function importsFor(sourceFile, includeTypeOnly) {
  const imports = [];
  function add(specifier, typeOnly) {
    if (includeTypeOnly || !typeOnly) imports.push({ specifier, typeOnly });
  }
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      add(statement.moduleSpecifier.text, Boolean(statement.importClause?.isTypeOnly));
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      add(statement.moduleSpecifier.text, Boolean(statement.isTypeOnly));
    } else if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference) && ts.isStringLiteral(statement.moduleReference.expression)) {
      add(statement.moduleReference.expression.text, false);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      add(node.arguments[0].text, false);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return imports;
}

function findCycles(graph) {
  const state = new Map();
  const stack = [];
  const cycles = new Set();
  function visit(node) {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === 'visiting') {
        cycles.add(stack.slice(stack.indexOf(next)).concat(next).map(display).join(' -> '));
      } else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, 'done');
  }
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return [...cycles];
}

const files = new Set(await sourceFiles(root));
const sources = new Map();
for (const path of files) {
  const text = await readFile(path, 'utf8');
  sources.set(path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
}

const typeGraph = new Map([...files].map((file) => [file, new Set()]));
const runtimeGraph = new Map([...files].map((file) => [file, new Set()]));
const violations = [];
for (const [from, source] of sources) {
  for (const item of importsFor(source, true)) {
    const target = resolveLocal(from, item.specifier);
    if (!target) continue;
    typeGraph.get(from).add(target);
    if (!item.typeOnly) runtimeGraph.get(from).add(target);
    const fromName = display(from);
    const targetName = display(target);
    // Contract modules may share other type-only contracts (for example the
    // source descriptor used by the Zod input schema), but they must not load
    // implementations at runtime.
    if (fromName.startsWith('contracts/') && !item.typeOnly) violations.push(`${fromName} imports local module ${targetName}`);
  }
}

for (const cycle of findCycles(runtimeGraph)) violations.push(`runtime import cycle: ${cycle}`);
for (const cycle of findCycles(typeGraph)) violations.push(`TypeScript import cycle: ${cycle}`);

assert.deepEqual(violations, [], `architecture check failed:\n${violations.join('\n')}`);
console.log(`architecture check: ${files.size} TypeScript modules, no forbidden cycles or layer violations`);
