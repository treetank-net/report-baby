import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-report-adapters-'));

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
      : reject(new Error(`${stderr || stdout || `CLI exited with code=${code} signal=${signal}`}`)));
    child.stdin.end(JSON.stringify(requests));
  });
}

const reportData = {
  title: 'Report adapters',
  intro: 'A report rendered through the canonical PDF path and adapted to PNG/PPTX.',
  sections: [{ heading: 'Long section', body: 'The adapter keeps the exact report layout while changing only the output container. '.repeat(180) }],
};

try {
  const outputDir = join(temporary, 'png');
  const pptxPath = join(temporary, 'report.pptx');
  const result = await runCli([
    { tool: 'render_report_png', args: { output_dir: outputDir, filename_prefix: 'page', data: reportData } },
    { tool: 'render_report_pptx', args: { output_path: pptxPath, data: reportData } },
  ]);
  const lines = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const pngResult = lines[0];
  const pptxResult = lines[1];
  assert.ok(Array.isArray(pngResult.paths) && pngResult.paths.length >= 1, JSON.stringify(pngResult));
  for (const path of pngResult.paths) {
    const png = await readFile(path);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
  assert.equal(pptxResult.path, pptxPath);
  const pptx = await readFile(pptxPath);
  assert.equal(pptx.subarray(0, 2).toString(), 'PK');
  const archive = unzipSync(new Uint8Array(pptx));
  const slideCount = Object.keys(archive).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
  assert.equal(slideCount, pngResult.pages);
  assert.ok(pptxResult.warnings?.some((warning) => /Report PPTX pages are rasterized/.test(warning.message)), JSON.stringify(pptxResult));
  console.log(`report adapters: ${pngResult.pages} PNG page(s) and matching PPTX slide(s) passed`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
