import type { CompositionLine, CompositionPlan } from '../contracts/engine-contracts.js';

/** Return every materialized text line, including insertion-flow lines. */
/**
 * @planner-target composition/layout/plan-lines.ts
 * @planner-responsibility Project the plan's ordinary and insertion lines into one read-only collection.
 */
export function plannedLines(plan: CompositionPlan): CompositionLine[] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}
