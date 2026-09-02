import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-cli-'));
const env = { ...process.env, REPORT_BABY_DATA: outputDir };

function run(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    if (input && args.includes('render_report')) {
      const request = JSON.parse(input);
      if (request.data && !request.data.flows) request.data = legacyFixtureToCompositionInput(request.data);
      child.stdin.end(JSON.stringify(request));
    } else if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

try {
  const listed = await run(['--list']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /render_report/);
  assert.match(listed.stdout, /render_slides_pptx/);
  assert.match(listed.stdout, /inspect_brand/);

  const outputPath = join(outputDir, 'cli-report.pdf');
  const rendered = await run(['render_report'], JSON.stringify({
    template: 'default-report',
    output_path: outputPath,
    data: { title: 'CLI contract', sections: [{ heading: 'Works', body: 'The one-shot adapter rendered this report.' }] },
  }));
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.equal(rendered.stdout.trim(), outputPath);
  assert.equal((await readFile(outputPath)).subarray(0, 5).toString(), '%PDF-');

  const planOnly = await run(['render_report'], JSON.stringify({
    template: 'pages/editorial-two-column',
    dry_run: true,
    data: { title: 'Plan only', sections: [{ heading: 'Works', body: 'The layout plan resolves without producing a PDF.' }] },
  }));
  assert.equal(planOnly.code, 0, planOnly.stderr);
  const planResult = JSON.parse(planOnly.stdout);
  assert.equal(planResult.dryRun, true);
  assert.ok(Array.isArray(planResult.reportPlan?.pages));
  assert.ok(Array.isArray(planResult.compositionPlan?.flowPlacements));
  assert.ok(Array.isArray(planResult.compositionPlan?.lines));

  const parityPath = join(outputDir, 'plan-parity-report.pdf');
  const renderedForParity = await run(['--json', 'render_report'], JSON.stringify({
    template: 'pages/editorial-two-column',
    output_path: parityPath,
    diagnostics: 'full',
    data: { title: 'Plan only', sections: [{ heading: 'Works', body: 'The layout plan resolves without producing a PDF.' }] },
  }));
  assert.equal(renderedForParity.code, 0, renderedForParity.stderr);
  const renderedParityResult = JSON.parse(renderedForParity.stdout);
  assert.deepEqual(renderedParityResult.compositionPlan, planResult.compositionPlan, 'dry_run and render used different composition plans');

  const debugPath = join(outputDir, 'plan-parity-debug-report.pdf');
  const renderedWithDebug = await run(['--json', 'render_report'], JSON.stringify({
    template: 'pages/editorial-two-column',
    output_path: debugPath,
    diagnostics: 'full',
    composition_debug: true,
    data: { title: 'Plan only', sections: [{ heading: 'Works', body: 'The layout plan resolves without producing a PDF.' }] },
  }));
  assert.equal(renderedWithDebug.code, 0, renderedWithDebug.stderr);
  const debugResult = JSON.parse(renderedWithDebug.stdout);
  assert.deepEqual(debugResult.compositionPlan, planResult.compositionPlan, 'debug overlay changed the composition plan');

  const brandedPath = join(outputDir, 'branded-report.pdf');
  const branded = await run([
    '--brand-url', join(root, '..'),
    '--brand-path', 'examples/brand-showcase/brands',
    'render_report',
  ], JSON.stringify({
    template: 'default-report',
    brand_ref: 'brand://flux/primary',
    output_path: brandedPath,
    data: { title: 'Fetched brand', sections: [{ heading: 'Works', body: 'The shared source resolver resolved the brand.' }] },
  }));
  assert.equal(branded.code, 0, branded.stderr);
  assert.equal(branded.stdout.trim(), brandedPath);
  assert.equal((await readFile(brandedPath)).subarray(0, 5).toString(), '%PDF-');

  const warningPath = join(outputDir, 'warning-report.pdf');
  const warned = await run(['render_report'], JSON.stringify({
    template: 'pages/editorial-two-column',
    output_path: warningPath,
    data: {
      title: 'CLI warnings',
      kpis: [{ label: 'Ignored KPI', value: 1 }],
      charts: [{ type: 'bar', data: [{ label: 'Ignored chart', value: 1 }] }],
      sections: [{ heading: 'Works', body: 'The report still renders.' }],
    },
  }));
  assert.equal(warned.code, 0, warned.stderr);
  assert.equal(warned.stdout.trim(), warningPath);
  assert.equal(warned.stderr, '');

  const jsonWarned = await run(['--json', 'render_report'], JSON.stringify({
    template: 'pages/editorial-two-column',
    output_path: join(outputDir, 'warning-report-json.pdf'),
    data: { title: 'CLI warnings JSON', kpis: [{ label: 'Ignored KPI', value: 1 }] },
  }));
  assert.equal(jsonWarned.code, 0, jsonWarned.stderr);
  assert.equal(jsonWarned.stderr, '');
  assert.match(jsonWarned.stdout, /composition-planner/);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log('CLI contract: all-tools listing and report render OK');
