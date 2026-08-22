import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { unzipSync } from 'fflate';
import { writePublicBrandFixture } from './lib/fixtures.mjs';
import { runProcess } from './lib/process.mjs';

const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-test-'));
const brandDir = join(outputDir, 'brands');
await writePublicBrandFixture(brandDir);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [process.env.REPORT_BABY_TEST_BUNDLE ?? 'bundle.cjs'],
  cwd: process.cwd(),
  env: { ...process.env, REPORT_BABY_DATA: outputDir, REPORT_BABY_BRAND_DIR: brandDir },
  stderr: 'pipe',
});
const client = new Client({ name: 'report-baby-public-test', version: '1.0.0' });

try {
  await client.connect(transport);

  const brandbooks = await client.callTool({ name: 'list_brandbooks', arguments: {} });
  assert.notEqual(brandbooks.isError, true);
  assert.match(brandbooks.content?.[0]?.text ?? '', /acme/);
  const inspected = await client.callTool({ name: 'inspect_brand', arguments: { brand_ref: 'brand://acme/primary' } });
  assert.notEqual(inspected.isError, true, JSON.stringify(inspected.content));
  assert.match(inspected.content?.[0]?.text ?? '', /#ff6600/i);

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
      brand_ref: 'brand://acme/primary',
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

  const editorialPdfPath = join(outputDir, 'editorial-report.pdf');
  const editorialReport = await client.callTool({
    name: 'render_report',
    arguments: {
      template: 'pages/editorial-two-column',
      output_path: editorialPdfPath,
      brand_ref: 'brand://acme/primary',
      data: {
        title: 'Editorial page template',
        intro: 'The page geometry comes from a built-in page template rather than from the default report constants.',
        sections: [{ heading: 'Configured flow', body: 'This paragraph crosses the configured measure when the renderer advances from the first column to the second. '.repeat(30) }],
        highlights: ['Two explicit columns', 'A template-owned gutter'],
        footer: 'Editorial page test',
      },
    },
  });
  assert.notEqual(editorialReport.isError, true, JSON.stringify(editorialReport.content));
  const editorialPdf = await readFile(editorialPdfPath);
  assert.equal(editorialPdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(editorialPdf.length > 10_000);

  const splitPdfPath = join(outputDir, 'section-split.pdf');
  const splitMarker = 'SECTION_SPLIT_MARKER';
  const splitReport = await client.callTool({
    name: 'render_report',
    arguments: {
      output_path: splitPdfPath,
      brand_ref: 'brand://acme/primary',
      data: {
        title: 'Section split header test',
        intro: 'The next section is intentionally long enough to cross a page boundary.',
        sections: [{ heading: 'One section, two pages', body: `${splitMarker} ${'This paragraph is deliberately long so the renderer must continue it on the next page. '.repeat(220)}` }],
        footer: 'Section split footer',
      },
    },
  });
  assert.notEqual(splitReport.isError, true, JSON.stringify(splitReport.content));
  const splitPdf = await readFile(splitPdfPath);
  const splitPdfText = splitPdf.toString('latin1');
  assert.ok((splitPdfText.match(/\/Type \/Page\b/g) ?? []).length >= 3, 'a long single section did not create at least three PDF pages');
  assert.ok(splitPdf.length > 20_000, 'the long section produced an unexpectedly small PDF');
    const extractedSplitText = runProcess('pdftotext', [splitPdfPath, '-'], { timeout: 10_000 });
  if (extractedSplitText.status === 0) {
    const splitPages = extractedSplitText.stdout.split('\f');
    assert.ok(splitPages.length >= 2, 'pdftotext did not expose the split report pages');
    assert.match(splitPages[1], /Section split header test/, 'the report title is not repeated on the second page');
    assert.match(splitPages[1], /Section split footer\s*2\s*\/\s*/, 'the repeated page is missing its footer and page number');
  }

  const tableSplitPdfPath = join(outputDir, 'table-split.pdf');
  const tableSplitReport = await client.callTool({
    name: 'render_report',
    arguments: {
      output_path: tableSplitPdfPath,
      brand_ref: 'brand://acme/primary',
      data: {
        title: 'Table pagination test',
        table: {
          head: ['Region', 'Result'],
          body: Array.from({ length: 70 }, (_, index) => [`Region ${index + 1}`, `${index + 100}`]),
        },
        footer: 'Table pagination test',
      },
    },
  });
  assert.notEqual(tableSplitReport.isError, true, JSON.stringify(tableSplitReport.content));
  const tableSplitPdf = await readFile(tableSplitPdfPath);
  assert.ok((tableSplitPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 3, 'a long table did not create at least three PDF pages');
    const extractedTableText = runProcess('pdftotext', [tableSplitPdfPath, '-'], { timeout: 10_000 });
  if (extractedTableText.status === 0) {
    const tablePages = extractedTableText.stdout.split('\f');
    assert.ok(tablePages.slice(0, -1).every((page) => page.includes('Region') && page.includes('Result')), 'the table header was not repeated on every table page');
    assert.ok(tablePages.slice(0, -1).every((page) => page.includes('Table pagination test')), 'the repeated report header was not drawn on every table page');
  }

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
  deck.slides[4].overrides = { typography: { body: { scale: 0.9 } }, layout: { density: 'compact' } };

  const slidesPdfPath = join(outputDir, 'slides.pdf');
  const slidesPdfResult = await client.callTool({ name: 'render_slides_pdf', arguments: { brand_ref: 'brand://acme/primary', data: deck, output_path: slidesPdfPath } });
  assert.notEqual(slidesPdfResult.isError, true, JSON.stringify(slidesPdfResult.content));
  const slidesPdf = await readFile(slidesPdfPath);
  assert.equal(slidesPdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((slidesPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, deck.slides.length);

  const allPngResult = await client.callTool({ name: 'render_slides_png', arguments: { brand_ref: 'brand://acme/primary', data: deck, output_dir: outputDir, filename_prefix: 'deck' } });
  assert.notEqual(allPngResult.isError, true);
  for (let index = 1; index <= deck.slides.length; index++) {
    const slidePng = await readFile(join(outputDir, `deck-${String(index).padStart(2, '0')}.png`));
    assert.equal(slidePng.subarray(1, 4).toString(), 'PNG');
    assert.equal(slidePng.readUInt32BE(16), 1600);
    assert.equal(slidePng.readUInt32BE(20), 900);
  }
  const singlePngResult = await client.callTool({ name: 'render_slides_png', arguments: { brand_ref: 'brand://acme/primary', data: deck, slide_index: 2, output_dir: outputDir, filename_prefix: 'single' } });
  assert.notEqual(singlePngResult.isError, true);
  assert.deepEqual((await readdir(outputDir)).filter((name) => name.startsWith('single-')), ['single-03.png']);

  const templateListing = await client.callTool({ name: 'list_templates', arguments: { brand_ref: 'brand://acme/primary' } });
  assert.notEqual(templateListing.isError, true, JSON.stringify(templateListing.content));
  const listedTemplates = JSON.parse(templateListing.content?.[0]?.text ?? '{}').templates ?? [];
  const listedRefs = new Map(listedTemplates.map((template) => [template.template_ref, template]));
  assert.equal(listedRefs.get('default-report')?.owner, 'builtin', 'list_templates lost the built-in report templates');
  assert.ok(listedRefs.get('default-report')?.use_with?.includes('render_report'));
  for (const slideTemplate of ['slides/standard', 'slides/compact', 'slides/centered-title', 'slides/two-column']) {
    const entry = listedRefs.get(slideTemplate);
    assert.ok(entry, `list_templates does not expose the built-in slide template ${slideTemplate}`);
    assert.equal(entry.owner, 'builtin');
    assert.equal(entry.kind, 'slide');
    assert.ok(entry.use_with.includes('render_slides_pptx'), 'slide templates must say which tools accept them');
  }
  assert.equal(listedRefs.get('slides/primary')?.owner, 'brand', 'brand-owned templates are not tagged as brand-owned');
  assert.equal(templateListing.structuredContent, undefined, 'list_templates duplicates its whole listing in structuredContent');

  const columnsDeck = {
    title: 'Dwie kolumny',
    brand: 'TreeTank',
    footer: 'Poufne',
    slides: [
      {
        type: 'columns',
        title: 'Co zadziałało, a co nie',
        subtitle: 'Porównanie kwartałów',
        template_ref: 'slides/two-column',
        columns: [
          { heading: 'Zadziałało', body: 'Ruch z SEO rośnie trzeci kwartał z rzędu.', highlights: ['Więcej treści', 'Lepsze linki'] },
          { heading: 'Do poprawy', body: 'Koszt pozyskania w kampaniach display pozostaje wysoki.', highlights: ['Zawężyć grupy odbiorców'] },
        ],
      },
      {
        type: 'columns',
        title: 'Bez wskazania szablonu',
        columns: [
          { body: 'Lewa kolumna bez nagłówka.' },
          { body: 'Prawa kolumna bez nagłówka.' },
        ],
      },
    ],
  };
  const columnsPdfPath = join(outputDir, 'columns.pdf');
  const columnsPdfResult = await client.callTool({ name: 'render_slides_pdf', arguments: { brand_ref: 'brand://acme/primary', data: columnsDeck, output_path: columnsPdfPath } });
  assert.notEqual(columnsPdfResult.isError, true, JSON.stringify(columnsPdfResult.content));
  const columnsPdf = await readFile(columnsPdfPath);
  assert.equal(columnsPdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((columnsPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, columnsDeck.slides.length);
  const columnsSummary = columnsPdfResult.structuredContent ?? {};
  assert.equal(columnsSummary.slidePlans, undefined, 'the default response still carries per-slide layout plans');
  assert.equal(columnsSummary.slideDiagnostics, undefined, 'the default response still carries per-slide diagnostics');
  assert.equal(columnsSummary.appliedOverrides, undefined, 'the default response still carries an empty appliedOverrides collection');
  assert.equal(columnsSummary.slideCount, columnsDeck.slides.length, 'the summary response lost the slide count');
  assert.equal(columnsSummary.brandRef, 'brand://acme/primary', 'the summary response lost the resolved brand reference');
  assert.deepEqual(new Set(columnsSummary.templateRefs ?? [columnsSummary.templateRef]), new Set(['slides/two-column', 'slides/standard']), 'the summary response lost the resolved template references');
  assert.ok(JSON.stringify(columnsSummary).length < 400, `the summary response is too large: ${JSON.stringify(columnsSummary).length} chars`);

  const columnsFullResult = await client.callTool({ name: 'render_slides_pdf', arguments: { brand_ref: 'brand://acme/primary', data: columnsDeck, output_path: columnsPdfPath, diagnostics: 'full' } });
  assert.notEqual(columnsFullResult.isError, true, JSON.stringify(columnsFullResult.content));
  const columnsPlans = columnsFullResult.structuredContent?.slidePlans ?? [];
  assert.equal(columnsPlans[0]?.slideType, 'columns', 'the columns slide type did not survive the tool schema');
  assert.equal(columnsPlans[0]?.templateRef, 'slides/two-column', 'the two-column template was not applied to the columns slide');
  assert.ok(columnsPlans[1]?.slotRules, 'a columns slide without template_ref did not get a slide plan');
  assert.ok(Array.isArray(columnsFullResult.structuredContent?.slideDiagnostics), 'diagnostics: full did not return per-slide diagnostics');

  const columnsPngResult = await client.callTool({ name: 'render_slides_png', arguments: { brand_ref: 'brand://acme/primary', data: columnsDeck, output_dir: outputDir, filename_prefix: 'columns' } });
  assert.notEqual(columnsPngResult.isError, true, JSON.stringify(columnsPngResult.content));
  for (let index = 1; index <= columnsDeck.slides.length; index++) {
    const columnsPng = await readFile(join(outputDir, `columns-${String(index).padStart(2, '0')}.png`));
    assert.equal(columnsPng.subarray(1, 4).toString(), 'PNG');
    assert.equal(columnsPng.readUInt32BE(16), 1600);
    assert.equal(columnsPng.readUInt32BE(20), 900);
  }

  const columnsPptxPath = join(outputDir, 'columns.pptx');
  const columnsPptxResult = await client.callTool({ name: 'render_slides_pptx', arguments: { brand_ref: 'brand://acme/primary', data: columnsDeck, output_path: columnsPptxPath } });
  assert.notEqual(columnsPptxResult.isError, true, JSON.stringify(columnsPptxResult.content));
  const columnsArchive = unzipSync(await readFile(columnsPptxPath));
  const columnsSlideXml = Buffer.from(columnsArchive['ppt/slides/slide1.xml']).toString();
  assert.ok(columnsSlideXml.includes('Zadziałało'), 'the PPTX columns slide lost its editable column text');

  const coverPdfPath = join(outputDir, 'title-page.pdf');
  const coverReport = await client.callTool({
    name: 'render_report',
    arguments: {
      output_path: coverPdfPath,
      brand_ref: 'brand://acme/primary',
      data: {
        title_page: { eyebrow: 'Raport kwartalny', title: 'Wyniki marketingu', subtitle: 'Q3 2026', period: 'lipiec–wrzesień' },
        title: 'Wyniki marketingu',
        sections: [{ heading: 'Podsumowanie', body: 'Treść raportu zaczyna się na drugiej stronie.' }],
        footer: 'Poufne',
      },
    },
  });
  assert.notEqual(coverReport.isError, true, JSON.stringify(coverReport.content));
  const coverPdf = await readFile(coverPdfPath);
  assert.equal(coverPdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((coverPdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 2, 'title_page did not add a cover page before the body');
    const extractedCoverText = runProcess('pdftotext', [coverPdfPath, '-'], { timeout: 10_000 });
  if (extractedCoverText.status === 0) {
    const coverPages = extractedCoverText.stdout.split('\f');
    assert.match(coverPages[0], /Wyniki marketingu/, 'the cover page is missing its title');
    assert.match(coverPages[0], /RAPORT KWARTALNY/, 'the cover page is missing its eyebrow');
    assert.match(coverPages[1], /Podsumowanie/, 'the report body does not start on the second page');
  }

  const validTemplateRef = await client.callTool({
    name: 'render_report',
    arguments: {
      output_path: join(outputDir, 'campaign-summary.pdf'),
      template_ref: 'campaign-summary',
      data: { highlights: ['Szablon kampanijny nadal działa'] },
    },
  });
  assert.notEqual(validTemplateRef.isError, true, JSON.stringify(validTemplateRef.content));
  const campaignPdf = await readFile(join(outputDir, 'campaign-summary.pdf'));
  assert.equal(campaignPdf.subarray(0, 5).toString(), '%PDF-');

  const badTemplateRef = await client.callTool({
    name: 'render_report',
    arguments: {
      template_ref: 'slides/qbr/executive-summary',
      data: { title: 'Nieistniejący szablon' },
    },
  });
  assert.equal(badTemplateRef.isError, true, 'render_report accepted a slide composition reference as a report template');
  const badTemplateText = badTemplateRef.content?.[0]?.text ?? '';
  assert.match(badTemplateText, /slides\/qbr\/executive-summary/, 'the rejection does not name the offending reference');
  assert.match(badTemplateText, /default-report/, 'the rejection does not list the valid report templates');
  assert.match(badTemplateText, /campaign-summary/, 'the rejection does not list the valid report templates');
  assert.match(badTemplateText, /render_slides_pdf/, 'the rejection does not point at the slide render tools');

  const pptxPath = join(outputDir, 'slides.pptx');
  const pptxResult = await client.callTool({ name: 'render_slides_pptx', arguments: { brand_ref: 'brand://acme/primary', data: deck, output_path: pptxPath } });
  assert.notEqual(pptxResult.isError, true, JSON.stringify(pptxResult.content));
  const pptx = await readFile(pptxPath);
  assert.equal(pptx.subarray(0, 2).toString(), 'PK');
  const archive = unzipSync(pptx);
  assert.equal(Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, deck.slides.length);
  assert.ok(Buffer.from(archive['ppt/slides/slide1.xml']).toString().includes('Wyniki kwartalne'));

  const firstNote = 'Zacznij od kontekstu: wzrost & jakość ruchu <bez> przesady.';
  const secondNote = 'Przejdź do wniosków i zaproponuj budżet na kolejny kwartał.';
  const notesDeck = {
    title: 'Notatki prelegenta',
    brand: 'TreeTank',
    footer: 'Poufne',
    slides: [
      { type: 'title', title: 'Notatki prelegenta', subtitle: 'Wersja zarządcza', notes: firstNote },
      { type: 'conclusions', title: 'Wnioski', items: ['Skalować SEO'], notes: secondNote },
      { type: 'narrative', title: 'Bez notatki', body: 'Ten slajd nie ma narracji.' },
    ],
  };

  const notesPptxPath = join(outputDir, 'notes.pptx');
  const notesPptxResult = await client.callTool({ name: 'render_slides_pptx', arguments: { brand_ref: 'brand://acme/primary', data: notesDeck, output_path: notesPptxPath } });
  assert.notEqual(notesPptxResult.isError, true, JSON.stringify(notesPptxResult.content));
  const notesArchive = unzipSync(await readFile(notesPptxPath));
  assert.ok(notesArchive['ppt/notesSlides/notesSlide1.xml'], 'the PPTX has no notes slide part for the first slide');
  const firstNotesXml = Buffer.from(notesArchive['ppt/notesSlides/notesSlide1.xml']).toString();
  assert.match(firstNotesXml, /<p:notes[\s>]/, 'the notes slide part is not a p:notes document');
  assert.ok(firstNotesXml.includes('Zacznij od kontekstu: wzrost &amp; jakość ruchu &lt;bez&gt; przesady.'), `the speaker notes text is missing from notesSlide1.xml: ${firstNotesXml.slice(0, 400)}`);
  assert.ok(Buffer.from(notesArchive['ppt/notesSlides/notesSlide2.xml']).toString().includes(secondNote), 'the second slide lost its speaker notes');
  const thirdNotesXml = Buffer.from(notesArchive['ppt/notesSlides/notesSlide3.xml']).toString();
  assert.ok(!thirdNotesXml.includes('narracji'), 'a slide without notes received notes text');
  const firstSlideRels = Buffer.from(notesArchive['ppt/slides/_rels/slide1.xml.rels']).toString();
  assert.match(firstSlideRels, /Target="\.\.\/notesSlides\/notesSlide1\.xml"/, 'slide1 does not reference its notes slide');
  assert.match(firstSlideRels, /relationships\/notesSlide"/, 'the slide → notes relationship type is missing');
  assert.match(Buffer.from(notesArchive['ppt/notesSlides/_rels/notesSlide1.xml.rels']).toString(), /notesMaster1\.xml/, 'the notes slide does not reference the notes master');
  assert.match(Buffer.from(notesArchive['[Content_Types].xml']).toString(), /notesSlides\/notesSlide1\.xml/, 'the notes slide part has no content-type override');
  assert.ok(!Buffer.from(notesArchive['ppt/slides/slide1.xml']).toString().includes('Zacznij od kontekstu'), 'speaker notes leaked into the visible slide');
  assert.equal(notesPptxResult.structuredContent?.notesSlides, 2, 'the PPTX response does not report how many slides carry notes');
  assert.ok(!(notesPptxResult.structuredContent?.warnings ?? []).some((warning) => /notes/i.test(warning.message)), 'the PPTX response warns about notes it actually carried');

  const notesPdfPath = join(outputDir, 'notes.pdf');
  const notesPdfResult = await client.callTool({ name: 'render_slides_pdf', arguments: { brand_ref: 'brand://acme/primary', data: notesDeck, output_path: notesPdfPath } });
  assert.notEqual(notesPdfResult.isError, true, JSON.stringify(notesPdfResult.content));
  const notesPdf = await readFile(notesPdfPath);
  assert.equal(notesPdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(notesPdfResult.structuredContent?.notesSlides, 2, 'the PDF response does not report the notes it received');
  const droppedNotesWarning = (notesPdfResult.structuredContent?.warnings ?? []).find((warning) => /notes/i.test(warning.message));
  assert.ok(droppedNotesWarning, 'the PDF response silently dropped the speaker notes');
  assert.equal(droppedNotesWarning.slides, 2, 'the dropped-notes warning does not count the affected slides');
  assert.match(droppedNotesWarning.message, /render_slides_pptx/, 'the dropped-notes warning does not name the format that keeps notes');
    const extractedNotesText = runProcess('pdftotext', [notesPdfPath, '-'], { timeout: 10_000 });
  if (extractedNotesText.status === 0) {
    assert.ok(!extractedNotesText.stdout.includes('Zacznij od kontekstu'), 'speaker notes were printed onto the slide PDF');
  }

  const notesPngResult = await client.callTool({ name: 'render_slides_png', arguments: { brand_ref: 'brand://acme/primary', data: notesDeck, output_dir: outputDir, filename_prefix: 'notes' } });
  assert.notEqual(notesPngResult.isError, true, JSON.stringify(notesPngResult.content));
  assert.ok((notesPngResult.structuredContent?.warnings ?? []).some((warning) => /notes/i.test(warning.message)), 'the PNG response silently dropped the speaker notes');

  const overlongNotes = await client.callTool({
    name: 'render_slides_pptx',
    arguments: {
      brand_ref: 'brand://acme/primary',
      output_path: join(outputDir, 'overlong-notes.pptx'),
      data: { title: 'Za długie notatki', slides: [{ type: 'narrative', title: 'Slajd', body: 'Treść.', notes: 'x'.repeat(4001) }] },
    },
  });
  assert.equal(overlongNotes.isError, true, 'the slide model accepted notes beyond its documented bound');
} finally {
  await client.close();
  await rm(outputDir, { recursive: true, force: true });
}

process.stdout.write('public behavior: A4 report and PDF/PNG/PPTX slide exports OK\n');
