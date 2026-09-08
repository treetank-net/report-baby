#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writePublicBrandFixture } from './lib/fixtures.mjs';
import { createDeterministicLorem, loremWords } from './lib/deterministic-lorem.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-dynamic-public-'));
const brandDir = join(temporary, 'brands');
await writePublicBrandFixture(brandDir);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.REPORT_BABY_TEST_BUNDLE ?? 'bundle.cjs'],
  cwd: process.cwd(),
  env: { ...process.env, REPORT_BABY_DATA: temporary, REPORT_BABY_BRAND_DIR: brandDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'report-baby-dynamic-public-test', version: '1.0.0' });
const lorem = createDeterministicLorem();

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: 'render_report',
    arguments: {
      template: 'pages/editorial-two-column',
      dry_run: true,
      diagnostics: 'full',
      brand_ref: 'brand://acme/primary',
      data: {
        flows: {
          main: { continuation: 'allowed', blocks: [{ type: 'text', id: 'story', role: 'body', text: loremWords(lorem, 1000) }] },
          quotes: { continuation: 'forbidden', blocks: Array.from({ length: 7 }, (_, index) => ({ type: 'text', id: `quote-${index + 1}`, role: 'quote', text: `Quote ${index + 1}: ${loremWords(lorem, 4)}.` })) },
        },
      },
      placement_requests: {
        insertion_flows: [{
          flow_id: 'quotes',
          start_page: 1,
          repeat: 'each-page',
          slots: [
            { id: 'quote-top', frame: { x: 0.1, y: 0.2, width: 0.8, height: 'auto' }, allowed_roles: ['quote'] },
            { id: 'quote-bottom', frame: { x: 0.1, y: 0.55, width: 0.8, height: 'auto' }, allowed_roles: ['quote'] },
          ],
        }],
      },
    },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.equal(result.structuredContent?.compositionEvaluation?.status, 'accepted', JSON.stringify(result.structuredContent));
  assert.equal(result.structuredContent?.compositionPlan?.insertionLines?.length, 7);
  console.log(JSON.stringify({ status: 'passed', insertionLines: result.structuredContent?.compositionPlan?.insertionLines?.length, pages: result.structuredContent?.compositionPlan?.pages?.length }, null, 2));
} finally {
  await client.close().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
