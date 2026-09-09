#!/usr/bin/env node

import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/test-editorial-flow.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, EDITORIAL_FLOW_FULL: '1' },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
