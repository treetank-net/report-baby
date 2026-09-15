import type { CompositionDocument, CompositionLayout } from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionPlanCandidate,
  CompositionPlanner,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { diagnostic, recordPlanDecision } from '../observability/planning-observability.js';
import { recordPlanningPhase } from '../observability/planning-observability.js';
import {
  movableGraphicProposalCandidates,
  movableGraphicProposalRefinements,
  movableInsertionProposalCandidates,
  movableInsertionProposalRefinements,
  movableInsertionProposalSignature,
  movableGraphicProposalSignature,
  combineProposalCandidates,
} from './planner-candidates.js';
import {
  insertionProposalsFromPlan,
  seedInsertionProposals,
} from './insertion-layout.js';
import { seedGraphicProposals } from './graphic-planning.js';
import { createPlan, planDocumentOnce } from './document-layout.js';
import type { TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';

export type { MovableGraphicPolicy, MovableInsertionBounds } from '../contracts/planner-policy.js';
export { lineHeight, styleFor, textPadding, wrapBlock, wordsForBlock } from '../text/text-layout.js';
export { addResidual, addTableResidual, diagnostic } from '../observability/planning-observability.js';
export { ensurePage, routeLayout, routeSlots, slotId, validateGrowthPolicies } from './page-state.js';
export { rectBottom, rectsOverlap } from '../geometry/rectangles.js';
export { placeLines } from '../text/text-layout.js';
export { placeGraphicsForPage } from './graphic-planning.js';
export type { TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';

function proposalSignature(
  insertionProposals: Parameters<typeof movableInsertionProposalSignature>[0],
  graphicProposals: Parameters<typeof movableGraphicProposalSignature>[0],
): string {
  return `${movableInsertionProposalSignature(insertionProposals)}||${movableGraphicProposalSignature(graphicProposals)}`;
}

/** Plan every deterministic candidate produced by one planner pass. */
/**
 * @planner-target composition/layout/text-planner.ts
 * @planner-responsibility Keep the current planCandidates implementation intact until its target seam is extracted.
 */
function planCandidateRecords(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
): CompositionPlanCandidate[] {
  const maxIterations = policy.maxPlanningIterations ?? 1;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    const plan = createPlan(policy.minimumFragmentLines);
    plan.diagnostics.push(diagnostic('error', 'PLANNER_ITERATION_POLICY_INVALID', 'Planner iteration count must be a positive integer.', { details: { maxIterations } }));
    return [{ signature: 'invalid-policy', plan }];
  }
  const candidates: CompositionPlanCandidate[] = [];
  const seededProposals = seedInsertionProposals(document, template, metrics);
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const initialCandidateLimit = policy.searchBudget?.maxInitialCandidates;
  const movableCandidates = movableInsertionProposalCandidates(seededProposals, policy.movableInsertionBounds ?? {}, initialCandidateLimit);
  const movableGraphicCandidates = movableGraphicProposalCandidates(seededGraphicProposals, policy.movableGraphicBounds ?? {}, initialCandidateLimit);
  if (movableCandidates.length > 1 || movableGraphicCandidates.length > 1) {
    const combinations = combineProposalCandidates(
      movableCandidates,
      movableGraphicCandidates,
      initialCandidateLimit,
      (insertionSet, graphicSet) => `${movableInsertionProposalSignature(insertionSet)}||${movableGraphicProposalSignature(graphicSet)}`,
    );
    return combinations.map(({ left, right }) => ({
      signature: proposalSignature(left, right),
      plan: planDocumentOnce(document, metrics, template, policy, left, right),
    }));
  }
  let proposals = seededProposals;
  let previousSignature: string | undefined;
  let latestPlan = planDocumentOnce(document, metrics, template, policy, proposals, seededGraphicProposals);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    candidates.push({ signature: proposalSignature(proposals, seededGraphicProposals), plan: latestPlan });
    const nextProposals = insertionProposalsFromPlan(document, template, latestPlan, metrics);
    const signature = movableInsertionProposalSignature(nextProposals);
    const passDecision = recordPlanDecision(latestPlan, 'PLANNER_PASS_COMPLETED');
    passDecision.iteration = iteration;
    passDecision.insertionCount = nextProposals.size;
    passDecision.signature = signature;
    recordPlanningPhase(latestPlan, 'reflow', 'completed', { insertionCount: nextProposals.size, signature }, iteration);
    if (signature === previousSignature || (iteration === 1 && nextProposals.size === 0)) {
      const stabilizedDecision = recordPlanDecision(latestPlan, 'PLANNER_STABILIZED');
      stabilizedDecision.iteration = iteration;
      stabilizedDecision.insertionCount = nextProposals.size;
      return candidates;
    }
    if (iteration === maxIterations) {
      recordPlanningPhase(latestPlan, 'reflow', 'failed', { insertionCount: nextProposals.size, signature, iterations: maxIterations }, iteration);
      latestPlan.diagnostics.push(diagnostic('error', 'PLANNER_DID_NOT_STABILIZE', `Planner did not stabilize after ${maxIterations} pass(es).`, { details: { iterations: maxIterations, insertionCount: nextProposals.size } }));
      return candidates;
    }
    proposals = nextProposals;
    previousSignature = signature;
    latestPlan = planDocumentOnce(document, metrics, template, policy, proposals, seededGraphicProposals);
  }
  return candidates;
}

function planCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
): CompositionPlan[] {
  return planCandidateRecords(document, metrics, template, policy).map(({ plan }) => plan);
}

/** Generate a local candidate neighborhood around the selected plan. */
/**
 * @planner-target composition/layout/text-planner.ts
 * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
 */
function planRefinedCandidateRecords(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  round: number,
): CompositionPlanCandidate[] {
  const seededProposals = seedInsertionProposals(document, template, metrics);
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const selectedPlacements = selected.graphicPlacements
    .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const selectedGraphicPlacements = selected.graphicPlacements
    .filter((graphic) => policy.movableGraphicBounds?.[graphic.graphicId] !== undefined)
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const refinementLimit = policy.searchBudget?.maxCandidatesPerRefinement;
  const insertionRefinements = movableInsertionProposalRefinements(seededProposals, selectedPlacements, policy.movableInsertionBounds ?? {}, round, refinementLimit);
  const graphicRefinements = movableGraphicProposalRefinements(seededGraphicProposals, selectedGraphicPlacements, policy.movableGraphicBounds ?? {}, round, refinementLimit);
  const insertionCandidates = insertionRefinements.length > 0 ? insertionRefinements : [seededProposals];
  const graphicCandidates = graphicRefinements.length > 0 ? graphicRefinements : [seededGraphicProposals];
  if (insertionRefinements.length === 0 && graphicRefinements.length === 0) return [];
  return combineProposalCandidates(
    insertionCandidates,
    graphicCandidates,
    refinementLimit,
    (insertionSet, graphicSet) => `${movableInsertionProposalSignature(insertionSet)}||${movableGraphicProposalSignature(graphicSet)}`,
  ).map(({ left, right }) => ({
    signature: proposalSignature(left, right),
    plan: planDocumentOnce(document, metrics, template, policy, left, right),
  }));
}

function planRefinedCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  round: number,
): CompositionPlan[] {
  return planRefinedCandidateRecords(document, metrics, template, policy, selected, round).map(({ plan }) => plan);
}

/** Expose the candidate planner while retaining the existing planner contract. */
/**
 * @planner-target composition/layout/text-planner.ts
 * @planner-responsibility Expose candidate planning while retaining the existing planner contract.
 */
export function createTextCompositionPlanner(
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy = {},
): CompositionPlanner {
  return {
    searchBudget: policy.searchBudget,
    /**
 * @planner-target composition/layout/text-planner.ts
     * @planner-responsibility Keep the current plan implementation intact until its target seam is extracted.
     */
    plan(document, metrics) {
      return planCandidateRecords(document, metrics, template, policy).at(-1)!.plan;
    },
    /**
 * @planner-target composition/layout/text-planner.ts
     * @planner-responsibility Keep the current planCandidates implementation intact until its target seam is extracted.
     */
    planCandidates(document, metrics) {
      return planCandidates(document, metrics, template, policy);
    },
    planCandidatesWithSignatures(document, metrics) {
      return planCandidateRecords(document, metrics, template, policy);
    },
    candidateRefinementRounds: Math.min(
      policy.searchBudget?.maxRefinementRounds ?? Number.MAX_SAFE_INTEGER,
      Math.max(
        0,
        ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
        ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
      ),
    ),
    /**
 * @planner-target composition/layout/text-planner.ts
     * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
     */
    planRefinedCandidates(document, metrics, selected, round) {
      return planRefinedCandidates(document, metrics, template, policy, selected, round);
    },
    planRefinedCandidatesWithSignatures(document, metrics, selected, round) {
      return planRefinedCandidateRecords(document, metrics, template, policy, selected, round);
    },
  };
}
