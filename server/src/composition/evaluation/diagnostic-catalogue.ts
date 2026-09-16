import type { CompositionDiagnostic, CompositionSuggestion } from '../contracts/engine-contracts.js';

interface DiagnosticCopy {
  why: string;
  remedies: string[];
  retryable: boolean;
}

const unavailableTarget: DiagnosticCopy = {
  why: 'The plan refers to a source block, route, page, or slot that is not available in the resolved document and template.',
  remedies: ['Check that the source block and requested flow exist.', 'Add a compatible slot or route to the selected template.', 'Choose a page/template span where the target is available.'],
  retryable: true,
};

const placementOutsideBounds: DiagnosticCopy = {
  why: 'The measured placement extends beyond the bounds of its declared slot or placement capability.',
  remedies: ['Use a larger compatible slot or placement capability.', 'Move or resize the placement so its complete measured box fits.', 'Review the template geometry and the content dimensions reported in the evidence.'],
  retryable: true,
};

const placementsOverlap: DiagnosticCopy = {
  why: 'Two independently planned placements occupy intersecting geometry on the same page.',
  remedies: ['Move or resize one of the reported placements.', 'Use separate compatible slots or adjust their layout so their boxes no longer intersect.', 'Review wrapping or overlay intent if the intersection is deliberate.'],
  retryable: true,
};

const incompleteContent: DiagnosticCopy = {
  why: 'The selected plan does not place all required source content or preserve its required continuous range.',
  remedies: ['Allow more compatible page capacity.', 'Choose a template route that can accept the remaining content.', 'Inspect the reported block, word range, row range, or residual reason before shortening required content.'],
  retryable: true,
};

const contentOrderMismatch: DiagnosticCopy = {
  why: 'The planned visual order differs from the authored order of content in its flow.',
  remedies: ['Keep the source flow order when assigning content to slots.', 'Review page and route order for the reported blocks.', 'Check whether a movable insertion or placement is crossing the flow sequence.'],
  retryable: true,
};

const unavailableMeasurement: DiagnosticCopy = {
  why: 'The planner could not obtain a valid renderer-neutral measurement for this content.',
  remedies: ['Provide a supported block shape and its required source data.', 'Check that the referenced asset or measurement adapter is available.', 'Review the measurement failure details before changing slot dimensions.'],
  retryable: false,
};

const invalidPlannerPolicy: DiagnosticCopy = {
  why: 'A planner policy or configured bound is invalid, so the requested placement cannot be evaluated safely.',
  remedies: ['Correct the policy in the input or owning template.', 'Use finite positive dimensions and valid integer limits.', 'Check the reported policy fields and referenced template target.'],
  retryable: false,
};

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
  LINE_OVERLAP: {
    why: 'Two planned text line boxes overlap within the same slot, so their painted text cannot be laid out independently.',
    remedies: ['Route the conflicting blocks to separate compatible slots.', 'Adjust the affected slot or line geometry so the text bands no longer intersect.', 'Review repeated-flow and page-template assignments if both blocks were not intended to share this slot.'],
    retryable: true,
  },
  LINE_GRAPHIC_OVERLAP: {
    why: 'A planned text line enters the blocked text interval of a wrapping graphic on the same page.',
    remedies: ['Move or resize the graphic within its declared placement capability.', 'Place the affected text in another compatible slot or interval.', 'Review the graphic wrap policy if text is intentionally allowed to cross its frame.'],
    retryable: true,
  },
  FLOW_SLOT_UNDERFILLED: {
    why: 'The flow left more usable lines in this slot than the allowed underfilled threshold before its next authored block.',
    remedies: ['Adjust the slot geometry or route order so the next authored block can use the remaining capacity.', 'Move or resize a nearby insertion or image if it is fragmenting the text.', 'Review the next block’s keep-with-next requirement and the compatible slots in the flow route.'],
    retryable: true,
  },
  FLOW_FRAGMENT_UNDERFILLED: {
    why: 'The flow left more usable lines in the previous route segment than the allowed underfilled threshold before its next authored block.',
    remedies: ['Adjust the segment geometry or route order so the next authored block can use the remaining capacity.', 'Move or resize a nearby insertion or image if it is fragmenting the text.', 'Review the next block’s keep-with-next requirement and the compatible slots in the flow route.'],
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
  FLOW_ROUTE_NOT_FOUND: unavailableTarget,
  GRAPHIC_ROUTE_NOT_FOUND: unavailableTarget,
  GRAPHIC_SLOT_NOT_FOUND: unavailableTarget,
  GRAPHIC_TARGET_MISSING: unavailableTarget,
  INSERTION_ROUTE_NOT_FOUND: unavailableTarget,
  INSERTION_PLAN_MISSING: unavailableTarget,
  LAYOUT_NOT_FOUND: unavailableTarget,
  LINE_TARGET_MISSING: unavailableTarget,
  PLACEMENT_TARGET_MISSING: unavailableTarget,
  TABLE_PLACEMENT_TARGET_MISSING: unavailableTarget,
  BLOCK_PLACEMENT_TARGET_MISSING: unavailableTarget,
  FLOW_PLACEMENT_TARGET_MISSING: unavailableTarget,
  GROW_TARGET_NOT_FOUND: unavailableTarget,
  MOVABLE_INSERTION_TARGET_NOT_FOUND: unavailableTarget,
  MOVABLE_GRAPHIC_TARGET_NOT_FOUND: unavailableTarget,
  GRAPHIC_BOX_OUTSIDE_SLOT: placementOutsideBounds,
  GRAPHIC_OUTSIDE_SLOT: placementOutsideBounds,
  LINE_OUTSIDE_SLOT: placementOutsideBounds,
  PLACEMENT_OUTSIDE_SLOT: placementOutsideBounds,
  TABLE_PLACEMENT_OUTSIDE_SLOT: placementOutsideBounds,
  BLOCK_PLACEMENT_OUTSIDE_SLOT: placementOutsideBounds,
  FLOW_PLACEMENT_OUTSIDE_SLOT: placementOutsideBounds,
  MOVABLE_INSERTION_BOUNDS_INVALID: placementOutsideBounds,
  MOVABLE_GRAPHIC_BOUNDS_INVALID: placementOutsideBounds,
  BLOCK_OVERLAP: placementsOverlap,
  BLOCK_TEXT_OVERLAP: placementsOverlap,
  TABLE_OVERLAP: placementsOverlap,
  TABLE_BLOCK_OVERLAP: placementsOverlap,
  TABLE_TEXT_OVERLAP: placementsOverlap,
  CONTENT_NOT_FULLY_PLACED: incompleteContent,
  CONTENT_COVERAGE_GAP: incompleteContent,
  TABLE_NOT_FULLY_PLACED: incompleteContent,
  TABLE_ROW_COVERAGE_GAP: incompleteContent,
  ATOMIC_BLOCK_NOT_FULLY_PLACED: incompleteContent,
  RESIDUAL_CONTENT: incompleteContent,
  EMPTY_FLOW_PLACEMENT: incompleteContent,
  EMPTY_FLOW_SLOT: incompleteContent,
  ROUTE_SEGMENT_GAP: incompleteContent,
  FLOW_COLUMN_ADVANCE_EARLY: incompleteContent,
  CONTENT_ORDER_VIOLATION: contentOrderMismatch,
  QUOTE_ORDER_VIOLATION: contentOrderMismatch,
  INSERTION_SOURCE_ORDER_VIOLATION: contentOrderMismatch,
  BLOCK_MEASUREMENT_UNAVAILABLE: unavailableMeasurement,
  BLOCK_MEASUREMENT_FAILED: unavailableMeasurement,
  TABLE_MEASUREMENT_UNAVAILABLE: unavailableMeasurement,
  TABLE_MEASUREMENT_FAILED: unavailableMeasurement,
  INSERTION_MEASUREMENT_UNAVAILABLE: unavailableMeasurement,
  INSERTION_MEASUREMENT_FAILED: unavailableMeasurement,
  GRAPHIC_ASSET_NOT_FOUND: unavailableMeasurement,
  IMAGE_ASSET_NOT_FOUND: unavailableMeasurement,
  UNSUPPORTED_INLINE_ASSET: unavailableMeasurement,
  TABLE_MEASUREMENT_INVALID: invalidPlannerPolicy,
  BLOCK_MEASUREMENT_INVALID: invalidPlannerPolicy,
  CONTENT_RANGE_INVALID: invalidPlannerPolicy,
  TABLE_ROW_RANGE_INVALID: invalidPlannerPolicy,
  FLOW_START_PAGE_INVALID: invalidPlannerPolicy,
  PLANNER_ITERATION_POLICY_INVALID: invalidPlannerPolicy,
  PLANNER_DID_NOT_STABILIZE: {
    why: 'The planner reached its configured iteration limit before its layout proposals stabilized.',
    remedies: ['Increase the planner iteration limit only if the content and template are intentionally complex.', 'Inspect repeated insertion or growth proposals for a cycle.', 'Simplify conflicting placement constraints or use a compatible template.'],
    retryable: true,
  },
  GRAPHIC_PAGE_OUT_OF_RANGE: unavailableTarget,
  GRAPHIC_SHAPE_PARAMETER_INVALID: invalidPlannerPolicy,
  BLOCK_SOURCE_MISSING: unavailableTarget,
  TABLE_SOURCE_MISSING: unavailableTarget,
  BLOCK_KIND_MISMATCH: invalidPlannerPolicy,
  TABLE_KIND_MISMATCH: invalidPlannerPolicy,
  NON_ATOMIC_BLOCK_PLACED: invalidPlannerPolicy,
  NON_ATOMIC_BLOCK_IN_BLOCK_SLOT: invalidPlannerPolicy,
  DUPLICATE_BLOCK_PLACEMENT: incompleteContent,
  DUPLICATE_CONTENT: incompleteContent,
  FLOW_PLACEMENT_CONTENT_MISMATCH: incompleteContent,
  FLOW_BARRIER_CANDIDATE_INVALID: invalidPlannerPolicy,
  FLOW_BARRIER_CANDIDATE_PLACEMENT_MISSING: unavailableTarget,
  FLOW_BARRIER_CANDIDATE_OUTSIDE_PLACEMENT: placementOutsideBounds,
  FLOW_BARRIER_CANDIDATE_SOURCE_MISSING: unavailableTarget,
  FLOW_BARRIER_CANDIDATE_SOURCE_NOT_WRAPPING: invalidPlannerPolicy,
  MAIN_FLOW_INSERTIONS_FORBIDDEN: {
    why: 'The main flow has declared insertion capabilities, but insertion slots must belong to a separate content flow.',
    remedies: ['Keep the main flow dedicated to primary article content.', 'Move quote, image, or other insertion content into its own flow.', 'Declare the insertion capability on the template route for that flow.'],
    retryable: false,
  },
  MAIN_FLOW_QUOTE_FORBIDDEN: {
    why: 'A quote block is assigned to the reserved main flow instead of a separate insertion flow.',
    remedies: ['Move the quote block to a quote/insertion flow.', 'Keep the main flow for the primary article sequence.', 'Ensure the insertion flow has a compatible template capability.'],
    retryable: false,
  },
  OPTIONAL_OMISSION_REQUIRES_INSERTION_FLOW: {
    why: 'A block permits omission but is not owned by an insertion flow whose capability can authorize that omission.',
    remedies: ['Move the optional block to an insertion flow.', 'Remove optional omission from required main-flow content.', 'Declare a compatible insertion capability for the owning flow.'],
    retryable: false,
  },
  QUOTE_INSERTION_FLOW_REQUIRED: {
    why: 'The quote flow has no insertion capability through which its content can be placed.',
    remedies: ['Declare a compatible quote insertion capability in the template.', 'Assign the quote flow to pages where that capability exists.', 'Keep the quote blocks out of the reserved main flow.'],
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
