import type { CompositionBlock, CompositionDocument, CompositionLayout } from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionPlanCandidate,
  CompositionPlanner,
  CompositionTextMetrics,
  CompositionEvaluation,
  CompositionDiagnostic,
  CompositionMoveRepairProposal,
  CompositionRepairProposal,
  CompositionRefinementScope,
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
  assignInsertionGroupsFromPlan,
  insertionProposalCorrections,
  insertionProposalsFromPlan,
  seedInsertionProposalCandidates,
  seedInsertionProposals,
} from './insertion-layout.js';
import { seedGraphicProposals } from './graphic-planning.js';
import { createPlan, planDocumentOnce } from './document-layout.js';
import { regionForSlot, relaxInsertionPlacementGravity } from './placement-gravity.js';
import type { MovableInsertionPolicy, TextCompositionPlannerPolicy } from '../contracts/planner-policy.js';
import { routeLayout } from './page-state.js';
import { readRenderConfig } from '../../template/builtins.js';

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

/** Materialize and stabilize the authored seed without generating alternatives. */
function planBaselineCandidate(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
): CompositionPlanCandidate {
  const maxIterations = policy.maxPlanningIterations ?? 1;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    const plan = createPlan(policy.minimumFragmentLines);
    plan.diagnostics.push(diagnostic('error', 'PLANNER_ITERATION_POLICY_INVALID', 'Planner iteration count must be a positive integer.', { details: { maxIterations } }));
    return { signature: 'invalid-policy', plan };
  }
  const graphicProposals = seedGraphicProposals(document, template);
  let insertionProposals = seedInsertionProposals(document, template, metrics);
  let gravityTrace: ReturnType<typeof relaxInsertionPlacementGravity>['trace'] | undefined;
  if (Object.keys(policy.movableInsertionBounds ?? {}).length === 0) {
    const relaxed = relaxInsertionPlacementGravity(document, template, insertionProposals);
    insertionProposals = relaxed.proposals;
    gravityTrace = relaxed.trace;
  }
  let previousSignature: string | undefined;
  let latestPlan = planDocumentOnce(document, metrics, template, policy, insertionProposals, graphicProposals);
  if (gravityTrace && gravityTrace.movedCount > 0) {
    const decision = recordPlanDecision(latestPlan, 'PLACEMENT_GRAVITY_RELAXED');
    decision.iterations = gravityTrace.iterations;
    decision.movedCount = gravityTrace.movedCount;
    decision.maxDisplacement = gravityTrace.maxDisplacement;
    decision.groupCount = gravityTrace.groupCount;
    decision.anchorCount = gravityTrace.anchorCount;
    decision.stoppedBy = gravityTrace.stoppedBy;
  }
  const groupedInsertionProposals = assignInsertionGroupsFromPlan(document, template, latestPlan, metrics, insertionProposals);
  const changedGroupKeys = [...new Set([...insertionProposals.keys(), ...groupedInsertionProposals.keys()])]
    .filter((key) => {
      const before = insertionProposals.get(key);
      const after = groupedInsertionProposals.get(key);
      return before?.page !== after?.page || before?.slotId !== after?.slotId
        || before?.box.x !== after?.box.x || before?.box.y !== after?.box.y
        || before?.box.width !== after?.box.width || before?.box.height !== after?.box.height;
    });
  if (changedGroupKeys.length > 0) {
    insertionProposals = groupedInsertionProposals;
    latestPlan = planDocumentOnce(document, metrics, template, policy, insertionProposals, graphicProposals);
    const decision = recordPlanDecision(latestPlan, 'PLACEMENT_GROUPS_ASSIGNED');
    decision.insertionCount = insertionProposals.size;
    decision.changedKeys = changedGroupKeys;
  }
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
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
      return { signature: proposalSignature(insertionProposals, graphicProposals), plan: latestPlan };
    }
    if (iteration === maxIterations) {
      recordPlanningPhase(latestPlan, 'reflow', 'failed', { insertionCount: nextProposals.size, signature, iterations: maxIterations }, iteration);
      latestPlan.diagnostics.push(diagnostic('error', 'PLANNER_DID_NOT_STABILIZE', `Planner did not stabilize after ${maxIterations} pass(es).`, { details: { iterations: maxIterations, insertionCount: nextProposals.size } }));
      return { signature: proposalSignature(insertionProposals, graphicProposals), plan: latestPlan };
    }
    insertionProposals = nextProposals;
    previousSignature = signature;
    latestPlan = planDocumentOnce(document, metrics, template, policy, insertionProposals, graphicProposals);
  }
  return { signature: proposalSignature(insertionProposals, graphicProposals), plan: latestPlan };
}

const INSERTION_LEGALITY_CORRECTION_CODES = new Set([
  'INSERTION_PLAN_MISSING',
  'INSERTION_SLOT_NOT_FOUND',
  'INSERTION_OVERFLOW',
]);

function affectedInsertionKeys(diagnostics: readonly CompositionDiagnostic[]): Set<string> {
  return new Set(diagnostics
    .filter((diagnostic) => INSERTION_LEGALITY_CORRECTION_CODES.has(diagnostic.code))
    .filter((diagnostic): diagnostic is CompositionDiagnostic & { flowId: string; blockId: string } => diagnostic.flowId !== undefined && diagnostic.blockId !== undefined)
    .map((diagnostic) => insertionKey(diagnostic.flowId, diagnostic.blockId)));
}

/** Materialize only compatible-slot corrections named by hard insertion diagnostics. */
function planLegalityCorrectionRecords(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  selected: CompositionPlan,
  rejectedEvaluation: CompositionEvaluation,
  remainingBudget: number,
): CompositionPlanCandidate[] {
  if (remainingBudget <= 0) return [];
  const affectedKeys = affectedInsertionKeys(rejectedEvaluation.hardViolations);
  if (affectedKeys.size === 0) return [];
  const insertionSeeds = seedInsertionProposals(document, template, metrics);
  for (const decision of selected.decisions) {
    if (decision.code === 'OPTIONAL_INSERTION_OMITTED' && typeof decision.flowId === 'string' && typeof decision.blockId === 'string') {
      insertionSeeds.delete(insertionKey(decision.flowId, decision.blockId));
    }
  }
  const current = selectedInsertionSeeds(insertionSeeds, selected);
  const graphicSeeds = selectedGraphicSeeds(seedGraphicProposals(document, template), selected);
  return insertionProposalCorrections(document, template, metrics, current, affectedKeys, remainingBudget)
    .map((proposals) => {
      const changedKeys = [...affectedKeys].filter((key) => current.get(key) !== proposals.get(key));
      return {
        signature: proposalSignature(proposals, graphicSeeds),
        plan: planDocumentOnce(document, metrics, template, policy, proposals, graphicSeeds),
        ...(changedKeys.length === 0 ? {} : { repairProposalIds: changedKeys.map((key) => `legality:insertion-correction:${key}`) }),
      };
    });
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
  const seededProposalCandidates = seedInsertionProposalCandidates(
    document,
    template,
    metrics,
    initialCandidateLimit,
    Object.keys(policy.movableInsertionBounds ?? {}).length === 0,
  );
  const seededGraphicProposals = seedGraphicProposals(document, template);
  const initialSeed = seededProposalCandidates[0]!;
  const provisionalSeedPlan = planDocumentOnce(document, metrics, template, policy, initialSeed, seededGraphicProposals);
  const groupedSeed = assignInsertionGroupsFromPlan(document, template, provisionalSeedPlan, metrics, initialSeed);
  const effectivePolicy = policyWithAutomaticMovableInsertionBounds(
    document,
    template,
    selectedInsertionSeeds(groupedSeed, provisionalSeedPlan),
    policy,
  );
  const seededProposals = groupedSeed;
  const groupedSeedCandidates = movableInsertionProposalSignature(groupedSeed) === movableInsertionProposalSignature(initialSeed)
    ? seededProposalCandidates
    : [groupedSeed, ...seededProposalCandidates.slice(1)];
  const insertionAlternatives = groupedSeedCandidates.flatMap((seed) =>
    movableInsertionProposalCandidates(seed, effectivePolicy.movableInsertionBounds ?? {}, initialCandidateLimit));
  const movableCandidates = [...new Map([...groupedSeedCandidates, ...insertionAlternatives]
    .map((proposal) => [movableInsertionProposalSignature(proposal), proposal] as const)).values()];
  const movableGraphicCandidates = [...new Map([seededGraphicProposals, ...movableGraphicProposalCandidates(seededGraphicProposals, policy.movableGraphicBounds ?? {}, initialCandidateLimit)]
    .map((proposal) => [movableGraphicProposalSignature(proposal), proposal] as const)).values()];
  if (movableCandidates.length > 1 || movableGraphicCandidates.length > 1) {
    const combinations = combineProposalCandidates(
      movableCandidates,
      movableGraphicCandidates,
      initialCandidateLimit,
      (insertionSet, graphicSet) => `${movableInsertionProposalSignature(insertionSet)}||${movableGraphicProposalSignature(graphicSet)}`,
    );
    return combinations.map(({ left, right }) => ({
      signature: proposalSignature(left, right),
      plan: planDocumentOnce(document, metrics, template, effectivePolicy, left, right),
    }));
  }
  let proposals = seededProposals;
  let previousSignature: string | undefined;
  let latestPlan = planDocumentOnce(document, metrics, template, effectivePolicy, proposals, seededGraphicProposals);
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
    latestPlan = planDocumentOnce(document, metrics, template, effectivePolicy, proposals, seededGraphicProposals);
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

/**
 * Give every quote placed in a fluid capability a bounded local movement
 * window. The capability determines the legal region; the planner config
 * determines how far and how finely the evaluator may search inside it.
 */
function automaticMovableInsertionBounds(
  document: CompositionDocument,
  template: CompositionLayout,
  proposals: Map<string, import('./planner-candidates.js').PlannedInsertion>,
): MovableInsertionPolicy {
  const search = readRenderConfig().compositionSearch;
  const movementWindowRatio = search.movableWindowRatio;
  const candidateCount = search.movableCandidateCount;
  if (movementWindowRatio === undefined || candidateCount === undefined
    || !(movementWindowRatio > 0) || !Number.isInteger(candidateCount) || candidateCount < 1) return {};
  const bounds: MovableInsertionPolicy = {};
  for (const [key, proposal] of proposals) {
    const block: CompositionBlock | undefined = document.flows[proposal.flowId]?.blocks.find((candidate) => candidate.id === proposal.blockId);
    if (!block || block.role !== 'quote') continue;
    const route = template.routes[proposal.flowId];
    const pageLayout = route ? routeLayout(route, template, proposal.page) : undefined;
    const slotId = proposal.slotId.replace(/^\d+:/u, '');
    const slot = pageLayout?.slots.find((candidate) => candidate.id === slotId)
      ?? pageLayout?.slots.find((candidate) => candidate.placement?.mode === 'fluid-y'
        && candidate.flowId === proposal.flowId
        && (candidate.allowedRoles === undefined || candidate.allowedRoles.includes(block.role)));
    if (!slot || slot.placement?.mode !== 'fluid-y') continue;
    const region = regionForSlot(template, proposal, slot);
    const pageHeight = pageLayout?.height ?? region.height;
    const movementWindow = pageHeight * movementWindowRatio;
    const minimumY = Math.max(region.y, proposal.box.y - movementWindow);
    const maximumY = Math.min(region.y + region.height - proposal.box.height, proposal.box.y + movementWindow);
    if (minimumY > maximumY) continue;
    bounds[key] = {
      bounds: {
        x: proposal.box.x,
        y: minimumY,
        width: proposal.box.width,
        height: maximumY - minimumY + proposal.box.height,
      },
      axis: 'y',
      preferred: { y: proposal.box.y },
      candidateCount,
      refinementRounds: search.movableRefinementRounds,
      ...(search.movableRefinementCandidateCount === undefined ? {} : { refinementCandidateCount: search.movableRefinementCandidateCount }),
    };
  }
  return bounds;
}

function policyWithAutomaticMovableInsertionBounds(
  document: CompositionDocument,
  template: CompositionLayout,
  proposals: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  policy: TextCompositionPlannerPolicy,
): TextCompositionPlannerPolicy {
  const automatic = automaticMovableInsertionBounds(document, template, proposals);
  const explicit = policy.movableInsertionBounds ?? {};
  const movableInsertionBounds = { ...automatic, ...explicit };
  if (Object.keys(movableInsertionBounds).length === 0) return policy;
  return { ...policy, movableInsertionBounds };
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

function movementDistance(
  repair: CompositionMoveRepairProposal,
  policy: TextCompositionPlannerPolicy,
  round: number,
): number | undefined {
  const minimumStep = policy.searchBudget?.minimumGeometryStepMm;
  const distance = repair.estimateKind === 'orphan-recovery' || repair.estimateKind === 'fragmentation-recovery'
    ? repair.distance
    : repair.distance / (2 ** Math.max(0, round - 1));
  return minimumStep !== undefined && distance < minimumStep ? undefined : distance;
}

function applyMoveRepair(
  repair: CompositionMoveRepairProposal,
  policy: TextCompositionPlannerPolicy,
  round: number,
  insertionSeeds: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  graphicSeeds: Map<string, import('./planner-candidates.js').PlannedGraphic>,
): boolean {
  const distance = movementDistance(repair, policy, round);
  if (distance === undefined) return false;
  const delta = repair.direction === 'left' || repair.direction === 'up' ? -distance : distance;
  const graphicId = repair.placement.graphicId;
  if (!graphicId) return false;
  if (graphicId.startsWith('insertion:')) {
    const blockId = repair.placement.blockId ?? graphicId.slice('insertion:'.length);
    const flowId = repair.placement.flowId;
    const entry = [...insertionSeeds.entries()].find(([, proposal]) => proposal.blockId === blockId && (flowId === undefined || proposal.flowId === flowId));
    if (!entry) return false;
    const [key, current] = entry;
    const movement = policy.movableInsertionBounds?.[key];
    if (!movement || (movement.axis ?? 'y') !== repair.axis) return false;
    const movedBox = { ...current.box, [repair.axis]: current.box[repair.axis] + delta };
    if (!rectFitsMovementBounds(movedBox, movement.bounds)) return false;
    insertionSeeds.set(key, { ...current, box: movedBox });
    return true;
  }
  const current = graphicSeeds.get(graphicId);
  const movement = policy.movableGraphicBounds?.[graphicId];
  if (!current || !movement || (movement.axis ?? 'y') !== repair.axis) return false;
  const movedBox = { ...current.box, [repair.axis]: current.box[repair.axis] + delta };
  if (!rectFitsMovementBounds(movedBox, movement.bounds)) return false;
  graphicSeeds.set(graphicId, { ...current, box: movedBox });
  return true;
}

function moveProposalCandidate(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  policy: TextCompositionPlannerPolicy,
  insertionSeeds: Map<string, import('./planner-candidates.js').PlannedInsertion>,
  graphicSeeds: Map<string, import('./planner-candidates.js').PlannedGraphic>,
  repairs: CompositionMoveRepairProposal[],
  round: number,
): CompositionPlanCandidate | undefined {
  const nextInsertions = new Map(insertionSeeds);
  const nextGraphics = new Map(graphicSeeds);
  const placementIds = new Set<string>();
  for (const repair of repairs) {
    const placementId = repair.placement.graphicId ?? repair.placement.id;
    if (placementIds.has(placementId) || !applyMoveRepair(repair, policy, round, nextInsertions, nextGraphics)) return undefined;
    placementIds.add(placementId);
  }
  return {
    signature: proposalSignature(nextInsertions, nextGraphics),
    plan: planDocumentOnce(document, metrics, template, policy, nextInsertions, nextGraphics),
  };
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
  if (repair.action === 'relocate') {
    const graphicId = repair.placement.graphicId;
    const flowId = repair.placement.flowId;
    const blockId = repair.placement.blockId ?? graphicId?.replace(/^insertion:/u, '');
    if (!graphicId?.startsWith('insertion:') || !flowId || !blockId) return undefined;
    const entry = [...insertionSeeds.entries()].find(([, proposal]) => proposal.flowId === flowId && proposal.blockId === blockId);
    if (!entry) return undefined;
    const nextInsertions = new Map(insertionSeeds);
    nextInsertions.set(entry[0], {
      ...entry[1],
      page: repair.destination.page,
      slotId: repair.destination.slotId.replace(/^\d+:/u, ''),
      box: { ...repair.destination.box },
    });
    const movableInsertionBounds = { ...(policy.movableInsertionBounds ?? {}) };
    delete movableInsertionBounds[entry[0]];
    const relocationPolicy: TextCompositionPlannerPolicy = {
      ...policy,
      ...(Object.keys(movableInsertionBounds).length === 0
        ? { movableInsertionBounds: undefined }
        : { movableInsertionBounds }),
    };
    return {
      signature: proposalSignature(nextInsertions, graphicSeeds),
      plan: planDocumentOnce(document, metrics, template, relocationPolicy, nextInsertions, graphicSeeds),
    };
  }
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
  if (repair.action !== 'move') return undefined;
  return moveProposalCandidate(document, metrics, template, policy, insertionSeeds, graphicSeeds, [repair], round);
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
  scope?: CompositionRefinementScope,
): CompositionPlanCandidate[] {
  const repairs = (evaluation?.repairProposals ?? []).filter((repair) => repairTouchesScope(repair, scope));
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
  const moveRepairs = repairs.filter((repair): repair is CompositionMoveRepairProposal => repair.action === 'move');
  const pairLimit = Number.isInteger(limit) && limit! > 0 ? limit! : 0;
  let pairCount = 0;
  for (let left = 0; left < moveRepairs.length && pairCount < pairLimit; left += 1) {
    for (let right = left + 1; right < moveRepairs.length && pairCount < pairLimit; right += 1) {
      if (Number.isInteger(limit) && limit! > 0 && candidates.size >= limit!) break;
      const first = moveRepairs[left]!;
      const second = moveRepairs[right]!;
      if (first.placement.graphicId === second.placement.graphicId) continue;
      const candidate = moveProposalCandidate(document, metrics, template, policy, insertionSeeds, graphicSeeds, [first, second], round);
      pairCount += 1;
      if (!candidate) continue;
      const previous = candidates.get(candidate.signature);
      const repairProposalIds = [...new Set([...(previous?.repairProposalIds ?? []), first.id, second.id])];
      candidates.set(candidate.signature, { ...candidate, repairProposalIds });
    }
  }
  return [...candidates.values()];
}

function repairTouchesScope(repair: CompositionRepairProposal, scope?: CompositionRefinementScope): boolean {
  if (!scope || scope.kind === 'document') return true;
  return repair.placement.page === scope.page
    || (repair.action === 'relocate' && repair.destination.page === scope.page);
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
  scope?: CompositionRefinementScope,
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
    .filter((graphic) => !scope || scope.kind === 'document' || graphic.page === scope.page)
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));
  const selectedGraphicPlacements = selected.graphicPlacements
    .filter((graphic) => policy.movableGraphicBounds?.[graphic.graphicId] !== undefined)
    .filter((graphic) => !scope || scope.kind === 'document' || graphic.page === scope.page)
    .map(({ graphicId, page, slotId, box }) => ({ graphicId, page, slotId, box }));

  const selectedSeeds = selectedInsertionSeeds(seededProposals, selected);
  const scopedSelectedSeeds = new Map([...selectedSeeds].filter(([, proposal]) => selectedPlacements.some((placement) =>
    placement.graphicId === `insertion:${proposal.blockId}`
      && placement.page === proposal.page
      && placement.slotId.replace(/^\d+:/u, '') === proposal.slotId.replace(/^\d+:/u, ''))));
  const scopedExplicitBounds = Object.fromEntries(Object.entries(policy.movableInsertionBounds ?? {})
    .filter(([key]) => scopedSelectedSeeds.has(key)));
  const effectivePolicy = policyWithAutomaticMovableInsertionBounds(
    document,
    template,
    scopedSelectedSeeds,
    { ...policy, movableInsertionBounds: scopedExplicitBounds },
  );
  const refinementLimit = effectivePolicy.searchBudget?.maxCandidatesPerRefinement;
  const defaultRefinementRounds = effectivePolicy.searchBudget?.movableRefinementRounds ?? 0;
  const minimumGeometryStep = effectivePolicy.searchBudget?.minimumGeometryStepMm;
  const insertionRefinements = movableInsertionProposalRefinements(
    seededProposals,
    selectedPlacements,
    effectivePolicy.movableInsertionBounds ?? {},
    round,
    refinementLimit,
    defaultRefinementRounds,
    minimumGeometryStep,
  );
  const graphicRefinements = movableGraphicProposalRefinements(
    seededGraphicProposals,
    selectedGraphicPlacements,
    effectivePolicy.movableGraphicBounds ?? {},
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
      plan: planDocumentOnce(document, metrics, template, effectivePolicy, left, right),
    }));
  const repairs = evaluatorRepairCandidates(document, metrics, template, effectivePolicy, selected, evaluation, seededProposals, seededGraphicProposals, round, scope);
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
    planBaselineWithSignature(document, metrics) {
      return planBaselineCandidate(document, metrics, template, policy);
    },
    planLegalityCorrectionsWithSignatures(document, metrics, selected, rejectedEvaluation, _round, remainingBudget) {
      return planLegalityCorrectionRecords(document, metrics, template, policy, selected, rejectedEvaluation, remainingBudget);
    },
    planQualityRepairsWithSignatures(document, metrics, selected, legalEvaluation, round, _remainingBudget, scope) {
      return planRefinedCandidateRecords(document, metrics, template, policy, selected, round, legalEvaluation, scope);
    },
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
    // Refinement is driven by evaluator repairs as well as authored movement
    // windows.  Keep the configured search cap authoritative so a second
    // repair pass can act on the plan selected by the preceding pass.
    candidateRefinementRounds: policy.searchBudget?.maxRefinementRounds
      ?? Math.max(
        0,
        ...Object.values(policy.movableInsertionBounds ?? {}).map((bounds) => bounds.refinementRounds ?? policy.searchBudget?.movableRefinementRounds ?? 0),
        ...Object.values(policy.movableGraphicBounds ?? {}).map((bounds) => bounds.refinementRounds ?? policy.searchBudget?.movableRefinementRounds ?? 0),
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
