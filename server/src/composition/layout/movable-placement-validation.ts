import type { CompositionRect } from '../contracts/model.js';
import type { CompositionPlan } from '../contracts/engine-contracts.js';
import type { MovablePlacementBounds } from '../contracts/planner-policy.js';
import { diagnostic } from '../observability/planning-observability.js';

export type MovablePlacementProposal = { box: CompositionRect };
export type MovablePlacementKind = 'insertion' | 'graphic';

/**
 * @planner-target composition/layout/movable-placement-validation.ts
 * @planner-responsibility Validate the legal frame and candidate count for one family of movable placements.
 *
 * Validate the configured frame for every movable placement proposal.
 *
 * The document planner owns when preflight runs; this module owns only the
 * shared bounds and candidate-count rules for insertion and graphic frames.
 */
export function validateMovablePlacementBounds(
  proposals: Map<string, MovablePlacementProposal>,
  policies: Record<string, MovablePlacementBounds>,
  plan: CompositionPlan,
  kind: MovablePlacementKind,
): void {
  for (const [key, movable] of Object.entries(policies)) {
    const proposal = proposals.get(key);
    if (!proposal) {
      plan.diagnostics.push(diagnostic(
        'error',
        `MOVABLE_${kind.toUpperCase()}_TARGET_NOT_FOUND`,
        `Movable ${kind} policy '${key}' does not match a planned ${kind}.`,
        { details: { key } },
      ));
      continue;
    }

    const { bounds } = movable;
    const validNumbers = [bounds?.x, bounds?.y, bounds?.width, bounds?.height].every(Number.isFinite);
    const validShape = Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    const containsMeasuredBox = Boolean(bounds && proposal.box.width <= bounds.width && proposal.box.height <= bounds.height);
    const validCandidateCount = Number.isInteger(movable.candidateCount) && movable.candidateCount >= 1;
    if (validNumbers && validShape && containsMeasuredBox && validCandidateCount) continue;

    const noun = kind === 'insertion' ? 'insertion' : 'graphic';
    plan.diagnostics.push(diagnostic(
      'error',
      `MOVABLE_${kind.toUpperCase()}_BOUNDS_INVALID`,
      `Movable ${kind} frame '${key}' cannot contain its measured ${noun} box or candidate count.`,
      { details: { key, bounds, measuredBox: proposal.box, candidateCount: movable.candidateCount } },
    ));
  }
}
