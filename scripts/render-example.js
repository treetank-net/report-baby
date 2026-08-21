#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const bundle = resolve(process.cwd(), 'server/example-bundle.cjs');
if (!existsSync(bundle)) {
  console.error('Missing server/example-bundle.cjs. Build it with: cd server && npm run build:example');
  process.exit(1);
}

const result = spawnSync(process.execPath, [bundle, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
