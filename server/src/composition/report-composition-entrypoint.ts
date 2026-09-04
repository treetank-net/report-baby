import type { jsPDF } from 'jspdf';
import { readRenderConfig } from '../builtin-template-source.js';
import type { PageGeometry } from '../page-geometry.js';
import type { CompositionInput } from '../contract/schema.js';
import type { CompiledTemplate } from '../template-contract.js';
import type { CompositionTemplate } from './model.js';
import type { CompositionEvaluation, CompositionPlan, CompositionTextMetrics } from './engine.js';
import type { CompositionContrastProvider } from './contrast.js';
import { compositionDocumentFromInput } from './input.js';
import { compositionTemplateFromPageGeometry } from './page-template-adapter.js';
import { createJsPdfTextMetrics, type JsPdfCompositionStyles } from './js-pdf-adapter.js';
import { createTextCompositionEngine } from './text-engine.js';
import type { TextCompositionPlannerPolicy } from './text-planner.js';
import { compositionStylesFromRenderConfig } from './render-config-styles.js';

export {
  compositionChartStyleFromRenderConfig,
  compositionImageStyleFromRenderConfig,
  compositionMetricStyleFromRenderConfig,
  compositionPdfBackendOptionsFromRenderConfig,
  compositionStylesFromRenderConfig,
  compositionTableStyleFromRenderConfig,
} from './render-config-styles.js';
export type {
  CompositionChartColors,
  CompositionMetricColors,
  CompositionTableColors,
  CompositionTextColors,
} from './render-config-styles.js';

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
}

export interface ReportCompositionResult {
  document: ReturnType<typeof compositionDocumentFromInput>;
  template: CompositionTemplate;
  metrics: CompositionTextMetrics;
  plan: CompositionPlan;
  evaluation: CompositionEvaluation;
}

function pdfNumber(pdf: Record<string, number>, key: string): number {
  const value = pdf[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite pdf.${key}.`);
  return value;
}

/**
 * Prepare one report composition run for the renderer-neutral engine.
 *
 * This is the application entry point for report composition. It translates
 * report input and compiled page geometry into composition inputs, supplies
 * the real jsPDF measurement capability, and returns the engine result. It
 * does not render PDF content and does not contain layout rules.
 */
export function planReportComposition(
  doc: jsPDF,
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  data: CompositionInput,
  options: ReportCompositionOptions,
): ReportCompositionResult {
  const document = compositionDocumentFromInput(data);
  const template = compositionTemplateFromPageGeometry(compiled, geometry, {
    maxPages: options.maxPages,
    ...(options.includeTitlePage === undefined ? {} : { includeTitlePage: options.includeTitlePage }),
    includeHeaderFlow: options.includeHeaderFlow ?? true,
    ...(options.mainFlowId === undefined ? {} : { mainFlowId: options.mainFlowId }),
    ...(options.auxiliaryTextWidths === undefined ? {} : { auxiliaryTextWidths: options.auxiliaryTextWidths }),
  });
  const styles = options.styles ?? compositionStylesFromRenderConfig();
  const metrics = createJsPdfTextMetrics(doc, options.family, styles);
  if (options.measureBlock) metrics.measureBlock = options.measureBlock;
  if (options.measureTable) metrics.measureTable = options.measureTable;
  const pdf = readRenderConfig().pdf;
  const policy: TextCompositionPlannerPolicy = {
    headingKeepWithNextLines: pdfNumber(pdf, 'headingKeepWithNextLines'),
    minimumLinesAtStart: pdfNumber(pdf, 'widowMinLines'),
    minimumLinesAtEnd: pdfNumber(pdf, 'orphanMinLines'),
    maxPlanningIterations: pdfNumber(pdf, 'plannerMaxIterations'),
    minimumFragmentLines: pdfNumber(pdf, 'plannerMinimumFragmentLines'),
    geometryTolerance: pdfNumber(pdf, 'compositionGeometryTolerance'),
    keepListItemsTogether: pdfNumber(pdf, 'listItemKeepTogether') === 1,
    ...options.policy,
  };
  const result = createTextCompositionEngine(template, policy, options.contrastProvider ? { contrastProvider: options.contrastProvider } : {}).plan(document, metrics);
  return { document, template, metrics, plan: result.plan, evaluation: result.evaluation };
}
