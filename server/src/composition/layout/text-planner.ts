import type { CompositionDocument, CompositionLayout } from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionPlanCandidate,
  CompositionPlanner,
  CompositionTextMetrics,
  CompositionEvaluation,
  CompositionRepairProposal,
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
  insertionKey,
} from './planner-candidates.js';
import {
  insertionProposalsFromPlan,
  seedInsertionProposalCandidates,
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
  const initialCandidateLimit = policy.searchBudget?.maxInitialCandidates;
  const seededProposalCandidates = seedInsertionProposalCandidates(document, template, metrics, initialCandidateLimit);
  const seededProposals = seededProposalCandidates[0]!;
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const movableCandidates = [...new Map(seededProposalCandidates
    .flatMap((seed) => movableInsertionProposalCandidates(seed, policy.movableInsertionBounds ?? {}, initialCandidateLimit))
    .map((proposal) => [movableInsertionProposalSignature(proposal), proposal] as const)).values()];
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

function selectedInsertionSeeds(
  seeded: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  selected: CompositionPlan,
): Map<string, import('./planner-candidates.js').PlannedInsertion> {
  const current = new Map(seeded);
  for (const graphic of selected.graphicPlacements.filter((placement) => placement.graphicId.startsWith('insertion:'))) {
    const blockId = graphic.graphicId.slice('insertion:'.length);
    const flowId = selected.slots.find((slot) => slot.page === graphic.page && slot.id === graphic.slotId)?.flowId;
    const entry = [...seeded.entries()].find(([, proposal]) => proposal.blockId === blockId && (flowId === undefined || proposal.flowId === flowId));
    if (!entry) continue;
    const [key, proposal] = entry;
    current.set(key, {
      ...proposal,
      page: graphic.page,
      slotId: graphic.slotId.replace(/^\d+:/u, ''),
      box: { ...graphic.box },
    });
  }
  return current;
}

function selectedGraphicSeeds(
  seeded: Map<string, import('./planner-candidates.js').PlannedGraphic>,
  selected: CompositionPlan,
): Map<string, import('./planner-candidates.js').PlannedGraphic> {
  const current = new Map(seeded);
  for (const graphic of selected.graphicPlacements) {
    const proposal = seeded.get(graphic.graphicId);
    if (!proposal) continue;
    current.set(graphic.graphicId, {
      ...proposal,
      page: graphic.page,
      slotId: graphic.slotId.replace(/^\d+:/u, ''),
      box: { ...graphic.box },
    });
  }
  return current;
}

function proposalCandidate(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  insertionSeeds: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  graphicSeeds: Map<string, import('./planner-candidates.js').PlannedGraphic>,
  repair: CompositionRepairProposal,
  round: number,
): CompositionPlanCandidate | undefined {
  if (repair.action === 'omit') {
    const flowId = repair.placement.flowId;
    const blockId = repair.placement.blockId;
    if (!flowId || flowId === 'main' || !blockId) return undefined;
    const block = document.flows[flowId]?.blocks.find((candidate) => candidate.id === blockId);
    if (block?.allowOmission !== true) return undefined;
    const entry = [...insertionSeeds.entries()].find(([, proposal]) => proposal.flowId === flowId && proposal.blockId === blockId);
    if (!entry) return undefined;
    const nextInsertions = new Map(insertionSeeds);
    nextInsertions.delete(entry[0]);
    const signature = proposalSignature(nextInsertions, graphicSeeds);
    return {
      signature,
      plan: planDocumentOnce(document, metrics, template, policy, nextInsertions, graphicSeeds),
    };
  }
  const minimumStep = policy.searchBudget?.minimumGeometryStepMm;
  const distance = repair.estimateKind === 'orphan-recovery' || repair.estimateKind === 'fragmentation-recovery'
    ? repair.distance
    : repair.distance / (2 ** Math.max(0, round - 1));
  if (minimumStep !== undefined && distance < minimumStep) return undefined;
  const nextInsertions = new Map(insertionSeeds);
  const nextGraphics = new Map(graphicSeeds);
  const delta = repair.direction === 'left' || repair.direction === 'up' ? -distance : distance;
  const graphicId = repair.placement.graphicId;
  if (!graphicId) return undefined;
  if (graphicId.startsWith('insertion:')) {
    const blockId = repair.placement.blockId ?? graphicId.slice('insertion:'.length);
    const flowId = repair.placement.flowId;
    const entry = [...nextInsertions.entries()].find(([, proposal]) => proposal.blockId === blockId && (flowId === undefined || proposal.flowId === flowId));
    if (!entry) return undefined;
    const [key, current] = entry;
    const movement = policy.movableInsertionBounds?.[key];
    if (!movement || (movement.axis ?? 'y') !== repair.axis) return undefined;
    const movedBox = { ...current.box, [repair.axis]: current.box[repair.axis] + delta };
    if (!rectFitsMovementBounds(movedBox, movement.bounds)) return undefined;
    nextInsertions.set(key, { ...current, box: movedBox });
  } else {
    const current = nextGraphics.get(graphicId);
    const movement = policy.movableGraphicBounds?.[graphicId];
    if (!current || !movement || (movement.axis ?? 'y') !== repair.axis) return undefined;
    const movedBox = { ...current.box, [repair.axis]: current.box[repair.axis] + delta };
    if (!rectFitsMovementBounds(movedBox, movement.bounds)) return undefined;
    nextGraphics.set(graphicId, { ...current, box: movedBox });
  }
  const signature = proposalSignature(nextInsertions, nextGraphics);
  return {
    signature,
    plan: planDocumentOnce(document, metrics, template, policy, nextInsertions, nextGraphics),
  };
}

function rectFitsMovementBounds(
  box: { x: number; y: number; width: number; height: number },
  bounds: { x: number; y: number; width: number; height: number },
): boolean {
  return box.x >= bounds.x
    && box.y >= bounds.y
    && box.x + box.width <= bounds.x + bounds.width
    && box.y + box.height <= bounds.y + bounds.height;
}

function evaluatorRepairCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  evaluation: CompositionEvaluation | undefined,
  seededProposals: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  seededGraphicProposals: Map<string, import('./planner-candidates.js').PlannedGraphic>,
  round: number,
): CompositionPlanCandidate[] {
  const repairs = evaluation?.repairProposals ?? [];
  if (repairs.length === 0) return [];
  const insertionSeeds = selectedInsertionSeeds(seededProposals, selected);
  const graphicSeeds = selectedGraphicSeeds(seededGraphicProposals, selected);
  const limit = policy.searchBudget?.maxCandidatesPerRefinement;
  const candidates = new Map<string, CompositionPlanCandidate>();
  for (const repair of repairs) {
    const candidate = proposalCandidate(document, metrics, template, policy, selected, insertionSeeds, graphicSeeds, repair, round);
    if (candidate) {
      const previous = candidates.get(candidate.signature);
      const repairProposalIds = [...new Set([...(previous?.repairProposalIds ?? []), repair.id])];
      candidates.set(candidate.signature, { ...candidate, repairProposalIds });
    }
    if (Number.isInteger(limit) && limit! > 0 && candidates.size >= limit!) break;
  }
  return [...candidates.values()];
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
  evaluation?: CompositionEvaluation,
): CompositionPlanCandidate[] {
  const seededProposals = seedInsertionProposals(document, template, metrics);
  for (const decision of selected.decisions) {
    if (decision.code === 'OPTIONAL_INSERTION_OMITTED' && typeof decision.flowId === 'string' && typeof decision.blockId === 'string') {
      seededProposals.delete(insertionKey(decision.flowId, decision.blockId));
    }
  }
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const selectedPlacements = selected.graphicPlacements
    .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const selectedGraphicPlacements = selected.graphicPlacements
    .filter((graphic) => policy.movableGraphicBounds?.[graphic.graphicId] !== undefined)
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const refinementLimit = policy.searchBudget?.maxCandidatesPerRefinement;
  const defaultRefinementRounds = policy.searchBudget?.movableRefinementRounds ?? 0;
  const minimumGeometryStep = policy.searchBudget?.minimumGeometryStepMm;
  const insertionRefinements = movableInsertionProposalRefinements(
    seededProposals,
    selectedPlacements,
    policy.movableInsertionBounds ?? {},
    round,
    refinementLimit,
    defaultRefinementRounds,
    minimumGeometryStep,
  );
  const graphicRefinements = movableGraphicProposalRefinements(
    seededGraphicProposals,
    selectedGraphicPlacements,
    policy.movableGraphicBounds ?? {},
    round,
    refinementLimit,
    defaultRefinementRounds,
    minimumGeometryStep,
  );
  const insertionCandidates = insertionRefinements.length > 0 ? insertionRefinements : [seededProposals];
  const graphicCandidates = graphicRefinements.length > 0 ? graphicRefinements : [seededGraphicProposals];
  const configuredRefinements: CompositionPlanCandidate[] = insertionRefinements.length === 0 && graphicRefinements.length === 0
    ? []
    : combineProposalCandidates(
    insertionCandidates,
    graphicCandidates,
    refinementLimit,
    (insertionSet, graphicSet) => `${movableInsertionProposalSignature(insertionSet)}||${movableGraphicProposalSignature(graphicSet)}`,
    ).map(({ left, right }) => ({
      signature: proposalSignature(left, right),
      plan: planDocumentOnce(document, metrics, template, policy, left, right),
    }));
  const repairs = evaluatorRepairCandidates(document, metrics, template, policy, selected, evaluation, seededProposals, seededGraphicProposals, round);
  const candidates = new Map<string, CompositionPlanCandidate>();
  for (const candidate of [...repairs, ...configuredRefinements]) {
    if (candidates.size >= (refinementLimit ?? Number.MAX_SAFE_INTEGER)) break;
    const previous = candidates.get(candidate.signature);
    const repairProposalIds = [...new Set([...(previous?.repairProposalIds ?? []), ...(candidate.repairProposalIds ?? [])])];
    candidates.set(candidate.signature, { ...previous, ...candidate, ...(repairProposalIds.length ? { repairProposalIds } : {}) });
  }
  return [...candidates.values()];
}

function planRefinedCandidates(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  round: number,
  evaluation?: CompositionEvaluation,
): CompositionPlan[] {
  return planRefinedCandidateRecords(document, metrics, template, policy, selected, round, evaluation).map(({ plan }) => plan);
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
        ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? policy.searchBudget?.movableRefinementRounds ?? 0),
        ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? policy.searchBudget?.movableRefinementRounds ?? 0),
      ),
    ),
    /**
 * @planner-target composition/layout/text-planner.ts
     * @planner-responsibility Keep the current planRefinedCandidates implementation intact until its target seam is extracted.
     */
    planRefinedCandidates(document, metrics, selected, round, evaluation) {
      return planRefinedCandidates(document, metrics, template, policy, selected, round, evaluation);
    },
    planRefinedCandidatesWithSignatures(document, metrics, selected, round, evaluation) {
      return planRefinedCandidateRecords(document, metrics, template, policy, selected, round, evaluation);
    },
  };
}
