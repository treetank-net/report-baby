import { LoremIpsum } from 'lorem-ipsum';

/**
 * Large editorial-flow fixture.
 *
 * The shape mirrors the source article's semantic sequence: introductory
 * paragraphs, seven headings, body paragraphs, and four authored quotes. The
 * counts are source word counts; body paragraphs are deliberately expanded by
 * 1.4x so the fixture exercises continuation pages rather than only fitting a
 * short smoke-test page.
 */
const SOURCE_SHAPE = [
  ['intro-1', 'intro', 'paragraph', 2],
  ['intro-2', 'intro', 'paragraph', 75],
  ['intro-3', 'intro', 'paragraph', 22],
  ['section-market', 'heading', 'heading', 7],
  ['body-market-1', 'body', 'paragraph', 38],
  ['body-market-2', 'body', 'paragraph', 17],
  ['quote-market', 'quote', 'quote', 24],
  ['body-market-3', 'body', 'paragraph', 34],
  ['body-market-4', 'body', 'paragraph', 18],
  ['section-drivers', 'heading', 'heading', 6],
  ['body-drivers-1', 'body', 'paragraph', 23],
  ['body-drivers-2', 'body', 'paragraph', 13],
  ['quote-drivers', 'quote', 'quote', 20],
  ['body-drivers-3', 'body', 'paragraph', 27],
  ['body-drivers-4', 'body', 'paragraph', 33],
  ['section-costs', 'heading', 'heading', 4],
  ['body-costs-1', 'body', 'paragraph', 9],
  ['body-costs-2', 'body', 'paragraph', 64],
  ['body-costs-3', 'body', 'paragraph', 45],
  ['section-diesel', 'heading', 'heading', 6],
  ['body-diesel-1', 'body', 'paragraph', 7],
  ['body-diesel-2', 'body', 'paragraph', 32],
  ['body-diesel-3', 'body', 'paragraph', 23],
  ['quote-diesel', 'quote', 'quote', 24],
  ['body-diesel-4', 'body', 'paragraph', 25],
  ['section-adblue', 'heading', 'heading', 6],
  ['body-adblue-1', 'body', 'paragraph', 11],
  ['body-adblue-2', 'body', 'paragraph', 22],
  ['body-adblue-3', 'body', 'paragraph', 32],
  ['section-outlook', 'heading', 'heading', 6],
  ['body-outlook-1', 'body', 'paragraph', 33],
  ['body-outlook-2', 'body', 'paragraph', 18],
  ['body-outlook-3', 'body', 'paragraph', 38],
  ['section-autumn', 'heading', 'heading', 9],
  ['body-autumn-1', 'body', 'paragraph', 28],
  ['body-autumn-2', 'body', 'paragraph', 31],
  ['quote-autumn', 'quote', 'quote', 26],
  ['body-autumn-3', 'body', 'paragraph', 31],
  ['body-autumn-4', 'body', 'paragraph', 28],
];

const TITLE_WORDS = 12;
const BODY_SCALE = 1.4;
function createLoremGenerator() {
  let seed = 0x6d2b79f5;
  return new LoremIpsum({
    random: () => {
      seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) | 0;
      return ((seed ^ (seed >>> 7)) >>> 0) / 0x100000000;
    },
  });
}

function nextToken(state, word) {
  const number = state.next;
  state.next += 1;
  return `${word.toLowerCase()}${String(number).padStart(4, '0')}`;
}

function numberedText(count, state, lorem) {
  return lorem.generateWords(count).split(/\s+/u).map((word) => nextToken(state, word)).join(' ');
}

function countFor(kind, sourceWords) {
  return kind === 'paragraph' ? Math.ceil(sourceWords * BODY_SCALE) : sourceWords;
}

export function createEditorialNumberedFixture({ quoteMarkGap, quoteMarkOffsetX, quoteMarkOffsetY }) {
  const state = { next: 1 };
  const lorem = createLoremGenerator();
  const blocks = SOURCE_SHAPE.map(([id, role, kind, sourceWords]) => ({
    id,
    type: kind === 'heading' ? 'heading' : 'text',
    role,
    ...(kind === 'heading' ? { level: 1, keep_with_next_lines: 3 } : {}),
    text: numberedText(countFor(kind, sourceWords), state, lorem),
  }));
  const totalMainWords = state.next - 1;
  const title = numberedText(TITLE_WORDS, state, lorem);
  const tokenPrefixes = [...new Set(blocks.flatMap((block) => block.text.split(/\s+/u).map((token) => token.replace(/\d{4}$/u, ''))))];
  const introBlocks = blocks.filter((block) => block.role === 'intro');
  const quoteBlocks = blocks.filter((block) => block.role === 'quote');
  const mainBlocks = blocks.filter((block) => block.role !== 'intro' && block.role !== 'quote');
  const glyphs = quoteBlocks.flatMap((block) => [
    {
      id: `${block.id}-open`,
      target: { kind: 'block', id: block.id },
      text: '“',
      style: 'quote-mark',
      anchor: 'text-start',
      target_mode: 'first-line',
      offset_x: -quoteMarkGap + quoteMarkOffsetX,
      offset_y: quoteMarkOffsetY,
      clamp_to_target: false,
    },
    {
      id: `${block.id}-close`,
      target: { kind: 'block', id: block.id },
      text: '”',
      style: 'quote-mark',
      anchor: 'text-end',
      target_mode: 'last-line',
      offset_x: quoteMarkGap + quoteMarkOffsetX,
      offset_y: quoteMarkOffsetY,
      clamp_to_target: true,
    },
  ]);
  return {
    input: {
      flows: {
        intro: { continuation: 'forbidden', blocks: introBlocks },
        main: { continuation: 'allowed', blocks: mainBlocks },
        quotes: { continuation: 'allowed', blocks: quoteBlocks },
        header: {
          continuation: 'forbidden',
          blocks: [
            { id: 'header-title', type: 'heading', role: 'header', text: 'Editorial numbered-flow fixture' },
            { id: 'header-meta', type: 'text', role: 'header', text: 'Layout integrity test' },
          ],
        },
        footer: {
          continuation: 'forbidden',
          blocks: [{ id: 'footer', type: 'text', role: 'footer', text: 'Numbered-flow fixture' }],
        },
      },
      glyphs,
    },
    title,
    sourceShape: SOURCE_SHAPE.map(([id, role, kind, sourceWords]) => ({ id, role, kind, sourceWords, words: countFor(kind, sourceWords) })),
    totalMainWords,
    ordinaryWordCount: [...introBlocks, ...mainBlocks].reduce((sum, block) => sum + block.text.split(/\s+/u).length, 0),
    quoteWordCount: quoteBlocks.reduce((sum, block) => sum + block.text.split(/\s+/u).length, 0),
    totalWordsIncludingTitle: totalMainWords + TITLE_WORDS,
    tokenPrefixes,
  };
}
