import { z } from 'zod';
import type { BrandSourceDescriptor } from '../source-contract.js';

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
  }),
  z.object({ type: z.literal('paragraph'), content: z.array(contentNodeSchema).min(1) }),
  z.object({ type: z.literal('list'), ordered: z.boolean().optional().default(false), items: z.array(z.object({ content: z.array(contentNodeSchema).min(1) })).min(1) }),
]));

export const reportContentNodeSchema = contentNodeSchema;

const reportSectionSchema = z.object({
  heading: z.string(),
  body: z.string().optional(),
  content: z.array(reportContentNodeSchema).optional(),
  level: z.union([z.literal(1), z.literal(2)]).optional(),
}).superRefine((section, context) => {
  if ((section.body === undefined) === (section.content === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A section must provide exactly one of body or content.' });
  }
});

export const reportDataSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  brand: z.string().optional().describe('Client/company name shown in the top-left corner'),
  period: z.string().optional().describe('Reporting period shown in the top-right corner; keep short'),
  intro: z.string().optional().describe('Lead paragraph under the title'),
  kpis: z.array(cardSchema).optional().describe('KPI cards; keep labels under ~28 chars to avoid clipping'),
  charts: z.array(reportChartSchema).optional(),
  sections: z
    .array(reportSectionSchema)
    .optional()
    .describe('Narrative sections; heading stays on the same page as the body. level 2 renders a subheading under the preceding level 1 chapter. Body text accepts **bold** inline markup'),
  table: z
    .object({
      head: z.array(z.string()).min(1),
      body: z.array(z.array(z.union([z.string(), z.number()]))),
      caption: z.string().optional(),
    })
    .optional(),
  highlights: z.array(z.string()).optional().describe('Bullet list rendered under a "Highlights" heading'),
  highlights_title: z.string().optional().describe('Heading above the bullet list; defaults to "Highlights"'),
  footer: z.string().optional().describe('Shown on every page; keep under ~120 chars'),
  title_page: z
    .object({
      eyebrow: z.string().optional().describe('Small uppercase kicker above the cover title'),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      period: z.string().optional().describe('Reporting period shown in the cover top-right corner'),
    })
    .optional()
    .describe('Full-bleed cover page rendered as page 1 instead of the compact header; the body starts on page 2'),
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

export const slideSchema = z.discriminatedUnion('type', [
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
  diagnostics: z
    .enum(['summary', 'full'])
    .optional()
    .default('summary')
    .describe('Response detail. "summary" (default) returns the written path, resolved brand profile, page count and warnings. "full" adds the resolved report layout plan for every page.'),
};

export type ReportInput = z.infer<typeof reportDataSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type SlideInput = z.infer<typeof slideSchema>;
export type SlideDeckInput = z.infer<typeof slideDeckSchema>;
