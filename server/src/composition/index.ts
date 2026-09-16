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
  CompositionInlineMark,
  CompositionInlineRun,
  CompositionFlowRoute,
  CompositionPageTemplate,
  CompositionPageTemplateAssignment,
  CompositionMetric,
  CompositionLockup,
  CompositionLayout,
  CompositionRect,
  CompositionSlotKind,
  CompositionSpacingProfile,
  CompositionSlotPlacement,
  CompositionSlotTemplate,
  CompositionTable,
} from './contracts/model.js';
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
  CompositionPlanCandidate,
  CompositionPlanTrace,
  CompositionPlacementScore,
  CompositionPlacementScoreContribution,
  CompositionRepairProposal,
  CompositionMoveRepairProposal,
  CompositionOmitRepairProposal,
  CompositionScorePlacement,
  CompositionCandidateSearchCandidate,
  CompositionCandidateSearchRound,
  CompositionCandidateSearchTrace,
  CompositionRepairAttempt,
  CompositionPlanningPhase,
  CompositionPlanningPhaseName,
  CompositionBlockTrace,
  CompositionBlockTraceFragment,
  CompositionFlowPlacement,
  CompositionSlotTrace,
  CompositionTraceDecision,
  CompositionPlanResult,
  CompositionScoreComponent,
  CompositionSpacingObservation,
  CompositionSpacingSubject,
  CompositionPlanner,
  CompositionResidualContent,
  CompositionSlot,
  CompositionTextMetrics,
  CompositionWordRange,
} from './contracts/engine-contracts.js';
export { compareCompositionEvaluations, createCompositionEngine, renderComposition } from './composition-engine.js';
export { evaluateCompositionPlan, type CompositionEvaluationOptions } from './evaluation/evaluator.js';
export { attributeCompositionScore } from './evaluation/score-attribution.js';
export { compositionRepairProposals } from './evaluation/repair-proposals.js';
export { scoreListContinuity, scoreTableContinuity, scoreTinyFragments } from './evaluation/structure-scoring.js';
export { scoreEmptyRegions, scoreSiblingColumnImbalance, scoreInsertionSymmetry, scoreInsertionDistribution, scoreSpacingRhythm, scoreNarrowTextIntervals, scoreFitContentEnvelope, scoreFooterGap, scoreGlyphOverlap, scoreElementProximity, scoreParagraphFragmentation, scoreOrphanLines, scoreLegalPlan } from './evaluation/scoring.js';
export { elementProximityReports } from './observability/proximity-report.js';
export { compositionDocumentFromInput } from './adapters/input.js';
export { compositionTemplateFromPageGeometry, compositionTemplateFromDocumentLayout, type PageTemplateCompositionOptions, type PageTemplateSource } from './adapters/page-template.js';
export { documentLayoutVariantsWithinPageLimit, normalizeDocumentLayout, pageTemplateAssignmentForPage, type DocumentLayoutVariant } from './adapters/document-layout.js';
export { applyDynamicInsertionRequests } from './adapters/request-insertion-slots.js';
export { createTextCompositionPlanner } from './layout/text-planner.js';
export type { MovableGraphicPolicy, MovableInsertionBounds, TextCompositionPlannerPolicy } from './contracts/planner-policy.js';
export { createTextCompositionEngine, type TextCompositionEngineOptions } from './adapters/text-engine.js';
export { fitContainBox, imagePixelAtPoint } from './geometry/visual-geometry.js';
export { rectBottom, rectFitsInside, rectsOverlap, rectIntersection, rectIntersectionArea, rectUnionArea } from './geometry/rectangles.js';
export { resolvePagePlaceholders } from './text/page-placeholders.js';
export {
  assertCompositionDraftRenderable,
  createCompositionDraft,
  selectCompositionDraftCandidate,
  updateCompositionDraft,
  type CompositionDraft,
  type CompositionDraftCandidate,
  type CompositionDraftSources,
} from './drafts/draft-contract.js';
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
export { createJsPdfLockupBlockCapabilities } from './adapters/pdf/lockup.js';
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
  JsPdfCompositionLockupStyle,
} from './contracts/pdf.js';
