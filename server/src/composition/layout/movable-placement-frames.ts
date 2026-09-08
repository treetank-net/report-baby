import type {
  CompositionMovableGraphicFrame,
  CompositionMovableInsertionFrame,
} from '../contracts/engine-contracts.js';
import type { CompositionRect } from '../contracts/model.js';
import type { MovablePlacementBounds } from '../contracts/planner-policy.js';
import type {
  PlannedGraphic,
  PlannedInsertion,
} from './planner-candidates.js';

type MovablePlacementProposal = { page: number; box: CompositionRect };

/**
 * @planner-target composition/layout/movable-placement-frames.ts
 * @planner-responsibility Project configured movable placement policies into renderer-neutral frame records.
 */
function materializeMovablePlacementFrames<
  Proposal extends MovablePlacementProposal,
  Frame,
>(
  policies: Record<string, MovablePlacementBounds> | undefined,
  proposals: Map<string, Proposal>,
  createFrame: (key: string, policy: MovablePlacementBounds, proposal: Proposal) => Frame,
): Frame[] {
  return Object.entries(policies ?? {}).flatMap(([key, policy]) => {
    const proposal = proposals.get(key);
    return proposal ? [createFrame(key, policy, proposal)] : [];
  });
}

/**
 * @planner-target composition/layout/movable-placement-frames.ts
 * @planner-responsibility Materialize movable insertion frames from their measured proposals.
 */
export function movableInsertionFramesForPlan(
  policies: Record<string, MovablePlacementBounds> | undefined,
  proposals: Map<string, PlannedInsertion>,
): CompositionMovableInsertionFrame[] {
  return materializeMovablePlacementFrames(policies, proposals, (key, policy, proposal) => ({
    id: key,
    flowId: proposal.flowId,
    blockId: proposal.blockId,
    page: proposal.page,
    box: { ...policy.bounds },
    axis: policy.axis ?? 'y',
    candidateCount: policy.candidateCount,
  }));
}

/**
 * @planner-target composition/layout/movable-placement-frames.ts
 * @planner-responsibility Materialize movable graphic frames from their measured proposals.
 */
export function movableGraphicFramesForPlan(
  policies: Record<string, MovablePlacementBounds> | undefined,
  proposals: Map<string, PlannedGraphic>,
): CompositionMovableGraphicFrame[] {
  return materializeMovablePlacementFrames(policies, proposals, (key, policy, proposal) => ({
    id: key,
    graphicId: proposal.graphicId,
    page: proposal.page,
    box: { ...policy.bounds },
    axis: policy.axis ?? 'y',
    candidateCount: policy.candidateCount,
  }));
}
