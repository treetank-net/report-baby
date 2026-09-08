/**
 * Compatibility surface for existing composition imports.
 *
 * Contracts live in `contracts/engine-contracts.ts`; executable orchestration
 * lives in `composition-engine.ts`. Keeping this path temporarily preserves
 * the established module API while callers migrate to the owned seams.
 */
export type {
  CompositionBackend,
  CompositionBlockMeasurement,
  CompositionBlockPlacement,
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
  CompositionPlanResult,
  CompositionScoreComponent,
  CompositionPlanner,
  CompositionEvaluator,
  CompositionResidualContent,
  CompositionSlot,
  CompositionTableMeasureOptions,
  CompositionTableMeasurement,
  CompositionTablePlacement,
  CompositionTextMetrics,
  CompositionWordRange,
  CompositionGlyphPlacement,
  CompositionGlyphSpec,
  CompositionPageChrome,
} from './contracts/engine-contracts.js';
export {
  compareCompositionEvaluations,
  createCompositionEngine,
  renderComposition,
} from './composition-engine.js';
