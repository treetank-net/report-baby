import type { CompositionBlock, CompositionBlockKind, CompositionBlockRole, CompositionDocument, CompositionGraphicShape, CompositionSlotKind } from './model.js';

export interface CompositionTextMetrics {
  units: string;
  family?: string;
  measureText(text: string, styleName: string): number;
  lineHeight(styleName: string): number;
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

export interface CompositionPagePlan {
  page: number;
  layoutId: string;
  width: number;
  height: number;
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
  layer?: 'flow' | 'insertion';
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

/** A compact, human-oriented projection of the otherwise flat plan. */
export interface CompositionPlanTrace {
  phases: CompositionPlanningPhase[];
  blocks: CompositionBlockTrace[];
  slots: CompositionSlotTrace[];
}

export interface CompositionPlan {
  pages: CompositionPagePlan[];
  slots: CompositionSlot[];
  placements: CompositionPlacement[];
  blockPlacements: CompositionBlockPlacement[];
  tablePlacements: CompositionTablePlacement[];
  graphicPlacements: CompositionGraphicPlacement[];
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
  /** Grouped explanation of the plan, kept alongside the executable records. */
  trace?: CompositionPlanTrace;
}

export interface CompositionEvaluation {
  status: 'accepted' | 'accepted-with-warnings' | 'rejected';
  diagnostics: CompositionDiagnostic[];
  residualContent: CompositionResidualContent[];
}

export interface CompositionPlanner {
  plan(document: CompositionDocument, metrics: CompositionTextMetrics): CompositionPlan;
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
      const plan = planner.plan(document, metrics);
      return { plan, evaluation: evaluator.evaluate(document, plan) };
    },
  };
}
