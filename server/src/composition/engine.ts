import type { CompositionBlock, CompositionBlockKind, CompositionBlockRole, CompositionDocument, CompositionGlyphAnchor, CompositionGlyphAnchorAlignment, CompositionGlyphTargetMode, CompositionGraphicShape, CompositionSlotKind } from './model.js';

export interface CompositionTextMetrics {
  units: string;
  family?: string;
  measureText(text: string, styleName: string): number;
  lineHeight(styleName: string): number;
  /**
   * Actual painted glyph bounds relative to the top of a planned line box.
   * The values include the configured baseline offset and are expressed in
   * the same units as the composition geometry.
   */
  lineInkBounds?(styleName: string): { top: number; bottom: number };
  /** Actual painted bounds for one decorative glyph, relative to its line box. */
  glyphInkBounds?(text: string, styleName: string): { top: number; bottom: number };
  /** Internal top/bottom padding for a text block, in page geometry units. */
  textPadding?(styleName: string): { top: number; bottom: number };
  /** Foreground color used when sampling this style over a background. */
  foregroundColor?(styleName: string): [number, number, number] | undefined;
  glyphs?(styleName: string): CompositionGlyphSpec[];
  glyphBaselineOffset?(styleName: string): number;
  textIndent?(styleName: string): number;
  /** Width reserved after the final line for a trailing inline decoration. */
  textTrailingReserve?(styleName: string): number;
  /** Default inter-block spacing in the same units as the page geometry. */
  blockGap?(previousStyle: string, nextStyle: string): number;
  /** Measure a non-text block in the available slot without depending on a backend. */
  measureBlock?(block: CompositionBlock, box: CompositionBox): CompositionBlockMeasurement;
  /** Measure the next table fragment and return the first unconsumed row. */
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
  /** Whether the fragment will paint the table header before its body rows. */
  repeatHeader: boolean;
}

export interface CompositionBox {
  x: number;
  y: number;
  width: number;
  height: number;
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
  box: CompositionBox;
  state: 'open' | 'partial' | 'exhausted';
}

export interface CompositionPlacement {
  id: string;
  blockId: string;
  slotId: string;
  page: number;
  box: CompositionBox;
  /** Position in the flow route on the page; used for semantic-order QA. */
  routeIndex?: number;
  startWord?: number;
  endWord?: number;
  layer?: 'flow' | 'insertion';
}

export interface CompositionBlockPlacement {
  id: string;
  blockId: string;
  kind: CompositionBlock['kind'];
  slotId: string;
  page: number;
  box: CompositionBox;
  /** Position in the flow route on the page; used for semantic-order QA. */
  routeIndex?: number;
  imageBox?: CompositionBox;
  captionBox?: CompositionBox;
  scale?: number;
}

export interface CompositionTablePlacement {
  id: string;
  blockId: string;
  slotId: string;
  page: number;
  box: CompositionBox;
  /** Position in the flow route on the page; used for semantic-order QA. */
  routeIndex?: number;
  startRow: number;
  endRow: number;
  repeatsHeader: boolean;
}

export interface CompositionGraphicPlacement {
  id: string;
  graphicId: string;
  assetId?: string;
  slotId: string;
  page: number;
  shape: CompositionGraphicShape;
  wrap: 'none' | 'around';
  /** False for a planner-only exclusion boundary already painted by a block renderer. */
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

/** A possible text-flow fragment split by a collision boundary. */
export interface CompositionFlowBarrierBoxCandidate {
  id: string;
  flowId: string;
  previousSourceId?: string;
  nextSourceId?: string;
  placementId: string;
  page: number;
  box: CompositionBox;
}

/** A legal movement frame exposed for composition-debug overlays. */
export interface CompositionMovableInsertionFrame {
  id: string;
  flowId: string;
  blockId: string;
  page: number;
  box: CompositionBox;
  axis: 'x' | 'y';
  candidateCount: number;
}

/** A legal frame used to generate movable authored-graphic candidates. */
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
  box: CompositionBox;
  /** Position in the flow route on the page; used for semantic-order QA. */
  routeIndex?: number;
  textAlign?: 'left' | 'center' | 'right';
  naturalWidth: number;
  startWord: number;
  endWord: number;
  /** Per-glyph sampling frames used by local contrast evaluation. */
  glyphSamplingBoxes?: CompositionGlyphSamplingBox[];
  layer?: 'flow' | 'insertion';
}

export interface CompositionGlyphSamplingBox {
  /** Approximate character cell: measured advance width by complete line height. */
  box: CompositionBox;
  /** Baseline in the same page coordinates; sampling offsets are normalized around box center. */
  baselineY: number;
  /** Optional per-glyph foreground; the provider falls back to its default color. */
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
  flowId?: string;
  blockId?: string;
  page?: number;
  slotId?: string;
  details?: Record<string, unknown>;
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

/** Every route location offered to a flow, including empty locations. */
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

/** A compact, human-oriented projection of the otherwise flat plan. */
export interface CompositionPlanTrace {
  phases: CompositionPlanningPhase[];
  blocks: CompositionBlockTrace[];
  slots: CompositionSlotTrace[];
  flowPlacements?: CompositionFlowPlacement[];
  flowBarrierBoxCandidates?: CompositionFlowBarrierBoxCandidate[];
}

export interface CompositionPlan {
  pages: CompositionPagePlan[];
  slots: CompositionSlot[];
  placements: CompositionPlacement[];
  blockPlacements: CompositionBlockPlacement[];
  tablePlacements: CompositionTablePlacement[];
  graphicPlacements: CompositionGraphicPlacement[];
  /** Decorative glyph objects resolved against final text/graphic geometry. */
  glyphPlacements?: CompositionGlyphPlacement[];
  /** Candidate boxes split around collision graphics and consumed by ordinary flow wrapping. */
  flowBarrierBoxCandidates?: CompositionFlowBarrierBoxCandidate[];
  /** Legal frame used to generate movable insertion candidates. */
  movableInsertionFrames?: CompositionMovableInsertionFrame[];
  /** Legal frames used to generate movable authored-graphic candidates. */
  movableGraphicFrames?: CompositionMovableGraphicFrame[];
  /** Ordinary flowing text only. Insertions are exposed separately below. */
  lines: CompositionLine[];
  /** Text painted into fixed insertion/obstacle boxes, outside the main route. */
  insertionLines?: CompositionLine[];
  decisions: CompositionDecision[];
  diagnostics: CompositionDiagnostic[];
  residualContent: CompositionResidualContent[];
  repeatFlowIds?: string[];
  /** Policy carried into evaluation so underfilled route transitions fail closed. */
  minimumFragmentLines?: number;
  /** Complete route registry used to detect empty locations between content. */
  flowPlacements?: CompositionFlowPlacement[];
  /** Grouped explanation of the plan, kept alongside the executable records. */
  trace?: CompositionPlanTrace;
}

export interface CompositionEvaluation {
  status: 'accepted' | 'accepted-with-warnings' | 'rejected';
  diagnostics: CompositionDiagnostic[];
  hardViolations: CompositionDiagnostic[];
  score: number;
  scoreBreakdown: CompositionScoreComponent[];
  residualContent: CompositionResidualContent[];
}

export interface CompositionScoreComponent {
  code: string;
  value: number;
  points: number;
  details?: Record<string, unknown>;
}

/**
 * Orders two evaluated plans for a deterministic candidate-selection step.
 * A legal plan always wins over an illegal one; among legal plans, the higher
 * score wins. Equal evaluations intentionally remain a tie so the caller can
 * apply a stable candidate-order tie-break without hiding it here.
 */
export function compareCompositionEvaluations(left: CompositionEvaluation, right: CompositionEvaluation): number {
  const leftLegal = left.status !== 'rejected' && left.hardViolations.length === 0 && left.residualContent.length === 0;
  const rightLegal = right.status !== 'rejected' && right.hardViolations.length === 0 && right.residualContent.length === 0;
  if (leftLegal !== rightLegal) return leftLegal ? -1 : 1;
  if (left.score !== right.score) return left.score > right.score ? -1 : 1;
  return 0;
}

export interface CompositionPlanner {
  plan(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan;
  /** Optional deterministic candidate set for planner/evaluator selection. */
  planCandidates?(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan[];
  /** Number of score-guided local candidate refinement rounds available. */
  candidateRefinementRounds?: number;
  /** Generate a local candidate neighborhood around the selected plan. */
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

export function renderComposition<Artifact>(
  document: CompositionDocument,
  result: CompositionPlanResult,
  backend: CompositionBackend<Artifact>,
): Artifact | Promise<Artifact> {
  if (result.evaluation.status === 'rejected') {
    throw new Error('Composition plan was rejected and cannot be rendered.');
  }
  return backend.render(document, result.plan);
}

/**
 * Dependency-injection seam for the renderer-neutral composition pipeline.
 * The planner and evaluator have no PDF dependency; a backend consumes the
 * resulting plan in a later adapter step.
 */
export function createCompositionEngine(planner: CompositionPlanner, evaluator: CompositionEvaluator): CompositionEngine {
  return {
    plan(document, metrics) {
      const candidates = planner.planCandidates?.(document, metrics) ?? [planner.plan(document, metrics)];
      if (candidates.length === 0) throw new Error('Composition planner returned no candidates.');
      const candidateRounds = candidates.map(() => 0);
      const evaluations = candidates.map((candidate) => evaluator.evaluate(document, candidate));
      let selectedCandidate = 0;
      for (let index = 1; index < evaluations.length; index += 1) {
        if (compareCompositionEvaluations(evaluations[index], evaluations[selectedCandidate]) < 0) selectedCandidate = index;
      }
      const refinementRounds = planner.candidateRefinementRounds ?? 0;
      for (let round = 1; round <= refinementRounds; round += 1) {
        const refined = planner.planRefinedCandidates?.(document, metrics, candidates[selectedCandidate], round) ?? [];
        if (refined.length === 0) break;
        const refinedEvaluations = refined.map((candidate) => evaluator.evaluate(document, candidate));
        for (let index = 0; index < refined.length; index += 1) {
          candidates.push(refined[index]);
          evaluations.push(refinedEvaluations[index]);
          candidateRounds.push(round);
          const candidateIndex = evaluations.length - 1;
          if (compareCompositionEvaluations(evaluations[candidateIndex], evaluations[selectedCandidate]) < 0) selectedCandidate = candidateIndex;
        }
      }
      const plan = candidates[selectedCandidate];
      const evaluation = evaluations[selectedCandidate];
      plan.trace?.phases.push({
        name: 'evaluation',
        status: evaluation.status === 'rejected' ? 'failed' : 'completed',
        details: {
          diagnosticCount: evaluation.diagnostics.length,
          errorCount: evaluation.diagnostics.filter((item) => item.severity === 'error').length,
          candidates: evaluations.map((candidateEvaluation, index) => ({
            index,
            status: candidateEvaluation.status,
            score: candidateEvaluation.score,
            scoreBreakdown: candidateEvaluation.scoreBreakdown,
            hardViolationCount: candidateEvaluation.hardViolations.length,
            reflowPasses: candidates[index].trace?.phases.filter((phase) => phase.name === 'reflow').length ?? 0,
            refinementRound: candidateRounds[index],
            insertionPlacements: candidates[index].graphicPlacements
              .filter((graphic) => graphic.graphicId.startsWith('insertion:'))
              .map((graphic) => ({
                graphicId: graphic.graphicId,
                page: graphic.page,
                slotId: graphic.slotId,
                box: { ...graphic.box },
              })),
          })),
          selectedCandidate,
        },
      });
      return { plan, evaluation };
    },
  };
}
