import { LoremIpsum } from 'lorem-ipsum';

/**
 * Create a repeatable lorem-ipsum generator for fixtures.
 *
 * Tests should use generated prose rather than repeating one token: word
 * lengths and punctuation exercise wrapping while the seeded PRNG keeps the
 * expected page geometry stable between runs.
 */
export function createDeterministicLorem(seed = 0x6d2b79f5) {
  let state = seed | 0;
  return new LoremIpsum({
    random: () => {
      state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
      return ((state ^ (state >>> 7)) >>> 0) / 0x100000000;
    },
  });
}

export function loremWords(lorem, count) {
  return lorem.generateWords(count);
}

export function loremSentence(lorem, lowerBound = 8, upperBound = 14) {
  return lorem.generateSentences(1, lowerBound, upperBound);
}
