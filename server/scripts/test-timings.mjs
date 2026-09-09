#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const reportPath = process.env.TEST_TIMINGS_PATH ?? join(root, 'qa', 'test-timings.jsonl');
await mkdir(dirname(reportPath), { recursive: true });

const forwardedArgs = [];
const suppliedArgs = process.argv.slice(2);
for (let index = 0; index < suppliedArgs.length; index += 1) {
  if (suppliedArgs[index] === '--timings') {
    index += 1;
    continue;
  }
  forwardedArgs.push(suppliedArgs[index]);
}
const child = spawn(process.execPath, [
  'scripts/test-harness.mjs',
  '--suite',
  'all',
  ...forwardedArgs,
  '--timings',
  reportPath,
], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

console.log(`[test-timings] incremental report: ${reportPath}`);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
