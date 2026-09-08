import type { CompositionDiagnostic } from '../contracts/engine-contracts.js';

/** Construct one renderer-neutral evaluator diagnostic. */
export function error(code: string, message: string, details: Record<string, unknown> = {}): CompositionDiagnostic {
  return { severity: 'error', code, message, ...(Object.keys(details).length ? { details } : {}) };
}

/** Append one structured evaluator error. */
export function pushEvaluationError(
  diagnostics: CompositionDiagnostic[],
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  diagnostics.push(error(code, message, details));
}
