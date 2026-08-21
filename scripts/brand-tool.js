#!/usr/bin/env node

import { runBrandToolCli } from '../server/brand-tool-bundle.cjs';

await runBrandToolCli(process.argv.slice(2));
