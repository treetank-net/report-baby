import type { BrandDiagnostics } from '../../brand/context.js';
import type { ResolvedSlidePlan } from '../../contracts/resolved-slide-plan.js';
import type { ResolvedReportPlan } from '../../contracts/resolved-report-plan.js';
import type { CompositionEvaluation, CompositionPlan } from '../../composition/contracts/engine-contracts.js';
import type { ReportDrawing } from '../../artifacts/drawing-recorder.js';
import type { SlideDeck } from '../../presentation/slides.js';

export type DiagnosticsDetail = 'summary' | 'full';

export interface CountedWarning {
  message: string;
  slides?: number;
}

function withoutEmptyValues(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)));
}

export function countWarnings(deck: BrandDiagnostics | undefined, perSlide: BrandDiagnostics[]): CountedWarning[] {
  const slidesPerMessage = new Map<string, number>();
  for (const message of deck?.warnings ?? []) if (!slidesPerMessage.has(message)) slidesPerMessage.set(message, 0);
  for (const diagnostics of perSlide) {
    for (const message of new Set(diagnostics.warnings)) slidesPerMessage.set(message, (slidesPerMessage.get(message) ?? 0) + 1);
  }
  return [...slidesPerMessage].map(([message, slides]) => (slides > 0 ? { message, slides } : { message }));
}

export function brandRenderSummary(diagnostics: BrandDiagnostics | undefined, renderWarnings: string[] = []): Record<string, unknown> {
  if (!diagnostics && renderWarnings.length === 0) return {};
  const counted = countWarnings(diagnostics, []);
  for (const message of renderWarnings) if (!counted.some((entry) => entry.message === message)) counted.push({ message });
  return withoutEmptyValues({
    brandRef: diagnostics?.brandRef,
    profile: diagnostics?.profile,
    templateRef: diagnostics?.templateRef,
    surface: diagnostics?.surface,
    appliedOverrides: diagnostics?.appliedOverrides,
    warnings: counted,
  });
}

export const DROPPED_SLIDE_NOTES_WARNING = 'Speaker notes were dropped: this output format carries no notes. Render the same deck with render_slides_pptx to keep them in the presenter notes.';

export interface SlideNotesCarriage {
  slides: number;
  carried: boolean;
}

export function slideNotesCarriage(deck: SlideDeck, carried: boolean): SlideNotesCarriage {
  return { slides: deck.slides.filter((slide) => Boolean(slide.notes)).length, carried };
}

export interface SlideRenderDiagnosticsInput {
  diagnostics: BrandDiagnostics;
  slideDiagnostics: BrandDiagnostics[];
  slidePlans: Array<ResolvedSlidePlan | undefined>;
  notes: SlideNotesCarriage;
}

export function slideRenderDiagnostics(input: SlideRenderDiagnosticsInput, detail: DiagnosticsDetail): Record<string, unknown> {
  const planTemplateRefs = [...new Set(input.slidePlans.map((plan) => plan?.templateRef).filter((ref): ref is string => typeof ref === 'string'))];
  const summary = withoutEmptyValues({
    slideCount: input.slidePlans.length,
    brandRef: input.diagnostics.brandRef,
    profile: input.diagnostics.profile,
    templateRef: planTemplateRefs.length === 1 ? planTemplateRefs[0] : input.diagnostics.templateRef,
    templateRefs: planTemplateRefs.length > 1 ? planTemplateRefs : undefined,
    surface: input.diagnostics.surface,
    appliedOverrides: input.diagnostics.appliedOverrides,
    notesSlides: input.notes.slides > 0 ? input.notes.slides : undefined,
    warnings: [
      ...countWarnings(input.diagnostics, input.slideDiagnostics),
      ...(input.notes.slides > 0 && !input.notes.carried ? [{ message: DROPPED_SLIDE_NOTES_WARNING, slides: input.notes.slides }] : []),
    ],
  });
  if (detail !== 'full') return summary;
  return { ...summary, slideDiagnostics: input.slideDiagnostics, slidePlans: input.slidePlans };
}

export interface ReportRenderDiagnosticsInput {
  diagnostics: BrandDiagnostics;
  plan: ResolvedReportPlan;
  drawings: ReportDrawing[];
  composition?: { plan: CompositionPlan; evaluation: CompositionEvaluation };
}

function compactCandidateSearch(plan: CompositionPlan): Record<string, unknown> | undefined {
  const search = plan.trace?.candidateSearch;
  if (!search) return undefined;
  return {
    generatedCandidates: search.generatedCandidates,
    evaluatedCandidates: search.evaluatedCandidates,
    fullPlanRecalculations: search.fullPlanRecalculations,
    phaseTimings: search.phaseTimings,
    stopReason: search.stopReason,
    remainingBudget: search.remainingBudget,
    untestedAlternatives: search.untestedAlternatives,
    ...(search.layoutVariant === undefined ? {} : { layoutVariant: search.layoutVariant }),
    selectedCandidate: search.selectedCandidate,
    ...(search.selectedProposalSignature === undefined ? {} : { selectedProposalSignature: search.selectedProposalSignature }),
    rounds: search.rounds.map(({ round, generatedCandidates, uniqueCandidates, plannedCandidates, evaluatedCandidates, legalCandidates, bestScore, improved, scope, stopReason }) => ({
      round,
      generatedCandidates,
      uniqueCandidates,
      ...(plannedCandidates === undefined ? {} : { plannedCandidates }),
      evaluatedCandidates,
      legalCandidates,
      ...(bestScore === undefined ? {} : { bestScore }),
      improved,
      ...(scope === undefined ? {} : { scope }),
      ...(stopReason === undefined ? {} : { stopReason }),
    })),
  };
}

type CompositionImpactKind = 'hard-diagnostic' | 'quality-penalty';

interface CompositionImpactFinding {
  kind: CompositionImpactKind;
  code: string;
  message: string;
  severity?: 'warning' | 'error';
  points?: number;
  why?: string;
  remedies?: string[];
  page?: number;
  flowId?: string;
  blockId?: string;
  slotId?: string;
}

const scoreSuggestionCodes: Record<string, string> = {
  'header-spacing': 'HEADER_GAP_TOO_LARGE',
  'main-start-delay': 'MAIN_FLOW_START_DELAYED',
  'element-proximity': 'ELEMENTS_TOO_CLOSE',
  'orphan-lines': 'ORPHAN_FRAGMENT',
  'insertion-spacing': 'INSERTION_SPACING_IMBALANCE',
  'insertion-text-continuity': 'INSERTION_TEXT_CONTINUITY',
  'insertion-symmetry': 'INSERTION_SPACING_IMBALANCE',
  'insertion-distribution': 'INSERTION_DISTRIBUTION_IMBALANCE',
  'content-spread': 'INSERTION_CONTENT_SPREAD_IMBALANCE',
  'page-load-balance': 'INSERTION_PAGE_LOAD_IMBALANCE',
  'source-relation': 'INSERTION_SOURCE_PAGE_PREFERENCE',
  'spacing-rhythm': 'INSERTION_RHYTHM_DEVIATION',
  'narrow-text-interval': 'NARROW_TEXT_INTERVAL',
  'footer-gap': 'FOOTER_GAP_TOO_SMALL',
  'glyph-overlap': 'GLYPH_TEXT_OVERLAP',
  'empty-regions': 'EMPTY_REGION',
  'sibling-column-imbalance': 'COLUMN_FILL_IMBALANCE',
  'fit-content-envelope': 'UNUSED_FIT_CONTENT_ENVELOPE',
};

const scoreFallbackGuidance: Record<string, { message: string; remedies: string[] }> = {
  'paragraph-fragmentation': {
    message: 'A paragraph is split across multiple material placements.',
    remedies: ['Move the nearby insertion or graphic within its legal capability.', 'Use a wider or more continuous text placement.'],
  },
  'contrast': {
    message: 'Measured text contrast is below the configured quality target.',
    remedies: ['Use a stronger text/background contrast.', 'Move text away from the graphic or adjust the graphic treatment.'],
  },
};

function suggestionCodeForScore(component: CompositionEvaluation['scoreBreakdown'][number]): string | undefined {
  if (component.code !== 'header-spacing') return scoreSuggestionCodes[component.code];
  const pages = component.details?.pages;
  if (Array.isArray(pages) && pages.some((record) => record !== null && typeof record === 'object' && !Array.isArray(record)
    && typeof (record as { deficit?: number }).deficit === 'number'
    && (record as { deficit: number }).deficit > 0)) return 'HEADER_GAP_TOO_SMALL';
  return 'HEADER_GAP_TOO_LARGE';
}

function highestImpactFinding(evaluation: CompositionEvaluation): CompositionImpactFinding | undefined {
  const hardDiagnostic = [...evaluation.hardViolations, ...evaluation.diagnostics]
    .find((diagnostic) => diagnostic.severity === 'error');
  if (hardDiagnostic) {
    return {
      kind: 'hard-diagnostic',
      code: hardDiagnostic.code,
      message: hardDiagnostic.message,
      severity: hardDiagnostic.severity,
      ...(hardDiagnostic.why === undefined ? {} : { why: hardDiagnostic.why }),
      ...(hardDiagnostic.remedies === undefined ? {} : { remedies: hardDiagnostic.remedies }),
      ...(hardDiagnostic.page === undefined ? {} : { page: hardDiagnostic.page }),
      ...(hardDiagnostic.flowId === undefined ? {} : { flowId: hardDiagnostic.flowId }),
      ...(hardDiagnostic.blockId === undefined ? {} : { blockId: hardDiagnostic.blockId }),
      ...(hardDiagnostic.slotId === undefined ? {} : { slotId: hardDiagnostic.slotId }),
    };
  }

  const penalty = evaluation.scoreBreakdown
    .filter(({ points }) => points < 0)
    .sort((left, right) => left.points - right.points)[0];
  if (!penalty) return undefined;
  const suggestionCode = suggestionCodeForScore(penalty);
  const suggestion = suggestionCode === undefined
    ? undefined
    : evaluation.suggestions?.find((candidate) => candidate.code === suggestionCode);
  const fallback = scoreFallbackGuidance[penalty.code];
  return {
    kind: 'quality-penalty',
    code: penalty.code,
    message: suggestion?.message ?? fallback?.message ?? `Quality component '${penalty.code}' currently lowers the plan score.`,
    points: penalty.points,
    ...(suggestion?.why === undefined ? {} : { why: suggestion.why }),
    ...(suggestion?.remedies === undefined ? (fallback === undefined ? {} : { remedies: fallback.remedies }) : { remedies: suggestion.remedies }),
  };
}

export function compositionQualitySummary(evaluation: CompositionEvaluation, plan?: CompositionPlan, detail: DiagnosticsDetail = 'full'): Record<string, unknown> {
  const impact = highestImpactFinding(evaluation);
  const gravityDecision = plan?.decisions.find((decision) => decision.code === 'PLACEMENT_GRAVITY_RELAXED');
  const placementGravity = gravityDecision === undefined
    ? undefined
    : {
      iterations: typeof gravityDecision.iterations === 'number' ? gravityDecision.iterations : undefined,
      movedCount: typeof gravityDecision.movedCount === 'number' ? gravityDecision.movedCount : undefined,
      maxDisplacement: typeof gravityDecision.maxDisplacement === 'number' ? gravityDecision.maxDisplacement : undefined,
      groupCount: typeof gravityDecision.groupCount === 'number' ? gravityDecision.groupCount : undefined,
      anchorCount: typeof gravityDecision.anchorCount === 'number' ? gravityDecision.anchorCount : undefined,
      stoppedBy: typeof gravityDecision.stoppedBy === 'string' ? gravityDecision.stoppedBy : undefined,
    };
  const groupAssignmentDecision = plan?.decisions.find((decision) => decision.code === 'PLACEMENT_GROUPS_ASSIGNED');
  const placementGroupAssignment = groupAssignmentDecision === undefined
    ? undefined
    : {
      insertionCount: typeof groupAssignmentDecision.insertionCount === 'number' ? groupAssignmentDecision.insertionCount : undefined,
      changedKeys: Array.isArray(groupAssignmentDecision.changedKeys)
        ? groupAssignmentDecision.changedKeys.filter((key): key is string => typeof key === 'string')
        : undefined,
    };
  const placementPolicies = plan?.decisions
    .filter((decision) => decision.code === 'INSERTION_LAYER_PLACED')
    .map((decision) => ({
      flowId: typeof decision.flowId === 'string' ? decision.flowId : undefined,
      blockId: typeof decision.blockId === 'string' ? decision.blockId : undefined,
      page: typeof decision.page === 'number' ? decision.page : undefined,
      slotId: typeof decision.slotId === 'string' ? decision.slotId : undefined,
      distribution: typeof decision.distribution === 'string' ? decision.distribution : undefined,
      rhythmGroup: typeof decision.rhythmGroup === 'string' ? decision.rhythmGroup : undefined,
      distributionSource: typeof decision.distributionSource === 'string' ? decision.distributionSource : undefined,
      rhythmGroupSource: typeof decision.rhythmGroupSource === 'string' ? decision.rhythmGroupSource : undefined,
      sourceRelationSource: typeof decision.sourceRelationSource === 'string' ? decision.sourceRelationSource : undefined,
      source: typeof decision.source === 'object' && decision.source !== null ? decision.source : undefined,
    }))
    .filter((placement) => placement.flowId !== undefined && placement.blockId !== undefined) ?? [];
  return {
    status: evaluation.status,
    score: evaluation.score,
    ...(evaluation.scoreBase === undefined ? {} : { scoreBase: evaluation.scoreBase }),
    passedMetrics: evaluation.passedMetrics.map(({ code, value, points }) => ({ code, value, points })),
    ...(evaluation.placementScores === undefined ? {} : { placementScores: evaluation.placementScores }),
    ...(evaluation.repairProposals === undefined ? {} : { repairProposals: evaluation.repairProposals }),
    qualityComponents: evaluation.scoreBreakdown.map(({ code, value, points, details }) => ({
      code,
      value,
      points,
      ...(details === undefined ? {} : { details }),
    })),
    ...(impact === undefined ? {} : { highestImpactFinding: impact }),
    ...(placementGravity === undefined ? {} : { placementGravity }),
    ...(placementGroupAssignment === undefined ? {} : { placementGroupAssignment }),
    ...(placementPolicies.length === 0 ? {} : { placementPolicies }),
    ...(plan?.trace?.candidateSearch === undefined ? {} : {
      candidateSearch: detail === 'full' ? plan.trace.candidateSearch : compactCandidateSearch(plan),
    }),
    qualityPenalties: evaluation.scoreBreakdown
      .filter(({ points }) => points < 0)
      .map(({ code, value, points }) => ({ code, value, points })),
    diagnostics: evaluation.diagnostics.map(({ code, severity, message, why, remedies, retryable, page, flowId, blockId, slotId, details }) => ({
      code,
      severity,
      message,
      ...(why === undefined ? {} : { why }),
      ...(remedies === undefined ? {} : { remedies }),
      ...(retryable === undefined ? {} : { retryable }),
      ...(page === undefined ? {} : { page }),
      ...(flowId === undefined ? {} : { flowId }),
      ...(blockId === undefined ? {} : { blockId }),
      ...(slotId === undefined ? {} : { slotId }),
      ...(details === undefined ? {} : { details }),
    })),
    suggestions: evaluation.suggestions ?? [],
  };
}

/**
 * Human-facing rendering of the same quality payload exposed to API clients.
 * Keep the JSON payload as the source of truth so CLI/MCP users do not need a
 * private debug script to inspect the evidence and remediation suggestions.
 */
export function compositionQualityText(evaluation: CompositionEvaluation, plan?: CompositionPlan): string {
  return compositionQualityTextFromSummary(compositionQualitySummary(evaluation, plan));
}

export function compositionQualityTextFromSummary(summary: Record<string, unknown>): string {
  return `Composition quality\n${JSON.stringify(summary, null, 2)}`;
}

export function reportRenderDiagnostics(input: ReportRenderDiagnosticsInput, detail: DiagnosticsDetail): Record<string, unknown> {
  const summary = withoutEmptyValues({
    pages: input.plan.pages.length,
    brandRef: input.diagnostics.brandRef,
    profile: input.diagnostics.profile,
    templateRef: input.plan.templateRef,
    surface: input.diagnostics.surface,
    appliedOverrides: input.diagnostics.appliedOverrides,
    layoutEngine: 'composition-planner',
    ...(input.composition ? { compositionQuality: compositionQualitySummary(input.composition.evaluation, input.composition.plan, detail) } : {}),
  });
  if (detail !== 'full') return summary;
  return {
    ...summary,
    reportPlan: input.plan,
    drawings: input.drawings,
    ...(input.composition ? { compositionPlan: input.composition.plan, compositionEvaluation: input.composition.evaluation } : {}),
  };
}
