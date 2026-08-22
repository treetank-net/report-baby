import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writePublicBrandFixture } from './lib/fixtures.mjs';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const snapshotPath = join(root, 'docs/quality/mcp-tool-schemas.json');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortKeys(item)]));
}

function toolSnapshot(tools) {
  return tools
    .map(({ name, description, inputSchema }) => sortKeys({ name, description, inputSchema }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const tempRoot = await mkdtemp(join(tmpdir(), 'report-baby-schema-snapshot-'));
const brandDir = join(tempRoot, 'brands');
await writePublicBrandFixture(brandDir);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.REPORT_BABY_TEST_BUNDLE ?? 'bundle.cjs'],
  cwd: join(root, 'server'),
  env: { ...process.env, REPORT_BABY_DATA: tempRoot, REPORT_BABY_BRAND_DIR: brandDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'report-baby-schema-snapshot', version: '1.0.0' });

try {
  await client.connect(transport);
  const actual = toolSnapshot((await client.listTools()).tools ?? []);
  const serialized = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.argv.includes('--update')) {
    await writeFile(snapshotPath, serialized);
    console.log(`mcp schema snapshot updated: ${actual.length} tools`);
  } else {
    const expected = JSON.parse(await readFile(snapshotPath, 'utf8'));
    assert.deepEqual(actual, expected, 'MCP tool schemas changed; review and update the committed snapshot intentionally');
    console.log(`mcp schema snapshot: ${actual.length} tools unchanged`);
  }
} finally {
  await client.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
