import { createCompositionEngine, type CompositionEngine } from './engine.js';
import { readRenderConfig } from '../builtin-template-source.js';
import type { CompositionTemplate } from './model.js';
import { evaluateCompositionPlan } from './evaluator.js';
import { createTextCompositionPlanner, type TextCompositionPlannerPolicy } from './text-planner.js';

export function createTextCompositionEngine(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
): CompositionEngine {
  const pdf = readRenderConfig().pdf;
  const configuredPolicy: TextCompositionPlannerPolicy = {
    maxPlanningIterations: pdf.plannerMaxIterations,
    minimumFragmentLines: pdf.plannerMinimumFragmentLines,
    ...policy,
  };
  return createCompositionEngine(createTextCompositionPlanner(template, configuredPolicy), { evaluate: evaluateCompositionPlan });
}
