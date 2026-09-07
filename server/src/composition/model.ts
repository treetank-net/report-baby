import type { NormalizedContentNode } from '../content-model.js';

export interface CompositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CompositionSlotKind = 'text' | 'graphic' | 'block';
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
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fitContent?: boolean;
  allowedRoles?: CompositionBlockRole[];
  allowedBlockIds?: string[];
  allowedBlockKinds?: CompositionBlockKind[];
  grow?: {
    axis: 'y';
    maxHeight: number;
    pushes?: string[];
  };
}

export interface CompositionLayoutTemplate {
  id: string;
  width: number;
  height: number;
  slots: CompositionSlotTemplate[];
}

export interface CompositionFlowRoute {
  slots: string[];
  /**
   * Fixed-position insertions owned by a named non-main flow and painted as
   * exclusion obstacles for the ordinary text flow. They are not route
   * segments of `main`; the main stream continues around the resulting box,
   * just like it does around an image.
   */
  insertionSlots?: string[];
  continuation: 'allowed' | 'forbidden';
  repeat?: 'each-page';
  /** First page on which this flow is allowed to place content. */
  startPage?: number;
  layouts?: string[];
  slotsByLayout?: Record<string, string[]>;
}

export interface CompositionTemplate {
  layouts: CompositionLayoutTemplate[];
  routes: Record<string, CompositionFlowRoute>;
  maxPages: number;
  /** Template-owned heading cluster policy; it overrides renderer defaults. */
  headingKeepWithNextLines?: number;
}

export type CompositionBlockKind = 'heading' | 'paragraph' | 'list-item' | 'image' | 'table' | 'chart' | 'metric';
export type CompositionBlockRole = 'intro' | 'heading' | 'body' | 'table' | 'chart' | 'metric' | 'header' | 'sidebar' | 'quote' | 'footer' | 'title' | 'subtitle' | 'eyebrow';

export interface CompositionTable {
  head: string[];
  body: Array<Array<string | number>>;
  caption?: string;
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
  diagnostics?: string[];
  assetIds?: string[];
  level?: 1 | 2;
  table?: CompositionTable;
  chart?: CompositionChart;
  metric?: CompositionMetric;
  image?: CompositionImage;
  atomic?: boolean;
  keepWithNextLines?: number;
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
  template?: CompositionTemplate;
  diagnostics?: string[];
  titlePage?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    period?: string;
  };
}
