import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { unzipSync } from 'fflate';

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

  const deck = {
    title: 'Wyniki kwartalne',
    brand: 'TreeTank',
    footer: 'Poufne',
    slides: [
      { type: 'title', title: 'Wyniki kwartalne — zażółć gęślą jaźń', subtitle: 'Prezentacja zarządcza' },
      { type: 'metrics', title: 'Najważniejsze KPI', metrics: [{ label: 'Przychód', value: '1,2 mln zł', delta: '+12%', trend: 'up' }, { label: 'Leady', value: 314, note: 'wartościowe kontakty' }] },
      { type: 'chart', title: 'Trend sprzedaży', chart: { type: 'bar', data: [{ label: 'Maj', value: 30 }, { label: 'Czerwiec', value: 42 }] } },
      { type: 'table', title: 'Kanały', head: ['Kanał', 'Wynik'], body: [['SEO', 42], ['Ads', 37]] },
      { type: 'narrative', title: 'Komentarz', body: 'Wyniki rosną dzięki jakości ruchu i lepszej konwersji.', highlights: ['Utrzymać inwestycję w SEO'] },
      { type: 'conclusions', title: 'Wnioski', items: ['Skalować zwycięskie kanały', 'Obserwować koszt pozyskania'] },
    ],
  };

  const slidesPdfPath = join(outputDir, 'slides.pdf');
  const slidesPdfResult = await client.callTool({ name: 'render_slides_pdf', arguments: { data: deck, output_path: slidesPdfPath } });
  assert.notEqual(slidesPdfResult.isError, true);
  const slidesPdf = await readFile(slidesPdfPath);
  assert.equal(slidesPdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((slidesPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, deck.slides.length);

  const allPngResult = await client.callTool({ name: 'render_slides_png', arguments: { data: deck, output_dir: outputDir, filename_prefix: 'deck' } });
  assert.notEqual(allPngResult.isError, true);
  for (let index = 1; index <= deck.slides.length; index++) {
    const slidePng = await readFile(join(outputDir, `deck-${String(index).padStart(2, '0')}.png`));
    assert.equal(slidePng.subarray(1, 4).toString(), 'PNG');
    assert.equal(slidePng.readUInt32BE(16), 1600);
    assert.equal(slidePng.readUInt32BE(20), 900);
  }
  const singlePngResult = await client.callTool({ name: 'render_slides_png', arguments: { data: deck, slide_index: 2, output_dir: outputDir, filename_prefix: 'single' } });
  assert.notEqual(singlePngResult.isError, true);
  assert.deepEqual((await readdir(outputDir)).filter((name) => name.startsWith('single-')), ['single-03.png']);

  const pptxPath = join(outputDir, 'slides.pptx');
  const pptxResult = await client.callTool({ name: 'render_slides_pptx', arguments: { data: deck, output_path: pptxPath } });
  assert.notEqual(pptxResult.isError, true, JSON.stringify(pptxResult.content));
  const pptx = await readFile(pptxPath);
  assert.equal(pptx.subarray(0, 2).toString(), 'PK');
  const archive = unzipSync(pptx);
  assert.equal(Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, deck.slides.length);
  assert.ok(Buffer.from(archive['ppt/slides/slide1.xml']).toString().includes('Wyniki kwartalne'));
} finally {
  await client.close();
  await rm(outputDir, { recursive: true, force: true });
}

process.stdout.write('public behavior: A4 report and PDF/PNG/PPTX slide exports OK\n');
