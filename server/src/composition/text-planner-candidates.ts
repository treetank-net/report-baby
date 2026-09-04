import type { CompositionRect } from './model.js';

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

export interface MovablePlacementBounds {
  bounds: CompositionRect;
  axis?: 'x' | 'y';
  preferred?: { x?: number; y?: number };
  candidateCount: number;
  refinementRounds?: number;
  refinementCandidateCount?: number;
}

/** @deprecated Use MovablePlacementBounds; retained for the quote API. */
export type MovableInsertionBounds = MovablePlacementBounds;

export interface SelectedInsertionPlacement {
  graphicId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

export type MovableInsertionPolicy = Record<string, MovableInsertionBounds>;

function insertionKey(flowId: string, blockId: string): string {
  return `${flowId}:${blockId}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Expand one measured insertion into legal positions inside its frame.
 * The measured rectangle remains unchanged; only its position moves.
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

function movablePlacementRefinementBoxes(proposal: { box: CompositionRect }, policy: MovablePlacementBounds, round: number): CompositionRect[] {
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

function movablePlacementProposalCandidates<T extends PlannedPlacement>(
  seed: Map<string, T>,
  policies: MovablePlacementPolicy,
): Map<string, T>[] {
  const movableEntries = Object.entries(policies).filter(([key]) => seed.has(key));
  if (movableEntries.length === 0) return [seed];
  let variants: Map<string, T>[] = [seed];
  for (const [key, bounds] of movableEntries) {
    const proposal = seed.get(key)!;
    const boxes = movablePlacementBoxes(proposal, bounds);
    if (boxes.length === 0) continue;
    variants = variants.flatMap((variant) => boxes.map((box) => {
      const next = new Map(variant);
      next.set(key, { ...proposal, box: { ...box } } as T);
      return next;
    }));
  }
  return variants;
}

function movablePlacementProposalRefinements<T extends PlannedPlacement>(
  seeded: Map<string, T>,
  selectedPlacements: readonly SelectedPlacement[],
  policies: MovablePlacementPolicy,
  round: number,
  selectedIdForKey: (key: string, proposal: T) => string,
): Map<string, T>[] {
  const movableEntries = Object.entries(policies).filter(([, bounds]) => (bounds.refinementRounds ?? 0) >= round);
  if (movableEntries.length === 0) return [];
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
    const boxes = movablePlacementRefinementBoxes(anchoredProposal, bounds, round);
    if (boxes.length === 0) return [];
    variants = variants.flatMap((variant) => boxes.map((box) => {
      const next = new Map(variant);
      next.set(key, { ...anchoredProposal, box: { ...box } } as T);
      return next;
    }));
  }
  return variants;
}

/**
 * Generate complete proposal variants for every configured movable insertion.
 * Cross-product expansion is deliberate and remains bounded by policy.
 */
export function movableInsertionProposalCandidates(
  seed: Map<string, PlannedInsertion>,
  policies: MovableInsertionPolicy,
): Map<string, PlannedInsertion>[] {
  return movablePlacementProposalCandidates(seed, policies);
}

/**
 * Generate a bounded local neighborhood around the selected placement.
 * The selected plan is represented only by its insertion placements so this
 * module does not depend on the evaluator or the rest of the plan model.
 */
export function movableInsertionProposalRefinements(
  seeded: Map<string, PlannedInsertion>,
  selectedPlacements: readonly SelectedInsertionPlacement[],
  policies: MovableInsertionPolicy,
  round: number,
): Map<string, PlannedInsertion>[] {
  return movablePlacementProposalRefinements(
    seeded,
    selectedPlacements.map(({ graphicId, page, slotId, box }) => ({ id: graphicId, page, slotId, box })),
    policies,
    round,
    (_key, proposal) => `insertion:${proposal.blockId}`,
  );
}

export type MovableGraphicPolicy = Record<string, MovablePlacementBounds>;

export function movableGraphicProposalCandidates(
  seed: Map<string, PlannedGraphic>,
  policies: MovableGraphicPolicy,
): Map<string, PlannedGraphic>[] {
  return movablePlacementProposalCandidates(seed, policies);
}

export interface SelectedGraphicPlacement {
  graphicId: string;
  page: number;
  slotId: string;
  box: CompositionRect;
}

export function movableGraphicProposalRefinements(
  seeded: Map<string, PlannedGraphic>,
  selectedPlacements: readonly SelectedGraphicPlacement[],
  policies: MovableGraphicPolicy,
  round: number,
): Map<string, PlannedGraphic>[] {
  return movablePlacementProposalRefinements(
    seeded,
    selectedPlacements.map(({ graphicId, page, slotId, box }) => ({ id: graphicId, page, slotId, box })),
    policies,
    round,
    (key) => key,
  );
}

export function movableInsertionProposalSignature(proposals: Map<string, PlannedInsertion>): string {
  return [...proposals.values()]
    .sort((left, right) => insertionKey(left.flowId, left.blockId).localeCompare(insertionKey(right.flowId, right.blockId)))
    .map((proposal) => `${insertionKey(proposal.flowId, proposal.blockId)}@${proposal.page}:${proposal.slotId}:${proposal.box.x},${proposal.box.y},${proposal.box.width},${proposal.box.height}`)
    .join('|');
}
