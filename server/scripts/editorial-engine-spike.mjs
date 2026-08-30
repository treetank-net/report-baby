#!/usr/bin/env node

// PROTOTYPE — disposable cross-engine fixture generator.
// It creates the same small HTML/CSS cases for a paged-media backend.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-editorial-engine-spike');
const render = process.argv.includes('--render');
const vivliostyleVersion = '11.2.0';

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

const baseCss = `
@page { size: A4; margin: 15mm; }
* { box-sizing: border-box; }
html { font-family: Arial, sans-serif; color: #1c202a; }
body { margin: 0; font-size: 10pt; line-height: 1.35; }
h1 { font-size: 18pt; line-height: 1.08; margin: 0 0 5mm; }
h2 { font-size: 13pt; line-height: 1.08; margin: 3mm 0 2mm; }
p { margin: 0 0 2.5mm; text-align: justify; }
.case { break-before: page; }
.case:first-child { break-before: auto; }
.label { color: #687080; font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; }
.intro { background: #f4f4f0; padding: 4mm; margin-bottom: 5mm; font-weight: 700; }
.columns { column-count: 2; column-gap: 6mm; column-fill: balance; }
.columns > * { break-inside: avoid; }
.spanner { column-span: all; background: #f4f4f0; padding: 3mm; }
.slot-layout { display: grid; grid-template-columns: 1.5fr 1fr; gap: 6mm; align-items: start; }
.slot-lead { grid-column: 1; }
.slot-secondary { grid-column: 2; }
.slot-image { height: 150mm; background: #d47054; color: white; padding: 3mm; margin-bottom: 4mm; background-image: repeating-linear-gradient(135deg, transparent 0 8mm, rgba(255,255,255,.8) 8mm 8.6mm); }
.float-columns { column-count: 2; column-gap: 6mm; column-fill: balance; }
.shape-float { float: right; width: 35mm; height: 52mm; margin: 0 0 3mm 4mm; background: #5284c6; shape-outside: ellipse(50% 50% at 50% 50%); clip-path: ellipse(50% 50% at 50% 50%); color: white; padding: 4mm; }
.page-float { float: block-start; float-reference: page; width: 70mm; height: 55mm; margin: 0 0 4mm 4mm; background: #70a470; color: white; padding: 4mm; }
.vertical { writing-mode: vertical-rl; height: 230mm; column-count: 2; column-gap: 8mm; column-fill: auto; }
.vertical p { text-align: start; margin-left: 3mm; }
`;

const cases = {
  slot: {
    expected: ['explicit slot owns secondary track', 'lead text remains in normal flow', 'text after image starts below image'],
    html: `<div class="case"><div class="label">slot / reserved track</div><h1>Reserved editorial image slot</h1><div class="intro">The image is not an accidental block in the text stream.</div><main class="slot-layout"><section class="slot-lead"><h2>Lead stream</h2>${paragraphs(1, 4, 95)}</section><section class="slot-secondary"><div class="slot-image">reserved-slot</div><h2>Secondary continuation</h2>${paragraphs(4, 2, 55)}</section></main></div>`,
  },
  float: {
    expected: ['float changes only intersecting line intervals', 'ellipse is paint and exclusion geometry', 'later blocks continue normally'],
    html: `<div class="case"><div class="label">float / shape-outside</div><h1>Text wrapping around an ellipse</h1><div class="intro">The exclusion area is elliptical, not a rectangular collision box.</div><main class="float-columns"><div class="shape-float">ellipse-float</div>${paragraphs(8, 7, 95)}</main></div>`,
  },
  span: {
    expected: ['intro is a spanner across both columns', 'flow before and after spanner is recomposed', 'no text appears beside the spanner'],
    html: `<div class="case"><div class="label">spanner / column-span</div><h1>Intro spanning the article columns</h1><main class="columns"><h2 class="spanner">This block spans all columns</h2>${paragraphs(12, 8, 95)}</main></div>`,
  },
  continuation: {
    expected: ['source text continues across columns and pages', 'no duplicate paragraph ranges', 'page 2 uses the continuation geometry'],
    html: `<div class="case"><div class="label">continuation / fragmentainers</div><h1>Long continuation fixture</h1><main class="columns">${paragraphs(17, 22, 105)}</main></div>`,
  },
  pageFloat: {
    expected: ['page float may defer from anchor to page region', 'float does not collide with body text', 'placement is not silently treated as normal block'],
    html: `<div class="case"><div class="label">page float / defer</div><h1>Page-level editorial float</h1><main class="columns"><div class="page-float">page-float</div>${paragraphs(21, 10, 100)}</main></div>`,
  },
  vertical: {
    expected: ['vertical-rl changes logical axes and column progression', 'mixed Latin text remains readable', 'continuation does not assume physical x/y flow'],
    html: `<div class="case"><div class="label">writing-mode / vertical-rl</div><h1>Vertical writing fixture</h1><main class="vertical"><p>縦書きの編集記事です。${text(25, 80)} Report Baby 2026。</p><p>日本語の本文と Latin words を混在させ、縦方向の組版と段組みの継続を確認します。${text(28, 80)}</p></main></div>`,
  },
};

function renderCase(id, sourcePath, pdfPath, logPath) {
  try {
    const output = execFileSync('npx', [
      '--yes', `@vivliostyle/cli@${vivliostyleVersion}`,
      'build', sourcePath, '--output', pdfPath, '--size', 'A4', '--single-doc', '--log-level', 'verbose',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(logPath, output);
    execFileSync('pdftoppm', ['-png', '-r', '96', pdfPath, join(outputDir, 'vivliostyle', id, 'page')], { stdio: 'ignore' });
    return { status: 'rendered', pdf: pdfPath };
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? error}`;
    writeFileSync(logPath, output);
    return { status: 'failed', error: String(error.message ?? error) };
  }
}

mkdirSync(join(outputDir, 'cases'), { recursive: true });
mkdirSync(join(outputDir, 'vivliostyle'), { recursive: true });
const manifest = {
  prototype: 'editorial-engine-spike',
  date: '2026-08-26',
  backend: { name: 'Vivliostyle CLI', version: vivliostyleVersion, rendered: render },
  cases: [],
};

for (const [id, definition] of Object.entries(cases)) {
  const sourcePath = join(outputDir, 'cases', `${id}.html`);
  const pdfPath = join(outputDir, 'vivliostyle', id, `${id}.pdf`);
  const logPath = join(outputDir, 'vivliostyle', id, 'build.log');
  mkdirSync(join(outputDir, 'vivliostyle', id), { recursive: true });
  writeFileSync(sourcePath, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${id}</title><style>${baseCss}</style></head><body>${definition.html}</body></html>\n`);
  const result = render ? renderCase(id, sourcePath, pdfPath, logPath) : { status: 'source-only' };
  manifest.cases.push({ id, expected: definition.expected, source: sourcePath, result });
}

writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(outputDir, 'README.md'), `# Editorial engine spike\n\nGenerated by the disposable Report Baby prototype.\n\nCases: ${Object.keys(cases).join(', ')}.\n\nThe expected results are hypotheses to verify against PDF/PNG geometry and text extraction; a rendered PDF without plan/evaluator data is not automatically accepted.\n`);
console.log(JSON.stringify(manifest, null, 2));
