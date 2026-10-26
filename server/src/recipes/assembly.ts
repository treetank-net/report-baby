import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { RECIPE_CONCLUSIONS_MARKER, RECIPE_DATA_MARKER, type LoadedRecipe } from './recipe.js';
import { recipeRunPath, stepRecords, type RecipeRun } from './run.js';
import type { FlatRecord } from './records.js';

export interface RecipeDataDocument {
  recipe: string;
  run_id: string;
  period: RecipeRun['period'];
  comparison?: RecipeRun['period'];
  generated_at: string;
  steps: Record<string, FlatRecord[]>;
  totals: Record<string, number>;
}

export interface AssembledRecipeRun {
  dataJson: string;
  reportHtml?: string;
  conclusionsMd?: string;
  missingSteps: string[];
  warnings: string[];
  stepRecordCounts: Record<string, number>;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

export function conclusionsMarkdownToHtml(markdown: string): string {
  const html: string[] = [];
  let listOpen = false;
  for (const line of markdown.split('\n').map((item) => item.trim())) {
    const bullet = line.match(/^[-*] (.*)$/);
    if (bullet) {
      if (!listOpen) html.push('<ul>');
      listOpen = true;
      html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }
    if (listOpen) html.push('</ul>');
    listOpen = false;
    const heading = line.match(/^#{1,6} (.*)$/);
    if (heading) html.push(`<h3>${inlineMarkdownToHtml(heading[1])}</h3>`);
    else if (line) html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
  }
  if (listOpen) html.push('</ul>');
  return html.join('\n');
}

function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function assembleRecipeRun(runsDir: string, loaded: LoadedRecipe, run: RecipeRun, conclusionsMarkdown: string | undefined): AssembledRecipeRun {
  const warnings: string[] = [];
  const steps: Record<string, FlatRecord[]> = {};
  for (const step of run.steps) steps[step.id] = stepRecords(runsDir, run, step);
  const totals = Object.fromEntries(run.steps.flatMap((step) => (step.captures[0]?.total_reported !== undefined ? [[step.id, step.captures[0].total_reported]] : [])));
  const missingSteps = run.steps.filter((step) => step.captures.length === 0).map((step) => step.id);
  const document: RecipeDataDocument = { recipe: run.recipe, run_id: run.run_id, period: run.period, ...(run.comparison ? { comparison: run.comparison } : {}), generated_at: new Date().toISOString(), steps, totals };
  const dataJson = recipeRunPath(runsDir, run.run_id, 'data.json');
  writeFileSync(dataJson, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  let conclusionsMd: string | undefined;
  if (conclusionsMarkdown !== undefined) {
    conclusionsMd = recipeRunPath(runsDir, run.run_id, 'conclusions.md');
    writeFileSync(conclusionsMd, `${conclusionsMarkdown.trim()}\n`, 'utf8');
  }

  let reportHtml: string | undefined;
  const templatePath = loaded.templatePath;
  if (templatePath && existsSync(templatePath)) {
    let html = readFileSync(templatePath, 'utf8');
    if (html.includes(RECIPE_DATA_MARKER)) html = html.split(RECIPE_DATA_MARKER).join(`<script>window.RECIPE_DATA = ${scriptSafeJson(document)};</script>`);
    else warnings.push(`Template ${templatePath} has no ${RECIPE_DATA_MARKER} marker; data was not injected.`);
    if (conclusionsMarkdown !== undefined) {
      if (html.includes(RECIPE_CONCLUSIONS_MARKER)) html = html.split(RECIPE_CONCLUSIONS_MARKER).join(conclusionsMarkdownToHtml(conclusionsMarkdown));
      else warnings.push(`Template has no ${RECIPE_CONCLUSIONS_MARKER} marker; conclusions were not inserted.`);
    }
    reportHtml = recipeRunPath(runsDir, run.run_id, 'report.html');
    writeFileSync(reportHtml, html, 'utf8');
  } else if (templatePath) {
    warnings.push(`Template ${templatePath} no longer exists; only data.json was written.`);
  }

  return {
    dataJson,
    ...(reportHtml ? { reportHtml } : {}),
    ...(conclusionsMd ? { conclusionsMd } : {}),
    missingSteps,
    warnings,
    stepRecordCounts: Object.fromEntries(Object.entries(steps).map(([id, records]) => [id, records.length])),
  };
}
