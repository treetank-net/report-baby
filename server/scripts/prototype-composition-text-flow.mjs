// PROTOTYPE — renderer-neutral text-flow primitives.
// The composition planner may use these primitives with any backend that
// implements the TextMetrics contract. This module must not import jsPDF.

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

export function assertTextMetrics(metrics) {
  assert(metrics && typeof metrics === 'object', 'A text metrics adapter is required.');
  assert(metrics.units === 'mm', `The prototype planner requires millimetre metrics, got '${metrics.units}'.`);
  assert(typeof metrics.measureText === 'function', 'Text metrics must implement measureText(text, styleName).');
  assert(typeof metrics.lineHeight === 'function', 'Text metrics must implement lineHeight(styleName).');
}

export function styleFor(block) {
  return block.role === 'section_heading' ? 'heading' : block.role === 'intro' ? 'intro' : block.role === 'sidebar' ? 'sidebar' : 'body';
}

export function widthOf(metrics, text, styleName) {
  const width = metrics.measureText(text, styleName);
  assert(Number.isFinite(width) && width >= 0, `Text metrics returned an invalid width for '${styleName}': ${width}.`);
  return width;
}

export function lineHeight(metrics, block) {
  const styleName = styleFor(block);
  const height = metrics.lineHeight(styleName);
  assert(Number.isFinite(height) && height > 0, `Text metrics returned an invalid line-height for '${styleName}': ${height}.`);
  return height;
}

function wordsOf(text) {
  return text.trim().split(/\s+/u).filter(Boolean);
}

export function wrapFrom(metrics, block, startWord, measureAt) {
  const words = wordsOf(block.text.replace(/^•\s/u, ''));
  const lines = [];
  let index = startWord;
  let lineIndex = 0;
  while (index < words.length) {
    const available = measureAt(lineIndex);
    assert(Number.isFinite(available) && available > 0, `Text flow received an invalid line width: ${available}.`);
    let end = index;
    let chosen = '';
    while (end < words.length) {
      const candidate = chosen ? `${chosen} ${words[end]}` : words[end];
      if (widthOf(metrics, candidate, styleFor(block)) <= available || !chosen) {
        chosen = candidate;
        end += 1;
        continue;
      }
      break;
    }
    const width = widthOf(metrics, chosen, styleFor(block));
    lines.push({ text: chosen, width, startWord: index, endWord: end, overfull: width > available + 0.01, lineIndex });
    if (end === index) end += 1;
    index = end;
    lineIndex += 1;
  }
  return { lines, words };
}
