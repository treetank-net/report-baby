import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-test-'));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['bundle.cjs'],
  cwd: process.cwd(),
  env: { ...process.env, REPORT_BABY_DATA: outputDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'report-baby-public-test', version: '1.0.0' });

try {
  await client.connect(transport);

  const chartPath = join(outputDir, 'escaped-chart.png');
  const chart = await client.callTool({
    name: 'render_chart',
    arguments: {
      type: 'bar',
      title: '<script>alert("x")</script>',
      data: [{ label: '<img src=x onerror=alert(1)>', value: 42 }],
      output_path: chartPath,
    },
  });
  assert.notEqual(chart.isError, true);
  const png = await readFile(chartPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.length > 1_000);

  const pdfPath = join(outputDir, 'report.pdf');
  const report = await client.callTool({
    name: 'render_report',
    arguments: {
      output_path: pdfPath,
      data: {
        brand: 'TreeTank',
        title: 'Raport bezpieczeństwa — zażółć gęślą jaźń',
        intro: 'Publiczne dane raportu pozostają tekstem, także dla <script>alert(1)</script>.',
        kpis: [{ label: 'Konwersje', value: 42, delta: '+7%', trend: 'up' }],
        charts: [{ type: 'bar', title: 'Wyniki', data: [{ label: 'Lipiec', value: 42 }] }],
        sections: Array.from({ length: 12 }, (_, index) => ({
          heading: `Sekcja ${index + 1}`,
          body: 'Długi opis zachowania raportu. '.repeat(35),
        })),
        table: { head: ['Kanał', 'Wynik'], body: [['SEO', 42], ['Ads', 37]] },
        highlights: ['Pierwszy wniosek', 'Drugi wniosek'],
        footer: 'Poufne',
      },
    },
  });
  assert.notEqual(report.isError, true);
  const pdf = await readFile(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 20_000);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2);
} finally {
  await client.close();
  await rm(outputDir, { recursive: true, force: true });
}

process.stdout.write('public behavior: chart escaping and multi-page PDF OK\n');
