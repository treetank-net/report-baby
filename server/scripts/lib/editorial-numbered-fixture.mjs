import { createDeterministicLorem, loremHeading, loremParagraph } from './deterministic-lorem.mjs';

/**
 * Large editorial-flow fixture.
 *
 * The shape mirrors the source article's semantic sequence: introductory
 * paragraphs, seven headings, body paragraphs, and four authored quotes. The
 * counts are source word counts. The opening section is expanded enough to
 * span the first page in natural Lorem Ipsum; later paragraphs retain a lower
 * expansion so the fixture covers several continuation pages without markers.
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
const INTRO_SCALE = 1.4;
const BODY_SCALE = 2.2;
const OPENING_SECTION_SCALE = 5;
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep deterministic fixture construction here; merge repeated scenario data while preserving the input contract.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep deterministic fixture construction here; merge repeated scenario data while preserving the input contract.
 */
function editorialParagraphText(count, lorem) {
  return loremParagraph(lorem, count);
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep deterministic fixture construction here; merge repeated scenario data while preserving the input contract.
 */
function countFor(id, role, kind, sourceWords, introScale = INTRO_SCALE) {
  if (kind !== 'paragraph') return sourceWords;
  const scale = role === 'intro'
    ? introScale
    : id.startsWith('body-market-') ? OPENING_SECTION_SCALE : BODY_SCALE;
  return Math.ceil(sourceWords * scale);
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep deterministic fixture construction here; merge repeated scenario data while preserving the input contract.
 */
export function createEditorialNumberedFixture({ quoteMarkGap, quoteMarkOffsetX, quoteMarkOffsetY, quoteMarkCloseOffsetY, illustration, introScale = INTRO_SCALE }) {
  const lorem = createDeterministicLorem();
  const blocks = SOURCE_SHAPE.map(([id, role, kind, sourceWords]) => ({
    id,
    type: kind === 'heading' ? 'heading' : 'text',
    role,
    ...(kind === 'heading' ? { level: 1, keep_with_next_lines: 3 } : {}),
    text: kind === 'heading'
      ? loremHeading(lorem, countFor(id, role, kind, sourceWords))
      : editorialParagraphText(countFor(id, role, kind, sourceWords, introScale), lorem),
  }));
  const totalMainWords = blocks.reduce((sum, block) => sum + block.text.trim().split(/\s+/u).filter(Boolean).length, 0);
  const title = loremHeading(lorem, TITLE_WORDS);
  const introBlocks = blocks.filter((block) => block.role === 'intro');
  const quoteBlocks = blocks.filter((block) => block.role === 'quote');
  const mainBlocks = blocks.filter((block) => block.role !== 'intro' && block.role !== 'quote');
  const introDocumentBlocks = illustration
    ? [introBlocks[0], {
      id: illustration.blockId,
      type: 'image',
      role: 'intro',
      atomic: true,
      asset_id: illustration.assetId,
      src: illustration.asset.source,
      alt: illustration.asset.alt,
      width: illustration.width,
      fit: 'contain',
      keep_with_caption: false,
    }, ...introBlocks.slice(1)]
    : introBlocks;
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
      offset_y: quoteMarkCloseOffsetY,
      clamp_to_target: false,
    },
  ]);
  return {
    input: {
      flows: {
        intro: { continuation: 'forbidden', blocks: introDocumentBlocks },
        main: { continuation: 'allowed', blocks: mainBlocks },
        quotes: { continuation: 'allowed', blocks: quoteBlocks },
        header: {
          continuation: 'forbidden',
          blocks: [
            { id: 'header-title', type: 'heading', role: 'header', text: 'Editorial flow quality fixture' },
            { id: 'header-meta', type: 'text', role: 'header', text: 'Layout integrity test' },
          ],
        },
        footer: {
          continuation: 'forbidden',
          blocks: [{ id: 'footer', type: 'text', role: 'footer', text: 'Editorial quality fixture' }],
        },
      },
      ...(illustration ? { assets: [illustration.asset] } : {}),
      glyphs,
    },
    title,
    sourceShape: SOURCE_SHAPE.map(([id, role, kind, sourceWords]) => ({ id, role, kind, sourceWords, words: countFor(id, role, kind, sourceWords, introScale) })),
    totalMainWords,
    ordinaryWordCount: [...introBlocks, ...mainBlocks].reduce((sum, block) => sum + block.text.split(/\s+/u).length, 0),
    quoteWordCount: quoteBlocks.reduce((sum, block) => sum + block.text.split(/\s+/u).length, 0),
    totalWordsIncludingTitle: totalMainWords + TITLE_WORDS,
    illustration: illustration ? {
      blockId: illustration.blockId,
      assetId: illustration.assetId,
      width: illustration.width,
      sourceWidthPx: illustration.sourceWidthPx,
      sourceHeightPx: illustration.sourceHeightPx,
    } : undefined,
  };
}
