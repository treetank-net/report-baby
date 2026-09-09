import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-structure-scoring-'));
const bundlePath = join(temporary, 'composition.cjs');

try {
  await build({
    entryPoints: [join(root, 'src/composition/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundlePath,
  });
  const bundled = await import(bundlePath);
  const composition = bundled.default ?? bundled;
  const { scoreListContinuity, scoreTableContinuity, scoreTinyFragments } = composition;
  const line = (blockId, page, slotId, startWord = 0, endWord = 1, routeIndex = 0) => ({
    blockId,
    flowId: 'main',
    slotId,
    page,
    text: blockId,
    box: { x: 10, y: 10, width: 80, height: 5 },
    routeIndex,
    naturalWidth: 20,
    startWord,
    endWord,
  });
  const document = {
    flows: {
      main: {
        id: 'main',
        continuation: 'allowed',
        blocks: [
          { id: 'list-1', kind: 'list-item', role: 'body', text: 'first' },
          { id: 'list-2', kind: 'list-item', role: 'body', text: 'second' },
          { id: 'paragraph', kind: 'paragraph', role: 'body', text: 'paragraph' },
          { id: 'table-1', kind: 'table', role: 'table', table: { head: ['A'], body: [['one'], ['two'], ['three']] } },
        ],
      },
    },
  };
  const basePlan = { pages: [], slots: [], placements: [], blockPlacements: [], tablePlacements: [], graphicPlacements: [], lines: [], insertionLines: [], decisions: [], diagnostics: [], residualContent: [] };

  const listSplit = scoreListContinuity(document, {
    ...basePlan,
    lines: [line('list-1', 1, 'text-1'), line('list-2', 2, 'text-2')],
  });
  assert.equal(listSplit.code, 'list-continuity');
  assert.equal(listSplit.value, 1, 'a list crossing a page must expose one continuity event');
  assert.ok(listSplit.points < 0, 'list continuity events must be soft penalties');

  const listItemSplit = scoreListContinuity(document, {
    ...basePlan,
    lines: [line('list-1', 1, 'text-1'), line('list-1', 2, 'text-2'), line('list-2', 2, 'text-2')],
  });
  assert.equal(listItemSplit.details.itemFragmentations, 1, 'a list item crossing pages must be identified separately');

  const tableSplit = scoreTableContinuity(document, {
    ...basePlan,
    tablePlacements: [
      { id: 'table:1', blockId: 'table-1', slotId: 'table-1', page: 1, box: { x: 10, y: 10, width: 80, height: 20 }, startRow: 0, endRow: 2, repeatsHeader: false },
      { id: 'table:2', blockId: 'table-1', slotId: 'table-2', page: 2, box: { x: 10, y: 10, width: 80, height: 12 }, startRow: 2, endRow: 3, repeatsHeader: true },
    ],
  });
  assert.equal(tableSplit.code, 'table-continuity');
  assert.equal(tableSplit.details.fragments, 1);
  assert.equal(tableSplit.details.pageSplits, 1);
  assert.equal(tableSplit.details.widowFragments, 1, 'a repeated header with one row must be a widow warning');
  assert.ok(tableSplit.points < 0);

  const tiny = scoreTinyFragments(document, {
    ...basePlan,
    lines: [line('paragraph', 1, 'text-1'), line('paragraph', 2, 'text-2'), line('list-1', 2, 'text-2')],
  });
  assert.equal(tiny.code, 'tiny-fragments');
  assert.equal(tiny.value, 2, 'one-line first and last fragments must both be reported');
  assert.ok(tiny.points < 0);

  const clean = scoreListContinuity(document, { ...basePlan, lines: [line('list-1', 1, 'text-1'), line('list-2', 1, 'text-1')] });
  assert.equal(clean.value, 0, 'a list staying in one fragmentainer must not be penalized');
  console.log(JSON.stringify({ status: 'passed', listSplit: listSplit.value, tableSplit: tableSplit.value, tinyFragments: tiny.value }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
