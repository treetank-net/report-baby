#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, 'server', 'bundle.cjs');
const pkgPath = join(root, 'package.json');

const REPO_RAW = 'https://raw.githubusercontent.com/treetank-net/report-baby/main';

function localVersion() {
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}

async function download(remotePath, localPath) {
  const res = await fetch(`${REPO_RAW}/${remotePath}`);
  if (!res.ok) return false;
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function autoUpdate() {
  try {
    const res = await fetch(`${REPO_RAW}/package.json`);
    if (!res.ok) return;
    const remote = await res.json();
    if ((remote.version || '0.0.0') === localVersion()) return;

    process.stderr.write(`Updating report-baby ${localVersion()} → ${remote.version}...\n`);

    await download('server/bundle.cjs', bundle);
    await download('package.json', pkgPath);
    await download('scripts/start-mcp.js', join(root, 'scripts', 'start-mcp.js'));

    process.stderr.write(`Updated to ${remote.version}.\n`);
  } catch { /* network error — start with what we have */ }
}

function chromiumChannel() {
  const c = process.env['REPORT_BABY_CHROMIUM_CHANNEL'];
  return c && !c.includes('${') ? c : '';
}

function chromiumInstalled() {
  if (chromiumChannel()) return true;
  try {
    const base = process.platform === 'win32'
      ? join(process.env['USERPROFILE'] || '', 'AppData', 'Local', 'ms-playwright')
      : process.platform === 'darwin'
        ? join(process.env['HOME'] || '', 'Library', 'Caches', 'ms-playwright')
        : join(process.env['HOME'] || '', '.cache', 'ms-playwright');
    if (!existsSync(base)) return false;
    return readdirSync(base).some((d) => d.startsWith('chromium'));
  } catch { return false; }
}

function ensureChromium() {
  if (chromiumInstalled()) return;
  process.stderr.write('report-baby: Chromium for Playwright not found.\n');
  process.stderr.write('Attempting: npx playwright install chromium ...\n');
  try {
    const r = spawnSync('npx', ['playwright', 'install', 'chromium'], {
      cwd: join(root, 'server'),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      process.stderr.write('Automatic install failed. Run manually:\n  cd server && npx playwright install chromium\n');
      process.stderr.write('Or set REPORT_BABY_CHROMIUM_CHANNEL=chrome to use a system Chrome install.\n');
    }
  } catch {
    process.stderr.write('Could not run Playwright install. Run manually:\n  cd server && npx playwright install chromium\n');
    process.stderr.write('Or set REPORT_BABY_CHROMIUM_CHANNEL=chrome to use a system Chrome install.\n');
  }
}

await autoUpdate();

if (!existsSync(bundle)) {
  process.stderr.write(`Missing MCP server bundle at ${bundle}.\n`);
  process.exit(1);
}

ensureChromium();

const child = spawn('node', [bundle], {
  cwd: join(root, 'server'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
