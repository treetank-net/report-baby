import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { LoadedRecipe, RecipeArgs } from './recipe.js';
import { assertValidPeriod, substitutePeriods, type RecipePeriod } from './period.js';
import { extractRecords, responseTexts, type FlatRecord } from './records.js';

export interface CaptureRef {
  file: string;
  captured_at: string;
  records: number;
  page_args: RecipeArgs;
  total_reported?: number;
  next_page?: Record<string, string>;
}

export interface RunStep {
  id: string;
  tool: string;
  args: RecipeArgs;
  page_params: string[];
  description?: string;
  captures: CaptureRef[];
}

export interface RecipeRun {
  run_id: string;
  recipe: string;
  period: RecipePeriod;
  comparison?: RecipePeriod;
  created_at: string;
  expires_at: string;
  status: 'capturing' | 'finished';
  steps: RunStep[];
  data_json?: string;
  report_html?: string;
}

interface ActiveRunPointer {
  run_id: string;
  expires_at: string;
}

export interface CapturedToolCall {
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
}

export type CaptureOutcome =
  | { kind: 'not-armed' }
  | { kind: 'unrelated' }
  | { kind: 'arguments-differ'; run: RecipeRun; step: RunStep; differingKeys: string[] }
  | { kind: 'captured'; run: RecipeRun; step: RunStep; capture: CaptureRef };

function runDir(runsDir: string, runId: string): string {
  return join(runsDir, runId);
}

function runFile(runsDir: string, runId: string): string {
  return join(runDir(runsDir, runId), 'run.json');
}

function activePointerFile(runsDir: string): string {
  return join(runsDir, 'active.json');
}

function writeJsonAtomically(path: string, value: unknown): void {
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(staging, path);
}

function newRunId(recipe: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${stamp}-${recipe}-${randomUUID().slice(0, 4)}`;
}

export function startRecipeRun(runsDir: string, loaded: LoadedRecipe, period: RecipePeriod, comparison: RecipePeriod | undefined, ttlHours: number): { run: RecipeRun; replacedRunId?: string } {
  assertValidPeriod(period);
  if (comparison) assertValidPeriod(comparison);
  const { recipe } = loaded;
  const now = new Date();
  const run: RecipeRun = {
    run_id: newRunId(`${recipe.client_slug}-${recipe.name}`),
    recipe: loaded.ref,
    period,
    ...(comparison ? { comparison } : {}),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlHours * 3_600_000).toISOString(),
    status: 'capturing',
    steps: recipe.steps.map((step) => ({
      id: step.id,
      tool: step.tool,
      args: substitutePeriods(step.args, period, comparison) as RecipeArgs,
      page_params: step.page_params ?? [],
      ...(step.description ? { description: step.description } : {}),
      captures: [],
    })),
  };
  mkdirSync(runDir(runsDir, run.run_id), { recursive: true });
  const replaced = readActivePointer(runsDir);
  writeJsonAtomically(runFile(runsDir, run.run_id), run);
  writeJsonAtomically(activePointerFile(runsDir), { run_id: run.run_id, expires_at: run.expires_at } satisfies ActiveRunPointer);
  return { run, ...(replaced && replaced.run_id !== run.run_id ? { replacedRunId: replaced.run_id } : {}) };
}

function readActivePointer(runsDir: string): ActiveRunPointer | undefined {
  const path = activePointerFile(runsDir);
  if (!existsSync(path)) return undefined;
  const pointer = JSON.parse(readFileSync(path, 'utf8')) as ActiveRunPointer;
  return Date.parse(pointer.expires_at) > Date.now() ? pointer : undefined;
}

export function readRecipeRun(runsDir: string, runId: string): RecipeRun {
  const path = runFile(runsDir, runId);
  if (!existsSync(path)) throw new Error(`Recipe run '${runId}' does not exist in ${runsDir}.`);
  return JSON.parse(readFileSync(path, 'utf8')) as RecipeRun;
}

export function writeRecipeRun(runsDir: string, run: RecipeRun): void {
  writeJsonAtomically(runFile(runsDir, run.run_id), run);
}

export function latestRecipeRunId(runsDir: string): string | undefined {
  const active = readActivePointer(runsDir);
  if (active) return active.run_id;
  if (!existsSync(runsDir)) return undefined;
  return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().pop();
}

export function disarmRecipeRun(runsDir: string, runId: string): void {
  const pointer = activePointerFile(runsDir);
  if (!existsSync(pointer)) return;
  const current = JSON.parse(readFileSync(pointer, 'utf8')) as ActiveRunPointer;
  if (current.run_id === runId) rmSync(pointer, { force: true });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function toolNameMatchesStep(toolName: string, stepTool: string): boolean {
  return toolName === stepTool || toolName.endsWith(`__${stepTool}`);
}

export function differingStepArguments(step: RunStep, toolInput: unknown): string[] {
  const input = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput as Record<string, unknown> : {};
  return Object.keys(step.args)
    .filter((key) => !step.page_params.includes(key))
    .filter((key) => canonicalJson(step.args[key]) !== canonicalJson(input[key]));
}

function pageArguments(step: RunStep, toolInput: unknown): RecipeArgs {
  const input = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? toolInput as Record<string, unknown> : {};
  return Object.fromEntries(step.page_params.filter((key) => key in input).map((key) => [key, input[key] as RecipeArgs[string]]));
}

const SPILLED_OUTPUT = /^Error: result \(.*?\) exceeds maximum allowed tokens\. Output has been saved to (.+)\.$/m;

export function sessionToolResultsDir(transcriptPath: unknown, sessionId: unknown): string | undefined {
  if (typeof transcriptPath !== 'string' || typeof sessionId !== 'string' || !/^[A-Za-z0-9-]+$/.test(sessionId)) return undefined;
  return join(dirname(transcriptPath), sessionId, 'tool-results');
}

export function resolveSpilledResponse(toolResponse: unknown, toolResultsDir: string | undefined): unknown {
  if (!toolResultsDir) return toolResponse;
  const texts = responseTexts(toolResponse);
  const spilled = texts.length === 1 ? SPILLED_OUTPUT.exec(texts[0]) : null;
  if (!spilled) return toolResponse;
  const path = resolve(spilled[1]);
  if (!path.startsWith(resolve(toolResultsDir) + sep) || !existsSync(path)) return toolResponse;
  return [{ type: 'text', text: readFileSync(path, 'utf8') }];
}

export function captureToolCall(runsDir: string, call: CapturedToolCall): CaptureOutcome {
  const pointer = readActivePointer(runsDir);
  if (!pointer) return { kind: 'not-armed' };
  const run = readRecipeRun(runsDir, pointer.run_id);
  if (run.status !== 'capturing') return { kind: 'not-armed' };
  const candidates = run.steps.filter((step) => toolNameMatchesStep(call.tool_name, step.tool));
  if (!candidates.length) return { kind: 'unrelated' };
  const step = candidates.find((candidate) => differingStepArguments(candidate, call.tool_input).length === 0);
  if (!step) {
    const closest = candidates
      .map((candidate) => ({ candidate, keys: differingStepArguments(candidate, call.tool_input) }))
      .sort((left, right) => left.keys.length - right.keys.length)[0];
    return { kind: 'arguments-differ', run, step: closest.candidate, differingKeys: closest.keys };
  }
  const extracted = extractRecords(call.tool_response);
  const page_args = pageArguments(step, call.tool_input);
  const existingIndex = step.captures.findIndex((capture) => canonicalJson(capture.page_args) === canonicalJson(page_args));
  const file = `${step.id}.${existingIndex >= 0 ? existingIndex + 1 : step.captures.length + 1}.json`;
  writeJsonAtomically(join(runDir(runsDir, run.run_id), file), call);
  const capture: CaptureRef = {
    file,
    captured_at: new Date().toISOString(),
    records: extracted.records.length,
    page_args,
    ...(extracted.totalReported !== undefined ? { total_reported: extracted.totalReported } : {}),
    ...(extracted.nextPage ? { next_page: extracted.nextPage } : {}),
  };
  if (existingIndex >= 0) step.captures[existingIndex] = capture;
  else step.captures.push(capture);
  writeRecipeRun(runsDir, run);
  return { kind: 'captured', run, step, capture };
}

export function stepRecords(runsDir: string, run: RecipeRun, step: RunStep): FlatRecord[] {
  return step.captures.flatMap((capture) => {
    const call = JSON.parse(readFileSync(join(runDir(runsDir, run.run_id), capture.file), 'utf8')) as CapturedToolCall;
    return extractRecords(call.tool_response).records;
  });
}

export function recipeRunPath(runsDir: string, runId: string, file: string): string {
  return join(runDir(runsDir, runId), file);
}

export function captureReceipt(outcome: Extract<CaptureOutcome, { kind: 'captured' }>): string {
  const { run, step, capture } = outcome;
  const captured = run.steps.filter((item) => item.captures.length > 0).length;
  const remaining = run.steps.filter((item) => item.captures.length === 0).map((item) => item.id);
  const lines = [
    `report-baby captured step '${step.id}' of recipe run ${run.run_id} (${captured}/${run.steps.length} steps captured): ${capture.records} records${capture.total_reported !== undefined ? `, source reports total=${capture.total_reported}` : ''}.`,
    'The data is stored on disk and was intentionally not shown here.',
  ];
  if (capture.next_page) lines.push(`More pages exist: repeat this call with ${Object.entries(capture.next_page).map(([key, value]) => `${key}=${value}`).join(', ')}${step.page_params.length ? '' : ' (note: this step declares no page_params, so another page will not match)'}.`);
  const unpaged = run.steps.filter((item) => item.captures.at(-1)?.next_page).map((item) => item.id);
  if (remaining.length) lines.push(`Remaining steps: ${remaining.join(', ')}.`);
  else if (unpaged.length) lines.push(`Every step has a first page; ${unpaged.join(', ')} still ${unpaged.length === 1 ? 'has' : 'have'} more pages. Fetch them if the report needs all records (the reported total is already known), then call finish_recipe_run.`);
  else lines.push('All steps captured: call finish_recipe_run, then inspect_recipe_run if you need more detail.');
  return lines.join('\n');
}

export function argumentsDifferNotice(outcome: Extract<CaptureOutcome, { kind: 'arguments-differ' }>): string {
  return `report-baby recipe run ${outcome.run.run_id}: this call was NOT captured. It looks like step '${outcome.step.id}', but these arguments differ from the recipe: ${outcome.differingKeys.join(', ')}. Repeat the call with the exact arguments from start_recipe_run to capture it.`;
}
