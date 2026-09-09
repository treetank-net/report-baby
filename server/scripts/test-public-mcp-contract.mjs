import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { zipSync } from 'fflate';
import { writePublicBrandFixture } from './lib/fixtures.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-public-mcp-'));
const brandDir = join(outputDir, 'brands');
await writePublicBrandFixture(brandDir);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.REPORT_BABY_TEST_BUNDLE ?? 'bundle.cjs'],
  cwd: process.cwd(),
  env: { ...process.env, REPORT_BABY_DATA: outputDir, REPORT_BABY_BRAND_DIR: brandDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'report-baby-public-mcp-contract', version: '1.0.0' });
const rawCallTool = client.callTool.bind(client);

// The public compatibility seam is intentionally exercised once. Production
// accepts composition flows; this adapter keeps the old fixture-shaped input
// out of the rest of the MCP contract test.
client.callTool = (request) => request.name === 'render_report'
  && request.arguments?.data
  && !request.arguments.data.flows
  ? rawCallTool({ ...request, arguments: { ...request.arguments, data: legacyFixtureToCompositionInput(request.arguments.data) } })
  : rawCallTool(request);

try {
  // Client.connect performs the MCP initialize handshake. listTools proves the
  // initialized server exposes the public tool surface before a tool call.
  await client.connect(transport);
  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));
  for (const name of ['list_brandbooks', 'inspect_brand', 'render_report', 'render_slides_pdf']) {
    assert.ok(toolNames.has(name), `initialized MCP server does not expose ${name}`);
  }

  const brandbooks = await client.callTool({ name: 'list_brandbooks', arguments: {} });
  assert.notEqual(brandbooks.isError, true, JSON.stringify(brandbooks.content));
  assert.match(brandbooks.content?.[0]?.text ?? '', /acme/);

  const inspected = await client.callTool({ name: 'inspect_brand', arguments: { brand_ref: 'brand://acme/primary' } });
  assert.notEqual(inspected.isError, true, JSON.stringify(inspected.content));
  const inspectedPayload = JSON.parse(inspected.content?.[0]?.text ?? '{}');
  assert.equal(inspectedPayload.capabilities.brand_name, 'Acme');
  assert.match(inspected.content?.[0]?.text ?? '', /#ff6600/i);

  const zipSourcePath = join(outputDir, 'source.zip');
  await writeFile(zipSourcePath, Buffer.from(zipSync({
    'brands/zip-brand/_brand.yml': Buffer.from('schema_version: 1\nmeta:\n  name: ZIP Brand\ncolor:\n  primary: "#123456"\n'),
    'brands/zip-brand/profiles/primary.yml': Buffer.from('schema_version: 1\n'),
  })));
  const zipBrandSource = { zip_path: zipSourcePath, brand_path: 'brands' };
  const zipBrandbooks = await client.callTool({ name: 'list_brandbooks', arguments: { brand_source: zipBrandSource } });
  assert.notEqual(zipBrandbooks.isError, true, JSON.stringify(zipBrandbooks.content));
  assert.match(zipBrandbooks.content?.[0]?.text ?? '', /zip-brand/);
  const inspectedZip = await client.callTool({
    name: 'inspect_brand',
    arguments: { brand_ref: 'brand://zip-brand/profiles/primary', brand_source: zipBrandSource },
  });
  assert.notEqual(inspectedZip.isError, true, JSON.stringify(inspectedZip.content));
  const inspectedZipPayload = JSON.parse(inspectedZip.content?.[0]?.text ?? '{}');
  assert.equal(inspectedZipPayload.capabilities.brand_name, 'ZIP Brand');
  assert.match(inspectedZip.content?.[0]?.text ?? '', /#123456/i);

  const reportData = {
    brand: 'TreeTank',
    title: 'Public MCP contract',
    intro: 'A small report proves the public render route without a large editorial fixture.',
    sections: [{ heading: 'Accepted report', body: 'The report output is produced by the public MCP tool.' }],
    footer: 'MCP contract',
  };
  const dryRun = await client.callTool({
    name: 'render_report',
    arguments: { template: 'default-report', dry_run: true, diagnostics: 'full', brand_ref: 'brand://acme/primary', data: reportData },
  });
  assert.notEqual(dryRun.isError, true, JSON.stringify(dryRun.content));
  assert.equal(dryRun.structuredContent?.dryRun, true);
  assert.equal(dryRun.structuredContent?.compositionEvaluation?.status, 'accepted');
  assert.ok((dryRun.structuredContent?.compositionPlan?.lines?.length ?? 0) > 0);

  const reportPath = join(outputDir, 'report.pdf');
  const rendered = await client.callTool({
    name: 'render_report',
    arguments: { template: 'default-report', output_path: reportPath, diagnostics: 'full', brand_ref: 'brand://acme/primary', data: reportData },
  });
  assert.notEqual(rendered.isError, true, JSON.stringify(rendered.content));
  assert.equal(rendered.structuredContent?.compositionEvaluation?.status, 'accepted');
  assert.equal(rendered.structuredContent?.layoutEngine, 'composition-planner');
  assert.equal((await readFile(reportPath)).subarray(0, 5).toString(), '%PDF-');

  const rejected = await client.callTool({
    name: 'render_report',
    arguments: { template_ref: 'slides/two-column', data: { title: 'Invalid report template' } },
  });
  assert.equal(rejected.isError, true, 'render_report accepted a slide template reference');
  const rejection = rejected.content?.[0]?.text ?? '';
  assert.match(rejection, /slides\/two-column/);
  assert.match(rejection, /default-report/);
  assert.match(rejection, /render_slides_pdf/);

  const slidePath = join(outputDir, 'slide.pdf');
  const slide = await client.callTool({
    name: 'render_slides_pdf',
    arguments: {
      brand_ref: 'brand://acme/primary',
      output_path: slidePath,
      data: {
        title: 'Minimal slide contract',
        slides: [{ layout: 'title', flows: { title: { blocks: [{ type: 'heading', text: 'MCP slide' }] } } }],
      },
    },
  });
  assert.notEqual(slide.isError, true, JSON.stringify(slide.content));
  assert.equal((await readFile(slidePath)).subarray(0, 5).toString(), '%PDF-');
  assert.equal(slide.structuredContent?.slideCount, 1);
} finally {
  await client.close();
  await rm(outputDir, { recursive: true, force: true });
}

process.stdout.write('public MCP contract: initialize, brands, ZIP source, report, rejection, and slide render OK\n');
