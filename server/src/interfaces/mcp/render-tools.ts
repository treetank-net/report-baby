import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { listBrandTemplates, resolveBrandContext, type BrandOverrides } from '../../brand/context.js';
import type { ReportConfig } from '../../infrastructure/config.js';
import type { RenderTheme } from '../../contracts/render-theme.js';
import { listTemplates, renderReportPdfDetailed, resolveReportCompositionOnly, resolveReportPlanOnly } from '../../report/renderer.js';
import { renderChart, metricCards, type ChartType } from '../../rendering/svg.js';
import { loadRenderFontSet, renderSvgToPng } from '../../rendering/primitives.js';
import { renderSlidesPdf, renderSlidesPng, renderSlidesPptx } from '../../presentation/slides.js';
import { resolveSlideDeck } from '../../presentation/planning/slide-context.js';
import { listBuiltinSlideTemplates, readBuiltinTemplateSource } from '../../template/builtins.js';
import { brandRenderSummary, compositionQualityText, reportRenderDiagnostics, slideNotesCarriage, slideRenderDiagnostics } from './responses.js';

import {
  brandRenderFields,
  brandSourceSchema,
  cardSchema,
  datumSchema,
  compositionInputSchema,
  documentLayoutSchema,
  placementRequestsSchema,
  reportContentFields,
  reportDiagnosticsField,
  slideDeckSchema,
  slideDiagnosticsField,
} from '../../contracts/input/schema.js';

const SLIDE_RENDER_TOOLS = ['render_slides_pdf', 'render_slides_png', 'render_slides_pptx'];
const REPORT_RENDER_TOOLS = ['render_report'];

function reportTemplateNames(): string[] {
  return listTemplates().map((template) => template.name);
}

function builtinSlideArchetype(templateRef: string): string | undefined {
  const source = readBuiltinTemplateSource(templateRef)?.source as { archetype?: unknown } | undefined;
  return typeof source?.archetype === 'string' ? source.archetype : undefined;
}

function brandTemplateKind(templateRef: string): 'slide' | 'page' {
  return templateRef.startsWith('slides/') ? 'slide' : 'page';
}

function brandTemplateEntry(brandRef: string, template: { templateRef: string; path: string }) {
  const kind = brandTemplateKind(template.templateRef);
  return {
    template_ref: template.templateRef,
    kind,
    owner: 'brand' as const,
    brand_ref: brandRef,
    use_with: kind === 'slide' ? SLIDE_RENDER_TOOLS : ['inspect_brand_template'],
    note: kind === 'slide' ? undefined : 'Page compositions are inspect-only today: render_report selects its layout with the built-in report template names.',
    path: template.path,
  };
}

function unknownReportTemplateMessage(requested: string): string {
  return [
    `Unknown report template '${requested}'.`,
    `render_report renders built-in A4 report templates only: ${reportTemplateNames().join(', ')}.`,
    `Pass one of those names as "template" (or as "template_ref"), and use brand_ref for brand styling.`,
    `Slide composition references such as slides/two-column belong to ${SLIDE_RENDER_TOOLS.join(', ')}. Call list_templates to see every built-in template.`,
  ].join(' ');
}

function outputPath(cfg: ReportConfig, explicit: string | undefined, ext: string): string {
  if (explicit && explicit.length > 0) return explicit;
  return join(cfg.outputDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${ext}`);
}

async function writePng(cfg: ReportConfig, svg: string, width: number | undefined, explicit: string | undefined, returnImage: boolean, theme?: RenderTheme, summary?: Record<string, unknown>) {
  await mkdir(cfg.outputDir, { recursive: true });
  const out = outputPath(cfg, explicit, 'png');
  const png = await renderSvgToPng(svg, width, theme ? await loadRenderFontSet(theme) : undefined);
  await writeFile(out, png);
  const content: any[] = [{ type: 'text' as const, text: out }];
  if (returnImage) content.push({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' });
  return { content, structuredContent: { path: out, ...summary } };
}

async function writeArtifact(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

export function registerRenderTools(server: McpServer, cfg: ReportConfig) {
  server.tool(
    'render_chart',
    'Render a bar, line, or pie chart to a standalone PNG from data values. Returns the path to the written PNG. This is the primary tool for charts to paste into a report or document.',
    {
      type: z.enum(['bar', 'line', 'pie']),
      data: z.array(datumSchema).min(1),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      prefix: z.string().optional(),
      suffix: z.string().optional(),
      width: z.number().optional(),
      output_path: z.string().optional(),
      return_image: z.boolean().optional().default(false),
      ...brandRenderFields,
    },
    async ({ type, data, title, subtitle, prefix, suffix, width, output_path, return_image, brand_ref, brand_source, template_ref, surface, overrides }) => {
      const context = await resolveBrandContext(cfg.brandDir, { brandRef: brand_ref, brandSource: brand_source, templateRef: template_ref, surface, overrides: overrides as BrandOverrides | undefined, brandSourceRoots: cfg.brandSourceRoots });
      const svg = renderChart(type as ChartType, { data: data.map((datum, index) => ({ ...datum, color: datum.color ?? context.theme.palette[index % context.theme.palette.length] })), title, subtitle, prefix, suffix, theme: context.theme });
      return writePng(cfg, svg, width, output_path, return_image, context.theme, brandRenderSummary(context.diagnostics));
    },
  );

  server.tool(
    'render_slides_pdf',
    'Render a complete presentation as a local 16:9 PDF from a bounded shared slide model. Existing render_report A4 behavior is unchanged. Returns the PDF path plus a compact render summary; pass diagnostics: "full" only to debug slide layout.',
    { data: slideDeckSchema, output_path: z.string().optional(), ...brandRenderFields, ...slideDiagnosticsField },
    async ({ data, output_path, brand_ref, brand_source, template_ref, surface, direction, overrides, diagnostics }) => {
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction }, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
      const out = outputPath(cfg, output_path, 'pdf');
      await writeArtifact(out, await renderSlidesPdf(resolved.deck, resolved.context.theme));
      return { content: [{ type: 'text' as const, text: out }], structuredContent: { path: out, ...slideRenderDiagnostics({ diagnostics: resolved.context.diagnostics, slideDiagnostics: resolved.slideDiagnostics, slidePlans: resolved.deck.slidePlans ?? [], notes: slideNotesCarriage(resolved.deck, false) }, diagnostics) } };
    },
  );

  server.tool(
    'render_slides_png',
    'Rasterize the canonical 16:9 slide PDF to deterministic configured-canvas PNG files for visual inspection. Optionally return one zero-based slide_index. The PNGs are derived from the same PDF produced by render_slides_pdf; pass diagnostics: "full" only to debug slide layout.',
    { data: slideDeckSchema, slide_index: z.number().int().nonnegative().optional(), output_dir: z.string().optional(), filename_prefix: z.string().optional().default('slide'), ...brandRenderFields, ...slideDiagnosticsField },
    async ({ data, slide_index, output_dir, filename_prefix, brand_ref, brand_source, template_ref, surface, direction, overrides, diagnostics }) => {
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction }, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
      const directory = output_dir ?? cfg.outputDir;
      await mkdir(directory, { recursive: true });
      const buffers = await renderSlidesPng(resolved.deck, slide_index, resolved.context.theme);
      const indexes = slide_index === undefined ? resolved.deck.slides.map((_, index) => index) : [slide_index];
      const paths: string[] = [];
      for (let index = 0; index < buffers.length; index++) {
        const path = join(directory, `${filename_prefix}-${String(indexes[index] + 1).padStart(2, '0')}.png`);
        await writeFile(path, buffers[index]);
        paths.push(path);
      }
      return { content: [{ type: 'text' as const, text: paths.join('\n') }], structuredContent: { paths, ...(slide_index === undefined ? {} : { selectedSlideIndex: slide_index, renderedSlideCount: paths.length }), ...slideRenderDiagnostics({ diagnostics: resolved.context.diagnostics, slideDiagnostics: resolved.slideDiagnostics, slidePlans: resolved.deck.slidePlans ?? [], notes: slideNotesCarriage(resolved.deck, false) }, diagnostics) } };
    },
  );

  server.tool(
    'render_slides_pptx',
    'Render the shared slide model to an editable 16:9 PPTX. Text, KPI cards, tables, and basic shapes stay editable; charts are embedded as deterministic images. Returns the PPTX path plus a compact render summary; pass diagnostics: "full" only to debug slide layout.',
    { data: slideDeckSchema, output_path: z.string().optional(), ...brandRenderFields, ...slideDiagnosticsField },
    async ({ data, output_path, brand_ref, brand_source, template_ref, surface, direction, overrides, diagnostics }) => {
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction }, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
      const out = outputPath(cfg, output_path, 'pptx');
      await writeArtifact(out, await renderSlidesPptx(resolved.deck, resolved.context.theme));
      return { content: [{ type: 'text' as const, text: out }], structuredContent: { path: out, ...slideRenderDiagnostics({ diagnostics: resolved.context.diagnostics, slideDiagnostics: resolved.slideDiagnostics, slidePlans: resolved.deck.slidePlans ?? [], notes: slideNotesCarriage(resolved.deck, true) }, diagnostics) } };
    },
  );

  server.tool(
    'render_metric_cards',
    'Render a grid of KPI / metric cards (label, big value, optional delta with up/down trend color) to a standalone PNG. Returns the path to the written PNG.',
    {
      cards: z.array(cardSchema).min(1),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      columns: z.number().optional(),
      width: z.number().optional(),
      output_path: z.string().optional(),
      return_image: z.boolean().optional().default(false),
      ...brandRenderFields,
    },
    async ({ cards, title, subtitle, columns, width, output_path, return_image, brand_ref, brand_source, template_ref, surface, overrides }) => {
      const context = await resolveBrandContext(cfg.brandDir, { brandRef: brand_ref, brandSource: brand_source, templateRef: template_ref, surface, overrides: overrides as BrandOverrides | undefined, brandSourceRoots: cfg.brandSourceRoots });
      const svg = metricCards({ cards, title, subtitle, columns, width, theme: context.theme });
      return writePng(cfg, svg, width, output_path, return_image, context.theme, brandRenderSummary(context.diagnostics));
    },
  );

  server.tool(
    'render_svg',
    'Rasterize an arbitrary SVG string to a PNG (escape hatch for fully custom graphics). Text needs font-family="DejaVu Sans" to render. Returns the path to the written PNG.',
    {
      svg: z.string(),
      width: z.number().optional(),
      output_path: z.string().optional(),
      return_image: z.boolean().optional().default(false),
    },
    async ({ svg, width, output_path, return_image }) => {
      return writePng(cfg, svg, width, output_path, return_image);
    },
  );

  server.tool(
    'render_report',
    'Render semantic flow content through the selected built-in A4 composition template. The template owns slots, page layouts and repeated regions; data supplies named flows containing ordered text, image, table, chart and metric blocks. Returns the path to the written PDF plus composition quality status, passed metrics, penalties, diagnostics, measured evidence and remediation suggestions. Use diagnostics: "full" to include the complete renderer-neutral plan.',
    {
      template: z.string().optional().default('default-report').describe('Built-in A4 report template name, from list_templates: default-report, campaign-summary or a pages/* template'),
      data: compositionInputSchema,
      output_path: z.string().optional(),
      ...reportContentFields,
      ...brandRenderFields,
      ...reportDiagnosticsField,
      template_ref: z.string().optional().describe('Alternative way to name the built-in A4 report template; must be one of the list_templates report names. Slide composition references such as slides/two-column are rejected here — they belong to the render_slides_* tools'),
      placement_requests: placementRequestsSchema.optional().describe('Optional per-render insertion slots. These request-owned slots are layered onto the selected page template and do not mutate it.'),
      layout: documentLayoutSchema.optional().describe('Optional document layout assigning reusable page templates to contiguous page spans.'),
      page_template_schedule: z.unknown().optional().describe('Removed. Use the top-level layout array with pages and template.'),
    },
    async ({ template, data, output_path, content_root, brand_ref, brand_source, template_ref, surface, overrides, dry_run, composition_debug, diagnostics, placement_requests, layout, page_template_schedule }) => {
      if (page_template_schedule !== undefined) {
        return { content: [{ type: 'text' as const, text: 'The page_template_schedule field was removed. Use layout: [{ pages: { count | from/to }, template: "..." }].' }], isError: true };
      }
      const requestedTemplate = template_ref ?? template;
      if (!reportTemplateNames().includes(requestedTemplate)) {
        return { content: [{ type: 'text' as const, text: unknownReportTemplateMessage(requestedTemplate) }], isError: true };
      }
      const context = await resolveBrandContext(cfg.brandDir, { brandRef: brand_ref, brandSource: brand_source, contentRoot: content_root, templateRef: template_ref ?? template, surface: surface ?? 'pdf-a4', overrides: overrides as BrandOverrides | undefined, brandSourceRoots: cfg.brandSourceRoots });
      if (dry_run) {
        const composition = await resolveReportCompositionOnly(requestedTemplate, data, context.theme, context.sourceContext, placement_requests, layout);
        const plan = resolveReportPlanOnly(requestedTemplate, data, context.theme, layout);
        return {
          content: [
            { type: 'text' as const, text: 'Report composition plan resolved without rendering.' },
            { type: 'text' as const, text: compositionQualityText(composition.evaluation, composition.plan) },
          ],
          structuredContent: { ...brandRenderSummary(context.diagnostics), ...reportRenderDiagnostics({ diagnostics: context.diagnostics, plan, drawings: [], composition }, 'full'), dryRun: true },
        };
      }
      await mkdir(cfg.outputDir, { recursive: true });
      const out = outputPath(cfg, output_path, 'pdf');
      const renderWarnings: string[] = [];
      const rendered = await renderReportPdfDetailed(requestedTemplate, data, context.theme, renderWarnings, context.sourceContext, composition_debug, placement_requests, layout);
      await writeFile(out, rendered.buffer);
      const qualityText = rendered.diagnostics.composition ? compositionQualityText(rendered.diagnostics.composition.evaluation, rendered.diagnostics.composition.plan) : undefined;
      return {
        content: [
          { type: 'text' as const, text: out },
          ...(qualityText ? [{ type: 'text' as const, text: qualityText }] : []),
        ],
        structuredContent: { path: out, ...brandRenderSummary(context.diagnostics, renderWarnings), ...reportRenderDiagnostics({ diagnostics: context.diagnostics, plan: rendered.diagnostics.plan, drawings: rendered.diagnostics.drawings, ...(rendered.diagnostics.composition ? { composition: rendered.diagnostics.composition } : {}) }, diagnostics) },
      };
    },
  );

  server.tool(
    'list_templates',
    'List every template a render call can reference: built-in A4 report templates for the render_report* tools, built-in slide templates for the render_slides_* tools, and — when brand_ref is given — the brand-owned templates of that brandbook. Each entry says which tools accept it and whether it is builtin or brand-owned.',
    { brand_ref: z.string().optional().describe('Optional brand reference, e.g. brand://acme/profiles/primary, to also list that brandbook\'s templates'), brand_source: brandSourceSchema.optional().describe('Optional source to inspect instead of the process-level brand directory') },
    async ({ brand_ref, brand_source }) => {
      const reportTemplates = listTemplates().map((template) => ({
        template_ref: template.name,
        kind: 'report' as const,
        owner: 'builtin' as const,
        use_with: REPORT_RENDER_TOOLS,
        description: template.description,
      }));
      const builtinSlideTemplates = listBuiltinSlideTemplates().map((template) => ({
        template_ref: template.templateRef,
        kind: 'slide' as const,
        owner: 'builtin' as const,
        use_with: SLIDE_RENDER_TOOLS,
        archetype: builtinSlideArchetype(template.templateRef),
        path: template.path,
      }));
      const brandTemplates = brand_ref ? (await listBrandTemplates(cfg.brandDir, brand_ref, brand_source)).map((template) => brandTemplateEntry(brand_ref, template)) : [];
      const templates = [...reportTemplates, ...builtinSlideTemplates, ...brandTemplates];
      const payload = { brand_dir: cfg.brandDir, brand_ref, brand_source, templates };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
