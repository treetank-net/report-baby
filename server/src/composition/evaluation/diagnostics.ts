import type { CompositionDiagnostic } from '../contracts/engine-contracts.js';

/** Construct one renderer-neutral evaluator diagnostic. */
/**
 * @planner-target composition/evaluation/diagnostics.ts
 * @planner-responsibility Keep the current error implementation intact until its target seam is extracted.
 */
export function error(code: string, message: string, details: Record<string, unknown> = {}): CompositionDiagnostic {
  return { severity: 'error', code, message, ...(Object.keys(details).length ? { details } : {}) };
}

/** Append one structured evaluator error. */
/**
 * @planner-target composition/evaluation/diagnostics.ts
 * @planner-responsibility Keep the current pushEvaluationError implementation intact until its target seam is extracted.
 */
export function pushEvaluationError(
  diagnostics: CompositionDiagnostic[],
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  diagnostics.push(error(code, message, details));
}
