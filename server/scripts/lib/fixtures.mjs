import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const longWords = (count, word) => Array.from({ length: count }, (_, index) => `${word}${index + 1}`).join(' ');

export async function writePublicBrandFixture(brandDir) {
  await mkdir(join(brandDir, 'acme', 'profiles'), { recursive: true });
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
  await writeFile(join(brandDir, 'acme', 'profiles', 'primary.yml'), `
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
      { type: 'title', title: 'Quarterly signal review', subtitle: 'A synthetic deck used only by the visual QA harness', eyebrow: 'PERIOD 02 / SIGNALS' },
      {
        type: 'metrics',
        title: 'Signal board',
        subtitle: 'Three headline measures',
        body: 'Every value below is invented for the harness and carries no customer meaning.',
        callout: 'One callout line under the grid.',
        metrics: [
          { label: 'Active teams', value: '18.4k', delta: '+12.8%', trend: 'up', note: 'vs prior period' },
          { label: 'Activation', value: '64.2%', delta: '+6.4 pp', trend: 'up', note: 'first-week cohort' },
          { label: 'Expansion', value: '2.8m', delta: '-1.2%', trend: 'down', note: 'qualified pipeline' },
        ],
      },
      { type: 'chart', title: 'Weekly trend', subtitle: 'Bar chart with six buckets', chart: { type: 'bar', data: [{ label: 'W1', value: 112 }, { label: 'W2', value: 124 }, { label: 'W3', value: 139 }, { label: 'W4', value: 154 }, { label: 'W5', value: 184 }, { label: 'W6', value: 176 }] } },
      { type: 'table', title: 'Channel summary', subtitle: 'Five rows, three columns', head: ['Channel', 'Volume', 'Change'], body: [['Search', '4 210', '+8%'], ['Social', '2 980', '+3%'], ['Email', '1 640', '-2%'], ['Direct', '1 120', '+11%'], ['Referral', '640', '+1%']] },
      { type: 'narrative', title: 'What the numbers say', subtitle: 'A short reading', body: 'The fixture text stays short enough to fit the narrative slot at the template default size.', highlights: ['Keep the first result visible.', 'Turn repeat use into a habit.'] },
      { type: 'conclusions', title: 'Decisions', items: ['Scale the channels that already convert.', 'Watch acquisition cost weekly.', 'Re-test the onboarding step.'] },
      { type: 'columns', template_ref: 'slides/two-column', title: 'One decision, two views', subtitle: 'A slide-only layout from an external template file', columns: [{ heading: 'Signal', body: 'The left column carries the evidence and a short explanation.', highlights: ['One source of truth'] }, { heading: 'Action', body: 'The right column carries the response and the next step.', highlights: ['One clear decision'] }] },
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
      { type: 'title', title: 'A deliberately long title that must be fitted into the selected brand safe area', subtitle: 'The title uses the same resolved profile in PNG and PPTX.', brand_ref: 'brand://orbit/primary' },
      { type: 'metrics', title: 'A second brand on the same deck', subtitle: 'Per-slide profile selection is part of the public contract.', brand_ref: 'brand://pyrus/surfaces/light', metrics: [{ label: 'Signal', value: '64.2%', delta: '+6.4 pp', trend: 'up' }] },
    ],
  };
}
