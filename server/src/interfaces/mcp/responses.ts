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

export function compositionQualitySummary(evaluation: CompositionEvaluation, plan?: CompositionPlan): Record<string, unknown> {
  return {
    status: evaluation.status,
    score: evaluation.score,
    ...(evaluation.scoreBase === undefined ? {} : { scoreBase: evaluation.scoreBase }),
    passedMetrics: evaluation.passedMetrics.map(({ code, value, points }) => ({ code, value, points })),
    ...(evaluation.placementScores === undefined ? {} : { placementScores: evaluation.placementScores }),
    ...(evaluation.repairProposals === undefined ? {} : { repairProposals: evaluation.repairProposals }),
    ...(plan?.trace?.candidateSearch === undefined ? {} : { candidateSearch: plan.trace.candidateSearch }),
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
    ...(input.composition ? { compositionQuality: compositionQualitySummary(input.composition.evaluation, input.composition.plan) } : {}),
  });
  if (detail !== 'full') return summary;
  return {
    ...summary,
    reportPlan: input.plan,
    drawings: input.drawings,
    ...(input.composition ? { compositionPlan: input.composition.plan, compositionEvaluation: input.composition.evaluation } : {}),
  };
}
