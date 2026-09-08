import type { CompositionDocument, CompositionTemplate } from './model.js';
import type {
  CompositionPlan,
  CompositionPlanner,
  CompositionTextMetrics,
} from './engine.js';
import { diagnostic } from './planning-records.js';
import { recordPlanningPhase } from './planning-trace.js';
import {
  movableGraphicProposalCandidates,
  movableGraphicProposalRefinements,
  movableInsertionProposalCandidates,
  movableInsertionProposalRefinements,
  movableInsertionProposalSignature,
  type MovableGraphicPolicy,
  type MovableInsertionBounds,
  type PlannedGraphic,
  type PlannedInsertion,
} from './text-planner-candidates.js';
import {
  insertionProposalsFromPlan,
  seedInsertionProposals,
} from './insertion-planning.js';
import { seedGraphicProposals } from './graphic-planning.js';
import { createPlan, planDocumentOnce } from './document-layout.js';
import type { TextCompositionPlannerPolicy } from './planner-policy.js';

export type { MovableGraphicPolicy, MovableInsertionBounds } from './text-planner-candidates.js';
export { lineHeight, styleFor, textPadding, wrapBlock, wordsForBlock } from './text/text-measurement.js';
export { addResidual, addTableResidual, diagnostic } from './planning-records.js';
export { ensurePage, rectBottom, rectsOverlap, routeLayout, routeSlots, slotId, validateGrowthPolicies } from './page-management.js';
export { placeLines } from './text/text-placement.js';
export { placeGraphicsForPage } from './graphic-planning.js';
export type { TextCompositionPlannerPolicy } from './planner-policy.js';

/** Plan every deterministic candidate produced by one planner pass. */
/**
 * @planner-target composition/text-planner.ts
 * @planner-responsibility Keep the current planCandidates implementation intact until its target seam is extracted.
 */
function planCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
): CompositionPlan[] {
  const maxIterations = policy.maxPlanningIterations ?? 1;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    const plan = createPlan(policy.minimumFragmentLines);
    plan.diagnostics.push(diagnostic('error', 'PLANNER_ITERATION_POLICY_INVALID', 'Planner iteration count must be a positive integer.', { details: { maxIterations } }));
    return [plan];
  }
  const candidates: CompositionPlan[] = [];
  const seededProposals = seedInsertionProposals(document, template, metrics);
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const movableCandidates = movableInsertionProposalCandidates(seededProposals, policy.movableInsertionBounds ?? {});
  const movableGraphicCandidates = movableGraphicProposalCandidates(seededGraphicProposals, policy.movableGraphicBounds ?? {});
  if (movableCandidates.length > 1 || movableGraphicCandidates.length > 1) {
    return movableCandidates.flatMap((insertionSet) => movableGraphicCandidates.map((graphicSet) => planDocumentOnce(document, metrics, template, policy, insertionSet, graphicSet)));
  }
  let proposals = seededProposals;
  let previousSignature: string | undefined;
  let latestPlan = planDocumentOnce(document, metrics, template, policy, proposals, seededGraphicProposals);
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    candidates.push(latestPlan);
    const nextProposals = insertionProposalsFromPlan(document, template, latestPlan, metrics);
    const signature = movableInsertionProposalSignature(nextProposals);
    latestPlan.decisions.push({ code: 'PLANNER_PASS_COMPLETED', iteration, insertionCount: nextProposals.size, signature });
    recordPlanningPhase(latestPlan, 'reflow', 'completed', { insertionCount: nextProposals.size, signature }, iteration);
    if (signature === previousSignature || (iteration === 1 && nextProposals.size === 0)) {
      latestPlan.decisions.push({ code: 'PLANNER_STABILIZED', iteration, insertionCount: nextProposals.size });
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

/** Generate a local candidate neighborhood around the selected plan. */
/**
 * @planner-target composition/text-planner.ts
 * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
 */
function planRefinedCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  round: number,
): CompositionPlan[] {
  const seededProposals = seedInsertionProposals(document, template, metrics);
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const selectedPlacements = selected.graphicPlacements
    .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const selectedGraphicPlacements = selected.graphicPlacements
    .filter((graphic) => policy.movableGraphicBounds?.[graphic.graphicId] !== undefined)
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const insertionRefinements = movableInsertionProposalRefinements(seededProposals, selectedPlacements, policy.movableInsertionBounds ?? {}, round);
  const graphicRefinements = movableGraphicProposalRefinements(seededGraphicProposals, selectedGraphicPlacements, policy.movableGraphicBounds ?? {}, round);
  const insertionCandidates = insertionRefinements.length > 0 ? insertionRefinements : [seededProposals];
  const graphicCandidates = graphicRefinements.length > 0 ? graphicRefinements : [seededGraphicProposals];
  if (insertionRefinements.length === 0 && graphicRefinements.length === 0) return [];
  return insertionCandidates.flatMap((insertionSet) => graphicCandidates.map((graphicSet) => planDocumentOnce(document, metrics, template, policy, insertionSet, graphicSet)));
}

/** Expose the candidate planner while retaining the existing planner contract. */
/**
 * @planner-target composition/text-planner.ts
 * @planner-responsibility Expose candidate planning while retaining the existing planner contract.
 */
export function createTextCompositionPlanner(
  template: CompositionTemplate,
  policy: TextCompositionPlannerPolicy = {},
): CompositionPlanner {
  return {
    /**
     * @planner-target composition/text-planner.ts
     * @planner-responsibility Keep the current plan implementation intact until its target seam is extracted.
     */
    plan(document, metrics) {
      return planCandidates(document, metrics, template, policy).at(-1)!;
    },
    /**
     * @planner-target composition/text-planner.ts
     * @planner-responsibility Keep the current planCandidates implementation intact until its target seam is extracted.
     */
    planCandidates(document, metrics) {
      return planCandidates(document, metrics, template, policy);
    },
    candidateRefinementRounds: Math.max(
      0,
      ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
      ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? 0),
    ),
    /**
     * @planner-target composition/text-planner.ts
     * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
     */
    planRefinedCandidates(document, metrics, selected, round) {
      return planRefinedCandidates(document, metrics, template, policy, selected, round);
    },
  };
}
