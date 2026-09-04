import { createCompositionEngine, type CompositionEngine } from './engine.js';
import { readRenderConfig } from '../builtin-template-source.js';
import type { CompositionTemplate } from './model.js';
import { evaluateCompositionPlan, type CompositionEvaluationOptions } from './evaluator.js';
import { createTextCompositionPlanner, type TextCompositionPlannerPolicy } from './text-planner.js';
import type { CompositionPlan } from './engine.js';

export type TextCompositionEngineOptions = CompositionEvaluationOptions;

function pdfNumber(pdf: Record<string, number>, key: string): number {
  const value = pdf[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite pdf.${key}.`);
  return value;
}

/**
 * Translate the renderer's PDF policy into the planner's renderer-neutral
 * policy. This is the only composition adapter that owns these defaults;
 * callers may override them through the returned policy or engine argument.
 */
export function plannerPolicyFromRenderConfig(): TextCompositionPlannerPolicy {
  const pdf = readRenderConfig().pdf;
  return {
    headingKeepWithNextLines: pdfNumber(pdf, 'headingKeepWithNextLines'),
    minimumLinesAtStart: pdfNumber(pdf, 'widowMinLines'),
    minimumLinesAtEnd: pdfNumber(pdf, 'orphanMinLines'),
    maxPlanningIterations: pdfNumber(pdf, 'plannerMaxIterations'),
    minimumFragmentLines: pdfNumber(pdf, 'plannerMinimumFragmentLines'),
    geometryTolerance: pdfNumber(pdf, 'compositionGeometryTolerance'),
    keepListItemsTogether: pdfNumber(pdf, 'listItemKeepTogether') === 1,
  };
}

export function createTextCompositionEngine(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
  options: TextCompositionEngineOptions = {},
): CompositionEngine {
  const configPolicy = plannerPolicyFromRenderConfig();
  const configuredPolicy: TextCompositionPlannerPolicy = {
    maxPlanningIterations: configPolicy.maxPlanningIterations,
    minimumFragmentLines: configPolicy.minimumFragmentLines,
    geometryTolerance: configPolicy.geometryTolerance,
    ...policy,
    ...(template.headingKeepWithNextLines === undefined ? {} : { headingKeepWithNextLines: template.headingKeepWithNextLines }),
  };
  return createCompositionEngine(createTextCompositionPlanner(template, configuredPolicy), {
    evaluate(document, plan: CompositionPlan) {
      return evaluateCompositionPlan(document, plan, options);
    },
  });
}
