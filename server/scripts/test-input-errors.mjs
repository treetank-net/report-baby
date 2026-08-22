import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writePublicBrandFixture } from './lib/fixtures.mjs';
import { runProcess } from './lib/process.mjs';

const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const serverRoot = join(root, 'server');
const corpusPath = join(root, 'docs/quality/input-error-corpus.json');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const crashPattern = /is not a function|Cannot read propert|undefined is not/i;

assert.equal(corpus.schema_version, 1);
assert.ok(Array.isArray(corpus.cases));
assert.ok(corpus.cases.length >= 10, 'bad-input corpus must contain at least 10 cases');
assert.equal(new Set(corpus.cases.map((item) => item.id)).size, corpus.cases.length, 'bad-input case ids must be unique');

function assertMessage(caseItem, message, front) {
  assert.ok(message, `${front} returned no diagnostic for ${caseItem.id}`);
  assert.match(message, new RegExp(caseItem.field, 'i'), `${front} omitted field ${caseItem.field} for ${caseItem.id}`);
  assert.match(message, new RegExp(caseItem.expected_pattern, 'i'), `${front} omitted expected type/value for ${caseItem.id}: ${message}`);
  assert.doesNotMatch(message, crashPattern, `${front} exposed a crash-shaped error for ${caseItem.id}: ${message}`);
}

function cliCase(caseItem, tempRoot, brandDir) {
  const inputPath = join(tempRoot, `${caseItem.id}.json`);
  const outputPath = join(tempRoot, caseItem.id);
  return writeFile(inputPath, `${JSON.stringify(caseItem.input)}\n`).then(() => runProcess(
    process.execPath,
    [
      'example-bundle.cjs',
      '--kind', caseItem.kind,
      '--brand-root', brandDir,
      '--brand', 'brand://acme/primary',
      '--input', inputPath,
      '--out', outputPath,
      '--formats', caseItem.kind === 'deck' ? 'pdf' : 'pdf',
    ],
    { cwd: serverRoot, timeout: 20_000 },
  ));
}

async function testCli(tempRoot, brandDir) {
  for (const caseItem of corpus.cases) {
    const result = await cliCase(caseItem, tempRoot, brandDir);
    assert.notEqual(result.status, 0, `CLI accepted malformed input ${caseItem.id}`);
    assertMessage(caseItem, `${result.stdout}\n${result.stderr}`, 'CLI');
  }
}

function toolText(result) {
  return [
    result?.content?.map((item) => item?.text ?? '').join('\n'),
    JSON.stringify(result),
  ].filter(Boolean).join('\n');
}

async function testMcp(tempRoot, brandDir) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [process.env.REPORT_BABY_TEST_BUNDLE ?? 'bundle.cjs'],
    cwd: serverRoot,
    env: { ...process.env, REPORT_BABY_DATA: tempRoot, REPORT_BABY_BRAND_DIR: brandDir },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'report-baby-input-error-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    for (const caseItem of corpus.cases) {
      const outputPath = join(tempRoot, `${caseItem.id}.mcp.pdf`);
      const toolName = caseItem.kind === 'deck' ? 'render_slides_pdf' : 'render_report';
      const result = await client.callTool({
        name: toolName,
        arguments: {
          brand_ref: 'brand://acme/primary',
          data: caseItem.input,
          output_path: outputPath,
        },
      });
      assert.equal(result.isError, true, `MCP accepted malformed input ${caseItem.id}`);
      assertMessage(caseItem, toolText(result), 'MCP');
    }
  } finally {
    await client.close().catch(() => {});
  }
}

const tempRoot = await mkdtemp(join(tmpdir(), 'report-baby-input-errors-'));
const brandDir = join(tempRoot, 'brands');
await writePublicBrandFixture(brandDir);
try {
  await testCli(tempRoot, brandDir);
  await testMcp(tempRoot, brandDir);
  console.log(`input errors: ${corpus.cases.length} malformed cases rejected by CLI and MCP with actionable diagnostics`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
