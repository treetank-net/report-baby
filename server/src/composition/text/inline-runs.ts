import type { NormalizedContentNode } from '../../content/contracts/normalized-content.js';
import type { CompositionInlineMark, CompositionInlineRun } from '../contracts/model.js';

type InlineContext = {
  marks: CompositionInlineMark[];
  href?: string;
};

function sameMarks(left: CompositionInlineRun, right: CompositionInlineRun): boolean {
  return left.marks.length === right.marks.length
    && left.marks.every((mark, index) => mark === right.marks[index])
    && left.href === right.href;
}

function appendRun(runs: CompositionInlineRun[], text: string, context: InlineContext): void {
  if (!text) return;
  const previous = runs.at(-1);
  if (previous && sameMarks(previous, { text, marks: context.marks, href: context.href })) {
    previous.text += text;
    return;
  }
  runs.push({ text, marks: [...context.marks], ...(context.href === undefined ? {} : { href: context.href }) });
}

function appendNode(runs: CompositionInlineRun[], node: NormalizedContentNode, context: InlineContext): void {
  if (node.type === 'text') {
    appendRun(runs, node.value, context);
    return;
  }
  if (node.type === 'image' || node.type === 'table' || node.type === 'chart') return;
  if (node.type === 'list') {
    node.items.forEach((item, index) => {
      if (index > 0) appendRun(runs, '\n', context);
      item.children.forEach((child) => appendNode(runs, child, context));
    });
    return;
  }
  const marks = node.type === 'strong' || node.type === 'emphasis' || node.type === 'link'
    ? [...context.marks, node.type]
    : context.marks;
  const href = node.type === 'link' ? node.href : context.href;
  node.children.forEach((child) => appendNode(runs, child, { marks, href }));
}

function trimRunWhitespace(runs: CompositionInlineRun[]): CompositionInlineRun[] {
  const result = runs.map((run) => ({ ...run, marks: [...run.marks] }));
  while (result.length > 0 && /^\s+$/u.test(result[0]!.text)) result.shift();
  while (result.length > 0 && /^\s+$/u.test(result.at(-1)!.text)) result.pop();
  return result;
}

/** Convert normalized content nodes into renderer-neutral inline runs. */
export function inlineRunsFromNodes(nodes: NormalizedContentNode[]): CompositionInlineRun[] {
  const runs: CompositionInlineRun[] = [];
  nodes.forEach((node, index) => {
    if (index > 0 && (node.type === 'paragraph' || node.type === 'heading' || node.type === 'list')) appendRun(runs, '\n', { marks: [] });
    appendNode(runs, node, { marks: [] });
  });
  return trimRunWhitespace(runs);
}

/** Create an unmarked run for blocks that do not carry a normalized AST. */
export function inlineRunsFromText(text: string | undefined): CompositionInlineRun[] {
  return text ? [{ text, marks: [] }] : [];
}

function tokenRuns(runs: CompositionInlineRun[]): CompositionInlineRun[] {
  return runs.flatMap((run) => run.text.split(/(\s+)/u).filter(Boolean).map((text) => ({ ...run, text, marks: [...run.marks] })));
}

/** Select and normalize inline runs for a wrapped word range. */
export function inlineRunsForWordRange(runs: CompositionInlineRun[], startWord: number, endWord: number): CompositionInlineRun[] {
  const tokens = tokenRuns(runs);
  const words = tokens.filter((token) => !/^\s+$/u.test(token.text));
  const selected = words.slice(startWord, endWord);
  const output: CompositionInlineRun[] = [];
  selected.forEach((word, index) => {
    if (index > 0) appendRun(output, ' ', { marks: output.at(-1)?.marks ?? [], href: output.at(-1)?.href });
    appendRun(output, word.text, { marks: word.marks, href: word.href });
  });
  return output;
}

export interface CompositionInlineRunSegment {
  run: CompositionInlineRun;
  fallback: boolean;
}

/** Split a run at code points unavailable in the selected font. */
export function splitInlineRunByCoverage(
  run: CompositionInlineRun,
  coverage: Set<number> | undefined,
): CompositionInlineRunSegment[] {
  if (!coverage) return [{ run, fallback: false }];
  const segments: CompositionInlineRunSegment[] = [];
  let text = '';
  let fallback: boolean | undefined;
  const flush = (): void => {
    if (!text || fallback === undefined) return;
    segments.push({ run: { ...run, text, marks: [...run.marks] }, fallback });
    text = '';
  };
  for (const character of run.text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const missing = codePoint > 0x20 && !coverage.has(codePoint);
    if (fallback !== undefined && missing !== fallback) flush();
    fallback = missing;
    text += character;
  }
  flush();
  return segments;
}

export function missingInlineCodePoints(runs: CompositionInlineRun[], coverage: Set<number> | undefined): number[] {
  if (!coverage) return [];
  const missing = new Set<number>();
  for (const run of runs) {
    for (const character of run.text) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint > 0x20 && !coverage.has(codePoint)) missing.add(codePoint);
    }
  }
  return [...missing].sort((left, right) => left - right);
}

/** Find missing glyphs with the coverage of the semantic face that will draw each run. */
export function missingInlineCodePointsByStyle(
  runs: CompositionInlineRun[],
  regular: Set<number> | undefined,
  bold: Set<number> | undefined,
): number[] {
  const missing = new Set<number>();
  for (const run of runs) {
    const coverage = run.marks.includes('strong') ? bold ?? regular : regular;
    for (const codePoint of missingInlineCodePoints([run], coverage)) missing.add(codePoint);
  }
  return [...missing].sort((left, right) => left - right);
}

export function missingInlineGlyphWarning(family: string, codePoints: number[]): string {
  const listed = codePoints.slice(0, 8).map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
  const rest = codePoints.length > 8 ? ` and ${codePoints.length - 8} more` : '';
  return `Font '${family}' is missing ${codePoints.length} glyph(s) (${listed}${rest}); those characters were drawn with the bundled DejaVu Sans.`;
}

export function hasInlineMark(runs: CompositionInlineRun[], mark: CompositionInlineMark): boolean {
  return runs.some((run) => run.marks.includes(mark));
}

export function missingTableGlyphWarning(family: string, codePoints: number[]): string {
  const listed = codePoints.slice(0, 8).map((code) => `U+${code.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
  const rest = codePoints.length > 8 ? ` and ${codePoints.length - 8} more` : '';
  return `Table cells use ${codePoints.length} glyph(s) missing from '${family}' (${listed}${rest}); those cells are drawn entirely in the bundled DejaVu Sans.`;
}

/** Measure a run sequence through the optional inline-aware metrics seam. */
export function measureInlineRuns(
  measure: (text: string, marks: CompositionInlineMark[], href?: string) => number,
  runs: CompositionInlineRun[],
): number {
  return runs.reduce((total, run) => total + measure(run.text, run.marks, run.href), 0);
}
