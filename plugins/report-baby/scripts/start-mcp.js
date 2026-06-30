#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

function cleanEnv(value) {
  return value && !value.includes('${') ? value : '';
}

const dataDir = cleanEnv(process.env.REPORT_BABY_DATA) || join(homedir(), '.report-baby');
const serverDir = join(dataDir, 'server');
const bundle = join(serverDir, 'bundle.cjs');
const serverPkg = join(serverDir, 'package.json');
const pkgPath = join(dataDir, 'package.json');

const REPO_RAW = 'https://raw.githubusercontent.com/treetank-net/report-baby/main';

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

async function ensureBundle() {
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

await ensureBundle();

if (!existsSync(bundle)) {
  process.stderr.write(`Missing MCP server bundle at ${bundle}.\n`);
  process.exit(1);
}

const child = spawn('node', [bundle], {
  cwd: serverDir,
  env: { ...process.env, CLAUDE_PLUGIN_ROOT: dataDir },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 1));
