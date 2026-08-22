#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { pdfContentHash, pptxContentHash, sha256, zipEntries } from './lib/artifact-inspect.mjs';
import { findOfficeConverter } from './lib/office.mjs';
import { runProcess as run } from './lib/process.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CANVAS = { width: 1600, height: 900, margin: 80 };
const PX_TO_PT = 0.6;
const LARGE_TEXT_PT = 18;
const LARGE_BOLD_PT = 14;
const AA_BODY = 4.5;
const AA_LARGE = 3;
const OFFICE_MAX_CHANGED_RATIO = 0.5;
const OFFICE_TIMEOUT_MS = 300_000;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const settings = {
  bundle: resolve(REPO_ROOT, option('bundle', 'server/example-bundle.cjs')),
  brandRoot: resolve(REPO_ROOT, option('brand-root', 'examples/brand-showcase/brands')),
  out: resolve(REPO_ROOT, option('out', 'qa/visual')),
  templateDir: option('template-dir', undefined),
  brands: option('brands', 'orbit,pyrus,flux,parcelia').split(',').map((value) => value.trim()).filter(Boolean),
  only: option('only', undefined),
  office: !flag('no-office'),
  requireOffice: flag('require-office'),
  json: option('json', undefined),
};
const reportPath = settings.json ? resolve(REPO_ROOT, settings.json) : join(settings.out, 'qa-report.json');
const templateRoot = settings.templateDir ? resolve(REPO_ROOT, settings.templateDir) : resolve(REPO_ROOT, 'server/templates');
const renderConfig = parseYaml(readFileSync(join(templateRoot, 'render-config.yml'), 'utf8'));
const pdfConfig = renderConfig.pdf;

function which(command) {
  const result = run('which', [command]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path) : null;
}

function box(value) {
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function intersection(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const width = Math.min(left.x + left.width, right.x + right.width) - x;
  const height = Math.min(left.y + left.height, right.y + right.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height, area: width * height } : null;
}

function outsideBy(inner, outer) {
  return {
    left: outer.x - inner.x,
    right: inner.x + inner.width - (outer.x + outer.width),
    top: outer.y - inner.y,
    bottom: inner.y + inner.height - (outer.y + outer.height),
  };
}

function worstOverflow(inner, outer) {
  const overflow = outsideBy(inner, outer);
  return Math.max(overflow.left, overflow.right, overflow.top, overflow.bottom);
}

function channelLuminance(value) {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2]);
}

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value ?? ''));
  if (!match) return null;
  const raw = match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
}

function contrastRatio(foreground, background) {
  const first = parseHex(foreground);
  const second = parseHex(background);
  if (!first || !second) return null;
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastRatioRgb(foreground, backgroundRgb) {
  const first = parseHex(foreground);
  if (!first) return null;
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(backgroundRgb));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(backgroundRgb));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableInkFor(background, candidates, minimum) {
  const scored = candidates
    .map((candidate) => ({ candidate, ratio: contrastRatio(candidate, background) }))
    .filter((entry) => entry.candidate && entry.ratio !== null);
  const preferred = scored.find((entry) => entry.ratio >= minimum);
  if (preferred) return preferred.candidate;
  return scored.reduce((winner, entry) => (!winner || entry.ratio > winner.ratio ? entry : winner), null)?.candidate ?? '#ffffff';
}

function minimumRatio(sizePx, bold) {
  const pt = sizePx * PX_TO_PT;
  return pt >= LARGE_TEXT_PT || (bold && pt >= LARGE_BOLD_PT) ? AA_LARGE : AA_BODY;
}

function decodePng(buffer) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG file');
  let offset = 8;
  let header;
  const data = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], colorType: chunk[9], interlace: chunk[12] };
    if (type === 'IDAT') data.push(chunk);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR chunk');
  if (header.depth !== 8 || header.interlace !== 0 || ![2, 6].includes(header.colorType)) {
    throw new Error(`unsupported PNG variant: depth ${header.depth}, colour type ${header.colorType}, interlace ${header.interlace}`);
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < header.height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = line[index];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const predicted = left + up - upLeft;
        const distanceLeft = Math.abs(predicted - left);
        const distanceUp = Math.abs(predicted - up);
        const distanceUpLeft = Math.abs(predicted - upLeft);
        value += distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
      }
      current[index] = value & 0xff;
    }
    previous = current;
  }
  return { ...header, channels, stride, pixels };
}

function pixelAt(image, x, y) {
  const offset = y * image.stride + x * image.channels;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

function pixelDiff(left, right, tolerance = 8) {
  if (left.width !== right.width || left.height !== right.height) {
    return { comparable: false, reason: `dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}` };
  }
  let differing = 0;
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const a = pixelAt(left, x, y);
      const b = pixelAt(right, x, y);
      if (Math.abs(a[0] - b[0]) > tolerance || Math.abs(a[1] - b[1]) > tolerance || Math.abs(a[2] - b[2]) > tolerance) differing += 1;
    }
  }
  const pixels = left.width * left.height;
  return { comparable: true, pixels, differing, ratio: differing / pixels };
}

function resample(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const channels = 3;
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const [r, g, b] = pixelAt(image, sourceX, sourceY);
      const offset = y * stride + x * channels;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
    }
  }
  return { width, height, channels, stride, pixels, depth: 8, colorType: 2, interlace: 0 };
}

function inkOutsideFrame(image, frame, tolerance = 12) {
  const background = pixelAt(image, 0, 0);
  let count = 0;
  const bounds = { minX: image.width, maxX: -1, minY: image.height, maxY: -1 };
  for (let y = 0; y < image.height; y += 1) {
    const insideRows = y >= frame.y && y <= frame.y + frame.height;
    for (let x = 0; x < image.width; x += 1) {
      if (insideRows && x >= frame.x && x <= frame.x + frame.width) continue;
      const [r, g, b] = pixelAt(image, x, y);
      if (Math.abs(r - background[0]) <= tolerance && Math.abs(g - background[1]) <= tolerance && Math.abs(b - background[2]) <= tolerance) continue;
      count += 1;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return { background: `#${background.map((value) => value.toString(16).padStart(2, '0')).join('')}`, count, bounds: count > 0 ? bounds : null };
}

function measuredBackground(image, slot, textColor, minimumShare = 0.02) {
  const x0 = Math.max(0, Math.round(slot.x));
  const y0 = Math.max(0, Math.round(slot.y));
  const x1 = Math.min(image.width - 1, Math.round(slot.x + slot.width));
  const y1 = Math.min(image.height - 1, Math.round(slot.y + slot.height));
  if (x1 <= x0 || y1 <= y0) return null;
  const text = parseHex(textColor);
  if (!text) return null;
  const buckets = new Map();
  let total = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const [r, g, b] = pixelAt(image, x, y);
      const nearText = Math.abs(r - text[0]) <= 96 && Math.abs(g - text[1]) <= 96 && Math.abs(b - text[2]) <= 96;
      if (nearText) continue;
      const key = `${r >> 3}:${g >> 3}:${b >> 3}`;
      const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
      buckets.set(key, bucket);
      total += 1;
    }
  }
  if (total === 0) return null;
  let worst = null;
  for (const bucket of buckets.values()) {
    const share = bucket.count / total;
    if (share < minimumShare) continue;
    const rgb = [Math.round(bucket.r / bucket.count), Math.round(bucket.g / bucket.count), Math.round(bucket.b / bucket.count)];
    const ratio = contrastRatioRgb(textColor, rgb);
    if (ratio === null) continue;
    if (!worst || ratio < worst.ratio) worst = { ratio, rgb, share };
  }
  return worst ? { ...worst, sampled: total } : null;
}

function pptxSlideCount(buffer) {
  return zipEntries(buffer).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name)).length;
}

function pdfPageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

const longWords = (count, word) => Array.from({ length: count }, (_, index) => `${word}${index + 1}`).join(' ');

function standardDeck() {
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

function standardReport() {
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

function deck(slides, extra = {}) {
  return { brand: 'QA Fixture', footer: 'Synthetic visual QA fixture', ...extra, slides };
}

function multipageReport() {
  const report = standardReport();
  return {
    ...report,
    data: {
      ...report.data,
      title: 'Long-form editorial review',
      subtitle: 'Sections that cross page breaks on purpose',
      intro: `${longWords(160, 'Lead')}.`,
      sections: Array.from({ length: 5 }, (_, index) => ({ heading: `Article ${index + 1} spanning a page break`, body: `${longWords(320, 'Body')}.` })),
    },
  };
}

function inlineMarkupReport() {
  const report = standardReport();
  return {
    ...report,
    data: {
      ...report.data,
      title: 'Inline markup and glyph fallback',
      subtitle: 'Bold runs, a glyph the brand font lacks, and two heading levels',
      intro: 'This lead carries **bold emphasis mid-sentence** and a checkmark \u2713 that the brand serif does not ship, so it has to fall back to the bundled font.',
      kpis: [
        { label: 'Bold label', value: '90%', note: 'Note with a \u2713 inside' },
        { label: 'Plain label', value: '12', note: 'Plain note' },
      ],
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

function pageFillReport(variant) {
  const base = {
    template: 'default-report',
    data: {
      title: `Page-fill fixture: ${variant}`,
      subtitle: 'Synthetic content used only by the page-fitting gate',
      intro: 'This report is synthetic and contains no customer data.',
      footer: 'Synthetic page-fill fixture',
    },
  };
  if (variant === 'section') {
    base.data.sections = [{ heading: 'A paragraph crossing a page boundary', body: `${longWords(195, 'SectionWord')}.` }];
  } else if (variant === 'highlights') {
    base.data.sections = [{ heading: 'Lead content before the list', body: `${longWords(200, 'LeadWord')}.` }];
    base.data.highlights = ['The first synthetic conclusion.', 'The second synthetic conclusion.', 'The final synthetic conclusion.'];
  } else {
    base.data.sections = [{ heading: 'Lead content before the table', body: `${longWords(120, 'TableLead')}.` }];
    base.data.table = {
      caption: 'Synthetic table with enough rows to exercise a page tail',
      head: ['Route', 'Volume', 'Change'],
      body: Array.from({ length: 11 }, (_, index) => [`Route ${index + 1}`, `${1000 + index}`, `+${index}%`]),
    };
  }
  return base;
}

function gapTighteningReport() {
  return {
    template: 'default-report',
    data: {
      title: 'Page-fill fixture: gap tightening',
      subtitle: 'Synthetic content used to exercise the second render pass',
      intro: `${longWords(28, 'IntroWord')}.`,
      sections: Array.from({ length: 4 }, (_, index) => ({ heading: `Gap section ${index + 1}`, body: `${longWords(36, 'GapWord')}.` })),
      highlights: ['A compact synthetic conclusion.', 'A second compact synthetic conclusion.'],
      footer: 'Synthetic page-fill fixture',
    },
  };
}

function buildCases() {
  const cases = [];
  for (const [index, brand] of settings.brands.entries()) {
    cases.push({
      id: `formats-${brand}-deck`,
      group: 'formats',
      brand,
      profile: 'primary',
      kind: 'deck',
      formats: ['pdf', 'png', 'pptx'],
      expect: 'render',
      input: standardDeck(),
      determinism: index === 0,
      office: index === 0 || brand === 'flux',
      inkGate: true,
    });
    cases.push({
      id: `formats-${brand}-report`,
      group: 'formats',
      brand,
      profile: 'primary',
      kind: 'report',
      formats: ['pdf'],
      expect: 'render',
      input: standardReport(),
      determinism: index === 0,
    });
  }
  if (settings.brands.includes('pyrus')) {
    cases.push({
      id: 'formats-pyrus-editorial-report',
      group: 'formats',
      brand: 'pyrus',
      profile: 'editorial',
      kind: 'report',
      formats: ['pdf'],
      expect: 'render',
      input: multipageReport(),
    });
    cases.push({
      id: 'inline-markup-report',
      group: 'formats',
      brand: 'pyrus',
      profile: 'editorial',
      kind: 'report',
      formats: ['pdf'],
      expect: 'render',
      input: inlineMarkupReport(),
      expectFontsUsed: 3,
      expectMixedFontLines: 7,
      expectWarnings: [
        /is missing 1 glyph\(s\) \(U\+2713\)/,
        /Table cells use 1 glyph\(s\) missing/,
        /Inline markup inside table cells was stripped/,
        /Italic markup was rendered upright/,
      ],
    });
    for (const variant of ['section', 'highlights', 'table']) {
      cases.push({
        id: `page-fill-${variant}`,
        group: 'page-fill',
        brand: 'pyrus',
        profile: 'editorial',
        kind: 'report',
        formats: ['pdf'],
        expect: 'render',
        input: pageFillReport(variant),
        expectPages: variant === 'table' ? 2 : 1,
      });
    }
    cases.push({
      id: 'page-fill-gap-tightening',
      group: 'page-fill',
      brand: 'pyrus',
      profile: 'editorial',
      kind: 'report',
      formats: ['pdf'],
      expect: 'render',
      input: gapTighteningReport(),
      expectPages: 1,
      expectWarnings: [/A4 report gaps tightened by factor/],
    });
    cases.push({
      id: 'formats-pyrus-editorial-deck',
      group: 'formats',
      brand: 'pyrus',
      profile: 'editorial',
      kind: 'deck',
      formats: ['pdf', 'png', 'pptx'],
      expect: 'render',
      input: standardDeck(),
      inkGate: true,
    });
  }

  const hostile = [
    { id: 'overflow-title-too-long', expect: 'reject', message: /title does not fit/i, input: deck([{ type: 'title', title: longWords(40, 'Momentum'), subtitle: 'A short subtitle' }]) },
    { id: 'overflow-title-subtitle-too-long', expect: 'reject', message: /subtitle does not fit/i, input: deck([{ type: 'title', title: 'A short title', subtitle: longWords(60, 'Context') }]) },
    { id: 'overflow-header-too-long', expect: 'reject', message: /heading does not fit/i, input: deck([{ type: 'chart', title: longWords(40, 'Heading'), chart: { type: 'bar', data: [{ label: 'One', value: 2 }] } }]) },
    { id: 'overflow-metric-value-too-long', expect: 'reject', message: /metric card .* value/i, input: deck([{ type: 'metrics', title: 'Board', metrics: [{ label: 'Value', value: '123456789012345678901234567890' }] }]) },
    { id: 'overflow-metric-note-too-long', expect: 'reject', message: /metric card .* note/i, input: deck([{ type: 'metrics', title: 'Board', metrics: [{ label: 'Note', value: '1', note: longWords(12, 'Note') }] }]) },
    { id: 'overflow-metrics-six-crowded', expect: 'reject', message: /metric card/i, input: deck([{ type: 'metrics', title: 'Board', metrics: Array.from({ length: 6 }, (_, index) => ({ label: `Very long metric label number ${index + 1}`, value: '1 234 567 890 units', delta: '+12.4 pp against the prior period', note: 'A fairly long explanatory note for the card' })) }]) },
    { id: 'capacity-metrics-six-short', expect: 'render', input: deck([{ type: 'metrics', title: 'Full grid', metrics: Array.from({ length: 6 }, (_, index) => ({ label: `KPI ${index + 1}`, value: `${index + 1}0%`, delta: '+1.2 pp', trend: 'up', note: 'vs prior' })) }]), inkGate: true },
    { id: 'overflow-table-cell-too-wide', expect: 'reject', message: /46-character/i, input: deck([{ type: 'table', title: 'Rows', head: ['Channel', 'Result'], body: [[longWords(8, 'Cell'), 1]] }]) },
    { id: 'overflow-table-too-many-rows', expect: 'reject', message: /at most 10/i, input: deck([{ type: 'table', title: 'Rows', head: ['Channel', 'Result'], body: Array.from({ length: 11 }, (_, index) => [`Row ${index + 1}`, index]) }]) },
    { id: 'overflow-conclusions-too-many', expect: 'reject', message: /conclusions/i, input: deck([{ type: 'conclusions', title: 'Wrap up', items: Array.from({ length: 8 }, (_, index) => `Item ${index + 1}`) }]) },
    { id: 'overflow-narrative-too-many-highlights', expect: 'reject', message: /narrative/i, input: deck([{ type: 'narrative', title: 'Story', body: 'One line.', highlights: Array.from({ length: 5 }, (_, index) => `Highlight ${index + 1}`) }]) },
    { id: 'overflow-narrative-body-too-long', expect: 'reject', message: /narrative body does not fit/i, input: deck([{ type: 'narrative', title: 'Story', body: longWords(240, 'Sentence') }]) },
    { id: 'overflow-narrative-highlight-too-long', expect: 'reject', message: /narrative highlight/i, input: deck([{ type: 'narrative', title: 'Story', body: 'One line.', highlights: [longWords(40, 'Highlight')] }]) },
    { id: 'overflow-columns-too-many-highlights', expect: 'reject', message: /column/i, input: deck([{ type: 'columns', template_ref: 'slides/two-column', title: 'Two views', columns: [{ heading: 'Left', body: 'One line.', highlights: ['a', 'b', 'c', 'd'] }, { heading: 'Right', body: 'One line.' }] }]) },
    { id: 'overflow-columns-body-too-long', expect: 'reject', message: /column \d body does not fit/i, input: deck([{ type: 'columns', template_ref: 'slides/two-column', title: 'Two views', columns: [{ heading: 'Left', body: longWords(200, 'Word') }, { heading: 'Right', body: 'One line.' }] }]) },
    { id: 'overflow-brand-name-too-long', expect: 'reject', message: /brand name exceeds/i, input: deck([{ type: 'narrative', title: 'Heading', body: 'One line.' }], { brand: 'A Deliberately Very Long Brand Name For The Lockup Slot' }) },
    { id: 'missing-optional-slots', expect: 'render', input: { slides: [{ type: 'title', title: 'Only a title' }, { type: 'narrative', title: 'Heading only', body: 'One line.' }] }, inkGate: true },
    { id: 'silent-overflow-footer', expect: 'render', input: deck([{ type: 'narrative', title: 'Heading', body: 'One line.' }], { footer: longWords(60, 'Footer') }), inkGate: true },
    { id: 'silent-overflow-conclusion-item', expect: 'render', input: deck([{ type: 'conclusions', title: 'Wrap up', items: [longWords(30, 'Conclusion'), 'A short item'] }]), inkGate: true },
    { id: 'silent-overflow-wide-table', expect: 'render', input: deck([{ type: 'table', title: 'Wide table', head: Array.from({ length: 8 }, (_, index) => `Column ${index + 1}`), body: [Array.from({ length: 8 }, (_, index) => `Cell value ${index + 1} with length`)] }]), inkGate: true },
  ];
  for (const item of hostile) {
    cases.push({ group: 'overflow', brand: 'orbit', profile: 'primary', kind: 'deck', formats: ['pdf', 'png', 'pptx'], ...item });
  }
  if (settings.brands.includes('flux')) {
    cases.push({ id: 'overflow-brand-template-two-metrics', group: 'overflow', brand: 'flux', profile: 'primary', kind: 'deck', formats: ['png'], expect: 'reject', message: /exactly three metrics/i, input: deck([{ type: 'metrics', template_ref: 'slides/metrics-3', title: 'Board', metrics: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }] }]) });
    cases.push({ id: 'capacity-brand-template-three-metrics', group: 'overflow', brand: 'flux', profile: 'primary', kind: 'deck', formats: ['pdf', 'png', 'pptx'], expect: 'render', input: deck([{ type: 'metrics', template_ref: 'slides/metrics-3', title: 'Board', subtitle: 'Brand template', metrics: [{ label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }] }]) });
  }
  return settings.only ? cases.filter((item) => item.id.includes(settings.only)) : cases;
}

function renderCase(item, directory) {
  mkdirSync(directory, { recursive: true });
  const inputPath = join(directory, 'input.json');
  writeFileSync(inputPath, `${JSON.stringify(item.input, null, 2)}\n`);
  const outputDir = join(directory, 'out');
  const environment = { ...process.env };
  if (settings.templateDir) environment.REPORT_BABY_TEMPLATE_DIR = resolve(REPO_ROOT, settings.templateDir);
  const result = run(process.execPath, [
    settings.bundle,
    '--kind', item.kind,
    '--brand-root', settings.brandRoot,
    '--brand', `brand://${item.brand}/${item.profile}`,
    '--input', inputPath,
    '--out', outputDir,
    '--formats', item.formats.join(','),
  ], { cwd: REPO_ROOT, env: environment });
  const manifestPath = join(outputDir, 'manifest.json');
  const manifest = result.status === 0 && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  const diagnosticLines = [result.stderr, result.stdout, result.error ?? '']
    .join('\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { result, outputDir, manifest, message: diagnosticLines.find((line) => !line.startsWith('at ') && !line.startsWith('Node.js')) ?? '', stderr: result.stderr };
}

function themeContrastPairs(theme, kind) {
  const onGraphic = Boolean(theme.hasCoverImage) || theme.headerStyle === 'dark-band' || (theme.headerStyle === 'image-band' && Boolean(theme.hasBackgroundImage));
  const bandBackground = theme.headerStyle === 'accent-band' ? theme.primary : theme.background;
  const bandText = ['accent-band', 'dark-band'].includes(theme.headerStyle) ? '#ffffff' : theme.headerStyle === 'image-band' ? theme.imageTextColor : theme.foreground;
  const proxy = theme.headerStyle === 'image-band' || Boolean(theme.hasCoverImage);
  const pairs = [
    { role: 'slide body text', foreground: theme.foreground, background: theme.background, sizePx: 25, bold: false },
    { role: 'metric label on card', foreground: theme.muted, background: theme.surface, sizePx: 19, bold: false },
    { role: 'metric value on card', foreground: theme.foreground, background: theme.surface, sizePx: 48, bold: true },
    { role: 'metric delta up on card', foreground: theme.success, background: theme.surface, sizePx: 23, bold: true },
    { role: 'metric delta down on card', foreground: theme.danger, background: theme.surface, sizePx: 23, bold: true },
    { role: 'metric note on card', foreground: theme.muted, background: theme.surface, sizePx: 18, bold: false },
    { role: 'table text', foreground: theme.foreground, background: theme.background, sizePx: 19, bold: false },
    { role: 'footer text', foreground: theme.muted, background: theme.background, sizePx: 16, bold: false },
  ];
  if (kind === 'deck') {
    pairs.push({ role: 'header title on band', foreground: bandText, background: bandBackground, sizePx: 48, bold: true, proxy });
    pairs.push({ role: 'header subtitle on band', foreground: ['accent-band', 'dark-band'].includes(theme.headerStyle) ? '#ffffff' : theme.headerStyle === 'image-band' ? theme.imageTextColor : theme.muted, background: bandBackground, sizePx: 23, bold: false, proxy });
    pairs.push({ role: 'title slide title', foreground: onGraphic ? theme.titleColor : theme.foreground, background: theme.coverBackground ?? theme.background, sizePx: 66, bold: true, proxy: onGraphic && proxy });
    pairs.push({ role: 'title slide subtitle', foreground: onGraphic ? theme.titleSubtitleColor : theme.muted, background: theme.coverBackground ?? theme.background, sizePx: 30, bold: false, proxy: onGraphic && proxy });
    pairs.push({ role: 'title slide eyebrow', foreground: onGraphic ? theme.titleAccentColor : theme.primary, background: theme.coverBackground ?? theme.background, sizePx: 24, bold: true, proxy: onGraphic && proxy });
  } else {
    const reportBand = theme.reportHeaderStyle === 'accent-band' ? theme.primary : theme.background;
    const reportText = ['accent-band', 'dark-band'].includes(theme.reportHeaderStyle) ? '#ffffff' : theme.reportHeaderStyle === 'image-band' ? theme.imageTextColor : theme.foreground;
    pairs.push({ role: 'report header title', foreground: reportText, background: reportBand, sizePx: 48, bold: true, proxy: theme.reportHeaderStyle === 'image-band' });
    pairs.push({ role: 'report header subtitle', foreground: ['accent-band', 'dark-band'].includes(theme.reportHeaderStyle) ? '#ffffff' : theme.muted, background: reportBand, sizePx: 23, bold: false, proxy: theme.reportHeaderStyle === 'image-band' });
  }
  const tableHeaderInk = readableInkFor(theme.primary, ['#ffffff', theme.background, theme.foreground, '#000000'], 3);
  pairs.push({ role: 'table header on primary', foreground: tableHeaderInk, background: theme.primary, sizePx: 19, bold: true, proxy: false });
  pairs.push({ role: 'table body on page', foreground: theme.foreground, background: theme.background, sizePx: 18, bold: false, proxy: false });
  pairs.push({ role: 'table body on alternate row', foreground: theme.foreground, background: theme.soft ?? theme.surface, sizePx: 18, bold: false, proxy: false });
  return pairs;
}

function gateThemeContrast(item, rendered, checks) {
  const themes = [{ label: 'deck theme', theme: rendered.manifest.theme }];
  for (const [index, theme] of (rendered.manifest.slideThemes ?? []).entries()) {
    if (theme) themes.push({ label: `slide ${index + 1} theme`, theme });
  }
  const seen = new Set();
  for (const entry of themes) {
    for (const pair of themeContrastPairs(entry.theme, item.kind)) {
      const ratio = contrastRatio(pair.foreground, pair.background);
      const minimum = minimumRatio(pair.sizePx, pair.bold);
      const key = `${pair.role}|${pair.foreground}|${pair.background}|${minimum}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ratio === null) {
        checks.push({ gate: 'contrast-theme', name: `${pair.role}`, status: 'fail', message: `unresolved colour pair ${pair.foreground} on ${pair.background} (${entry.label})` });
        continue;
      }
      const passes = ratio >= minimum;
      checks.push({
        gate: 'contrast-theme',
        name: pair.role,
        status: passes ? 'pass' : pair.proxy ? 'warn' : 'fail',
        message: `${ratio.toFixed(2)}:1 against a required ${minimum}:1 for ${pair.foreground} on ${pair.background}${pair.proxy ? ' (flat-colour proxy for an image surface)' : ''}`,
        ratio: Number(ratio.toFixed(3)),
        minimum,
        proxy: Boolean(pair.proxy),
      });
    }
  }
}

function gateMeasuredContrast(item, rendered, checks, images) {
  const manifest = rendered.manifest;
  const slides = item.input.slides ?? [];
  for (const [index, slide] of slides.entries()) {
    const image = images[index];
    const plan = manifest.slidePlans?.[index];
    const theme = manifest.slideThemes?.[index] ?? manifest.theme;
    if (!image || !plan || !theme) continue;
    const onGraphic = Boolean(theme.hasCoverImage) || theme.headerStyle === 'dark-band' || (theme.headerStyle === 'image-band' && Boolean(theme.hasBackgroundImage));
    const band = ['accent-band', 'dark-band'].includes(theme.headerStyle);
    const targets = slide.type === 'title'
      ? [
        { slot: 'title', color: onGraphic ? theme.titleColor : theme.foreground, sizePx: 66, bold: true, region: plan.slotBoxes.title },
        { slot: 'subtitle', color: onGraphic ? theme.titleSubtitleColor : theme.muted, sizePx: 30, bold: false, region: plan.slotBoxes.subtitle },
      ]
      : [
        { slot: 'header title', color: band ? '#ffffff' : theme.headerStyle === 'image-band' && theme.hasBackgroundImage ? theme.imageTextColor : theme.foreground, sizePx: 48, bold: true, region: plan.slotBoxes.title },
        { slot: 'header subtitle', color: band ? '#ffffff' : theme.headerStyle === 'image-band' && theme.hasBackgroundImage ? theme.imageTextColor : theme.muted, sizePx: 23, bold: false, region: plan.slotBoxes.subtitle },
        { slot: 'footer', color: theme.headerStyle === 'image-band' && theme.hasBackgroundImage ? theme.titleSubtitleColor : theme.muted, sizePx: 16, bold: false, region: plan.slotBoxes.footer },
      ];
    if (slide.type === 'table') {
      const region = plan.slotBoxes?.table;
      const rows = slide.body?.length ?? 0;
      if (region && rows > 0) {
        const bodyTop = region.y + region.height / (rows + 1);
        targets.push({ slot: 'table body', color: theme.foreground, sizePx: 18, bold: false, region: { x: region.x, y: bodyTop, width: region.width, height: region.y + region.height - bodyTop } });
      }
    }
    for (const target of targets) {
      if (!target.region || !slide.title) continue;
      if (target.slot.includes('subtitle') && !slide.subtitle) continue;
      const measured = measuredBackground(image, target.region, target.color);
      const minimum = minimumRatio(target.sizePx, target.bold);
      if (!measured) {
        checks.push({ gate: 'contrast-measured', name: `slide ${index + 1} ${target.slot}`, status: 'skip', message: 'no background pixels distinguishable from the text colour in this slot' });
        continue;
      }
      checks.push({
        gate: 'contrast-measured',
        name: `slide ${index + 1} ${target.slot}`,
        status: measured.ratio >= minimum ? 'pass' : 'fail',
        message: `${measured.ratio.toFixed(2)}:1 against a required ${minimum}:1 for ${target.color} over the rendered background rgb(${measured.rgb.join(', ')}) covering ${(measured.share * 100).toFixed(1)}% of the slot`,
        ratio: Number(measured.ratio.toFixed(3)),
        minimum,
      });
    }
  }
}

const CONTENT_SLOTS = {
  title: [],
  metrics: ['metric-1', 'metric-2', 'metric-3', 'metric-4', 'metric-5', 'metric-6', 'body', 'callout'],
  chart: ['chart'],
  table: ['table'],
  narrative: ['narrative', 'narrative-highlight-1', 'narrative-highlight-2', 'narrative-highlight-3', 'narrative-highlight-4'],
  conclusions: ['conclusions'],
  columns: ['left', 'right'],
};

function usedContentSlots(slide) {
  const declared = CONTENT_SLOTS[slide.type] ?? [];
  if (slide.type === 'metrics') {
    const cards = declared.filter((name) => name.startsWith('metric-')).slice(0, slide.metrics?.length ?? 0);
    return [...cards, ...(slide.body ? ['body'] : []), ...(slide.callout ? ['callout'] : [])];
  }
  if (slide.type === 'narrative') {
    return ['narrative', ...(slide.highlights ?? []).map((_, index) => `narrative-highlight-${index + 1}`)];
  }
  return declared;
}

function pdfContentStreams(buffer) {
  return pdfPageContentStreams(buffer).filter((stream) => stream.includes(' Tj') || stream.includes(' TJ'));
}

function decodePdfObjectStream(objectBody) {
  const match = /stream\r?\n([\s\S]*?)endstream/.exec(objectBody);
  if (!match) return null;
  const compressed = Buffer.from(match[1], 'latin1');
  for (const decode of [inflateSync, inflateRawSync]) {
    try {
      return decode(compressed).toString('latin1');
    } catch {
      // Try the other common PDF stream encoding.
    }
  }
  return null;
}

function pdfPageContentStreams(buffer) {
  const source = buffer.toString('latin1');
  const objects = new Map();
  for (const match of source.matchAll(/(\d+)\s+0\s+obj([\s\S]*?)endobj/g)) objects.set(Number(match[1]), match[2]);
  const pages = [];
  for (const body of objects.values()) {
    if (!/\/Type\s*\/Page\b/.test(body)) continue;
    const contents = /\/Contents\s*(\[[\s\S]*?\]|\d+\s+0\s+R)/.exec(body)?.[1] ?? '';
    const ids = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((match) => Number(match[1]));
    const streams = ids.map((id) => decodePdfObjectStream(objects.get(id) ?? '')).filter((stream) => stream !== null);
    pages.push(streams.join('\n'));
  }
  return pages;
}

function pdfTextOnFill(stream) {
  const tokens = stream.split(/\s+/);
  const rectangles = [];
  const images = [];
  const drawn = [];
  let fill = null;
  let fontSize = 12;
  let position = null;
  let pendingRect = null;
  let clip = null;
  let matrix = [];
  let leading = 0;
  const clipStack = [];
  const numbers = [];
  const intersect = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const top = Math.min(a.y + a.height, b.y + b.height);
    return right <= x || top <= y ? null : { x, y, width: right - x, height: top - y };
  };
  const asColor = (channels) => `#${channels.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0')).join('')}`;
  for (const token of tokens) {
    const value = Number.parseFloat(token);
    if (!Number.isNaN(value) && /^-?[\d.]+$/.test(token)) {
      numbers.push(value);
      continue;
    }
    const tail = (count) => numbers.slice(-count);
    if (token === 'rg') fill = asColor(tail(3));
    else if (token === 'g') fill = asColor([tail(1)[0], tail(1)[0], tail(1)[0]]);
    else if (token === 'k') {
      const [c, m, y, k] = tail(4);
      fill = asColor([(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]);
    } else if (token === 're') {
      const [x, y, width, height] = tail(4);
      pendingRect = { x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height) };
    } else if ((token === 'f' || token === 'f*' || token === 'B') && pendingRect && fill) {
      rectangles.push({ ...pendingRect, color: fill });
      pendingRect = null;
    } else if (token === 'Tf') fontSize = tail(2)[0];
    else if (token === 'Td' || token === 'TD') position = { x: tail(2)[0], y: tail(2)[1] };
    else if (token === 'Tm') position = { x: tail(6)[4], y: tail(6)[5] };
    else if (token === 'TL') leading = tail(1)[0];
    else if (token === 'T*' && position) position = { x: position.x, y: position.y - leading };
    else if (token === 'q') clipStack.push(clip);
    else if (token === 'Q') clip = clipStack.length > 0 ? clipStack.pop() : null;
    else if (token === 'W' || token === 'W*') {
      if (pendingRect) clip = intersect(clip, pendingRect);
    }
    else if (token === 'cm') matrix = tail(6);
    else if (token === 'Do') {
      const [a, , , d, e, f] = matrix;
      if (Number.isFinite(a) && Number.isFinite(d)) {
        const painted = intersect({ x: Math.min(e, e + a), y: Math.min(f, f + d), width: Math.abs(a), height: Math.abs(d) }, clip);
        if (painted) images.push(painted);
      }
    } else if ((token === 'Tj' || token === 'TJ') && position && fill) {
      drawn.push({ ...position, color: fill, fontSize, rectangles: rectangles.length, images: images.length });
    }
    if (token !== 're' && !/^-?[\d.]+$/.test(token)) numbers.length = 0;
  }
  return { rectangles, images, drawn };
}

function gateRenderWarnings(item, rendered, checks) {
  if (!item.expectWarnings) return;
  const warnings = rendered.manifest?.diagnostics?.warnings ?? [];
  for (const pattern of item.expectWarnings) {
    const hit = warnings.some((warning) => pattern.test(warning));
    checks.push({
      gate: 'render-warnings',
      name: String(pattern),
      status: hit ? 'pass' : 'fail',
      message: hit ? 'reported' : `no warning matched; got ${warnings.length === 0 ? 'none' : warnings.join(' | ')}`,
    });
  }
}

function pdfFontsUsed(streams) {
  const used = new Set();
  for (const stream of streams) {
    const tokens = stream.split(/\s+/);
    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index] === 'Tf' && index >= 2 && tokens[index - 2].startsWith('/')) used.add(tokens[index - 2]);
    }
  }
  return used;
}

function pdfMixedFontBaselines(streams) {
  const perBaseline = new Map();
  for (const stream of streams) {
    const tokens = stream.split(/\s+/);
    let font = null;
    let baseline = null;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === 'Tf' && index >= 2 && tokens[index - 2].startsWith('/')) font = tokens[index - 2];
      else if ((token === 'Td' || token === 'TD') && index >= 2) baseline = Number.parseFloat(tokens[index - 1]);
      else if (token === 'Tm' && index >= 6) baseline = Number.parseFloat(tokens[index - 1]);
      else if ((token === 'Tj' || token === 'TJ') && font && baseline !== null && Number.isFinite(baseline)) {
        const key = baseline.toFixed(1);
        if (!perBaseline.has(key)) perBaseline.set(key, new Set());
        perBaseline.get(key).add(font);
      }
    }
  }
  return [...perBaseline.values()].filter((fonts) => fonts.size > 1).length;
}

function gatePdfFontSwitches(item, rendered, checks) {
  if (!item.expectFontsUsed) return;
  const path = join(rendered.outputDir, 'report.pdf');
  if (!existsSync(path)) return;
  const streams = pdfContentStreams(readFileSync(path));
  const used = pdfFontsUsed(streams);
  checks.push({
    gate: 'font-fallback',
    name: 'distinct fonts drawn in the report body',
    status: used.size >= item.expectFontsUsed ? 'pass' : 'fail',
    message: `${used.size} font resource(s) used (${[...used].sort().join(' ')}) against at least ${item.expectFontsUsed}`,
  });
  const mixed = pdfMixedFontBaselines(streams);
  const required = item.expectMixedFontLines ?? 1;
  checks.push({
    gate: 'font-fallback',
    name: 'baselines that switch font mid-line',
    status: mixed >= required ? 'pass' : 'fail',
    message: `${mixed} baseline(s) drawn with more than one font against at least ${required}`,
  });
}

function gatePdfTextContrast(item, rendered, checks) {
  const path = join(rendered.outputDir, 'report.pdf');
  if (!existsSync(path)) return;
  const theme = rendered.manifest.theme;
  const streams = pdfContentStreams(readFileSync(path));
  const failures = [];
  let measured = 0;
  for (const [pageIndex, stream] of streams.entries()) {
    const { rectangles, images, drawn } = pdfTextOnFill(stream);
    for (const text of drawn) {
      const point = { x: text.x + 1, y: text.y + 1 };
      const overImage = images.slice(0, text.images).some((box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
      if (overImage) continue;
      const background = rectangles.slice(0, text.rectangles).reverse().find((box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
      if (!background) continue;
      const ratio = contrastRatio(text.color, background.color);
      if (ratio === null) continue;
      measured += 1;
      const minimum = text.fontSize >= LARGE_TEXT_PT ? 3 : 4.5;
      if (ratio < minimum) failures.push(`page ${pageIndex + 1}: ${text.color} on ${background.color} at ${text.fontSize}pt is ${ratio.toFixed(2)}:1, below ${minimum}:1`);
    }
  }
  if (measured === 0) {
    checks.push({ gate: 'contrast-pdf-text', name: 'report text on its own fills', status: 'skip', message: 'no text was drawn over a filled rectangle in this report' });
    return;
  }
  checks.push({
    gate: 'contrast-pdf-text',
    name: 'report text on its own fills',
    status: failures.length === 0 ? 'pass' : 'fail',
    message: failures.length === 0
      ? `${measured} text runs measured against the rectangle drawn behind them, all above the WCAG AA minimum (theme background ${theme.background})`
      : `${failures.length} of ${measured} text runs are unreadable over their own background: ${failures.slice(0, 4).join('; ')}`,
  });
}

function gatePageFill(item, rendered, checks) {
  const path = join(rendered.outputDir, 'report.pdf');
  const buffer = readIfExists(path);
  if (!buffer) return;
  const pages = pdfPageCount(buffer);
  const expectedPages = item.expectPages;
  if (expectedPages !== undefined) {
    checks.push({
      gate: 'page-fill',
      name: 'expected page count',
      status: pages === expectedPages ? 'pass' : 'fail',
      message: `${pages} page(s) against the fixture expectation of ${expectedPages}`,
    });
  }
  const streams = pdfPageContentStreams(buffer);
  const minPageFill = item.minPageFill ?? pdfConfig.page_fill_min;
  // jsPDF writes these streams in PDF points with the origin at the bottom;
  // the visual report uses an A4 content rectangle of roughly 18mm margins.
  const content = {
    x: pdfConfig.page_fill_x,
    y: pdfConfig.page_fill_y,
    width: pdfConfig.page_fill_width,
    height: pdfConfig.page_fill_height,
  };
  const skippedCover = Boolean(item.input.data?.title_page);
  for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
    if (skippedCover && pageIndex === 0) {
      checks.push({ gate: 'page-fill', name: `page ${pageIndex + 1}`, status: 'skip', message: 'title page is intentionally sparse' });
      continue;
    }
    const stream = streams[pageIndex] ?? '';
    const { images, drawn } = pdfTextOnFill(stream);
    const textBaselines = drawn
      .map((text) => text.y)
      .filter((y) => y >= content.y && y <= content.y + content.height);
    const textBottom = textBaselines.length > 0 ? Math.min(...textBaselines) : content.y + content.height;
    const imageArea = images.reduce((area, image) => area + (intersection(image, content)?.area ?? 0), 0);
    const textFill = textBaselines.length > 0 ? Math.max(0, Math.min(1, (content.y + content.height - textBottom) / content.height)) : 0;
    const imageFill = Math.max(0, Math.min(1, imageArea / (content.width * content.height)));
    const fill = Math.max(textFill, imageFill);
    checks.push({
      gate: 'page-fill',
      name: `page ${pageIndex + 1}`,
      status: fill >= minPageFill ? 'pass' : 'fail',
      message: `${(fill * 100).toFixed(1)}% content fill against a minimum of ${(minPageFill * 100).toFixed(1)}% (${drawn.length} text runs, ${(imageFill * 100).toFixed(1)}% image area)`,
      fill: Number(fill.toFixed(3)),
      minimum: minPageFill,
    });
  }
}

function gateGeometry(item, rendered, checks) {
  const canvas = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
  const slides = item.input.slides ?? [];
  for (const [index, slide] of slides.entries()) {
    const plan = rendered.manifest.slidePlans?.[index];
    if (!plan?.slotBoxes) {
      checks.push({ gate: 'geometry', name: `slide ${index + 1}`, status: 'skip', message: 'no resolved slide plan in the manifest' });
      continue;
    }
    const boxes = plan.slotBoxes;
    for (const [name, value] of Object.entries(boxes)) {
      if (!value) continue;
      const overflow = worstOverflow(box(value), canvas);
      checks.push({
        gate: 'geometry',
        name: `slide ${index + 1} ${name} inside canvas`,
        status: overflow <= 1 ? 'pass' : 'fail',
        message: overflow <= 1 ? 'inside the 1600x900 canvas' : `escapes the canvas by ${overflow.toFixed(1)}px`,
      });
    }
    const regions = { header: boxes.header, content: boxes.content, footer: boxes.footer };
    for (const [left, right] of [['header', 'content'], ['header', 'footer'], ['content', 'footer']]) {
      if (!regions[left] || !regions[right]) continue;
      const overlap = intersection(box(regions[left]), box(regions[right]));
      checks.push({
        gate: 'geometry',
        name: `slide ${index + 1} regions ${left}/${right}`,
        status: overlap ? 'fail' : 'pass',
        message: overlap ? `regions overlap over ${Math.round(overlap.area)}px²` : 'regions are disjoint',
      });
    }
    const used = usedContentSlots(slide).filter((name) => boxes[name]);
    for (let first = 0; first < used.length; first += 1) {
      for (let second = first + 1; second < used.length; second += 1) {
        const overlap = intersection(box(boxes[used[first]]), box(boxes[used[second]]));
        checks.push({
          gate: 'geometry',
          name: `slide ${index + 1} slots ${used[first]}/${used[second]}`,
          status: overlap ? 'fail' : 'pass',
          message: overlap ? `slots in use overlap over ${Math.round(overlap.area)}px²` : 'slots in use are disjoint',
        });
      }
    }
    if (regions.content) {
      for (const name of used) {
        const overflow = worstOverflow(box(boxes[name]), box(regions.content));
        const inside = intersection(box(boxes[name]), box(regions.content));
        checks.push({
          gate: 'geometry',
          name: `slide ${index + 1} ${name} inside content region`,
          status: overflow <= 1 ? 'pass' : inside ? 'warn' : 'fail',
          message: overflow <= 1 ? 'inside the content region' : inside ? `bleeds ${overflow.toFixed(1)}px past the content region` : 'lies entirely outside the content region',
        });
      }
    }
    for (const name of used) {
      for (const region of ['header', 'footer']) {
        if (!regions[region]) continue;
        const overlap = intersection(box(boxes[name]), box(regions[region]));
        checks.push({
          gate: 'geometry',
          name: `slide ${index + 1} ${name} clear of ${region}`,
          status: overlap ? 'fail' : 'pass',
          message: overlap ? `content slot intrudes ${Math.round(overlap.area)}px² into the ${region} region` : `clear of the ${region} region`,
        });
      }
    }
    if (slide.type !== 'title' && boxes.title && boxes.subtitle && slide.subtitle) {
      const overlap = intersection(box(boxes.title), box(boxes.subtitle));
      checks.push({
        gate: 'geometry',
        name: `slide ${index + 1} title/subtitle boxes`,
        status: overlap ? 'warn' : 'pass',
        message: overlap
          ? `declared title and subtitle boxes overlap over ${Math.round(overlap.area)}px² (the template allows it: rendered baselines are checked separately by the engine)`
          : 'title and subtitle boxes are disjoint',
      });
    }
    if (boxes.lockup && boxes['lockup-name']) {
      const overlap = intersection(box(boxes.lockup), box(boxes['lockup-name']));
      checks.push({
        gate: 'geometry',
        name: `slide ${index + 1} lockup mark/name`,
        status: overlap ? 'fail' : 'pass',
        message: overlap ? `the logo mark and the brand name overlap over ${Math.round(overlap.area)}px²` : 'the logo mark and the brand name are disjoint',
      });
    }
  }
}

function gateSlideTextLines(item, rendered, checks) {
  const slides = item.input.slides ?? [];
  for (const [index, slide] of slides.entries()) {
    if (slide.type !== 'title') continue;
    const layout = rendered.manifest.slideLayout?.[index];
    const plan = rendered.manifest.slidePlans?.[index];
    if (!layout || !plan) continue;
    const titleMax = plan.titleConstraints?.maxLines ?? 2;
    const subtitleMax = plan.subtitleConstraints?.maxLines ?? 2;
    checks.push({
      gate: 'overflow-lines',
      name: `slide ${index + 1} title lines`,
      status: layout.titleLines <= titleMax ? 'pass' : 'fail',
      message: `${layout.titleLines} rendered line(s) against a declared maximum of ${titleMax}`,
    });
    if (slide.subtitle) {
      checks.push({
        gate: 'overflow-lines',
        name: `slide ${index + 1} subtitle lines`,
        status: layout.subtitleLines <= subtitleMax ? 'pass' : 'fail',
        message: `${layout.subtitleLines} rendered line(s) against a declared maximum of ${subtitleMax}`,
      });
    }
  }
}

function gateArtifacts(item, rendered, checks, images) {
  const manifest = rendered.manifest;
  const slideCount = item.kind === 'deck' ? (item.input.slides ?? []).length : null;
  if (item.formats.includes('pdf')) {
    const path = join(rendered.outputDir, item.kind === 'deck' ? 'slides.pdf' : 'report.pdf');
    const buffer = readIfExists(path);
    if (!buffer) checks.push({ gate: 'artifacts', name: 'pdf', status: 'fail', message: `missing ${path}` });
    else {
      const pages = pdfPageCount(buffer);
      checks.push({ gate: 'artifacts', name: 'pdf header', status: buffer.subarray(0, 5).toString() === '%PDF-' ? 'pass' : 'fail', message: `${buffer.length} bytes, first bytes ${JSON.stringify(buffer.subarray(0, 5).toString())}` });
      checks.push({
        gate: 'artifacts',
        name: 'pdf pages',
        status: slideCount === null ? (pages >= 1 ? 'pass' : 'fail') : pages === slideCount ? 'pass' : 'fail',
        message: slideCount === null ? `${pages} page(s)` : `${pages} page(s) against ${slideCount} slide(s)`,
      });
    }
  }
  if (item.formats.includes('png')) {
    const directory = join(rendered.outputDir, 'png');
    const files = existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.png')).sort() : [];
    checks.push({ gate: 'artifacts', name: 'png count', status: files.length === slideCount ? 'pass' : 'fail', message: `${files.length} PNG file(s) against ${slideCount} slide(s)` });
    for (const [index, file] of files.entries()) {
      const buffer = readFileSync(join(directory, file));
      try {
        const image = decodePng(buffer);
        images[index] = image;
        checks.push({
          gate: 'artifacts',
          name: `png ${file}`,
          status: image.width === CANVAS.width && image.height === CANVAS.height ? 'pass' : 'fail',
          message: `${image.width}x${image.height}, ${buffer.length} bytes`,
        });
      } catch (error) {
        checks.push({ gate: 'artifacts', name: `png ${file}`, status: 'fail', message: `could not decode: ${error.message}` });
      }
    }
  }
  if (item.formats.includes('pptx')) {
    const path = join(rendered.outputDir, 'slides.pptx');
    const buffer = readIfExists(path);
    if (!buffer) checks.push({ gate: 'artifacts', name: 'pptx', status: 'fail', message: `missing ${path}` });
    else {
      try {
        const slides = pptxSlideCount(buffer);
        checks.push({ gate: 'artifacts', name: 'pptx slides', status: slides === slideCount ? 'pass' : 'fail', message: `${slides} slide part(s) against ${slideCount} slide(s), ${buffer.length} bytes` });
      } catch (error) {
        checks.push({ gate: 'artifacts', name: 'pptx slides', status: 'fail', message: `could not read the archive: ${error.message}` });
      }
    }
  }
  if (manifest?.diagnostics?.warnings?.length) {
    checks.push({ gate: 'artifacts', name: 'brand diagnostics', status: 'pass', message: manifest.diagnostics.warnings.join(' | ') });
  }
}

function gateInk(item, rendered, checks, images) {
  const slides = item.input.slides ?? [];
  const frame = { x: CANVAS.margin - 8, y: 8, width: CANVAS.width - (CANVAS.margin - 8) * 2, height: CANVAS.height - 16 };
  for (const [index, slide] of slides.entries()) {
    const image = images[index];
    const theme = rendered.manifest.slideThemes?.[index] ?? rendered.manifest.theme;
    if (!image || !theme) continue;
    if (theme.headerStyle !== 'plain' || theme.hasBackgroundImage || theme.hasCoverImage) {
      checks.push({ gate: 'ink', name: `slide ${index + 1}`, status: 'skip', message: `header style '${theme.headerStyle}' paints full-bleed artwork, so margin ink cannot be distinguished from decoration` });
      continue;
    }
    const ink = inkOutsideFrame(image, frame);
    checks.push({
      gate: 'ink',
      name: `slide ${index + 1} (${slide.type}) margin`,
      status: ink.count === 0 ? 'pass' : 'fail',
      message: ink.count === 0
        ? `no ink outside the ${frame.x}..${frame.x + frame.width}px safe frame`
        : `${ink.count} ink pixel(s) outside the safe frame, spanning x ${ink.bounds.minX}..${ink.bounds.maxX} and y ${ink.bounds.minY}..${ink.bounds.maxY} over background ${ink.background}`,
    });
  }
}

function gateDeterminism(item, rendered, directory, checks, images) {
  const repeat = renderCase(item, join(directory, 'repeat'));
  if (repeat.result.status !== 0) {
    checks.push({ gate: 'determinism', name: 'repeat render', status: 'fail', message: `the repeat render failed: ${repeat.message}` });
    return;
  }
  const compare = (name, path, hasher) => {
    const first = readIfExists(join(rendered.outputDir, path));
    const second = readIfExists(join(repeat.outputDir, path));
    if (!first || !second) {
      checks.push({ gate: 'determinism', name, status: 'skip', message: `${path} is missing from one of the two renders` });
      return;
    }
    const left = hasher(first);
    const right = hasher(second);
    checks.push({ gate: 'determinism', name, status: left === right ? 'pass' : 'fail', message: left === right ? `identical content hash ${left.slice(0, 16)}` : `content hashes differ: ${left.slice(0, 16)} vs ${right.slice(0, 16)}` });
  };
  if (item.formats.includes('pdf')) compare('pdf content (timestamps ignored)', item.kind === 'deck' ? 'slides.pdf' : 'report.pdf', pdfContentHash);
  if (item.formats.includes('pptx')) compare('pptx content (timestamps ignored)', 'slides.pptx', pptxContentHash);
  if (item.formats.includes('png')) {
    const directoryOne = join(rendered.outputDir, 'png');
    const files = existsSync(directoryOne) ? readdirSync(directoryOne).filter((name) => name.endsWith('.png')).sort() : [];
    for (const [index, file] of files.entries()) {
      const first = readIfExists(join(directoryOne, file));
      const second = readIfExists(join(repeat.outputDir, 'png', file));
      if (!first || !second) {
        checks.push({ gate: 'determinism', name: `png ${file}`, status: 'fail', message: 'the repeat render did not produce this slide' });
        continue;
      }
      if (sha256(first) === sha256(second)) {
        checks.push({ gate: 'determinism', name: `png ${file}`, status: 'pass', message: 'byte-identical between two renders' });
        continue;
      }
      const diff = pixelDiff(images[index] ?? decodePng(first), decodePng(second));
      checks.push({
        gate: 'determinism',
        name: `png ${file}`,
        status: 'fail',
        message: diff.comparable ? `${diff.differing} of ${diff.pixels} pixels differ (${(diff.ratio * 100).toFixed(3)}%)` : diff.reason,
      });
    }
  }
}

function rasterisePdf(pdfPath, outputDirectory, prefix) {
  mkdirSync(outputDirectory, { recursive: true });
  if (!which('pdftoppm')) return { available: false, reason: 'pdftoppm (poppler-utils) is not installed' };
  const result = run('pdftoppm', ['-png', '-scale-to-x', String(CANVAS.width), '-scale-to-y', String(CANVAS.height), pdfPath, join(outputDirectory, prefix)]);
  if (result.status !== 0) return { available: true, ok: false, reason: result.stderr.trim() || `pdftoppm exited with ${result.status}` };
  const files = readdirSync(outputDirectory).filter((name) => name.startsWith(`${prefix}-`) && name.endsWith('.png')).sort().map((name) => join(outputDirectory, name));
  return { available: true, ok: true, files };
}

function gateOfficeRoundTrip(item, rendered, directory, checks, images, converter) {
  const pptxPath = join(rendered.outputDir, 'slides.pptx');
  if (!existsSync(pptxPath)) {
    checks.push({ gate: 'pptx-round-trip', name: 'convert', status: 'fail', message: 'no PPTX was produced for the round trip' });
    return;
  }
  if (!converter) {
    checks.push({
      gate: 'pptx-round-trip',
      name: 'convert',
      status: 'skip',
      message: 'SKIPPED: no LibreOffice converter was found. Install one and rerun; the harness would run: soffice --headless --convert-to pdf --outdir <OUTDIR> <INPUT.pptx> (or: flatpak run --filesystem=<OUTDIR> org.libreoffice.LibreOffice --headless --convert-to pdf --outdir <OUTDIR> <INPUT.pptx>)',
    });
    return;
  }
  const convertedDirectory = join(directory, 'pptx-as-pdf');
  mkdirSync(convertedDirectory, { recursive: true });
  const commandArgs = [...converter.prefixArgs, '--headless', '--convert-to', 'pdf', '--outdir', convertedDirectory, pptxPath];
  const started = Date.now();
  const result = run(converter.command, commandArgs, { timeout: OFFICE_TIMEOUT_MS });
  const convertedPdf = join(convertedDirectory, basename(pptxPath).replace(/\.pptx$/i, '.pdf'));
  const buffer = readIfExists(convertedPdf);
  const commandLine = [converter.command, ...commandArgs].join(' ');
  if (result.status !== 0 || !buffer || buffer.length === 0) {
    checks.push({
      gate: 'pptx-round-trip',
      name: 'convert',
      status: 'fail',
      message: `conversion did not leave a non-empty PDF at ${convertedPdf} (exit ${result.status}, ${Math.round((Date.now() - started) / 1000)}s). A zero exit code with no file usually means the sandbox could not write the output directory. Command: ${commandLine}. Output: ${(result.stdout + result.stderr).trim().slice(0, 400)}`,
    });
    return;
  }
  const slideCount = (item.input.slides ?? []).length;
  const pages = pdfPageCount(buffer);
  checks.push({ gate: 'pptx-round-trip', name: 'converted pdf', status: pages === slideCount ? 'pass' : 'fail', message: `${pages} page(s) against ${slideCount} slide(s), ${buffer.length} bytes, converter ${converter.label} ${converter.version}` });
  const raster = rasterisePdf(convertedPdf, join(directory, 'pptx-as-png'), 'roundtrip');
  if (!raster.available || !raster.ok) {
    checks.push({ gate: 'pptx-round-trip', name: 'raster comparison', status: 'skip', message: `SKIPPED: ${raster.reason}` });
    return;
  }
  for (const [index, file] of raster.files.entries()) {
    const direct = images[index];
    if (!direct) {
      checks.push({ gate: 'pptx-round-trip', name: `slide ${index + 1} pixels`, status: 'skip', message: 'no direct PNG render to compare against' });
      continue;
    }
    let converted;
    try {
      converted = resample(decodePng(readFileSync(file)), direct.width, direct.height);
    } catch (error) {
      checks.push({ gate: 'pptx-round-trip', name: `slide ${index + 1} pixels`, status: 'fail', message: `could not decode ${file}: ${error.message}` });
      continue;
    }
    const diff = pixelDiff(direct, converted, 24);
    checks.push({
      gate: 'pptx-round-trip',
      name: `slide ${index + 1} pixels`,
      status: !diff.comparable ? 'fail' : diff.ratio <= OFFICE_MAX_CHANGED_RATIO ? 'pass' : 'fail',
      message: diff.comparable
        ? `${(diff.ratio * 100).toFixed(1)}% of pixels differ from the direct render (limit ${(OFFICE_MAX_CHANGED_RATIO * 100).toFixed(0)}%; LibreOffice re-rasterises fonts and images, so exact equality is not expected)`
        : diff.reason,
      ratio: diff.comparable ? Number(diff.ratio.toFixed(4)) : null,
    });
  }
}

function summarise(checks) {
  const totals = { pass: 0, fail: 0, warn: 0, skip: 0 };
  for (const check of checks) totals[check.status] = (totals[check.status] ?? 0) + 1;
  return totals;
}

function preflight() {
  const probe = {
    id: 'preflight',
    group: 'preflight',
    brand: settings.brands[0] ?? 'orbit',
    profile: 'primary',
    kind: 'deck',
    formats: ['png'],
    expect: 'render',
    input: deck([{ type: 'narrative', title: 'Preflight', body: 'One line.' }]),
  };
  const rendered = renderCase(probe, join(settings.out, 'cases', 'preflight'));
  return { ok: rendered.result.status === 0, message: rendered.message, stderr: rendered.stderr.slice(0, 2000) };
}

function main() {
  mkdirSync(settings.out, { recursive: true });
  const environment = {
    node: process.version,
    bundle: settings.bundle,
    bundleExists: existsSync(settings.bundle),
    brandRoot: settings.brandRoot,
    templateDir: settings.templateDir ?? null,
    tools: Object.fromEntries(['pdftoppm', 'pdfinfo', 'soffice', 'libreoffice', 'flatpak'].map((command) => [command, which(command)])),
  };
  if (!environment.bundleExists) {
    const report = { schemaVersion: 1, status: 'BLOCKED', reason: `The example CLI bundle ${settings.bundle} does not exist. Build it with: cd server && npm run build:example (or point --bundle at a scratch bundle).`, environment };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`visual-qa BLOCKED: ${report.reason}`);
    return 1;
  }
  const checkStarted = Date.now();
  const gate = preflight();
  if (!gate.ok) {
    const report = {
      schemaVersion: 1,
      status: 'BLOCKED',
      reason: 'The render engine could not produce even a one-slide deck, so no visual gate could run. This is an engine or configuration failure, not a fixture failure.',
      engineMessage: gate.message,
      engineStderr: gate.stderr,
      environment,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error('visual-qa BLOCKED: the render engine failed on a trivial deck, so no gate ran.');
    console.error(`  engine said: ${gate.message}`);
    console.error(`  report: ${reportPath}`);
    return 1;
  }
  const converter = settings.office ? findOfficeConverter(join(settings.out, 'libreoffice-profile'), { filesystemDirectory: settings.out }) : null;
  const cases = buildCases();
  const records = [];
  for (const item of cases) {
    const directory = join(settings.out, 'cases', item.id);
    const rendered = renderCase(item, directory);
    const checks = [];
    const images = [];
    if (item.expect === 'reject') {
      const rejected = rendered.result.status !== 0;
      checks.push({ gate: 'overflow-contract', name: 'rejected', status: rejected ? 'pass' : 'fail', message: rejected ? `rejected with exit ${rendered.result.status}` : 'the renderer accepted content that must not fit' });
      if (rejected) {
        const message = rendered.message;
        const usable = message.length > 12 && !/^\s*(at |TypeError|undefined)/.test(message);
        checks.push({ gate: 'overflow-contract', name: 'message is usable', status: usable ? 'pass' : 'fail', message: `engine said: ${message || '(nothing on stderr)'}` });
        if (item.message) {
          checks.push({ gate: 'overflow-contract', name: 'message matches the expected cause', status: item.message.test(message) ? 'pass' : 'fail', message: `expected ${item.message} in: ${message}` });
        }
        const namesTheLimit = /\b\d+\b/.test(message) || /exceeds|does not fit|longer than|at most|exactly/.test(message);
        checks.push({ gate: 'overflow-contract', name: 'message names the constraint', status: namesTheLimit ? 'pass' : 'warn', message: namesTheLimit ? 'the message names the slot and the limit' : 'the message names the slot but not the limit that was broken' });
        checks.push({ gate: 'overflow-contract', name: 'no partial artifacts', status: existsSync(join(rendered.outputDir, 'manifest.json')) ? 'fail' : 'pass', message: existsSync(join(rendered.outputDir, 'manifest.json')) ? 'a manifest was written for a rejected render' : 'nothing was written for the rejected render' });
      }
    } else if (rendered.result.status !== 0) {
      checks.push({ gate: 'render', name: 'render', status: 'fail', message: `expected a render, got exit ${rendered.result.status}: ${rendered.message}` });
    } else if (!rendered.manifest) {
      checks.push({ gate: 'render', name: 'manifest', status: 'fail', message: 'the render exited cleanly but wrote no manifest.json' });
    } else {
      checks.push({ gate: 'render', name: 'render', status: 'pass', message: `rendered ${item.formats.join(', ')}` });
      gateArtifacts(item, rendered, checks, images);
      gateThemeContrast(item, rendered, checks);
      gateRenderWarnings(item, rendered, checks);
      if (item.kind === 'report') {
        gatePdfTextContrast(item, rendered, checks);
        gatePdfFontSwitches(item, rendered, checks);
        if (item.group === 'page-fill') gatePageFill(item, rendered, checks);
      }
      if (item.kind === 'deck') {
        gateGeometry(item, rendered, checks);
        gateSlideTextLines(item, rendered, checks);
        gateMeasuredContrast(item, rendered, checks, images);
        if (item.inkGate) gateInk(item, rendered, checks, images);
      }
      if (item.determinism) gateDeterminism(item, rendered, directory, checks, images);
      if (item.office && settings.office) gateOfficeRoundTrip(item, rendered, directory, checks, images, converter);
    }
    const totals = summarise(checks);
    records.push({
      id: item.id,
      group: item.group,
      brand: item.brand,
      profile: item.profile,
      kind: item.kind,
      formats: item.formats,
      expect: item.expect,
      status: totals.fail > 0 ? 'fail' : totals.warn > 0 ? 'warn' : 'pass',
      directory,
      exitCode: rendered.result.status,
      engineMessage: rendered.message || undefined,
      totals,
      checks,
    });
    const marker = totals.fail > 0 ? 'FAIL' : totals.warn > 0 ? 'WARN' : 'PASS';
    console.log(`${marker.padEnd(4)} ${item.id} (${totals.pass} pass, ${totals.fail} fail, ${totals.warn} warn, ${totals.skip} skip)`);
  }
  const allChecks = records.flatMap((record) => record.checks);
  const totals = summarise(allChecks);
  const failed = records.filter((record) => record.status === 'fail');
  const officeSkipped = allChecks.some((check) => check.gate === 'pptx-round-trip' && check.status === 'skip');
  const status = failed.length > 0 || (settings.requireOffice && officeSkipped) ? 'FAIL' : 'PASS';
  const report = {
    schemaVersion: 1,
    status,
    startedAt: new Date(checkStarted).toISOString(),
    durationSeconds: Math.round((Date.now() - checkStarted) / 1000),
    environment,
    converter: converter ? { label: converter.label, version: converter.version } : null,
    gates: {
      artifacts: 'PDF, PNG and PPTX exist, carry the right magic bytes and hold one part per slide.',
      'overflow-contract': 'Hostile content is either rejected with a usable message and no partial output, or renders.',
      'overflow-lines': 'A rendered title never uses more lines than its template slot declares.',
      ink: 'On flat-background themes no ink is painted outside the safe frame, which catches silent overflow the engine does not assert.',
      'contrast-theme': 'WCAG AA contrast between resolved theme text colours and their band or surface colours.',
      'contrast-measured': 'WCAG AA contrast between the text colour and the pixels actually rendered behind it.',
      'contrast-pdf-text': 'WCAG AA contrast between every A4 text run and the filled rectangle drawn behind it in the PDF content stream.',
      'page-fill': 'Every non-cover A4 page carries enough text baseline span or image surface to avoid a near-empty trailing page.',
      geometry: 'Every slot box stays inside the canvas, inside its region, and clear of the other slots in use.',
      determinism: 'Two identical renders produce identical content (PNG bytes, PDF and PPTX with timestamps stripped).',
      'pptx-round-trip': 'PPTX converted by LibreOffice to PDF, rasterised, and compared pixel by pixel with the direct render.',
    },
    totals: { cases: records.length, failedCases: failed.length, checks: totals },
    cases: records,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log('');
  console.log(`visual QA ${status}: ${records.length} case(s), ${totals.pass} check(s) passed, ${totals.fail} failed, ${totals.warn} warned, ${totals.skip} skipped.`);
  console.log(`converter: ${converter ? `${converter.label} ${converter.version}` : 'none found'}`);
  for (const record of records) {
    for (const check of record.checks) {
      if (check.status === 'fail') console.log(`  FAIL ${record.id} [${check.gate}] ${check.name}: ${check.message}`);
    }
  }
  for (const record of records) {
    for (const check of record.checks) {
      if (check.status === 'warn') console.log(`  WARN ${record.id} [${check.gate}] ${check.name}: ${check.message}`);
    }
  }
  const skippedRoundTrips = records.flatMap((record) => record.checks.filter((check) => check.gate === 'pptx-round-trip' && check.status === 'skip').map((check) => `${record.id}: ${check.message}`));
  if (skippedRoundTrips.length > 0) {
    console.log('');
    console.log('!! PPTX round-trip coverage is INCOMPLETE:');
    for (const line of skippedRoundTrips) console.log(`   ${line}`);
  }
  console.log('');
  console.log(`report: ${reportPath}`);
  console.log(`artifacts: ${settings.out}`);
  return status === 'FAIL' ? 1 : 0;
}

process.exitCode = main();
