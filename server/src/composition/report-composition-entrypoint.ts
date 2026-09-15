import type { jsPDF } from 'jspdf';
import type { PageGeometry } from '../template/geometry.js';
import type { CompositionInput, DocumentLayoutInput, PlacementRequests } from '../contracts/input/schema.js';
import type { CompiledTemplate } from '../template/contracts.js';
import type { CompositionLayout } from './contracts/model.js';
import type { CompositionEvaluation, CompositionPlan, CompositionTextMetrics } from './contracts/engine-contracts.js';
import type { CompositionContrastProvider } from './evaluation/contrast.js';
import { compositionDocumentFromInput } from './adapters/input.js';
import { compositionTemplateFromDocumentLayout, compositionTemplateFromPageGeometry, type PageTemplateSource } from './adapters/page-template.js';
import { createJsPdfTextMetrics } from './adapters/pdf/text.js';
import type { JsPdfCompositionStyles, JsPdfInlineFontCoverage } from './contracts/pdf.js';
import { createTextCompositionEngine, plannerPolicyFromRenderConfig } from './adapters/text-engine.js';
import type { TextCompositionPlannerPolicy } from './contracts/planner-policy.js';
import { compositionStylesFromRenderConfig } from './adapters/render-config.js';
import { applyDynamicInsertionRequests } from './adapters/request-insertion-slots.js';
import { hasInlineMark, missingInlineCodePointsByStyle, missingInlineGlyphWarning, missingTableGlyphWarning } from './text/inline-runs.js';
import { attachPlanSpacingReport } from './observability/spacing-report.js';
import { compareCompositionEvaluations } from './composition-engine.js';
import { documentLayoutVariantsWithinPageLimit, normalizeDocumentLayout, type DocumentLayoutVariant } from './adapters/document-layout.js';

export {
  compositionChartStyleFromRenderConfig,
  compositionGraphicStyleFromRenderConfig,
  compositionImageStyleFromRenderConfig,
  compositionMetricStyleFromRenderConfig,
  compositionPdfBackendOptionsFromRenderConfig,
  compositionStylesFromRenderConfig,
  compositionTableStyleFromRenderConfig,
} from './adapters/render-config.js';
export type {
  CompositionChartColors,
  CompositionGraphicColors,
  CompositionMetricColors,
  CompositionTableColors,
  CompositionTextColors,
} from './adapters/render-config.js';

export interface ReportCompositionOptions {
  family: string;
  maxPages: number;
  includeTitlePage?: boolean;
  includeHeaderFlow?: boolean;
  mainFlowId?: string;
  auxiliaryTextWidths?: Record<string, number>;
  policy?: TextCompositionPlannerPolicy;
  styles?: JsPdfCompositionStyles;
  measureBlock?: CompositionTextMetrics['measureBlock'];
  measureTable?: CompositionTextMetrics['measureTable'];
  contrastProvider?: CompositionContrastProvider;
  inlineFontCoverage?: JsPdfInlineFontCoverage;
  insertionRequests?: PlacementRequests;
  layout?: DocumentLayoutInput;
  pageTemplateSources?: PageTemplateSource[];
  headerBottomGap?: number;
}

export interface ReportCompositionResult {
  document: ReturnType<typeof compositionDocumentFromInput>;
  template: CompositionLayout;
  metrics: CompositionTextMetrics;
  plan: CompositionPlan;
  evaluation: CompositionEvaluation;
}

/**
 * Prepare one report composition run for the renderer-neutral engine.
 *
 * This is the application entry point for report composition. It translates
 * report input and compiled page geometry into composition inputs, supplies
 * the real jsPDF measurement capability, and returns the engine result. It
 * does not render PDF content and does not contain layout rules.
 */
/**
 * @planner-target composition/report-composition-entrypoint.ts
 * @planner-responsibility Keep the current planReportComposition implementation intact until its target seam is extracted.
 */
export function planReportComposition(
  doc: jsPDF,
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  data: CompositionInput,
  options: ReportCompositionOptions,
): ReportCompositionResult {
  const document = compositionDocumentFromInput(data);
  const pageTemplateSources = options.pageTemplateSources ?? (
    options.layout?.every((entry) => entry.template === compiled.id)
      ? [{ templateRef: compiled.id, compiled, geometry }]
      : undefined
  );
  if (options.layout && !pageTemplateSources) {
    throw new Error('A document layout with multiple template references requires pageTemplateSources.');
  }
  const layoutVariants: DocumentLayoutVariant[] = options.layout && pageTemplateSources
    ? documentLayoutVariantsWithinPageLimit(normalizeDocumentLayout(options.layout), options.maxPages)
    : [];
  const templates = layoutVariants.length > 0 && pageTemplateSources
    ? layoutVariants.map((variant) => compositionTemplateFromDocumentLayout(pageTemplateSources, variant, {
      maxPages: options.maxPages,
      ...(options.includeTitlePage === undefined ? {} : { includeTitlePage: options.includeTitlePage }),
      includeHeaderFlow: options.includeHeaderFlow ?? true,
      ...(options.headerBottomGap === undefined ? {} : { headerBottomGap: options.headerBottomGap }),
      ...(options.mainFlowId === undefined ? {} : { mainFlowId: options.mainFlowId }),
      ...(options.auxiliaryTextWidths === undefined ? {} : { auxiliaryTextWidths: options.auxiliaryTextWidths }),
    }))
    : [compositionTemplateFromPageGeometry(compiled, geometry, {
    maxPages: options.maxPages,
    ...(options.includeTitlePage === undefined ? {} : { includeTitlePage: options.includeTitlePage }),
    includeHeaderFlow: options.includeHeaderFlow ?? true,
    ...(options.headerBottomGap === undefined ? {} : { headerBottomGap: options.headerBottomGap }),
    ...(options.mainFlowId === undefined ? {} : { mainFlowId: options.mainFlowId }),
    ...(options.auxiliaryTextWidths === undefined ? {} : { auxiliaryTextWidths: options.auxiliaryTextWidths }),
    })];
  const styles = options.styles ?? compositionStylesFromRenderConfig();
  const metrics = createJsPdfTextMetrics(doc, options.family, styles, { inlineFontCoverage: options.inlineFontCoverage });
  if (options.measureBlock) metrics.measureBlock = options.measureBlock;
  if (options.measureTable) metrics.measureTable = options.measureTable;
  const policy: TextCompositionPlannerPolicy = {
    ...plannerPolicyFromRenderConfig(),
    ...options.policy,
  };
  const geometryForPage = (page: CompositionPlan['pages'][number]): PageGeometry => {
    if (!pageTemplateSources || page.templateRef === undefined) return geometry;
    return pageTemplateSources.find((source) => source.templateRef === page.templateRef)?.geometry ?? geometry;
  };
  const planned = templates.map((candidateTemplate) => {
    const template = applyDynamicInsertionRequests(candidateTemplate, document, options.insertionRequests);
    return {
      template,
      result: createTextCompositionEngine(template, policy, {
        ...(options.contrastProvider ? { contrastProvider: options.contrastProvider } : {}),
        beforeEvaluate: (_document, candidatePlan) => attachPlanSpacingReport(candidatePlan, document, metrics, geometry, geometryForPage),
      }).plan(document, metrics),
    };
  });
  const selected = planned.reduce((best, candidate) => compareCompositionEvaluations(candidate.result.evaluation, best.result.evaluation) < 0 ? candidate : best);
  const template = selected.template;
  const result = selected.result;
  attachPlanSpacingReport(result.plan, document, metrics, geometry, geometryForPage);
  appendInlineDiagnostics(doc, options.family, document, result, options.inlineFontCoverage);
  return { document, template, metrics, plan: result.plan, evaluation: result.evaluation };
}

type InlineDiagnosticResult = { evaluation: CompositionEvaluation };

function documentInlineRuns(document: ReturnType<typeof compositionDocumentFromInput>) {
  return Object.values(document.flows).flatMap((flow) => flow.blocks.flatMap((block) => block.inlineRuns ?? []));
}

function documentTableRuns(document: ReturnType<typeof compositionDocumentFromInput>) {
  return Object.values(document.flows)
    .flatMap((flow) => flow.blocks.flatMap((block) => block.table?.inlineRuns ? [block.table.inlineRuns] : []))
    .flatMap((table) => [...table.head, ...table.body.flat()]);
}

function appendMissingGlyphDiagnostic(
  family: string,
  runs: ReturnType<typeof documentInlineRuns>,
  result: InlineDiagnosticResult,
  coverage: JsPdfInlineFontCoverage | undefined,
): void {
  const missing = missingInlineCodePointsByStyle(runs, coverage?.regular, coverage?.bold);
  if (missing.length > 0) result.evaluation.diagnostics.push({ severity: 'warning', code: 'INLINE_GLYPH_FALLBACK', message: missingInlineGlyphWarning(family, missing) });
}

function appendTableGlyphDiagnostic(
  family: string,
  tableRuns: ReturnType<typeof documentTableRuns>,
  result: InlineDiagnosticResult,
  coverage: JsPdfInlineFontCoverage | undefined,
): void {
  const missing = missingInlineCodePointsByStyle(tableRuns.flat(), coverage?.regular, coverage?.bold);
  if (missing.length > 0) result.evaluation.diagnostics.push({ severity: 'warning', code: 'TABLE_GLYPH_FALLBACK', message: missingTableGlyphWarning(family, missing) });
}

function appendTableMarkupDiagnostic(tableRuns: ReturnType<typeof documentTableRuns>, result: InlineDiagnosticResult): void {
  if (tableRuns.some((cell) => hasInlineMark(cell, 'strong') || hasInlineMark(cell, 'emphasis') || hasInlineMark(cell, 'link'))) {
    result.evaluation.diagnostics.push({ severity: 'warning', code: 'TABLE_INLINE_MARKUP_FLATTENED', message: 'Inline markup inside table cells was stripped to plain text: the table renderer draws one weight per cell and cannot switch weight mid-string.' });
  }
}

function appendItalicFallbackDiagnostic(doc: jsPDF, family: string, runs: ReturnType<typeof documentInlineRuns>, result: InlineDiagnosticResult): void {
  const fontStyles = doc.getFontList() as Record<string, string[] | undefined>;
  if (runs.some((run) => run.marks.includes('emphasis')) && !(fontStyles[family] ?? []).includes('italic')) {
    result.evaluation.diagnostics.push({ severity: 'warning', code: 'INLINE_ITALIC_FALLBACK', message: 'Italic markup was rendered upright: neither the brand nor the bundled font ships an italic face.' });
  }
}

function appendInlineDiagnostics(
  doc: jsPDF,
  family: string,
  document: ReturnType<typeof compositionDocumentFromInput>,
  result: InlineDiagnosticResult,
  coverage: JsPdfInlineFontCoverage | undefined,
): void {
  const runs = documentInlineRuns(document);
  const tableRuns = documentTableRuns(document);
  appendMissingGlyphDiagnostic(family, runs, result, coverage);
  appendTableGlyphDiagnostic(family, tableRuns, result, coverage);
  appendTableMarkupDiagnostic(tableRuns, result);
  appendItalicFallbackDiagnostic(doc, family, runs, result);
}
