import type {
  CompositionEngine,
  CompositionBackend,
  CompositionEvaluation,
  CompositionCandidateSearchRound,
  CompositionCandidateSearchStopReason,
  CompositionCandidateSearchTrace,
  CompositionEvaluator,
  CompositionPlan,
  CompositionPlanCandidate,
  CompositionPlanResult,
  CompositionPlanner,
  CompositionRepairAttempt,
  CompositionRefinementScope,
} from './contracts/engine-contracts.js';
import type { CompositionDocument } from './contracts/model.js';
import { recordPlanDecision } from './observability/planning-observability.js';
import { compareExactPlanToCoarseBaseline } from './layout/coarse-geometry-planning.js';
import type { CoarseExactPlanComparison } from './layout/coarse-geometry-planning.js';

function preserveCoarseSeedEvidence(document: CompositionDocument, baseline: CompositionPlan, selected: CompositionPlan): void {
  const coarseEvidence = baseline.decisions.find((decision) => decision.code === 'COARSE_GEOMETRY_SEED_SELECTED');
  if (!coarseEvidence) return;
  let selectedEvidence = selected.decisions.find((decision) => decision.code === coarseEvidence.code);
  if (!selectedEvidence) {
    selectedEvidence = recordPlanDecision(selected, coarseEvidence.code);
    Object.assign(selectedEvidence, coarseEvidence);
  }
  const comparison = selectedEvidence.baselineExactComparison as CoarseExactPlanComparison | undefined;
  if (comparison) selectedEvidence.selectedExactComparison = compareExactPlanToCoarseBaseline(document, comparison, selected);
}

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

function repairStepsBelowMinimum(
  proposals: CompositionEvaluation['repairProposals'],
  round: number,
  minimumStep: number | undefined,
): boolean {
  return minimumStep !== undefined
    && (proposals?.length ?? 0) > 0
    && proposals!.every((proposal) => proposal.action === 'move'
      && (proposal.estimateKind === 'orphan-recovery' || proposal.estimateKind === 'fragmentation-recovery'
        ? proposal.distance < minimumStep
        : proposal.distance / (2 ** Math.max(0, round - 1)) < minimumStep));
}

function repairTouchesScope(
  proposal: NonNullable<CompositionEvaluation['repairProposals']>[number],
  scope?: CompositionRefinementScope,
): boolean {
  if (!scope || scope.kind === 'document') return true;
  return proposal.placement.page === scope.page
    || (proposal.action === 'relocate' && proposal.destination.page === scope.page);
}

function scopedPage(scope: CompositionRefinementScope | undefined): number | undefined {
  return scope?.kind === 'page' ? scope.page : undefined;
}

function reflowPassCount(plan: CompositionPlan): number {
  return plan.trace?.phases.filter((phase) => phase.name === 'reflow').length ?? 0;
}

function planTimingTotal(plans: CompositionPlan[], name: string): number {
  return plans.reduce((total, plan) => total + (plan.trace?.timings ?? [])
    .filter((timing) => timing.name === name)
    .reduce((planTotal, timing) => planTotal + timing.elapsedMs, 0), 0);
}

function mergeBaselineContinuationTrace(
  continued: CompositionPlanResult,
  baselineMaterializationMs: number,
  priorSearch: CompositionCandidateSearchTrace | undefined,
): void {
  const search = continued.plan.trace?.candidateSearch;
  if (!search || !priorSearch) return;
  const addedEvaluations = Math.max(0, search.fullPlanRecalculations - 1);
  const planningMs = priorSearch.phaseTimings.planningMs + search.phaseTimings.planningMs;
  const materializationMs = priorSearch.phaseTimings.materializationMs
    + Math.max(0, search.phaseTimings.materializationMs - baselineMaterializationMs);
  const refinementMs = priorSearch.phaseTimings.refinementMs + search.phaseTimings.refinementMs;
  search.rounds = [
    ...priorSearch.rounds,
    ...search.rounds.slice(1).map((round) => ({ ...round, round: round.round + Math.max(0, priorSearch.rounds.length - 1) })),
  ];
  search.generatedCandidates = priorSearch.generatedCandidates + Math.max(0, search.generatedCandidates - 1);
  search.evaluatedCandidates = priorSearch.evaluatedCandidates + addedEvaluations;
  search.fullPlanRecalculations = priorSearch.fullPlanRecalculations + addedEvaluations;
  search.planningTimeMs = priorSearch.planningTimeMs + search.planningTimeMs;
  search.phaseTimings = {
    planningMs,
    materializationMs,
    proposalGenerationMs: Math.max(0, planningMs + refinementMs - materializationMs),
    initialEvaluationMs: priorSearch.phaseTimings.initialEvaluationMs,
    evaluationMs: priorSearch.phaseTimings.evaluationMs
      + Math.max(0, search.phaseTimings.evaluationMs - search.phaseTimings.initialEvaluationMs),
    refinementMs,
  };
}

function testedRepairDistance(
  proposal: NonNullable<CompositionEvaluation['repairProposals']>[number],
  selected: CompositionPlan,
  candidate: CompositionPlan,
): number | undefined {
  if (proposal.action !== 'move' || proposal.placement.graphicId === undefined) return undefined;
  const selectedPlacement = selected.graphicPlacements.find((placement) => placement.graphicId === proposal.placement.graphicId
    && placement.page === proposal.placement.page);
  const candidatePlacement = candidate.graphicPlacements.find((placement) => placement.graphicId === proposal.placement.graphicId
    && placement.page === proposal.placement.page);
  if (!selectedPlacement || !candidatePlacement) return undefined;
  return Math.abs(candidatePlacement.box[proposal.axis] - selectedPlacement.box[proposal.axis]);
}

function candidateRound(
  round: number,
  generatedCandidates: number,
  candidates: CompositionPlan[],
  evaluations: CompositionEvaluation[],
  improved: boolean,
  stopReason?: CompositionCandidateSearchRound['stopReason'],
  skippedCandidates = 0,
  signatures: string[] = candidates.map((_candidate, index) => index === 0 ? 'seed' : `compat-${index}`),
  repairProposals?: CompositionCandidateSearchRound['repairProposals'],
  candidateResults?: CompositionCandidateSearchRound['candidateResults'],
  repairAttempts?: CompositionRepairAttempt[],
  scope?: CompositionRefinementScope,
): CompositionCandidateSearchRound {
  const legalCandidates = evaluations.filter(evaluationIsLegal).length;
  const legalScores = evaluations.filter(evaluationIsLegal).map((evaluation) => evaluation.score);
  return {
    round,
    generatedCandidates,
    uniqueCandidates: new Set(signatures).size,
    ...(skippedCandidates > 0 ? { skippedCandidates } : {}),
    plannedCandidates: candidates.length,
    evaluatedCandidates: evaluations.length,
    legalCandidates,
    ...(legalScores.length > 0 ? { bestScore: Math.max(...legalScores) } : {}),
    improved,
    reflowPasses: candidates.reduce((total, plan) => total + reflowPassCount(plan), 0),
    ...(repairProposals === undefined ? {} : { repairProposals }),
    ...(repairAttempts === undefined ? {} : { repairAttempts }),
    ...(candidateResults === undefined ? {} : { candidateResults }),
    ...(scope === undefined ? {} : { scope }),
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

function candidateSearchResults(
  evaluations: CompositionEvaluation[],
  signatures: string[],
): CompositionCandidateSearchRound['candidateResults'] {
  return evaluations.map((evaluation, index) => {
    const legal = evaluationIsLegal(evaluation);
    return {
      signature: signatures[index] ?? `candidate:${index}`,
      legal,
      ...(evaluation.diagnostics.length === 0 ? {} : { diagnostics: evaluation.diagnostics }),
      ...(legal ? { score: evaluation.score } : {}),
    };
  });
}

function searchStopReason(
  evaluation: CompositionEvaluation,
  rounds: CompositionCandidateSearchRound[],
): CompositionCandidateSearchStopReason {
  const lastRound = rounds.at(-1);
  if (evaluationIsLegal(evaluation)) return lastRound?.stopReason ?? 'legal-incumbent';
  if (lastRound?.stopReason === 'calculation-budget' || lastRound?.stopReason === 'round-limit') return 'search-budget-exhausted';
  return 'unsupported-hard-diagnostics';
}

function searchHasUntestedAlternatives(
  evaluation: CompositionEvaluation,
  rounds: CompositionCandidateSearchRound[],
): boolean {
  if (!evaluationIsLegal(evaluation)) return true;
  const lastRound = rounds.at(-1);
  return lastRound?.stopReason === 'calculation-budget'
    || lastRound?.stopReason === 'round-limit';
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
      const planningStartedAt = Date.now();
      const maxRecalculations = positiveBudget(planner.searchBudget?.maxFullPlanRecalculations);
      const generatedRecords = planner.planBaselineCandidatesWithSignatures
        ? planner.planBaselineCandidatesWithSignatures(document, metrics, Math.min(maxRecalculations, positiveBudget(planner.searchBudget?.maxInitialCandidates)))
        : planner.planBaselineWithSignature
        ? [planner.planBaselineWithSignature(document, metrics)]
        : planner.planCandidatesWithSignatures?.(document, metrics)
          ?? (planner.planCandidates?.(document, metrics) ?? [planner.plan(document, metrics)]).map((plan, index) => ({ signature: index === 0 ? 'seed' : `compat-${index}`, plan }));
      const planningMs = Math.max(0, Date.now() - planningStartedAt);
      if (generatedRecords.length === 0) throw new Error('Composition planner returned no candidates.');
      const initialUnique = uniqueCandidateRecords(generatedRecords);
      const initialRecords = initialUnique.records.slice(0, maxRecalculations);
      const initialCandidates = initialRecords.map(({ plan }) => plan);
      if (initialCandidates.length === 0) throw new Error('Composition planner returned no candidates within its calculation budget.');
      const candidates = [...initialCandidates];
      const candidateSignatures = initialRecords.map(({ signature }) => signature);
      const candidateRounds = candidates.map(() => 0);
      const initialEvaluationStartedAt = Date.now();
      const evaluations = candidates.map((candidate) => evaluator.evaluate(document, candidate));
      const initialEvaluationMs = Math.max(0, Date.now() - initialEvaluationStartedAt);
      let materializationMs = planTimingTotal(initialCandidates, 'document-materialization');
      let refinementEvaluationMs = 0;
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
      const configuredPageLocalRounds = planner.searchBudget?.maxPageLocalRefinementRounds
        ?? (planner.searchBudget?.maxRefinementRounds === 0 ? 0 : 1);
      const pageLocalRounds = Number.isInteger(configuredPageLocalRounds) && configuredPageLocalRounds > 0
        ? configuredPageLocalRounds
        : 0;
      const pageNumbers = [...new Set(candidates[selectedCandidate]!.pages.map(({ page }) => page))].sort((left, right) => left - right);
      const pageLocalScopes: CompositionRefinementScope[] = pageNumbers.flatMap((page) =>
        Array.from({ length: pageLocalRounds }, () => ({ kind: 'page' as const, page })));
      const globalScopes: Array<CompositionRefinementScope | undefined> = Array.from({ length: refinementRounds }, () => undefined);
      const initialSelectedIsLegal = evaluationIsLegal(evaluations[selectedCandidate]!);
      const refinementSchedule = initialSelectedIsLegal
        ? [...pageLocalScopes, ...globalScopes]
        : [...globalScopes, ...pageLocalScopes];
      const initialBudgetExhausted = initialUnique.records.length > initialRecords.length;
      const searchRounds: CompositionCandidateSearchRound[] = [candidateRound(
        0,
        generatedRecords.length,
        candidates,
        evaluations,
        true,
        initialBudgetExhausted ? 'calculation-budget' : undefined,
        initialUnique.duplicateCount + Math.max(0, initialUnique.records.length - initialRecords.length),
        initialRecords.map(({ signature }) => signature),
        undefined,
        candidateSearchResults(evaluations, candidateSignatures),
      )];
      if (initialBudgetExhausted) {
        const plan = candidates[selectedCandidate];
        const evaluation = evaluations[selectedCandidate];
        preserveCoarseSeedEvidence(document, candidates[0]!, plan);
        const candidateSearch: CompositionCandidateSearchTrace = {
          rounds: searchRounds,
          generatedCandidates: generatedRecords.length,
          evaluatedCandidates: evaluations.length,
          fullPlanRecalculations: evaluations.length,
          planningTimeMs: Math.max(0, Date.now() - startedAt),
          phaseTimings: {
            planningMs,
            materializationMs,
            proposalGenerationMs: Math.max(0, planningMs - materializationMs),
            initialEvaluationMs,
            evaluationMs: initialEvaluationMs,
            refinementMs: 0,
          },
          stopReason: searchStopReason(evaluation, searchRounds),
          remainingBudget: Math.max(0, maxRecalculations - evaluations.length),
          untestedAlternatives: searchHasUntestedAlternatives(evaluation, searchRounds),
          selectedCandidate,
          selectedProposalSignature: initialRecords[selectedCandidate]?.signature ?? 'seed',
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
      const refinementStartedAt = Date.now();
      for (let scheduleIndex = 0; scheduleIndex < refinementSchedule.length; scheduleIndex += 1) {
        const round = scheduleIndex + 1;
        const scope = refinementSchedule[scheduleIndex];
        const pageLocalPass = scope?.kind === 'page';
        const selectedPlan = candidates[selectedCandidate];
        const selectedEvaluation = evaluations[selectedCandidate];
        const repairProposals = (selectedEvaluation.repairProposals ?? []).filter((proposal) => repairTouchesScope(proposal, scope));
        const remainingBudget = Math.max(0, maxRecalculations - evaluations.length);
        const effectiveScope = evaluationIsLegal(selectedEvaluation) ? scope : undefined;
        const dedicatedRefinements = evaluationIsLegal(selectedEvaluation)
          ? planner.planQualityRepairsWithSignatures?.(document, metrics, selectedPlan, selectedEvaluation, round, remainingBudget, effectiveScope)
          : planner.planLegalityCorrectionsWithSignatures?.(document, metrics, selectedPlan, selectedEvaluation, round, remainingBudget);
        const allowLegacyRefinementFallback = !pageLocalPass
          && (planner.planBaselineWithSignature === undefined || evaluationIsLegal(selectedEvaluation));
        const refinedGenerated: CompositionPlanCandidate[] = dedicatedRefinements
          ?? (allowLegacyRefinementFallback
            ? planner.planRefinedCandidatesWithSignatures?.(document, metrics, selectedPlan, round, selectedEvaluation)
              ?? (planner.planRefinedCandidates?.(document, metrics, selectedPlan, round, selectedEvaluation) ?? []).map((plan, index) => ({ signature: `compat-${round}-${index}`, plan }))
            : []);
        if (refinedGenerated.length === 0) {
          const stopReason = repairStepsBelowMinimum(repairProposals, round, planner.searchBudget?.minimumGeometryStepMm)
            ? 'minimum-step'
            : 'no-new-candidates';
          const repairAttempts = repairProposals.map(({ id }) => ({ proposalId: id, status: 'not-materialized' as const }));
          searchRounds.push(candidateRound(round, 0, [], [], false, stopReason, 0, [], repairProposals, undefined, repairAttempts, scope));
          if (pageLocalPass) {
            while (scheduleIndex + 1 < refinementSchedule.length
              && refinementSchedule[scheduleIndex + 1]?.kind === 'page'
              && scopedPage(refinementSchedule[scheduleIndex + 1]) === scopedPage(scope)) scheduleIndex += 1;
            continue;
          }
          break;
        }
        const previouslyEvaluatedSignatures = new Set(evaluatedSignatures);
        const refinedUnique = uniqueCandidateRecords(refinedGenerated).records.filter((candidate) => {
          if (evaluatedSignatures.has(candidate.signature)) return false;
          evaluatedSignatures.add(candidate.signature);
          return true;
        });
        const refinedRecords = refinedUnique.slice(0, remainingBudget);
        const refined = refinedRecords.map(({ plan }) => plan);
        const skippedRefined = refinedGenerated.length - refined.length;
        if (refined.length === 0) {
          const repairAttempts = repairProposals.map((proposal) => {
            const candidate = refinedGenerated.find((record) => record.repairProposalIds?.includes(proposal.id));
            if (!candidate) return { proposalId: proposal.id, status: 'not-materialized' as const };
            const testedDistance = testedRepairDistance(proposal, selectedPlan, candidate.plan);
            return {
              proposalId: proposal.id,
              status: previouslyEvaluatedSignatures.has(candidate.signature) ? 'deduplicated' as const : 'budget-skipped' as const,
              candidateSignature: candidate.signature,
              ...(testedDistance === undefined ? {} : { testedDistance }),
            };
          });
          searchRounds.push(candidateRound(round, refinedGenerated.length, [], [], false, remainingBudget === 0 ? 'calculation-budget' : 'no-new-candidates', skippedRefined, [], repairProposals, [], repairAttempts, scope));
          if (pageLocalPass) {
            while (scheduleIndex + 1 < refinementSchedule.length
              && refinementSchedule[scheduleIndex + 1]?.kind === 'page'
              && scopedPage(refinementSchedule[scheduleIndex + 1]) === scopedPage(scope)) scheduleIndex += 1;
            continue;
          }
          break;
        }
        const refinedEvaluationStartedAt = Date.now();
        const refinedEvaluations = refined.map((candidate) => evaluator.evaluate(document, candidate));
        refinementEvaluationMs += Math.max(0, Date.now() - refinedEvaluationStartedAt);
        materializationMs += planTimingTotal(refined, 'document-materialization');
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
        const nextPassIsSamePage = pageLocalPass
          && refinementSchedule[scheduleIndex + 1]?.kind === 'page'
          && scopedPage(refinementSchedule[scheduleIndex + 1]) === scopedPage(scope);
        const stopReason = budgetExhausted
          ? 'calculation-budget'
          : improved
            ? !nextPassIsSamePage && scheduleIndex === refinementSchedule.length - 1 ? 'round-limit' : undefined
            : !nextPassIsSamePage ? 'no-improvement' : undefined;
        const candidateResults = refinedRecords.map(({ signature, repairProposalIds }, index) => {
          const candidateEvaluation = refinedEvaluations[index]!;
          const legal = evaluationIsLegal(candidateEvaluation);
          return {
            signature,
            legal,
            ...(repairProposalIds === undefined ? {} : { repairProposalIds }),
            ...(candidateEvaluation.diagnostics.length === 0 ? {} : { diagnostics: candidateEvaluation.diagnostics }),
            ...(legal ? {
              score: candidateEvaluation.score,
              scoreDelta: candidateEvaluation.score - selectedEvaluation.score,
            } : {}),
          };
        });
        const repairAttempts = repairProposals.map((proposal) => {
          const candidate = refinedGenerated.find((record) => record.repairProposalIds?.includes(proposal.id));
          if (!candidate) return { proposalId: proposal.id, status: 'not-materialized' as const };
          if (previouslyEvaluatedSignatures.has(candidate.signature)) {
            const testedDistance = testedRepairDistance(proposal, selectedPlan, candidate.plan);
            return {
              proposalId: proposal.id,
              status: 'deduplicated' as const,
              candidateSignature: candidate.signature,
              ...(testedDistance === undefined ? {} : { testedDistance }),
            };
          }
          const candidateIndex = refinedRecords.findIndex((record) => record.signature === candidate.signature);
          const testedDistance = testedRepairDistance(proposal, selectedPlan, candidate.plan);
          if (candidateIndex < 0) return {
            proposalId: proposal.id,
            status: 'budget-skipped' as const,
            candidateSignature: candidate.signature,
            ...(testedDistance === undefined ? {} : { testedDistance }),
          };
          const candidateEvaluation = refinedEvaluations[candidateIndex]!;
          const legal = evaluationIsLegal(candidateEvaluation);
          return {
            proposalId: proposal.id,
            status: 'evaluated' as const,
            candidateSignature: candidate.signature,
            legal,
            ...(testedDistance === undefined ? {} : { testedDistance }),
            ...(legal ? { scoreDelta: candidateEvaluation.score - selectedEvaluation.score } : {}),
          };
        });
        searchRounds.push(candidateRound(
          round,
          refinedGenerated.length,
          refined,
          refinedEvaluations,
          improved,
          stopReason,
          skippedRefined,
          refinedRecords.map(({ signature }) => signature),
          repairProposals,
          candidateResults,
          repairAttempts,
          scope,
        ));
        if (budgetExhausted) break;
        if (pageLocalPass && !improved) {
          while (scheduleIndex + 1 < refinementSchedule.length
            && refinementSchedule[scheduleIndex + 1]?.kind === 'page'
            && scopedPage(refinementSchedule[scheduleIndex + 1]) === scopedPage(scope)) scheduleIndex += 1;
        }
      }
      const refinementMs = Math.max(0, Date.now() - refinementStartedAt);
      const plan = candidates[selectedCandidate];
      const evaluation = evaluations[selectedCandidate];
      preserveCoarseSeedEvidence(document, candidates[0]!, plan);
      const candidateSearch: CompositionCandidateSearchTrace = {
        rounds: searchRounds,
        generatedCandidates: searchRounds.reduce((total, round) => total + round.generatedCandidates, 0),
        evaluatedCandidates: searchRounds.reduce((total, round) => total + round.evaluatedCandidates, 0),
        fullPlanRecalculations: evaluations.length,
        planningTimeMs: Math.max(0, Date.now() - startedAt),
        phaseTimings: {
          planningMs,
          materializationMs,
          proposalGenerationMs: Math.max(0, planningMs + refinementMs - materializationMs),
          initialEvaluationMs,
          evaluationMs: initialEvaluationMs + refinementEvaluationMs,
          refinementMs,
        },
        stopReason: searchStopReason(evaluation, searchRounds),
        remainingBudget: Math.max(0, maxRecalculations - evaluations.length),
        untestedAlternatives: searchHasUntestedAlternatives(evaluation, searchRounds),
        selectedCandidate,
        selectedProposalSignature: candidateSignatures[selectedCandidate] ?? 'seed',
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
    continueFromBaseline(document, metrics, baseline) {
      const priorSearch = baseline.plan.trace?.candidateSearch;
      const priorSearchSnapshot = priorSearch === undefined ? undefined : {
        ...priorSearch,
        rounds: priorSearch.rounds.map((round) => ({ ...round })),
        phaseTimings: { ...priorSearch.phaseTimings },
      };
      const baselineMaterializationMs = planTimingTotal([baseline.plan], 'document-materialization');
      const signature = priorSearch?.selectedProposalSignature ?? 'selected-baseline';
      const continuationPlanner: CompositionPlanner = {
        ...planner,
        planBaselineCandidatesWithSignatures: undefined,
        planBaselineWithSignature: () => ({ signature, plan: baseline.plan }),
      };
      const continuationEvaluator: CompositionEvaluator = {
        evaluate(input, plan) {
          return plan === baseline.plan ? baseline.evaluation : evaluator.evaluate(input, plan);
        },
      };
      const continued = createCompositionEngine(continuationPlanner, continuationEvaluator).plan(document, metrics);
      mergeBaselineContinuationTrace(continued, baselineMaterializationMs, priorSearchSnapshot);
      return continued;
    },
  };
}
