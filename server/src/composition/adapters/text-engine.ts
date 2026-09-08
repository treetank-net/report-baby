import { createCompositionEngine } from '../composition-engine.js';
import type { CompositionEngine, CompositionPlan } from '../contracts/engine-contracts.js';
import { readRenderConfig } from '../../template/builtins.js';
import type { CompositionTemplate } from '../contracts/model.js';
import { evaluateCompositionPlan, type CompositionEvaluationOptions } from '../evaluation/evaluator.js';
import { createTextCompositionPlanner } from '../layout/text-planner.js';
import type { TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';
import { pdfNumber } from './render-config.js';

export type TextCompositionEngineOptions = CompositionEvaluationOptions;

/**
 * Translate the renderer's PDF policy into the planner's renderer-neutral
 * policy. This is the only composition adapter that owns these defaults;
 * callers may override them through the returned policy or engine argument.
 */
/**
 * @planner-target composition/adapters/text-engine.ts
 * @planner-responsibility Keep the current plannerPolicyFromRenderConfig implementation intact until its target seam is extracted.
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

/**
 * @planner-target composition/adapters/text-engine.ts
 * @planner-responsibility Keep the current createTextCompositionEngine implementation intact until its target seam is extracted.
 */
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
    /**
     * @planner-target composition/adapters/text-engine.ts
     * @planner-responsibility Keep the current evaluate implementation intact until its target seam is extracted.
     */
    evaluate(document, plan: CompositionPlan) {
      return evaluateCompositionPlan(document, plan, options);
    },
  });
}
