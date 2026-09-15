#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const temporary = await mkdtemp(join(tmpdir(), 'report-baby-document-layout-'));
const schemaBundle = join(temporary, 'schema.cjs');
const layoutBundle = join(temporary, 'document-layout.cjs');

await build({
  entryPoints: ['src/contracts/input/schema.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: schemaBundle,
});
await build({
  entryPoints: ['src/composition/adapters/document-layout.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: layoutBundle,
});

try {
  const { layoutEntrySchema } = await import(schemaBundle);
  const { documentLayoutVariantsWithinPageLimit, normalizeDocumentLayout, pageTemplateAssignmentForPage } = await import(layoutBundle);

  assert.equal(layoutEntrySchema.safeParse({ pages: { from: 1, to: 2 }, template: 'cover' }).success, true);
  assert.equal(layoutEntrySchema.safeParse({ pages: { count: { min: 3, max: 2 } }, template: 'body' }).success, false);
  assert.equal(layoutEntrySchema.safeParse({ pages: { from: 1 }, template: 'cover' }).success, false);
  assert.equal(layoutEntrySchema.safeParse({ pages: { from: 1, to: 2, count: 2 }, template: 'cover' }).success, false);

  const variants = normalizeDocumentLayout([
    { pages: { count: { min: 2, max: 3 } }, template: 'body' },
    { pages: { from: 3, to: 4 }, template: 'final' },
  ]);
  assert.equal(variants.length, 1, 'only the count branch that joins the following exact range should survive');
  assert.deepEqual(variants[0].entries, [
    { from: 1, to: 2, templateRef: 'body' },
    { from: 3, to: 4, templateRef: 'final' },
  ]);
  assert.deepEqual(pageTemplateAssignmentForPage(variants[0].entries, 3), {
    from: 3,
    to: 4,
    templateRef: 'final',
  });

  const remaining = normalizeDocumentLayout([
    { pages: { count: 1 }, template: 'cover' },
    { pages: 'remaining', template: 'body' },
  ]);
  assert.equal(remaining[0].entries.at(-1)?.to, undefined);
  assert.throws(() => normalizeDocumentLayout([
    { pages: 'remaining', template: 'body' },
    { pages: { count: 1 }, template: 'never' },
  ]), /No contiguous document layout variant/);
  const bounded = documentLayoutVariantsWithinPageLimit(normalizeDocumentLayout([
    { pages: { count: { min: 2, max: 4 } }, template: 'body' },
  ]), 3);
  assert.deepEqual(bounded.map((variant) => variant.maxPages), [2, 3], 'page-limit filtering must retain legal shorter count branches');
  assert.throws(() => documentLayoutVariantsWithinPageLimit(normalizeDocumentLayout([
    { pages: { count: 4 }, template: 'body' },
  ]), 3), /No document layout variant fits/);
  console.log('document layout: canonical schema and contiguous normalization passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
