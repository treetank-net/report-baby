#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-drafts-'));
try {
  const bundle = join(temporary, 'composition.cjs');
  await build({ entryPoints: ['src/composition/index.ts'], bundle: true, platform: 'node', target: 'node18', format: 'cjs', outfile: bundle });
  const composition = await import(bundle);
  const { createCompositionDraft, updateCompositionDraft, selectCompositionDraftCandidate, assertCompositionDraftRenderable } = composition.default ?? composition;
  const input = { flows: { main: { blocks: [{ type: 'text', id: 'body', text: 'Draft body' }] } } };
  const plan = { pages: [], slots: [], placements: [], blockPlacements: [], tablePlacements: [], graphicPlacements: [], lines: [], decisions: [], diagnostics: [], residualContent: [] };
  const evaluation = { status: 'accepted', diagnostics: [], hardViolations: [], score: 100, scoreBreakdown: [], residualContent: [] };
  const sources = { brandFingerprint: 'brand-a', templateFingerprint: 'template-a', renderConfigFingerprint: 'config-a' };
  const draft = createCompositionDraft('draft-1', input, sources, { candidates: [{ signature: 'seed', plan, evaluation }] });
  assert.equal(draft.revision, 1);
  const selected = selectCompositionDraftCandidate(draft, 1, 'seed');
  assert.deepEqual(assertCompositionDraftRenderable(selected, sources), plan);
  assert.throws(() => selectCompositionDraftCandidate(draft, 2, 'seed'), /newer than expected/u);
  const edited = updateCompositionDraft(selected, 1, { input: { flows: { main: { blocks: [{ type: 'text', id: 'body', text: 'Edited body' }] } } } }, sources);
  assert.equal(edited.revision, 2);
  assert.equal(edited.candidates.length, 0);
  assert.throws(() => assertCompositionDraftRenderable(edited, sources), /no selected accepted candidate/u);
  console.log(JSON.stringify({ status: 'passed', revision: edited.revision, invalidatedCandidates: edited.candidates.length }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
