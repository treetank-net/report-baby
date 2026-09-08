import type { CompositionDocument } from '../contracts/model.js';
import type { CompositionDiagnostic, CompositionEvaluation, CompositionPlan } from '../contracts/engine-contracts.js';
import type { CompositionContrastAssessment, CompositionContrastProvider } from './contrast.js';
import { scoreLegalPlan } from './scoring.js';
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
function buildCompositionEvaluation(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[], contrastAssessments: CompositionContrastAssessment[]): CompositionEvaluation {
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  const hardViolations = diagnostics.filter((item) => item.severity === 'error');
  const scored = hasErrors ? { score: Number.NEGATIVE_INFINITY, breakdown: [] } : scoreLegalPlan(document, plan, contrastAssessments);
  return {
    status: hasErrors ? 'rejected' : diagnostics.length > 0 ? 'accepted-with-warnings' : 'accepted',
    diagnostics,
    hardViolations,
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    residualContent: plan.residualContent,
  };
}

/**
 * Evaluate the renderer-neutral text plan before a backend is allowed to draw.
 * This evaluator intentionally knows nothing about PDF, PNG or jsPDF.
 */
export interface CompositionEvaluationOptions {
  contrastProvider?: CompositionContrastProvider;
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
  return buildCompositionEvaluation(document, plan, diagnostics, contrastAssessments);
}
