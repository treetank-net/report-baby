import type { CompositionDiagnostic, CompositionSuggestion } from '../contracts/engine-contracts.js';

interface DiagnosticCopy {
  why: string;
  remedies: string[];
  retryable: boolean;
}

const diagnosticCopy: Record<string, DiagnosticCopy> = {
  FLOW_SLOT_NOT_FOUND: {
    why: 'The selected template route has no compatible slot for the current block at the searched position.',
    remedies: ['Use a template that declares a compatible slot.', 'Move the flow to a page range where its slot exists.', 'Reduce or reclassify optional insertion content.'],
    retryable: true,
  },
  INSERTION_SLOT_NOT_FOUND: {
    why: 'No declared insertion capability accepted this flow and block on the requested page or page range.',
    remedies: ['Select a compatible insertion slot capability.', 'Allow another page or template span.', 'Remove the hard page or slot constraint.'],
    retryable: true,
  },
  INSERTION_OVERFLOW: {
    why: 'Measured insertion content exceeds the usable capacity of its selected slot.',
    remedies: ['Use a larger compatible insertion capability.', 'Allow the insertion to use another page.', 'Shorten the insertion content or caption.'],
    retryable: true,
  },
  FLOW_CONTINUATION_FORBIDDEN: {
    why: 'The selected template does not allow the current flow block to cross this page boundary.',
    remedies: ['Choose a template whose flow policy allows continuation.', 'Use a slot that can contain the block on one page.', 'Reduce the block so it fits before the boundary.'],
    retryable: true,
  },
  MAX_PAGES_EXCEEDED: {
    why: 'The complete content could not be placed within the configured page limit.',
    remedies: ['Allow more pages in the owning render configuration.', 'Use a layout with more usable capacity.', 'Reduce optional content.'],
    retryable: true,
  },
  CONTENT_NOT_COVERED: {
    why: 'One or more source blocks have no complete placement in the accepted plan.',
    remedies: ['Add a compatible slot capability for the missing block.', 'Allow another page or template span.', 'Remove optional blocks that cannot be placed.'],
    retryable: true,
  },
  GROW_POLICY_INVALID: {
    why: 'A template growth rule is malformed or points to an unavailable slot.',
    remedies: ['Fix the growth rule in the owning page template.', 'Remove the invalid push target.', 'Use a finite non-negative growth limit.'],
    retryable: false,
  },
};

/** Add stable explanation and remediation text without changing diagnostic identity. */
export function decorateCompositionDiagnostic(diagnostic: CompositionDiagnostic): CompositionDiagnostic {
  const copy = diagnosticCopy[diagnostic.code];
  if (!copy) return diagnostic;
  return {
    ...diagnostic,
    why: diagnostic.why ?? copy.why,
    remedies: diagnostic.remedies ?? [...copy.remedies],
    retryable: diagnostic.retryable ?? copy.retryable,
  };
}

/** Decorate all diagnostics at the public evaluator boundary. */
export function decorateCompositionDiagnostics(diagnostics: CompositionDiagnostic[]): CompositionDiagnostic[] {
  return diagnostics.map(decorateCompositionDiagnostic);
}

/** Build a suggestion from a negative score component with explicit evidence. */
export function suggestionFromScore(
  code: string,
  message: string,
  evidence?: Record<string, unknown>,
  remedies: string[] = [],
  why?: string,
): CompositionSuggestion {
  return {
    code,
    message,
    ...(why === undefined ? {} : { why }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(remedies.length === 0 ? {} : { remedies }),
    retryable: true,
  };
}
