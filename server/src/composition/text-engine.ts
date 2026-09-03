import { createCompositionEngine, type CompositionEngine } from './engine.js';
import { readRenderConfig } from '../builtin-template-source.js';
import type { CompositionTemplate } from './model.js';
import { evaluateCompositionPlan, type CompositionEvaluationOptions } from './evaluator.js';
import { createTextCompositionPlanner, type TextCompositionPlannerPolicy } from './text-planner.js';
import type { CompositionPlan } from './engine.js';

export type TextCompositionEngineOptions = CompositionEvaluationOptions;

export function createTextCompositionEngine(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
  options: TextCompositionEngineOptions = {},
): CompositionEngine {
  const pdf = readRenderConfig().pdf;
  const configuredPolicy: TextCompositionPlannerPolicy = {
    maxPlanningIterations: pdf.plannerMaxIterations,
    minimumFragmentLines: pdf.plannerMinimumFragmentLines,
    geometryTolerance: pdf.compositionGeometryTolerance,
    ...policy,
    ...(template.headingKeepWithNextLines === undefined ? {} : { headingKeepWithNextLines: template.headingKeepWithNextLines }),
  };
  return createCompositionEngine(createTextCompositionPlanner(template, configuredPolicy), {
    evaluate(document, plan: CompositionPlan) {
      return evaluateCompositionPlan(document, plan, options);
    },
  });
}
