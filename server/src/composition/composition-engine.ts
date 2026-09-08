import type {
  CompositionEngine,
  CompositionBackend,
  CompositionEvaluation,
  CompositionEvaluator,
  CompositionPlan,
  CompositionPlanResult,
  CompositionPlanner,
} from './contracts/engine-contracts.js';
import type { CompositionDocument } from './model.js';

/**
 * Orders two evaluated plans for a deterministic candidate-selection step.
 * A legal plan always wins over an illegal one; among legal plans, the higher
 * score wins. Equal evaluations intentionally remain a tie so the caller can
 * apply a stable candidate-order tie-break without hiding it here.
 */
/**
 * @planner-target composition/composition-engine.ts
 * @planner-responsibility Keep the current compareCompositionEvaluations implementation intact until its target seam is extracted.
 */
export function compareCompositionEvaluations(left: CompositionEvaluation, right: CompositionEvaluation): number {
  const leftLegal = left.status !== 'rejected' && left.hardViolations.length === 0 && left.residualContent.length === 0;
  const rightLegal = right.status !== 'rejected' && right.hardViolations.length === 0 && right.residualContent.length === 0;
  if (leftLegal !== rightLegal) return leftLegal ? -1 : 1;
  if (left.score !== right.score) return left.score > right.score ? -1 : 1;
  return 0;
}

/**
 * @planner-target composition/composition-engine.ts
 * @planner-responsibility Keep the current renderComposition implementation intact until its target seam is extracted.
 */
export function renderComposition<Artifact>(
  document: CompositionDocument,
  result: CompositionPlanResult,
  backend: CompositionBackend<Artifact>,
): Artifact | Promise<Artifact> {
  if (result.evaluation.status === 'rejected') {
    throw new Error('Composition plan was rejected and cannot be rendered.');
  }
  return backend.render(document, result.plan);
}

/**
 * Dependency-injection seam for the renderer-neutral composition pipeline.
 * The planner and evaluator have no PDF dependency; a backend consumes the
 * resulting plan in a later adapter step.
 */
/**
 * @planner-target composition/composition-engine.ts
 * @planner-responsibility Evaluate candidates, refine legal alternatives, and select the winning plan.
 */
export function createCompositionEngine(planner: CompositionPlanner, evaluator: CompositionEvaluator): CompositionEngine {
  return {
    /**
     * @planner-target composition/composition-engine.ts
     * @planner-responsibility Keep the current plan implementation intact until its target seam is extracted.
     */
    plan(document, metrics) {
      const candidates = planner.planCandidates?.(document, metrics) ?? [planner.plan(document, metrics)];
      if (candidates.length === 0) throw new Error('Composition planner returned no candidates.');
      const candidateRounds = candidates.map(() => 0);
      const evaluations = candidates.map((candidate) => evaluator.evaluate(document, candidate));
      let selectedCandidate = 0;
      for (let index = 1; index < evaluations.length; index += 1) {
        if (compareCompositionEvaluations(evaluations[index], evaluations[selectedCandidate]) < 0) selectedCandidate = index;
      }
      const refinementRounds = planner.candidateRefinementRounds ?? 0;
      for (let round = 1; round <= refinementRounds; round += 1) {
        const refined = planner.planRefinedCandidates?.(document, metrics, candidates[selectedCandidate], round) ?? [];
        if (refined.length === 0) break;
        const refinedEvaluations = refined.map((candidate) => evaluator.evaluate(document, candidate));
        for (let index = 0; index < refined.length; index += 1) {
          candidates.push(refined[index]);
          evaluations.push(refinedEvaluations[index]);
          candidateRounds.push(round);
          const candidateIndex = evaluations.length - 1;
          if (compareCompositionEvaluations(evaluations[candidateIndex], evaluations[selectedCandidate]) < 0) selectedCandidate = candidateIndex;
        }
      }
      const plan = candidates[selectedCandidate];
      const evaluation = evaluations[selectedCandidate];
      plan.trace?.phases.push({
        name: 'evaluation',
        status: evaluation.status === 'rejected' ? 'failed' : 'completed',
        details: {
          diagnosticCount: evaluation.diagnostics.length,
          errorCount: evaluation.diagnostics.filter((item) => item.severity === 'error').length,
          candidates: evaluations.map((candidateEvaluation, index) => ({
            index,
            status: candidateEvaluation.status,
            score: candidateEvaluation.score,
            scoreBreakdown: candidateEvaluation.scoreBreakdown,
            hardViolationCount: candidateEvaluation.hardViolations.length,
            reflowPasses: candidates[index].trace?.phases.filter((phase) => phase.name === 'reflow').length ?? 0,
            refinementRound: candidateRounds[index],
            insertionPlacements: candidates[index].graphicPlacements
              .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
              .map((graphic) => ({
                graphicId: graphic.graphicId,
                page: graphic.page,
                slotId: graphic.slotId,
                box: { ...graphic.box },
              })),
          })),
          selectedCandidate,
        },
      });
      return { plan, evaluation };
    },
  };
}
