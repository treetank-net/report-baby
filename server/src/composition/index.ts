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
} from './contracts/engine-contracts.js';
export { compareCompositionEvaluations, createCompositionEngine, renderComposition } from './composition-engine.js';
export { evaluateCompositionPlan, type CompositionEvaluationOptions } from './evaluation/evaluator.js';
export { compositionDocumentFromInput } from './adapters/input.js';
export { compositionTemplateFromPageGeometry, type PageTemplateCompositionOptions } from './adapters/page-template.js';
export { createTextCompositionPlanner } from './layout/text-planner.js';
export type { MovableGraphicPolicy, MovableInsertionBounds, TextCompositionPlannerPolicy } from './contracts/planner-policy.js';
export { createTextCompositionEngine, type TextCompositionEngineOptions } from './adapters/text-engine.js';
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
} from './adapters/render-config.js';
export type {
  CompositionGraphicColors,
} from './adapters/render-config.js';
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
