import type { NormalizedContentNode } from '../../content/contracts/normalized-content.js';

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CompositionSlotKind = 'text' | 'graphic' | 'block';
export type CompositionSpacingProfile = 'compact' | 'normal' | 'open';
export type CompositionSlotPlacement =
  | { mode: 'fixed' }
  | { mode: 'anchored-fit-content' }
  | { mode: 'fluid-y'; region: string; maxInstancesPerPage: number; distribution?: 'free' | 'balanced' };
export type CompositionGraphicShape = 'rectangle' | 'ellipse' | 'triangle' | 'star' | 'polygon';

export interface CompositionGraphic {
  id: string;
  assetId?: string;
  /** References a `kind: graphic` slot in the selected page layout. */
  slotId: string;
  /** Optional painted size inside the graphic slot; omitted means slot-sized. */
  size?: { width: number; height: number };
  /**
   * The shape is the text-flow boundary. An asset remains a rectangular image;
   * transparent pixels in that image are responsible for its visual silhouette.
   */
  shape: CompositionGraphicShape;
  wrap?: 'none' | 'around';
  /** Defaults to page 1; a graphic is not repeated unless declared again. */
  page?: number;
  /** Optional polygon points normalized to the graphic slot (0..1). */
  points?: Array<{ x: number; y: number }>;
  /** Required for a generated star; controls its number of tips. */
  vertexCount?: number;
  /** Required for a generated star; normalized inner radius. */
  innerRatio?: number;
  alt?: string;
}

export type CompositionGlyphAnchor = 'box' | 'text-start' | 'text-end';
export type CompositionGlyphAnchorAlignment = 'start' | 'end';
export type CompositionGlyphTargetMode = 'first-line' | 'last-line' | 'box';

/** A renderer-neutral decoration attached to a planned block or graphic. */
export interface CompositionGlyphDefinition {
  id: string;
  target: { kind: 'block' | 'graphic'; id: string };
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

export interface CompositionAsset {
  id: string;
  source: string;
  alt?: string;
  caption?: string;
  width: 'full' | `${number}%`;
  fit: 'contain';
  keepWithCaption: boolean;
}

export interface CompositionSlotTemplate {
  id: string;
  regionId: string;
  flowId?: string;
  kind: CompositionSlotKind;
  box: CompositionRect;
  /** A non-flow box painted by chrome or another renderer that still reserves space. */
  reserved?: boolean;
  /** Slot is available only on the first materialized page of its template. */
  firstPageOnly?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fitContent?: boolean;
  allowedRoles?: CompositionBlockRole[];
  allowedBlockIds?: string[];
  allowedBlockKinds?: CompositionBlockKind[];
  /** Higher values reserve this slot's geometry before lower-priority slots. */
  priority?: number;
  /** Shared visual rhythm used when evaluating gaps around this capability. */
  spacingProfile?: CompositionSpacingProfile;
  placement?: CompositionSlotPlacement;
  grow?: {
    axis: 'y';
    maxHeight: number;
    pushes?: string[];
  };
}

export interface CompositionPageTemplate {
  id: string;
  /** Stable template reference that supplied this layout. */
  templateRef?: string;
  /** First document page on which this layout is materialised in a schedule. */
  firstPageNumber?: number;
  /** First-page content boundary after leading/static blocks are reserved. */
  firstPageContentTop?: number;
  /** Slots whose first-page boxes start at `firstPageContentTop`. */
  firstPageContentSlotIds?: string[];
  width: number;
  height: number;
  slots: CompositionSlotTemplate[];
}

export interface CompositionFlowRoute {
  slots: string[];
  /**
   * Content slots owned by a named non-main flow. Blocks matching these slots
   * are measured and painted as an insertion layer, then exposed as exclusion
   * obstacles for the ordinary text flow. They are not route segments of
   * `main`; the main stream continues around the resulting box.
   */
  insertionSlots?: string[];
  continuation: 'allowed' | 'forbidden';
  /** Higher values reserve geometry before lower-priority flows. */
  priority?: number;
  repeat?: 'each-page';
  /** First page on which this flow is allowed to place content. */
  startPage?: number;
}

export interface CompositionPageTemplateAssignment {
  from: number;
  to?: number;
  templateRef: string;
  pageTemplateId: string;
}

export interface CompositionLayout {
  pageTemplates: CompositionPageTemplate[];
  routes: Record<string, CompositionFlowRoute>;
  maxPages: number;
  /** Per-page template selection. An open final range extends to maxPages. */
  pageTemplateAssignments?: CompositionPageTemplateAssignment[];
  /**
   * Per-document slots supplied by a request.  These overlays are applied to
   * the selected page layout at materialization time and never mutate the
   * reusable compiled template.
   */
  pageSlotOverlays?: Record<number, CompositionSlotTemplate[]>;
  /** Template-owned heading cluster policy; it overrides renderer defaults. */
  headingKeepWithNextLines?: number;
}

export type CompositionBlockKind = 'heading' | 'paragraph' | 'list-item' | 'image' | 'table' | 'chart' | 'metric' | 'lockup';
export type CompositionBlockRole = 'intro' | 'heading' | 'body' | 'table' | 'chart' | 'metric' | 'header' | 'sidebar' | 'quote' | 'footer' | 'title' | 'subtitle' | 'eyebrow';

export type CompositionInlineMark = 'strong' | 'emphasis' | 'link';

/**
 * Renderer-neutral inline content. Marks preserve authored semantics while
 * font selection remains an adapter concern.
 */
export interface CompositionInlineRun {
  text: string;
  marks: CompositionInlineMark[];
  href?: string;
}

export interface CompositionTable {
  head: string[];
  body: Array<Array<string | number>>;
  caption?: string;
  inlineRuns?: {
    head: CompositionInlineRun[][];
    body: CompositionInlineRun[][][];
  };
}

export interface CompositionChart {
  type: 'bar' | 'line' | 'pie';
  title?: string;
  subtitle?: string;
  prefix?: string;
  suffix?: string;
  data: Array<{ label: string; value: number; color?: string }>;
}

export interface CompositionMetric {
  label: string;
  value: string | number;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  note?: string;
}

export interface CompositionLockup {
  markAssetId?: string;
  label?: string;
}

export interface CompositionImage {
  assetId: string;
  width: 'full' | `${number}%`;
  fit: 'contain';
  /** Optional semantic chart metadata retained when the chart is rasterized. */
  chart?: CompositionChart;
  /** An optional rectangular boundary for following text in the same flow box. */
  wrap?: 'none' | 'left' | 'right';
  caption?: string;
  keepWithCaption: boolean;
}

export interface CompositionBlock {
  id: string;
  kind: CompositionBlockKind;
  role: CompositionBlockRole;
  text?: string;
  content?: NormalizedContentNode[];
  inlineRuns?: CompositionInlineRun[];
  diagnostics?: string[];
  assetIds?: string[];
  level?: 1 | 2;
  table?: CompositionTable;
  chart?: CompositionChart;
  metric?: CompositionMetric;
  lockup?: CompositionLockup;
  image?: CompositionImage;
  atomic?: boolean;
  keepWithNextLines?: number;
  /** Input opt-in: insertion-flow content may be omitted only if the planner selects an explicit omission candidate. */
  allowOmission?: boolean;
}

export interface CompositionFlow {
  id: string;
  blocks: CompositionBlock[];
  continuation: 'allowed' | 'forbidden';
}

export interface CompositionDocument {
  title?: string;
  subtitle?: string;
  period?: string;
  flows: Record<string, CompositionFlow>;
  assets?: CompositionAsset[];
  graphics?: CompositionGraphic[];
  glyphs?: CompositionGlyphDefinition[];
  template?: CompositionLayout;
  diagnostics?: string[];
  titlePage?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    period?: string;
  };
}
