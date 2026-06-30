#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { spawn, spawnSync } from 'child_process';

const dataDir = process.env.REPORT_BABY_DATA || join(homedir(), '.report-baby');
const serverDir = join(dataDir, 'server');
const bundle = join(serverDir, 'bundle.cjs');
const serverPkg = join(serverDir, 'package.json');
const pkgPath = join(dataDir, 'package.json');

const REPO_RAW = 'https://raw.githubusercontent.com/treetank-net/report-baby/main';

function cleanEnv(value) {
  return value && !value.includes('${') ? value : '';
}

function localVersion() {
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function download(remotePath, localPath) {
  mkdirSync(dirname(localPath), { recursive: true });
  const res = await fetch(`${REPO_RAW}/${remotePath}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${remotePath}`);
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
}

async function autoUpdate() {
  try {
    const res = await fetch(`${REPO_RAW}/package.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} checking package version`);
    const remote = await res.json();
    const missingBundle = !existsSync(bundle);
    if (!missingBundle && (remote.version || '0.0.0') === localVersion()) return;

    process.stderr.write(`Updating report-baby ${localVersion()} -> ${remote.version}...\n`);

    await download('server/bundle.cjs', bundle);
    await download('server/package.json', serverPkg);
    await download('package.json', pkgPath);

    process.stderr.write(`Updated to ${remote.version}.\n`);
  } catch (error) {
    process.stderr.write(`Could not update report-baby: ${error.message}\n`);
  }
}

function ensureNodeModules() {
  if (existsSync(join(serverDir, 'node_modules', 'playwright'))) return true;
  process.stderr.write('Installing report-baby runtime dependencies...\n');
  const result = spawnSync('npm', ['install', '--omit=dev'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function chromiumChannel() {
  return cleanEnv(process.env.REPORT_BABY_CHROMIUM_CHANNEL);
}

function chromiumInstalled() {
  if (chromiumChannel()) return true;
  try {
    const base = process.platform === 'win32'
      ? join(process.env.USERPROFILE || '', 'AppData', 'Local', 'ms-playwright')
      : process.platform === 'darwin'
        ? join(process.env.HOME || '', 'Library', 'Caches', 'ms-playwright')
        : join(process.env.HOME || '', '.cache', 'ms-playwright');
    if (!existsSync(base)) return false;
    return readdirSync(base).some((d) => d.startsWith('chromium'));
  } catch {
    return false;
  }
}

function ensureChromium() {
  if (chromiumInstalled()) return true;
  process.stderr.write('report-baby: Chromium for Playwright not found.\n');
  process.stderr.write('Attempting: npx playwright install chromium ...\n');
  const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
    cwd: serverDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status === 0) return true;
  process.stderr.write('Automatic install failed. Run manually:\n  npx playwright install chromium\n');
  process.stderr.write('Or set REPORT_BABY_CHROMIUM_CHANNEL=chrome to use a system Chrome install.\n');
  return false;
}

await autoUpdate();

if (!existsSync(bundle)) {
  process.stderr.write(`Missing MCP server bundle at ${bundle}.\n`);
  process.exit(1);
}

if (!ensureNodeModules()) process.exit(1);
if (!ensureChromium()) process.exit(1);

const child = spawn('node', [bundle], {
  cwd: serverDir,
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: dataDir },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
