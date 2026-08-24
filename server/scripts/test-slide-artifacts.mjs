import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { parse } from 'yaml';
import { childProcessFailure } from './lib/process.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-slide-artifacts-'));
const renderConfig = parse(await readFile(join(root, 'templates', 'render-config.yml'), 'utf8'));
const canvas = renderConfig.canvas;

function runCli(requests) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch'], {
      cwd: root,
      env: { ...process.env, REPORT_BABY_DATA: temporary },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => code === 0
      ? resolvePromise({ stdout, stderr })
      : reject(new Error(childProcessFailure('slide-artifact CLI', { status: code, signal, stdout, stderr }))));
    child.stdin.end(JSON.stringify(requests));
  });
}

const deck = {
  title: 'Selectable slide deck',
  brand: 'TreeTank',
  slides: [
    { type: 'title', title: 'Selectable title', subtitle: 'Text survives PDF rendering' },
    { type: 'narrative', title: 'Narrative slide', body: 'This body remains selectable in the PDF.', highlights: ['LLM visual check'] },
  ],
};

try {
  const pdfPath = join(temporary, 'slides.pdf');
  const pptxPath = join(temporary, 'slides.pptx');
  const result = await runCli([
    { tool: 'render_slides_pdf', args: { output_path: pdfPath, data: deck } },
    { tool: 'render_slides_png', args: { output_dir: temporary, filename_prefix: 'slide', data: deck } },
    { tool: 'render_slides_png', args: { output_dir: temporary, filename_prefix: 'selected', slide_index: 1, data: deck } },
    { tool: 'render_slides_pptx', args: { output_path: pptxPath, data: deck } },
  ]);
  const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const pdf = await readFile(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const extracted = await execFileAsync('pdftotext', [pdfPath, '-']);
  assert.match(extracted.stdout, /Selectable title/);
  assert.match(extracted.stdout, /This body remains selectable/);

  const pngPaths = lines[1].paths;
  assert.equal(pngPaths.length, deck.slides.length);
  const independentDirectory = join(temporary, 'independent');
  await mkdir(independentDirectory);
  await execFileAsync('pdftoppm', ['-png', '-scale-to-x', String(canvas.width), '-scale-to-y', String(canvas.height), pdfPath, join(independentDirectory, 'page')]);
  const independentPaths = (await readdir(independentDirectory)).filter((name) => name.endsWith('.png')).sort().map((name) => join(independentDirectory, name));
  assert.equal(independentPaths.length, deck.slides.length);
  for (const [index, path] of pngPaths.entries()) {
    const png = await readFile(path);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), canvas.width);
    assert.equal(png.readUInt32BE(20), canvas.height);
    assert.deepEqual(png, await readFile(independentPaths[index]), `PNG page ${index + 1} is not derived 1:1 from the canonical PDF`);
  }
  const selectedPath = lines[2].paths[0];
  assert.equal(selectedPath, join(temporary, 'selected-02.png'));
  assert.deepEqual(await readFile(selectedPath), await readFile(independentPaths[1]), 'selected slide PNG differs from the corresponding canonical PDF page');

  const archive = unzipSync(new Uint8Array(await readFile(pptxPath)));
  const slideXml = Buffer.from(archive['ppt/slides/slide2.xml']).toString();
  assert.match(slideXml, /This body remains selectable/);
  console.log(`slide artifacts: selectable PDF text, ${pngPaths.length} PDF-derived PNG page(s), and editable PPTX text passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
