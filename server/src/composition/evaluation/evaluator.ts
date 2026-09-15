import type { CompositionDocument } from '../contracts/model.js';
import type { CompositionDiagnostic, CompositionEvaluation, CompositionPlan, CompositionScoreComponent, CompositionSuggestion } from '../contracts/engine-contracts.js';
import type { CompositionContrastAssessment, CompositionContrastProvider } from './contrast.js';
import { scoreLegalPlan } from './scoring.js';
import { decorateCompositionDiagnostics, suggestionFromScore } from './diagnostic-catalogue.js';
import {
  appendDocumentDiagnostics,
  checkEarlyRouteTransitions,
  checkEmptyAndUnderfilledSlots,
  checkEmptyFlowPlacements,
  checkFlowBarrierBoxCandidates,
  checkInsertionSourceOrder,
  validateAtomicPlacements,
  validateBlockPlacementTargets,
  validateGraphicPlacements,
  validateLineGraphicOverlaps,
  validateLineSlotOverlaps,
  validateLineTargets,
  validateTablePlacements,
} from './legality.js';
import {
  sourceBlocksForDocument,
  validateContentCoverage,
  validateFlowVisualOrder,
  validateResidualContent,
} from './content.js';

/**
 * @planner-target composition/evaluation/evaluator.ts
 * @planner-responsibility Keep the current buildCompositionEvaluation implementation intact until its target seam is extracted.
 */
function suggestionsFromScore(breakdown: CompositionScoreComponent[]): CompositionSuggestion[] {
  return breakdown.flatMap((component): CompositionSuggestion[] => {
    if (component.points >= 0) return [];
    if (component.code === 'header-spacing') return [{
      ...suggestionFromScore('HEADER_GAP_TOO_SMALL', 'Header content is too close to the first page content on at least one page.', component.details, ['Increase the configured header/content gap.', 'Use a shorter header or a template with a larger chrome band.'], 'The measured header-to-content gap is below the configured spacing target.'),
    }];
    if (component.code === 'orphan-lines') return [{
      ...suggestionFromScore('ORPHAN_FRAGMENT', 'A wrapped paragraph leaves an isolated fragment beside an insertion.', component.details, ['Move the insertion within its legal movement window.', 'Reduce the insertion width or place it on a page with more continuous text.'], 'An insertion obstacle leaves an isolated text fragment.'),
    }];
    if (component.code === 'insertion-spacing') return [{
      ...suggestionFromScore('INSERTION_SPACING_IMBALANCE', 'Insertion spacing is visibly imbalanced around the surrounding text streams.', component.details, ['Evaluate a nearby insertion candidate.', 'Adjust the insertion position or measured content height.'], 'The measured gaps around one or more insertion obstacles are asymmetric.'),
    }];
    return [];
  });
}

function buildCompositionEvaluation(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[], contrastAssessments: CompositionContrastAssessment[]): CompositionEvaluation {
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  const hardViolations = diagnostics.filter((item) => item.severity === 'error');
  const scored = hasErrors ? { score: Number.NEGATIVE_INFINITY, breakdown: [] } : scoreLegalPlan(document, plan, contrastAssessments);
  const suggestions = suggestionsFromScore(scored.breakdown);
  if (suggestions.length > 0) plan.suggestions = suggestions;
  return {
    status: hasErrors ? 'rejected' : diagnostics.length > 0 ? 'accepted-with-warnings' : 'accepted',
    diagnostics,
    hardViolations,
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    residualContent: plan.residualContent,
    ...(suggestions.length > 0 ? { suggestions } : {}),
  };
}

/**
 * Evaluate the renderer-neutral text plan before a backend is allowed to draw.
 * This evaluator intentionally knows nothing about PDF, PNG or jsPDF.
 */
export interface CompositionEvaluationOptions {
  contrastProvider?: CompositionContrastProvider;
  /** Populate renderer-neutral plan evidence before score components run. */
  beforeEvaluate?: (document: CompositionDocument, plan: CompositionPlan) => void;
}

/**
 * @planner-target composition/evaluation/evaluator.ts
 * @planner-responsibility Keep the current evaluateCompositionPlan implementation intact until its target seam is extracted.
 */
export function evaluateCompositionPlan(document: CompositionDocument, plan: CompositionPlan, options: CompositionEvaluationOptions = {}): CompositionEvaluation {
  const diagnostics = [...plan.diagnostics];
  const contrastAssessments = options.contrastProvider?.assess(plan) ?? [];
  const repeatedFlows = new Set(plan.repeatFlowIds ?? []);
  checkEmptyFlowPlacements(document, plan, diagnostics);
  checkFlowBarrierBoxCandidates(plan, diagnostics);
  checkEmptyAndUnderfilledSlots(document, plan, diagnostics);
  checkEarlyRouteTransitions(document, plan, diagnostics);
  checkInsertionSourceOrder(document, plan, diagnostics);
  appendDocumentDiagnostics(document, diagnostics);
  validateLineTargets(plan, repeatedFlows, diagnostics);
  validateLineSlotOverlaps(plan, diagnostics);
  validateLineGraphicOverlaps(plan, diagnostics);
  validateBlockPlacementTargets(plan, diagnostics);
  const sourceBlocks = sourceBlocksForDocument(document);
  validateFlowVisualOrder(document, plan, repeatedFlows, diagnostics);
  validateTablePlacements(document, plan, sourceBlocks, diagnostics);
  validateAtomicPlacements(document, plan, sourceBlocks, diagnostics);
  validateGraphicPlacements(document, plan, diagnostics);
  validateResidualContent(plan, diagnostics);
  validateContentCoverage(document, plan, repeatedFlows, diagnostics);
  const decoratedDiagnostics = decorateCompositionDiagnostics(diagnostics);
  plan.diagnostics = decoratedDiagnostics;
  options.beforeEvaluate?.(document, plan);
  return buildCompositionEvaluation(document, plan, decoratedDiagnostics, contrastAssessments);
}
