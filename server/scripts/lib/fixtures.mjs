import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const longWords = (count, word) => Array.from({ length: count }, (_, index) => `${word}${index + 1}`).join(' ');

export async function writePublicBrandFixture(brandDir) {
  await mkdir(join(brandDir, 'acme'), { recursive: true });
  await writeFile(join(brandDir, 'acme', '_brand.yml'), `
schema_version: 1
meta:
  name: Acme
color:
  palette:
    navy: "#112233"
    orange: "#ff6600"
    teal: "#00aa99"
    green: "#16a34a"
    red: "#dc2626"
    purple: "#7c3aed"
  background: "#ffffff"
  foreground: navy
  primary: navy
  secondary: orange
  success: green
  danger: red
typography:
  fonts:
    - family: Inter
      source: file
  base:
    family: Inter
  headings:
    family: Inter
  roles:
    innovation-display:
      family: "Aptos Display"
`, 'utf8');
  await writeFile(join(brandDir, 'acme', 'primary.yml'), `
color:
  primary: orange
`, 'utf8');
  await mkdir(join(brandDir, 'acme', 'templates', 'slides', 'primary'), { recursive: true });
  await writeFile(join(brandDir, 'acme', 'templates', 'slides', 'primary', 'template.yml'), `
schema_version: 1
id: slides/primary
kind: slide
archetype: narrative
surface: slide-16x9
header_title_y: 132
header_subtitle_y: 174
header_line_y: 202
content_top: 232
content_bottom: 810
title_align: start
regions:
  content: { frame: { x: 0.05, y: 0.2577777778, width: 0.90, height: 0.6422222222 } }
slots:
  title: { type: text, frame: { x: 0.05, y: 0.10, width: 0.90, height: 0.06 }, role: heading, max_lines: 1, overflow: shrink-to-fit }
`, 'utf8');
}

export function standardDeck() {
  return {
    brand: 'QA Fixture',
    footer: 'Synthetic visual QA fixture',
    slides: [
      { layout: 'title', flows: {
        eyebrow: { blocks: [{ type: 'heading', text: 'PERIOD 02 / SIGNALS' }] },
        title: { blocks: [{ type: 'heading', text: 'Quarterly signal review' }] },
        subtitle: { blocks: [{ type: 'text', text: 'A synthetic deck used only by the visual QA harness' }] },
      } },
      {
        layout: 'metrics',
        flows: {
          title: { blocks: [{ type: 'heading', text: 'Signal board' }] },
          subtitle: { blocks: [{ type: 'text', text: 'Three headline measures' }] },
          body: { blocks: [{ type: 'text', text: 'Every value below is invented for the harness and carries no customer meaning.' }] },
          callout: { blocks: [{ type: 'text', text: 'One callout line under the grid.' }] },
          main: { blocks: [
            { type: 'metric', label: 'Active teams', value: '18.4k', delta: '+12.8%', trend: 'up', note: 'vs prior period' },
            { type: 'metric', label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up', note: 'first-week cohort' },
            { type: 'metric', label: 'Expansion', value: '2.8m', delta: '-1.2%', trend: 'down', note: 'qualified pipeline' },
          ] },
        },
      },
      { layout: 'chart', flows: {
        title: { blocks: [{ type: 'heading', text: 'Weekly trend' }] },
        subtitle: { blocks: [{ type: 'text', text: 'Bar chart with six buckets' }] },
        main: { blocks: [{ type: 'chart', chart_type: 'bar', data: [{ label: 'W1', value: 112 }, { label: 'W2', value: 124 }, { label: 'W3', value: 139 }, { label: 'W4', value: 154 }, { label: 'W5', value: 184 }, { label: 'W6', value: 176 }] }] },
      } },
      { layout: 'table', flows: {
        title: { blocks: [{ type: 'heading', text: 'Channel summary' }] },
        subtitle: { blocks: [{ type: 'text', text: 'Five rows, three columns' }] },
        main: { blocks: [{ type: 'table', head: ['Channel', 'Volume', 'Change'], body: [['Search', '4 210', '+8%'], ['Social', '2 980', '+3%'], ['Email', '1 640', '-2%'], ['Direct', '1 120', '+11%'], ['Referral', '640', '+1%']] }] },
      } },
      { layout: 'narrative', flows: {
        title: { blocks: [{ type: 'heading', text: 'What the numbers say' }] },
        subtitle: { blocks: [{ type: 'text', text: 'A short reading' }] },
        main: { blocks: [
          { type: 'text', text: 'The fixture text stays short enough to fit the narrative slot at the template default size.' },
          { type: 'list-item', text: 'Keep the first result visible.' },
          { type: 'list-item', text: 'Turn repeat use into a habit.' },
        ] },
      } },
      { layout: 'conclusions', flows: {
        title: { blocks: [{ type: 'heading', text: 'Decisions' }] },
        main: { blocks: [
          { type: 'list-item', text: 'Scale the channels that already convert.' },
          { type: 'list-item', text: 'Watch acquisition cost weekly.' },
          { type: 'list-item', text: 'Re-test the onboarding step.' },
        ] },
      } },
      { layout: 'columns', template_ref: 'slides/two-column', flows: {
        title: { blocks: [{ type: 'heading', text: 'One decision, two views' }] },
        subtitle: { blocks: [{ type: 'text', text: 'A slide-only layout from an external template file' }] },
        left: { blocks: [{ type: 'heading', text: 'Signal' }, { type: 'text', text: 'The left column carries the evidence and a short explanation.' }, { type: 'list-item', text: 'One source of truth' }] },
        right: { blocks: [{ type: 'heading', text: 'Action' }, { type: 'text', text: 'The right column carries the response and the next step.' }, { type: 'list-item', text: 'One clear decision' }] },
      } },
    ],
  };
}

export function standardReport() {
  return {
    template: 'default-report',
    data: {
      title: 'Quarterly signal review',
      subtitle: 'Synthetic A4 fixture',
      period: 'Period 02',
      intro: 'This report exists only to exercise the renderer. Every number is invented.',
      kpis: [
        { label: 'Active teams', value: '18.4k', delta: '+12.8%', trend: 'up', note: 'vs prior period' },
        { label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up' },
        { label: 'Expansion', value: '2.8m', delta: '-1.2%', trend: 'down' },
      ],
      charts: [
        { type: 'bar', title: 'Weekly trend', data: [{ label: 'W1', value: 112 }, { label: 'W2', value: 124 }, { label: 'W3', value: 139 }, { label: 'W4', value: 154 }] },
        { type: 'pie', title: 'Channel mix', data: [{ label: 'Search', value: 42 }, { label: 'Social', value: 30 }, { label: 'Email', value: 18 }, { label: 'Direct', value: 10 }] },
      ],
      sections: Array.from({ length: 6 }, (_, index) => ({ heading: `Section ${index + 1}`, body: `${longWords(40, 'Sentence')}.` })),
      table: { head: ['Channel', 'Volume', 'Change'], body: Array.from({ length: 24 }, (_, index) => [`Channel ${index + 1}`, `${1000 + index * 37}`, `${index % 2 === 0 ? '+' : '-'}${index}%`]), caption: 'Synthetic channel table' },
      highlights: ['One conclusion.', 'A second conclusion.'],
      footer: 'Synthetic visual QA fixture',
    },
  };
}

export function editorialRegressionReport(variant) {
  const prose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow.';
  const section = (index, body = prose) => ({ heading: `Fixture section ${index}`, body });
  const report = { template: 'pages/editorial-two-column', data: { title: `Editorial regression ${variant}`, footer: `Regression ${variant}` } };
  if (variant === 'A') report.data = { ...report.data, intro: 'Krótki wstęp do raportu.', sections: [section(1), section(2)] };
  if (variant === 'B') report.data = { ...report.data, sections: Array.from({ length: 4 }, (_, index) => section(index + 1, `${prose} ${prose}`)) };
  if (variant === 'C') report.data = { ...report.data, sections: Array.from({ length: 4 }, (_, index) => section(index + 1, `${prose} ${prose}`)), table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 6 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 11}`]), caption: 'Dane' } };
  if (variant === 'D') report.data = { ...report.data, sections: Array.from({ length: 4 }, (_, index) => section(index + 1, `${prose} ${prose} ${prose}`)), highlights: Array.from({ length: 5 }, (_, index) => `Wniosek ${index + 1} o pewnej dlugosci tekstu`) };
  if (variant === 'E') report.data = { ...report.data, intro: `${prose} ${prose} ${prose}`, sections: Array.from({ length: 6 }, (_, index) => section(index + 1, `${prose} ${prose}`)) };
  if (variant === 'F') report.data = { ...report.data, sections: [section('Deficyt obejmuje niemal cala Polske', `${prose} ${prose}`)], table: { head: ['Wskaznik', 'Wartosc'], body: [['Pozycja 1', '11'], ['Pozycja 2', '22']], caption: 'Dane z raportu przytoczone w artykule' }, highlights_title: 'Najwazniejsze obserwacje', highlights: ['Rynek pracy kierowcow pozostaje napiety', 'Koszty operacyjne rosna szybciej niz przychody'] };
  if (variant === 'G') report.template = 'default-report', report.data = { ...standardReport().data, title: 'Table footer regression', sections: [{ heading: 'Context', body: 'Short context.' }], table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 70 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 100}`]), caption: 'Dane' }, footer: 'Regression G' };
  if (variant === 'H') report.data = { ...report.data, sections: Array.from({ length: 6 }, (_, index) => section(index + 1, Array.from({ length: 320 }, (_, word) => `Body${word + index * 320}`).join(' '))) };
  if (variant === 'I') {
    const reprose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny przewozow dlugodystansowych. ';
    report.data = {
      ...report.data,
      sections: Array.from({ length: 4 }, (_, index) => section(index + 1, reprose.repeat(2))),
      table: { head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 6 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 11}`]), caption: 'Dane' },
    };
  }
  return report;
}

export function buildDeck(slides, extra = {}) {
  return { brand: 'QA Fixture', footer: 'Synthetic visual QA fixture', ...extra, slides };
}

export function compositionStandardReport() {
  return {
    template_ref: 'default-report',
    data: { flows: {
      header: { continuation: 'forbidden', blocks: [
        { type: 'heading', role: 'header', text: 'Quarterly signal review', keep_with_next_lines: 1 },
        { type: 'text', role: 'header', text: 'Synthetic A4 fixture · Period 02' },
      ] },
      main: { continuation: 'allowed', blocks: [
        { type: 'text', role: 'intro', text: 'This report exists only to exercise the renderer. Every number is invented.', keep_with_next_lines: 2 },
        { type: 'metric', label: 'Active teams', value: '18.4k', delta: '+12.8%', trend: 'up', note: 'vs prior period' },
        { type: 'metric', label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up' },
        { type: 'metric', label: 'Expansion', value: '2.8m', delta: '-1.2%', trend: 'down' },
        { type: 'chart', chart_type: 'bar', title: 'Weekly trend', data: [{ label: 'W1', value: 112 }, { label: 'W2', value: 124 }, { label: 'W3', value: 139 }, { label: 'W4', value: 154 }] },
        ...Array.from({ length: 6 }, (_, index) => [
          { type: 'heading', role: 'heading', text: `Section ${index + 1}`, level: 2, keep_with_next_lines: 1 },
          { type: 'text', role: 'body', text: `${longWords(40, 'Sentence')}.` },
        ]).flat(),
        { type: 'table', role: 'table', caption: 'Synthetic channel table', head: ['Channel', 'Volume', 'Change'], body: Array.from({ length: 24 }, (_, index) => [`Channel ${index + 1}`, `${1000 + index * 37}`, `${index % 2 === 0 ? '+' : '-'}${index}%`]) },
        { type: 'list-item', role: 'body', text: 'One conclusion.' },
        { type: 'list-item', role: 'body', text: 'A second conclusion.' },
      ] },
      footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'Synthetic visual QA fixture' }] },
    } },
  };
}

export function compositionEditorialRegressionReport(variant) {
  const prose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow.';
  const blocks = [];
  let sectionCount = 0;
  let sectionBody = prose;
  const report = { template_ref: 'pages/editorial-two-column', data: { flows: {
    header: { continuation: 'forbidden', blocks: [{ type: 'heading', role: 'header', text: `Editorial regression ${variant}` }] },
    main: { continuation: 'allowed', blocks },
    footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: `Regression ${variant}` }] },
  } } };
  if (variant === 'A') {
    blocks.push({ type: 'text', id: 'intro', role: 'intro', text: 'Krótki wstęp do raportu.', keep_with_next_lines: 2 });
    sectionCount = 2;
  }
  if (variant === 'B') { sectionCount = 4; sectionBody = `${prose} ${prose}`; }
  if (variant === 'C') {
    sectionCount = 4;
    sectionBody = `${prose} ${prose}`;
  }
  if (variant === 'D') {
    sectionCount = 4;
    sectionBody = `${prose} ${prose} ${prose}`;
  }
  if (variant === 'E') {
    blocks.push({ type: 'text', id: 'intro', role: 'intro', text: `${prose} ${prose} ${prose}`, keep_with_next_lines: 2 });
    sectionCount = 6;
    sectionBody = `${prose} ${prose}`;
  }
  if (variant === 'F') {
    blocks.push({ type: 'heading', role: 'heading', text: 'Deficyt obejmuje niemal cala Polske', level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${prose} ${prose}` }, { type: 'table', role: 'table', caption: 'Dane z raportu przytoczone w artykule', head: ['Wskaznik', 'Wartosc'], body: [['Pozycja 1', '11'], ['Pozycja 2', '22']] }, { type: 'heading', role: 'heading', text: 'Najwazniejsze obserwacje', level: 2, keep_with_next_lines: 1 }, { type: 'list-item', role: 'body', text: 'Rynek pracy kierowcow pozostaje napiety' }, { type: 'list-item', role: 'body', text: 'Koszty operacyjne rosna szybciej niz przychody' });
  }
  if (variant === 'G') {
    report.template_ref = 'default-report';
    blocks.push({ type: 'text', role: 'intro', text: 'Short context.', keep_with_next_lines: 1 }, { type: 'table', role: 'table', caption: 'Dane', head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 70 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 100}`]) });
  }
  if (variant === 'H') { sectionCount = 6; sectionBody = Array.from({ length: 320 }, (_, word) => `Body${word}`).join(' '); }
  if (variant === 'I') {
    const reprose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny przewozow dlugodystansowych. ';
    sectionCount = 4;
    sectionBody = reprose.repeat(2);
  }
  for (let index = 0; index < sectionCount; index++) blocks.push(
    { type: 'heading', role: 'heading', text: `Fixture section ${index + 1}`, level: 2, keep_with_next_lines: 1 },
    { type: 'text', role: 'body', text: sectionBody },
  );
  if (variant === 'C') blocks.push({ type: 'table', role: 'table', caption: 'Dane', head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 6 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 11}`]) });
  if (variant === 'D') blocks.push({ type: 'heading', role: 'heading', text: 'Highlights', level: 2, keep_with_next_lines: 1 }, ...Array.from({ length: 5 }, (_, index) => ({ type: 'list-item', role: 'body', text: `Wniosek ${index + 1} o pewnej dlugosci tekstu` })));
  if (variant === 'I') blocks.push({ type: 'table', role: 'table', caption: 'Dane', head: ['Wskaznik', 'Wartosc'], body: Array.from({ length: 6 }, (_, index) => [`Pozycja ${index + 1}`, `${index + 11}`]) });
  return report;
}

export function compositionMultipageReport() {
  return { template_ref: 'default-report', data: { flows: {
    header: { continuation: 'forbidden', blocks: [{ type: 'heading', role: 'header', text: 'Long-form editorial review' }] },
    main: { continuation: 'allowed', blocks: [
      { type: 'text', role: 'intro', text: `${longWords(160, 'Lead')}.`, keep_with_next_lines: 2 },
      ...Array.from({ length: 5 }, (_, index) => [{ type: 'heading', role: 'heading', text: `Article ${index + 1} spanning a page break`, level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${longWords(320, 'Body')}.` }]).flat(),
    ] },
    footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'Synthetic visual QA fixture' }] },
  } } };
}

export function compositionInlineMarkupReport() {
  return { template_ref: 'default-report', data: { flows: {
    header: { continuation: 'forbidden', blocks: [{ type: 'heading', role: 'header', text: 'Inline markup and glyph fallback' }, { type: 'text', role: 'header', text: 'Bold runs, a glyph the brand font lacks, and two heading levels' }] },
    main: { continuation: 'allowed', blocks: [
      { type: 'text', role: 'intro', text: 'This lead carries **bold emphasis mid-sentence** and a checkmark \u2713 that the brand serif does not ship, so it has to fall back to the bundled font.', keep_with_next_lines: 2 },
      { type: 'metric', label: 'Bold label', value: '90%', note: 'Note with a \u2713 inside' },
      { type: 'metric', label: 'Plain label', value: '12', note: 'Plain note' },
      { type: 'heading', role: 'heading', text: 'Article 1', level: 1, keep_with_next_lines: 1 },
      { type: 'text', role: 'body', text: 'Chapter lead-in with **bold** and a \u2713.' },
      { type: 'heading', role: 'heading', text: 'First subsection', level: 2, keep_with_next_lines: 1 },
      { type: 'text', role: 'body', text: 'Body under a level 2 heading, with **bold** in the middle of a sentence and enough words to wrap onto a second line so the wrapper has to carry styled runs across a line break.' },
      { type: 'heading', role: 'heading', text: 'Article 2', level: 1, keep_with_next_lines: 1 },
      { type: 'text', role: 'body', text: 'A second chapter at level 1.' },
      { type: 'heading', role: 'heading', text: 'Second subsection', level: 2, keep_with_next_lines: 1 },
      { type: 'text', role: 'body', text: 'Closing subsection with *italic markup* that has no italic face.' },
      { type: 'table', role: 'table', caption: 'Cells with markup', head: ['Corridor', 'Change'], body: [['North \u2713 South', '+18%'], ['East to West', '**+17%**']] },
      { type: 'heading', role: 'heading', text: 'What to check', level: 2, keep_with_next_lines: 1 },
      { type: 'list-item', role: 'body', text: 'A bullet with **bold** inside' },
      { type: 'list-item', role: 'body', text: 'A bullet with a \u2713 inside' },
    ] },
    footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'Synthetic visual QA fixture' }] },
  } } };
}

export function compositionPageFillReport(variant) {
  const data = { flows: {
    header: { continuation: 'forbidden', blocks: [{ type: 'heading', role: 'header', text: `Page-fill fixture: ${variant}` }] },
    main: { continuation: 'allowed', blocks: [{ type: 'text', role: 'intro', text: 'This report is synthetic and contains no customer data.', keep_with_next_lines: 2 }] },
    footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'Synthetic page-fill fixture' }] },
  } };
  if (variant === 'section') data.flows.main.blocks.push({ type: 'heading', role: 'heading', text: 'A paragraph crossing a page boundary', level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${longWords(195, 'SectionWord')}.` });
  if (variant === 'highlights') data.flows.main.blocks.push({ type: 'heading', role: 'heading', text: 'Lead content before the list', level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${longWords(200, 'LeadWord')}.` }, { type: 'heading', role: 'heading', text: 'Highlights', level: 2, keep_with_next_lines: 1 }, ...['The first synthetic conclusion.', 'The second synthetic conclusion.', 'The final synthetic conclusion.'].map((text) => ({ type: 'list-item', role: 'body', text })));
  if (variant === 'table') data.flows.main.blocks.push({ type: 'heading', role: 'heading', text: 'Lead content before the table', level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${longWords(120, 'TableLead')}.` }, { type: 'table', role: 'table', caption: 'Synthetic table with enough rows to exercise a page tail', head: ['Route', 'Volume', 'Change'], body: Array.from({ length: 11 }, (_, index) => [`Route ${index + 1}`, `${1000 + index}`, `+${index}%`]) });
  return { template_ref: 'default-report', data };
}

export function compositionGapTighteningReport() {
  return { template_ref: 'default-report', data: { flows: {
    header: { continuation: 'forbidden', blocks: [{ type: 'heading', role: 'header', text: 'Page-fill fixture: gap tightening' }] },
    main: { continuation: 'allowed', blocks: [{ type: 'text', role: 'intro', text: `${longWords(28, 'IntroWord')}.`, keep_with_next_lines: 2 }, ...Array.from({ length: 4 }, (_, index) => [{ type: 'heading', role: 'heading', text: `Gap section ${index + 1}`, level: 2, keep_with_next_lines: 1 }, { type: 'text', role: 'body', text: `${longWords(36, 'GapWord')}.` }]).flat(), { type: 'heading', role: 'heading', text: 'Highlights', level: 2, keep_with_next_lines: 1 }, { type: 'list-item', role: 'body', text: 'A compact synthetic conclusion.' }, { type: 'list-item', role: 'body', text: 'A second compact synthetic conclusion.' }] },
    footer: { continuation: 'forbidden', blocks: [{ type: 'text', role: 'footer', text: 'Synthetic page-fill fixture' }] },
  } } };
}

export function multipageReport() {
  const report = standardReport();
  return { ...report, data: { ...report.data, title: 'Long-form editorial review', subtitle: 'Sections that cross page breaks on purpose', intro: `${longWords(160, 'Lead')}.`, sections: Array.from({ length: 5 }, (_, index) => ({ heading: `Article ${index + 1} spanning a page break`, body: `${longWords(320, 'Body')}.` })) } };
}

export function inlineMarkupReport() {
  const report = standardReport();
  return {
    ...report,
    data: {
      ...report.data,
      title: 'Inline markup and glyph fallback',
      subtitle: 'Bold runs, a glyph the brand font lacks, and two heading levels',
      intro: 'This lead carries **bold emphasis mid-sentence** and a checkmark \u2713 that the brand serif does not ship, so it has to fall back to the bundled font.',
      kpis: [{ label: 'Bold label', value: '90%', note: 'Note with a \u2713 inside' }, { label: 'Plain label', value: '12', note: 'Plain note' }],
      sections: [
        { heading: 'Article 1', body: 'Chapter lead-in with **bold** and a \u2713.', level: 1 },
        { heading: 'First subsection', body: 'Body under a level 2 heading, with **bold** in the middle of a sentence and enough words to wrap onto a second line so the wrapper has to carry styled runs across a line break.', level: 2 },
        { heading: 'Article 2', body: 'A second chapter at level 1.', level: 1 },
        { heading: 'Second subsection', body: 'Closing subsection with *italic markup* that has no italic face.', level: 2 },
      ],
      table: { caption: 'Cells with markup', head: ['Corridor', 'Change'], body: [['North \u2713 South', '+18%'], ['East to West', '**+17%**']] },
      highlights: ['A bullet with **bold** inside', 'A bullet with a \u2713 inside'],
      highlights_title: 'What to check',
    },
  };
}

export function pageFillReport(variant) {
  const base = { template: 'default-report', data: { title: `Page-fill fixture: ${variant}`, subtitle: 'Synthetic content used only by the page-fitting gate', intro: 'This report is synthetic and contains no customer data.', footer: 'Synthetic page-fill fixture' } };
  if (variant === 'section') base.data.sections = [{ heading: 'A paragraph crossing a page boundary', body: `${longWords(195, 'SectionWord')}.` }];
  else if (variant === 'highlights') {
    base.data.sections = [{ heading: 'Lead content before the list', body: `${longWords(200, 'LeadWord')}.` }];
    base.data.highlights = ['The first synthetic conclusion.', 'The second synthetic conclusion.', 'The final synthetic conclusion.'];
  } else {
    base.data.sections = [{ heading: 'Lead content before the table', body: `${longWords(120, 'TableLead')}.` }];
    base.data.table = { caption: 'Synthetic table with enough rows to exercise a page tail', head: ['Route', 'Volume', 'Change'], body: Array.from({ length: 11 }, (_, index) => [`Route ${index + 1}`, `${1000 + index}`, `+${index}%`]) };
  }
  return base;
}

export function gapTighteningReport() {
  return { template: 'default-report', data: { title: 'Page-fill fixture: gap tightening', subtitle: 'Synthetic content used to exercise the second render pass', intro: `${longWords(28, 'IntroWord')}.`, sections: Array.from({ length: 4 }, (_, index) => ({ heading: `Gap section ${index + 1}`, body: `${longWords(36, 'GapWord')}.` })), highlights: ['A compact synthetic conclusion.', 'A second compact synthetic conclusion.'], footer: 'Synthetic page-fill fixture' } };
}

export function brandContractDeck() {
  return {
    title: 'Contract test',
    footer: 'Brand contract test',
    overrides: { fit: { strategy: 'shrink-to-fit', min_heading_pt: 24, min_body_pt: 10 } },
    slides: [
      { layout: 'title', brand_ref: 'brand://orbit/primary', flows: {
        title: { blocks: [{ type: 'heading', text: 'A deliberately long title that must be fitted into the selected brand safe area' }] },
        subtitle: { blocks: [{ type: 'text', text: 'The title uses the same resolved profile in PNG and PPTX.' }] },
      } },
      { layout: 'metrics', brand_ref: 'brand://pyrus/surfaces/light', flows: {
        title: { blocks: [{ type: 'heading', text: 'A second brand on the same deck' }] },
        subtitle: { blocks: [{ type: 'text', text: 'Per-slide profile selection is part of the public contract.' }] },
        main: { blocks: [{ type: 'metric', label: 'Signal', value: '64.2%', delta: '+6.4 pp', trend: 'up' }] },
      } },
    ],
  };
}
