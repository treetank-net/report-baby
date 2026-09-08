import { z } from 'zod';
import type { BrandSourceDescriptor } from '../../source/contracts.js';

export const SLIDE_NOTES_MAX_CHARS = 4000;

export const datumSchema = z.object({
  label: z.string(),
  value: z.number(),
  color: z.string().optional(),
});

export const cardSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  delta: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  note: z.string().optional(),
});

export const reportChartSchema = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  prefix: z.string().optional().describe('Prepended to values, e.g. "$"'),
  suffix: z.string().optional().describe('Appended to values, e.g. "%"'),
  data: z.array(datumSchema).min(1),
});

const brandSourceBase = {
  brand_path: z.string().optional().describe('Path to the selected brand directory within the complete source root'),
};

export const brandSourceSchema = z.union([
  z.object({ directory_path: z.string(), ...brandSourceBase }).strict(),
  z.object({ zip_path: z.string(), ...brandSourceBase }).strict(),
  z.object({ zip_url: z.string(), ...brandSourceBase }).strict(),
  z.object({ git_url: z.string(), ...brandSourceBase, ref: z.string().optional() }).strict(),
]) as z.ZodType<BrandSourceDescriptor>;

const contentWidthSchema = z.union([z.literal('full'), z.string().regex(/^(?:100|[1-9]?[0-9])%$/)]);
const contentNodeSchema: z.ZodTypeAny = z.lazy(() => z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.enum(['strong', 'emphasis', 'link']), content: z.array(contentNodeSchema), href: z.string().optional() }),
  z.object({
    type: z.literal('image'),
    src: z.string(),
    alt: z.string().optional(),
    title: z.string().optional(),
    caption: z.string().optional(),
    width: contentWidthSchema.optional().default('full'),
    fit: z.literal('contain').optional().default('contain'),
    keep_with_caption: z.boolean().optional().default(true),
    wrap: z.enum(['none', 'left', 'right']).optional().default('none'),
  }),
  z.object({ type: z.literal('paragraph'), content: z.array(contentNodeSchema).min(1) }),
  z.object({ type: z.literal('list'), ordered: z.boolean().optional().default(false), items: z.array(z.object({ content: z.array(contentNodeSchema).min(1) })).min(1) }),
]));

export const reportContentNodeSchema = contentNodeSchema;

const compositionRoleSchema = z.enum([
  'intro', 'heading', 'body', 'table', 'chart', 'metric', 'header', 'sidebar',
  'quote', 'footer', 'title', 'subtitle', 'eyebrow',
]);

/**
 * Request-owned insertion geometry.  CompositionInput deliberately remains
 * content-only; this envelope lets a caller add temporary slots for one
 * render without mutating a reusable YAML template.
 */
const placementFrameSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.union([z.number().gt(0).max(1), z.literal('auto')]).optional(),
}).strict();

const placementSizingSchema = z.object({
  mode: z.enum(['fixed', 'fit-content']).optional().default('fit-content'),
  max_height: z.union([z.number().gt(0).max(1), z.literal('page')]).optional().default('page'),
  pushes: z.array(z.string().min(1)).optional(),
}).strict();

const placementSlotSchema = z.object({
  id: z.string().min(1),
  frame: placementFrameSchema,
  kind: z.enum(['text', 'block']).optional().default('text'),
  allowed_roles: z.array(compositionRoleSchema).optional(),
  allowed_block_ids: z.array(z.string().min(1)).optional(),
  allowed_block_kinds: z.array(z.enum(['heading', 'paragraph', 'list-item', 'image', 'table', 'chart', 'metric'])).optional(),
  sizing: placementSizingSchema.optional(),
}).strict();

const placementInsertionFlowSchema = z.object({
  flow_id: z.string().min(1),
  start_page: z.number().int().positive().optional(),
  repeat: z.enum(['once', 'each-page']).optional().default('once'),
  continuation: z.enum(['allowed', 'forbidden']).optional().default('forbidden'),
  slots: z.array(placementSlotSchema).min(1),
}).strict();

const placementInsertionSchema = z.object({
  flow_id: z.string().min(1),
  block_id: z.string().min(1),
  page: z.number().int().positive(),
  frame: placementFrameSchema,
  kind: z.enum(['text', 'block']).optional().default('text'),
  sizing: placementSizingSchema.optional(),
}).strict();

export const placementRequestsSchema = z.object({
  insertion_flows: z.array(placementInsertionFlowSchema).optional(),
  insertions: z.array(placementInsertionSchema).optional(),
}).strict().refine((value) => (value.insertion_flows?.length ?? 0) > 0 || (value.insertions?.length ?? 0) > 0, {
  message: 'At least one insertion flow or insertion request is required.',
});

export type PlacementRequests = z.infer<typeof placementRequestsSchema>;

const compositionGlyphSchema = z.object({
  id: z.string(),
  target: z.object({ kind: z.enum(['block', 'graphic']), id: z.string() }).strict(),
  text: z.string().min(1),
  style: z.string(),
  anchor: z.enum(['box', 'text-start', 'text-end']),
  anchor_alignment: z.enum(['start', 'end']).optional(),
  target_mode: z.enum(['first-line', 'last-line', 'box']).default('box'),
  anchor_measure_style: z.string().min(1).optional(),
  offset_x: z.number().optional(),
  offset_y: z.number().optional(),
  clamp_to_target: z.boolean().optional().default(false),
  opacity: z.number().min(0).max(1).optional(),
}).strict();

const compositionGraphicSchema = z.object({
  id: z.string(),
  asset_id: z.string().optional(),
  slot_id: z.string(),
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).strict().optional(),
  shape: z.enum(['rectangle', 'ellipse', 'triangle', 'star', 'polygon']),
  wrap: z.enum(['none', 'around']).optional(),
  page: z.number().int().positive().optional(),
  points: z.array(z.object({ x: z.number(), y: z.number() }).strict()).min(3).optional(),
  vertex_count: z.number().int().min(3).optional(),
  inner_ratio: z.number().gt(0).lt(1).optional(),
  alt: z.string().optional(),
}).strict();

const compositionBlockBase = {
  id: z.string().optional(),
  role: compositionRoleSchema.optional(),
  atomic: z.boolean().optional(),
  keep_with_next_lines: z.number().int().nonnegative().optional(),
};

export const compositionInputBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    ...compositionBlockBase,
    text: z.string().optional(),
    content: z.array(reportContentNodeSchema).optional(),
  }).strict(),
  z.object({
    type: z.literal('heading'),
    ...compositionBlockBase,
    text: z.string(),
    level: z.union([z.literal(1), z.literal(2)]).optional(),
  }).strict(),
  z.object({
    type: z.literal('list-item'),
    ...compositionBlockBase,
    text: z.string(),
  }).strict(),
  z.object({
    type: z.literal('image'),
    ...compositionBlockBase,
    src: z.string().optional(),
    asset_id: z.string().optional(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    width: contentWidthSchema.optional().default('full'),
    fit: z.literal('contain').optional().default('contain'),
    keep_with_caption: z.boolean().optional().default(true),
    wrap: z.enum(['none', 'left', 'right']).optional().default('none'),
  }).strict(),
  z.object({
    type: z.literal('table'),
    ...compositionBlockBase,
    head: z.array(z.string()).min(1),
    body: z.array(z.array(z.union([z.string(), z.number()]))),
    caption: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('chart'),
    ...compositionBlockBase,
    chart_type: z.enum(['bar', 'line', 'pie']),
    title: z.string().optional(),
    subtitle: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    data: z.array(datumSchema).min(1),
  }).strict(),
  z.object({
    type: z.literal('metric'),
    ...compositionBlockBase,
    label: z.string(),
    value: z.union([z.string(), z.number()]),
    delta: z.string().optional(),
    trend: z.enum(['up', 'down', 'flat']).optional(),
    note: z.string().optional(),
  }).strict(),
]);

const compositionInputCoreSchema = z.object({
  flows: z.record(z.object({
    blocks: z.array(compositionInputBlockSchema),
    continuation: z.enum(['allowed', 'forbidden']).optional().default('allowed'),
  }).strict()).refine((flows) => Object.keys(flows).length > 0, 'At least one flow is required.'),
  assets: z.array(z.object({
    id: z.string(),
    source: z.string(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    width: contentWidthSchema.optional().default('full'),
    fit: z.literal('contain').optional().default('contain'),
    keep_with_caption: z.boolean().optional().default(true),
  }).strict()).optional(),
  glyphs: z.array(compositionGlyphSchema).optional(),
  graphics: z.array(compositionGraphicSchema).optional(),
}).strict().superRefine((input, context) => {
  for (const [flowId, flow] of Object.entries(input.flows)) {
    flow.blocks.forEach((block, index) => {
      if (block.type === 'text' && block.text === undefined && block.content === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['flows', flowId, 'blocks', index], message: 'A text block must provide text or content.' });
      }
      if (block.type !== 'image') return;
      if ((block.src === undefined) === (block.asset_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['flows', flowId, 'blocks', index], message: 'An image must provide exactly one of src or asset_id.' });
      }
    });
  }
});

function semanticFlowAlias(value: unknown): unknown {
  return Array.isArray(value) ? { blocks: value } : value;
}

function semanticContentAlias(value: unknown, role: 'header' | 'footer'): unknown {
  if (typeof value === 'string') return { blocks: [{ type: 'text', role, text: value }] };
  return semanticFlowAlias(value);
}

/**
 * The canonical input is `flows`. These small shorthands are intentionally
 * semantic aliases, not support for the removed report object: they only
 * name a flow and still accept the same block vocabulary.
 */
export const compositionInputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const flows = source.flows && typeof source.flows === 'object' && !Array.isArray(source.flows)
    ? { ...(source.flows as Record<string, unknown>) }
    : {};
  const aliases: Array<[string, string]> = [['main', 'main'], ['header', 'header'], ['footer', 'footer'], ['title', 'title']];
  for (const [key, flowId] of aliases) if (source[key] !== undefined && flows[flowId] === undefined) flows[flowId] = key === 'header' || key === 'footer' ? semanticContentAlias(source[key], key) : semanticFlowAlias(source[key]);
  if (source.headerContent !== undefined && flows.header === undefined) flows.header = semanticContentAlias(source.headerContent, 'header');
  if (source.footerContent !== undefined && flows.footer === undefined) flows.footer = semanticContentAlias(source.footerContent, 'footer');
  if (source.header_content !== undefined && flows.header === undefined) flows.header = semanticContentAlias(source.header_content, 'header');
  if (source.footer_content !== undefined && flows.footer === undefined) flows.footer = semanticContentAlias(source.footer_content, 'footer');
  const { main: _main, header: _header, footer: _footer, title: _title, headerContent: _headerContent, footerContent: _footerContent, header_content: _header_content, footer_content: _footer_content, ...canonical } = source;
  return { ...canonical, flows };
}, compositionInputCoreSchema).superRefine((input, context) => {
  for (const [flowId, flow] of Object.entries(input.flows)) {
    flow.blocks.forEach((block, index) => {
      if (flowId === 'main' && block.role === 'quote') {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['flows', flowId, 'blocks', index], message: 'The main flow cannot contain quote blocks; put quotes in a separate flow.' });
      }
      if (block.type !== 'image') return;
      if ((block.src === undefined) === (block.asset_id === undefined)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['flows', flowId, 'blocks', index], message: 'An image must provide exactly one of src or asset_id.' });
      }
    });
  }
});

const slideCommonSchema = {
  title: z.string(),
  subtitle: z.string().optional(),
  notes: z
    .string()
    .max(SLIDE_NOTES_MAX_CHARS)
    .optional()
    .describe('Speaker notes / narration for this slide: never drawn on the slide. render_slides_pptx writes them to the PowerPoint notes slide shown in presenter view; render_slides_pdf and render_slides_png drop them and report it as a warning.'),
  brand_ref: z.string().optional(),
  template_ref: z.string().optional(),
  surface: z.string().optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  overrides: z.object({
    fit: z.object({ strategy: z.enum(['none', 'shrink-to-fit']).optional(), min_body_pt: z.number().optional(), min_heading_pt: z.number().optional() }).optional(),
    layout: z.object({ density: z.enum(['comfortable', 'compact']).optional(), lockup_position: z.enum(['top-start', 'top-end']).optional(), lockup_spacing: z.enum(['compact', 'normal', 'open']).optional() }).optional(),
    typography: z.object({
      body: z.object({ scale: z.number().optional(), family: z.string().optional(), role: z.string().optional() }).optional(),
      heading: z.object({ scale: z.number().optional(), family: z.string().optional(), role: z.string().optional() }).optional(),
      heading_role: z.string().optional(),
    }).optional(),
    emphasis: z.object({ role: z.string().optional() }).optional(),
  }).optional(),
};

const slideRenderSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), ...slideCommonSchema, eyebrow: z.string().optional() }),
  z.object({ type: z.literal('metrics'), ...slideCommonSchema, metrics: z.array(cardSchema).min(1).max(6), body: z.string().optional(), callout: z.string().optional() }),
  z.object({
    type: z.literal('chart'),
    ...slideCommonSchema,
    chart: z.object({ type: z.enum(['bar', 'line', 'pie']), data: z.array(datumSchema).min(1), prefix: z.string().optional(), suffix: z.string().optional() }),
  }),
  z.object({ type: z.literal('table'), ...slideCommonSchema, head: z.array(z.string()).min(1), body: z.array(z.array(z.union([z.string(), z.number()]))) }),
  z.object({ type: z.literal('narrative'), ...slideCommonSchema, body: z.string(), highlights: z.array(z.string()).max(4).optional() }),
  z.object({ type: z.literal('conclusions'), ...slideCommonSchema, items: z.array(z.string()).min(1).max(7) }),
  z.object({
    type: z.literal('columns'),
    ...slideCommonSchema,
    columns: z
      .array(z.object({ heading: z.string().optional(), body: z.string(), highlights: z.array(z.string()).max(3).optional() }))
      .length(2)
      .describe('Exactly two side-by-side columns; pair it with template_ref "slides/two-column" for the matching layout'),
  }),
]);

const slideFlowSchema = z.object({
  blocks: z.array(compositionInputBlockSchema),
  continuation: z.enum(['allowed', 'forbidden']).optional().default('forbidden'),
}).strict();

/**
 * A slide is a discrete composition surface. Its content is always expressed
 * through named flows; the renderer's former archetype object is an internal
 * representation and is not part of the public input contract.
 */
export const slideSchema = z.object({
  layout: z.enum(['title', 'metrics', 'chart', 'table', 'narrative', 'conclusions', 'columns']),
  notes: z.string().max(SLIDE_NOTES_MAX_CHARS).optional(),
  brand_ref: z.string().optional(),
  template_ref: z.string().optional(),
  surface: z.string().optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  overrides: slideCommonSchema.overrides,
  flows: z.record(slideFlowSchema).refine((flows) => Object.keys(flows).length > 0, 'A slide must provide at least one named flow.'),
}).strict();

export const brandOverrideSchema = z.object({
  fit: z.object({ strategy: z.enum(['none', 'shrink-to-fit']).optional(), min_body_pt: z.number().optional(), min_heading_pt: z.number().optional() }).optional(),
  layout: z.object({ density: z.enum(['comfortable', 'compact']).optional(), lockup_position: z.enum(['top-start', 'top-end']).optional(), lockup_spacing: z.enum(['compact', 'normal', 'open']).optional() }).optional(),
  typography: z.object({
    body: z.object({ scale: z.number().optional(), family: z.string().optional(), role: z.string().optional() }).optional(),
    heading: z.object({ scale: z.number().optional(), family: z.string().optional(), role: z.string().optional() }).optional(),
    heading_role: z.string().optional(),
  }).optional(),
  emphasis: z.object({ role: z.string().optional() }).optional(),
});

export const slideDeckSchema = z.object({
  title: z.string().optional(),
  brand: z.string().optional(),
  brand_ref: z.string().optional(),
  template_ref: z.string().optional(),
  surface: z.string().optional(),
  direction: z.enum(['ltr', 'rtl']).optional(),
  overrides: brandOverrideSchema.optional(),
  footer: z.string().optional(),
  slides: z.array(slideSchema).min(1),
});

export const brandRenderFields = {
  brand_ref: z.string().optional().describe('Path-based brand/profile reference, e.g. brand://acme/primary'),
  brand_source: brandSourceSchema.optional().describe('Request-level brand source. It overrides the process-level source without mutating it.'),
  template_ref: z.string().optional().describe('Composition/template reference, e.g. slides/qbr/executive-summary'),
  surface: z.string().optional().describe('Output surface, e.g. pdf-a4 or pptx-16x9'),
  direction: z.enum(['ltr', 'rtl']).optional().describe('Logical text/layout direction for slides'),
  overrides: brandOverrideSchema.optional().describe('One-render-only, validated brand/template overrides'),
};

export const reportContentFields = {
  content_root: z.string().optional().describe('Explicit root for bare relative content and image paths.'),
};

export const slideDiagnosticsField = {
  diagnostics: z
    .enum(['summary', 'full'])
    .optional()
    .default('summary')
    .describe('Response detail. "summary" (default) returns the written path plus the resolved brand profile, template_ref, slide count and deduplicated warnings. "full" adds the per-slide pixel layout plans (slidePlans, slotRules, slot boxes) — thousands of tokens per deck, so ask for it only when debugging a layout.'),
};

export const reportDiagnosticsField = {
  dry_run: z.boolean().optional().default(false).describe('Resolve and validate the report layout plan without rasterizing or writing a PDF.'),
  composition_debug: z.boolean().optional().default(false).describe('Draw the resolved composition placements, obstacles and line boxes over the normal PDF rendering.'),
  diagnostics: z
    .enum(['summary', 'full'])
    .optional()
    .default('summary')
    .describe('Response detail. "summary" (default) returns the written path, resolved brand profile, page count and warnings. "full" adds the resolved report layout plan for every page.'),
};

export type CompositionInput = z.infer<typeof compositionInputSchema>;
export type Slide = z.infer<typeof slideRenderSchema>;
export type SlideInput = z.infer<typeof slideSchema>;
export type SlideDeckInput = z.infer<typeof slideDeckSchema>;
