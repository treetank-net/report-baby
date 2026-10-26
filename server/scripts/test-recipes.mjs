import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const dataDir = await mkdtemp(join(tmpdir(), 'report-baby-recipes-'));
const contextDir = join(dataDir, 'marketing-context');
const env = { ...process.env, REPORT_BABY_DATA: dataDir, MARKETING_CONTEXT_DIR: contextDir };

function runNode(bundle, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle, ...args], { cwd: root, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

async function cli(tool, args) {
  const result = await runNode('cli-bundle.cjs', [tool, '--json'], JSON.stringify(args));
  assert.equal(result.code, 0, `${tool} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const sessionId = 'session-1';
const transcriptPath = join(dataDir, 'project', `${sessionId}.jsonl`);
const toolResultsDir = join(dataDir, 'project', sessionId, 'tool-results');

async function hook(toolName, toolInput, toolResponse) {
  const result = await runNode('recipe-hook-bundle.cjs', [], JSON.stringify({ hook_event_name: 'PostToolUse', session_id: sessionId, transcript_path: transcriptPath, tool_name: toolName, tool_input: toolInput, tool_response: toolResponse }));
  assert.equal(result.code, 0, `hook failed: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
}

async function cliText(tool, args) {
  return (await cli(tool, args)).content[0].text;
}

function tsvRows(text) {
  const lines = text.split('\n').filter((line) => !line.startsWith('#'));
  const [head, ...rows] = lines.map((line) => line.split('\t'));
  return rows.map((row) => Object.fromEntries(head.map((column, index) => [column, row[index]])));
}

function overviewSection(text, stepId) {
  const sections = text.split(/\n(?=# step )/);
  return tsvRows(sections.find((section) => section.startsWith(`# step ${stepId} `)));
}

const textBlocks = (text) => [{ type: 'text', text }];

try {
  const unarmed = await hook('mcp__claude_ai_HubSpot__search_crm_objects', {}, textBlocks('{}'));
  assert.equal(unarmed, undefined, 'without an armed run the hook must stay silent');

  const recipesDir = join(contextDir, 'clients', 'acme', 'recipes');
  await mkdir(recipesDir, { recursive: true });
  await writeFile(join(recipesDir, 'leads.template.html'), '<html><body><!--RECIPE_CONCLUSIONS--><!--RECIPE_DATA--></body></html>');
  await writeFile(join(recipesDir, 'leads.json'), JSON.stringify({
    schema_version: 1,
    name: 'leads',
    client_slug: 'acme',
    template_html: 'leads.template.html',
    steps: [
      {
        id: 'crm_contacts',
        tool: 'search_crm_objects',
        page_params: ['offset'],
        args: { objectType: 'CONTACT', filterGroups: [{ filters: [{ propertyName: 'createdate', operator: 'BETWEEN', value: '{{start_ms}}', highValue: '{{end_ms}}' }] }] },
      },
      { id: 'ads_by_country', tool: 'execute_gaql', args: { customer_id: '123', query: "SELECT segments.geo FROM campaign WHERE segments.date BETWEEN '{{start}}' AND '{{end}}'" } },
    ],
  }));
  await writeFile(join(recipesDir, 'compare.json'), JSON.stringify({
    schema_version: 1,
    name: 'compare',
    client_slug: 'acme',
    steps: [{ id: 'gaql', tool: 'execute_gaql', args: { query: "BETWEEN '{{start}}' AND '{{end}}' vs '{{prev_start}}' AND '{{prev_end}}'" } }],
  }));

  const bareName = await runNode('cli-bundle.cjs', ['start_recipe_run', '--json'], JSON.stringify({ recipe: 'leads', start: '2026-10-01', end: '2026-10-07' }));
  assert.notEqual(bareName.code, 0, 'recipes are addressed as client/name');

  const compared = await cli('start_recipe_run', { recipe: 'acme/compare', start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(compared.comparison, { start: '2026-08-01', end: '2026-08-31' }, 'whole months compare with the previous months by default');
  assert.equal(compared.calls[0].args.query, "BETWEEN '2026-09-01' AND '2026-09-30' vs '2026-08-01' AND '2026-08-31'");
  const yearly = await cli('start_recipe_run', { recipe: 'acme/compare', start: '2026-10-05', end: '2026-10-11', compare: 'previous_year' });
  assert.deepEqual(yearly.comparison, { start: '2025-10-05', end: '2025-10-11' });
  const preset = await cli('start_recipe_run', { recipe: 'acme/compare', preset: 'yesterday' });
  assert.equal(preset.period.start, preset.period.end);
  assert.equal(preset.comparison.end, preset.comparison.start, 'a one-day period compares with the day before');

  const started = await cli('start_recipe_run', { recipe: 'acme/leads', start: '2026-10-01', end: '2026-10-07', compare: 'previous_period' });
  assert.equal(started.replaced_armed_run, preset.run_id);
  assert.match(started.warnings[0], /compare=previous_period has no effect/);
  assert.equal(started.comparison.start, '2026-09-24');
  const crmArgs = started.calls[0].args;
  const gaqlArgs = started.calls[1].args;
  assert.equal(crmArgs.filterGroups[0].filters[0].value, String(Date.parse('2026-10-01T00:00:00.000Z')));
  assert.equal(crmArgs.filterGroups[0].filters[0].highValue, String(Date.parse('2026-10-07T23:59:59.999Z')));
  assert.match(gaqlArgs.query, /BETWEEN '2026-10-01' AND '2026-10-07'/);

  const unrelated = await hook('mcp__claude_ai_HubSpot__get_user_details', {}, textBlocks('{"userId":1}'));
  assert.equal(unrelated, undefined, 'tools outside the recipe must pass through');

  const mismatch = await hook('mcp__claude_ai_HubSpot__search_crm_objects', { ...crmArgs, objectType: 'DEAL' }, textBlocks('{"results":[]}'));
  assert.match(mismatch.additionalContext, /NOT captured.*objectType/s);
  assert.equal(mismatch.updatedToolOutput, undefined, 'a near miss must keep the original output');

  const page = (offset, stages) => textBlocks(JSON.stringify({
    results: stages.map((stage, index) => ({ id: offset + index, properties: { lifecyclestage: stage, amount: String(10 * (index + 1)), createdate: `2026-10-0${index + 1}T10:00:00Z` } })),
    total: 3,
    offset: offset + stages.length,
  }));
  const firstPage = await hook('mcp__claude_ai_HubSpot__search_crm_objects', { ...crmArgs, chatInsights: { userIntent: 'x' } }, page(0, ['lead', 'lead']));
  assert.match(firstPage.updatedToolOutput[0].text, /captured step 'crm_contacts'.*2 records.*offset=2/s);
  await mkdir(toolResultsDir, { recursive: true });
  const spilledFile = join(toolResultsDir, 'mcp-hubspot-1.txt');
  await writeFile(spilledFile, page(0, ['lead', 'lead'])[0].text);
  const spilledNotice = (path) => `Error: result (63,654 characters across 1 line) exceeds maximum allowed tokens. Output has been saved to ${path}.\nFormat: Plain text\n`;
  const outsideFile = join(dataDir, 'outside.txt');
  await writeFile(outsideFile, page(0, ['lead', 'lead', 'lead'])[0].text);
  const outside = await hook('mcp__claude_ai_HubSpot__search_crm_objects', crmArgs, spilledNotice(outsideFile));
  assert.match(outside.updatedToolOutput[0].text, /0 records/, 'a saved-output path outside the session tool-results dir is never read');
  const spilled = await hook('mcp__claude_ai_HubSpot__search_crm_objects', crmArgs, spilledNotice(spilledFile));
  assert.match(spilled.updatedToolOutput[0].text, /2 records.*offset=2/s, 'output Claude Code saved to a file is read from it');
  const secondPage = await hook('mcp__claude_ai_HubSpot__search_crm_objects', { ...crmArgs, offset: 2 }, page(2, ['customer']));
  assert.doesNotMatch(secondPage.updatedToolOutput[0].text, /More pages exist/);
  const repeatedPage = await hook('mcp__claude_ai_HubSpot__search_crm_objects', { ...crmArgs, offset: 2 }, page(2, ['customer']));
  assert.ok(repeatedPage.updatedToolOutput, 'a repeated page replaces the earlier capture');

  const tsv = ['# gaql · customer 123 · currency=PLN · rows=3', '# campaign=Brand', 'geo\tclicks\tconversions', 'PL\t100\t5', 'DE\t50\t2', 'PL\t20\t1'].join('\n');
  const gaql = await hook('mcp__plugin_google-ads-baby_google-ads__execute_gaql', gaqlArgs, textBlocks(tsv));
  assert.match(gaql.updatedToolOutput[0].text, /3 records.*All steps captured/s);

  const overview = await cliText('inspect_recipe_run', { view: 'overview' });
  assert.match(overview, /^# recipe acme\/leads · run /);
  assert.match(overview, /# step crm_contacts · search_crm_objects · records=3 · pages=2 · total_reported=3/, 'pages are concatenated and a repeated page is not double counted');
  const crm = overviewSection(overview, 'crm_contacts');
  const stage = crm.find((field) => field.field === 'lifecyclestage');
  assert.equal(stage.kind, 'text');
  assert.equal(stage.top, 'lead:2 ~ customer:1');
  const amount = crm.find((field) => field.field === 'amount');
  assert.deepEqual({ kind: amount.kind, sum: amount.sum, min: amount.min, max: amount.max }, { kind: 'number', sum: '40', min: '10', max: '20' });
  assert.equal(crm.find((field) => field.field === 'createdate').kind, 'date');
  const id = crm.find((field) => field.field === 'id');
  assert.deepEqual({ kind: id.kind, distinct: id.distinct, sum: id.sum, top: id.top }, { kind: 'identifier', distinct: '3', sum: '', top: '' }, 'identifiers are counted, never summed or listed');

  const ads = overviewSection(overview, 'ads_by_country');
  assert.match(ads.find((field) => field.field === 'campaign').top, /^Brand:3/, 'hoisted TSV constants become record fields');

  const aggregate = await cliText('inspect_recipe_run', {
    view: 'aggregate',
    step: 'ads_by_country',
    group_by: ['geo'],
    metrics: [{ op: 'sum', field: 'clicks' }, { op: 'sum', field: 'conversions' }],
    filters: [{ field: 'clicks', op: 'gte', value: '20' }],
  });
  assert.match(aggregate, /^# aggregate · step ads_by_country · 2026-10-01\.\.2026-10-07 vs 2026-09-24\.\.2026-09-30 · matched=3 of 3\n/);
  assert.deepEqual(tsvRows(aggregate), [{ geo: 'PL', 'sum(clicks)': '120', 'sum(conversions)': '6' }, { geo: 'DE', 'sum(clicks)': '50', 'sum(conversions)': '2' }]);

  const sample = await cliText('inspect_recipe_run', { view: 'sample', step: 'crm_contacts', fields: ['lifecyclestage'], rows: 1 });
  assert.deepEqual(tsvRows(sample), [{ lifecyclestage: 'lead' }]);

  const finished = await cli('finish_recipe_run', {});
  assert.equal(finished.missing_steps, undefined);
  const data = JSON.parse(await readFile(finished.data_json, 'utf8'));
  assert.deepEqual(Object.keys(data.steps), ['crm_contacts', 'ads_by_country']);
  assert.deepEqual(data.period, { start: '2026-10-01', end: '2026-10-07' });
  assert.deepEqual(data.totals, { crm_contacts: 3 }, 'source-reported totals reach the template without paging');
  assert.equal(finished.conclusions_md, undefined);
  assert.match(finished.next, /conclusions_markdown/);

  const afterFinish = await hook('mcp__claude_ai_HubSpot__search_crm_objects', crmArgs, page(0, ['lead']));
  assert.equal(afterFinish, undefined, 'finishing disarms the run');

  const withConclusions = await cli('finish_recipe_run', { run_id: started.run_id, conclusions_markdown: '- **PL** leads </script>' });
  const html = await readFile(withConclusions.report_html, 'utf8');
  assert.match(html, /<ul>\n<li><strong>PL<\/strong> leads &lt;\/script&gt;<\/li>\n<\/ul>/);
  assert.match(html, /window\.RECIPE_DATA = \{"recipe":"acme\/leads"/);
  assert.equal(await readFile(withConclusions.conclusions_md, 'utf8'), '- **PL** leads </script>\n');
  assert.match(withConclusions.next, /append_review with summary_path/);
  assert.doesNotMatch(html, /<!--RECIPE_DATA-->|<!--RECIPE_CONCLUSIONS-->/);

  console.log('recipes: load from marketing-context, presets + comparison, arm, capture (JSON pages + TSV), inspect, finish and template injection hold');
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
