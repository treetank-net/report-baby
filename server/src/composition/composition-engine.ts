import type {
  CompositionEngine,
  CompositionBackend,
  CompositionEvaluation,
  CompositionCandidateSearchRound,
  CompositionCandidateSearchTrace,
  CompositionEvaluator,
  CompositionPlan,
  CompositionPlanCandidate,
  CompositionPlanResult,
  CompositionPlanner,
} from './contracts/engine-contracts.js';
import type { CompositionDocument } from './contracts/model.js';

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
  const leftLegal = evaluationIsLegal(left);
  const rightLegal = evaluationIsLegal(right);
  if (leftLegal !== rightLegal) return leftLegal ? -1 : 1;
  if (left.score !== right.score) return left.score > right.score ? -1 : 1;
  return 0;
}

function evaluationIsLegal(evaluation: CompositionEvaluation): boolean {
  return evaluation.status !== 'rejected'
    && (evaluation.hardViolations?.length ?? 0) === 0
    && (evaluation.residualContent?.length ?? 0) === 0;
}

function candidateSignature(plan: CompositionPlan): string {
  return JSON.stringify({
    pages: plan.pages,
    lines: plan.lines,
    insertionLines: plan.insertionLines,
    placements: plan.placements,
    blockPlacements: plan.blockPlacements,
    tablePlacements: plan.tablePlacements,
    graphicPlacements: plan.graphicPlacements,
  });
}

function uniquePlanCount(plans: CompositionPlan[]): number {
  return new Set(plans.map(candidateSignature)).size;
}

function uniquePlans(plans: CompositionPlan[]): { plans: CompositionPlan[]; duplicateCount: number } {
  // A planner may deliberately return structurally identical plans whose
  // evaluator-visible context differs (for example a synthetic test planner).
  // Proposal-level deduplication belongs in the candidate generator; the
  // engine only applies the calculation budget at this compatibility seam.
  return { plans: [...plans], duplicateCount: 0 };
}

function uniqueCandidateRecords(records: CompositionPlanCandidate[]): { records: CompositionPlanCandidate[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: CompositionPlanCandidate[] = [];
  for (const record of records) {
    if (seen.has(record.signature)) continue;
    seen.add(record.signature);
    unique.push(record);
  }
  return { records: unique, duplicateCount: records.length - unique.length };
}

function positiveBudget(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : Number.MAX_SAFE_INTEGER;
}

function reflowPassCount(plan: CompositionPlan): number {
  return plan.trace?.phases.filter((phase) => phase.name === 'reflow').length ?? 0;
}

function candidateRound(
  round: number,
  generatedCandidates: number,
  candidates: CompositionPlan[],
  evaluations: CompositionEvaluation[],
  improved: boolean,
  stopReason?: CompositionCandidateSearchRound['stopReason'],
  skippedCandidates = 0,
): CompositionCandidateSearchRound {
  const legalCandidates = evaluations.filter(evaluationIsLegal).length;
  const legalScores = evaluations.filter(evaluationIsLegal).map((evaluation) => evaluation.score);
  return {
    round,
    generatedCandidates,
    uniqueCandidates: uniquePlanCount(candidates),
    ...(skippedCandidates > 0 ? { skippedCandidates } : {}),
    plannedCandidates: candidates.length,
    evaluatedCandidates: evaluations.length,
    legalCandidates,
    ...(legalScores.length > 0 ? { bestScore: Math.max(...legalScores) } : {}),
    improved,
    reflowPasses: candidates.reduce((total, plan) => total + reflowPassCount(plan), 0),
    ...(stopReason === undefined ? {} : { stopReason }),
  };
}

function candidateDetails(
  candidate: CompositionPlan,
  evaluation: CompositionEvaluation,
  index: number,
  refinementRound: number,
): Record<string, unknown> {
  return {
    index,
    status: evaluation.status,
    score: evaluation.score,
    scoreBreakdown: evaluation.scoreBreakdown,
    hardViolationCount: evaluation.hardViolations?.length ?? 0,
    reflowPasses: reflowPassCount(candidate),
    refinementRound,
    insertionPlacements: candidate.graphicPlacements
      .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
      .map((graphic) => ({
        graphicId: graphic.graphicId,
        page: graphic.page,
        slotId: graphic.slotId,
        box: { ...graphic.box },
      })),
  };
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
      const startedAt = Date.now();
      const generatedRecords = planner.planCandidatesWithSignatures?.(document, metrics)
        ?? (planner.planCandidates?.(document, metrics) ?? [planner.plan(document, metrics)]).map((plan, index) => ({ signature: `${candidateSignature(plan)}#compat-${index}`, plan }));
      if (generatedRecords.length === 0) throw new Error('Composition planner returned no candidates.');
      const initialUnique = uniqueCandidateRecords(generatedRecords);
      const maxRecalculations = positiveBudget(planner.searchBudget?.maxFullPlanRecalculations);
      const initialRecords = initialUnique.records.slice(0, maxRecalculations);
      const initialCandidates = initialRecords.map(({ plan }) => plan);
      if (initialCandidates.length === 0) throw new Error('Composition planner returned no candidates within its calculation budget.');
      const candidates = [...initialCandidates];
      const candidateSignatures = initialRecords.map(({ signature }) => signature);
      const candidateRounds = candidates.map(() => 0);
      const evaluations = candidates.map((candidate) => evaluator.evaluate(document, candidate));
      const evaluatedSignatures = new Set(initialRecords.map(({ signature }) => signature));
      let selectedCandidate = 0;
      for (let index = 1; index < evaluations.length; index += 1) {
        if (compareCompositionEvaluations(evaluations[index], evaluations[selectedCandidate]) < 0) selectedCandidate = index;
      }
      const configuredRefinementRounds = planner.candidateRefinementRounds ?? 0;
      const refinementRounds = Math.min(
        configuredRefinementRounds,
        planner.searchBudget?.maxRefinementRounds ?? Number.MAX_SAFE_INTEGER,
      );
      const initialBudgetExhausted = initialUnique.records.length > initialRecords.length;
      const searchRounds: CompositionCandidateSearchRound[] = [candidateRound(
        0,
        generatedRecords.length,
        candidates,
        evaluations,
        true,
        initialBudgetExhausted ? 'calculation-budget' : undefined,
        initialUnique.duplicateCount + Math.max(0, initialUnique.records.length - initialRecords.length),
      )];
      if (initialBudgetExhausted) {
        const plan = candidates[selectedCandidate];
        const evaluation = evaluations[selectedCandidate];
        const candidateSearch: CompositionCandidateSearchTrace = {
          rounds: searchRounds,
          generatedCandidates: generatedRecords.length,
          evaluatedCandidates: evaluations.length,
          fullPlanRecalculations: evaluations.length,
          planningTimeMs: Math.max(0, Date.now() - startedAt),
          selectedCandidate,
          selectedProposalSignature: initialRecords[selectedCandidate]?.signature ?? candidateSignature(plan),
        };
        plan.trace?.phases.push({
          name: 'evaluation',
          status: evaluation.status === 'rejected' ? 'failed' : 'completed',
          details: {
            diagnosticCount: evaluation.diagnostics.length,
            errorCount: evaluation.diagnostics.filter((item) => item.severity === 'error').length,
            candidates: evaluations.map((candidateEvaluation, index) => candidateDetails(candidates[index]!, candidateEvaluation, index, candidateRounds[index]!)),
            selectedCandidate,
          },
        });
        if (plan.trace) plan.trace.candidateSearch = candidateSearch;
        return { plan, evaluation };
      }
      for (let round = 1; round <= refinementRounds; round += 1) {
        const refinedGenerated = planner.planRefinedCandidatesWithSignatures?.(document, metrics, candidates[selectedCandidate], round)
          ?? (planner.planRefinedCandidates?.(document, metrics, candidates[selectedCandidate], round) ?? []).map((plan, index) => ({ signature: `${candidateSignature(plan)}#compat-${round}-${index}`, plan }));
        if (refinedGenerated.length === 0) {
          searchRounds.push(candidateRound(round, 0, [], [], false, 'no-new-candidates'));
          break;
        }
        const refinedUnique = uniqueCandidateRecords(refinedGenerated).records.filter((candidate) => {
          if (evaluatedSignatures.has(candidate.signature)) return false;
          evaluatedSignatures.add(candidate.signature);
          return true;
        });
        const remainingBudget = Math.max(0, maxRecalculations - evaluations.length);
        const refinedRecords = refinedUnique.slice(0, remainingBudget);
        const refined = refinedRecords.map(({ plan }) => plan);
        const skippedRefined = refinedGenerated.length - refined.length;
        if (refined.length === 0) {
          searchRounds.push(candidateRound(round, refinedGenerated.length, [], [], false, remainingBudget === 0 ? 'calculation-budget' : 'no-new-candidates', skippedRefined));
          break;
        }
        const refinedEvaluations = refined.map((candidate) => evaluator.evaluate(document, candidate));
        const previousSelected = selectedCandidate;
        for (let index = 0; index < refined.length; index += 1) {
          candidates.push(refined[index]);
          candidateSignatures.push(refinedRecords[index]!.signature);
          evaluations.push(refinedEvaluations[index]);
          candidateRounds.push(round);
          const candidateIndex = evaluations.length - 1;
          if (compareCompositionEvaluations(evaluations[candidateIndex], evaluations[selectedCandidate]) < 0) selectedCandidate = candidateIndex;
        }
        const improved = selectedCandidate !== previousSelected
          && compareCompositionEvaluations(evaluations[selectedCandidate], evaluations[previousSelected]) < 0;
        const budgetExhausted = evaluations.length >= maxRecalculations;
        const stopReason = budgetExhausted
          ? 'calculation-budget'
          : improved
            ? round === refinementRounds ? 'round-limit' : undefined
            : 'no-improvement';
        searchRounds.push(candidateRound(round, refinedGenerated.length, refined, refinedEvaluations, improved, stopReason, skippedRefined));
        if (!improved) break;
        if (budgetExhausted) break;
      }
      const plan = candidates[selectedCandidate];
      const evaluation = evaluations[selectedCandidate];
      const candidateSearch: CompositionCandidateSearchTrace = {
        rounds: searchRounds,
        generatedCandidates: searchRounds.reduce((total, round) => total + round.generatedCandidates, 0),
        evaluatedCandidates: searchRounds.reduce((total, round) => total + round.evaluatedCandidates, 0),
        fullPlanRecalculations: evaluations.length,
        planningTimeMs: Math.max(0, Date.now() - startedAt),
        selectedCandidate,
        selectedProposalSignature: candidateSignatures[selectedCandidate] ?? candidateSignature(plan),
      };
      plan.trace?.phases.push({
        name: 'evaluation',
        status: evaluation.status === 'rejected' ? 'failed' : 'completed',
        details: {
          diagnosticCount: evaluation.diagnostics.length,
          errorCount: evaluation.diagnostics.filter((item) => item.severity === 'error').length,
          candidates: evaluations.map((candidateEvaluation, index) => candidateDetails(candidates[index]!, candidateEvaluation, index, candidateRounds[index]!)),
          selectedCandidate,
        },
      });
      if (plan.trace) plan.trace.candidateSearch = candidateSearch;
      return { plan, evaluation };
    },
  };
}
