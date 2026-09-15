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
  CompositionSlotKind,
} from './model.js';

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
  layoutId: string;
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
  box: CompositionBox;
  occupiedBox?: CompositionBox;
  occupiedHeight: number;
  remainingHeight: number;
  gapBefore: number;
  gapAfter: number;
  staticBandGaps?: { fromHeader?: number; toFooter?: number };
  chromeBandGaps?: { fromHeader?: number; toFooter?: number };
  textStyles?: CompositionTextSpacingReport[];
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

/** Explainable geometry and spacing projection attached to a composition plan. */
export interface CompositionPlanSpacingReport {
  pages: CompositionPageGeometryReport[];
  slots: CompositionSlotSpacingReport[];
  textPlacements: CompositionTextPlacementSpacingReport[];
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
  layoutId: string;
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
  status: 'placed' | 'partial' | 'residual' | 'empty';
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
  flowPlacements?: CompositionFlowPlacement[];
  flowBarrierBoxCandidates?: CompositionFlowBarrierBoxCandidate[];
  candidateSearch?: CompositionCandidateSearchTrace;
}

export interface CompositionCandidateSearchRound {
  round: number;
  generatedCandidates: number;
  uniqueCandidates: number;
  evaluatedCandidates: number;
  legalCandidates: number;
  bestScore?: number;
  improved: boolean;
  reflowPasses: number;
  stopReason?: 'no-improvement' | 'limit' | 'no-candidates';
}

export interface CompositionCandidateSearchTrace {
  rounds: CompositionCandidateSearchRound[];
  generatedCandidates: number;
  evaluatedCandidates: number;
  fullPlanRecalculations: number;
  planningTimeMs: number;
  selectedCandidate: number;
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

export interface CompositionEvaluation {
  status: 'accepted' | 'accepted-with-warnings' | 'rejected';
  diagnostics: CompositionDiagnostic[];
  hardViolations: CompositionDiagnostic[];
  score: number;
  scoreBreakdown: CompositionScoreComponent[];
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
  details?: Record<string, unknown>;
}

export interface CompositionPlanner {
  plan(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan;
  planCandidates?(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan[];
  candidateRefinementRounds?: number;
  planRefinedCandidates?(document: CompositionDocument, metrics: CompositionTextMetrics, selected: CompositionPlan, round: number): CompositionPlan[];
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
}

export interface CompositionBackend<Artifact = unknown> {
  render(document: CompositionDocument, plan: CompositionPlan): Artifact | Promise<Artifact>;
}
