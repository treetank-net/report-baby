import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { jsPDF } = require('jspdf');

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'src', 'assets');
const outputDir = process.argv[2] ?? resolve(here, 'prototype-out');

const VARIANTS = [
  { id: 'justified-hyphenated', hyphenate: true, align: 'justify' },
  { id: 'justified-no-hyphenation', hyphenate: false, align: 'justify' },
  { id: 'ragged-right', hyphenate: true, align: 'left' },
];
let options = VARIANTS[0];

const PAGE = { width: 210, height: 297, marginTop: 20, marginBottom: 18, marginLeft: 17, marginRight: 17 };
const GRID = 4.4;
const ROLES = {
  body: { size: 9.5, weight: 'normal', leading: 1 },
  lead: { size: 11, weight: 'normal', leading: 1 },
  subhead: { size: 11, weight: 'bold', leading: 1 },
  headline: { size: 30, weight: 'bold', leading: 2 },
  standfirst: { size: 13, weight: 'normal', leading: 1.25 },
  quote: { size: 15, weight: 'bold', leading: 1.5 },
  caption: { size: 7.5, weight: 'normal', leading: 1 },
  sidebar: { size: 8.5, weight: 'normal', leading: 1 },
  sidebarHeading: { size: 9.5, weight: 'bold', leading: 1 },
  folio: { size: 7.5, weight: 'normal', leading: 1 },
};
const INK = [24, 28, 38];
const MUTED = [110, 120, 136];
const ACCENT = [24, 84, 176];
const RULE = [206, 213, 224];
const TINT = [244, 246, 250];

const contentWidth = PAGE.width - PAGE.marginLeft - PAGE.marginRight;
const rowCount = Math.floor((PAGE.height - PAGE.marginTop - PAGE.marginBottom) / GRID);

function rowTop(row) {
  return PAGE.marginTop + row * GRID;
}

function ascentFor(size) {
  return (size / 2.834645669291339) * 0.74;
}

function rowsFor(role) {
  return Math.max(1, Math.round(ROLES[role].leading));
}

function leadingFor(role) {
  return rowsFor(role) * GRID;
}

// ---------------------------------------------------------------------------
// Polish hyphenation by orthographic rule.
//
// This is deliberately not Liang/TeX patterns: it walks the word as a list of
// units (digraphs count as one consonant), finds the consonant cluster between
// two vowels and decides whether the whole cluster may open the next syllable.
// `i` before another vowel is a glide, not a syllable nucleus.
// ---------------------------------------------------------------------------

const PL_VOWELS = new Set(['a', 'ą', 'e', 'ę', 'i', 'o', 'ó', 'u', 'y']);
const PL_DIGRAPHS = ['dzi', 'dź', 'dż', 'ch', 'cz', 'dz', 'rz', 'sz', 'ść', 'śc'];
const PL_INITIAL_CLUSTERS = new Set([
  'br', 'bl', 'brz', 'bd', 'ch', 'chw', 'chł', 'chr', 'cz', 'ćw', 'dr', 'dl', 'dw', 'dz', 'drz', 'dź',
  'gd', 'gl', 'gn', 'gr', 'gw', 'grz', 'kl', 'kr', 'kw', 'kn', 'krz', 'kt', 'mn', 'mł', 'mg', 'pl',
  'pr', 'ps', 'pt', 'prz', 'pch', 'rz', 'sk', 'sl', 'sł', 'sm', 'sn', 'sp', 'st', 'sz', 'skr', 'spr',
  'str', 'stw', 'szk', 'szt', 'szw', 'śc', 'śl', 'śm', 'śn', 'śp', 'św', 'ść', 'tr', 'tw', 'trz', 'tl',
  'wl', 'wr', 'wsp', 'wst', 'wz', 'zb', 'zd', 'zg', 'zł', 'zm', 'zn', 'zw', 'zdr', 'żb', 'żr', 'źd',
]);

function splitUnits(lower) {
  const units = [];
  let index = 0;
  while (index < lower.length) {
    const digraph = PL_DIGRAPHS.find((candidate) => lower.startsWith(candidate, index));
    const text = digraph ?? lower[index];
    units.push({ text, start: index });
    index += text.length;
  }
  return units.map((unit, position) => {
    const next = units[position + 1];
    const isGlide = unit.text === 'i' && next !== undefined && PL_VOWELS.has(next.text[0]);
    return { ...unit, isVowel: PL_VOWELS.has(unit.text[0]) && !isGlide && unit.text.length === 1 };
  });
}

function polishBreakPoints(word) {
  const units = splitUnits(word.toLowerCase());
  const vowels = units.map((unit, position) => (unit.isVowel ? position : -1)).filter((position) => position >= 0);
  const points = [];
  for (let index = 0; index + 1 < vowels.length; index += 1) {
    const from = vowels[index];
    const to = vowels[index + 1];
    const cluster = units.slice(from + 1, to);
    if (cluster.length === 0) continue;
    const clusterText = cluster.map((unit) => unit.text).join('');
    const glideTail = cluster.length <= 2 && cluster.at(-1).text === 'i';
    const opensSyllable = cluster.length === 1 || glideTail || PL_INITIAL_CLUSTERS.has(clusterText);
    points.push(opensSyllable ? cluster[0].start : cluster[1].start);
  }
  return points;
}

const LEFT_MIN = 2;
const RIGHT_MIN = 3;

function breakPointsFor(word, language) {
  const soft = [];
  for (let index = 1; index < word.length; index += 1) {
    if (word[index - 1] === '­') soft.push(index);
    if (word[index - 1] === '-' && index < word.length) soft.push(index);
  }
  const algorithmic = options.hyphenate && language === 'pl' && word.length >= 5 && !word.includes('­') ? polishBreakPoints(word) : [];
  const clean = word.replace(/­/g, '');
  const shift = (index) => index - (word.slice(0, index).match(/­/g)?.length ?? 0);
  const all = [...new Set([...soft.map(shift), ...algorithmic])]
    .filter((index) => index >= LEFT_MIN && clean.length - index >= RIGHT_MIN)
    .sort((a, b) => a - b);
  return { text: clean, points: all };
}

// ---------------------------------------------------------------------------
// Line breaking: total-fit dynamic programming over word and hyphen breaks.
// Widths come from jsPDF's real font metrics, which are strictly additive for
// the embedded TTF, so prefix sums are exact.
// ---------------------------------------------------------------------------

function buildParagraphTokens(doc, text, language) {
  const spaceWidth = doc.getTextWidth(' ');
  const hyphenWidth = doc.getTextWidth('-');
  const words = text.split(/\s+/).filter(Boolean).map((raw) => {
    const { text: clean, points } = breakPointsFor(raw, language);
    const cuts = [0, ...points, clean.length];
    const pieces = cuts.slice(0, -1).map((start, index) => clean.slice(start, cuts[index + 1]));
    const cumulative = [0];
    for (const piece of pieces) cumulative.push(cumulative.at(-1) + doc.getTextWidth(piece));
    return { text: clean, pieces, cumulative };
  });
  const wordPrefix = [0];
  for (const word of words) wordPrefix.push(wordPrefix.at(-1) + word.cumulative.at(-1) + spaceWidth);
  return { words, wordPrefix, spaceWidth, hyphenWidth };
}

function nodesOf(tokens) {
  const nodes = [];
  tokens.words.forEach((word, index) => {
    for (let part = 0; part < word.pieces.length; part += 1) nodes.push({ word: index, part });
  });
  nodes.push({ word: tokens.words.length, part: 0 });
  return nodes;
}

function lineContent(tokens, from, to) {
  const pieces = [];
  let width = 0;
  let hyphenated = false;
  if (to.word === from.word) {
    const word = tokens.words[from.word];
    pieces.push(word.pieces.slice(from.part, to.part).join('') + '-');
    width = word.cumulative[to.part] - word.cumulative[from.part] + tokens.hyphenWidth;
    hyphenated = true;
    return { pieces, width, hyphenated };
  }
  const head = tokens.words[from.word];
  pieces.push(head.pieces.slice(from.part).join(''));
  width = head.cumulative.at(-1) - head.cumulative[from.part];
  for (let index = from.word + 1; index < to.word; index += 1) {
    pieces.push(tokens.words[index].text);
    width += tokens.spaceWidth + tokens.words[index].cumulative.at(-1);
  }
  if (to.part > 0) {
    const tail = tokens.words[to.word];
    pieces.push(tail.pieces.slice(0, to.part).join('') + '-');
    width += tokens.spaceWidth + tail.cumulative[to.part] + tokens.hyphenWidth;
    hyphenated = true;
  }
  return { pieces, width, hyphenated };
}

const HYPHEN_PENALTY = { justify: 120, left: 900 };
const CONSECUTIVE_HYPHEN_PENALTY = 900;
const MAX_STRETCH = 1.7;
const MAX_SHRINK = 0.78;
const LAST_LINE_MIN_FILL = 0.12;
const RAGGED_BADNESS = 9000;

function breakParagraph(tokens, startNodeIndex, measure) {
  const nodes = nodesOf(tokens);
  const end = nodes.length - 1;
  const best = new Map([[startNodeIndex, { cost: 0, previous: -1, hyphenRun: 0, line: null }]]);
  const order = [];
  for (let index = startNodeIndex; index <= end; index += 1) order.push(index);
  for (const index of order) {
    const state = best.get(index);
    if (!state || index === end) continue;
    for (let target = index + 1; target <= end; target += 1) {
      const line = lineContent(tokens, nodes[index], nodes[target]);
      const gaps = line.pieces.length - 1;
      const slack = measure - line.width;
      const isLast = target === end;
      // Only justified text has a shrink budget: ragged-right cannot compress
      // spaces, so a line wider than the measure would simply stick out.
      const shrinkRoom = options.align === 'justify' ? gaps * tokens.spaceWidth * (1 - MAX_SHRINK) : 0;
      // A line may be wider than the measure only as far as its spaces can be
      // compressed; past that no later break can help, so stop probing.
      if (line.width > measure + shrinkRoom) {
        if (target > index + 1) break;
        best.set(target, best.get(target) ?? { cost: state.cost + 40000, previous: index, hyphenRun: 0, line: { ...line, overfull: true } });
        break;
      }
      let cost = state.cost;
      if (!isLast) {
        if (options.align === 'justify') {
          if (gaps === 0) {
            if (line.width > measure) break;
            cost += 4000;
          } else {
            const ratio = (tokens.spaceWidth + slack / gaps) / tokens.spaceWidth;
            if (ratio > MAX_STRETCH) continue;
            cost += Math.round(1000 * (ratio - 1) * (ratio - 1));
          }
        } else {
          const rag = slack / measure;
          cost += Math.round(RAGGED_BADNESS * rag * rag);
        }
      } else if (line.width < measure * LAST_LINE_MIN_FILL) {
        cost += 500;
      }
      if (line.hyphenated) cost += HYPHEN_PENALTY[options.align] + state.hyphenRun * CONSECUTIVE_HYPHEN_PENALTY;
      const existing = best.get(target);
      if (!existing || cost < existing.cost) {
        best.set(target, { cost, previous: index, hyphenRun: line.hyphenated ? state.hyphenRun + 1 : 0, line });
      }
    }
  }
  if (!best.has(end)) return forcedBreak(tokens, startNodeIndex, measure);
  const lines = [];
  let cursor = end;
  while (cursor !== startNodeIndex) {
    const state = best.get(cursor);
    lines.unshift({ ...state.line, endNode: cursor });
    cursor = state.previous;
  }
  return lines;
}

function forcedBreak(tokens, startNodeIndex, measure) {
  const nodes = nodesOf(tokens);
  const end = nodes.length - 1;
  const lines = [];
  let cursor = startNodeIndex;
  while (cursor < end) {
    let target = cursor + 1;
    let chosen = lineContent(tokens, nodes[cursor], nodes[target]);
    for (let probe = cursor + 2; probe <= end; probe += 1) {
      const candidate = lineContent(tokens, nodes[cursor], nodes[probe]);
      if (candidate.width > measure) break;
      chosen = candidate;
      target = probe;
    }
    lines.push({ ...chosen, endNode: target, overfull: chosen.width > measure });
    cursor = target;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Frames: a page grid minus reserved bands yields an ordered list of segments.
// A band is "these column indices, these baseline rows" — the only float
// mechanism in the prototype.
// ---------------------------------------------------------------------------

function columnBoxes(spec) {
  const gutter = spec.gutter;
  const width = (contentWidth - gutter * (spec.columns - 1)) / spec.columns;
  return Array.from({ length: spec.columns }, (_, index) => ({
    index,
    x: PAGE.marginLeft + index * (width + gutter),
    width,
  }));
}

function segmentsForPage(spec) {
  const columns = columnBoxes(spec);
  const segments = [];
  for (const column of columns) {
    const blocked = (spec.bands ?? [])
      .filter((band) => band.columns.includes(column.index))
      .map((band) => [band.rows[0], band.rows[1]])
      .sort((a, b) => a[0] - b[0]);
    let row = 0;
    for (const [from, to] of blocked) {
      if (from > row) segments.push({ column: column.index, x: column.x, width: column.width, firstRow: row, lastRow: from - 1 });
      row = Math.max(row, to + 1);
    }
    if (row <= rowCount - 1) segments.push({ column: column.index, x: column.x, width: column.width, firstRow: row, lastRow: rowCount - 1 });
  }
  return segments.filter((segment) => segment.lastRow >= segment.firstRow);
}

// ---------------------------------------------------------------------------
// Flow: sequentially fills segments with blocks, re-breaking a paragraph
// whenever the measure changes, with orphan/widow and keep-with-next rules.
// ---------------------------------------------------------------------------

const ORPHANS = 2;
const WIDOWS = 2;
const MIN_LINES_PER_COLUMN = 2;

function measureBlockLines(doc, block, measure) {
  const role = ROLES[block.role];
  doc.setFont('DejaVu', role.weight);
  doc.setFontSize(role.size);
  return buildParagraphTokens(doc, block.text, block.language ?? 'pl');
}

function flowDocument(doc, blocks, pageSpecs) {
  const placements = [];
  const pages = [];
  let blockIndex = 0;
  let nodeCursor = 0;
  let pageIndex = 0;
  const diagnostics = { rebrokenParagraphs: 0, forcedLines: 0, pushedBlocks: 0, abandonedRows: 0 };

  while (blockIndex < blocks.length) {
    const spec = pageSpecs[Math.min(pageIndex, pageSpecs.length - 1)];
    pages.push(spec);
    const segments = segmentsForPage(spec);
    for (const segment of segments) {
      let row = segment.firstRow;
      while (blockIndex < blocks.length) {
        const block = blocks[blockIndex];
        const available = segment.lastRow - row + 1;
        if (available <= 0) break;
        const rowsPerLine = rowsFor(block.role);
        const tokens = measureBlockLines(doc, block, segment.width);
        if (nodeCursor > 0) diagnostics.rebrokenParagraphs += 1;
        const lines = breakParagraph(tokens, nodeCursor, segment.width);
        diagnostics.forcedLines += lines.filter((line) => line.overfull).length;
        const capacity = Math.floor(available / rowsPerLine);
        const keepWithNext = block.keepWithNext ? ORPHANS : 0;
        if (nodeCursor === 0 && block.keepWithNext && capacity < lines.length + keepWithNext) {
          diagnostics.pushedBlocks += 1;
          diagnostics.abandonedRows += available;
          break;
        }
        if (capacity < MIN_LINES_PER_COLUMN && lines.length > capacity) {
          diagnostics.pushedBlocks += 1;
          diagnostics.abandonedRows += available;
          break;
        }
        let take = Math.min(capacity, lines.length);
        if (take < lines.length) {
          if (lines.length - take < WIDOWS) take = lines.length - WIDOWS;
          if (take < ORPHANS) {
            diagnostics.pushedBlocks += 1;
            diagnostics.abandonedRows += available;
            break;
          }
        }
        lines.slice(0, take).forEach((line, offset) => {
          const isFinalLine = take === lines.length && offset === take - 1;
          placements.push({
            page: pageIndex,
            role: block.role,
            align: block.align ?? options.align,
            x: segment.x,
            measure: segment.width,
            row: row + offset * rowsPerLine,
            pieces: line.pieces,
            naturalWidth: line.width,
            justify: (block.align ?? options.align) === 'justify' && !isFinalLine,
            overfull: Boolean(line.overfull),
          });
        });
        row += take * rowsPerLine;
        if (take === lines.length) {
          blockIndex += 1;
          nodeCursor = 0;
          row += block.spaceAfterRows ?? 0;
        } else {
          nodeCursor = lines[take - 1].endNode;
          break;
        }
      }
      if (blockIndex >= blocks.length) break;
    }
    pageIndex += 1;
    if (pageIndex > 24) break;
  }
  return { placements, pages, diagnostics };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

function drawLine(doc, placement, stats) {
  const role = ROLES[placement.role];
  doc.setFont('DejaVu', role.weight);
  doc.setFontSize(role.size);
  const baseline = rowTop(placement.row) + ascentFor(role.size);
  const spaceWidth = doc.getTextWidth(' ');
  const gaps = placement.pieces.length - 1;
  if (!placement.justify || gaps === 0) {
    doc.text(placement.pieces.join(' '), placement.x, baseline);
    stats.lines.push({ ratio: 1, justified: false, row: placement.row, width: placement.naturalWidth, measure: placement.measure });
    return;
  }
  const slack = placement.measure - placement.naturalWidth;
  const gapWidth = spaceWidth + slack / gaps;
  let cursor = placement.x;
  for (const piece of placement.pieces) {
    doc.text(piece, cursor, baseline);
    cursor += doc.getTextWidth(piece) + gapWidth;
  }
  stats.lines.push({ ratio: gapWidth / spaceWidth, justified: true, row: placement.row, width: placement.measure, measure: placement.measure });
}

function bandBox(spec, band) {
  const columns = columnBoxes(spec);
  const first = columns[band.columns[0]];
  const last = columns[band.columns.at(-1)];
  return {
    x: first.x,
    y: rowTop(band.rows[0]),
    width: last.x + last.width - first.x,
    height: (band.rows[1] - band.rows[0] + 1) * GRID,
  };
}

function paintMasthead(doc, spec, band) {
  const box = bandBox(spec, band);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(ROLES.folio.size);
  doc.setTextColor(...ACCENT);
  doc.text(band.eyebrow.toUpperCase(), box.x, box.y + ascentFor(ROLES.folio.size));
  doc.setFont('DejaVu', ROLES.headline.weight);
  doc.setFontSize(ROLES.headline.size);
  doc.setTextColor(...INK);
  const headlineLines = doc.splitTextToSize(band.headline, box.width);
  let baseline = box.y + GRID * 2 + ascentFor(ROLES.headline.size);
  for (const line of headlineLines) {
    doc.text(line, box.x, baseline);
    baseline += leadingFor('headline');
  }
  doc.setFont('DejaVu', ROLES.standfirst.weight);
  doc.setFontSize(ROLES.standfirst.size);
  doc.setTextColor(...MUTED);
  const standfirstLines = doc.splitTextToSize(band.standfirst, box.width * 0.74);
  baseline += GRID * 0.4;
  for (const line of standfirstLines) {
    doc.text(line, box.x, baseline);
    baseline += leadingFor('standfirst');
  }
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.4);
  doc.line(box.x, box.y + box.height - GRID * 0.6, box.x + box.width, box.y + box.height - GRID * 0.6);
}

function paintImage(doc, spec, band) {
  const box = bandBox(spec, band);
  const captionRows = 2;
  const frameHeight = box.height - captionRows * GRID;
  doc.setFillColor(...TINT);
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.rect(box.x, box.y, box.width, frameHeight, 'FD');
  doc.setDrawColor(...RULE);
  doc.line(box.x, box.y, box.x + box.width, box.y + frameHeight);
  doc.line(box.x + box.width, box.y, box.x, box.y + frameHeight);
  doc.setFont('DejaVu', ROLES.caption.weight);
  doc.setFontSize(ROLES.caption.size);
  doc.setTextColor(...MUTED);
  const lines = doc.splitTextToSize(band.caption, box.width);
  let baseline = box.y + frameHeight + GRID * 0.7 + ascentFor(ROLES.caption.size);
  for (const line of lines.slice(0, captionRows)) {
    doc.text(line, box.x, baseline);
    baseline += GRID * 0.75;
  }
}

function paintQuote(doc, spec, band) {
  const box = bandBox(spec, band);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1.2);
  doc.line(box.x, box.y + GRID * 0.3, box.x + box.width, box.y + GRID * 0.3);
  doc.setFont('DejaVu', ROLES.quote.weight);
  doc.setFontSize(ROLES.quote.size);
  doc.setTextColor(...ACCENT);
  const lines = doc.splitTextToSize(`„${band.text}”`, box.width);
  let baseline = box.y + GRID * 1.4 + ascentFor(ROLES.quote.size);
  for (const line of lines) {
    doc.text(line, box.x, baseline);
    baseline += leadingFor('quote');
  }
  if (band.attribution) {
    doc.setFont('DejaVu', ROLES.caption.weight);
    doc.setFontSize(ROLES.caption.size);
    doc.setTextColor(...MUTED);
    doc.text(band.attribution, box.x, baseline + GRID * 0.2);
  }
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1.2);
  doc.line(box.x, box.y + box.height - GRID * 0.6, box.x + box.width, box.y + box.height - GRID * 0.6);
}

function paintSidebar(doc, spec, band) {
  const box = bandBox(spec, band);
  doc.setFillColor(...TINT);
  doc.rect(box.x, box.y, box.width, box.height, 'F');
  doc.setFillColor(...ACCENT);
  doc.rect(box.x, box.y, box.width, 0.9, 'F');
  const inset = 3;
  doc.setFont('DejaVu', ROLES.sidebarHeading.weight);
  doc.setFontSize(ROLES.sidebarHeading.size);
  doc.setTextColor(...INK);
  let baseline = box.y + GRID + ascentFor(ROLES.sidebarHeading.size);
  for (const line of doc.splitTextToSize(band.heading, box.width - inset * 2)) {
    doc.text(line, box.x + inset, baseline);
    baseline += GRID;
  }
  doc.setFont('DejaVu', ROLES.sidebar.weight);
  doc.setFontSize(ROLES.sidebar.size);
  doc.setTextColor(...INK);
  baseline += GRID * 0.4;
  for (const item of band.items) {
    const lines = doc.splitTextToSize(item, box.width - inset * 2 - 3);
    doc.setFillColor(...ACCENT);
    doc.circle(box.x + inset + 0.8, baseline - 1.1, 0.7, 'F');
    for (const line of lines) {
      doc.text(line, box.x + inset + 3, baseline);
      baseline += GRID * 0.82;
    }
    baseline += GRID * 0.2;
  }
}

function paintBands(doc, spec) {
  for (const band of spec.bands ?? []) {
    if (band.kind === 'masthead') paintMasthead(doc, spec, band);
    if (band.kind === 'image') paintImage(doc, spec, band);
    if (band.kind === 'quote') paintQuote(doc, spec, band);
    if (band.kind === 'sidebar') paintSidebar(doc, spec, band);
  }
}

function paintFolio(doc, pageNumber, total, running) {
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(PAGE.marginLeft, PAGE.height - PAGE.marginBottom + 5, PAGE.width - PAGE.marginRight, PAGE.height - PAGE.marginBottom + 5);
  doc.setFont('DejaVu', ROLES.folio.weight);
  doc.setFontSize(ROLES.folio.size);
  doc.setTextColor(...MUTED);
  doc.text(running, PAGE.marginLeft, PAGE.height - PAGE.marginBottom + 9);
  doc.text(`${pageNumber} / ${total}`, PAGE.width - PAGE.marginRight, PAGE.height - PAGE.marginBottom + 9, { align: 'right' });
}

// ---------------------------------------------------------------------------
// Numeric verification: nothing leaves its column, nothing enters a band,
// every baseline sits on the shared grid.
// ---------------------------------------------------------------------------

function verify(doc, placements, pages) {
  const problems = [];
  for (const placement of placements) {
    const spec = pages[placement.page];
    const columns = columnBoxes(spec);
    const column = columns.find((candidate) => Math.abs(candidate.x - placement.x) < 0.01);
    if (!column) {
      problems.push(`page ${placement.page + 1}: line at x=${placement.x.toFixed(2)} is not on a column origin`);
      continue;
    }
    const role = ROLES[placement.role];
    doc.setFont('DejaVu', role.weight);
    doc.setFontSize(role.size);
    const drawn = placement.justify ? placement.measure : placement.naturalWidth;
    if (drawn - column.width > 0.05) {
      problems.push(`page ${placement.page + 1} row ${placement.row}: line overflows column by ${(drawn - column.width).toFixed(2)} mm`);
    }
    const rowsUsed = rowsFor(placement.role);
    if (placement.row < 0 || placement.row + rowsUsed - 1 > rowCount - 1) {
      problems.push(`page ${placement.page + 1}: row ${placement.row} outside the type area`);
    }
    for (const band of spec.bands ?? []) {
      if (!band.columns.includes(column.index)) continue;
      if (placement.row <= band.rows[1] && placement.row + rowsUsed - 1 >= band.rows[0]) {
        problems.push(`page ${placement.page + 1}: row ${placement.row} collides with ${band.kind} band rows ${band.rows.join('-')}`);
      }
    }
    const baseline = rowTop(placement.row) + ascentFor(role.size);
    const offGrid = Math.abs(((baseline - ascentFor(role.size) - PAGE.marginTop) / GRID) % 1);
    if (offGrid > 1e-6 && Math.abs(offGrid - 1) > 1e-6) {
      problems.push(`page ${placement.page + 1}: baseline ${baseline.toFixed(3)} is off the ${GRID} mm grid`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const POLISH = [
  'Cyfryzacja spedycji przestała być projektem pilotażowym i stała się warunkiem konkurencyjności. Przedsiębiorstwa transportowe, które trzy lata temu wymieniały zlecenia w załącznikach do wiadomości elektronicznych, dzisiaj oczekują interfejsów programistycznych, ustandaryzowanych identyfikatorów przesyłek oraz przewidywalnego rozliczania kosztów międzynarodowych.',
  'Największą przeszkodą pozostaje nieporównywalność danych. Każda platforma opisuje status przesyłki własnym słownikiem, a nieprzewidywalność opóźnień na przejściach granicznych sprawia, że nawet dobrze zaprojektowana automatyzacja wymaga nadzoru dyspozytora. Standaryzacja komunikatów jest więc mniej efektowna niż sztuczna inteligencja, ale przynosi mierzalne oszczędności szybciej.',
  'Ubezpieczyciele i instytucje finansujące flotę zaczynają traktować jakość danych telematycznych jako element oceny ryzyka. Wykorzystywanych wskaźników jest niewiele: terminowość, udokumentowana temperatura ładunku oraz kompletność elektronicznego listu przewozowego. Przewoźnik, który potrafi je udowodnić, negocjuje istotnie korzystniejsze warunki niż konkurent opierający się na oświadczeniach.',
  'Warto zauważyć, że wdrożenia kończące się porażką rzadko przegrywają z technologią. Przegrywają z procesem: brakiem właściciela danych, nieprzeszkolonymi dyspozytorami i równoległym utrzymywaniem arkuszy kalkulacyjnych jako nieoficjalnego źródła prawdy. Odpowiedzialność organizacyjna okazuje się trudniejsza do zaprojektowania niż integracja.',
  'Dlatego rekomendacja jest nudna i skuteczna jednocześnie. Najpierw jeden ustandaryzowany identyfikator przesyłki obowiązujący w całym przedsiębiorstwie, potem automatyczne potwierdzenia statusów, a dopiero na końcu prognozowanie opóźnień. Kolejność odwrotna generuje efektowne prezentacje i nieprzewidywalne wyniki.',
  'Osobnym problemem jest rozliczalność. Faktura za usługę transportową powstaje dzisiaj na podstawie danych z co najmniej trzech systemów, a rozbieżność pomiędzy zadeklarowaną a rzeczywistą masą ładunku uruchamia korespondencję trwającą tygodnie. Ustandaryzowany załącznik ważenia usuwa większość takich sporów bez żadnego algorytmu.',
  'Nie znaczy to, że zaawansowana analityka jest bezużyteczna. Znaczy to, że prognozowanie opóźnień zbudowane na niekompletnych i niespójnych zdarzeniach zwraca prognozę o dokładności trudnej do obrony przed klientem. Najpierw kompletność zdarzeń, potem model. Ta kolejność jest niepopularna, ponieważ nie wygląda nowocześnie na slajdzie zarządu.',
  'Warto też pamiętać o kosztach przełączenia. Przewoźnik obsługujący czterdzieści zleceń dziennie nie zaakceptuje interfejsu, który wymaga dodatkowego logowania i przepisywania numerów. Wdrożenie, które nie zmniejsza liczby kliknięć w pierwszym tygodniu, będzie omijane niezależnie od jakości dokumentacji technicznej.',
];

const ENGLISH = [
  'The economics of a freight marketplace are unforgiving. Margin per transaction is thin, disputes are expensive, and every manual intervention consumes the profit of several automated bookings. Operators therefore optimise for the boring part of the business: clean identifiers, reconcilable documents, and a status vocabulary that both parties actually agree on.',
  'Standardisation is not glamorous, and it rarely survives a quarterly roadmap review on its own merits. It survives when it is attached to a number somebody is accountable for, such as the share of shipments that close without a human touching them, or the number of days between delivery and payment.',
  'Interoperability work also changes the shape of the engineering team. Fewer people build screens, more people negotiate schemas, and the documentation becomes a product with its own release notes. Companies that treat this as overhead spend the difference later, in support tickets.',
  'Finally, a note on measurement. Teams that publish a weekly touchless-booking ratio converge on interoperable data faster than teams that publish an architecture diagram, because the ratio is falsifiable and the diagram is not. The metric also survives reorganisations, which diagrams rarely do.',
  'None of this requires a new platform. It requires agreeing on the identifier, publishing the status vocabulary, and refusing to accept a document that cannot be reconciled automatically. The unglamorous version of the work is also the version that ships.',
];

const blocks = [
  { role: 'lead', text: POLISH[0], language: 'pl', spaceAfterRows: 1 },
  { role: 'body', text: POLISH[1], language: 'pl', spaceAfterRows: 1 },
  { role: 'subhead', text: 'Dane, nie deklaracje', language: 'pl', align: 'left', keepWithNext: true },
  { role: 'body', text: POLISH[2], language: 'pl', spaceAfterRows: 1 },
  { role: 'body', text: POLISH[3], language: 'pl', spaceAfterRows: 1 },
  { role: 'subhead', text: 'Kolejność ma znaczenie', language: 'pl', align: 'left', keepWithNext: true },
  { role: 'body', text: POLISH[4], language: 'pl', spaceAfterRows: 1 },
  { role: 'subhead', text: 'The marketplace view', language: 'en', align: 'left', keepWithNext: true },
  { role: 'body', text: ENGLISH[0], language: 'en', spaceAfterRows: 1 },
  { role: 'body', text: ENGLISH[1], language: 'en', spaceAfterRows: 1 },
  { role: 'body', text: ENGLISH[2], language: 'en', spaceAfterRows: 1 },
  { role: 'subhead', text: 'Rozliczalność i koszt przełączenia', language: 'pl', align: 'left', keepWithNext: true },
  { role: 'body', text: POLISH[5], language: 'pl', spaceAfterRows: 1 },
  { role: 'body', text: POLISH[6], language: 'pl', spaceAfterRows: 1 },
  { role: 'body', text: POLISH[7], language: 'pl', spaceAfterRows: 1 },
  { role: 'subhead', text: 'What to measure', language: 'en', align: 'left', keepWithNext: true },
  { role: 'body', text: ENGLISH[3], language: 'en', spaceAfterRows: 1 },
  { role: 'body', text: ENGLISH[4], language: 'en', spaceAfterRows: 1 },
];

const featurePage = {
  columns: 2,
  gutter: 7,
  bands: [
    {
      kind: 'masthead',
      columns: [0, 1],
      rows: [0, 10],
      eyebrow: 'Raport branżowy · logistyka',
      headline: 'Standaryzacja przed automatyzacją',
      standfirst: 'Dlaczego wspólny słownik statusów przesyłek zwraca się szybciej niż prognozowanie opóźnień.',
    },
    {
      kind: 'image',
      columns: [1],
      rows: [11, 24],
      caption: 'Terminal przeładunkowy, ujęcie poglądowe. Miejsce zarezerwowane dla fotografii redakcyjnej.',
    },
    {
      kind: 'quote',
      columns: [0],
      rows: [40, 47],
      text: 'Wdrożenia nie przegrywają z technologią, przegrywają z procesem.',
      attribution: 'Dyrektor operacyjny, przewoźnik międzynarodowy',
    },
  ],
};

const densePage = {
  columns: 3,
  gutter: 6,
  bands: [
    {
      kind: 'sidebar',
      columns: [2],
      rows: [0, 21],
      heading: 'Co sprawdzić najpierw',
      items: [
        'Jeden identyfikator przesyłki w całym przedsiębiorstwie.',
        'Automatyczne potwierdzenia statusów z terminali.',
        'Kompletny elektroniczny list przewozowy.',
        'Udokumentowana temperatura ładunku.',
        'Właściciel danych po stronie operacyjnej.',
      ],
    },
    {
      kind: 'image',
      columns: [0, 1],
      rows: [40, 52],
      caption: 'Schemat wymiany komunikatów pomiędzy platformami. Miejsce na grafikę informacyjną.',
    },
  ],
};

const continuationPage = { columns: 3, gutter: 6, bands: [] };

// ---------------------------------------------------------------------------

function newDocument() {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', readFileSync(join(assets, 'font.ttf')).toString('base64'));
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', readFileSync(join(assets, 'font-bold.ttf')).toString('base64'));
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  return doc;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(3));
}

function renderVariant(variant) {
  options = variant;
  const doc = newDocument();
  const pageSpecs = [featurePage, densePage, continuationPage];
  const { placements, pages, diagnostics } = flowDocument(doc, blocks, pageSpecs);
  const problems = verify(doc, placements, pages);
  const stats = { lines: [] };
  pages.forEach((spec, index) => {
    if (index > 0) doc.addPage();
    doc.setPage(index + 1);
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE.width, PAGE.height, 'F');
    paintBands(doc, spec);
    doc.setTextColor(...INK);
    for (const placement of placements.filter((candidate) => candidate.page === index)) drawLine(doc, placement, stats);
    paintFolio(doc, index + 1, pages.length, 'Standaryzacja przed automatyzacją');
  });
  const pdfPath = join(outputDir, `multicolumn-${variant.id}.pdf`);
  writeFileSync(pdfPath, Buffer.from(doc.output('arraybuffer')));
  const ratios = stats.lines.filter((line) => line.justified).map((line) => line.ratio).sort((a, b) => a - b);
  const hyphenated = placements.filter((placement) => placement.pieces.at(-1).endsWith('-'));
  let consecutive = 0;
  let worstRun = 0;
  for (const placement of placements) {
    consecutive = placement.pieces.at(-1).endsWith('-') ? consecutive + 1 : 0;
    worstRun = Math.max(worstRun, consecutive);
  }
  return {
    variant: variant.id,
    pdf: pdfPath,
    pages: pages.length,
    lines: placements.length,
    justifiedLines: ratios.length,
    hyphenatedLines: hyphenated.length,
    hyphenatedShare: Number((hyphenated.length / placements.length).toFixed(3)),
    longestHyphenRun: worstRun,
    spaceStretch: ratios.length
      ? {
        min: percentile(ratios, 0),
        median: percentile(ratios, 0.5),
        p95: percentile(ratios, 0.95),
        max: Number(ratios.at(-1).toFixed(3)),
        over130: ratios.filter((ratio) => ratio > 1.3).length,
        over150: ratios.filter((ratio) => ratio > 1.5).length,
      }
      : null,
    diagnostics,
    geometryProblems: problems,
  };
}

function main() {
  mkdirSync(outputDir, { recursive: true });
  const reports = VARIANTS.map(renderVariant);
  writeFileSync(join(outputDir, 'multicolumn-metrics.json'), `${JSON.stringify(reports, null, 2)}\n`);
  console.log(JSON.stringify(reports, null, 2));
  return reports.every((report) => report.geometryProblems.length === 0) ? 0 : 1;
}

process.exitCode = main();
