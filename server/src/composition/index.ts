export type {
  CompositionBlock,
  CompositionBlockKind,
  CompositionBlockRole,
  CompositionChart,
  CompositionAsset,
  CompositionDocument,
  CompositionFlow,
  CompositionGraphic,
  CompositionGraphicShape,
  CompositionImage,
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionMetric,
  CompositionRect,
  CompositionSlotKind,
  CompositionSlotTemplate,
  CompositionTable,
  CompositionTemplate,
} from './model.js';
export type {
  CompositionBackend,
  CompositionBlockMeasurement,
  CompositionBlockPlacement,
  CompositionTableMeasurement,
  CompositionTablePlacement,
  CompositionBox,
  CompositionDecision,
  CompositionDiagnostic,
  CompositionEngine,
  CompositionEvaluation,
  CompositionFlowBarrierBoxCandidate,
  CompositionMovableInsertionFrame,
  CompositionMovableGraphicFrame,
  CompositionGraphicPlacement,
  CompositionGlyphSamplingBox,
  CompositionLine,
  CompositionPagePlan,
  CompositionPlacement,
  CompositionPlan,
  CompositionPlanTrace,
  CompositionPlanningPhase,
  CompositionPlanningPhaseName,
  CompositionBlockTrace,
  CompositionBlockTraceFragment,
  CompositionFlowPlacement,
  CompositionSlotTrace,
  CompositionTraceDecision,
  CompositionPlanResult,
  CompositionScoreComponent,
  CompositionPlanner,
  CompositionResidualContent,
  CompositionSlot,
  CompositionTextMetrics,
  CompositionWordRange,
} from './engine.js';
export { compareCompositionEvaluations, createCompositionEngine, renderComposition } from './engine.js';
export { evaluateCompositionPlan, type CompositionEvaluationOptions } from './evaluation/evaluator.js';
export { compositionDocumentFromInput } from './input.js';
export { compositionTemplateFromPageGeometry, type PageTemplateCompositionOptions } from './page-template-adapter.js';
export { createTextCompositionPlanner, type MovableGraphicPolicy, type MovableInsertionBounds, type TextCompositionPlannerPolicy } from './text-planner.js';
export { createTextCompositionEngine, type TextCompositionEngineOptions } from './text-engine.js';
export { fitContainBox, imagePixelAtPoint } from './geometry/visual-geometry.js';
export {
  contrastRatio,
  createCompositionContrastProvider,
  relativeLuminance,
  sampleCompositionContrast,
  type CompositionContrastAssessment,
  type CompositionContrastGlyphResult,
  type CompositionContrastProvider,
  type CompositionContrastProviderOptions,
  type CompositionContrastResult,
  type CompositionContrastSampleOptions,
  type CompositionContrastStatus,
  type CompositionRasterImage,
  type CompositionRgbColor,
} from './evaluation/contrast.js';
export {
  compositionGraphicStyleFromRenderConfig,
  compositionStylesFromRenderConfig,
} from './render-config-styles.js';
export type {
  CompositionGraphicColors,
} from './render-config-styles.js';
export {
  combineJsPdfCompositionBlockCapabilities,
  createJsPdfTextBackend,
} from './adapters/pdf/backend.js';
export { createJsPdfChartBlockCapabilities } from './adapters/pdf/chart.js';
export { createJsPdfMetricBlockCapabilities } from './adapters/pdf/metric.js';
export { createJsPdfTableBlockCapabilities } from './adapters/pdf/table.js';
export { createJsPdfImageBlockCapabilities } from './adapters/pdf/image.js';
export { createJsPdfTextMetrics } from './adapters/pdf/text.js';
export type {
  JsPdfCompositionStyle,
  JsPdfCompositionStyles,
  JsPdfCompositionBackendOptions,
  JsPdfCompositionBlockRenderer,
  JsPdfCompositionChartStyle,
  JsPdfCompositionTableRenderer,
  JsPdfCompositionTableStyle,
  JsPdfCompositionMetricStyle,
  JsPdfCompositionGraphicStyle,
  JsPdfCompositionImageAsset,
  JsPdfCompositionImageRenderer,
  JsPdfCompositionImageStyle,
  JsPdfCompositionBlockCapability,
} from './contracts/pdf.js';
