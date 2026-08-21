import type { jsPDF } from 'jspdf';

export interface StyledRun {
  text: string;
  bold: boolean;
  fallback: boolean;
}

export interface StyledTextContext {
  family: string;
  boldFamily?: string;
  coverage?: Set<number>;
  warnings?: string[];
}

export const FALLBACK_FAMILY = 'DejaVu';

const INLINE_PATTERN = /\*\*([^*\n]+)\*\*|(?<![*\w])\*([^*\n]+)\*(?![*\w])|__([^_\n]+)__/g;

export const ITALIC_WITHOUT_FACE_WARNING =
  'Italic markup was rendered upright: neither the brand nor the bundled font ships an italic face.';

export function missingGlyphWarning(family: string, codePoints: number[]): string {
  const listed = codePoints
    .slice(0, 8)
    .map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(', ');
  const rest = codePoints.length > 8 ? ` and ${codePoints.length - 8} more` : '';
  return `Font '${family}' is missing ${codePoints.length} glyph(s) (${listed}${rest}); those characters were drawn with the bundled DejaVu Sans.`;
}

function readUint16(font: Uint8Array, at: number): number {
  return (font[at] << 8) | font[at + 1];
}

function readUint32(font: Uint8Array, at: number): number {
  return ((font[at] << 24) | (font[at + 1] << 16) | (font[at + 2] << 8) | font[at + 3]) >>> 0;
}

function findCmapTable(font: Uint8Array): number | undefined {
  const tables = readUint16(font, 4);
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(font[record], font[record + 1], font[record + 2], font[record + 3]);
    if (tag === 'cmap') return readUint32(font, record + 8);
  }
  return undefined;
}

function pickSubtable(font: Uint8Array, cmap: number): number | undefined {
  const encodings = readUint16(font, cmap + 2);
  let format4: number | undefined;
  let format12: number | undefined;
  for (let i = 0; i < encodings; i += 1) {
    const record = cmap + 4 + i * 8;
    const platform = readUint16(font, record);
    const encoding = readUint16(font, record + 2);
    const subtable = cmap + readUint32(font, record + 4);
    const format = readUint16(font, subtable);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) format12 = subtable;
    else if (format === 4 && format4 === undefined) format4 = subtable;
  }
  return format12 ?? format4;
}

function collectFormat4(font: Uint8Array, subtable: number, covered: Set<number>): void {
  const segments = readUint16(font, subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment += 1) {
    const end = readUint16(font, endCodes + segment * 2);
    const start = readUint16(font, startCodes + segment * 2);
    if (start > end || start === 0xffff) continue;
    const rangeOffset = readUint16(font, rangeOffsets + segment * 2);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      if (rangeOffset === 0) {
        covered.add(code);
        continue;
      }
      const glyphAt = rangeOffsets + segment * 2 + rangeOffset + (code - start) * 2;
      if (glyphAt + 1 < font.length && readUint16(font, glyphAt) !== 0) covered.add(code);
    }
  }
}

function collectFormat12(font: Uint8Array, subtable: number, covered: Set<number>): void {
  const groups = readUint32(font, subtable + 12);
  for (let group = 0; group < groups; group += 1) {
    const at = subtable + 16 + group * 12;
    const start = readUint32(font, at);
    const end = readUint32(font, at + 4);
    if (readUint32(font, at + 8) === 0) continue;
    for (let code = start; code <= end; code += 1) covered.add(code);
  }
}

const coverageCache = new WeakMap<Uint8Array, Set<number>>();

export function fontCoverage(font: Uint8Array): Set<number> | undefined {
  const cached = coverageCache.get(font);
  if (cached) return cached;
  try {
    const cmap = findCmapTable(font);
    if (cmap === undefined) return undefined;
    const subtable = pickSubtable(font, cmap);
    if (subtable === undefined) return undefined;
    const covered = new Set<number>();
    if (readUint16(font, subtable) === 12) collectFormat12(font, subtable, covered);
    else collectFormat4(font, subtable, covered);
    if (covered.size === 0) return undefined;
    coverageCache.set(font, covered);
    return covered;
  } catch {
    return undefined;
  }
}

export function parseInlineRuns(text: string, warnings?: string[]): StyledRun[] {
  const runs: StyledRun[] = [];
  let cursor = 0;
  let italicSeen = false;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const at = match.index ?? 0;
    if (at > cursor) runs.push({ text: text.slice(cursor, at), bold: false, fallback: false });
    const bold = match[1] ?? match[3];
    if (bold !== undefined) runs.push({ text: bold, bold: true, fallback: false });
    else {
      italicSeen = true;
      runs.push({ text: match[2], bold: false, fallback: false });
    }
    cursor = at + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), bold: false, fallback: false });
  if (italicSeen && warnings && !warnings.includes(ITALIC_WITHOUT_FACE_WARNING)) warnings.push(ITALIC_WITHOUT_FACE_WARNING);
  return runs.length > 0 ? runs : [{ text, bold: false, fallback: false }];
}

export function splitUncovered(runs: StyledRun[], context: StyledTextContext): StyledRun[] {
  const coverage = context.coverage;
  if (!coverage) return runs;
  const missing = new Set<number>();
  const split: StyledRun[] = [];
  for (const run of runs) {
    let buffer = '';
    let bufferFallback = false;
    for (const character of run.text) {
      const code = character.codePointAt(0) ?? 0;
      const uncovered = code > 0x20 && !coverage.has(code);
      if (uncovered) missing.add(code);
      if (buffer.length > 0 && uncovered !== bufferFallback) {
        split.push({ text: buffer, bold: run.bold, fallback: bufferFallback });
        buffer = '';
      }
      bufferFallback = uncovered;
      buffer += character;
    }
    if (buffer.length > 0) split.push({ text: buffer, bold: run.bold, fallback: bufferFallback });
  }
  if (missing.size > 0 && context.warnings) {
    const warning = missingGlyphWarning(context.family, [...missing].sort((a, b) => a - b));
    if (!context.warnings.some((message) => message.startsWith(`Font '${context.family}' is missing`))) context.warnings.push(warning);
  }
  return split;
}

export function stripInlineMarkup(text: string): string {
  return text.replace(INLINE_PATTERN, (_, bold, italic, underscored) => bold ?? italic ?? underscored);
}

export function missingCodePoints(text: string, coverage: Set<number> | undefined): number[] {
  if (!coverage) return [];
  const missing = new Set<number>();
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x20 && !coverage.has(code)) missing.add(code);
  }
  return [...missing].sort((a, b) => a - b);
}

export const LITERAL_MARKUP_WARNING =
  'Inline markup inside table cells was stripped to plain text: the table renderer draws one weight per cell and cannot switch weight mid-string.';

export function tableFallbackWarning(family: string, codePoints: number[]): string {
  const listed = codePoints
    .slice(0, 8)
    .map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`)
    .join(', ');
  return `Table cells use ${codePoints.length} glyph(s) missing from '${family}' (${listed}); those cells are drawn entirely in the bundled DejaVu Sans.`;
}

export function styledRuns(text: string, context: StyledTextContext): StyledRun[] {
  return splitUncovered(parseInlineRuns(text, context.warnings), context);
}

function applyFont(doc: jsPDF, run: StyledRun, context: StyledTextContext): void {
  const family = run.fallback ? FALLBACK_FAMILY : run.bold ? context.boldFamily ?? context.family : context.family;
  doc.setFont(family, run.bold ? 'bold' : 'normal');
}

function runWidth(doc: jsPDF, run: StyledRun, context: StyledTextContext): number {
  applyFont(doc, run, context);
  return doc.getTextWidth(run.text);
}

function tokenize(runs: StyledRun[]): StyledRun[] {
  const tokens: StyledRun[] = [];
  for (const run of runs) {
    for (const piece of run.text.split(/(\n|\s+)/)) {
      if (piece.length > 0) tokens.push({ ...run, text: piece });
    }
  }
  return tokens;
}

function mergeAdjacent(runs: StyledRun[]): StyledRun[] {
  const merged: StyledRun[] = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last && last.bold === run.bold && last.fallback === run.fallback) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

export function wrapStyledRuns(doc: jsPDF, runs: StyledRun[], width: number, context: StyledTextContext): StyledRun[][] {
  const lines: StyledRun[][] = [];
  let line: StyledRun[] = [];
  let used = 0;
  const flush = (): void => {
    while (line.length > 0 && /^\s+$/.test(line.at(-1)!.text)) line.pop();
    lines.push(mergeAdjacent(line));
    line = [];
    used = 0;
  };
  for (const token of tokenize(runs)) {
    if (token.text === '\n') {
      flush();
      continue;
    }
    const tokenWidth = runWidth(doc, token, context);
    const blank = /^\s+$/.test(token.text);
    if (used + tokenWidth > width && line.length > 0) {
      flush();
      if (blank) continue;
    }
    if (blank && line.length === 0) continue;
    line.push(token);
    used += tokenWidth;
  }
  if (line.length > 0) flush();
  return lines.length > 0 ? lines : [[]];
}

export function layoutStyledText(doc: jsPDF, text: string, width: number, context: StyledTextContext): StyledRun[][] {
  return wrapStyledRuns(doc, styledRuns(text, context), width, context);
}

export function drawStyledLine(doc: jsPDF, line: StyledRun[], x: number, y: number, context: StyledTextContext): void {
  let cursor = x;
  for (const run of line) {
    applyFont(doc, run, context);
    doc.text(run.text, cursor, y);
    cursor += doc.getTextWidth(run.text);
  }
}

export function styledLineWidth(doc: jsPDF, line: StyledRun[], context: StyledTextContext): number {
  return line.reduce((total, run) => total + runWidth(doc, run, context), 0);
}
