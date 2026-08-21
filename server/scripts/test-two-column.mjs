import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'report-baby-two-column-'));
try {
  const input = join(temp, 'deck.json');
  const output = join(temp, 'out');
  await writeFile(input, JSON.stringify({
    brand: 'Two-column fixture',
    footer: 'External fallback fixture',
    slides: [{
      type: 'columns',
      template_ref: 'slides/two-column',
      title: 'One decision, two perspectives',
      subtitle: 'A slide-only layout owned by an external template file.',
      columns: [
        { heading: 'Signal', body: 'The first column carries the evidence and its short explanation.', highlights: ['One source of truth'] },
        { heading: 'Action', body: 'The second column carries the response, owner and next step.', highlights: ['One clear decision'] },
      ],
    }],
  }, null, 2));
  const result = spawnSync(process.execPath, ['example-bundle.cjs', '--kind', 'deck', '--brand-root', '../examples/brand-showcase/brands', '--brand', 'brand://orbit/primary', '--input', input, '--out', output, '--formats', 'pdf,png,pptx'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal((await readFile(join(output, 'slides.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await readFile(join(output, 'slides.pptx'))).subarray(0, 2).toString(), 'PK');
  assert.equal((await readFile(join(output, 'png', 'slide-01.png'))).readUInt32BE(16), 1600);
  console.log('two-column fixture: external slide fallback renders to PDF/PNG/PPTX');
} finally {
  await rm(temp, { recursive: true, force: true });
}
