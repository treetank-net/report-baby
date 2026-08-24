import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const root = resolve(new URL('..', import.meta.url).pathname);
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-markdown-normalizer-'));
const output = join(temporary, 'markdown-normalizer.cjs');

try {
  await build({ entryPoints: [join(root, 'src/markdown-normalizer.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: output });
  const bundled = await import(output);
  const normalizeMarkdown = bundled.normalizeMarkdown ?? bundled.default.normalizeMarkdown;
  const normalizedText = bundled.normalizedText ?? bundled.default.normalizedText;
  const document = normalizeMarkdown('Intro **strong** and *emphasis*.\n\n![Map](assets/map.png "Map caption")\n\n- one\n- two');
  assert.equal(document.source, 'commonmark');
  assert.equal(document.diagnostics.length, 0);
  assert.equal(document.nodes[0].type, 'paragraph');
  assert.equal(document.nodes[1].type, 'paragraph');
  assert.equal(document.nodes[1].children[0].type, 'image');
  assert.equal(document.nodes[1].children[0].caption, 'Map caption');
  assert.equal(document.nodes[2].type, 'list');
  assert.match(normalizedText(document), /Intro strong and emphasis/);
  const unsupported = normalizeMarkdown('<div>unsafe</div>\n\n---');
  assert.equal(unsupported.nodes.length, 0);
  assert.equal(unsupported.diagnostics.length, 2);
  console.log('markdown normalizer: CommonMark AST mapping and diagnostics passed');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
