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
  /** Maximum evaluator-directed micro-optimization rounds per page. */
  maxPageLocalRefinementRounds?: number;
  /** Relative movement window for automatic fluid insertion refinement. */
  movableWindowRatio?: number;
  /** Number of coarse movement positions sampled for a fluid insertion. */
  movableCandidateCount?: number;
  /** Number of positions sampled per local movement refinement round. */
  movableRefinementCandidateCount?: number;
  /** Maximum cheap geometry-only gravity iterations before full evaluation. */
  gravityIterations?: number;
  /** Damped fraction of the calculated gravity displacement applied per iteration. */
  gravityDamping?: number;
  /** Convergence threshold for a gravity iteration in planner units. */
  gravityConvergenceMm?: number;
}

/** Configuration knobs shared by document and flow planning. */
export interface TextCompositionPlannerPolicy {
  /** Use aggregate coarse geometry for the production baseline; false restores the bounded legacy seed oracle. */
  coarseGeometryFirst?: boolean;
  /** Maximum projected macro seeds handed to the exact engine's initial batch. */
  coarseExactCandidateCount?: number;
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
