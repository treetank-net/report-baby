#!/usr/bin/env node

// PROTOTYPE — disposable composition-kernel spike.
// This remains a disposable spike, but it now reads the selected brand's
// declared font files and the repository render configuration. It answers one
// question: can a planner/evaluator preserve editorial structure while moving
// real product-shaped text and placeholder graphics across tracks and pages?

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loremIpsum } from 'lorem-ipsum';
import { parse } from 'yaml';
import {
  assertTextMetrics,
  lineHeight,
  styleFor,
  widthOf,
  wrapFrom,
} from './prototype-composition-text-flow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let prototypeConfig = parse(readFileSync(join(here, '..', 'templates', 'composition-pixel-qa-prototype.yml'), 'utf8'));
const renderConfig = parse(readFileSync(join(here, '..', 'templates', 'render-config.yml'), 'utf8'));
const BREAKING_PROFILES = prototypeConfig.breaking_profiles;
let requestedPreset = process.argv.includes('--preset')
  ? process.argv[process.argv.indexOf('--preset') + 1]
  : 'a4';
const landscapeConfig = parse(readFileSync(join(here, '..', 'templates', 'composition-landscape-1600x900.yml'), 'utf8'));
const landscapePage = {
  width: landscapeConfig.page.width_mm,
  height: landscapeConfig.page.height_mm,
  margin: Object.fromEntries(['top', 'right', 'bottom', 'left'].map((side) => [side, landscapeConfig.page.margin_mm])),
};
const defaultOutput = resolve(here, 'prototype-composition-out');
const outputDir = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : defaultOutput;
const requestedCase = process.argv.includes('--case')
  ? process.argv[process.argv.indexOf('--case') + 1]
  : 'all';
const fixtureJsonPath = process.argv.includes('--fixture-json')
  ? resolve(process.argv[process.argv.indexOf('--fixture-json') + 1])
  : null;
const brandDir = resolve(process.argv.includes('--brand-dir')
  ? process.argv[process.argv.indexOf('--brand-dir') + 1]
  : join(here, '..', '..', 'examples', 'brand-showcase', 'brands'));
const brandRef = process.argv.includes('--brand-ref')
  ? process.argv[process.argv.indexOf('--brand-ref') + 1]
  : 'brand://flux/editorial';
const noRender = process.argv.includes('--no-render');

function mergeObjects(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left)) return right;
  if (!right || typeof right !== 'object' || Array.isArray(right)) return left;
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) result[key] = mergeObjects(result[key], value);
  return result;
}

function loadBrand(root, ref) {
  const match = /^brand:\/\/([^/]+)\/(.+)$/u.exec(ref);
  assert(match, `Unsupported brand reference '${ref}'. Expected brand://name/profile.`);
  const [, name, profile] = match;
  const brandRoot = join(root, name);
  const brandPath = join(brandRoot, '_brand.yml');
  const profilePath = join(brandRoot, `${profile}.yml`);
  assert(existsSync(brandPath), `Brand '${ref}' is missing ${brandPath}.`);
  const brand = parse(readFileSync(brandPath, 'utf8'));
  const profileData = existsSync(profilePath) ? parse(readFileSync(profilePath, 'utf8')) : {};
  const merged = mergeObjects(brand, profileData);
  const assetsRoot = join(brandRoot, merged.assets?.source_root ?? 'assets');
  const fontRegular = merged.assets?.font_regular ? join(assetsRoot, merged.assets.font_regular) : null;
  const fontBold = merged.assets?.font_bold ? join(assetsRoot, merged.assets.font_bold) : null;
  return {
    ref,
    name,
    profile,
    root: brandRoot,
    data: merged,
    fontFamily: merged.typography?.base?.family ?? 'helvetica',
    fontRegular: fontRegular && existsSync(fontRegular) ? fontRegular : null,
    fontBold: fontBold && existsSync(fontBold) ? fontBold : null,
  };
}

let activeBrand = loadBrand(brandDir, brandRef);

let PAGE = requestedPreset === 'landscape-1600x900'
  ? landscapePage
  : { width: 210, height: 297, margin: { top: 15, right: 15, bottom: 15, left: 15 } };
let COLORS = {
  ink: [28, 32, 42],
  muted: [100, 108, 122],
  rule: [205, 211, 220],
  lead: [229, 242, 255],
  secondary: [240, 247, 235],
  sidebar: [250, 241, 228],
  imageA: [82, 132, 198],
  imageB: [212, 112, 84],
  imageC: [112, 164, 112],
  warning: [190, 100, 40],
  trackLead: [247, 251, 255],
  trackSecondary: [248, 252, 246],
  trackSidebar: [253, 249, 243],
};
let STYLES = {
  body: { size: renderConfig.pdf.body_size, leading: renderConfig.pdf.body_line_height, weight: 'normal' },
  sidebar: { size: renderConfig.pdf.body_size, leading: renderConfig.pdf.body_line_height, weight: 'normal' },
  heading: { size: renderConfig.pdf.section_heading_size, leading: renderConfig.pdf.section_heading_line_height, weight: 'bold' },
  intro: { size: renderConfig.pdf.body_size, leading: renderConfig.pdf.intro_line_height, weight: 'bold' },
  caption: { size: renderConfig.pdf.image_caption_size, leading: renderConfig.pdf.image_caption_line_height, weight: 'normal' },
  chrome: { size: renderConfig.pdf.footer_font_size, leading: renderConfig.pdf.footer_text_line_height, weight: 'normal' },
};
let TEMPLATE = requestedPreset === 'landscape-1600x900'
  ? {
    id: 'prototype-editorial-landscape-1600x900',
    header: { min: landscapeConfig.layout.header_mm, preferred: landscapeConfig.layout.header_mm, max: landscapeConfig.layout.header_mm, lines: 2 },
    footer: { min: landscapeConfig.layout.footer_mm, preferred: landscapeConfig.layout.footer_mm, max: landscapeConfig.layout.footer_mm, lines: 1 },
    bodyGap: landscapeConfig.layout.body_gap_mm,
    articleSidebarGap: landscapeConfig.layout.article_sidebar_gap_mm,
    articleWidth: landscapeConfig.layout.article_width_mm,
    sidebarWidth: landscapeConfig.layout.sidebar_width_mm,
    articleTracks: landscapeConfig.layout.article_tracks,
    trackGap: landscapeConfig.layout.track_gap_mm,
    flow: { align: 'justify', wrapGap: prototypeConfig.wrap.gap_mm, minimumTextWidth: prototypeConfig.wrap.minimum_text_width_mm },
    maxPages: 8,
  }
  : {
  id: 'prototype-editorial-asymmetric',
  header: { min: 10, preferred: 15, max: 22, lines: 2 },
  footer: { min: 8, preferred: 10, max: 14, lines: 1 },
  bodyGap: 5,
  articleSidebarGap: 7,
  articleWidth: 137,
  sidebarWidth: 36,
  articleTracks: [
    { id: 'lead', width: 78 },
    { id: 'secondary', width: 53 },
  ],
  trackGap: 6,
  flow: { align: 'justify', wrapGap: prototypeConfig.wrap.gap_mm, minimumTextWidth: prototypeConfig.wrap.minimum_text_width_mm },
  maxPages: 8,
  };

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

async function makeDoc() {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({
    orientation: requestedPreset === 'landscape-1600x900' ? 'landscape' : 'portrait',
    unit: 'mm',
    format: requestedPreset === 'landscape-1600x900' ? [PAGE.width, PAGE.height] : 'a4',
    compress: true,
  });
  if (activeBrand.fontRegular) {
    doc.addFileToVFS('prototype-brand-regular.ttf', readFileSync(activeBrand.fontRegular).toString('base64'));
    doc.addFont('prototype-brand-regular.ttf', activeBrand.fontFamily, 'normal');
    if (activeBrand.fontBold) {
      doc.addFileToVFS('prototype-brand-bold.ttf', readFileSync(activeBrand.fontBold).toString('base64'));
      doc.addFont('prototype-brand-bold.ttf', activeBrand.fontFamily, 'bold');
    }
  }
  doc.setFont(fontName(), 'normal');
  return doc;
}

function fontName() {
  return activeBrand.fontRegular ? activeBrand.fontFamily : 'helvetica';
}

function createJsPdfTextMetrics(doc) {
  return {
    units: 'mm',
    family: fontName(),
    measureText(text, styleName) {
      setTextMetricsStyle(doc, styleName);
      return doc.getTextWidth(text);
    },
    lineHeight(styleName) {
      const style = STYLES[styleName];
      assert(style, `Unknown text style '${styleName}'.`);
      return style.leading;
    },
  };
}

function setStyle(doc, styleName) {
  const style = setTextMetricsStyle(doc, styleName);
  doc.setTextColor(...COLORS.ink);
  return style;
}

function setTextMetricsStyle(doc, styleName) {
  const style = STYLES[styleName];
  assert(style, `Unknown text style '${styleName}'.`);
  doc.setFont(fontName(), style.weight);
  doc.setFontSize(style.size);
  return style;
}

function wordsOf(text) {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function makeLorem(seed, count) {
  let state = seed >>> 0;
  const next = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const sentences = [];
  let generated = 0;
  while (generated < count) {
    const sentence = loremIpsum({
      count: 1,
      units: 'sentences',
      sentenceLowerBound: 6,
      sentenceUpperBound: 16,
      random: next,
    }).trim();
    sentences.push(sentence);
    generated += wordsOf(sentence).length;
  }
  return sentences.join(' ');
}

function fixedWords(word, count) {
  return Array.from({ length: count }, () => word).join(' ');
}

function imageSpec(id, shape, color, anchorBlock, options = {}) {
  return {
    id,
    shape,
    color,
    anchorBlock,
    width: options.width ?? 28,
    height: options.height ?? 48,
    side: options.side ?? 'right',
    defer: options.defer ?? true,
    fixed: options.fixed ?? false,
    keepWithAnchor: options.keepWithAnchor ?? true,
    mode: options.mode ?? 'float',
    minTextWidth: options.minTextWidth ?? 0,
    narrowPolicy: options.narrowPolicy ?? 'allow',
    scaleToFit: options.scaleToFit ?? true,
    placement: options.placement ?? 'flow',
    slotTrack: options.slotTrack,
    maxFragmentRatio: options.maxFragmentRatio,
    spanTracks: options.spanTracks ?? 1,
    xOffset: options.xOffset,
    wrapSide: options.wrapSide ?? options.side ?? 'right',
    wrapFractions: options.wrapFractions ?? [0.48, 0.78],
    apex: options.apex ?? 'top',
    starPoints: options.starPoints ?? 5,
    starInnerRatio: options.starInnerRatio ?? 0.45,
    pagePolicy: options.pagePolicy ?? 'reflow',
    fixedPage: options.page,
    position: options.position ?? { mode: 'flow', reference: 'anchor-box', wrap: true },
    caption: options.caption ?? `${shape} placeholder · ${id}`,
  };
}

function baseBlocks(seed, paragraphWords = 95, prefix = '') {
  return [
    { id: `${prefix}section-1-heading`, type: 'heading', role: 'section_heading', text: 'The structure behind the story', keepNext: { lines: 3 } },
    { id: `${prefix}section-1-body`, type: 'paragraph', role: 'body', text: makeLorem(seed, paragraphWords) },
    { id: `${prefix}list-1`, type: 'list-item', role: 'body', text: `• ${makeLorem(seed + 1, 28)}`, marker: true },
    { id: `${prefix}list-2`, type: 'list-item', role: 'body', text: `• ${makeLorem(seed + 2, 28)}`, marker: true },
    { id: `${prefix}section-2-heading`, type: 'heading', role: 'section_heading', text: 'What changes when capacity changes?', keepNext: { lines: 3 } },
    { id: `${prefix}section-2-body`, type: 'paragraph', role: 'body', text: makeLorem(seed + 3, paragraphWords + 15) },
    { id: `${prefix}section-3-heading`, type: 'heading', role: 'section_heading', text: 'A measured continuation', keepNext: { lines: 3 } },
    { id: `${prefix}section-3-body`, type: 'paragraph', role: 'body', text: makeLorem(seed + 4, Math.max(25, paragraphWords - 25)) },
  ];
}

function fixture(id, overrides = {}) {
  const defaults = {
    id,
    title: 'A composition-kernel laboratory',
    intro: 'A controlled editorial fixture for testing flow, keeps, images, columns and pagination.',
    blocks: baseBlocks(11, 95),
    sidebar: [
      { id: 'sidebar-heading', type: 'heading', role: 'sidebar', text: 'Checklist' },
      { id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(77, 70) },
    ],
    images: [imageSpec('image-market', 'ellipse', COLORS.imageA, 'section-2-body')],
    writing: { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' },
    keeps: [
      { id: 'keep-section-1', subject: 'section-1-heading', companion: 'section-1-body', lines: 3, strength: 'required', onOversize: 'reject' },
      { id: 'keep-section-2', subject: 'section-2-heading', companion: 'section-2-body', lines: 3, strength: 'required', onOversize: 'reject' },
      { id: 'keep-section-3', subject: 'section-3-heading', companion: 'section-3-body', lines: 3, strength: 'required', onOversize: 'reject' },
    ],
    policies: { maxPages: TEMPLATE.maxPages, profile: 'editorial', ...BREAKING_PROFILES.editorial },
  };
  const blocks = overrides.blocks ?? defaults.blocks;
  const explicitKeeps = overrides.keeps;
  const keeps = explicitKeeps === undefined
    ? [
      ...defaults.keeps,
      ...blocks
        .filter((block) => block.keepNext && !defaults.keeps.some((keep) => keep.subject === block.id))
        .map((block) => ({
          id: `keep-${block.id}`,
          subject: block.id,
          companion: blocks[blocks.indexOf(block) + 1]?.id,
          ...block.keepNext,
          strength: 'required',
          onOversize: 'reject',
        }))
        .filter((keep) => keep.companion),
    ]
    : explicitKeeps;
  const profileName = overrides.policies?.profile ?? defaults.policies.profile;
  const profile = BREAKING_PROFILES[profileName] ?? BREAKING_PROFILES.editorial;
  return {
    ...defaults,
    ...overrides,
    blocks,
    keeps,
    policies: { ...defaults.policies, ...profile, ...(overrides.policies ?? {}), profile: profileName },
  };
}

function unsupportedWritingViolation(fixtureData) {
  const writing = fixtureData.writing ?? { direction: 'ltr', writingMode: 'horizontal-tb', script: 'Latn' };
  const supported = writing.direction === 'ltr'
    && writing.writingMode === 'horizontal-tb'
    && writing.script === 'Latn';
  return supported ? null : {
    code: 'UNSUPPORTED_WRITING_SYSTEM',
    direction: writing.direction,
    writingMode: writing.writingMode,
    script: writing.script,
    message: 'This prototype supports only Latin left-to-right horizontal text; it refuses to silently render another writing system with the wrong shaping or flow order.',
  };
}

function compactSectionBlocks(seed, count, prefix = '') {
  return Array.from({ length: count }, (_, index) => [
    { id: `${prefix}compact-${index + 1}-heading`, type: 'heading', role: 'section_heading', text: `Short section ${index + 1}`, keepNext: { lines: 2 } },
    { id: `${prefix}compact-${index + 1}-body`, type: 'paragraph', role: 'body', text: makeLorem(seed + index, 18 + (index % 3) * 6) },
  ]).flat();
}

const FIXTURES = {
  baseline: fixture('baseline'),
  short: fixture('short', {
    blocks: [
      { id: 'section-1-heading', type: 'heading', role: 'section_heading', text: 'A short article', keepNext: { lines: 3 } },
      { id: 'section-1-body', type: 'paragraph', role: 'body', text: makeLorem(21, 45) },
      { id: 'list-1', type: 'list-item', role: 'body', text: `• ${makeLorem(22, 18)}`, marker: true },
    ],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(23, 18) }],
    images: [],
  }),
  long: fixture('long', {
    blocks: [...baseBlocks(101, 160), ...baseBlocks(202, 155, 'second-')],
    images: [
      imageSpec('image-opening', 'rectangle', COLORS.imageB, 'section-1-body'),
      imageSpec('image-middle', 'ellipse', COLORS.imageA, 'section-2-body'),
      imageSpec('image-late', 'diagonal', COLORS.imageC, 'section-3-body'),
    ],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(31, 180) }],
  }),
  floatBefore: fixture('float-before', {
    blocks: baseBlocks(301, 120),
    images: [imageSpec('image-before', 'rectangle', COLORS.imageB, 'section-1-body', { height: 70 })],
  }),
  floatMiddle: fixture('float-middle', {
    blocks: baseBlocks(401, 110),
    images: [imageSpec('image-middle', 'ellipse', COLORS.imageA, 'section-2-body', { width: 34, height: 58 })],
  }),
  floatLate: fixture('float-late', {
    blocks: baseBlocks(501, 105),
    images: [imageSpec('image-late', 'diagonal', COLORS.imageC, 'section-3-body', { width: 32, height: 52, side: 'left' })],
  }),
  stairStepWrap: fixture('stair-step-wrap', {
    title: 'A staircase-wrap laboratory',
    blocks: baseBlocks(901, 105),
    images: [imageSpec('image-stair-step', 'diagonal', COLORS.imageC, 'section-3-body', { width: 32, height: 52, side: 'left' })],
  }),
  stairStepCorrected: fixture('stair-step-corrected', {
    title: 'A corrected staircase-wrap laboratory',
    blocks: baseBlocks(901, 105),
    images: [imageSpec('image-stair-step-corrected', 'staircase', COLORS.imageC, 'section-3-body', { width: 32, height: 52, side: 'left' })],
  }),
  triangleWrap: fixture('triangle-wrap', {
    title: 'A triangular-wrap laboratory',
    blocks: baseBlocks(921, 105),
    images: [imageSpec('image-triangle', 'triangle', COLORS.imageC, 'section-3-body', { width: 32, height: 52, side: 'left', apex: 'top' })],
  }),
  multiShapeCollage: fixture('multi-shape-collage', {
    title: 'A multi-shape barrier laboratory',
    blocks: baseBlocks(941, 90),
    images: [
      imageSpec('image-collage-triangle', 'triangle', COLORS.imageC, 'section-3-body', { width: 18, height: 40, side: 'left', xOffset: 0 }),
      imageSpec('image-collage-star', 'star', COLORS.imageB, 'section-3-body', { width: 20, height: 40, side: 'left', xOffset: 4 }),
      imageSpec('image-collage-ellipse', 'ellipse', COLORS.imageA, 'section-3-body', { width: 16, height: 34, side: 'left', xOffset: 8 }),
    ],
  }),
  crossColumnEllipse: fixture('cross-column-ellipse', {
    blocks: baseBlocks(521, 120),
    images: [imageSpec('image-cross-column', 'ellipse', COLORS.imageA, 'section-1-body', {
      width: 28,
      height: 48,
      spanTracks: 2,
      xOffset: 70,
      wrapSide: 'auto',
    })],
  }),
  crossColumnContinuation: fixture('cross-column-continuation', {
    blocks: baseBlocks(531, 220),
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(532, 34) }],
    images: [imageSpec('image-cross-column-page-1', 'ellipse', COLORS.imageA, 'section-1-body', {
      width: 28,
      height: 48,
      spanTracks: 2,
      xOffset: 70,
      wrapSide: 'auto',
      pagePolicy: 'page-only',
      page: 0,
    })],
  }),
  largeBlockScaled: fixture('large-block-scaled', {
    blocks: baseBlocks(551, 130),
    keeps: [],
    images: [imageSpec('image-large-scaled', 'rectangle', COLORS.imageB, 'section-1-body', {
      mode: 'block',
      width: 75,
      height: 500,
      keepWithAnchor: false,
      scaleToFit: true,
      maxFragmentRatio: 0.75,
    })],
  }),
  largeBlockExplicitSlot: fixture('large-block-explicit-slot', {
    blocks: baseBlocks(554, 180),
    keeps: [],
    images: [imageSpec('image-large-explicit-slot', 'rectangle', COLORS.imageB, 'section-2-body', {
      placement: 'slot',
      slotTrack: 'secondary',
      mode: 'block',
      width: 53,
      height: 150,
      keepWithAnchor: false,
      scaleToFit: false,
    })],
  }),
  largeFloatPromoted: fixture('large-float-promoted', {
    blocks: baseBlocks(571, 115),
    images: [imageSpec('image-large-promoted', 'ellipse', COLORS.imageA, 'section-2-body', {
      width: 64,
      height: 92,
      minTextWidth: 18,
      narrowPolicy: 'block',
    })],
  }),
  largeImageRejected: fixture('large-image-rejected', {
    blocks: [
      { id: 'image-lead', type: 'paragraph', role: 'body', text: makeLorem(591, 25) },
      { id: 'image-tail', type: 'paragraph', role: 'body', text: makeLorem(592, 80) },
    ],
    images: [imageSpec('image-impossible', 'rectangle', COLORS.imageC, 'image-lead', {
      mode: 'block',
      width: 78,
      height: 500,
      scaleToFit: false,
    })],
    sidebar: [],
    keeps: [],
    policies: { maxPages: 3 },
  }),
  justifiedColumns: fixture('justified-columns', {
    blocks: baseBlocks(611, 210),
    images: [],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(612, 110) }],
  }),
  keepPush: fixture('keep-push', {
    blocks: [
      { id: 'lead-body', type: 'paragraph', role: 'body', text: makeLorem(601, 112) },
      { id: 'push-heading', type: 'heading', role: 'section_heading', text: 'This heading must travel with its lead', keepNext: { lines: 3 } },
      { id: 'push-body', type: 'paragraph', role: 'body', text: makeLorem(602, 90) },
    ],
    images: [],
    policies: { maxPages: 5 },
  }),
  markerPush: fixture('marker-push', {
    blocks: [
      { id: 'lead-body', type: 'paragraph', role: 'body', text: makeLorem(701, 170) },
      { id: 'list-pushed', type: 'list-item', role: 'body', text: `• ${makeLorem(702, 45)}`, marker: true },
      { id: 'tail', type: 'paragraph', role: 'body', text: makeLorem(703, 35) },
    ],
    images: [],
  }),
  unsatisfiable: fixture('unsatisfiable', {
    intro: makeLorem(801, 35),
    blocks: [
      { id: 'oversize-heading', type: 'heading', role: 'section_heading', text: 'Required group that cannot fit', keepNext: { whole: true } },
      { id: 'oversize-body', type: 'paragraph', role: 'body', text: makeLorem(802, 600) },
    ],
    images: [],
    keeps: [
      { id: 'keep-oversize', subject: 'oversize-heading', companion: 'oversize-body', whole: true, strength: 'required', onOversize: 'reject' },
    ],
    policies: { maxPages: 4 },
  }),
  longToken: fixture('long-token', {
    blocks: [{ id: 'token', type: 'paragraph', role: 'body', text: 'supercalifragilisticexpialidocious'.repeat(20) }],
    sidebar: [],
    images: [],
  }),
  unsupportedArabicBidi: fixture('unsupported-arabic-bidi', {
    writing: { direction: 'rtl', writingMode: 'horizontal-tb', script: 'Arab' },
    blocks: [{ id: 'arabic-body', type: 'paragraph', role: 'body', text: 'مرحبا بالعالم هذا اختبار اتجاه الكتابة من اليمين إلى اليسار.' }],
    sidebar: [],
    images: [],
    keeps: [],
  }),
  unsupportedCjkVertical: fixture('unsupported-cjk-vertical', {
    writing: { direction: 'ltr', writingMode: 'vertical-rl', script: 'Jpan' },
    blocks: [{ id: 'japanese-body', type: 'paragraph', role: 'body', text: 'これは縦書きと禁則処理を検証するためのテキストです。' }],
    sidebar: [],
    images: [],
    keeps: [],
  }),
  unsupportedVerticalLr: fixture('unsupported-vertical-lr', {
    writing: { direction: 'ltr', writingMode: 'vertical-lr', script: 'Latn' },
    blocks: [{ id: 'vertical-body', type: 'paragraph', role: 'body', text: 'Vertical Latin is intentionally rejected until glyph orientation is implemented.' }],
    sidebar: [],
    images: [],
    keeps: [],
  }),
  landscapeThreePages: fixture('landscape-three-pages', {
    title: 'A three-page landscape stress fixture',
    blocks: [...baseBlocks(1201, 400), ...baseBlocks(1301, 400, 'second-')],
    images: [
      imageSpec('image-landscape-star', 'star', COLORS.imageB, 'section-3-body', { width: 26, height: 44, side: 'left' }),
      imageSpec('image-landscape-ellipse', 'ellipse', COLORS.imageA, 'section-3-body', { width: 20, height: 34, side: 'left', xOffset: 8 }),
    ],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(1302, 240) }],
    qa: { family: 'landscape-pagination', expected: 'pass', minimumPages: 3 },
  }),
  landscapeShortSections: fixture('landscape-short-sections', {
    title: 'Many short editorial sections',
    blocks: compactSectionBlocks(1401, 14),
    images: [],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(1415, 80) }],
    qa: { family: 'landscape-short-sections', expected: 'pass', noStrandedHeadings: true },
  }),
  landscapeTitleParagraphs: fixture('landscape-title-paragraphs', {
    title: 'Title with compact paragraphs',
    intro: 'A title and several short paragraphs should remain readable, grouped, and balanced across the wide page.',
    blocks: [
      { id: 'title-section-heading', type: 'heading', role: 'section_heading', text: 'A title with a clear beginning', keepNext: { lines: 3 } },
      { id: 'title-section-body-1', type: 'paragraph', role: 'body', text: makeLorem(1501, 24) },
      { id: 'title-section-body-2', type: 'paragraph', role: 'body', text: makeLorem(1502, 22) },
      { id: 'title-section-heading-2', type: 'heading', role: 'section_heading', text: 'A second compact thought', keepNext: { lines: 3 } },
      { id: 'title-section-body-3', type: 'paragraph', role: 'body', text: makeLorem(1503, 28) },
      { id: 'title-section-body-4', type: 'paragraph', role: 'body', text: makeLorem(1504, 26) },
      { id: 'title-section-heading-3', type: 'heading', role: 'section_heading', text: 'A closing note', keepNext: { lines: 3 } },
      { id: 'title-section-body-5', type: 'paragraph', role: 'body', text: makeLorem(1505, 24) },
    ],
    images: [imageSpec('image-title-star', 'star', COLORS.imageB, 'title-section-body-3', { width: 22, height: 38, side: 'left' })],
    sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(1506, 60) }],
    qa: { family: 'landscape-short-paragraphs', expected: 'pass', noStrandedHeadings: true },
  }),
};

// A deliberately broad policy corpus. Each generated fixture is still a real
// plan and PNG, not a property-only assertion: the matrix varies text length,
// break boundary, image shape and user-selected flow profile.
const BREAKING_FIXTURES = {};
const BREAKING_LENGTHS = [
  { id: 'compact', words: 90 },
  { id: 'boundary', words: 180 },
  { id: 'long', words: 950 },
];
const BREAKING_SHAPES = [null, 'ellipse', 'star', 'triangle', 'staircase'];
const BREAKING_BOUNDARIES = ['heading', 'paragraph'];
const BREAKING_PROFILES_TO_TEST = ['editorial', 'balanced', 'freeform', 'strict'];

for (const profile of BREAKING_PROFILES_TO_TEST) {
  for (const length of BREAKING_LENGTHS) {
    for (const shape of BREAKING_SHAPES) {
      for (const boundary of BREAKING_BOUNDARIES) {
        const index = Object.keys(BREAKING_FIXTURES).length + 1;
        const prefix = `breaking-${profile}-${length.id}-${shape ?? 'plain'}-${boundary}`;
        const leadId = `${prefix}-lead`;
        const headingId = `${prefix}-heading`;
        const bodyId = `${prefix}-body`;
        const tailId = `${prefix}-tail`;
        const heading = {
          id: headingId,
          type: 'heading',
          role: 'section_heading',
          text: `A ${profile} ${length.id} ${boundary} section`,
          keepNext: { lines: profile === 'freeform' ? 1 : 2 },
        };
        const body = {
          id: bodyId,
          type: 'paragraph',
          role: 'body',
          text: makeLorem(18000 + index, length.words),
        };
        const blocks = boundary === 'heading'
          ? [
            { id: leadId, type: 'paragraph', role: 'body', text: makeLorem(19000 + index, Math.max(30, Math.floor(length.words / 2))) },
            heading,
            body,
            { id: tailId, type: 'paragraph', role: 'body', text: makeLorem(20000 + index, 55) },
          ]
          : [
            { id: leadId, type: 'paragraph', role: 'body', text: makeLorem(19000 + index, length.words) },
            heading,
            body,
            { id: tailId, type: 'paragraph', role: 'body', text: makeLorem(20000 + index, 35) },
          ];
        const images = shape
          ? [imageSpec(`${prefix}-image`, shape, [COLORS.imageA, COLORS.imageB, COLORS.imageC][index % 3], bodyId, {
            width: 18 + (index % 4),
            height: 26 + (index % 5) * 3,
            side: index % 2 ? 'left' : 'right',
            keepWithAnchor: false,
            defer: false,
            apex: index % 2 ? 'top' : 'bottom',
          })]
          : [];
        BREAKING_FIXTURES[prefix] = fixture(prefix, {
          title: `Breaking policy corpus ${index}`,
          intro: `Profile ${profile}; ${length.id} text; ${boundary} boundary; ${shape ?? 'no image'}.`,
          blocks,
          images,
          sidebar: [{ id: `${prefix}-sidebar`, type: 'paragraph', role: 'sidebar', text: makeLorem(21000 + index, 30) }],
          policies: { profile, maxPages: 8 },
          qa: {
            family: 'breaking-policy-corpus',
            profile,
            length: length.id,
            boundary,
            shape: shape ?? 'none',
            expected: 'pass',
            avoidSingleLineContinuation: profile !== 'freeform',
            expectsUnderfillDiagnostic: false,
          },
        });
      }
    }
  }
}
Object.assign(FIXTURES, BREAKING_FIXTURES);

// Controlled line-capacity probes. The filler uses one fixed word so the
// sweep changes source length without changing word-width distribution.
const BOUNDARY_FIXTURES = {};
const BOUNDARY_PROFILES = ['editorial', 'balanced', 'freeform', 'strict'];
const BOUNDARY_STATES = [
  ['under', 260],
  ['exact', 264],
  ['over', 268],
  ['push', 272],
];
for (const profile of BOUNDARY_PROFILES) {
  for (const [state, fillerWords] of BOUNDARY_STATES) {
    const id = `boundary-${profile}-${state}`;
    BOUNDARY_FIXTURES[id] = fixture(id, {
      title: `Boundary sweep ${profile} ${state}`,
      intro: 'Controlled line-capacity boundary fixture.',
      blocks: [
        { id: `${id}-filler`, type: 'paragraph', role: 'body', text: fixedWords('constant', fillerWords) },
        { id: `${id}-heading`, type: 'heading', role: 'section_heading', text: 'A protected boundary', keepNext: { lines: 2 } },
        { id: `${id}-body`, type: 'paragraph', role: 'body', text: fixedWords('continuation', 40) },
      ],
      sidebar: [],
      images: [],
      keeps: [{ id: `${id}-keep`, subject: `${id}-heading`, companion: `${id}-body`, lines: 2, strength: 'required', onOversize: 'reject' }],
      policies: { profile, maxPages: 4 },
      qa: {
        family: 'boundary-sweep',
        profile,
        state,
        expected: 'pass',
      },
    });
  }
}
Object.assign(FIXTURES, BOUNDARY_FIXTURES);

const breakingProtectedBlocks = FIXTURES.landscapeThreePages.blocks;
Object.assign(FIXTURES, {
  breakingProtectedImage: fixture('breaking-protected-image', {
    title: 'Protected image underfill case',
    blocks: breakingProtectedBlocks,
    images: [imageSpec('breaking-protected-star', 'star', COLORS.imageB, 'section-3-body', {
      width: 26,
      height: 44,
      side: 'left',
      keepWithAnchor: true,
      defer: true,
    })],
    sidebar: FIXTURES.landscapeThreePages.sidebar,
    policies: { profile: 'editorial' },
    qa: { family: 'breaking-policy-corpus', profile: 'editorial', expected: 'pass' },
  }),
  breakingStrictProtectedImage: fixture('breaking-strict-protected-image', {
    title: 'Strict protected image calibration case',
    blocks: FIXTURES.landscapeThreePages.blocks,
    images: [imageSpec('breaking-strict-star', 'star', COLORS.imageB, 'section-3-body', {
      width: 26,
      height: 44,
      side: 'left',
      keepWithAnchor: true,
      defer: true,
    })],
    sidebar: FIXTURES.landscapeThreePages.sidebar,
    policies: { profile: 'strict' },
    qa: { family: 'breaking-policy-corpus', profile: 'strict', expected: 'pass', strictReject: false },
  }),
  breakingFreeformSingleLine: fixture('breaking-freeform-single-line', {
    title: 'Freeform single-line continuation case',
    blocks: [
      { id: 'single-line-lead', type: 'paragraph', role: 'body', text: makeLorem(22601, 355) },
      { id: 'single-line-tail', type: 'paragraph', role: 'body', text: makeLorem(22701, 80) },
    ],
    images: [imageSpec('single-line-ellipse', 'ellipse', COLORS.imageA, 'single-line-lead', { width: 20, height: 32, keepWithAnchor: false, defer: false })],
    sidebar: [],
    policies: { profile: 'freeform' },
    qa: { family: 'breaking-policy-corpus', profile: 'freeform', expected: 'pass', allowSingleLineContinuation: true },
  }),
  breakingEditorialRelaxedSingleLine: fixture('breaking-editorial-relaxed-single-line', {
    title: 'Editorial relaxed widow case',
    blocks: [
      { id: 'relaxed-line-lead', type: 'paragraph', role: 'body', text: makeLorem(22801, 355) },
      { id: 'relaxed-line-tail', type: 'paragraph', role: 'body', text: makeLorem(22901, 80) },
    ],
    images: [imageSpec('relaxed-line-triangle', 'triangle', COLORS.imageC, 'relaxed-line-lead', { width: 18, height: 30, keepWithAnchor: false, defer: false })],
    sidebar: [],
    policies: { profile: 'editorial', widows: 1, orphans: 1 },
    qa: { family: 'breaking-policy-corpus', profile: 'editorial', expected: 'pass' },
  }),
});

function occlusionImage(id, shape, color, options = {}) {
  return imageSpec(id, shape, color, options.anchorBlock ?? 'section-3-body', {
    width: options.width ?? 20,
    height: options.height ?? 42,
    side: options.side ?? 'left',
    xOffset: options.xOffset,
    spanTracks: options.spanTracks,
    mode: options.mode,
    placement: options.placement,
    slotTrack: options.slotTrack,
    apex: options.apex,
    defer: false,
  });
}

function occlusionFixture(key, slug, images, qa, options = {}) {
  return [key, fixture(slug, {
    title: options.title ?? `Star occlusion fixture · ${key}`,
    blocks: baseBlocks(options.seed ?? 1000, options.paragraphWords ?? 85),
    sidebar: options.sidebar ?? [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem((options.seed ?? 1000) + 1, 24) }],
    images,
    qa: { family: 'star-occlusion', expected: 'pass', ...qa },
  })];
}

const OCCLUSION_FIXTURES = Object.fromEntries([
  occlusionFixture('occlusion01', 'star-behind-ellipse', [
    occlusionImage('star-back', 'star', COLORS.imageB, { xOffset: 3, width: 24 }),
    occlusionImage('ellipse-front', 'ellipse', COLORS.imageA, { xOffset: 9, width: 22, height: 36 }),
  ], { zOrder: ['star-back', 'ellipse-front'], occluded: ['star-back'], expectation: 'ellipse hides the star center; text avoids their union' }, { seed: 1001 }),
  occlusionFixture('occlusion02', 'star-in-front-of-ellipse', [
    occlusionImage('ellipse-back', 'ellipse', COLORS.imageA, { xOffset: 9, width: 22, height: 36 }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 3, width: 24 }),
  ], { zOrder: ['ellipse-back', 'star-front'], occluded: ['ellipse-back'], expectation: 'star is the visible top layer' }, { seed: 1002 }),
  occlusionFixture('occlusion03', 'star-behind-triangle', [
    occlusionImage('star-back', 'star', COLORS.imageB, { xOffset: 2, width: 23 }),
    occlusionImage('triangle-front', 'triangle', COLORS.imageC, { xOffset: 8, width: 22, height: 42 }),
  ], { zOrder: ['star-back', 'triangle-front'], occluded: ['star-back'], expectation: 'triangle covers the star on the shared half' }, { seed: 1003 }),
  occlusionFixture('occlusion04', 'triangle-behind-star', [
    occlusionImage('triangle-back', 'triangle', COLORS.imageC, { xOffset: 8, width: 22, height: 42 }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 2, width: 23 }),
  ], { zOrder: ['triangle-back', 'star-front'], occluded: ['triangle-back'], expectation: 'star remains visible over triangle' }, { seed: 1004 }),
  occlusionFixture('occlusion05', 'nested-stars', [
    occlusionImage('star-large', 'star', COLORS.imageB, { xOffset: 1, width: 28, height: 48 }),
    occlusionImage('star-small', 'star', COLORS.imageC, { xOffset: 8, width: 15, height: 28 }),
  ], { zOrder: ['star-large', 'star-small'], occluded: ['star-large'], expectation: 'small star occludes only the center of large star' }, { seed: 1005 }),
  occlusionFixture('occlusion06', 'star-under-rectangle', [
    occlusionImage('star-back', 'star', COLORS.imageB, { xOffset: 2, width: 23, height: 42 }),
    occlusionImage('rectangle-front', 'rectangle', COLORS.imageC, { xOffset: 3, width: 21, height: 38 }),
  ], { zOrder: ['star-back', 'rectangle-front'], occluded: ['star-back'], expectation: 'rectangle is an opaque barrier over the star' }, { seed: 1006 }),
  occlusionFixture('occlusion07', 'partial-star-ellipse', [
    occlusionImage('star-back', 'star', COLORS.imageB, { xOffset: 1, width: 26 }),
    occlusionImage('ellipse-front', 'ellipse', COLORS.imageA, { xOffset: 14, width: 12, height: 30 }),
  ], { zOrder: ['star-back', 'ellipse-front'], occluded: ['star-back'], expectation: 'star tips remain visible around ellipse' }, { seed: 1007 }),
  occlusionFixture('occlusion08', 'touching-star-ellipse', [
    occlusionImage('star-left', 'star', COLORS.imageB, { xOffset: 1, width: 18 }),
    occlusionImage('ellipse-right', 'ellipse', COLORS.imageA, { xOffset: 18, width: 15, height: 30 }),
  ], { zOrder: ['star-left', 'ellipse-right'], occluded: [], expectation: 'shapes touch or nearly touch without a synthetic text gap' }, { seed: 1008 }),
  occlusionFixture('occlusion09', 'star-at-left-edge', [
    occlusionImage('star-edge', 'star', COLORS.imageB, { xOffset: 0, width: 18, height: 38 }),
    occlusionImage('ellipse-edge', 'ellipse', COLORS.imageA, { xOffset: 5, width: 12, height: 26 }),
  ], { zOrder: ['star-edge', 'ellipse-edge'], occluded: ['star-edge'], expectation: 'edge clipping remains inside article track' }, { seed: 1009 }),
  occlusionFixture('occlusion10', 'star-at-right-edge', [
    occlusionImage('star-right', 'star', COLORS.imageB, { side: 'right', xOffset: 31, width: 18, height: 38 }),
    occlusionImage('triangle-right', 'triangle', COLORS.imageC, { side: 'right', xOffset: 32, width: 14, height: 30, apex: 'bottom' }),
  ], { zOrder: ['star-right', 'triangle-right'], occluded: ['star-right'], expectation: 'right-side wrap keeps text to the left' }, { seed: 1010 }),
  occlusionFixture('occlusion11', 'star-with-top-apex', [
    occlusionImage('triangle-apex-top', 'triangle', COLORS.imageC, { xOffset: 2, width: 22, height: 42, apex: 'top' }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 8, width: 17, height: 32 }),
  ], { zOrder: ['triangle-apex-top', 'star-front'], occluded: ['triangle-apex-top'], expectation: 'top apex does not force heading into the barrier' }, { seed: 1011 }),
  occlusionFixture('occlusion12', 'star-with-bottom-apex', [
    occlusionImage('triangle-apex-bottom', 'triangle', COLORS.imageC, { xOffset: 2, width: 22, height: 42, apex: 'bottom' }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 8, width: 17, height: 32 }),
  ], { zOrder: ['triangle-apex-bottom', 'star-front'], occluded: ['triangle-apex-bottom'], expectation: 'bottom apex expands barrier only where geometry exists' }, { seed: 1012 }),
  occlusionFixture('occlusion13', 'star-over-large-ellipse', [
    occlusionImage('ellipse-back', 'ellipse', COLORS.imageA, { xOffset: 1, width: 27, height: 48 }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 5, width: 18, height: 34 }),
  ], { zOrder: ['ellipse-back', 'star-front'], occluded: ['ellipse-back'], expectation: 'star is visible over a larger ellipse' }, { seed: 1013 }),
  occlusionFixture('occlusion14', 'three-layer-stars', [
    occlusionImage('star-back', 'star', COLORS.imageB, { xOffset: 0, width: 28, height: 46 }),
    occlusionImage('ellipse-middle', 'ellipse', COLORS.imageA, { xOffset: 7, width: 22, height: 38 }),
    occlusionImage('star-front', 'star', COLORS.imageC, { xOffset: 12, width: 13, height: 24 }),
  ], { zOrder: ['star-back', 'ellipse-middle', 'star-front'], occluded: ['star-back', 'ellipse-middle'], expectation: 'three z-order layers remain a single union barrier' }, { seed: 1014 }),
  occlusionFixture('occlusion15', 'star-spanning-columns', [
    occlusionImage('star-span', 'star', COLORS.imageB, { anchorBlock: 'section-1-body', width: 24, height: 42, spanTracks: 2, xOffset: 75, side: 'right' }),
    occlusionImage('triangle-span', 'triangle', COLORS.imageC, { anchorBlock: 'section-1-body', width: 18, height: 32, spanTracks: 2, xOffset: 80, side: 'right' }),
  ], { zOrder: ['star-span', 'triangle-span'], occluded: ['star-span'], expectation: 'a spanning image shares one exclusion object across both article columns', expected: 'pass' }, { seed: 1015 }),
  occlusionFixture('occlusion16', 'star-long-pagination', [
    occlusionImage('star-pagination', 'star', COLORS.imageB, { width: 22, height: 44 }),
    occlusionImage('ellipse-pagination', 'ellipse', COLORS.imageA, { xOffset: 6, width: 16, height: 30 }),
  ], { zOrder: ['star-pagination', 'ellipse-pagination'], occluded: ['star-pagination'], expectation: 'images stay on page one while text continues to later pages' }, { seed: 1016, paragraphWords: 150 }),
  occlusionFixture('occlusion17', 'star-keeps-heading-away', [
    occlusionImage('star-under-section', 'star', COLORS.imageB, { xOffset: 2, width: 24, height: 44 }),
    occlusionImage('ellipse-front', 'ellipse', COLORS.imageA, { xOffset: 8, width: 18, height: 32 }),
  ], { zOrder: ['star-under-section', 'ellipse-front'], occluded: ['star-under-section'], expectation: 'heading and first body lines remain a keep cluster' }, { seed: 1017 }),
  occlusionFixture('occlusion18', 'star-with-sidebar-pressure', [
    occlusionImage('star-sidebar-pressure', 'star', COLORS.imageB, { xOffset: 1, width: 22, height: 42 }),
    occlusionImage('triangle-sidebar-pressure', 'triangle', COLORS.imageC, { xOffset: 8, width: 18, height: 34 }),
  ], { zOrder: ['star-sidebar-pressure', 'triangle-sidebar-pressure'], occluded: ['star-sidebar-pressure'], expectation: 'article barriers do not leak into sidebar flow' }, { seed: 1018, sidebar: [{ id: 'sidebar-body', type: 'paragraph', role: 'sidebar', text: makeLorem(1019, 110) }], paragraphWords: 100 }),
  occlusionFixture('occlusion19', 'star-visible-after-occluder', [
    occlusionImage('ellipse-back', 'ellipse', COLORS.imageA, { xOffset: 4, width: 18, height: 32 }),
    occlusionImage('star-front', 'star', COLORS.imageB, { xOffset: 10, width: 16, height: 28 }),
    occlusionImage('triangle-front', 'triangle', COLORS.imageC, { xOffset: 18, width: 12, height: 24 }),
  ], { zOrder: ['ellipse-back', 'star-front', 'triangle-front'], occluded: ['ellipse-back', 'star-front'], expectation: 'later layers retain a valid visible mask' }, { seed: 1019 }),
  occlusionFixture('occlusion20', 'star-collage-no-overflow', [
    occlusionImage('star-collage-a', 'star', COLORS.imageB, { xOffset: 0, width: 14, height: 28 }),
    occlusionImage('star-collage-b', 'star', COLORS.imageC, { xOffset: 14, width: 14, height: 28 }),
    occlusionImage('ellipse-collage', 'ellipse', COLORS.imageA, { xOffset: 7, width: 18, height: 26 }),
  ], { zOrder: ['star-collage-a', 'star-collage-b', 'ellipse-collage'], occluded: ['star-collage-a', 'star-collage-b'], expectation: 'compact collage remains inside the fragmentainer' }, { seed: 1020 }),
]);
Object.assign(FIXTURES, OCCLUSION_FIXTURES);

function flowBoxFixture(id, seed, boxWords, bodyWords, options = {}) {
  const headingId = `${id}-heading`;
  const bodyId = `${id}-body`;
  const introId = `${id}-intro-box`;
  return fixture(id, {
    title: options.title ?? `Flow box fixture · ${id}`,
    intro: '',
    flowBoxes: [{
      id: introId,
      type: 'box',
      role: 'intro',
      text: makeLorem(seed, boxWords),
      span: 'all',
      pagePolicy: 'first-page-only',
      background: COLORS.lead,
    }],
    blocks: [
      { id: headingId, type: 'heading', role: 'section_heading', text: 'A heading after the expanding intro box', keepNext: { lines: 3 } },
      { id: bodyId, type: 'paragraph', role: 'body', text: makeLorem(seed + 1, bodyWords) },
      { id: `${id}-tail`, type: 'paragraph', role: 'body', text: makeLorem(seed + 2, Math.max(35, Math.floor(bodyWords / 2))) },
    ],
    sidebar: [{ id: `${id}-sidebar`, type: 'paragraph', role: 'sidebar', text: makeLorem(seed + 3, 55) }],
    sidebarStart: 'prelude',
    images: [],
    keeps: [{ id: `${id}-keep`, subject: headingId, companion: bodyId, lines: 3, strength: 'required', onOversize: 'reject' }],
    policies: { profile: options.profile ?? 'editorial', maxPages: options.maxPages ?? 4 },
    qa: {
      family: 'intro-flow-box',
      expected: options.expectedStatus === 'rejected' ? 'rejected' : 'pass',
      expectedStatus: options.expectedStatus,
      boxId: introId,
      noBoxAfterFirstPage: true,
      ...options.qa,
    },
  });
}

function regionalFlowBoxFixture(id, seed, boxWords, spanRegions, options = {}) {
  const boxId = `${id}-box`;
  const headingId = `${id}-heading`;
  const bodyId = `${id}-body`;
  return fixture(id, {
    title: options.title ?? `Regional flow box · ${id}`,
    intro: '',
    flowBoxes: [{
      id: boxId,
      type: 'box',
      role: options.role ?? 'intro',
      text: makeLorem(seed, boxWords),
      spanRegions,
      pagePolicy: 'first-page-only',
      background: options.background ?? COLORS.lead,
      placement: options.placement ?? 'block',
      anchorBlock: options.placement === 'float' ? bodyId : undefined,
      spanStartFraction: options.spanStartFraction,
      spanEndFraction: options.spanEndFraction,
    }, ...(options.floatBoxes ?? [])],
    blocks: [
      { id: headingId, type: 'heading', role: 'section_heading', text: 'A heading after the regional box', keepNext: { lines: 3 } },
      { id: bodyId, type: 'paragraph', role: 'body', text: makeLorem(seed + 1, options.bodyWords ?? 260) },
      { id: `${id}-tail`, type: 'paragraph', role: 'body', text: makeLorem(seed + 2, options.tailWords ?? 120) },
    ],
    sidebar: [{ id: `${id}-sidebar`, type: 'paragraph', role: 'sidebar', text: makeLorem(seed + 3, options.sidebarWords ?? 90) }],
    sidebarStart: 'prelude',
    images: [],
    keeps: [{ id: `${id}-keep`, subject: headingId, companion: bodyId, lines: 3, strength: 'required', onOversize: 'reject' }],
    policies: { profile: options.profile ?? 'freeform', maxPages: options.maxPages ?? 4 },
    qa: { family: 'regional-flow-box', expected: 'pass', scenario: options.scenario ?? 'box-spans-declared-regions', ...options.qa },
  });
}

Object.assign(FIXTURES, {
  flowBoxShort: flowBoxFixture('flow-box-short', 31001, 34, 300, {
    qa: { scenario: 'short-box-pushes-following-flow', minPages: 2, minFirstArticleLines: 1 },
  }),
  flowBoxExpanded: flowBoxFixture('flow-box-expanded', 31101, 155, 220, {
    qa: { scenario: 'expanded-box-reduces-first-page-capacity', minPages: 2, minFirstArticleLines: 1 },
  }),
  flowBoxNearPageEnd: flowBoxFixture('flow-box-near-page-end', 31201, 270, 160, {
    qa: { scenario: 'box-leaves-only-a-small-first-page-remainder', minPages: 2, maxFirstArticleLines: 20 },
  }),
  flowBoxKeepsHeading: flowBoxFixture('flow-box-keeps-heading', 31301, 330, 120, {
    qa: { scenario: 'keep-cluster-moves-after-box', minPages: 2, firstPageArticleLines: 0 },
  }),
  flowBoxLoremVariant: flowBoxFixture('flow-box-lorem-variant', 31401, 185, 340, {
    profile: 'balanced',
    qa: { scenario: 'different-lorem-shape-keeps-flow-deterministic', minPages: 3 },
  }),
  flowBoxImpossible: flowBoxFixture('flow-box-impossible', 31501, 700, 60, {
    expectedStatus: 'rejected',
    maxPages: 3,
    qa: { scenario: 'box-overflow-is-reported-instead-of-clipping', expectedStatus: 'rejected' },
  }),
  flowBoxEmpty: fixture('flow-box-empty', {
    title: 'Empty flow box collapse case',
    intro: '',
    flowBoxes: [{ id: 'flow-box-empty-intro', type: 'box', role: 'intro', text: '', span: 'all', pagePolicy: 'first-page-only' }],
    blocks: [{ id: 'flow-box-empty-body', type: 'paragraph', role: 'body', text: makeLorem(31601, 40) }],
    sidebar: [],
    images: [],
    keeps: [],
    qa: { family: 'intro-flow-box', expected: 'pass', scenario: 'empty-box-collapses-without-spacing' },
  }),
  flowBoxOverLeadSecondary: regionalFlowBoxFixture('flow-box-over-lead-secondary', 31701, 70, ['lead', 'secondary'], {
    scenario: 'explicit-lead-and-secondary-span',
  }),
  flowBoxOverSecondarySidebar: regionalFlowBoxFixture('flow-box-over-secondary-sidebar', 31801, 62, ['secondary', 'sidebar'], {
    scenario: 'secondary-and-sidebar-share-a-block-row',
  }),
  flowBoxOverAllRegions: regionalFlowBoxFixture('flow-box-over-all-regions', 31901, 62, ['lead', 'secondary', 'sidebar'], {
    scenario: 'all-regions-share-a-block-row',
  }),
  flowBoxPartialLeadToSidebar: regionalFlowBoxFixture('flow-box-partial-lead-to-sidebar', 32001, 38, ['lead', 'secondary', 'sidebar'], {
    placement: 'float',
    spanStartFraction: prototypeConfig.flow_box_cases.partial_start_fraction,
    spanEndFraction: prototypeConfig.flow_box_cases.partial_end_fraction,
    scenario: 'partial-edge-span-produces-rectangular-step',
  }),
  flowBoxFloatQuotes: regionalFlowBoxFixture('flow-box-float-quotes', 32101, 30, ['lead', 'secondary'], {
    boxWords: 30,
    bodyWords: 170,
    scenario: 'quote-boxes-act-as-image-like-exclusions',
    floatBoxes: [
      {
        id: 'flow-box-float-quotes-first',
        type: 'box',
        role: 'intro',
        text: makeLorem(32111, 12),
        placement: 'float',
        anchorBlock: 'flow-box-float-quotes-body',
        spanRegions: ['lead', 'secondary'],
        xOffset_mm: prototypeConfig.flow_box_cases.quote_x_offset_mm,
        width_mm: prototypeConfig.flow_box_cases.quote_width_mm,
        height_mm: prototypeConfig.flow_box_cases.quote_height_mm,
        background: COLORS.imageB,
      },
      {
        id: 'flow-box-float-quotes-second',
        type: 'box',
        role: 'intro',
        text: makeLorem(32112, 10),
        placement: 'float',
        anchorBlock: 'flow-box-float-quotes-tail',
        spanRegions: ['secondary'],
        width_mm: prototypeConfig.flow_box_cases.secondary_quote_width_mm,
        xOffset_mm: prototypeConfig.flow_box_cases.secondary_quote_x_offset_mm,
        background: COLORS.imageC,
      },
    ],
  }),
});

function loadExternalFixtures(path) {
  if (!path) return null;
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(payload) ? payload : payload.fixtures;
  assert(Array.isArray(entries) && entries.length > 0, `Fixture JSON '${path}' must contain a non-empty fixtures array.`);
  return Object.fromEntries(entries.map((fixtureData) => {
    assert(fixtureData && typeof fixtureData.id === 'string', `Fixture JSON '${path}' contains a fixture without an id.`);
    return [fixtureData.id, fixtureData];
  }));
}

const externalFixtures = loadExternalFixtures(fixtureJsonPath);

function normalizedFlowBoxes(fixtureData) {
  if ((fixtureData.flowBoxes ?? []).length > 0) return fixtureData.flowBoxes;
  if (!fixtureData.intro) return [];
  return [{
    id: `${fixtureData.id}-intro-box`,
    type: 'box',
    role: 'intro',
    text: fixtureData.intro,
    span: 'all',
    pagePolicy: 'first-page-only',
    padding_mm: prototypeConfig.intro.text_inset_mm,
    firstBaselineOffset_mm: prototypeConfig.intro.first_baseline_offset_mm,
    background: [248, 248, 244],
  }];
}

function activeFlowBoxes(fixtureData, pageIndex) {
  if (pageIndex !== 0) return [];
  return normalizedFlowBoxes(fixtureData).filter((box) => {
    if (box.pagePolicy === 'later-pages') return false;
    const hasText = typeof box.text === 'string' && box.text.trim().length > 0;
    const hasExplicitSize = box.height_mm !== undefined || box.minHeight_mm !== undefined;
    return hasText || hasExplicitSize;
  });
}

function templateFlowRegions() {
  let x = PAGE.margin.left;
  const article = TEMPLATE.articleTracks.map((track) => {
    const region = { ...track, x };
    x += track.width + TEMPLATE.trackGap;
    return region;
  });
  return [...article, { id: 'sidebar', x: PAGE.margin.left + TEMPLATE.articleWidth + TEMPLATE.articleSidebarGap, width: TEMPLATE.sidebarWidth }];
}

function flowBoxRegionIds(box) {
  if (Array.isArray(box.spanRegions) && box.spanRegions.length > 0) return box.spanRegions;
  const tracks = TEMPLATE.articleTracks.map((track) => track.id);
  const count = box.span === 'all' ? tracks.length : Math.max(1, Math.floor(box.spanTracks ?? tracks.length));
  return tracks.slice(0, count);
}

function flowBoxRegions(page, box) {
  const available = [...page.article.tracks, page.sidebar];
  const requested = flowBoxRegionIds(box);
  return requested.map((id) => available.find((region) => region.id === id)).filter(Boolean);
}

function flowBoxGeometry(box, regions) {
  const first = regions[0];
  const last = regions.at(-1);
  if (!first || !last) return { x: PAGE.margin.left, width: 0, regionIds: [] };
  const startInset = (box.spanStartFraction ?? 0) * first.width;
  const endInset = (box.spanEndFraction ?? 0) * last.width;
  const naturalX = first.x + startInset;
  const naturalRight = last.x + last.width - endInset;
  const x = box.x_mm ?? (box.xOffset_mm === undefined ? naturalX : first.x + box.xOffset_mm);
  const width = box.width_mm ?? Math.max(0, naturalRight - x);
  return { x, width, regionIds: regions.map((region) => region.id) };
}

function flowBoxWidth(box) {
  const regions = templateFlowRegions().filter((region) => flowBoxRegionIds(box).includes(region.id));
  return flowBoxGeometry(box, regions).width;
}

function flowBoxLayout(metrics, box) {
  const padding = box.padding_mm ?? prototypeConfig.flow_boxes.default_padding_mm;
  const width = box.width_mm ?? flowBoxWidth(box);
  const innerWidth = width - padding * 2;
  const block = { ...box, role: box.role ?? 'body', text: box.text ?? '' };
  const wrapped = wrapFrom(metrics, block, 0, () => innerWidth);
  const firstBaselineOffset = box.firstBaselineOffset_mm ?? prototypeConfig.flow_boxes.first_baseline_offset_mm;
  const height = Math.max(
    box.minHeight_mm ?? 0,
    (wrapped.lines.length ? firstBaselineOffset : 0) + wrapped.lines.length * lineHeight(metrics, block) + padding * 2,
  );
  return { ...box, ...wrapped, block, padding, width, height, innerWidth, firstBaselineOffset };
}

function flowBoxHeight(metrics, fixtureData, pageIndex) {
  const boxes = activeFlowBoxes(fixtureData, pageIndex).filter((box) => (box.placement ?? box.mode ?? 'block') !== 'float');
  return boxes.reduce((total, box, index) => {
    const gap = index < boxes.length - 1 ? prototypeConfig.flow_boxes.default_gap_mm : 0;
    return total + flowBoxLayout(metrics, box).height + gap;
  }, 0);
}

function preludeTop(page) {
  return PAGE.margin.top + page.header.height + TEMPLATE.bodyGap;
}

function preludeRegionStart(metrics, fixtureData, page, regionId) {
  const boxes = activeFlowBoxes(fixtureData, page.index).filter((box) => (box.placement ?? box.mode ?? 'block') !== 'float');
  const relevant = boxes.filter((box) => flowBoxRegionIds(box).includes(regionId));
  if (!relevant.length) return preludeTop(page);
  const height = relevant.reduce((total, box, index) => total + flowBoxLayout(metrics, box).height + (index < relevant.length - 1 ? prototypeConfig.flow_boxes.default_gap_mm : 0), 0);
  return preludeTop(page) + height + TEMPLATE.bodyGap;
}

function pageGeometry(metrics, fixtureData, index) {
  const header = Math.min(TEMPLATE.header.max, Math.max(TEMPLATE.header.min, TEMPLATE.header.preferred));
  const footer = Math.min(TEMPLATE.footer.max, Math.max(TEMPLATE.footer.min, TEMPLATE.footer.preferred));
  const pageShell = { index, header: { height: header } };
  const bodyTop = preludeRegionStart(metrics, fixtureData, pageShell, 'lead');
  const sidebarY = fixtureData.sidebarStart === 'prelude'
    ? preludeRegionStart(metrics, fixtureData, pageShell, 'sidebar')
    : bodyTop;
  const bodyBottom = PAGE.height - PAGE.margin.bottom - footer;
  const articleX = PAGE.margin.left;
  const sidebarX = articleX + TEMPLATE.articleWidth + TEMPLATE.articleSidebarGap;
  let trackX = articleX;
  const articleTracks = TEMPLATE.articleTracks.map((track) => {
    const positioned = { ...track, x: trackX, y: preludeRegionStart(metrics, fixtureData, pageShell, track.id), bottom: bodyBottom };
    trackX += track.width + TEMPLATE.trackGap;
    return positioned;
  });
  return {
    index,
    header: { x: PAGE.margin.left, y: PAGE.margin.top, width: PAGE.width - PAGE.margin.left - PAGE.margin.right, height: header },
    footer: { x: PAGE.margin.left, y: PAGE.height - PAGE.margin.bottom - footer, width: PAGE.width - PAGE.margin.left - PAGE.margin.right, height: footer },
    flowBoxes: [],
    article: {
      x: articleX,
      y: bodyTop,
      bottom: bodyBottom,
      tracks: articleTracks,
    },
    sidebar: { id: 'sidebar', x: sidebarX, y: sidebarY, width: TEMPLATE.sidebarWidth, bottom: bodyBottom },
  };
}

function placeFlowBoxes(metrics, fixtureData, page, plan) {
  const boxes = activeFlowBoxes(fixtureData, page.index).filter((box) => (box.placement ?? box.mode ?? 'block') !== 'float');
  let y = preludeTop(page);
  const capacityBottom = PAGE.height - PAGE.margin.bottom - TEMPLATE.footer.preferred;
  for (const box of boxes) {
    const layout = flowBoxLayout(metrics, box);
    const regions = flowBoxRegions(page, box);
    const geometry = flowBoxGeometry(box, regions);
    const x = geometry.x;
    const placement = {
      ...layout,
      x,
      width: geometry.width,
      page: page.index,
      y,
      tracks: geometry.regionIds,
      position: { ...(box.position ?? {}), wrap: false },
      lineHeight: lineHeight(metrics, layout.block),
      lines: layout.lines.map((line, index) => ({
        ...line,
        x: x + layout.padding,
        y: y + layout.padding + layout.firstBaselineOffset + index * lineHeight(metrics, layout.block),
        height: lineHeight(metrics, layout.block),
      })),
    };
    if (placement.y + placement.height > capacityBottom + 0.01) {
      plan.violations.push({ code: 'FLOW_BOX_OVERFLOW', box: box.id, required: placement.y + placement.height, capacity: capacityBottom, policy: box.onOverflow ?? 'reject' });
    }
    plan.boxes.push(placement);
    y += placement.height + prototypeConfig.flow_boxes.default_gap_mm;
  }
}

function emptyPageState(page, regionName = 'article', trackIndex = 0) {
  if (regionName === 'sidebar') return { page, regionName, trackIndex: 0, y: page.sidebar.y };
  return { page, regionName, trackIndex, y: page.article.tracks[trackIndex].y };
}

function effectiveWrapGap(placements) {
  const pixelSafetyGap = prototypeConfig.wrap.raster_safety_gap_px * 25.4 / prototypeConfig.page.expected_dpi;
  const declaredGap = placements.reduce((maximum, placement) => Math.max(maximum, placement.position?.wrapGap ?? 0), 0);
  return Math.max(TEMPLATE.flow.wrapGap, pixelSafetyGap, declaredGap);
}

function currentRegion(state) {
  if (state.regionName === 'sidebar') return state.page.sidebar;
  return state.page.article.tracks[state.trackIndex];
}

function regionBottom(state) {
  return state.regionName === 'sidebar' ? state.page.sidebar.bottom : currentRegion(state).bottom;
}

function regionWidth(state) {
  return state.regionName === 'sidebar' ? state.page.sidebar.width : currentRegion(state).width;
}

function advanceState(state, pages, fixtureData, metrics) {
  if (state.regionName === 'sidebar') {
    const nextPageIndex = state.page.index + 1;
    while (pages.length <= nextPageIndex) pages.push(pageGeometry(metrics, fixtureData, pages.length));
    return emptyPageState(pages[nextPageIndex], 'sidebar');
  }
  if (state.trackIndex + 1 < state.page.article.tracks.length) return emptyPageState(state.page, 'article', state.trackIndex + 1);
  const nextPageIndex = state.page.index + 1;
  while (pages.length <= nextPageIndex) pages.push(pageGeometry(metrics, fixtureData, pages.length));
  return emptyPageState(pages[nextPageIndex], 'article', 0);
}

function placeReservedSlots(fixtureData, pages, plan, imageStates, metrics) {
  for (const image of fixtureData.images.filter((candidate) => candidate.placement === 'slot')) {
    const pageIndex = image.fixedPage ?? 0;
    while (pages.length <= pageIndex) pages.push(pageGeometry(metrics, fixtureData, pages.length));
    const page = pages[pageIndex];
    const trackIndex = page.article.tracks.findIndex((track) => track.id === image.slotTrack);
    if (trackIndex < 0) {
      plan.violations.push({ code: 'IMAGE_SLOT_TRACK_MISSING', image: image.id, slotTrack: image.slotTrack });
      continue;
    }
    const track = page.article.tracks[trackIndex];
    let width = Math.min(image.width, track.width);
    let height = image.height * (width / image.width);
    if (height > track.bottom - track.y) {
      if (!image.scaleToFit) {
        plan.violations.push({ code: 'IMAGE_OVERSIZE', image: image.id, required: height, capacity: track.bottom - track.y, policy: 'reject' });
        continue;
      }
      const scale = (track.bottom - track.y) / height;
      width *= scale;
      height *= scale;
      plan.decisions.push({ code: 'IMAGE_SCALED_TO_SLOT', image: image.id, page: pageIndex, track: track.id, scale: Number(scale.toFixed(3)) });
    }
    const placement = {
      ...image,
      width,
      height,
      page: pageIndex,
      track: trackIndex,
      tracks: [track.id],
      x: track.x + (track.width - width) / 2,
      y: track.y,
    };
    imageStates.set(image.id, placement);
    plan.images.push(placement);
    plan.decisions.push({ code: 'IMAGE_RESERVED_SLOT', image: image.id, page: pageIndex, track: track.id });
  }
}

function availableAt(state, imagePlacement, lineOffset, style) {
  const region = currentRegion(state);
  if (!imagePlacement) return { x: region.x, width: region.width };
  const placements = Array.isArray(imagePlacement) ? imagePlacement : [imagePlacement];
  const relevantPlacements = placements.filter((placement) => placement.page === state.page.index && placement.tracks?.includes(region.id));
  if (relevantPlacements.length === 0) return { x: region.x, width: region.width };
  const top = state.y + lineOffset * style.leading;
  const bottom = top + style.leading;
  const intervals = [top + 0.05, top + style.leading / 2, bottom - 0.05]
    .flatMap((y) => relevantPlacements.map((placement) => imageIntervalAt(placement, y)))
    .filter((interval) => interval && interval.right > region.x && interval.left < region.x + region.width);
  if (intervals.length === 0) return { x: region.x, width: region.width };
  const reference = relevantPlacements[0];
  const side = relevantPlacements.some((placement) => placement.wrapSide === 'left')
    ? 'left'
    : reference.wrapSide === 'auto'
      ? reference.x + reference.width / 2 >= region.x + region.width / 2 ? 'right' : 'left'
      : reference.wrapSide;
  const barrierLeft = Math.min(...intervals.map((interval) => interval.left));
  const barrierRight = Math.max(...intervals.map((interval) => interval.right));
  const wrapGap = effectiveWrapGap(placements);
  const leftWidth = barrierLeft - region.x - wrapGap;
  const rightX = barrierRight + wrapGap;
  const rightWidth = region.x + region.width - rightX;
  if (side === 'left') {
    if (rightWidth >= TEMPLATE.flow.minimumTextWidth) return { x: rightX, width: rightWidth };
    if (leftWidth >= TEMPLATE.flow.minimumTextWidth) return { x: region.x, width: leftWidth };
    return { x: rightX, width: Math.max(TEMPLATE.flow.minimumTextWidth, rightWidth) };
  }
  if (leftWidth >= TEMPLATE.flow.minimumTextWidth) return { x: region.x, width: leftWidth };
  if (rightWidth >= TEMPLATE.flow.minimumTextWidth) return { x: rightX, width: rightWidth };
  return { x: region.x, width: Math.max(TEMPLATE.flow.minimumTextWidth, leftWidth) };
}

function findKeep(fixtureData, blockId) {
  return fixtureData.keeps.find((keep) => keep.subject === blockId);
}

function blockIndexOf(blocks, id) {
  return blocks.findIndex((block) => block.id === id);
}

function requiredKeepHeight(metrics, fixtureData, blocks, index, state) {
  const block = blocks[index];
  const keep = findKeep(fixtureData, block.id);
  if (!keep) return null;
  const companionIndex = blockIndexOf(blocks, keep.companion);
  if (companionIndex < 0) return { keep, height: lineHeight(metrics, block), inactive: true };
  const companion = blocks[companionIndex];
  const width = regionWidth(state);
  const subjectLines = wrapFrom(metrics, block, 0, () => width).lines;
  const subjectHeight = subjectLines.length * lineHeight(metrics, block) + (subjectLines.length ? 2 : 0);
  const companionLines = wrapFrom(metrics, companion, 0, () => width).lines;
  const count = keep.whole ? companionLines.length : Math.min(keep.lines ?? 1, companionLines.length);
  let minimumCompanionLines = companionLines.length;
  if (!keep.whole) {
    for (let capacity = count; capacity <= companionLines.length; capacity += 1) {
      const remainder = companionLines.length - capacity;
      let take = capacity;
      if (remainder > 0 && remainder < fixtureData.policies.widows) take -= fixtureData.policies.widows - remainder;
      if (remainder > 0 && take < fixtureData.policies.orphans) continue;
      if (take >= count) {
        minimumCompanionLines = capacity;
        break;
      }
    }
  }
  const image = fixtureData.images.find((candidate) => candidate.anchorBlock === companion.id && candidate.keepWithAnchor);
  const imageHeight = image ? image.height : 0;
  return {
    keep,
    height: Math.max(
      subjectHeight + minimumCompanionLines * lineHeight(metrics, companion),
      imageHeight ? imageHeight + subjectHeight + minimumCompanionLines * lineHeight(metrics, companion) : 0,
    ),
    subjectLines: subjectLines.length,
    companionLeading: lineHeight(metrics, companion),
    requiredCompanionLines: count,
    minimumCompanionLines,
    companionLines: companionLines.length,
  };
}

function placeFloatIfNeeded(metrics, fixtureData, block, state, plan, imageStates) {
  const image = fixtureData.images.find((candidate) => candidate.anchorBlock === block.id && !Number.isInteger(imageStates.get(candidate.id)?.page));
  if (!image || imageStates.has(image.id)) return null;
  const region = currentRegion(state);
  if (state.regionName !== 'article') return null;
  if (image.position?.mode === 'absolute') {
    const pageIndex = image.position.page ?? image.fixedPage ?? state.page.index;
    if (state.page.index < pageIndex) return 'advance';
    if (state.page.index > pageIndex) {
      plan.violations.push({ code: 'ABSOLUTE_IMAGE_PAGE_MISSED', image: image.id, requiredPage: pageIndex, actualPage: state.page.index });
      return 'reject';
    }
    const frame = image.position.frame ?? {};
    const reference = image.position.reference ?? 'page';
    const baseX = reference === 'anchor-box' ? region.x : 0;
    const baseY = reference === 'anchor-box' ? state.y : 0;
    const width = frame.width ?? image.width;
    const height = frame.height ?? image.height;
    const absoluteX = baseX + (frame.x ?? 0);
    const absoluteY = baseY + (frame.y ?? 0);
    const intersectedTracks = state.page.article.tracks.filter((track) => (
      track.x < absoluteX + width
      && track.x + track.width > absoluteX
    ));
    const placement = {
      ...image,
      width,
      height,
      page: pageIndex,
      track: intersectedTracks[0]?.id ?? region.id,
      tracks: (intersectedTracks.length ? intersectedTracks : [region]).map((track) => track.id),
      x: absoluteX,
      y: absoluteY,
      position: { ...image.position, reference, wrap: image.position.wrap !== false },
    };
    if (placement.x < 0 || placement.y < 0 || placement.x + width > PAGE.width || placement.y + height > PAGE.height) {
      plan.violations.push({ code: 'ABSOLUTE_IMAGE_OUTSIDE_PAGE', image: image.id, x: placement.x, y: placement.y, width, height });
    }
    imageStates.set(image.id, placement);
    plan.images.push(placement);
    plan.decisions.push({ code: 'IMAGE_ABSOLUTE_PLACED', image: image.id, page: pageIndex, reference });
    return placement;
  }
  if (image.fixedPage !== undefined && state.page.index !== image.fixedPage) {
    if (state.page.index < image.fixedPage) return 'advance';
    plan.violations.push({ code: 'IMAGE_FIXED_PAGE_MISSED', image: image.id, requiredPage: image.fixedPage, actualPage: state.page.index });
    return 'reject';
  }
  const imageWidth = Math.min(image.width, region.width);
  const imageHeight = image.height * (imageWidth / image.width);
  const remainingHeight = region.bottom - state.y;
  const isNarrowFloat = image.mode === 'float'
    && image.minTextWidth > 0
    && region.width - imageWidth - 4 < image.minTextWidth;
  if (isNarrowFloat && image.narrowPolicy === 'block') {
    plan.decisions.push({ code: 'FLOAT_PROMOTED_TO_BLOCK', image: image.id, at: `${state.page.index}:${state.trackIndex}`, reason: 'insufficient-inline-capacity', requiredTextWidth: image.minTextWidth, remainingTextWidth: Math.max(0, region.width - imageWidth - 4) });
  }
  const effectiveMode = isNarrowFloat && image.narrowPolicy === 'block' ? 'block' : image.mode;
  if (effectiveMode === 'block') {
    let width = imageWidth;
    let height = imageHeight;
    if (height > remainingHeight && state.y > region.y + 0.1) return 'advance';
    if (height > remainingHeight) {
      if (!image.scaleToFit || remainingHeight <= 0) {
        plan.violations.push({ code: 'IMAGE_OVERSIZE', image: image.id, required: height, capacity: remainingHeight, policy: 'reject' });
        return 'reject';
      }
      const scale = remainingHeight / height;
      width *= scale;
      height *= scale;
      plan.decisions.push({ code: 'IMAGE_SCALED_TO_FRAGMENTAINER', image: image.id, page: state.page.index, track: currentRegion(state).id, scale: Number(scale.toFixed(3)) });
    }
    const placement = { ...image, mode: 'block', width, height, page: state.page.index, track: state.trackIndex, tracks: [region.id], x: region.x + (region.width - width) / 2, y: state.y };
    imageStates.set(image.id, { ...placement, defers: imageStates.get(image.id)?.defers ?? 0 });
    plan.images.push(placement);
    state.y += height + TEMPLATE.bodyGap;
    return placement;
  }
  if (image.width > region.width) {
    plan.violations.push({ code: 'IMAGE_WIDTH_OVERSIZE', image: image.id, required: image.width, capacity: region.width });
    return 'reject';
  }
  if (isNarrowFloat && image.narrowPolicy === 'reject') {
    plan.violations.push({ code: 'IMAGE_LEAVES_NO_TEXT_WIDTH', image: image.id, required: image.minTextWidth, capacity: Math.max(0, region.width - image.width - 4) });
    return 'reject';
  }
  if (image.height > region.bottom - region.y) {
    plan.violations.push({ code: 'FLOAT_OVERSIZE', image: image.id, required: image.height, capacity: region.bottom - region.y });
    return 'reject';
  }
  const remaining = region.bottom - state.y;
  if (remaining < image.height + lineHeight(metrics, block) * 2 && image.defer && state.y > region.y + 0.1) {
    imageStates.set(image.id, { defers: (imageStates.get(image.id)?.defers ?? 0) + 1 });
    plan.decisions.push({ code: 'FLOAT_DEFERRED', image: image.id, from: `${state.page.index}:${state.trackIndex}`, reason: 'insufficient-local-capacity' });
    return 'advance';
  }
  const spanCount = Math.max(1, Math.floor(image.spanTracks ?? 1));
  const span = state.page.article.tracks.slice(state.trackIndex, state.trackIndex + spanCount);
  if (span.length < spanCount) {
    plan.violations.push({ code: 'IMAGE_SPAN_OVERSIZE', image: image.id, requiredTracks: spanCount, availableTracks: span.length });
    return 'reject';
  }
  const spanX = span[0].x;
  const spanRight = span.at(-1).x + span.at(-1).width;
  const spanWidth = spanRight - spanX;
  const width = Math.min(image.width, spanWidth);
  const x = image.xOffset === undefined
    ? image.side === 'left' ? spanX : spanRight - width
    : spanX + image.xOffset;
  const placement = {
    ...image,
    width,
    page: state.page.index,
    track: state.trackIndex,
    tracks: span.map((track) => track.id),
    x,
    y: state.y,
  };
  imageStates.set(image.id, { ...placement, defers: imageStates.get(image.id)?.defers ?? 0 });
  plan.images.push(placement);
  return placement;
}

function placeFloatBoxIfNeeded(metrics, fixtureData, block, state, plan, flowBoxStates) {
  if (state.regionName !== 'article') return null;
  const box = activeFlowBoxes(fixtureData, state.page.index).find((candidate) => (
    (candidate.placement ?? candidate.mode ?? 'block') === 'float'
    && candidate.anchorBlock === block.id
    && !flowBoxStates.has(candidate.id)
  ));
  if (!box) return null;
  const regions = flowBoxRegions(state.page, box);
  const geometry = flowBoxGeometry(box, regions);
  const layout = flowBoxLayout(metrics, { ...box, width_mm: geometry.width });
  const height = box.height_mm ?? layout.height;
  const placement = {
    ...layout,
    placement: 'float',
    shape: 'rectangle',
    page: state.page.index,
    track: currentRegion(state).id,
    tracks: geometry.regionIds,
    x: geometry.x,
    y: state.y,
    width: geometry.width,
    height,
    position: { ...(box.position ?? {}), wrap: box.wrap !== false },
    lines: layout.lines.map((line, index) => ({
      ...line,
      x: geometry.x + layout.padding,
      y: state.y + layout.padding + layout.firstBaselineOffset + index * lineHeight(metrics, layout.block),
      height: lineHeight(metrics, layout.block),
    })),
  };
  if (placement.y + placement.height > state.page.article.bottom + 0.01) {
    plan.violations.push({ code: 'FLOW_BOX_FLOAT_OVERFLOW', box: box.id, required: placement.y + placement.height, capacity: state.page.article.bottom, policy: box.onOverflow ?? 'reject' });
    return 'reject';
  }
  flowBoxStates.set(box.id, placement);
  plan.boxes.push(placement);
  plan.decisions.push({ code: 'FLOW_BOX_FLOAT_PLACED', box: box.id, page: state.page.index, track: currentRegion(state).id });
  return placement;
}

function addLinePlacement(metrics, plan, state, block, line, lineOffset, imagePlacement, marker = false) {
  const style = { ...STYLES[styleFor(block)], leading: lineHeight(metrics, block) };
  const available = availableAt(state, imagePlacement, lineOffset, style);
  const x = marker ? available.x + 3 : available.x;
  const placements = Array.isArray(imagePlacement) ? imagePlacement : imagePlacement ? [imagePlacement] : [];
  plan.lines.push({
    page: state.page.index,
    region: state.regionName,
    track: state.regionName === 'article' ? currentRegion(state).id : 'sidebar',
    blockId: block.id,
    blockType: block.type,
    line: line.lineIndex,
    startWord: line.startWord,
    endWord: line.endWord,
    text: line.text,
    x,
    y: state.y + lineOffset * style.leading,
    width: available.width - (marker ? 3 : 0),
    naturalWidth: line.width,
    height: style.leading,
    finalLine: line.endWord >= wordsOf(block.text.replace(/^•\s/u, '')).length,
    overfull: line.overfull,
    marker,
    wrap: placements.length > 0 && state.regionName === 'article'
      ? {
        imageId: placements[0].id,
        imageIds: placements.map((placement) => placement.id),
        side: placements[0].wrapSide,
        availableX: available.x,
        availableWidth: available.width,
      }
      : null,
  });
}

function placeFlow(metrics, fixtureData, blocks, pages, plan, regionName, imageStates, flowBoxStates) {
  let state = emptyPageState(pages[0], regionName, 0);
  let blockIndex = 0;
  const cursors = new Map();
  while (blockIndex < blocks.length) {
    if (pages.length > fixtureData.policies.maxPages) {
      plan.violations.push({ code: 'MAX_PAGES_EXCEEDED', maxPages: fixtureData.policies.maxPages, blockId: blocks[blockIndex].id });
      return;
    }
    const block = blocks[blockIndex];
    const startWord = cursors.get(block.id) ?? 0;
    const region = currentRegion(state);
    const style = { ...STYLES[styleFor(block)], leading: lineHeight(metrics, block) };
    const remaining = region.bottom - state.y;
    if (startWord === 0 && regionName === 'article') {
      const keepInfo = requiredKeepHeight(metrics, fixtureData, blocks, blockIndex, state);
      if (keepInfo && !keepInfo.inactive) {
        const capacityPage = state.page.index === 0 ? pageGeometry(metrics, fixtureData, 1) : state.page;
        const maxCapacity = Math.max(...capacityPage.article.tracks.map((track) => track.width > 0 ? track.bottom - track.y : 0));
        if (maxCapacity > 0 && keepInfo.height > maxCapacity && keepInfo.keep.strength === 'required' && keepInfo.keep.onOversize === 'reject') {
          plan.violations.push({ code: 'KEEP_GLOBAL_OVERSIZE', constraint: keepInfo.keep.id, required: keepInfo.height, capacity: maxCapacity, blockId: block.id });
          return;
        }
        if (keepInfo.height > remaining + 0.01) {
          if (keepInfo.keep.strength === 'preferred' && keepInfo.keep.onOversize === 'split') {
            plan.decisions.push({ code: 'KEEP_RELAXED', constraint: keepInfo.keep.id, reason: 'preferred-local-overflow' });
          } else {
            const previous = state;
            state = advanceState(state, pages, fixtureData, metrics);
            plan.decisions.push({ code: 'KEEP_CLUSTER_PUSHED', constraint: keepInfo.keep.id, from: `${previous.page.index}:${previous.trackIndex}`, to: `${state.page.index}:${state.trackIndex}`, reason: 'insufficient-local-capacity', reflowFrom: block.id });
            continue;
          }
        }
      }
    }
    const newlyPlacedBoxes = [];
    const newlyPlacedImages = [];
    let floatResult = null;
    while (true) {
      const boxResult = placeFloatBoxIfNeeded(metrics, fixtureData, block, state, plan, flowBoxStates);
      if (boxResult === 'reject') return;
      if (boxResult) newlyPlacedBoxes.push(boxResult);
      floatResult = placeFloatIfNeeded(metrics, fixtureData, block, state, plan, imageStates);
      if (!floatResult || floatResult === 'advance' || floatResult === 'reject') break;
      newlyPlacedImages.push(floatResult);
    }
    if (floatResult === 'advance') {
      state = advanceState(state, pages, fixtureData, metrics);
      continue;
    }
    if (floatResult === 'reject') return;
    const activeImageCandidates = [...newlyPlacedBoxes, ...newlyPlacedImages, ...flowBoxStates.values(), ...fixtureData.images.map((image) => imageStates.get(image.id))]
      .filter((image) => image?.position?.wrap !== false && image?.page === state.page.index
        && image.tracks?.includes(currentRegion(state).id)
        && image.y < region.bottom
        && image.y + image.height > state.y);
    const activeImages = [...new Map(activeImageCandidates.map((image) => [image.id, image])).values()];
    const reservedImage = activeImages.find((image) => image.placement === 'slot' && image.track === state.trackIndex);
    if (reservedImage) {
      state.y = reservedImage.y + reservedImage.height + TEMPLATE.bodyGap;
      plan.decisions.push({ code: 'TEXT_FLOW_AFTER_RESERVED_IMAGE', image: reservedImage.id, page: state.page.index, track: currentRegion(state).id });
    }
    const wrapped = wrapFrom(metrics, block, startWord, (lineIndex) => availableAt(state, activeImages, lineIndex, style).width - (block.marker ? 3 : 0));
    const capacity = Math.floor((region.bottom - state.y) / style.leading);
    const blockedIndex = wrapped.lines.findIndex((line, lineIndex) => {
      if (!line.overfull || activeImages.length === 0) return false;
      const available = availableAt(state, activeImages, lineIndex, style);
      const probe = {
        page: state.page.index,
        region: state.regionName,
        track: currentRegion(state).id,
        x: available.x,
        y: state.y + lineIndex * style.leading,
        width: available.width,
        naturalWidth: line.width,
        height: style.leading,
        finalLine: false,
        overfull: line.overfull,
      };
      const firstWord = wrapped.words[line.startWord] ?? line.text;
      const firstWordTooWide = available.width + 0.01 < widthOf(metrics, firstWord, styleFor(block));
      return activeImages.some((image) => {
        if (lineIntersectsImage(probe, image)) return true;
        if (!firstWordTooWide) return false;
        return [probe.y + 0.05, probe.y + style.leading / 2, probe.y + style.leading - 0.05]
          .some((sampleY) => imageIntervalAt(image, sampleY));
      });
    });
    if (blockedIndex >= 0) {
      const blockedY = state.y + blockedIndex * style.leading;
      const blockers = activeImages.filter((image) => image.y <= blockedY + style.leading && image.y + image.height > blockedY);
      if (blockers.length > 0) {
        const prefix = wrapped.lines.slice(0, blockedIndex);
        if (prefix.length > 0) {
          for (const line of prefix) {
            const marker = Boolean(block.marker && !plan.lines.some((candidate) => candidate.blockId === block.id && candidate.marker));
            addLinePlacement(metrics, plan, state, block, line, line.lineIndex, activeImages, marker);
          }
          state.y += prefix.length * style.leading;
          cursors.set(block.id, prefix.at(-1).endWord);
        }
        state.y = Math.max(state.y, ...blockers.map((image) => image.y + image.height + TEMPLATE.bodyGap));
        plan.decisions.push({ code: 'TEXT_PUSHED_BELOW_IMAGE', blockId: block.id, imageIds: blockers.map((image) => image.id), page: state.page.index, track: currentRegion(state).id });
        continue;
      }
    }
    if (startWord === 0 && block.atomic) {
      const fullCapacity = Math.floor((region.bottom - region.y) / style.leading);
      const requiredLines = wrapped.lines.length;
      if (requiredLines > capacity && requiredLines <= fullCapacity && state.y > region.y + 0.1) {
        const previous = state;
        state = advanceState(state, pages, fixtureData, metrics);
        plan.decisions.push({ code: 'ATOMIC_BLOCK_PUSHED', blockId: block.id, from: `${previous.page.index}:${previous.trackIndex}`, to: `${state.page.index}:${state.trackIndex}`, reason: 'whole-block-does-not-fit' });
        continue;
      }
      if (requiredLines > fullCapacity) {
        plan.violations.push({ code: 'ATOMIC_BLOCK_OVERSIZE', blockId: block.id, requiredLines, capacity: fullCapacity });
      }
    }
    if (capacity <= 0 || (startWord === 0 && block.type === 'list-item' && capacity < 1)) {
      state = advanceState(state, pages, fixtureData, metrics);
      plan.decisions.push({ code: block.type === 'list-item' ? 'LIST_ITEM_START_PUSHED' : 'BLOCK_PUSHED', blockId: block.id, reason: 'no-local-capacity' });
      continue;
    }
    let take = Math.min(capacity, wrapped.lines.length);
    const remainder = wrapped.lines.length - take;
    if (remainder > 0 && remainder < fixtureData.policies.widows) take -= fixtureData.policies.widows - remainder;
    if (remainder > 0 && take < fixtureData.policies.orphans) {
      if (state.y > region.y + 0.1) {
        state = advanceState(state, pages, fixtureData, metrics);
        plan.decisions.push({ code: block.type === 'list-item' ? 'LIST_ITEM_START_PUSHED' : 'BLOCK_PUSHED', blockId: block.id, reason: 'orphans-policy' });
        continue;
      }
      plan.violations.push({ code: 'ORPHANS_UNSATISFIED', blockId: block.id, capacity, required: fixtureData.policies.orphans });
      return;
    }
    if (take <= 0) {
      state = advanceState(state, pages, fixtureData, metrics);
      continue;
    }
    for (const line of wrapped.lines.slice(0, take)) {
      const marker = Boolean(block.marker && !plan.lines.some((candidate) => candidate.blockId === block.id && candidate.marker));
      addLinePlacement(metrics, plan, state, block, line, line.lineIndex, activeImages, marker);
    }
    state.y += take * style.leading + (take === wrapped.lines.length ? (block.type === 'heading' ? 2 : 1) : 0);
    if (take === wrapped.lines.length) {
      if (block.marker && !plan.lines.some((line) => line.blockId === block.id && line.marker)) plan.violations.push({ code: 'LIST_MARKER_WITHOUT_FIRST_LINE', blockId: block.id });
      blockIndex += 1;
      cursors.delete(block.id);
    } else {
      const nextWord = wrapped.lines[take - 1].endWord;
      cursors.set(block.id, nextWord);
      state = advanceState(state, pages, fixtureData, metrics);
      plan.decisions.push({ code: 'BLOCK_CONTINUED', blockId: block.id, nextPage: state.page.index, nextTrack: state.trackIndex });
    }
  }
}

function articleFragmentGroups(plan) {
  const groups = new Map();
  for (const line of plan.lines.filter((candidate) => candidate.region === 'article')) {
    const key = `${line.page}:${line.track}`;
    const group = groups.get(key) ?? { page: line.page, track: line.track, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => {
    if (left.page !== right.page) return left.page - right.page;
    const leftIndex = plan.pages[left.page].article.tracks.findIndex((track) => track.id === left.track);
    const rightIndex = plan.pages[right.page].article.tracks.findIndex((track) => track.id === right.track);
    return leftIndex - rightIndex;
  });
}

function evaluateBreakPolicy(fixtureData, plan) {
  const policy = fixtureData.policies;
  const violations = [];
  const groups = articleFragmentGroups(plan);
  const groupInfo = groups.map((group, index) => {
    const track = plan.pages[group.page].article.tracks.find((candidate) => candidate.id === group.track);
    const lastLine = group.lines.reduce((latest, line) => Math.max(latest, line.y + line.height), track.y);
    const fillRatio = (lastLine - track.y) / (track.bottom - track.y);
    return { ...group, track, fillRatio, next: groups[index + 1] ?? null };
  });

  for (const group of groupInfo) {
    if (!group.next || policy.target_fill_ratio <= 0 || group.fillRatio + 0.0001 >= policy.target_fill_ratio) continue;
    const decision = plan.decisions.find((candidate) => {
      const from = `${group.page}:${plan.pages[group.page].article.tracks.findIndex((track) => track.id === group.track.id)}`;
      return candidate.from === from;
    });
    const diagnostic = {
      code: 'UNDERFILL_PROTECTED_BREAK',
      page: group.page,
      track: group.track.id,
      fillRatio: Number(group.fillRatio.toFixed(3)),
      targetRatio: policy.target_fill_ratio,
      nextPage: group.next.page,
      nextTrack: group.next.track,
      cause: decision?.constraint ?? decision?.blockId ?? 'content-boundary',
      policy: policy.profile,
    };
    plan.diagnostics.push(diagnostic);
    if (policy.underfill_policy === 'reject') violations.push(diagnostic);
  }

  if (policy.avoid_single_line_fragment) {
    const byBlock = new Map();
    for (const line of plan.lines.filter((candidate) => candidate.region === 'article')) {
      const key = `${line.blockId}:${line.page}:${line.track}`;
      const group = byBlock.get(key) ?? { blockId: line.blockId, page: line.page, track: line.track, lines: [] };
      group.lines.push(line);
      byBlock.set(key, group);
    }
    const blockFragments = new Map();
    for (const group of byBlock.values()) {
      const fragments = blockFragments.get(group.blockId) ?? [];
      fragments.push(group);
      blockFragments.set(group.blockId, fragments);
    }
    for (const fragments of blockFragments.values()) {
      if (fragments.length < 2) continue;
      for (const fragment of fragments.slice(1)) {
        if (fragment.lines.length !== 1) continue;
        const diagnostic = {
          code: 'SINGLE_LINE_CONTINUATION',
          blockId: fragment.blockId,
          page: fragment.page,
          track: fragment.track,
          policy: policy.profile,
        };
        plan.diagnostics.push(diagnostic);
        if (policy.underfill_policy === 'reject') violations.push(diagnostic);
      }
    }
  }
  return violations;
}

function evaluate(fixtureData, plan) {
  const violations = [...plan.violations];
  const seen = new Set();
  for (const page of plan.pages) {
    const tracks = [...page.article.tracks].sort((left, right) => left.x - right.x);
    for (let index = 1; index < tracks.length; index += 1) {
      if (tracks[index].x < tracks[index - 1].x + tracks[index - 1].width - 0.01) {
        violations.push({ code: 'ARTICLE_TRACK_OVERLAP', page: page.index, left: tracks[index - 1].id, right: tracks[index].id });
      }
    }
  }
  for (const line of plan.lines) {
    const key = `${line.blockId}:${line.startWord}:${line.endWord}`;
    if (seen.has(key)) violations.push({ code: 'DUPLICATE_CONTENT', key });
    seen.add(key);
    const region = line.region === 'sidebar' ? plan.pages[line.page].sidebar : plan.pages[line.page].article.tracks.find((track) => track.id === line.track);
    const available = line.width;
    if (!region || line.x < region.x - 0.01 || line.x + Math.min(available, line.naturalWidth) > region.x + region.width + 0.05) violations.push({ code: 'LINE_OUTSIDE_REGION', blockId: line.blockId, page: line.page, track: line.track });
    const image = plan.images.find((candidate) => lineIntersectsImage(line, candidate));
    if (image) violations.push({ code: 'LINE_INTERSECTS_IMAGE', blockId: line.blockId, image: image.id, page: line.page, track: line.track });
    const flowBox = plan.boxes.find((candidate) => candidate.placement === 'float' && lineIntersectsImage(line, candidate));
    if (flowBox) violations.push({ code: 'LINE_INTERSECTS_FLOW_BOX', blockId: line.blockId, box: flowBox.id, page: line.page, track: line.track });
    if (line.overfull) violations.push({ code: 'OVERFULL_LINE', blockId: line.blockId, page: line.page, text: line.text });
    if (line.y + line.height > region.bottom + 0.05) violations.push({ code: 'LINE_BEYOND_FRAGMENTAINER', blockId: line.blockId, page: line.page });
  }
  for (const box of plan.boxes) {
    for (const line of box.lines ?? []) {
      if (line.x < box.x - 0.01 || line.x + line.width > box.x + box.width + 0.05 || line.y < box.y - 0.01 || line.y + line.height > box.y + box.height + 0.05) {
        violations.push({ code: 'FLOW_BOX_TEXT_OUTSIDE', box: box.id, page: box.page });
      }
    }
  }
  for (const keep of fixtureData.keeps) {
    const subjectLines = plan.lines.filter((line) => line.blockId === keep.subject);
    const companionLines = plan.lines.filter((line) => line.blockId === keep.companion);
    if (!subjectLines.length || !companionLines.length) continue;
    const first = subjectLines[0];
    const required = keep.whole ? companionLines : companionLines.slice(0, keep.lines ?? 1);
    const sameFragment = required.every((line) => line.page === first.page && line.region === first.region && line.track === first.track);
    if (!sameFragment && keep.strength === 'required') violations.push({ code: 'KEEP_REQUIRED_VIOLATED', constraint: keep.id, subject: keep.subject, companion: keep.companion });
  }
  for (const block of fixtureData.blocks) {
    if (!block.marker) continue;
    const lines = plan.lines.filter((line) => line.blockId === block.id);
    if (!lines.length || !lines[0].marker) violations.push({ code: 'LIST_MARKER_REQUIRES_FIRST_LINE', blockId: block.id });
  }
  const expectedBlocks = new Set(fixtureData.blocks.map((block) => block.id));
  const plannedBlocks = new Set(plan.lines.map((line) => line.blockId));
  for (const id of expectedBlocks) if (!plannedBlocks.has(id)) violations.push({ code: 'CONTENT_NOT_PLACED', blockId: id });
  for (const image of plan.images) {
    if (image.maxFragmentRatio === undefined) continue;
    const page = plan.pages[image.page];
    const track = page?.article.tracks.find((candidate) => candidate.id === image.tracks?.[0]) ?? page?.article.tracks[image.track];
    if (!track) continue;
    const ratio = image.height / (track.bottom - track.y);
    if (ratio > image.maxFragmentRatio + 0.001) {
      violations.push({
        code: 'IMAGE_DOMINATES_FRAGMENTAINER',
        image: image.id,
        page: image.page,
        track: image.track,
        ratio: Number(ratio.toFixed(3)),
        maxRatio: image.maxFragmentRatio,
      });
    }
  }
  violations.push(...evaluateBreakPolicy(fixtureData, plan));
  return { accepted: violations.length === 0, violations };
}

const SOFT_WARNING_CODES = new Set([
  'UNDERFILL_PROTECTED_BREAK',
  'SINGLE_LINE_CONTINUATION',
  'KEEP_REQUIRED_VIOLATED',
  'IMAGE_DOMINATES_FRAGMENTAINER',
  'ATOMIC_BLOCK_OVERSIZE',
  'OVERFULL_LINE',
]);
const WARNING_DIAGNOSTIC_CODES = new Set(['UNDERFILL_PROTECTED_BREAK', 'SINGLE_LINE_CONTINUATION']);

function isSoftWarning(violation) {
  return SOFT_WARNING_CODES.has(violation.code);
}

function planWarnings(plan) {
  return [
    ...plan.evaluation.violations,
    ...plan.diagnostics.filter((diagnostic) => WARNING_DIAGNOSTIC_CODES.has(diagnostic.code)),
  ];
}

function outcomeFor(fixtureData, plan) {
  if (plan.status !== 'rejected') {
    const warnings = planWarnings(plan);
    return {
      isError: false,
      status: plan.status,
      artifact: { format: 'pdf', pages: plan.pages.length },
      decisions: plan.decisions,
      constraints: { violations: warnings.length },
      warnings,
      residualContent: fixtureData.blocks.filter((block) => !plan.lines.some((line) => line.blockId === block.id)).map((block) => block.id),
    };
  }
  const primary = plan.evaluation.violations[0] ?? { code: 'COMPOSITION_UNSATISFIABLE' };
  const placed = new Set(plan.lines.map((line) => line.blockId));
  const residual = fixtureData.blocks.filter((block) => !placed.has(block.id)).map((block) => block.id);
  return {
    isError: false,
    status: 'rejected',
    code: ['OVERFULL_LINE', 'UNSUPPORTED_WRITING_SYSTEM'].includes(primary.code) ? primary.code : 'COMPOSITION_UNSATISFIABLE',
    message: primary.code === 'OVERFULL_LINE'
      ? 'PDF nie został utworzony, ponieważ niełamliwy token przekroczył dostępną miarę linii.'
      : primary.code === 'UNSUPPORTED_WRITING_SYSTEM'
        ? 'PDF nie został utworzony, ponieważ zadeklarowany system pisma lub kierunek przepływu nie jest jeszcze obsługiwany przez ten renderer.'
      : 'PDF nie został utworzony, ponieważ wymagania kompozycji są sprzeczne albo treść nie mieści się w żadnym dozwolonym fragmencie.',
    residualContent: residual,
    attempts: plan.decisions,
    unsatisfiedCore: plan.evaluation.violations,
  };
}

function planFixture(fixtureData, metrics) {
  assertTextMetrics(metrics);
  const pages = [];
  const firstPage = pageGeometry(metrics, fixtureData, 0);
  pages.push(firstPage);
  const plan = {
    fixture: fixtureData.id,
    preset: requestedPreset,
    pageSize: { width_mm: PAGE.width, height_mm: PAGE.height },
    renderer: {
      brandRef: activeBrand.ref,
      brandName: activeBrand.data.meta?.name ?? activeBrand.name,
      brandProfile: activeBrand.profile,
      fontFamily: activeBrand.fontFamily,
      fontRegularLoaded: Boolean(activeBrand.fontRegular),
      fontBoldLoaded: Boolean(activeBrand.fontBold),
      styles: Object.fromEntries(Object.entries(STYLES).map(([name, style]) => [name, { ...style }])),
    },
    source: {
      brand: fixtureData.brand ?? null,
      product: fixtureData.source ?? null,
      writing: { ...fixtureData.writing },
      blocks: [...fixtureData.blocks, ...fixtureData.sidebar].map((block) => ({
        id: block.id,
        region: fixtureData.sidebar.some((candidate) => candidate.id === block.id) ? 'sidebar' : 'article',
        type: block.type,
        wordCount: wordsOf(block.text.replace(/^•\s/u, '')).length,
        marker: Boolean(block.marker),
      })),
      images: fixtureData.images.map((image) => ({
        id: image.id,
        shape: image.shape,
        color: image.color,
        side: image.side,
        zOrder: fixtureData.images.findIndex((candidate) => candidate.id === image.id),
        anchorBlock: image.anchorBlock,
        pagePolicy: image.pagePolicy,
        fixedPage: image.fixedPage,
        placement: image.placement,
        position: image.position ?? null,
      })),
      keeps: fixtureData.keeps.map((keep) => ({ ...keep })),
      flowBoxes: normalizedFlowBoxes(fixtureData).map((box) => ({
        id: box.id,
        type: box.type ?? 'box',
        role: box.role ?? 'body',
        text: box.text ?? '',
        pagePolicy: box.pagePolicy ?? 'first-page-only',
        span: box.span ?? null,
        spanTracks: box.spanTracks ?? null,
        spanRegions: box.spanRegions ?? null,
        placement: box.placement ?? box.mode ?? 'block',
        anchorBlock: box.anchorBlock ?? null,
      })),
      policy: { ...fixtureData.policies },
      sidebarStart: fixtureData.sidebarStart ?? 'after-prelude',
    },
    qa: fixtureData.qa ?? null,
    pages,
    boxes: [],
    lines: [],
    images: [],
    decisions: [],
    diagnostics: [],
    violations: [],
    attempts: [],
  };
  const writingViolation = unsupportedWritingViolation(fixtureData);
  if (writingViolation) {
    plan.evaluation = { accepted: false, violations: [writingViolation] };
    plan.status = 'rejected';
    plan.attempts.push({ revision: 'preflight', status: plan.status, violations: plan.evaluation.violations });
    plan.outcome = outcomeFor(fixtureData, plan);
    return { plan };
  }
  const imageStates = new Map();
  const flowBoxStates = new Map();
  placeFlowBoxes(metrics, fixtureData, firstPage, plan);
  placeReservedSlots(fixtureData, pages, plan, imageStates, metrics);
  placeFlow(metrics, fixtureData, fixtureData.blocks, pages, plan, 'article', imageStates, flowBoxStates);
  placeFlow(metrics, fixtureData, fixtureData.sidebar, pages, plan, 'sidebar', imageStates, flowBoxStates);
  const evaluation = evaluate(fixtureData, plan);
  plan.evaluation = evaluation;
  const hasHardViolation = evaluation.violations.some((violation) => !isSoftWarning(violation));
  const hasWarnings = evaluation.violations.length > 0 || plan.diagnostics.some((diagnostic) => WARNING_DIAGNOSTIC_CODES.has(diagnostic.code));
  plan.status = hasHardViolation
    ? 'rejected'
    : hasWarnings
      ? 'accepted-with-warnings'
      : plan.decisions.length ? 'accepted-with-decisions' : 'accepted';
  plan.attempts.push({ revision: 'initial', status: plan.status, violations: evaluation.violations });
  plan.outcome = outcomeFor(fixtureData, plan);
  return { plan };
}

function drawPlaceholder(doc, image) {
  if (image.shape === 'triangle') {
    drawTrianglePlaceholder(doc, image);
    return;
  }
  if (image.shape === 'star') {
    drawStarPlaceholder(doc, image);
    return;
  }
  if (image.shape === 'staircase') {
    drawStaircasePlaceholder(doc, image);
    return;
  }
  const color = image.color;
  doc.setFillColor(...color);
  doc.setDrawColor(...color.map((value) => Math.max(0, value - 45)));
  if (image.shape === 'ellipse') {
    doc.ellipse(image.x + image.width / 2, image.y + image.height / 2, image.width / 2, image.height / 2, 'FD');
    drawEllipseStripes(doc, image);
  } else {
    doc.rect(image.x, image.y, image.width, image.height, 'FD');
    drawRectangularStripes(doc, image);
  }
  if (image.shape === 'ellipse') {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.8);
    doc.ellipse(image.x + image.width / 2, image.y + image.height / 2, image.width / 2, image.height / 2, 'S');
  }
}

function drawRectangularStripes(doc, image) {
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.6);
  for (let offset = -image.height; offset < image.width + image.height; offset += 7) {
    const startX = image.x + offset;
    const start = Math.max(0, (image.x - startX) / image.height);
    const end = Math.min(1, (image.x + image.width - startX) / image.height);
    if (end > start) {
      doc.line(
        startX + image.height * start,
        image.y + image.height - image.height * start,
        startX + image.height * end,
        image.y + image.height - image.height * end,
      );
    }
  }
}

function drawEllipseStripes(doc, image) {
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  const radiusX = image.width / 2;
  const radiusY = image.height / 2;
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.6);
  for (let offset = -image.height; offset < image.width + image.height; offset += 7) {
    const startX = image.x + offset;
    const start = [startX, image.y + image.height];
    const end = [startX + image.height, image.y];
    const direction = [end[0] - start[0], end[1] - start[1]];
    const normalizedStart = [(start[0] - centerX) / radiusX, (start[1] - centerY) / radiusY];
    const normalizedDirection = [direction[0] / radiusX, direction[1] / radiusY];
    const a = normalizedDirection[0] ** 2 + normalizedDirection[1] ** 2;
    const b = 2 * (normalizedStart[0] * normalizedDirection[0] + normalizedStart[1] * normalizedDirection[1]);
    const c = normalizedStart[0] ** 2 + normalizedStart[1] ** 2 - 1;
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant <= 0) continue;
    const root = Math.sqrt(discriminant);
    const first = Math.max(0, (-b - root) / (2 * a));
    const second = Math.min(1, (-b + root) / (2 * a));
    if (second <= first) continue;
    doc.line(
      start[0] + direction[0] * first,
      start[1] + direction[1] * first,
      start[0] + direction[0] * second,
      start[1] + direction[1] * second,
    );
  }
}

function drawStarPlaceholder(doc, image) {
  const points = starPoints(image);
  const vectors = [];
  let previous = points[0];
  for (const point of points.slice(1)) {
    vectors.push([point[0] - previous[0], point[1] - previous[1]]);
    previous = point;
  }
  doc.setFillColor(...image.color);
  doc.setDrawColor(...image.color.map((value) => Math.max(0, value - 45)));
  doc.lines(vectors, points[0][0], points[0][1], [1, 1], 'FD', true);
}

function drawTrianglePlaceholder(doc, image) {
  const x0 = image.x;
  const x1 = image.x + image.width;
  const y0 = image.y;
  const y1 = image.y + image.height;
  const points = image.side === 'left'
    ? (image.apex === 'bottom' ? [x0, y1, x0, y0, x1, y0] : [x0, y0, x0, y1, x1, y1])
    : (image.apex === 'bottom' ? [x1, y1, x1, y0, x0, y0] : [x1, y0, x1, y1, x0, y1]);
  doc.setFillColor(...image.color);
  doc.setDrawColor(...image.color.map((value) => Math.max(0, value - 45)));
  doc.triangle(...points, 'FD');
}

function drawStaircasePlaceholder(doc, image) {
  const halfHeight = image.height / 2;
  const steps = [
    { y: image.y, height: halfHeight, fraction: image.wrapFractions[0] },
    { y: image.y + halfHeight, height: halfHeight, fraction: image.wrapFractions[1] },
  ];
  for (const step of steps) {
    const width = image.width * step.fraction;
    const x = image.side === 'left' ? image.x : image.x + image.width - width;
    doc.setFillColor(...image.color);
    doc.setDrawColor(...image.color.map((value) => Math.max(0, value - 45)));
    doc.rect(x, step.y, width, step.height, 'FD');
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.6);
    for (let offset = -step.height; offset < width + step.height; offset += 7) {
      const startX = x + offset;
      const start = Math.max(0, (x - startX) / step.height);
      const end = Math.min(1, (x + width - startX) / step.height);
      if (end > start) {
        doc.line(
          startX + step.height * start,
          step.y + step.height - step.height * start,
          startX + step.height * end,
          step.y + step.height - step.height * end,
        );
      }
    }
  }
}

function drawPrototypeLine(doc, line, style) {
  const baseline = line.y + baselineOffset(style);
  const shouldJustify = TEMPLATE.flow.align === 'justify'
    && line.blockType !== 'heading'
    && !line.finalLine
    && line.text.includes(' ')
    && line.naturalWidth < line.width - 0.01;
  if (!shouldJustify) {
    doc.text(line.text, line.x, baseline);
    return;
  }
  const words = line.text.split(/\s+/u);
  const naturalSpace = doc.getTextWidth(' ');
  const extraSpace = (line.width - line.naturalWidth) / Math.max(1, words.length - 1);
  let cursor = line.x;
  words.forEach((word, index) => {
    doc.text(word, cursor, baseline);
    cursor += doc.getTextWidth(word);
    if (index < words.length - 1) cursor += naturalSpace + extraSpace;
  });
}

function baselineOffset(style) {
  const fontHeight = style.size / 2.8346;
  return style.leading / 2 + fontHeight * 0.25;
}

function imageIntervalAt(image, y) {
  if (y < image.y || y > image.y + image.height) return null;
  if (image.shape === 'ellipse') {
    const normalized = (y - (image.y + image.height / 2)) / (image.height / 2);
    const radius = image.width / 2 * Math.sqrt(Math.max(0, 1 - normalized * normalized));
    const center = image.x + image.width / 2;
    return { left: center - radius, right: center + radius };
  }
  if (image.shape === 'diagonal' || image.shape === 'staircase') {
    const normalized = Math.max(-1, Math.min(1, (y - (image.y + image.height / 2)) / (image.height / 2)));
    const fraction = normalized < 0 ? image.wrapFractions[0] : image.wrapFractions[1];
    if (image.side === 'left') return { left: image.x, right: image.x + image.width * fraction };
    return { left: image.x + image.width * (1 - fraction), right: image.x + image.width };
  }
  if (image.shape === 'triangle') {
    const progress = Math.max(0, Math.min(1, (y - image.y) / image.height));
    const fraction = image.apex === 'bottom' ? 1 - progress : progress;
    if (image.side === 'left') return { left: image.x, right: image.x + image.width * fraction };
    return { left: image.x + image.width * (1 - fraction), right: image.x + image.width };
  }
  if (image.shape === 'star') {
    const points = starPoints(image);
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      if (first[1] === second[1] || y < Math.min(first[1], second[1]) || y >= Math.max(first[1], second[1])) continue;
      intersections.push(first[0] + ((y - first[1]) * (second[0] - first[0])) / (second[1] - first[1]));
    }
    if (intersections.length >= 2) return { left: Math.min(...intersections), right: Math.max(...intersections) };
  }
  return { left: image.x, right: image.x + image.width };
}

function starPoints(image) {
  const points = [];
  const centerX = image.x + image.width / 2;
  const centerY = image.y + image.height / 2;
  for (let index = 0; index < image.starPoints * 2; index += 1) {
    const radius = index % 2 === 0 ? 1 : image.starInnerRatio;
    const angle = -Math.PI / 2 + (index * Math.PI) / image.starPoints;
    points.push([
      centerX + Math.cos(angle) * (image.width / 2) * radius,
      centerY + Math.sin(angle) * (image.height / 2) * radius,
    ]);
  }
  return points;
}

function lineIntersectsImage(line, image) {
  if (image.position?.wrap === false || line.page !== image.page || !(image.tracks?.includes(line.region === 'sidebar' ? 'sidebar' : line.track) || line.track === image.track)) return false;
  const renderedWidth = line.overfull
    ? line.naturalWidth
    : TEMPLATE.flow.align === 'justify' && !line.finalLine
      ? line.width
      : line.naturalWidth;
  const lineLeft = line.x;
  const lineRight = line.x + renderedWidth;
  const samples = [line.y + 0.05, line.y + line.height / 2, line.y + line.height - 0.05];
  return samples.some((y) => {
    const interval = imageIntervalAt(image, y);
    return interval && lineLeft < interval.right - 0.01 && lineRight > interval.left + 0.01;
  });
}

function drawPage(doc, fixtureData, plan, page) {
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE.width, PAGE.height, 'F');
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.25);
  doc.rect(page.header.x, page.header.y, page.header.width, page.header.height, 'S');
  doc.setFont(fontName(), 'bold');
  doc.setFontSize(renderConfig.pdf.header_title_size);
  doc.setTextColor(...COLORS.ink);
  doc.text(fixtureData.title, page.header.x + 3, page.header.y + 6);
  doc.setFont(fontName(), 'normal');
  doc.setFontSize(renderConfig.pdf.header_subtitle_size);
  doc.setTextColor(...COLORS.muted);
  doc.text(`prototype · page ${page.index + 1}`, page.header.x + 3, page.header.y + page.header.height - 3);
  doc.line(page.footer.x, page.footer.y - 2, page.footer.x + page.footer.width, page.footer.y - 2);
  doc.setFontSize(STYLES.chrome.size);
  doc.text('composition-kernel fixture', page.footer.x, page.footer.y + 5);
  doc.text(String(page.index + 1), page.footer.x + page.footer.width, page.footer.y + 5, { align: 'right' });
  for (const track of page.article.tracks) {
    doc.setFillColor(...(track.id === 'lead' ? COLORS.trackLead : COLORS.trackSecondary));
    doc.rect(track.x, track.y, track.width, track.bottom - track.y, 'F');
    doc.setFontSize(STYLES.caption.size);
    doc.setTextColor(...COLORS.muted);
    doc.text(track.id, track.x + 1, track.y - STYLES.caption.leading / 2);
  }
  doc.setFillColor(...COLORS.trackSidebar);
  doc.rect(page.sidebar.x, page.sidebar.y, page.sidebar.width, page.sidebar.bottom - page.sidebar.y, 'F');
  for (const box of plan.boxes.filter((candidate) => candidate.page === page.index)) {
    doc.setFillColor(...(box.background ?? COLORS.lead));
    doc.rect(box.x, box.y, box.width, box.height, 'F');
    const style = STYLES[styleFor(box.block)];
    doc.setFont(fontName(), style.weight);
    doc.setFontSize(style.size);
    doc.setTextColor(...COLORS.ink);
    for (const line of box.lines) doc.text(line.text, line.x, line.y);
  }
  for (const image of plan.images.filter((candidate) => candidate.page === page.index)) drawPlaceholder(doc, image);
  for (const line of plan.lines.filter((candidate) => candidate.page === page.index)) {
    const style = STYLES[styleFor({ role: line.blockType === 'heading' ? 'section_heading' : line.region === 'sidebar' ? 'sidebar' : 'body' })];
    doc.setFont(fontName(), line.blockType === 'heading' ? 'bold' : 'normal');
    doc.setFontSize(style.size);
    doc.setTextColor(...COLORS.ink);
    if (line.marker) {
      doc.setFillColor(...COLORS.warning);
      doc.circle(line.x - 2, line.y + 1.1, 0.75, 'F');
    }
    drawPrototypeLine(doc, line, style);
  }
  const warnings = planWarnings(plan);
  if (warnings.length && page.index === 0) {
    doc.setFont(fontName(), 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.warning);
    const label = plan.status === 'rejected' ? 'REJECTED' : 'WARNING';
    doc.text(`${label}: ${warnings[0].code}`, page.header.x + page.header.width - 3, page.header.y + 6, { align: 'right' });
  }
}

function sourceSnapshot(fixtureData) {
  const blocks = [...(fixtureData.blocks ?? []), ...(fixtureData.sidebar ?? [])]
    .map(({ id, type, role, text, marker = false }) => ({ id, type, role, text, marker }));
  return {
    fixture: fixtureData.id,
    title: fixtureData.title,
    intro: fixtureData.intro,
    brand: fixtureData.brand ?? null,
    product: fixtureData.source ?? null,
    writing: { ...fixtureData.writing },
    blocks,
    images: (fixtureData.images ?? []).map(({ id, shape, color, anchorBlock, pagePolicy, fixedPage, placement, position }) => ({
      id, shape, color, anchorBlock, pagePolicy, fixedPage, placement, position: position ?? null,
    })),
    flowBoxes: normalizedFlowBoxes(fixtureData).map(({ id, type, role, text, pagePolicy, span, spanTracks, spanRegions, placement, mode, anchorBlock }) => ({
      id,
      type: type ?? 'box',
      role: role ?? 'body',
      text,
      pagePolicy: pagePolicy ?? 'first-page-only',
      span: span ?? null,
      spanTracks: spanTracks ?? null,
      spanRegions: spanRegions ?? null,
      placement: placement ?? mode ?? 'block',
      anchorBlock: anchorBlock ?? null,
    })),
  };
}

function renderFixture(fixtureData, plan, doc, fixtureOutput) {
  mkdirSync(fixtureOutput, { recursive: true });
  const serializablePlan = { ...plan, pages: plan.pages.map((page) => ({ ...page })) };
  writeFileSync(join(fixtureOutput, 'plan.json'), `${JSON.stringify(serializablePlan, null, 2)}\n`);
  writeFileSync(join(fixtureOutput, 'outcome.json'), `${JSON.stringify(plan.outcome, null, 2)}\n`);
  if (plan.status === 'rejected') return null;
  for (let index = 0; index < plan.pages.length; index += 1) {
    if (index > 0) doc.addPage();
    drawPage(doc, fixtureData, plan, plan.pages[index]);
  }
  const pdfPath = join(fixtureOutput, `${fixtureData.id}.pdf`);
  writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')));
  if (!noRender) {
    execFileSync('pdftoppm', ['-png', '-r', '96', pdfPath, join(fixtureOutput, 'page')], { stdio: 'ignore' });
  }
  return pdfPath;
}

function summary(result) {
  return {
    fixture: result.plan.fixture,
    status: result.plan.status,
    pages: result.plan.pages.length,
    lines: result.plan.lines.length,
    images: result.plan.images.length,
    decisions: result.plan.decisions.map((decision) => decision.code),
    diagnostics: result.plan.diagnostics.map((diagnostic) => diagnostic.code),
    warnings: planWarnings(result.plan).map((warning) => warning.code),
    violations: result.plan.evaluation.violations.map((violation) => violation.code),
    outcome: result.plan.outcome,
    output: result.output,
  };
}

function expectedStatus(id) {
  return id === 'unsatisfiable'
    || id === 'largeImageRejected'
    || id === 'unsupportedArabicBidi'
    || id === 'unsupportedCjkVertical'
    || id === 'unsupportedVerticalLr'
    ? 'rejected'
    : undefined;
}

async function main() {
  if (!noRender) rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  const fixtureCatalog = externalFixtures ?? FIXTURES;
  const selected = requestedCase === 'all'
    ? Object.keys(fixtureCatalog)
    : requestedCase === 'breaking'
      ? [...Object.keys(BREAKING_FIXTURES), 'breakingProtectedImage', 'breakingStrictProtectedImage', 'breakingFreeformSingleLine', 'breakingEditorialRelaxedSingleLine']
      : requestedCase === 'boundary'
        ? Object.keys(BOUNDARY_FIXTURES)
        : requestedCase.split(',');
  const reports = [];
  for (const id of selected) {
    assert(fixtureCatalog[id], `Unknown prototype case '${id}'. Available: ${Object.keys(fixtureCatalog).join(', ')}`);
    const fixtureData = fixtureCatalog[id];
    const fixtureOutput = join(outputDir, id);
    mkdirSync(fixtureOutput, { recursive: true });
    // Capture the authored input before planning so PDF parity never derives
    // its expected text from the generated plan.
    writeFileSync(join(fixtureOutput, 'source.json'), `${JSON.stringify(sourceSnapshot(fixtureData), null, 2)}\n`);
    const doc = await makeDoc();
    const metrics = createJsPdfTextMetrics(doc);
    const result = planFixture(fixtureData, metrics);
    // Always persist plan/outcome for the evaluator. `--no-render` only skips
    // the PNG round-trip; the plan is the primary test artifact.
    result.output = renderFixture(fixtureData, result.plan, doc, fixtureOutput);
    const expected = externalFixtures ? fixtureData.qa?.expectedStatus : expectedStatus(id) ?? fixtureData.qa?.expectedStatus;
    if (expected) assert(result.plan.status === expected, `${id}: expected ${expected}, got ${result.plan.status}`);
    else assert(result.plan.status !== 'rejected', `${id}: unexpected rejection: ${JSON.stringify(result.plan.evaluation.violations)}`);
    if (id === 'short') assert(result.plan.pages.length === 1, `short: expected one page, got ${result.plan.pages.length}`);
    if (id === 'long') assert(result.plan.pages.length > 1, 'long: expected continuation pages');
    if (id === 'largeBlockScaled') {
      assert(result.plan.decisions.some((decision) => decision.code === 'IMAGE_SCALED_TO_FRAGMENTAINER'), 'largeBlockScaled: expected image scaling decision');
      assert(result.plan.evaluation.violations.some((violation) => violation.code === 'IMAGE_DOMINATES_FRAGMENTAINER'), 'largeBlockScaled: expected editorial dominance violation');
    }
    if (id === 'largeBlockExplicitSlot') assert(result.plan.decisions.some((decision) => decision.code === 'IMAGE_RESERVED_SLOT'), 'largeBlockExplicitSlot: expected reserved slot decision');
    if (id === 'largeFloatPromoted') assert(result.plan.decisions.some((decision) => decision.code === 'FLOAT_PROMOTED_TO_BLOCK'), 'largeFloatPromoted: expected float promotion decision');
    if (id === 'crossColumnContinuation') {
      assert(result.plan.pages.length > 1, 'crossColumnContinuation: expected continuation page');
      assert(result.plan.images.length === 1 && result.plan.images[0].page === 0, 'crossColumnContinuation: image must be placed exactly once on page one');
    }
    if (id === 'justifiedColumns') assert(result.plan.pages.length > 1, 'justifiedColumns: expected continuation pages');
    if (id === 'largeImageRejected') assert(result.plan.evaluation.violations.some((violation) => violation.code === 'IMAGE_OVERSIZE'), 'largeImageRejected: expected image oversize violation');
    if (id === 'markerPush') assert(!result.plan.evaluation.violations.some((violation) => violation.code === 'LIST_MARKER_REQUIRES_FIRST_LINE'), 'markerPush: marker must never be stranded without its first line');
    reports.push(summary(result));
  }
  writeFileSync(join(outputDir, 'report.json'), `${JSON.stringify(reports, null, 2)}\n`);
  console.log(JSON.stringify(reports, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

/**
 * Create an importable planner using injected composition context.
 *
 * The prototype started life as a CLI, so its planning functions historically
 * closed over CLI-selected globals. Keeping the old fixture entry point while
 * temporarily swapping this context gives callers an explicit seam without
 * changing the oracle output. The callback is synchronous and must not be
 * re-entered; the production extraction will replace this transitional
 * context holder with ordinary dependency injection.
 */
export function createPrototypePlanner(options = {}) {
  const context = {
    preset: options.preset ?? requestedPreset,
    page: options.page ?? PAGE,
    template: options.template ?? TEMPLATE,
    styles: options.styles ?? STYLES,
    colors: options.colors ?? COLORS,
    prototypeConfig: options.prototypeConfig ?? prototypeConfig,
    brand: options.brand ?? activeBrand,
  };
  return (fixtureData, metrics) => {
    const previous = {
      requestedPreset,
      PAGE,
      TEMPLATE,
      STYLES,
      COLORS,
      prototypeConfig,
      activeBrand,
    };
    requestedPreset = context.preset;
    PAGE = context.page;
    TEMPLATE = context.template;
    STYLES = context.styles;
    COLORS = context.colors;
    prototypeConfig = context.prototypeConfig;
    activeBrand = context.brand;
    try {
      return planFixture(fixtureData, metrics);
    } finally {
      requestedPreset = previous.requestedPreset;
      PAGE = previous.PAGE;
      TEMPLATE = previous.TEMPLATE;
      STYLES = previous.STYLES;
      COLORS = previous.COLORS;
      prototypeConfig = previous.prototypeConfig;
      activeBrand = previous.activeBrand;
    }
  };
}

export { createJsPdfTextMetrics, planFixture };
