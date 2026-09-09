import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { prepareDemoBrandStore } from './lib/brand-store.mjs';
import { childProcessFailure } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const brandRefs = ['flux', 'orbit', 'parcelia', 'pyrus'];
const corpus = [
  'transport.txt',
  'labour-market.txt',
].map((name) => readFileSync(join(root, 'scripts', 'corpus', name), 'utf8').trim());
const baseBody = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny przewozow dlugodystansowych. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow. Ten raport podsumowuje najwazniejsze obserwacje z ostatniego kwartalu i wskazuje kierunki na kolejne miesiace.';
const twoSentenceBody = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny.';

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function seededText(seed, wordCount) {
  const random = mulberry32(seed);
  const words = corpus.flatMap((text) => text.split(/\s+/));
  const result = [];
  while (result.length < wordCount) result.push(words[Math.floor(random() * words.length)]);
  return result.join(' ');
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function scaledIntro(lines, seed, marker) {
  if (lines === 0) return undefined;
  const wordCount = { 1: 16, 3: 52, 8: 132 }[lines];
  return `Intro ${marker} ${seededText(seed, wordCount)}`;
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function scaledHighlights(count, marker, seed) {
  return Array.from({ length: count }, (_, index) => `Wniosek ${marker} ${index + 1}: ${seededText(seed + index, 12)}`);
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function section(heading, body = baseBody, level) {
  return { heading, body, ...(level === undefined ? {} : { level }) };
}

const reproducers = [
  {
    name: 'reproducer-three-unequal-columns',
    input: {
      template: 'pages/editorial-three-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Trzy nierowne kolumny',
        intro: 'Lead occupies the shared intro box and pushes the three-column narrative below it.',
        sections: Array.from({ length: 8 }, (_, index) => section(`Kolumna testowa ${index + 1}`, `${baseBody} ${baseBody}`)),
        footer: 'three-column fixture',
      },
    },
  },
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
  {
    name: 'reproducer-E-long-intro-overlap',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://flux/primary',
      data: {
        title: 'Kierowcow brakuje juz niemal w kazdym powiecie',
        subtitle: 'Podtytul',
        intro: 'Transport stanowi fundament gospodarki, a jednoczesnie przechodzi jeden z najglebszych kryzysow kadrowych w swojej historii. Niedobor kierowcow dotyczy juz wiekszosci regionow, a prognozy wskazuja, ze bedzie sie poglebial. Firmy transportowe coraz wyrazniej widza, ze same podwyzki nie rozwiaza problemu rekrutacji.',
        sections: Array.from({ length: 6 }, (_, index) => section(`S${index + 1}`, `${twoSentenceBody} ${twoSentenceBody}`)),
        footer: 'f',
      },
    },
  },
  {
    name: 'reproducer-F-pyrus-column-edge',
    input: {
      template: 'pages/editorial-two-column',
      brand_ref: 'brand://pyrus/primary',
      data: {
        title: 'Przeglad rynku transportowego',
        sections: [section('Deficyt obejmuje niemal cala Polske', `${twoSentenceBody} ${twoSentenceBody}`)],
        table: {
          head: ['Wskaznik', 'Wartosc'],
          body: [['Pozycja 1', '11'], ['Pozycja 2', '22']],
          caption: 'Dane z raportu Alior Banku przytoczone w artykule',
        },
        highlights_title: 'Najwazniejsze obserwacje',
        highlights: ['Rynek pracy kierowcow pozostaje napiety', 'Koszty operacyjne rosna szybciej niz przychody'],
        footer: 'repro-pyrus-edge',
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
  { name: 'highlights-1', tableRows: 0, highlights: 1 },
  { name: 'highlights-5', tableRows: 0, highlights: 5 },
  { name: 'highlights-15', tableRows: 0, highlights: 15 },
  { name: 'both-2-5', tableRows: 2, highlights: 5 },
  { name: 'both-6-5', tableRows: 6, highlights: 5 },
  { name: 'both-20-5', tableRows: 20, highlights: 5 },
];
for (const introLines of [0, 1, 3, 8]) {
  for (const sectionCount of [1, 2, 4, 8]) {
    for (const length of ['short', 'boundary', 'long']) {
      for (const blockVariant of blockVariants) {
        matrixIndex += 1;
        const marker = `M${String(matrixIndex).padStart(2, '0')}`;
        const repeatCount = length === 'short' ? 1 : length === 'boundary' ? 3 : 8;
        const bodySeed = length === 'short' ? twoSentenceBody : baseBody;
        const sections = Array.from({ length: sectionCount }, (_, index) => {
          const heading = `${marker}_S${index + 1}`;
          const body = `${seededText(matrixIndex * 17 + index, 8)} ${bodySeed} `.repeat(repeatCount).trim();
          return section(heading, body, sectionCount > 1 && index === sectionCount - 1 ? 2 : undefined);
        });
        const data = {
          title: matrixIndex % 2 === 0
            ? `Editorial matrix ${marker}`
            : `Editorial matrix ${marker} z bardzo dlugim naglowkiem testujacym zawijanie tytulu`,
          ...(matrixIndex % 3 === 0 ? { subtitle: `Podtytul ${marker} sprawdza zawijanie dodatkowego kontekstu raportu.` } : {}),
          ...(introLines > 0 ? { intro: scaledIntro(introLines, matrixIndex * 31, marker) } : {}),
          sections,
          ...(blockVariant.tableRows > 0 ? {
            table: {
              head: ['Kanal', 'Wynik'],
              body: Array.from({ length: blockVariant.tableRows }, (_, row) => [`Pozycja ${row + 1}`, `${row + 11}`]),
              caption: `Tabela ${marker}`,
            },
          } : {}),
          ...(blockVariant.highlights ? {
            highlights: scaledHighlights(blockVariant.highlights, marker, matrixIndex * 43),
            highlights_title: `Najwazniejsze ${marker}`,
          } : {}),
          footer: `matrix ${marker}`,
        };
        matrixFixtures.push({
          name: `matrix-${marker}-intro-${introLines}-${sectionCount}-${length}-${blockVariant.name}`,
          // Keep the exhaustive matrix on the raster-free showcase brand. The
          // five named reproducers and the four-brand seeded set still cover
          // image-band geometry without paying the PNG cost hundreds of times.
          input: { template: 'pages/editorial-two-column', brand_ref: 'brand://orbit/primary', data },
        });
      }
    }
  }
}

const seededSeeds = [0x10203040, 0x55667788, 0x9ABCDEF0, 0x13579BDF];
const seededFixtures = [];
for (const brand of brandRefs) {
  const fixtureSeeds = brand === 'orbit' ? seededSeeds : [seededSeeds[0]];
  const fixtureIntroLines = brand === 'orbit' ? [0, 1, 3, 8] : [3];
  for (const seed of fixtureSeeds) {
    for (const introLines of fixtureIntroLines) {
      const marker = `${brand}-${seed.toString(16)}-${introLines}`;
      const sections = Array.from({ length: 4 }, (_, index) => section(
        `${marker}_S${index + 1}`,
        seededText(seed + index * 101, 92),
      ));
      const data = {
        title: introLines === 8
          ? `Dlugie dane ${marker} sprawdzaja zawijanie naglowka i stabilnosc skladu`
          : `Dane ${marker}`,
        ...(seed % 2 === 0 ? { subtitle: `Rozszerzony podtytul dla przypadku ${marker} z dodatkowymi informacjami.` } : {}),
        ...(introLines > 0 ? { intro: scaledIntro(introLines, seed, marker) } : {}),
        sections,
        highlights: scaledHighlights(5, marker, seed + 700),
        highlights_title: `Najwazniejsze ${marker}`,
        footer: `seed ${seed.toString(16)}`,
      };
      seededFixtures.push({
        name: `seed-${seed.toString(16)}-${brand}-intro-${introLines}`,
        input: { template: 'pages/editorial-two-column', brand_ref: `brand://${brand}/primary`, data },
      });
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function normalize(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '');
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function templateColumnFrames(input, pageWidth) {
  const templatePath = join(root, 'templates', input.template, 'template.yml');
  const source = parseYaml(readFileSync(templatePath, 'utf8'));
  const page = source.page;
  const scale = pageWidth / page.width;
  let x = page.margins.left * scale;
  return page.columns.widths.map((columnWidth) => {
    const frame = { left: x, right: x + columnWidth * scale };
    x += (columnWidth + page.columns.gutter) * scale;
    return frame;
  });
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function columnForX(x, frames) {
  const containing = frames.findIndex((frame) => x >= frame.left - 0.5 && x <= frame.right + 0.5);
  if (containing >= 0) return containing;
  return frames.reduce((closest, frame, index) => {
    const distance = x < frame.left ? frame.left - x : x > frame.right ? x - frame.right : 0;
    const closestFrame = frames[closest];
    const closestDistance = x < closestFrame.left ? closestFrame.left - x : x > closestFrame.right ? x - closestFrame.right : 0;
    return distance < closestDistance ? index : closest;
  }, 0);
}

/**
 * @test-decision visual-gate
 * @test-action Move full rendering and XML geometry checks to the showcase/visual-QA gate; retain plan assertions here and reuse one backend smoke.
 */
function parseBbox(xml, input) {
  return [...xml.matchAll(/<page width="([0-9.]+)" height="([0-9.]+)">([\s\S]*?)<\/page>/g)].map((pageMatch, pageIndex) => {
    const width = Number(pageMatch[1]);
    const height = Number(pageMatch[2]);
    const frames = templateColumnFrames(input, width);
    const words = [...pageMatch[3].matchAll(/<word xMin="([0-9.]+)" yMin="([0-9.]+)" xMax="([0-9.]+)" yMax="([0-9.]+)">([^<]*)<\/word>/g)]
      .map((match) => ({ pageIndex, xMin: Number(match[1]), yMin: Number(match[2]), xMax: Number(match[3]), yMax: Number(match[4]), text: match[5], token: normalize(match[5]) }));
    const footer = words.filter((word) => word.text === '/').sort((a, b) => b.yMin - a.yMin)[0];
    assert.ok(footer, `page ${pageIndex + 1}: footer page number not found; cannot measure usable column bottom`);
    const lines = [];
    for (const word of words.sort((left, right) => left.xMin - right.xMin || left.yMin - right.yMin)) {
      const column = columnForX(word.xMin, frames);
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

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoWordOverlaps(pages) {
  const tolerance = 1;
  for (const page of pages) {
    const words = page.words.filter((word) => word.text.trim().length > 0);
    for (let leftIndex = 0; leftIndex < words.length; leftIndex += 1) {
      const left = words[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < words.length; rightIndex += 1) {
        const right = words[rightIndex];
        if (Math.abs(left.yMin - right.yMin) > 0.3) continue;
        const xOverlap = Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin);
        const yOverlap = Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin);
        if (xOverlap > tolerance && yOverlap > tolerance) {
          assert.fail(`page ${page.pageIndex + 1}: overlapping words '${left.text}' (${left.xMin.toFixed(2)},${left.yMin.toFixed(2)}) and '${right.text}' (${right.xMin.toFixed(2)},${right.yMin.toFixed(2)}) (${xOverlap.toFixed(2)} x ${yOverlap.toFixed(2)}pt)`);
        }
      }
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoColumnOverflow(pages, input) {
  /**
   * @test-decision plan-assertion
   * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
   */
  const framesFor = (page) => templateColumnFrames(input, page.width);
  const leftWords = pages.flatMap((page) => contentLines(page, input).filter((line) => line.column === 0).flatMap((line) => line.contentWords));
  const leftEdge = Math.min(...leftWords.map((word) => word.xMin));
  assert.ok(Number.isFinite(leftEdge), 'content words were not found while checking column edges');
  const sectionStarts = new Set((input.data.sections ?? []).map((sectionData) => normalize(String(sectionData.heading).split(/\s+/)[0])));
  for (const page of pages) {
    const firstSectionY = Math.min(...page.lines.filter((line) => line.tokens.some((token) => sectionStarts.has(token))).map((line) => line.yMin));
    for (const line of contentLines(page, input)) {
      // The editorial intro is a full-width block above the column flow. Its
      // words must not be judged against a column edge.
      if (Number.isFinite(firstSectionY) && line.yMin < firstSectionY) continue;
      const rightEdge = framesFor(page)[line.column]?.right ?? page.width;
      for (const word of line.contentWords) {
        assert.ok(word.xMax <= rightEdge + 0.5, `page ${page.pageIndex + 1}, column ${line.column + 1}: word '${word.text}' crosses column edge by ${(word.xMax - rightEdge).toFixed(2)}pt`);
      }
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoWideSolitaryHyphenLines(pages, input) {
  for (const page of pages) {
    const bodyLines = page.lines.filter((line) => line.yMin > page.height * 0.25 && line.yMin < page.footerY);
    const frames = templateColumnFrames(input, page.width);
    for (const line of bodyLines) {
      if (line.words.length !== 1 || !line.words[0].text.endsWith('-')) continue;
      const available = (frames[line.column]?.right ?? page.width) - line.xMax;
      assert.ok(available <= 25, `page ${page.pageIndex + 1}, column ${line.column + 1}: solitary hyphenated fragment '${line.words[0].text}' leaves ${available.toFixed(2)}pt unused`);
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
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

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function contentLines(page, input) {
  const expected = contentTokens(input);
  return page.lines
    .map((line) => ({
      ...line,
      contentWords: line.words.filter((word) => expected.has(word.token) && word.yMin < page.footerY),
    }))
    .filter((line) => line.contentWords.length > 0);
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function sectionHeadingLine(pages, heading) {
  const token = normalize(String(heading).split(/\s+/)[0]);
  return pages.flatMap((page) => page.lines).find((line) => line.tokens.includes(token));
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
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

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoOrphanedFirstLines(pages, input) {
  const gaps = pages.flatMap((page) => page.lines.flatMap((line) => line.words.slice(1).map((word, index) => word.xMin - line.words[index].xMax)));
  const wordGap = median(gaps) ?? 4;
  for (const sectionData of input.data.sections ?? []) {
    const line = firstBodyLine(pages, sectionData);
    if (line.words.length !== 1) continue;
    const first = normalize(sectionData.body.split(/\s+/)[0]);
    const second = normalize(sectionData.body.split(/\s+/)[1]);
    const lineOrder = line.pageIndex * 1000000 + line.column * 100000 + line.yMin;
    const frames = templateColumnFrames(input, pages[line.pageIndex].width);
    const secondWord = pages.flatMap((page) => page.words)
      .filter((word) => word.pageIndex === line.pageIndex && columnForX(word.xMin, frames) === line.column)
      .filter((word) => word.pageIndex * 1000000 + line.column * 100000 + word.yMin >= lineOrder)
      .find((word) => word.token === second);
    assert.ok(secondWord, `second body word '${second}' for '${sectionData.heading}' was not found`);
    const page = pages[line.pageIndex];
    const columnRight = frames[line.column]?.right ?? page.width;
    const fits = line.xMax + wordGap + (secondWord.xMax - secondWord.xMin) <= columnRight;
    assert.ok(!fits, `orphaned first line in '${sectionData.heading}': '${first}' is alone although the next word fits`);
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertColumnBreaksFillTheColumn(pages, input) {
  if (input.data.intro) return;
  const blockTokens = new Set([
    input.data.highlights_title,
    ...(input.data.highlights ?? []),
    input.data.table?.caption,
    ...(input.data.table?.head ?? []),
    ...(input.data.table?.body ?? []).flat(),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize)));
  const headingTokens = new Set((input.data.sections ?? []).flatMap((sectionData) => String(sectionData.heading).split(/\s+/).map(normalize)));
  for (const page of pages) {
    const bodyLines = contentLines(page, input).map((line) => ({ ...line, bodyWords: line.contentWords }));
    const lineDeltas = [...new Set(bodyLines.map((line) => line.column))].flatMap((column) => {
      const columnLines = bodyLines.filter((line) => line.column === column).sort((leftLine, rightLine) => leftLine.yMin - rightLine.yMin);
      return columnLines.slice(1).map((line, index) => line.yMin - columnLines[index].yMin);
    });
    const lineHeight = median(lineDeltas);
    if (!lineHeight) continue;
    const lastColumn = Math.max(...bodyLines.map((line) => line.column));
    for (let column = 0; column < lastColumn; column += 1) {
      const left = bodyLines.filter((line) => line.column === column);
      const right = bodyLines.filter((line) => line.column === column + 1);
      if (left.length === 0 || right.length === 0) continue;
      if (right[0].tokens.some((token) => headingTokens.has(token))) continue;
      if (right.some((line) => line.tokens.some((token) => blockTokens.has(token)))) continue;
      const leftY = left.flatMap((line) => line.bodyWords.map((word) => word.yMax));
      // Leave one derived line of clearance for the footer glyphs; the
      // remaining gap is the actual unused column space being tested.
      const usableBottom = page.footerY - lineHeight;
      const gap = usableBottom - Math.max(...leftY);
      assert.ok(gap <= lineHeight * 2.5, `page ${page.pageIndex + 1}: column ${column + 1} broke ${gap.toFixed(2)}pt before column ${column + 2}, more than 2.5 lines (${lineHeight.toFixed(2)}pt); last '${left.at(-1)?.text ?? ''}', first next '${right.at(0)?.text ?? ''}`);
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoEmptyContentColumns(pages, input) {
  for (const page of pages.slice(0, -1)) {
    const lines = contentLines(page, input);
    const occupied = lines.map((line) => line.column);
    if (occupied.length === 0) continue;
    const highest = Math.max(...occupied);
    for (let column = 0; column <= highest; column += 1) {
      assert.ok(occupied.includes(column), `page ${page.pageIndex + 1}: content column ${column + 1} is empty before a later column is used`);
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
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
    const firstTableColumn = Math.min(...tableLines.map((line) => line.column));
    const hasPriorContent = lines.some((line) => line.column < firstTableColumn);
    assert.ok(hasPriorContent || firstTableColumn === 0, `page ${page.pageIndex + 1}: table content starts in column ${firstTableColumn + 1} while all prior columns are empty`);
  }
  for (const value of table.body.map((row) => row[0])) {
    const token = normalize(String(value).split(/\s+/)[0]);
    assert.ok(pages.some((page) => page.words.some((word) => word.token === token)), `table row '${value}' is missing from the rendered PDF`);
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep as a plan/fixture helper; consolidate repeated editorial geometry assertions into one plan contract.
 */
function assertNoInternalColumnHoles(pages, input) {
  const headingTokens = new Set((input.data.sections ?? []).flatMap((sectionData) => String(sectionData.heading).split(/\s+/).map(normalize)));
  const introTokens = new Set(String(input.data.intro ?? '').split(/\s+/).map(normalize));
  const tableBoundaryTokens = new Set([
    input.data.table?.caption,
    ...(input.data.table?.head ?? []),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize)));
  const blockBoundaryTokens = new Set([
    ...tableBoundaryTokens,
    input.data.highlights_title,
    ...(input.data.highlights ?? []),
  ].filter(Boolean).flatMap((value) => String(value).split(/\s+/).map(normalize)));
  for (const page of pages) {
    const lines = contentLines(page, input);
    const deltas = lines.flatMap((line) => {
      const columnLines = lines.filter((candidate) => candidate.column === line.column).sort((left, right) => left.yMin - right.yMin);
      const index = columnLines.indexOf(line);
      return index > 0 ? [line.yMin - columnLines[index - 1].yMin] : [];
    });
    const lineHeight = median(deltas);
    if (!lineHeight) continue;
    const lastColumn = Math.max(-1, ...lines.map((line) => line.column));
    for (let column = 0; column <= lastColumn; column += 1) {
      const columnLines = lines.filter((line) => line.column === column).sort((left, right) => left.yMin - right.yMin);
      for (let index = 1; index < columnLines.length; index += 1) {
        const gap = columnLines[index].yMin - columnLines[index - 1].yMin;
        if (
          columnLines[index - 1].tokens.some((token) => headingTokens.has(token) || blockBoundaryTokens.has(token))
          || columnLines[index].tokens.some((token) => headingTokens.has(token) || blockBoundaryTokens.has(token))
          || columnLines[index - 1].tokens.some((token) => introTokens.has(token))
          || columnLines[index].tokens.some((token) => introTokens.has(token))
        ) continue;
        assert.ok(gap <= lineHeight * 2.5, `page ${page.pageIndex + 1}, column ${column + 1}: internal content gap ${gap.toFixed(2)}pt exceeds 2.5 lines (${lineHeight.toFixed(2)}pt): '${columnLines[index - 1].text}' -> '${columnLines[index].text}'`);
      }
    }
  }
}

/**
 * @test-decision backend-smoke
 * @test-action Keep one representative PDF batch for backend smoke; all editorial variants use planBatch.
 */
function renderBatch(fixtures, workDir, concurrency, brandStore) {
  const batchCount = Math.min(concurrency, fixtures.length);
  const batches = Array.from({ length: batchCount }, () => []);
  fixtures.forEach((fixture, index) => batches[index % batchCount].push(fixture));
  return Promise.all(batches.map((batch) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: workDir, REPORT_BABY_BRAND_STORE: brandStore },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(childProcessFailure(`batch CLI [${batch.map((fixture) => fixture.name).join(', ')}]`, { status: code, stdout, stderr })));
    });
    const payload = JSON.stringify(batch.map((fixture) => ({
      tool: 'render_report',
      args: { ...fixture.input, data: legacyFixtureToCompositionInput(fixture.input.data), output_path: join(workDir, `${fixture.name}.pdf`) },
    })));
    child.stdin.end(payload);
  })));
}

/**
 * @test-decision plan-batch
 * @test-action Merge all editorial fixture responses into one plan contract; assert the same dry-run invariants for reproducers, seeds, and the optional exhaustive matrix.
 */
function assertPlannedEditorialFixtures(plannedFixtures) {
  for (const { fixture, result } of plannedFixtures) {
    assert.equal(result.dryRun, true, `${fixture.name}: expected dry-run response`);
    assert.equal(result.compositionEvaluation?.status, 'accepted', `${fixture.name}: dry-run composition was not accepted`);
    assert.ok((result.compositionPlan?.lines?.length ?? 0) > 0, `${fixture.name}: dry-run plan has no lines`);
  }
}

/**
 * @test-decision plan-batch
 * @test-action Keep as the single batched planner pass for the editorial matrix; merge fixtures instead of rendering each case.
 */
function planBatch(fixtures, workDir, concurrency, brandStore) {
  if (fixtures.length === 0) return Promise.resolve([]);
  const batchCount = Math.min(concurrency, fixtures.length);
  const batches = Array.from({ length: batchCount }, () => []);
  fixtures.forEach((fixture, index) => batches[index % batchCount].push(fixture));
  return Promise.all(batches.map((batch) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: workDir, REPORT_BABY_BRAND_STORE: brandStore },
    });
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(childProcessFailure(`plan-only CLI [${batch.map((fixture) => fixture.name).join(', ')}]`, { status: code, stdout, stderr })));
      try {
        const results = stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
        if (results.length !== batch.length) throw new Error(`expected ${batch.length} plan responses, received ${results.length}`);
        resolve(results.map((result, index) => ({ fixture: batch[index], result })));
      } catch (error) {
        reject(new Error(`plan-only CLI returned invalid JSON: ${error.message}; stdout=${stdout.slice(0, 500)}`));
      }
    });
    const payload = JSON.stringify(batch.map((fixture) => ({
      tool: 'render_report',
      args: { ...fixture.input, data: legacyFixtureToCompositionInput(fixture.input.data), dry_run: true },
    })));
    child.stdin.end(payload);
  })));
}

/**
 * @test-decision visual-gate
 * @test-action Move full rendering and XML geometry checks to the showcase/visual-QA gate; retain plan assertions here and reuse one backend smoke.
 */
async function measureRendered(name, input, workDir) {
  const outputPath = join(workDir, `${name}.pdf`);
  const { stdout: bbox } = await execFileAsync('pdftotext', ['-bbox-layout', outputPath, '-']);
  return { pages: parseBbox(bbox, input) };
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
const brandStore = join(workDir, 'brand-store');
const failures = [];
let selectedFixtureCount = 0;
const exhaustive = process.env.EDITORIAL_FLOW_FULL === '1';
try {
  // The named reproducers and seeded fixtures are the fast PR/release gate.
  // The exhaustive 480-case matrix remains available for scheduled or
  // pre-release validation without making every local run wait for hundreds
  // of dry-run CLI processes.
  const fixtures = [...reproducers, ...(exhaustive ? matrixFixtures : []), ...seededFixtures];
  const selectedFixtures = process.env.EDITORIAL_FLOW_FILTER
    ? fixtures.filter((fixture) => fixture.name.includes(process.env.EDITORIAL_FLOW_FILTER))
    : fixtures;
  selectedFixtureCount = selectedFixtures.length;
  if (selectedFixtures.length === 0) throw new Error(`No editorial-flow fixtures matched EDITORIAL_FLOW_FILTER='${process.env.EDITORIAL_FLOW_FILTER}'.`);
  const requestedConcurrency = Number.parseInt(process.env.EDITORIAL_FLOW_CONCURRENCY ?? '8', 10);
  const concurrency = Math.max(1, Math.min(8, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 8));
  prepareDemoBrandStore(join(root, '..'), brandStore, 'editorial-test');
  // Keep one PDF per geometry family. The remaining reproducers still run
  // through the real CLI and assert an accepted composition plan below.
  const artifactReproducerNames = new Set([
    'reproducer-three-unequal-columns',
    'reproducer-C-table-flow',
  ]);
  const pdfSelected = selectedFixtures.filter((fixture) => artifactReproducerNames.has(fixture.name));
  const planSelected = selectedFixtures.filter((fixture) => !artifactReproducerNames.has(fixture.name));
  const plannedFixtures = (await planBatch(planSelected, workDir, concurrency, brandStore)).flat();
  assertPlannedEditorialFixtures(plannedFixtures);
  await renderBatch(pdfSelected, workDir, concurrency, brandStore);
  let nextFixture = 0;
  /**
   * @test-decision visual-gate
   * @test-action Move full rendering and XML geometry checks to the showcase/visual-QA gate; retain plan assertions here and reuse one backend smoke.
   */
  async function worker() {
    while (nextFixture < pdfSelected.length) {
      const fixture = pdfSelected[nextFixture];
      nextFixture += 1;
      try {
        const result = await measureRendered(fixture.name, fixture.input, workDir);
        const fixtureFailures = [];
        for (const check of [
          () => assertNoWordOverlaps(result.pages),
          () => assertNoColumnOverflow(result.pages, fixture.input),
          () => assertNoWideSolitaryHyphenLines(result.pages, fixture.input),
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
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pdfSelected.length) }, () => worker()));
} finally {
  // Parallel CLI batches can still release a file descriptor just after the
  // last response is received. Let fs.rm retry transient ENOTEMPTY/EBUSY
  // states instead of turning a successful fixture run into a cleanup failure.
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (failures.length > 0) assert.fail(failures.join('\n'));
console.log(`Editorial dynamic flow: ${selectedFixtureCount} fixture(s) OK (${reproducers.length} reproducers, ${exhaustive ? matrixFixtures.length : 0} matrix variants${exhaustive ? '' : ' in fast mode'}, ${seededSeeds.length} seeds [${seededSeeds.map((seed) => `0x${seed.toString(16)}`).join(', ')}], ${seededFixtures.length} seeded fixtures available)`);
