import type { CompositionRect } from './model.js';

export interface MovablePlacementBounds {
  bounds: CompositionRect;
  axis?: 'x' | 'y';
  preferred?: { x?: number; y?: number };
  candidateCount: number;
  refinementRounds?: number;
  refinementCandidateCount?: number;
}

/** Compatibility alias: insertion movement uses the same bounds contract for every block kind. */
export type MovableInsertionBounds = MovablePlacementBounds;

export type MovableInsertionPolicy = Record<string, MovableInsertionBounds>;
export type MovableGraphicPolicy = Record<string, MovablePlacementBounds>;

/** Deterministic limits for proposal generation and complete-plan evaluation. */
export interface CompositionSearchBudget {
  maxInitialCandidates: number;
  maxRefinementRounds: number;
  maxCandidatesPerRefinement: number;
  maxFullPlanRecalculations: number;
  /** Default refinement rounds for a movable capability without a local override. */
  movableRefinementRounds?: number;
  /** Finest geometry movement tested during bounded local refinement. */
  minimumGeometryStepMm?: number;
}

/** Configuration knobs shared by document and flow planning. */
export interface TextCompositionPlannerPolicy {
  minimumLinesAtStart?: number;
  minimumLinesAtEnd?: number;
  keepListItemsTogether?: boolean;
  /** Minimum width of a side interval that may receive wrapped text. */
  minimumWrapWidth?: number;
  /** Default number of following lines kept with a heading when unspecified. */
  headingKeepWithNextLines?: number;
  /** Number of complete layout passes allowed for obstacle stabilization. */
  maxPlanningIterations?: number;
  /** A non-final fragment must retain at least this many lines. */
  minimumFragmentLines?: number;
  /** Tolerance for renderer-neutral geometry comparisons, in planner units. */
  geometryTolerance?: number;
  /** Global count/round budget shared by candidate planning and evaluation. */
  searchBudget?: CompositionSearchBudget;
  /** Optional legal frame for an insertion. */
  movableInsertionBounds?: MovableInsertionPolicy;
  /** Optional legal frames for authored graphics with an explicit size. */
  movableGraphicBounds?: MovableGraphicPolicy;
}
