import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-fallback-cache-'));
const bundle = join(temporary, 'test-fallback-cache.cjs');

try {
  await execFileAsync('npx', ['esbuild', 'scripts/test-fallback-cache-entry.ts', '--bundle', '--platform=node', '--target=node18', '--format=cjs', '--loader:.wasm=binary', '--loader:.ttf=binary', `--outfile=${bundle}`], { cwd: root, maxBuffer: 1024 * 1024 });
  const result = await execFileAsync(process.execPath, [bundle], {
    cwd: root,
    env: { ...process.env, REPORT_BABY_BRAND_DIR: join(root, '..', 'examples', 'brand-showcase', 'brands') },
    maxBuffer: 1024 * 1024,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
