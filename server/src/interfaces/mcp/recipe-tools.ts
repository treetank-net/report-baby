import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReportConfig } from '../../infrastructure/config.js';
import { readRenderConfig } from '../../template/builtins.js';
import { loadRecipe, RECIPE_CONCLUSIONS_MARKER, recipeUsesComparison } from '../../recipes/recipe.js';
import { COMPARISON_MODES, comparisonPeriod, localToday, PERIOD_PRESETS, presetPeriod, type ComparisonMode, type PeriodPreset, type RecipePeriod } from '../../recipes/period.js';
import { disarmRecipeRun, latestRecipeRunId, readRecipeRun, startRecipeRun, stepRecords, writeRecipeRun, type RecipeRun, type RunStep } from '../../recipes/run.js';
import { aggregateRecords, profileFields, sampleRecords, type InspectionLimits } from '../../recipes/inspection.js';
import { assembleRecipeRun } from '../../recipes/assembly.js';
import { FIELD_PROFILE_COLUMNS, fieldProfileRows, tsvTable } from './recipe-responses.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar date, YYYY-MM-DD');

const metricSchema = z.object({
  op: z.enum(['count', 'sum', 'avg', 'min', 'max', 'distinct']),
  field: z.string().optional().describe('Field to aggregate; optional only for count'),
});

const filterSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'in']),
  value: z.string().optional().describe('Comparison value; numeric strings compare numerically, ISO dates compare lexically'),
  values: z.array(z.string()).optional().describe('Values for op "in"'),
});

function recipeLimits() {
  return readRenderConfig().recipes;
}

function inspectionLimits(): InspectionLimits {
  return recipeLimits();
}

function jsonResult(value: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function resolveRunId(cfg: ReportConfig, runId: string | undefined): string {
  const resolved = runId ?? latestRecipeRunId(cfg.recipeRunsDir);
  if (!resolved) throw new Error('No recipe run exists yet. Call start_recipe_run first.');
  return resolved;
}

function stepSummary(step: RunStep) {
  return {
    step: step.id,
    pages: step.captures.length,
    records: step.captures.reduce((total, capture) => total + capture.records, 0),
    ...(step.captures[0]?.total_reported !== undefined ? { total_reported: step.captures[0].total_reported } : {}),
    ...(step.captures.at(-1)?.next_page ? { more_pages: step.captures.at(-1)?.next_page } : {}),
  };
}

function findStep(run: RecipeRun, stepId: string): RunStep {
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) throw new Error(`Run ${run.run_id} has no step '${stepId}'. Steps: ${run.steps.map((item) => item.id).join(', ')}.`);
  return step;
}

function periodLabel(run: RecipeRun): string {
  return `${run.period.start}..${run.period.end}${run.comparison ? ` vs ${run.comparison.start}..${run.comparison.end}` : ''}`;
}

function requestedPeriod(start: string | undefined, end: string | undefined, preset: PeriodPreset | undefined): RecipePeriod {
  if (preset && (start || end)) throw new Error('Pass either preset or start + end, not both.');
  if (preset) return presetPeriod(preset, localToday());
  if (!start || !end) throw new Error(`Pass start + end, or a preset: ${PERIOD_PRESETS.join(', ')}.`);
  return { start, end };
}

export function registerRecipeTools(server: McpServer, cfg: ReportConfig): void {
  server.tool(
    'start_recipe_run',
    'Arm a report recipe (saved with marketing-context save_recipe) for a period and get the exact tool calls to make. While armed, a Claude Code hook stores each matching result on disk and shows a short receipt instead of the data. Make every call with exactly these arguments (extra per-call arguments such as chatInsights are fine), then finish_recipe_run.',
    {
      recipe: z.string().describe('"<client_slug>/<name>", e.g. "acme/weekly_leads"'),
      preset: z.enum(PERIOD_PRESETS as [PeriodPreset, ...PeriodPreset[]]).optional().describe('Relative period from today; alternative to start + end'),
      start: isoDate.optional(),
      end: isoDate.optional(),
      compare: z.enum(COMPARISON_MODES as [ComparisonMode, ...ComparisonMode[]]).optional().describe('Comparison period for {{prev_*}} placeholders; defaults to previous_period when the recipe uses them'),
    },
    async ({ recipe: ref, preset, start, end, compare }) => {
      const loaded = loadRecipe(ref);
      const period = requestedPeriod(start, end, preset);
      const usesComparison = recipeUsesComparison(loaded.recipe);
      const comparisonMode = compare ?? (usesComparison ? 'previous_period' : undefined);
      const comparison = comparisonMode ? comparisonPeriod(period, comparisonMode) : undefined;
      const { run, replacedRunId } = startRecipeRun(cfg.recipeRunsDir, loaded, period, comparison, recipeLimits().runTtlHours);
      const warnings = compare && !usesComparison ? [`compare=${compare} has no effect: the recipe has no {{prev_*}} placeholder.`] : [];
      return jsonResult({
        run_id: run.run_id,
        period: run.period,
        ...(run.comparison ? { comparison: run.comparison } : {}),
        ...(replacedRunId ? { replaced_armed_run: replacedRunId } : {}),
        ...(warnings.length ? { warnings } : {}),
        calls: run.steps.map((step) => ({ step: step.id, tool: step.tool, args: step.args })),
        next: 'Make each call (independent calls in parallel); expect a "report-baby captured" receipt instead of data. No receipt means the hook is not active in this host and the data arrives as usual.',
      });
    },
  );

  server.tool(
    'inspect_recipe_run',
    'Look at captured recipe data without loading it: "overview" profiles each field per step (kind, min/max/sum, top values), "aggregate" groups and sums server-side, "sample" returns a few records. TSV output.',
    {
      run_id: z.string().optional().describe('Defaults to the armed run, else the most recent run'),
      view: z.enum(['overview', 'sample', 'aggregate']).default('overview'),
      step: z.string().optional().describe('Step id; required for sample and aggregate'),
      fields: z.array(z.string()).optional().describe('sample: fields to include'),
      rows: z.number().int().positive().optional().describe('sample: number of records'),
      group_by: z.array(z.string()).optional().describe('aggregate: fields to group by; empty for one total row'),
      metrics: z.array(metricSchema).optional().describe('aggregate: defaults to count'),
      filters: z.array(filterSchema).optional().describe('aggregate: all filters must match'),
      sort_by: z.string().optional().describe('aggregate: output column, e.g. "sum(clicks)"; prefix + for ascending (default descending)'),
      limit: z.number().int().positive().optional().describe('aggregate: maximum rows'),
    },
    async ({ run_id, view, step: stepId, fields, rows, group_by, metrics, filters, sort_by, limit }) => {
      const run = readRecipeRun(cfg.recipeRunsDir, resolveRunId(cfg, run_id));
      const limits = inspectionLimits();
      if (view === 'overview') {
        const steps = stepId ? [findStep(run, stepId)] : run.steps;
        const sections = steps.map((step) => {
          const summary = stepSummary(step);
          const profile = profileFields(stepRecords(cfg.recipeRunsDir, run, step), limits);
          const head = [
            [`step ${step.id}`, step.tool, `records=${summary.records}`, `pages=${summary.pages}`, ...(summary.total_reported !== undefined ? [`total_reported=${summary.total_reported}`] : []), ...(summary.more_pages ? [`more_pages=${Object.entries(summary.more_pages).map(([key, value]) => `${key}:${value}`).join(',')}`] : [])].join(' · '),
            ...(profile.omittedFields.length ? [`omitted_fields: ${profile.omittedFields.join(' ')}`] : []),
          ];
          return tsvTable(head, fieldProfileRows(profile.fields), FIELD_PROFILE_COLUMNS);
        });
        return textResult([`# recipe ${run.recipe} · run ${run.run_id} · ${periodLabel(run)} · ${run.status}`, ...sections].join('\n'));
      }
      if (!stepId) throw new Error(`view "${view}" needs a step. Steps: ${run.steps.map((item) => item.id).join(', ')}.`);
      const step = findStep(run, stepId);
      const records = stepRecords(cfg.recipeRunsDir, run, step);
      if (view === 'sample') {
        const sample = sampleRecords(records, fields, rows, limits);
        return textResult(tsvTable([`sample · step ${step.id} · ${periodLabel(run)} · rows=${sample.length} of ${records.length}`], sample, fields));
      }
      const result = aggregateRecords(records, { group_by: group_by ?? [], metrics: metrics ?? [], filters: filters ?? [], sort_by, limit }, limits);
      const showing = result.rows.length < result.groups ? ` · showing ${result.rows.length} of ${result.groups} groups` : '';
      return textResult(tsvTable([`aggregate · step ${step.id} · ${periodLabel(run)} · matched=${result.matched} of ${records.length}${showing}`], result.rows));
    },
  );

  server.tool(
    'finish_recipe_run',
    `Close a recipe run: write data.json and, with a template, report.html. Call again with conclusions_markdown to write conclusions.md and insert them at ${RECIPE_CONCLUSIONS_MARKER} (paragraphs, "- " bullets, "### " headings, **bold**); record them with marketing-context append_review summary_path.`,
    {
      run_id: z.string().optional().describe('Defaults to the armed run, else the most recent run'),
      conclusions_markdown: z.string().optional(),
    },
    async ({ run_id, conclusions_markdown }) => {
      const run = readRecipeRun(cfg.recipeRunsDir, resolveRunId(cfg, run_id));
      const loaded = loadRecipe(run.recipe);
      const assembled = assembleRecipeRun(cfg.recipeRunsDir, loaded, run, conclusions_markdown);
      run.status = 'finished';
      run.data_json = assembled.dataJson;
      if (assembled.reportHtml) run.report_html = assembled.reportHtml;
      writeRecipeRun(cfg.recipeRunsDir, run);
      disarmRecipeRun(cfg.recipeRunsDir, run.run_id);
      return jsonResult({
        run_id: run.run_id,
        recipe: run.recipe,
        period: run.period,
        ...(run.comparison ? { comparison: run.comparison } : {}),
        data_json: assembled.dataJson,
        ...(assembled.reportHtml ? { report_html: assembled.reportHtml } : {}),
        ...(assembled.conclusionsMd ? { conclusions_md: assembled.conclusionsMd } : {}),
        steps: run.steps.map(stepSummary),
        ...(assembled.missingSteps.length ? { missing_steps: assembled.missingSteps } : {}),
        ...(assembled.warnings.length ? { warnings: assembled.warnings } : {}),
        next: conclusions_markdown === undefined
          ? 'inspect_recipe_run (overview, then aggregate), then finish_recipe_run again with conclusions_markdown.'
          : 'marketing-context append_review with summary_path = conclusions_md; mark_task_run if a recurring task drove this run.',
      });
    },
  );
}
