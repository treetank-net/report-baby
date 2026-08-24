import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { childProcessFailure } from './lib/process.mjs';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-source-context-'));
const output = join(temporary, 'source-context.mjs');

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(childProcessFailure(command, { status: code, signal, stderr }))));
  });
}

try {
  await run('npx', ['esbuild', 'src/source-context.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${output}`]);
  const { createSourceContext } = await import(output);
  const context = createSourceContext({
    contentRoot: join(temporary, 'content'),
    sourceRoot: join(temporary, 'source'),
    brandRoot: join(temporary, 'source', 'brand'),
  });

  assert.equal(context.resolvePath('assets/map.png'), join(temporary, 'content', 'assets', 'map.png'));
  assert.equal(context.resolvePath('root://assets/map.png'), join(temporary, 'content', 'assets', 'map.png'));
  assert.equal(context.resolvePath('brand://assets/logo.svg'), join(temporary, 'source', 'brand', 'assets', 'logo.svg'));
  assert.equal(context.resolvePath('source://shared/chart.png'), join(temporary, 'source', 'shared', 'chart.png'));
  assert.throws(() => context.resolvePath('source://../outside.png'), /escapes/);
  assert.throws(() => context.resolvePath('/etc/passwd'), /Absolute content paths/);
  assert.throws(() => context.resolvePath('https://example.test/chart.png'), /Remote content reference/);
  console.log('source context: namespaces and root confinement passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
