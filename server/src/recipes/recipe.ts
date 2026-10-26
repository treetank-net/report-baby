import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type RecipeArgValue = string | number | boolean | null | RecipeArgValue[] | { [key: string]: RecipeArgValue };
export type RecipeArgs = { [key: string]: RecipeArgValue };

export interface RecipeStep {
  id: string;
  tool: string;
  args: RecipeArgs;
  page_params?: string[];
  description?: string;
}

export interface Recipe {
  schema_version: 1;
  name: string;
  client_slug: string;
  description?: string;
  steps: RecipeStep[];
  template_html?: string;
}

export interface LoadedRecipe {
  ref: string;
  recipe: Recipe;
  path: string;
  templatePath?: string;
}

const RECIPE_REF = /^([a-z0-9][a-z0-9._-]{0,63})\/([a-z0-9][a-z0-9_-]{0,63})$/;

export const RECIPE_DATA_MARKER = '<!--RECIPE_DATA-->';
export const RECIPE_CONCLUSIONS_MARKER = '<!--RECIPE_CONCLUSIONS-->';

function validEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && !value.includes('${') ? value : undefined;
}

export function marketingContextRootLocatorPath(): string {
  return validEnv('MARKETING_CONTEXT_LOCATOR') ?? join(homedir(), '.config', 'marketing-context', 'root.json');
}

export function resolveMarketingContextRoot(): string {
  const explicit = validEnv('MARKETING_CONTEXT_DIR');
  if (explicit) return explicit;
  const locator = marketingContextRootLocatorPath();
  if (existsSync(locator)) {
    const rootDir = (JSON.parse(readFileSync(locator, 'utf8')) as { root_dir?: unknown }).root_dir;
    if (typeof rootDir === 'string' && rootDir) return rootDir;
  }
  throw new Error(`Recipes are stored by marketing-context-mcp, but its context root is unknown: set MARKETING_CONTEXT_DIR or start the marketing-context server once (it writes ${locator}).`);
}

export function loadRecipe(ref: string): LoadedRecipe {
  const match = RECIPE_REF.exec(ref);
  if (!match) throw new Error(`Recipe '${ref}' must be addressed as "<client_slug>/<name>", e.g. "acme/weekly_leads". Use marketing-context list_recipes.`);
  const recipeDir = join(resolveMarketingContextRoot(), 'clients', match[1], 'recipes');
  const path = join(recipeDir, `${match[2]}.json`);
  if (!existsSync(path)) throw new Error(`Recipe '${ref}' does not exist at ${path}. Save it with marketing-context save_recipe.`);
  const recipe = JSON.parse(readFileSync(path, 'utf8')) as Recipe;
  if (recipe.schema_version !== 1) throw new Error(`Recipe '${ref}' has schema_version ${String(recipe.schema_version)}; this report-baby reads version 1.`);
  if (!Array.isArray(recipe.steps) || !recipe.steps.length) throw new Error(`Recipe '${ref}' has no steps.`);
  const templatePath = recipe.template_html ? join(dirname(path), recipe.template_html) : undefined;
  return { ref, recipe, path, ...(templatePath ? { templatePath } : {}) };
}

export function recipeUsesComparison(recipe: Recipe): boolean {
  return recipe.steps.some((step) => JSON.stringify(step.args).includes('{{prev_'));
}
