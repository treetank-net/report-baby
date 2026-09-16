import { LoremIpsum } from 'lorem-ipsum';

/** Create repeatable natural-language filler for planning and rendering tests. */
export function createDeterministicLorem(seed = 0x6d2b79f5) {
  return new LoremIpsum({
    random: () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0;
      return ((seed ^ (seed >>> 7)) >>> 0) / 0x100000000;
    },
  });
}

/** Generate deterministic natural-language words for a fixture. */
export function loremWords(lorem, count) {
  return lorem.generateWords(count);
}

/** Generate a heading/title-sized word sequence with a sentence-case start. */
export function loremHeading(lorem, count) {
  const text = loremWords(lorem, count);
  return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
}

/**
 * Generate a deterministic paragraph with sentence boundaries while keeping
 * the requested word count exact. The lorem-ipsum package's word generator is
 * intentionally punctuation-free; using it directly for paragraph blocks
 * makes every block look like one sentence fragment when it is rendered.
 */
export function loremParagraph(lorem, count) {
  const words = loremWords(lorem, count).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return '';
  const sentenceLengths = [10, 12, 9, 11, 8, 13, 10];
  const sentences = [];
  let offset = 0;
  let sentenceIndex = 0;
  while (offset < words.length) {
    const remaining = words.length - offset;
    const preferredLength = sentenceLengths[sentenceIndex % sentenceLengths.length];
    const length = remaining <= preferredLength + 3
      ? remaining
      : preferredLength;
    const sentence = words.slice(offset, offset + length);
    sentence[0] = `${sentence[0][0].toUpperCase()}${sentence[0].slice(1)}`;
    sentences.push(`${sentence.join(' ')}.`);
    offset += length;
    sentenceIndex += 1;
  }
  return sentences.join(' ');
}

/** Generate deterministic natural-language sentences for a fixture. */
export function loremSentence(lorem, lowerBound = 8, upperBound = 14) {
  return lorem.generateSentences(1, lowerBound, upperBound);
}
