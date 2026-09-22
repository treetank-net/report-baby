import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const outputDir = await mkdtemp(join(tmpdir(), 'report-baby-cli-'));
const env = { ...process.env, REPORT_BABY_DATA: outputDir };

/**
 * @test-decision merge-transport
 * @test-action Merge overlapping public MCP/CLI scenarios into one transport contract and reuse a single child process per scenario batch.
 */
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

/**
 * @test-decision merge-transport
 * @test-action Execute compatible CLI requests in one child process; retain the individual assertions while avoiding repeated CLI startup costs.
 */
function runBatch(requests, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['cli-bundle.cjs', '--batch', ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
      : reject(new Error(`CLI batch failed (${code}): ${stderr || stdout}`)));
    child.stdin.end(JSON.stringify(requests.map((request) => request.tool === 'render_report'
      && request.args?.data && !request.args.data.flows
      ? { ...request, args: { ...request.args, data: legacyFixtureToCompositionInput(request.args.data) } }
      : request)));
  });
}

/**
 * @test-decision merge-transport
 * @test-action Merge overlapping public MCP/CLI scenarios into one transport contract and reuse a single child process per scenario batch.
 */
function compositionPlanForParity(result) {
  /**
   * @test-decision merge-transport
   * @test-action Merge overlapping public MCP/CLI scenarios into one transport contract and reuse a single child process per scenario batch.
   */
  const stripTiming = (value) => {
    if (Array.isArray(value)) return value.map(stripTiming);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !key.endsWith('Ms'))
      .map(([key, entry]) => [key, stripTiming(entry)]));
  };
  return stripTiming(result.compositionPlan);
}

try {
  const listed = await run(['--list']);
  assert.equal(listed.code, 0, listed.stderr);
  assert.match(listed.stdout, /render_report/);
  assert.match(listed.stdout, /render_slides_pptx/);
  assert.match(listed.stdout, /inspect_brand/);

  const outputPath = join(outputDir, 'cli-report.pdf');
  const planData = { title: 'Plan only', sections: [{ heading: 'Works', body: 'The layout plan resolves without producing a PDF.' }] };
  const [renderedResult, planResult, renderedParityResult, debugResult, warnedResult] = await runBatch([
    { tool: 'render_report', args: {
    template: 'default-report',
    output_path: outputPath,
    data: {
      title: 'CLI contract',
      kpis: [{ label: 'Ignored KPI', value: 1 }],
      charts: [{ type: 'bar', data: [{ label: 'Ignored chart', value: 1 }] }],
      sections: [{ heading: 'Works', body: 'The one-shot adapter rendered this report.' }],
    },
  } },
    { tool: 'render_report', args: { template: 'pages/editorial-two-column', dry_run: true, data: planData } },
    { tool: 'render_report', args: { template: 'pages/editorial-two-column', dry_run: true, diagnostics: 'full', data: planData } },
    { tool: 'render_report', args: { template: 'pages/editorial-two-column', dry_run: true, diagnostics: 'full', composition_debug: true, data: planData } },
    { tool: 'render_report', args: { template: 'pages/editorial-two-column', dry_run: true, data: { title: 'CLI warnings JSON', kpis: [{ label: 'Ignored KPI', value: 1 }] } } },
  ]);
  const rendered = { code: 0, stdout: renderedResult.path ?? '' };
  assert.equal(rendered.stdout, outputPath);
  assert.equal((await readFile(outputPath)).subarray(0, 5).toString(), '%PDF-');

  assert.equal(planResult.dryRun, true);
  assert.ok(Array.isArray(planResult.reportPlan?.pages));
  assert.ok(Array.isArray(planResult.compositionPlan?.flowPlacements));
  assert.ok(Array.isArray(planResult.compositionPlan?.lines));
  assert.ok(Array.isArray(planResult.compositionEvaluation?.passedMetrics), 'CLI report responses must expose passed composition metrics');
  assert.ok(Array.isArray(planResult.compositionEvaluation?.suggestions), 'CLI report responses must expose composition suggestions');
  assert.equal(typeof planResult.compositionEvaluation?.scoreBase, 'number', 'CLI reports must expose the configured score base');
  assert.ok(Array.isArray(planResult.compositionEvaluation?.placementScores), 'CLI reports must expose score contributions by material placement');
  assert.ok(Array.isArray(planResult.compositionEvaluation?.repairProposals), 'CLI reports must expose evaluator repair proposals');
  assert.ok(Array.isArray(planResult.compositionPlan?.trace?.candidateSearch?.rounds), 'CLI reports must expose the complete-plan candidate-search trace');
  assert.deepEqual(compositionPlanForParity(renderedParityResult), compositionPlanForParity(planResult), 'dry_run and render used different composition plans');
  assert.deepEqual(compositionPlanForParity(debugResult), compositionPlanForParity(planResult), 'debug overlay changed the composition plan');

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

  assert.match(JSON.stringify(warnedResult), /composition-planner/);
} finally {
  await rm(outputDir, { recursive: true, force: true });
}

console.log('CLI contract: all-tools listing and report render OK');
