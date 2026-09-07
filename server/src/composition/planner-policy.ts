import type {
  MovableGraphicPolicy,
  MovableInsertionBounds,
} from './text-planner-candidates.js';

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
  /** Optional legal frame for an insertion. */
  movableInsertionBounds?: Record<string, MovableInsertionBounds>;
  /** Optional legal frames for authored graphics with an explicit size. */
  movableGraphicBounds?: MovableGraphicPolicy;
}
