import type {
  CompositionBlock,
  CompositionBlockKind,
  CompositionBlockRole,
  CompositionDocument,
  CompositionInlineRun,
  CompositionGlyphAnchor,
  CompositionGlyphAnchorAlignment,
  CompositionGlyphTargetMode,
  CompositionGraphicShape,
  CompositionSlotPlacement,
  CompositionSlotKind,
  CompositionSpacingProfile,
  CompositionResolvedPlacementPolicy,
} from './model.js';
import type { CompositionSearchBudget } from './planner-policy.js';

export interface CompositionTextMetrics {
  units: string;
  family?: string;
  measureText(text: string, styleName: string, run?: CompositionInlineRun): number;
  lineHeight(styleName: string): number;
  lineInkBounds?(styleName: string): { top: number; bottom: number };
  glyphInkBounds?(text: string, styleName: string): { top: number; bottom: number };
  textPadding?(styleName: string): { top: number; bottom: number };
  foregroundColor?(styleName: string): [number, number, number] | undefined;
  glyphs?(styleName: string): CompositionGlyphSpec[];
  glyphBaselineOffset?(styleName: string): number;
  textIndent?(styleName: string): number;
  textMargins?(styleName: string): { before: number; after: number };
  textTrailingReserve?(styleName: string): number;
  blockGap?(previousStyle: string, nextStyle: string): number;
  measureBlock?(block: CompositionBlock, box: CompositionBox): CompositionBlockMeasurement;
  measureTable?(block: CompositionBlock, box: CompositionBox, startRow: number, options?: CompositionTableMeasureOptions): CompositionTableMeasurement;
}

export interface CompositionBlockMeasurement {
  height: number;
  scaled?: boolean;
  image?: {
    width: number;
    height: number;
    captionHeight: number;
    /** Measured caption frame width, independent of contain scaling of the image. */
    captionWidth?: number;
    scale: number;
  };
}

export interface CompositionTableMeasurement {
  height: number;
  endRow: number;
}

export interface CompositionTableMeasureOptions {
  repeatHeader: boolean;
}

export interface CompositionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Physical insets in the same units as a composition box (normally mm). */
export interface CompositionInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Static page geometry projected into the plan report. */
export interface CompositionPageGeometryReport {
  page: number;
  pageTemplateId: string;
  templateRef?: string;
  pageBox: CompositionBox;
  margins: CompositionInsets;
  contentBox: CompositionBox;
  bands: Record<string, CompositionBox>;
  segments: CompositionBox[];
  columns: CompositionBox[];
}

/** Renderer-neutral text spacing used by one block style. */
export interface CompositionTextSpacingReport {
  styleName: string;
  lineHeight: number;
  baselineOffset?: number;
  padding: { top: number; bottom: number };
  margin: { before: number; after: number };
  textIndent?: number;
}

/** Occupancy and signed boundary gaps for one materialized slot. */
export interface CompositionSlotSpacingReport {
  page: number;
  slotId: string;
  regionId: string;
  flowId?: string;
  templateRef?: string;
  box: CompositionBox;
  occupiedBox?: CompositionBox;
  occupiedArea?: number;
  emptyArea?: number;
  occupiedHeight: number;
  remainingHeight: number;
  gapBefore: number;
  gapAfter: number;
  staticBandGaps?: { fromHeader?: number; toFooter?: number };
  chromeBandGaps?: { fromHeader?: number; toFooter?: number };
  fitContent?: boolean;
  growthMaxHeight?: number;
  placement?: CompositionSlotPlacement;
  owner?: 'template' | 'input' | 'planner' | 'chrome';
  cause?: string;
  textStyles?: CompositionTextSpacingReport[];
  profile?: CompositionSpacingProfile;
}

/** Actual text placement spacing, including gaps to neighboring content. */
export interface CompositionTextPlacementSpacingReport {
  blockId: string;
  flowId: string;
  page: number;
  slotId: string;
  layer?: 'flow' | 'insertion';
  box: CompositionBox;
  slotBox: CompositionBox;
  lineCount: number;
  spacing: CompositionTextSpacingReport;
  gapBefore: number;
  gapAfter: number;
  gapToFooter?: number;
}

/** Identify one material element participating in a spacing observation. */
export interface CompositionSpacingSubject {
  kind: 'block' | 'graphic';
  id: string;
  flowId?: string;
  blockId?: string;
  slotId?: string;
}

/** Stable identity for one materialized occurrence receiving score attribution. */
export interface CompositionScorePlacement {
  id: string;
  kind: 'text' | 'block' | 'table' | 'graphic' | 'glyph';
  page: number;
  flowId?: string;
  blockId?: string;
  slotId?: string;
  graphicId?: string;
  glyphId?: string;
}

/** One conserved score contribution and its stable scoring reason. */
export interface CompositionPlacementScoreContribution {
  code: string;
  points: number;
}

/** Score assigned to one page/slot-qualified material placement. */
export interface CompositionPlacementScore {
  placement: CompositionScorePlacement;
  points: number;
  contributions: CompositionPlacementScoreContribution[];
}

/** Facts shared by machine-readable refinements; estimates are not measured outcomes. */
interface CompositionRepairProposalBase {
  id: string;
  placement: CompositionScorePlacement;
  sourceCode: string;
  estimatedPoints: number;
  estimateKind: 'local-geometry' | 'relocation' | 'orphan-recovery' | 'fragmentation-recovery' | 'optional-omission';
  evidencePlacementId?: string;
  measuredGap?: number;
  targetGap?: number;
  overlapArea?: number;
  orphanCount?: number;
  lineHeight?: number;
}

/** Move an insertion to another compatible, materialized slot/page. */
export interface CompositionRelocateRepairProposal extends CompositionRepairProposalBase {
  action: 'relocate';
  destination: {
    page: number;
    slotId: string;
    box: CompositionBox;
  };
  legalCapability: 'compatible-slot';
}

/** A bounded movement that is legal inside an explicitly declared frame. */
export interface CompositionMoveRepairProposal extends CompositionRepairProposalBase {
  action: 'move';
  axis: 'x' | 'y';
  direction: 'left' | 'right' | 'up' | 'down';
  distance: number;
  legalCapability: 'declared-movable-frame';
  legalBounds: CompositionBox;
}

/** Omission is only a candidate when the input explicitly opted in. */
export interface CompositionOmitRepairProposal extends CompositionRepairProposalBase {
  action: 'omit';
  legalCapability: 'input-allows-omission';
}

export type CompositionRepairProposal = CompositionMoveRepairProposal | CompositionRelocateRepairProposal | CompositionOmitRepairProposal;

/** Explainable, extensible facts derived from one plan region or obstacle. */
export interface CompositionSpacingObservation {
  kind: 'region' | 'obstacle' | 'insertion-rhythm' | 'element-proximity' | 'orphan-fragment';
  page: number;
  regionId?: string;
  flowId?: string;
  slotId?: string;
  blockId?: string;
  graphicId?: string;
  templateRef?: string;
  owner?: 'template' | 'input' | 'planner' | 'chrome';
  cause?: string;
  box?: CompositionBox;
  metrics: Record<string, number>;
  profile?: 'compact' | 'normal' | 'open';
  reasons?: string[];
  intervals?: Array<{ x: number; width: number }>;
  /** Present for element-proximity observations; identifies the measured pair. */
  from?: CompositionSpacingSubject;
  to?: CompositionSpacingSubject;
  fromBox?: CompositionBox;
  toBox?: CompositionBox;
  /** Whether the insertion has a declared legal movement capability. */
  movementAvailable?: boolean;
  /** True when no other measured subject lies between this pair on its spacing axis. */
  adjacent?: boolean;
  /** Axis along which this pair's spacing deficit was measured. */
  axis?: 'x' | 'y';
  /** Effective insertion policy that explains the observation's intended distribution. */
  placementPolicy?: CompositionResolvedPlacementPolicy;
}

/** Explainable geometry and spacing projection attached to a composition plan. */
export interface CompositionPlanSpacingReport {
  pages: CompositionPageGeometryReport[];
  slots: CompositionSlotSpacingReport[];
  textPlacements: CompositionTextPlacementSpacingReport[];
  observations?: CompositionSpacingObservation[];
}

export interface CompositionPageChrome {
  headerBand: CompositionBox;
  headerRule?: CompositionBox;
  footerRule: CompositionBox;
  pageNumber: CompositionBox;
  lockup?: CompositionBox;
}

export interface CompositionPagePlan {
  page: number;
  pageTemplateId: string;
  templateRef?: string;
  width: number;
  height: number;
  chrome?: CompositionPageChrome;
}

export interface CompositionSlot {
  id: string;
  page: number;
  regionId: string;
  flowId?: string;
  kind?: CompositionSlotKind;
  routeIndex?: number;
  allowedRoles?: CompositionBlockRole[];
  allowedBlockIds?: string[];
  allowedBlockKinds?: CompositionBlockKind[];
  priority?: number;
  spacingProfile?: CompositionSpacingProfile;
  placement?: CompositionSlotPlacement;
  fitContent?: boolean;
  growthMaxHeight?: number;
  box: CompositionBox;
  state: 'open' | 'partial' | 'exhausted';
}

export interface CompositionPlacement {
  id: string;
  blockId: string;
  slotId: string;
  page: number;
  box: CompositionBox;
  routeIndex?: number;
  startWord?: number;
  endWord?: number;
  layer?: 'flow' | 'insertion';
  priority?: number;
}

export interface CompositionBlockPlacement {
  id: string;
  blockId: string;
  kind: CompositionBlock['kind'];
  slotId: string;
  page: number;
  box: CompositionBox;
  routeIndex?: number;
  imageBox?: CompositionBox;
  captionBox?: CompositionBox;
  scale?: number;
  priority?: number;
}

export interface CompositionTablePlacement {
  id: string;
  blockId: string;
  slotId: string;
  page: number;
  box: CompositionBox;
  routeIndex?: number;
  startRow: number;
  endRow: number;
  repeatsHeader: boolean;
  priority?: number;
}

export interface CompositionGraphicPlacement {
  id: string;
  graphicId: string;
  assetId?: string;
  slotId: string;
  page: number;
  shape: CompositionGraphicShape;
  wrap: 'none' | 'around';
  paint?: boolean;
  box: CompositionBox;
  points?: Array<{ x: number; y: number }>;
  vertexCount?: number;
  innerRatio?: number;
  /** Effective policy used to choose this insertion's materialized position. */
  placementPolicy?: CompositionResolvedPlacementPolicy;
}

export interface CompositionGlyphSpec {
  id: string;
  text: string;
  styleName: string;
  anchor: CompositionGlyphAnchor;
  anchorAlignment?: CompositionGlyphAnchorAlignment;
  targetMode: CompositionGlyphTargetMode;
  anchorMeasureStyleName?: string;
  offsetX?: number;
  offsetY?: number;
  clampToTarget?: boolean;
  opacity?: number;
}

export interface CompositionGlyphPlacement {
  id: string;
  glyphId: string;
  targetType: 'block' | 'graphic';
  targetId: string;
  flowId?: string;
  page: number;
  slotId?: string;
  text: string;
  styleName: string;
  anchor: CompositionGlyphAnchor;
  anchorAlignment?: CompositionGlyphAnchorAlignment;
  anchorMeasureStyleName?: string;
  source: 'generated' | 'authored';
  box: CompositionBox;
  baselineY: number;
  opacity?: number;
}

export interface CompositionFlowBarrierBoxCandidate {
  id: string;
  flowId: string;
  previousSourceId?: string;
  nextSourceId?: string;
  placementId: string;
  page: number;
  box: CompositionBox;
}

export interface CompositionMovableInsertionFrame {
  id: string;
  flowId: string;
  blockId: string;
  page: number;
  box: CompositionBox;
  axis: 'x' | 'y';
  candidateCount: number;
}

export interface CompositionMovableGraphicFrame {
  id: string;
  graphicId: string;
  page: number;
  box: CompositionBox;
  axis: 'x' | 'y';
  candidateCount: number;
}

export interface CompositionLine {
  blockId: string;
  flowId: string;
  slotId: string;
  page: number;
  text: string;
  inlineRuns?: CompositionInlineRun[];
  box: CompositionBox;
  routeIndex?: number;
  textAlign?: 'left' | 'center' | 'right';
  naturalWidth: number;
  startWord: number;
  endWord: number;
  glyphSamplingBoxes?: CompositionGlyphSamplingBox[];
  layer?: 'flow' | 'insertion';
  priority?: number;
}

export interface CompositionGlyphSamplingBox {
  box: CompositionBox;
  baselineY: number;
  foreground?: [number, number, number];
}

export interface CompositionDecision {
  code: string;
  [key: string]: unknown;
}

export interface CompositionDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  why?: string;
  flowId?: string;
  blockId?: string;
  page?: number;
  slotId?: string;
  details?: Record<string, unknown>;
  remedies?: string[];
  retryable?: boolean;
}

export interface CompositionWordRange {
  start: number;
  end: number;
}

export interface CompositionResidualContent {
  flowId: string;
  blockId: string;
  reason: string;
  consumed?: CompositionWordRange;
  remaining?: CompositionWordRange;
  remainingRows?: { start: number; end: number };
  lastLegalSlotId?: string;
}

export type CompositionPlanningPhaseName =
  | 'preflight'
  | 'obstacle-reservation'
  | 'insertion-placement'
  | 'flow-placement'
  | 'reflow'
  | 'evaluation';

export interface CompositionPlanningPhase {
  name: CompositionPlanningPhaseName;
  iteration?: number;
  status: 'completed' | 'failed';
  details?: Record<string, unknown>;
}

export interface CompositionBlockTraceFragment {
  page: number;
  slotId: string;
  routeIndex?: number;
  startWord?: number;
  endWord?: number;
  text?: string;
  box: CompositionBox;
}

export interface CompositionTraceDecision {
  code: string;
  details: Record<string, unknown>;
}

export interface CompositionBlockTrace {
  flowId: string;
  blockId: string;
  kind: CompositionBlock['kind'];
  role: CompositionBlock['role'];
  sourceText: string;
  sourceWordCount: number;
  status: 'placed' | 'partial' | 'residual' | 'empty' | 'omitted';
  fragments: CompositionBlockTraceFragment[];
  decisions: CompositionTraceDecision[];
}

export interface CompositionSlotTrace {
  page: number;
  slotId: string;
  regionId: string;
  flowId?: string;
  routeIndex?: number;
  allowedRoles?: CompositionBlockRole[];
  state: CompositionSlot['state'];
  box: CompositionBox;
  lineCount: number;
  occupiedHeight: number;
  remainingHeight: number;
  lineHeight?: number;
  remainingLines?: number;
}

export interface CompositionFlowPlacement {
  id: string;
  flowId: string;
  page: number;
  slotId: string;
  routeIndex: number;
  box: CompositionBox;
  state: CompositionSlot['state'];
  hasContent: boolean;
  blockIds: string[];
  lineCount: number;
  blockedBy: string[];
}

export interface CompositionPlanTrace {
  phases: CompositionPlanningPhase[];
  blocks: CompositionBlockTrace[];
  slots: CompositionSlotTrace[];
  timings?: CompositionPlanTiming[];
  flowPlacements?: CompositionFlowPlacement[];
  flowBarrierBoxCandidates?: CompositionFlowBarrierBoxCandidate[];
  candidateSearch?: CompositionCandidateSearchTrace;
}

/** Elapsed time for one renderer-neutral planning operation. */
export type CompositionPlanTimingName =
  | 'document-materialization'
  | 'contrast-assessment'
  | 'legality-evaluation'
  | 'spacing-evidence'
  | 'scoring-and-repair-proposals';

export interface CompositionPlanTiming {
  name: CompositionPlanTimingName;
  elapsedMs: number;
}

export interface CompositionCandidateSearchRound {
  round: number;
  generatedCandidates: number;
  uniqueCandidates: number;
  skippedCandidates?: number;
  plannedCandidates?: number;
  evaluatedCandidates: number;
  legalCandidates: number;
  bestScore?: number;
  improved: boolean;
  reflowPasses: number;
  repairProposals?: CompositionRepairProposal[];
  repairAttempts?: CompositionRepairAttempt[];
  candidateResults?: CompositionCandidateSearchCandidate[];
  /** Refinement scope; page passes are still evaluated as complete documents. */
  scope?: CompositionRefinementScope;
  stopReason?: 'no-movable-placements' | 'no-new-candidates' | 'no-improvement' | 'minimum-step' | 'round-limit' | 'calculation-budget';
}

/** Limit evaluator-directed repairs to one page while preserving full-plan validation. */
export type CompositionRefinementScope =
  | { kind: 'document' }
  | { kind: 'page'; page: number };

export type CompositionCandidateSearchStopReason = CompositionCandidateSearchRound['stopReason']
  | 'legal-incumbent'
  | 'unsupported-hard-diagnostics'
  | 'search-budget-exhausted';

/** Connect one evaluator proposal to its generated and measured candidate, if any. */
export interface CompositionRepairAttempt {
  proposalId: string;
  status: 'not-materialized' | 'deduplicated' | 'budget-skipped' | 'evaluated';
  candidateSignature?: string;
  legal?: boolean;
  /** Actual geometry displacement tested by this complete candidate, when it is a move. */
  testedDistance?: number;
  /** Actual complete-plan score delta; absent until a generated candidate is evaluated. */
  scoreDelta?: number;
}

export interface CompositionCandidateSearchCandidate {
  signature: string;
  score?: number;
  scoreDelta?: number;
  legal: boolean;
  repairProposalIds?: string[];
  /** Preserve the reason a complete repair candidate failed legality. */
  diagnostics?: CompositionDiagnostic[];
}

export interface CompositionCandidateSearchTrace {
  rounds: CompositionCandidateSearchRound[];
  generatedCandidates: number;
  evaluatedCandidates: number;
  fullPlanRecalculations: number;
  planningTimeMs: number;
  /** Coarse request timings; evaluator legality/scoring subphases remain combined. */
  phaseTimings: {
    planningMs: number;
    /** Time spent materializing complete plans inside planner calls. */
    materializationMs: number;
    /** Planner-call time not accounted for by complete-plan materialization. */
    proposalGenerationMs: number;
    initialEvaluationMs: number;
    /** Total evaluator time across the initial and refinement phases. */
    evaluationMs: number;
    refinementMs: number;
  };
  stopReason: CompositionCandidateSearchStopReason;
  remainingBudget: number;
  untestedAlternatives: boolean;
  /** Page-template variant evaluated by an application-level layout scheduler. */
  layoutVariant?: string;
  /** Baseline and follow-up runs across application-level page-template variants. */
  layoutVariantRuns?: CompositionLayoutVariantRun[];
  selectedCandidate: number;
  selectedProposalSignature?: string;
}

/** Cost and result evidence for one application-level page-template run. */
export interface CompositionLayoutVariantRun {
  layoutVariant: string;
  stage: 'single-run' | 'baseline' | 'refinement';
  evaluationStatus: CompositionEvaluation['status'];
  score?: number;
  fullPlanRecalculations?: number;
  baselineExactMaterializationCount?: number;
}

export interface CompositionPlan {
  pages: CompositionPagePlan[];
  slots: CompositionSlot[];
  placements: CompositionPlacement[];
  blockPlacements: CompositionBlockPlacement[];
  tablePlacements: CompositionTablePlacement[];
  graphicPlacements: CompositionGraphicPlacement[];
  glyphPlacements?: CompositionGlyphPlacement[];
  flowBarrierBoxCandidates?: CompositionFlowBarrierBoxCandidate[];
  movableInsertionFrames?: CompositionMovableInsertionFrame[];
  movableGraphicFrames?: CompositionMovableGraphicFrame[];
  lines: CompositionLine[];
  insertionLines?: CompositionLine[];
  decisions: CompositionDecision[];
  diagnostics: CompositionDiagnostic[];
  residualContent: CompositionResidualContent[];
  repeatFlowIds?: string[];
  minimumFragmentLines?: number;
  flowPlacements?: CompositionFlowPlacement[];
  spacing?: CompositionPlanSpacingReport;
  trace?: CompositionPlanTrace;
  suggestions?: CompositionSuggestion[];
}

/** A complete plan paired with the deterministic proposal identity that produced it. */
export interface CompositionPlanCandidate {
  signature: string;
  plan: CompositionPlan;
  repairProposalIds?: string[];
}

export interface CompositionEvaluation {
  status: 'accepted' | 'accepted-with-warnings' | 'rejected';
  diagnostics: CompositionDiagnostic[];
  hardViolations: CompositionDiagnostic[];
  score: number;
  /** Configured base score; present for legal plans with attributed scoring. */
  scoreBase?: number;
  /** Algebraic ceiling for this authored document; not an attainable optimum. */
  scoreUpperBound?: number;
  /** Ceiling using only reward components with evidence in this evaluated plan. */
  measuredRewardUpperBound?: number;
  scoreBreakdown: CompositionScoreComponent[];
  /** Conserved placement-level decomposition of `score - scoreBase`. */
  placementScores?: CompositionPlacementScore[];
  /** Bounded, renderer-neutral actions the existing planner may try next. */
  repairProposals?: CompositionRepairProposal[];
  /** Quality components that did not produce a penalty for this plan. */
  passedMetrics: CompositionScoreComponent[];
  residualContent: CompositionResidualContent[];
  suggestions?: CompositionSuggestion[];
}

/** Actionable, non-legality guidance produced from an evaluated plan. */
export interface CompositionSuggestion {
  code: string;
  message: string;
  why?: string;
  page?: number;
  flowId?: string;
  blockId?: string;
  evidence?: Record<string, unknown>;
  remedies?: string[];
  retryable?: boolean;
}

export interface CompositionScoreComponent {
  code: string;
  value: number;
  points: number;
  /** Configured reward ceiling (zero for a penalty-only component). */
  rewardCeiling?: number;
  rewardEvidence?: 'measured' | 'not-measured' | 'not-applicable';
  /** Distance to the ceiling, not a promise of recoverable points. */
  ceilingGap?: number;
  details?: Record<string, unknown>;
}

export interface CompositionPlanner {
  plan(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan;
  /** Produce one deterministic baseline without pre-materializing alternatives. */
  planBaselineWithSignature?(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlanCandidate;
  /** Materialize bounded complete coarse seeds; the engine selects by exact evaluation. */
  planBaselineCandidatesWithSignatures?(document: CompositionDocument, metrics: CompositionTextMetrics, maximumCandidates: number): CompositionPlanCandidate[];
  /** Produce bounded corrections for an illegal selected plan. */
  planLegalityCorrectionsWithSignatures?(
    document: CompositionDocument,
    metrics: CompositionTextMetrics,
    selected: CompositionPlan,
    rejectedEvaluation: CompositionEvaluation,
    round: number,
    remainingBudget: number,
  ): CompositionPlanCandidate[];
  /** Produce bounded evaluator-directed repairs for a legal selected plan. */
  planQualityRepairsWithSignatures?(
    document: CompositionDocument,
    metrics: CompositionTextMetrics,
    selected: CompositionPlan,
    legalEvaluation: CompositionEvaluation,
    round: number,
    remainingBudget: number,
    scope?: CompositionRefinementScope,
  ): CompositionPlanCandidate[];
  planCandidates?(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan[];
  planCandidatesWithSignatures?(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlanCandidate[];
  candidateRefinementRounds?: number;
  searchBudget?: CompositionSearchBudget;
  planRefinedCandidates?(document: CompositionDocument, metrics: CompositionTextMetrics, selected: CompositionPlan, round: number, evaluation?: CompositionEvaluation): CompositionPlan[];
  planRefinedCandidatesWithSignatures?(document: CompositionDocument, metrics: CompositionTextMetrics, selected: CompositionPlan, round: number, evaluation?: CompositionEvaluation): CompositionPlanCandidate[];
}

export interface CompositionEvaluator {
  evaluate(document: CompositionDocument, plan: CompositionPlan): CompositionEvaluation;
}

export interface CompositionPlanResult {
  plan: CompositionPlan;
  evaluation: CompositionEvaluation;
}

export interface CompositionEngine {
  plan(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlanResult;
  /** Continue search from a baseline that was already materialized and evaluated. */
  continueFromBaseline?(document: CompositionDocument, metrics: CompositionTextMetrics, baseline: CompositionPlanResult): CompositionPlanResult;
}

export interface CompositionBackend<Artifact = unknown> {
  render(document: CompositionDocument, plan: CompositionPlan): Artifact | Promise<Artifact>;
}
