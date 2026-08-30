#!/usr/bin/env node

// PROTOTYPE — disposable named-flow/partition experiment.
// It answers whether an editorial reserved slot can be expressed as two
// independent flows without CSS Grid deciding the page break accidentally.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const args = process.argv.slice(2);
const outputDir = resolve(args.includes('--out')
  ? args[args.indexOf('--out') + 1]
  : '/tmp/report-baby-editorial-reserved-slot-spike');
const render = args.includes('--render');
const selectedCase = args.includes('--case') ? args[args.indexOf('--case') + 1] : null;
const vivliostyleVersion = '11.2.0';
const configPath = resolve(new URL('../templates/editorial-engine-prototype.yml', import.meta.url).pathname);
const config = parse(readFileSync(configPath, 'utf8'));

const words = [
  'editorial', 'layout', 'reader', 'article', 'transport', 'service', 'market',
  'measured', 'reliable', 'content', 'platform', 'graphic', 'section', 'column',
  'paragraph', 'context', 'quality', 'system', 'decision', 'continuation',
];

function text(seed, count = 120) {
  return Array.from({ length: count }, (_, index) => words[(seed + index * 7) % words.length]).join(' ');
}

function paragraphs(seed, count, wordsPerParagraph) {
  return Array.from({ length: count }, (_, index) => `<p>${text(seed + index * 3, wordsPerParagraph)}</p>`).join('\n');
}

function mm(value) {
  return `${value}mm`;
}

function pageCss(id) {
  const { page, type } = config;
  const sideLeft = page.content_left_mm + page.lead_width_mm + page.side_gap_mm;
  const contentHeight = page.height_mm - page.content_top_mm - page.content_bottom_mm;
  const mediaPartition = ['reserved', 'tooTallMedia'].includes(id) ? `
    @-epubx-partition media {
      -epubx-flow-from: media;
      left: ${mm(sideLeft)};
      top: ${mm(page.content_top_mm)};
      width: ${mm(page.side_width_mm)};
      height: ${mm(contentHeight)};
      padding: 0;
      overflow: visible;
      z-index: 2;
    }` : '';
  const sidebarPartition = id === 'sidebarOverflow' ? `
    @-epubx-partition side {
      -epubx-flow-from: sidebar;
      left: ${mm(sideLeft)};
      top: ${mm(page.content_top_mm)};
      width: ${mm(page.side_width_mm)};
      bottom: ${mm(page.content_bottom_mm)};
      padding: ${mm(type.sidebar_padding_mm)};
      background: #edf5e9;
      overflow: hidden;
    }` : '';
  return `
@page { size: ${mm(page.width_mm)} ${mm(page.height_mm)}; margin: 0; }
* { box-sizing: border-box; }
html { font-family: Arial, sans-serif; color: #1c202a; }
body { margin: 0; font-size: ${type.body_pt}pt; line-height: ${type.body_line_height}; }
h1 { font-size: ${type.heading_pt}pt; line-height: 1.08; margin: 0 0 ${mm(type.block_gap_mm)}; }
h2 { font-size: ${type.section_heading_pt}pt; line-height: 1.08; margin: ${mm(type.block_gap_mm)} 0 ${mm(type.block_gap_mm / 1.5)}; }
p { margin: 0 0 ${mm(type.block_gap_mm)}; text-align: justify; }
.label { color: #687080; font-size: ${type.label_pt}pt; text-transform: uppercase; letter-spacing: .08em; }
.intro { background: #f4f4f0; padding: ${mm(type.intro_padding_mm)}; margin-bottom: ${mm(type.block_gap_mm)}; font-weight: 700; }
.keep-cluster { break-inside: avoid; }
.keep-cluster p { text-align: left; margin-bottom: 0; }
@-epubx-page-template {
  body { margin: 0; }
  .sidebar-flow { -epubx-flow-into: sidebar; }
  .media-flow { -epubx-flow-into: media; }
  @-epubx-flow sidebar { -epubx-flow-consume: all; }
  @-epubx-flow media { -epubx-flow-consume: some; }
  @-epubx-page-master {
    @-epubx-partition lead {
      -epubx-flow-from: body;
      left: ${mm(page.content_left_mm)};
      top: ${mm(page.content_top_mm)};
      width: ${mm(page.lead_width_mm)};
      bottom: ${mm(page.content_bottom_mm)};
      padding: 0;
    }
    ${sidebarPartition}
    ${mediaPartition}
  }
}
.reserved-image { height: ${mm(page.media_height_mm)}; background: #d47054; color: white; padding: ${mm(type.sidebar_padding_mm)}; background-image: repeating-linear-gradient(135deg, transparent 0 8mm, rgba(255,255,255,.8) 8mm 8.6mm); }
.too-tall-image { height: ${mm(page.too_tall_media_height_mm)}; background: #9b4d70; color: white; padding: ${mm(type.sidebar_padding_mm)}; background-image: repeating-linear-gradient(135deg, transparent 0 8mm, rgba(255,255,255,.8) 8mm 8.6mm); }
.sidebar-note { border-top: 1px solid #79a36f; margin-top: ${mm(type.block_gap_mm)}; padding-top: ${mm(type.block_gap_mm)}; }
`;
}

const cases = {
  reserved: {
    expected: {
      samePage: ['lead-start', 'reserved-image'],
      continuation: ['lead-continuation'],
      noHorizontalCollision: true,
    },
    html: `<div class="lead-flow"><div class="label">reserved / named flows</div><h1>Lead and image occupy one planned page</h1><div class="intro">The lead is its own flow. The image is a separate flow assigned to a fixed side partition.</div><h2>Lead stream</h2><p>lead-start ${text(1, 85)}</p>${paragraphs(3, 8, 115)}<p>lead-continuation ${text(8, 110)}</p></div><div class="media-flow"><div class="reserved-image">reserved-image</div><div class="label">media flow, consumed once</div></div>`,
  },
  sidebarOverflow: {
    expected: {
      samePage: ['lead-start', 'sidebar-start'],
      continuation: ['sidebar-end'],
      noLeadTextInSidebar: true,
    },
    html: `<div class="lead-flow"><div class="label">sidebar / independent continuation</div><h1>Sidebar may outlive the first page</h1><div class="intro">The sidebar has its own flow and is allowed to continue in the same partition on later pages.</div><p>lead-start ${text(5, 85)}</p>${paragraphs(8, 15, 125)}<p>lead-after-sidebar ${text(12, 90)}</p></div><aside class="sidebar-flow"><h2>Sidebar</h2><p>sidebar-start ${text(31, 100)}</p>${paragraphs(35, 10, 130)}<p class="sidebar-note">sidebar-end ${text(42, 90)}</p></aside>`,
  },
  keepCluster: {
    expected: {
      samePage: ['KEEP-HEADER', 'KEEP-THREE-LINES'],
      noSolitaryHeader: true,
    },
    html: `<div class="lead-flow"><div class="label">keep / heading cluster</div><h1>Keep constraints across fragmentainers</h1>${paragraphs(51, 9, 125)}<section class="keep-cluster"><h2>KEEP-HEADER</h2><p>KEEP-THREE-LINES one two three four five six seven eight nine ten eleven twelve.</p></section>${paragraphs(56, 5, 120)}</div>`,
  },
  tooTallMedia: {
    expected: {
      mediaMustFit: false,
      expectedDiagnostic: 'media exceeds partition height',
    },
    html: `<div class="lead-flow"><div class="label">failure / impossible geometry</div><h1>Image exceeds its reserved partition</h1><div class="intro">The evaluator must reject clipping or silent overflow instead of accepting the PDF.</div>${paragraphs(63, 7, 110)}</div><div class="media-flow"><div class="too-tall-image">too-tall-image</div></div>`,
  },
};

function renderCase(id, sourcePath, pdfPath, logPath) {
  try {
    const output = execFileSync('npx', [
      '--yes', `@vivliostyle/cli@${vivliostyleVersion}`,
      'build', sourcePath, '--output', pdfPath, '--size', 'A4', '--single-doc', '--log-level', 'verbose',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
    writeFileSync(logPath, output);
    execFileSync('pdftoppm', ['-png', '-r', '96', pdfPath, join(outputDir, 'vivliostyle', id, 'page')], { stdio: 'ignore', timeout: 30000 });
    return { status: 'rendered', pdf: pdfPath };
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? error}`;
    writeFileSync(logPath, output);
    return { status: 'failed', error: String(error.message ?? error) };
  }
}

function extractPages(pdfPath, pageCount) {
  return Array.from({ length: pageCount }, (_, index) => {
    try {
      return execFileSync('pdftotext', ['-f', String(index + 1), '-l', String(index + 1), pdfPath, '-'], { encoding: 'utf8', timeout: 30000 });
    } catch {
      return '';
    }
  });
}

function evaluate(id, definition, pdfPath) {
  try {
    const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8', timeout: 30000 });
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0);
    const pageText = extractPages(pdfPath, pages);
    const locate = (marker) => pageText.findIndex((content) => content.includes(marker)) + 1;
    const allText = pageText.join('\n');
    const expected = definition.expected;
    const samePage = expected.samePage?.every((marker) => locate(marker) === locate(expected.samePage[0])) ?? true;
    const continuation = expected.continuation?.every((marker) => locate(marker) > 1) ?? true;
    const noDuplicateMarkers = [...(expected.samePage ?? []), ...(expected.continuation ?? [])].every((marker) => allText.split(marker).length - 1 === 1);
    const mediaVisible = locate('too-tall-image') > 0;
    const result = id === 'tooTallMedia'
      ? { status: mediaVisible ? 'needs-rejection' : 'rejected-by-render', pages, mediaVisible, diagnostic: expected.expectedDiagnostic }
      : { status: samePage && continuation && noDuplicateMarkers ? 'pass-basic' : 'needs-policy', pages, samePage, continuation, noDuplicateMarkers };
    return { ...result, markers: Object.fromEntries([...(expected.samePage ?? []), ...(expected.continuation ?? []), 'too-tall-image'].map((marker) => [marker, locate(marker)])) };
  } catch (error) {
    return { status: 'evaluation-failed', error: String(error.message ?? error) };
  }
}

mkdirSync(join(outputDir, 'cases'), { recursive: true });
mkdirSync(join(outputDir, 'vivliostyle'), { recursive: true });
const manifest = {
  prototype: 'editorial-reserved-slot-spike',
  date: '2026-08-26',
  config: configPath,
  backend: { name: 'Vivliostyle CLI', version: vivliostyleVersion, rendered: render },
  cases: [],
};

for (const [id, definition] of Object.entries(cases).filter(([caseId]) => !selectedCase || caseId === selectedCase)) {
  const sourcePath = join(outputDir, 'cases', `${id}.html`);
  const pdfPath = join(outputDir, 'vivliostyle', id, `${id}.pdf`);
  const logPath = join(outputDir, 'vivliostyle', id, 'build.log');
  mkdirSync(join(outputDir, 'vivliostyle', id), { recursive: true });
  writeFileSync(sourcePath, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${id}</title><style>${pageCss(id)}</style></head><body>${definition.html}</body></html>\n`);
  const result = render ? renderCase(id, sourcePath, pdfPath, logPath) : { status: 'source-only' };
  const evaluation = result.status === 'rendered' ? evaluate(id, definition, pdfPath) : { status: 'not-rendered' };
  manifest.cases.push({ id, expected: definition.expected, source: sourcePath, result, evaluation });
}

writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(outputDir, 'README.md'), `# Editorial reserved-slot spike\n\nGenerated by the disposable Report Baby prototype.\n\nCases: ${Object.keys(cases).join(', ')}.\n\nThis experiment tests Vivliostyle EPUB Adaptive Layout named flows and partitions. Evaluation is a first-pass marker/continuation check; visual inspection is still required.\n`);
console.log(JSON.stringify(manifest, null, 2));
