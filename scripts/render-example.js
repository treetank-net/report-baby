#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runProcess } from './server/scripts/lib/process.mjs';

const bundle = resolve(process.cwd(), 'server/example-bundle.cjs');
if (!existsSync(bundle)) {
  console.error('Missing server/example-bundle.cjs. Build it with: cd server && npm run build:example');
  process.exit(1);
}

const result = runProcess(process.execPath, [bundle, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
