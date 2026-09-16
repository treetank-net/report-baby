import type { CompositionRect } from '../contracts/model.js';
import type { MovableInsertionPolicy, MovablePlacementBounds, MovableGraphicPolicy } from '../contracts/planner-policy.js';

export interface PlannedInsertion {
  flowId: string;
  blockId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

export interface PlannedGraphic {
  graphicId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

export interface SelectedInsertionPlacement {
  graphicId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current clamp implementation intact until its target seam is extracted.
 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Expand one measured insertion into legal positions inside its frame.
 * The measured rectangle remains unchanged; only its position moves.
 */
/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movablePlacementBoxes implementation intact until its target seam is extracted.
 */
function movablePlacementBoxes(proposal: { box: CompositionRect }, policy: MovablePlacementBounds): CompositionRect[] {
  const { bounds } = policy;
  const minimumX = bounds.x;
  const maximumX = bounds.x + bounds.width - proposal.box.width;
  const minimumY = bounds.y;
  const maximumY = bounds.y + bounds.height - proposal.box.height;
  const axis = policy.axis ?? 'y';
  const minimum = axis === 'x' ? minimumX : minimumY;
  const maximum = axis === 'x' ? maximumX : maximumY;
  if (minimum > maximum || !Number.isInteger(policy.candidateCount) || policy.candidateCount < 1) return [];
  const preferredX = clamp(policy.preferred?.x ?? proposal.box.x, minimumX, maximumX);
  const preferredY = clamp(policy.preferred?.y ?? proposal.box.y, minimumY, maximumY);
  const boxes = Array.from({ length: policy.candidateCount }, (_, index) => {
    const fraction = policy.candidateCount === 1 ? 0.5 : index / (policy.candidateCount - 1);
    const coordinate = minimum + (maximum - minimum) * fraction;
    return {
      ...proposal.box,
      x: axis === 'x' ? coordinate : preferredX,
      y: axis === 'y' ? coordinate : preferredY,
    };
  });
  const preferredCoordinate = axis === 'x' ? preferredX : preferredY;
  return boxes.sort((left, right) => {
    const leftCoordinate = axis === 'x' ? left.x : left.y;
    const rightCoordinate = axis === 'x' ? right.x : right.y;
    return Math.abs(leftCoordinate - preferredCoordinate) - Math.abs(rightCoordinate - preferredCoordinate);
  });
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movablePlacementRefinementBoxes implementation intact until its target seam is extracted.
 */
function movablePlacementRefinementBoxes(
  proposal: { box: CompositionRect },
  policy: MovablePlacementBounds,
  round: number,
  minimumStep?: number,
): CompositionRect[] {
  const { bounds } = policy;
  const minimumX = bounds.x;
  const maximumX = bounds.x + bounds.width - proposal.box.width;
  const minimumY = bounds.y;
  const maximumY = bounds.y + bounds.height - proposal.box.height;
  const axis = policy.axis ?? 'y';
  const minimum = axis === 'x' ? minimumX : minimumY;
  const maximum = axis === 'x' ? maximumX : maximumY;
  const count = policy.refinementCandidateCount ?? policy.candidateCount;
  if (minimum > maximum || !Number.isInteger(count) || count < 1) return [];
  const current = clamp(axis === 'x' ? proposal.box.x : proposal.box.y, minimum, maximum);
  const coarseStep = (maximum - minimum) / Math.max(1, policy.candidateCount - 1);
  const radius = coarseStep / (2 ** round);
  if (minimumStep !== undefined && radius < minimumStep) return [];
  return Array.from({ length: count }, (_, index) => {
    const fraction = count === 1 ? 0.5 : index / (count - 1);
    const coordinate = clamp(current - radius + (2 * radius * fraction), minimum, maximum);
    return {
      ...proposal.box,
      x: axis === 'x' ? coordinate : proposal.box.x,
      y: axis === 'y' ? coordinate : proposal.box.y,
    };
  }).filter((box, index, boxes) => boxes.findIndex((candidate) => candidate.x === box.x && candidate.y === box.y) === index);
}

type PlannedPlacement = { box: CompositionRect };
type SelectedPlacement = { id: string; page: number; slotId: string; box: CompositionRect };
type MovablePlacementPolicy = Record<string, MovablePlacementBounds>;

function boundedCandidateLimit(limit: number | undefined): number {
  return Number.isInteger(limit) && (limit as number) > 0 ? limit as number : Number.MAX_SAFE_INTEGER;
}

function orderedPolicyEntries<T extends PlannedPlacement>(
  seed: Map<string, T>,
  policies: MovablePlacementPolicy,
): Array<[string, MovablePlacementBounds]> {
  const seedOrder = new Map([...seed.keys()].map((key, index) => [key, index]));
  return Object.entries(policies)
    .filter(([key]) => seed.has(key))
    .sort(([left], [right]) => {
      const leftIndex = seedOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = seedOrder.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.localeCompare(right);
    });
}

function defaultPlacementSignature<T extends PlannedPlacement>(proposal: Map<string, T>): string {
  return [...proposal.entries()]
    .map(([key, value]) => `${key}@${value.box.x},${value.box.y},${value.box.width},${value.box.height}`)
    .join('|');
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movablePlacementProposalCandidates implementation intact until its target seam is extracted.
 */
function movablePlacementProposalCandidates<T extends PlannedPlacement>(
  seed: Map<string, T>,
  policies: MovablePlacementPolicy,
  maxCandidates?: number,
  signature: (proposal: Map<string, T>) => string = defaultPlacementSignature,
): Map<string, T>[] {
  const movableEntries = orderedPolicyEntries(seed, policies);
  if (movableEntries.length === 0) return [seed];
  const limit = boundedCandidateLimit(maxCandidates);
  let variants: Map<string, T>[] = [seed];
  for (const [key, bounds] of movableEntries) {
    const proposal = seed.get(key)!;
    const boxes = movablePlacementBoxes(proposal, bounds);
    if (boxes.length === 0) continue;
    const nextVariants: Map<string, T>[] = [];
    const seen = new Set<string>();
    for (const variant of variants) {
      for (const box of boxes) {
        const next = new Map(variant);
        next.set(key, { ...proposal, box: { ...box } } as T);
        const nextSignature = signature(next);
        if (seen.has(nextSignature)) continue;
        seen.add(nextSignature);
        nextVariants.push(next);
        if (nextVariants.length >= limit) break;
      }
      if (nextVariants.length >= limit) break;
    }
    variants = nextVariants;
  }
  return variants;
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movablePlacementProposalRefinements implementation intact until its target seam is extracted.
 */
function movablePlacementProposalRefinements<T extends PlannedPlacement>(
  seeded: Map<string, T>,
  selectedPlacements: readonly SelectedPlacement[],
  policies: MovablePlacementPolicy,
  round: number,
  selectedIdForKey: (key: string, proposal: T) => string,
  maxCandidates?: number,
  signature: (proposal: Map<string, T>) => string = defaultPlacementSignature,
  defaultRefinementRounds = 0,
  minimumStep?: number,
): Map<string, T>[] {
  const movableEntries = orderedPolicyEntries(seeded, policies)
    .filter(([, bounds]) => (bounds.refinementRounds ?? defaultRefinementRounds) >= round);
  if (movableEntries.length === 0) return [];
  const limit = boundedCandidateLimit(maxCandidates);
  let variants: Map<string, T>[] = [seeded];
  for (const [key, bounds] of movableEntries) {
    const seededProposal = seeded.get(key);
    const selectedPlacement = seededProposal
      ? selectedPlacements.find((placement) => selectedIdForKey(key, seededProposal) === placement.id)
      : undefined;
    if (!seededProposal || !selectedPlacement) return [];
    const anchoredProposal = {
      ...seededProposal,
      page: selectedPlacement.page,
      slotId: selectedPlacement.slotId.replace(/^\d+:/u, ''),
      box: { ...selectedPlacement.box },
    } as T;
    const boxes = movablePlacementRefinementBoxes(anchoredProposal, bounds, round, minimumStep);
    if (boxes.length === 0) return [];
    const nextVariants: Map<string, T>[] = [];
    const seen = new Set<string>();
    for (const variant of variants) {
      for (const box of boxes) {
        const next = new Map(variant);
        next.set(key, { ...anchoredProposal, box: { ...box } } as T);
        const nextSignature = signature(next);
        if (seen.has(nextSignature)) continue;
        seen.add(nextSignature);
        nextVariants.push(next);
        if (nextVariants.length >= limit) break;
      }
      if (nextVariants.length >= limit) break;
    }
    variants = nextVariants;
  }
  return variants;
}

/**
 * Generate complete proposal variants for every configured movable insertion.
 * Cross-product expansion is deliberate and remains bounded by policy.
 */
/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movableInsertionProposalCandidates implementation intact until its target seam is extracted.
 */
export function movableInsertionProposalCandidates(
  seed: Map<string, PlannedInsertion>,
  policies: MovableInsertionPolicy,
  maxCandidates?: number,
): Map<string, PlannedInsertion>[] {
  return movablePlacementProposalCandidates(seed, policies, maxCandidates, movableInsertionProposalSignature);
}

/**
 * Generate a bounded local neighborhood around the selected placement.
 * The selected plan is represented only by its insertion placements so this
 * module does not depend on the evaluator or the rest of the plan model.
 */
/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movableInsertionProposalRefinements implementation intact until its target seam is extracted.
 */
export function movableInsertionProposalRefinements(
  seeded: Map<string, PlannedInsertion>,
  selectedPlacements: readonly SelectedInsertionPlacement[],
  policies: MovableInsertionPolicy,
  round: number,
  maxCandidates?: number,
  defaultRefinementRounds = 0,
  minimumStep?: number,
): Map<string, PlannedInsertion>[] {
  return movablePlacementProposalRefinements(
    seeded,
    selectedPlacements.map(({ graphicId, page, slotId, box }) => ({ id: graphicId, page, slotId, box })),
    policies,
    round,
    (_key, proposal) => `insertion:${proposal.blockId}`,
    maxCandidates,
    movableInsertionProposalSignature,
    defaultRefinementRounds,
    minimumStep,
  );
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movableGraphicProposalCandidates implementation intact until its target seam is extracted.
 */
export function movableGraphicProposalCandidates(
  seed: Map<string, PlannedGraphic>,
  policies: MovableGraphicPolicy,
  maxCandidates?: number,
): Map<string, PlannedGraphic>[] {
  return movablePlacementProposalCandidates(seed, policies, maxCandidates, movableGraphicProposalSignature);
}

export interface SelectedGraphicPlacement {
  graphicId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

export function insertionKey(flowId: string, blockId: string): string {
  return `${flowId}:${blockId}`;
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movableGraphicProposalRefinements implementation intact until its target seam is extracted.
 */
export function movableGraphicProposalRefinements(
  seeded: Map<string, PlannedGraphic>,
  selectedPlacements: readonly SelectedGraphicPlacement[],
  policies: MovableGraphicPolicy,
  round: number,
  maxCandidates?: number,
  defaultRefinementRounds = 0,
  minimumStep?: number,
): Map<string, PlannedGraphic>[] {
  return movablePlacementProposalRefinements(
    seeded,
    selectedPlacements.map(({ graphicId, page, slotId, box }) => ({ id: graphicId, page, slotId, box })),
    policies,
    round,
    (key) => key,
    maxCandidates,
    movableGraphicProposalSignature,
    defaultRefinementRounds,
    minimumStep,
  );
}

/**
 * @planner-target composition/layout/planner-candidates.ts
 * @planner-responsibility Keep the current movableInsertionProposalSignature implementation intact until its target seam is extracted.
 */
export function movableInsertionProposalSignature(proposals: Map<string, PlannedInsertion>): string {
  return [...proposals.values()]
    .map((proposal) => `${insertionKey(proposal.flowId, proposal.blockId)}@${proposal.page}:${proposal.slotId}:${proposal.box.x},${proposal.box.y},${proposal.box.width},${proposal.box.height}`)
    .join('|');
}

/** Stable identity for a set of movable graphic proposals. */
export function movableGraphicProposalSignature(proposals: Map<string, PlannedGraphic>): string {
  return [...proposals.entries()]
    .map(([key, proposal]) => `${key}@${proposal.page}:${proposal.slotId}:${proposal.box.x},${proposal.box.y},${proposal.box.width},${proposal.box.height}`)
    .join('|');
}

/** Combine two already-bounded proposal dimensions without materialising an unbounded product. */
export function combineProposalCandidates<T extends PlannedPlacement, U extends PlannedPlacement>(
  left: Map<string, T>[],
  right: Map<string, U>[],
  maxCandidates: number | undefined,
  signature: (left: Map<string, T>, right: Map<string, U>) => string,
): Array<{ left: Map<string, T>; right: Map<string, U> }> {
  const limit = boundedCandidateLimit(maxCandidates);
  const combinations: Array<{ left: Map<string, T>; right: Map<string, U> }> = [];
  const seen = new Set<string>();
  for (const leftProposal of left) {
    for (const rightProposal of right) {
      const proposalSignature = signature(leftProposal, rightProposal);
      if (seen.has(proposalSignature)) continue;
      seen.add(proposalSignature);
      combinations.push({ left: leftProposal, right: rightProposal });
      if (combinations.length >= limit) return combinations;
    }
  }
  return combinations;
}
