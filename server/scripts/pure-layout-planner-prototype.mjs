#!/usr/bin/env node

// PROTOTYPE — no HTML, no PDF, no browser.
// This is a pure block/frame planner with a replaceable text-metrics adapter.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const outputDir = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-pure-layout-planner');
const configPath = resolve(new URL('../templates/pure-layout-prototype.yml', import.meta.url).pathname);
const config = parse(readFileSync(configPath, 'utf8'));

const lorem = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
].join(' ');

function repeatText(paragraphs) {
  return Array.from({ length: paragraphs }, (_, index) => `${lorem} ${index + 1}.`).join('\n');
}

function words(text) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class MetricsAdapter {
  constructor(font) {
    this.font = font;
  }

  // Deliberately replaceable approximation. It models a stable font profile,
  // but does not claim to replace HarfBuzz/Pango shaping.
  wordWidth(word, style = {}) {
    const weightFactor = style.weight === 'bold' ? this.font.bold_factor : 1;
    const punctuation = [...word].reduce((sum, character) => {
      if ('ilI.,:;!|'.includes(character)) return sum + 0.34;
      if ('mwMW@#%'.includes(character)) return sum + 0.92;
      if ('()[]{}-'.includes(character)) return sum + 0.45;
      return sum + 0.56;
    }, 0);
    return punctuation * this.font.size * weightFactor;
  }

  lineWidth(lineWords, style = {}) {
    if (lineWords.length === 0) return 0;
    const spaces = (lineWords.length - 1) * this.font.size * 0.28;
    return lineWords.reduce((sum, word) => sum + this.wordWidth(word, style), 0) + spaces;
  }

  lineHeight(style = {}) {
    return style.lineHeight ?? this.font.line_height;
  }
}

function makeFrame(template, pageNumber, index) {
  return {
    ...template,
    id: `page-${pageNumber}/${template.id}`,
    page: pageNumber,
    index,
    cursor: 0,
    exclusions: [],
    placements: [],
    issues: [],
  };
}

function articleTemplates() {
  const { page } = config;
  return [
    { id: 'article-left', flow: 'article', x: page.margin, y: page.margin, width: page.column_width, height: page.frame_height },
    { id: 'article-right', flow: 'article', x: page.margin + page.column_width + page.column_gap, y: page.margin, width: page.column_width, height: page.frame_height },
  ];
}

function sidebarTemplates() {
  const { page } = config;
  return [{
    id: 'sidebar', flow: 'sidebar',
    x: page.width - page.margin - page.sidebar_width,
    y: page.margin,
    width: page.sidebar_width,
    height: page.frame_height,
  }];
}

function newFrameCursor(templates) {
  let page = 1;
  let index = 0;
  const frames = [];
  let current = makeFrame(templates[index], page, index);
  frames.push(current);
  const next = () => current;
  const advance = () => {
    index += 1;
    if (index >= templates.length) {
      index = 0;
      page += 1;
    }
    current = makeFrame(templates[index], page, index);
    frames.push(current);
    return current;
  };
  return { frames, next, advance };
}

function availableWidth(frame, y) {
  let width = frame.width;
  for (const exclusion of frame.exclusions) {
    if (y < exclusion.y || y >= exclusion.y + exclusion.height) continue;
    let occupied = exclusion.width;
    if (exclusion.shape === 'ellipse') {
      const relativeY = (y - exclusion.y) / exclusion.height;
      const ellipseHalfWidth = (exclusion.width / 2) * Math.sqrt(Math.max(0, 1 - ((relativeY - 0.5) / 0.5) ** 2));
      occupied = exclusion.width / 2 + ellipseHalfWidth;
    }
    if (exclusion.side === 'right') width -= occupied + config.quality.float_gap;
    if (exclusion.side === 'left') width -= occupied + config.quality.float_gap;
  }
  return Math.max(0, width);
}

function wrapWords(text, frame, startY, metrics, style) {
  const remaining = words(text);
  const lines = [];
  let y = startY;
  while (remaining.length > 0) {
    if (y + metrics.lineHeight(style) > frame.height) break;
    const line = [];
    const width = availableWidth(frame, y + metrics.lineHeight(style) / 2);
    while (remaining.length > 0) {
      const candidate = [...line, remaining[0]];
      if (metrics.lineWidth(candidate, style) <= width || line.length === 0) {
        if (line.length === 0 && metrics.wordWidth(remaining[0], style) > width) {
          frame.issues.push({ type: 'unbreakable-token', token: remaining[0], width: metrics.wordWidth(remaining[0], style), availableWidth: width });
        }
        line.push(remaining.shift());
      } else {
        break;
      }
    }
    if (line.length === 0) break;
    lines.push({ words: line, width: metrics.lineWidth(line, style), availableWidth: width, y });
    y += metrics.lineHeight(style);
    if (y > frame.height) break;
  }
  return { lines, remainder: remaining.join(' ') };
}

function blockLines(block, frame, metrics, startY = 0) {
  const style = block.style ?? {};
  const lineHeight = metrics.lineHeight(style);
  const measureFrame = { ...frame, height: Number.MAX_SAFE_INTEGER };
  if (block.kind === 'heading') return wrapWords(block.text, measureFrame, startY, metrics, { ...style, weight: 'bold' }).lines;
  if (block.kind === 'paragraph') return wrapWords(block.text, measureFrame, startY, metrics, style).lines;
  if (block.kind === 'cluster') {
    let y = startY;
    return block.children.flatMap((child) => {
      const childLines = blockLines(child, measureFrame, metrics, y);
      y += childLines.length * lineHeight;
      return childLines;
    });
  }
  return [];
}

function canFitLines(frame, lines, startY) {
  return startY + lines.length * (lines[0]?.lineHeight ?? config.font.line_height) <= frame.height;
}

function recordPlacement(frame, block, lines, extra = {}) {
  const height = lines.length * (block.style?.lineHeight ?? config.font.line_height);
  const placement = {
    block: block.id,
    kind: block.kind,
    y: frame.cursor,
    height,
    lines: lines.length,
    text: lines.map((line) => line.words.join(' ')).join(' '),
    ...extra,
  };
  frame.placements.push(placement);
  frame.cursor += height;
  return placement;
}

function moveIfNeeded(cursor, reason) {
  const current = cursor.next();
  if (current.cursor === 0) {
    current.issues.push({ type: 'frame-overflow', reason });
  }
  return cursor.advance();
}

function placeImage(block, cursor, options) {
  let frame = cursor.next();
  let width = block.width;
  let height = block.height;
  if (width > frame.width || height > frame.height) {
    if (options.imagePolicy === 'scale') {
      const ratio = Math.min(frame.width / width, frame.height / height);
      width *= ratio;
      height *= ratio;
    } else if (options.imagePolicy === 'next-page' && frame.cursor > 0) {
      frame = moveIfNeeded(cursor, 'image moved to next frame');
    } else {
      frame.issues.push({ type: 'rejected-image', block: block.id, reason: 'image exceeds frame', required: { width, height }, available: { width: frame.width, height: frame.height - frame.cursor } });
      return frame;
    }
  }
  if (block.placement === 'float-right') {
    if (frame.cursor + height > frame.height && frame.cursor > 0) frame = moveIfNeeded(cursor, 'float moved to next frame');
    frame.exclusions.push({ side: 'right', y: frame.cursor, width, height, shape: block.shape ?? 'rect' });
    frame.placements.push({ block: block.id, kind: 'image', y: frame.cursor, width, height, placement: 'float-right', shape: block.shape ?? 'rect' });
  } else {
    if (frame.cursor + height > frame.height && frame.cursor > 0) frame = moveIfNeeded(cursor, 'image moved to next frame');
    frame.placements.push({ block: block.id, kind: 'image', y: frame.cursor, width, height, placement: 'inline' });
    frame.cursor += height;
  }
  return frame;
}

function placeFlow(blocks, templates, options, metrics) {
  const cursor = newFrameCursor(templates);
  const blockFragments = {};
  let frame = cursor.next();
  for (const block of blocks) {
    if (block.kind === 'image') {
      frame = placeImage(block, cursor, options);
      continue;
    }
    const atomic = block.kind === 'heading' || block.kind === 'cluster' || !options.splitParagraphs;
    if (atomic) {
      const lines = blockLines(block, frame, metrics, frame.cursor);
      let height = lines.length * (block.style?.lineHeight ?? config.font.line_height);
      if (frame.cursor + height > frame.height && frame.cursor > 0) {
        frame = moveIfNeeded(cursor, `${block.id} kept together`);
        const movedLines = blockLines(block, frame, metrics, frame.cursor);
        height = movedLines.length * (block.style?.lineHeight ?? config.font.line_height);
        if (height <= frame.height) {
          const placement = recordPlacement(frame, block, movedLines);
          blockFragments[block.id] = [placement];
          continue;
        }
      }
      if (height > frame.height) {
        frame.issues.push({ type: 'rejected-block', block: block.id, reason: 'atomic block exceeds frame', height, available: frame.height });
      } else {
        const placement = recordPlacement(frame, block, lines);
        blockFragments[block.id] = [placement];
      }
      continue;
    }

    let remainder = block.text;
    const fragments = [];
    while (remainder) {
      frame = cursor.next();
      const wrapped = wrapWords(remainder, frame, frame.cursor, metrics, block.style ?? {});
      if (wrapped.lines.length === 0) {
        frame = moveIfNeeded(cursor, `${block.id} continued`);
        continue;
      }
      const fragment = recordPlacement(frame, block, wrapped.lines, { continuation: fragments.length > 0 });
      fragments.push(fragment);
      remainder = wrapped.remainder;
      if (remainder) frame = moveIfNeeded(cursor, `${block.id} continued`);
    }
    blockFragments[block.id] = fragments;
  }
  return { frames: cursor.frames, blockFragments };
}

function summarise(result) {
  const pages = Math.max(...result.frames.map((frame) => frame.page), 0);
  const issues = result.frames.flatMap((frame) => frame.issues.map((issue) => ({ frame: frame.id, ...issue })));
  const placements = result.frames.flatMap((frame) => frame.placements);
  return { pages, frames: result.frames, issues, placements, splitCount: placements.filter((placement) => placement.continuation).length };
}

function scenarioCases() {
  return {
    longArticle: {
      flow: 'article',
      blocks: [
        { id: 'title', kind: 'heading', text: 'The structure behind the story' },
        { id: 'intro', kind: 'cluster', children: [
          { id: 'intro-heading', kind: 'heading', text: 'A measured continuation' },
          { id: 'intro-copy', kind: 'paragraph', text: repeatText(2) },
        ] },
        { id: 'paragraph-1', kind: 'paragraph', text: repeatText(8) },
        { id: 'paragraph-2', kind: 'paragraph', text: repeatText(8) },
      ],
    },
    ellipseFloat: {
      flow: 'article',
      blocks: [
        { id: 'title', kind: 'heading', text: 'Text around a relevant image' },
        { id: 'image-oval', kind: 'image', placement: 'float-right', shape: 'ellipse', width: 175, height: 330 },
        { id: 'paragraph-around-image', kind: 'paragraph', text: repeatText(12) },
      ],
    },
    keepBoundary: {
      flow: 'article',
      blocks: [
        { id: 'prelude', kind: 'paragraph', text: repeatText(7) },
        { id: 'keep-cluster', kind: 'cluster', children: [
          { id: 'keep-heading', kind: 'heading', text: 'KEEP THIS HEADING WITH ITS INTRO' },
          { id: 'keep-copy', kind: 'paragraph', text: 'One two three lines must remain with the heading and cannot be left alone.' },
        ] },
      ],
    },
    sidebarOverflow: {
      flow: 'sidebar',
      blocks: [
        { id: 'sidebar-heading', kind: 'heading', text: 'Checklist' },
        { id: 'sidebar-copy', kind: 'paragraph', text: repeatText(18) },
      ],
    },
    oversizedImage: {
      flow: 'article',
      blocks: [
        { id: 'before-image', kind: 'paragraph', text: repeatText(3) },
        { id: 'huge-image', kind: 'image', width: 500, height: 1300, placement: 'inline' },
        { id: 'after-image', kind: 'paragraph', text: repeatText(3) },
      ],
    },
    unbreakableToken: {
      flow: 'article',
      blocks: [
        { id: 'url-like-token', kind: 'paragraph', text: 'https://example.invalid/this-is-an-intentionally-extremely-long-unbreakable-token-that-must-be-rejected-or-overflowed-with-a-diagnostic.' },
      ],
    },
  };
}

const strategies = [
  { id: 'atomic', splitParagraphs: false, imagePolicy: 'reject' },
  { id: 'line-flow', splitParagraphs: true, imagePolicy: 'reject' },
  { id: 'line-flow-scale-images', splitParagraphs: true, imagePolicy: 'scale' },
  { id: 'line-flow-defer-images', splitParagraphs: true, imagePolicy: 'next-page' },
];

const metrics = new MetricsAdapter(config.font);
const cases = scenarioCases();
const allResults = [];
for (const [caseId, scenario] of Object.entries(cases)) {
  for (const strategy of strategies) {
    const templates = scenario.flow === 'sidebar' ? sidebarTemplates() : articleTemplates();
    const result = summarise(placeFlow(clone(scenario.blocks), templates, strategy, metrics));
    allResults.push({ caseId, strategy: strategy.id, ...result });
  }
}

function formatTrace(result) {
  return result.frames.map((frame) => {
    const lines = frame.placements.map((placement) => `  - ${placement.block} ${placement.kind} y=${Math.round(placement.y)} h=${Math.round(placement.height ?? 0)}${placement.continuation ? ' continuation' : ''}${placement.placement ? ` ${placement.placement}` : ''}`);
    const issues = frame.issues.map((issue) => `  ! ${issue.type}: ${issue.block ?? issue.reason ?? issue.token ?? 'diagnostic'}`);
    return `FRAME ${frame.id} used=${Math.round(frame.cursor)}/${frame.height}\n${[...lines, ...issues].join('\n')}`;
  }).join('\n');
}

const report = [
  '# Pure layout planner prototype',
  '',
  'No HTML, PDF or browser was used. Text is packed into full-word lines using a replaceable font-metrics adapter.',
  '',
  '| Case | Strategy | Pages | Splits | Issues |',
  '|---|---|---:|---:|---:|',
  ...allResults.map((result) => `| ${result.caseId} | ${result.strategy} | ${result.pages} | ${result.splitCount} | ${result.issues.length} |`),
  '',
  '## Representative traces',
  '',
  ...['longArticle', 'ellipseFloat', 'keepBoundary', 'oversizedImage', 'unbreakableToken'].flatMap((caseId) => {
    const result = allResults.find((item) => item.caseId === caseId && item.strategy === 'line-flow');
    return [`### ${caseId}`, '', '```text', formatTrace(result), '```', ''];
  }),
  '## Interpretation',
  '',
  '- `line-flow` solves continuation without breaking words: only complete lines are moved to the next frame.',
  '- `atomic` preserves blocks but creates more wasted space and can reject large paragraphs.',
  '- `cluster` solves the solitary-heading problem by moving the whole heading+intro group.',
  '- `float-right` reserves an exclusion region, so following lines get less width instead of entering the image box.',
  '- `scale` is a deliberate image degradation policy; `reject` is safer for editorial assets.',
  '- A token wider than the frame cannot be fixed by pagination; without word breaking it needs overflow or rejection diagnostics.',
  '- The metrics adapter is intentionally replaceable; it is not yet a HarfBuzz/Pango implementation.',
].join('\n');

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'report.md'), `${report}\n`);
writeFileSync(join(outputDir, 'results.json'), `${JSON.stringify({ config: configPath, font: config.font, results: allResults }, null, 2)}\n`);
writeFileSync(join(outputDir, 'trace.json'), `${JSON.stringify(allResults.map((result) => ({ ...result, frames: result.frames })), null, 2)}\n`);
console.log(report);
