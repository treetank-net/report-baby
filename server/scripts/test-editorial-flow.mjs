import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const brandDir = join(root, '..', 'examples', 'brand-showcase', 'brands');
const baseBody = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny przewozow dlugodystansowych. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow. Ten raport podsumowuje najwazniejsze obserwacje z ostatniego kwartalu i wskazuje kierunki na kolejne miesiace.';
const twoSentenceBody = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny.';

function section(heading, body = baseBody, level) {
  return { heading, body, ...(level === undefined ? {} : { level }) };
}

const reproducers = [
  {
    name: 'reproducer-A-intro',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Test zawijania tekstu',
        period: 'VIII 2026',
        intro: 'Sprawdzenie przeplywu tekstu na normalnej prozie, bez powtarzanych fraz.',
        sections: [section('Rynek'), section('Wnioski')],
        footer: 'test zawijania',
      },
    },
  },
  {
    name: 'reproducer-B-four-sections',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Matryca pierwszej linii',
        sections: [
          section('A_drogowy', twoSentenceBody),
          section('B_obserwuje', twoSentenceBody.replace('Transport drogowy', 'Transport obserwuje')),
          section('C_krotkie', twoSentenceBody.replace('Transport drogowy', 'Rynek ma')),
          section('D_dlugie', twoSentenceBody.replace('Transport drogowy', 'Transportochlonnosc gospodarki')),
        ],
        footer: 'matryca',
      },
    },
  },
  {
    name: 'reproducer-C-table-flow',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Tabela w przeplywie',
        sections: Array.from({ length: 4 }, (_, index) => section(`S${index + 1}`, `${twoSentenceBody} ${twoSentenceBody} ${twoSentenceBody} ${twoSentenceBody}`)),
        table: {
          head: ['Wskaznik', 'Wartosc'],
          body: [['Pozycja 1', '11'], ['Pozycja 2', '22'], ['Pozycja 3', '33'], ['Pozycja 4', '44'], ['Pozycja 5', '55'], ['Pozycja 6', '66']],
          caption: 'Dane',
        },
        footer: 'repro-tabela',
      },
    },
  },
  {
    name: 'reproducer-D-highlights-flow',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Highlights w przeplywie',
        sections: Array.from({ length: 4 }, (_, index) => section(`S${index + 1}`, `${twoSentenceBody} ${twoSentenceBody} ${twoSentenceBody}`)),
        highlights: [
          'Wniosek 1 o pewnej dlugosci tekstu',
          'Wniosek 2 o pewnej dlugosci tekstu',
          'Wniosek 3 o pewnej dlugosci tekstu',
          'Wniosek 4 o pewnej dlugosci tekstu',
          'Wniosek 5 o pewnej dlugosci tekstu',
        ],
        footer: 'repro-highlights',
      },
    },
  },
];

const matrixFixtures = [];
let matrixIndex = 0;
const blockVariants = [
  { name: 'plain', tableRows: 0, highlights: false },
  { name: 'table-2', tableRows: 2, highlights: false },
  { name: 'table-6', tableRows: 6, highlights: false },
  { name: 'table-20', tableRows: 20, highlights: false },
  { name: 'highlights', tableRows: 0, highlights: true },
  { name: 'both-2', tableRows: 2, highlights: true },
  { name: 'both-6', tableRows: 6, highlights: true },
  { name: 'both-20', tableRows: 20, highlights: true },
];
for (const hasIntro of [false, true]) {
  for (const sectionCount of [1, 2, 4, 8]) {
    for (const length of ['short', 'boundary', 'long']) {
      for (const blockVariant of blockVariants) {
        matrixIndex += 1;
        const marker = `M${String(matrixIndex).padStart(2, '0')}`;
        const repeatCount = length === 'short' ? 1 : length === 'boundary' ? 3 : 8;
        const bodySeed = length === 'short' ? twoSentenceBody : baseBody;
        const sections = Array.from({ length: sectionCount }, (_, index) => {
          const heading = `${marker}_S${index + 1}`;
          const body = `Dane ${marker} ${bodySeed} `.repeat(repeatCount).trim();
          return section(heading, body, sectionCount > 1 && index === sectionCount - 1 ? 2 : undefined);
        });
        const data = {
          title: `Editorial matrix ${marker}`,
          ...(hasIntro ? { intro: `Intro ${marker} sprawdza odzyskanie szerokosci po poprzednim bloku.` } : {}),
          sections,
          ...(blockVariant.tableRows > 0 ? {
            table: {
              head: ['Kanal', 'Wynik'],
              body: Array.from({ length: blockVariant.tableRows }, (_, row) => [`Pozycja ${row + 1}`, `${row + 11}`]),
              caption: `Tabela ${marker}`,
            },
          } : {}),
          ...(blockVariant.highlights ? {
            highlights: [`Wniosek ${marker} pierwszy`, `Wniosek ${marker} drugi`],
            highlights_title: `Najwazniejsze ${marker}`,
          } : {}),
          footer: `matrix ${marker}`,
        };
        matrixFixtures.push({
          name: `matrix-${marker}-${hasIntro ? 'intro' : 'no-intro'}-${sectionCount}-${length}-${blockVariant.name}`,
          input: { template: 'pages/editorial-two-column', brand_ref: 'brand://flux/primary', data },
        });
      }
    }
  }
}

function normalize(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function parseBbox(xml) {
  return [...xml.matchAll(/<page width="([0-9.]+)" height="([0-9.]+)">([\s\S]*?)<\/page>/g)].map((pageMatch, pageIndex) => {
    const width = Number(pageMatch[1]);
    const height = Number(pageMatch[2]);
    const words = [...pageMatch[3].matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]*)<\/word>/g)]
      .map((match) => ({ pageIndex, xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]), text: match[5], token: normalize(match[5]) }));
    const footer = words.filter((word) => word.text === '/').sort((a, b) => b.yMin - a.yMin)[0];
    assert.ok(footer, `page ${pageIndex + 1}: footer page number not found; cannot measure usable column bottom`);
    const lines = [];
    for (const word of words.sort((left, right) => left.xMin - right.xMin || left.yMin - right.yMin)) {
      const column = word.xMin < width / 2 ? 0 : 1;
      const line = lines.find((candidate) => candidate.column === column && Math.abs(candidate.yMin - word.yMin) <= 0.2);
      if (line) line.words.push(word);
      else lines.push({ pageIndex, column, yMin: word.yMin, words: [word] });
    }
    const normalizedLines = lines.map((line) => ({
      ...line,
      words: line.words.sort((left, right) => left.xMin - right.xMin),
      xMin: Math.min(...line.words.map((word) => word.xMin)),
      xMax: Math.max(...line.words.map((word) => word.xMax)),
      text: line.words.map((word) => word.text).join(' '),
      tokens: line.words.map((word) => word.token),
    })).sort((left, right) => left.column - right.column || left.yMin - right.yMin);
    return { pageIndex, width, height, words, lines: normalizedLines, footerY: footer.yMin };
  });
}

function bodyTokens(input) {
  const body = (input.data.sections ?? []).flatMap((sectionData) => sectionData.body.split(/\s+/).map(normalize));
  const nonBody = [
    input.data.title,
    input.data.subtitle,
    input.data.brand,
    input.data.period,
    input.data.intro,
    input.data.footer,
    input.data.highlights_title,
    ...(input.data.highlights ?? []),
    input.data.table?.caption,
    ...(input.data.table?.head ?? []),
    ...(input.data.table?.body ?? []).flat(),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize));
  const nonBodyTokens = new Set(nonBody);
  return new Set(body.filter((token) => !nonBodyTokens.has(token)));
}

function contentTokens(input) {
  const data = input.data;
  const content = [
    data.intro,
    ...(data.sections ?? []).flatMap((sectionData) => [sectionData.heading, sectionData.body]),
    data.highlights_title,
    ...(data.highlights ?? []),
    data.table?.caption,
    ...(data.table?.head ?? []),
    ...(data.table?.body ?? []).flat(),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize));
  const chrome = [data.title, data.subtitle, data.brand, data.period, data.footer]
    .filter(Boolean)
    .flatMap((value) => String(value).split(/\s+/).map(normalize));
  const chromeTokens = new Set(chrome);
  return new Set(content.filter((token) => !chromeTokens.has(token)));
}

function contentLines(page, input) {
  const expected = contentTokens(input);
  return page.lines
    .map((line) => ({
      ...line,
      contentWords: line.words.filter((word) => expected.has(word.token) && word.yMin < page.footerY),
    }))
    .filter((line) => line.contentWords.length > 0);
}

function sectionHeadingLine(pages, heading) {
  const token = normalize(heading);
  return pages.flatMap((page) => page.lines).find((line) => line.tokens.includes(token));
}

function firstBodyLine(pages, sectionData) {
  const headingLine = sectionHeadingLine(pages, sectionData.heading);
  assert.ok(headingLine, `heading '${sectionData.heading}' was not found in PDF`);
  const first = normalize(sectionData.body.split(/\s+/)[0]);
  const headingOrder = headingLine.pageIndex * 1000000 + headingLine.column * 100000 + headingLine.yMin;
  const candidates = pages.flatMap((page) => page.lines)
    .filter((line) => line.tokens.includes(first))
    .filter((line) => line.pageIndex * 1000000 + line.column * 100000 + line.yMin > headingOrder)
    .sort((left, right) => left.pageIndex * 1000000 + left.column * 100000 + left.yMin - (right.pageIndex * 1000000 + right.column * 100000 + right.yMin));
  assert.ok(candidates.length > 0, `first body word '${first}' for '${sectionData.heading}' was not found after heading`);
  return candidates[0];
}

function assertNoOrphanedFirstLines(pages, input) {
  const gaps = pages.flatMap((page) => page.lines.flatMap((line) => line.words.slice(1).map((word, index) => word.xMin - line.words[index].xMax)));
  const wordGap = median(gaps) ?? 4;
  for (const sectionData of input.data.sections ?? []) {
    const line = firstBodyLine(pages, sectionData);
    if (line.words.length !== 1) continue;
    const first = normalize(sectionData.body.split(/\s+/)[0]);
    const second = normalize(sectionData.body.split(/\s+/)[1]);
    const lineOrder = line.pageIndex * 1000000 + line.column * 100000 + line.yMin;
    const secondWord = pages.flatMap((page) => page.words)
      .filter((word) => word.pageIndex === line.pageIndex && (word.xMin < pages[line.pageIndex].width / 2) === (line.column === 0))
      .filter((word) => word.pageIndex * 1000000 + line.column * 100000 + word.yMin >= lineOrder)
      .find((word) => word.token === second);
    assert.ok(secondWord, `second body word '${second}' for '${sectionData.heading}' was not found`);
    const page = pages[line.pageIndex];
    const columnRight = line.column === 0 ? page.width / 2 : page.width - Math.min(...page.words.filter((word) => word.xMin < page.width / 2).map((word) => word.xMin));
    const fits = line.xMax + wordGap + (secondWord.xMax - secondWord.xMin) <= columnRight;
    assert.ok(!fits, `orphaned first line in '${sectionData.heading}': '${first}' is alone although the next word fits`);
  }
}

function assertColumnBreaksFillTheColumn(pages, input) {
  if (input.data.intro) return;
  const blockTokens = new Set([
    input.data.highlights_title,
    ...(input.data.highlights ?? []),
    input.data.table?.caption,
    ...(input.data.table?.head ?? []),
    ...(input.data.table?.body ?? []).flat(),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize)));
  for (const page of pages) {
    const bodyLines = contentLines(page, input).map((line) => ({ ...line, bodyWords: line.contentWords }));
    const left = bodyLines.filter((line) => line.column === 0);
    const right = bodyLines.filter((line) => line.column === 1);
    if (left.length === 0 || right.length === 0) continue;
    if (right.some((line) => line.tokens.some((token) => blockTokens.has(token)))) continue;
    const leftY = left.flatMap((line) => line.bodyWords.map((word) => word.yMax));
    const lineDeltas = [...new Set(bodyLines.map((line) => line.column))].flatMap((column) => {
      const columnLines = bodyLines.filter((line) => line.column === column).sort((leftLine, rightLine) => leftLine.yMin - rightLine.yMin);
      return columnLines.slice(1).map((line, index) => line.yMin - columnLines[index].yMin);
    });
    const lineHeight = median(lineDeltas);
    if (!lineHeight) continue;
    // Leave one derived line of clearance for the footer glyphs; the
    // remaining gap is the actual unused column space being tested.
    const usableBottom = page.footerY - lineHeight;
    const gap = usableBottom - Math.max(...leftY);
    assert.ok(gap <= lineHeight * 2.5, `page ${page.pageIndex + 1}: left column broke ${gap.toFixed(2)}pt before footer, more than 2.5 lines (${lineHeight.toFixed(2)}pt)`);
  }
}

function assertNoEmptyContentColumns(pages, input) {
  for (const page of pages.slice(0, -1)) {
    const lines = contentLines(page, input);
    const left = lines.filter((line) => line.column === 0);
    const right = lines.filter((line) => line.column === 1);
    assert.ok(left.length > 0 && right.length > 0, `page ${page.pageIndex + 1}: content columns are unbalanced (${left.length} left lines, ${right.length} right lines)`);
  }
}

function assertTablesDoNotStartInAnEmptyColumn(pages, input) {
  const table = input.data.table;
  if (!table) return;
  const tableTokens = new Set([
    table.caption,
    ...table.head,
    ...table.body.flat(),
  ].filter(Boolean).map((value) => normalize(value)));
  for (const page of pages) {
    const lines = contentLines(page, input);
    const tableLines = lines.filter((line) => line.tokens.some((token) => tableTokens.has(token)));
    if (tableLines.length === 0) continue;
    const hasLeftContent = lines.some((line) => line.column === 0);
    const hasRightTable = tableLines.some((line) => line.column === 1);
    assert.ok(hasLeftContent || !hasRightTable, `page ${page.pageIndex + 1}: table content starts in the right column while the left column is empty`);
  }
  for (const value of table.body.map((row) => row[0])) {
    const token = normalize(String(value).split(/\s+/)[0]);
    assert.ok(pages.some((page) => page.words.some((word) => word.token === token)), `table row '${value}' is missing from the rendered PDF`);
  }
}

function assertNoInternalColumnHoles(pages, input) {
  const headingTokens = new Set((input.data.sections ?? []).map((sectionData) => normalize(sectionData.heading)));
  const introTokens = new Set(String(input.data.intro ?? '').split(/\s+/).map(normalize));
  const tableBoundaryTokens = new Set([
    input.data.table?.caption,
    ...(input.data.table?.head ?? []),
  ].filter(Boolean).map((value) => normalize(value)));
  for (const page of pages) {
    const lines = contentLines(page, input);
    const deltas = lines.flatMap((line) => {
      const columnLines = lines.filter((candidate) => candidate.column === line.column).sort((left, right) => left.yMin - right.yMin);
      const index = columnLines.indexOf(line);
      return index > 0 ? [line.yMin - columnLines[index - 1].yMin] : [];
    });
    const lineHeight = median(deltas);
    if (!lineHeight) continue;
    for (const column of [0, 1]) {
      const columnLines = lines.filter((line) => line.column === column).sort((left, right) => left.yMin - right.yMin);
      for (let index = 1; index < columnLines.length; index += 1) {
        const gap = columnLines[index].yMin - columnLines[index - 1].yMin;
        if (
          columnLines[index - 1].tokens.some((token) => headingTokens.has(token) || tableBoundaryTokens.has(token))
          || columnLines[index].tokens.some((token) => headingTokens.has(token) || tableBoundaryTokens.has(token))
          || columnLines[index - 1].tokens.some((token) => introTokens.has(token))
          || columnLines[index].tokens.some((token) => introTokens.has(token))
        ) continue;
        assert.ok(gap <= lineHeight * 2.5, `page ${page.pageIndex + 1}, column ${column + 1}: internal content gap ${gap.toFixed(2)}pt exceeds 2.5 lines (${lineHeight.toFixed(2)}pt): '${columnLines[index - 1].text}' -> '${columnLines[index].text}'`);
      }
    }
  }
}

async function renderAndMeasure(name, input, workDir) {
  const outputPath = join(workDir, `${name}.pdf`);
  const renderResult = await execFileAsync(process.execPath, ['cli-bundle.cjs', 'render_report', JSON.stringify({ ...input, output_path: outputPath })], {
    cwd: root,
    env: { ...process.env, REPORT_BABY_DATA: workDir, REPORT_BABY_BRAND_DIR: brandDir },
    maxBuffer: 1024 * 1024,
  });
  const { stdout } = await execFileAsync('pdftotext', [outputPath, '-']);
  const { stdout: bbox } = await execFileAsync('pdftotext', ['-bbox-layout', outputPath, '-']);
  return { pages: parseBbox(bbox), text: stdout };
}

try {
  await execFileAsync('pdftotext', ['-v']);
} catch (error) {
  if (error.code === 'ENOENT') {
    console.log('SKIP: pdftotext not available; install poppler-utils to run editorial-flow regressions.');
    process.exit(0);
  }
  throw error;
}

const workDir = await mkdtemp(join(tmpdir(), 'report-baby-editorial-'));
const failures = [];
let selectedFixtureCount = 0;
try {
  const fixtures = [...reproducers, ...matrixFixtures];
  const selectedFixtures = process.env.EDITORIAL_FLOW_FILTER
    ? fixtures.filter((fixture) => fixture.name.includes(process.env.EDITORIAL_FLOW_FILTER))
    : fixtures;
  selectedFixtureCount = selectedFixtures.length;
  for (const fixture of selectedFixtures) {
    try {
      const result = await renderAndMeasure(fixture.name, fixture.input, workDir);
      const fixtureFailures = [];
      for (const check of [
        () => assertNoOrphanedFirstLines(result.pages, fixture.input),
        () => assertColumnBreaksFillTheColumn(result.pages, fixture.input),
        () => assertNoEmptyContentColumns(result.pages, fixture.input),
        () => assertTablesDoNotStartInAnEmptyColumn(result.pages, fixture.input),
        () => assertNoInternalColumnHoles(result.pages, fixture.input),
      ]) {
        try {
          check();
        } catch (error) {
          fixtureFailures.push(error.message);
        }
      }
      if (fixtureFailures.length > 0) throw new Error(fixtureFailures.join(' | '));
      console.log(`${fixture.name}: ${result.pages.length} page(s) OK`);
    } catch (error) {
      failures.push(`${fixture.name}: ${error.message}`);
      console.error(`${fixture.name}: FAIL — ${error.message}`);
    }
  }
  if (selectedFixtures.length === 0) throw new Error(`No editorial-flow fixtures matched EDITORIAL_FLOW_FILTER='${process.env.EDITORIAL_FLOW_FILTER}'.`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

if (failures.length > 0) assert.fail(failures.join('\n'));
console.log(`Editorial dynamic flow: ${selectedFixtureCount} fixture(s) OK (${reproducers.length} reproducers, ${matrixFixtures.length} matrix variants available)`);
