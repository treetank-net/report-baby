import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { listBrandTemplates, resolveBrandContext, type BrandOverrides } from '../brand-context.js';
import type { ReportConfig } from '../config.js';
import type { RenderTheme } from '../core/model/render-theme.js';
import { listTemplates, renderReportPdfDetailed, resolveReportPlanOnly, type ReportData } from '../report-renderer.js';
import { renderChart, metricCards, type ChartType } from '../svg.js';
import { loadRenderFontSet, renderSvgToPng } from '../render-primitives.js';
import { renderSlidesPdf, renderSlidesPng, renderSlidesPptx, type SlideDeck } from '../slides.js';
import { resolveSlideDeck } from '../slide-context.js';
import { listBuiltinSlideTemplates, readBuiltinTemplateSource } from '../builtin-template-source.js';
import { brandRenderSummary, reportRenderDiagnostics, slideNotesCarriage, slideRenderDiagnostics } from '../tool-response.js';

import {
  brandRenderFields,
  cardSchema,
  datumSchema,
  reportDataSchema,
  reportContentFields,
  reportDiagnosticsField,
  slideDeckSchema,
  slideDiagnosticsField,
} from '../contract/schema.js';

const SLIDE_RENDER_TOOLS = ['render_slides_pdf', 'render_slides_png', 'render_slides_pptx'];

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
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction } as SlideDeck, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
      const out = outputPath(cfg, output_path, 'pdf');
      await writeArtifact(out, await renderSlidesPdf(resolved.deck, resolved.context.theme));
      return { content: [{ type: 'text' as const, text: out }], structuredContent: { path: out, ...slideRenderDiagnostics({ diagnostics: resolved.context.diagnostics, slideDiagnostics: resolved.slideDiagnostics, slidePlans: resolved.deck.slidePlans ?? [], notes: slideNotesCarriage(resolved.deck, false) }, diagnostics) } };
    },
  );

  server.tool(
    'render_slides_png',
    'Render the shared slide model to deterministic 1600x900 PNG files. Optionally render one zero-based slide_index without regenerating unrelated slides. Returns the written paths plus a compact render summary; pass diagnostics: "full" only to debug slide layout.',
    { data: slideDeckSchema, slide_index: z.number().int().nonnegative().optional(), output_dir: z.string().optional(), filename_prefix: z.string().optional().default('slide'), ...brandRenderFields, ...slideDiagnosticsField },
    async ({ data, slide_index, output_dir, filename_prefix, brand_ref, brand_source, template_ref, surface, direction, overrides, diagnostics }) => {
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction } as SlideDeck, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
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
      return { content: [{ type: 'text' as const, text: paths.join('\n') }], structuredContent: { paths, ...slideRenderDiagnostics({ diagnostics: resolved.context.diagnostics, slideDiagnostics: resolved.slideDiagnostics, slidePlans: resolved.deck.slidePlans ?? [], notes: slideNotesCarriage(resolved.deck, false) }, diagnostics) } };
    },
  );

  server.tool(
    'render_slides_pptx',
    'Render the shared slide model to an editable 16:9 PPTX. Text, KPI cards, tables, and basic shapes stay editable; charts are embedded as deterministic images. Returns the PPTX path plus a compact render summary; pass diagnostics: "full" only to debug slide layout.',
    { data: slideDeckSchema, output_path: z.string().optional(), ...brandRenderFields, ...slideDiagnosticsField },
    async ({ data, output_path, brand_ref, brand_source, template_ref, surface, direction, overrides, diagnostics }) => {
      const resolved = await resolveSlideDeck({ ...data, direction: direction ?? data.direction } as SlideDeck, { brandRoot: cfg.brandDir, brandSourceRoots: cfg.brandSourceRoots, brandSource: brand_source, brandRef: brand_ref, templateRef: template_ref, surface: surface ?? 'pptx-16x9', overrides: overrides as BrandOverrides | undefined });
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
    'Opinionated end-of-task deliverable: a built-in styled template plus structured data → polished A4 PDF (default-report/campaign-summary or a configurable page template such as pages/editorial-two-column). All data fields are optional — only present blocks render, in the order: header, intro, kpis, charts, sections, table, highlights. Returns the path to the written PDF. Use this for the final client-facing report.',
    {
      template: z.string().optional().default('default-report').describe('Built-in A4 report template name, from list_templates: default-report, campaign-summary or a pages/* template'),
      data: reportDataSchema,
      output_path: z.string().optional(),
      ...reportContentFields,
      ...brandRenderFields,
      ...reportDiagnosticsField,
      template_ref: z.string().optional().describe('Alternative way to name the built-in A4 report template; must be one of the list_templates report names. Slide composition references such as slides/two-column are rejected here — they belong to the render_slides_* tools'),
    },
    async ({ template, data, output_path, content_root, brand_ref, brand_source, template_ref, surface, overrides, dry_run, diagnostics }) => {
      const requestedTemplate = template_ref ?? template;
      if (!reportTemplateNames().includes(requestedTemplate)) {
        return { content: [{ type: 'text' as const, text: unknownReportTemplateMessage(requestedTemplate) }], isError: true };
      }
      const context = await resolveBrandContext(cfg.brandDir, { brandRef: brand_ref, brandSource: brand_source, contentRoot: content_root, templateRef: template_ref ?? template, surface: surface ?? 'pdf-a4', overrides: overrides as BrandOverrides | undefined, brandSourceRoots: cfg.brandSourceRoots });
      const resolvedData = { ...data, brand: data.brand ?? context.brandName } as ReportData;
      if (dry_run) {
        const plan = resolveReportPlanOnly(requestedTemplate, resolvedData, context.theme);
        return { content: [{ type: 'text' as const, text: 'Report plan resolved without rendering.' }], structuredContent: { ...brandRenderSummary(context.diagnostics), ...reportRenderDiagnostics({ diagnostics: context.diagnostics, plan, drawings: [] }, 'full'), dryRun: true } };
      }
      await mkdir(cfg.outputDir, { recursive: true });
      const out = outputPath(cfg, output_path, 'pdf');
      const renderWarnings: string[] = [];
      const rendered = await renderReportPdfDetailed(requestedTemplate, resolvedData, context.theme, renderWarnings, context.sourceContext);
      await writeFile(out, rendered.buffer);
      return { content: [{ type: 'text' as const, text: out }], structuredContent: { path: out, ...brandRenderSummary(context.diagnostics, renderWarnings), ...reportRenderDiagnostics({ diagnostics: context.diagnostics, plan: rendered.diagnostics.plan, drawings: rendered.diagnostics.drawings }, diagnostics) } };
    },
  );

  server.tool(
    'list_templates',
    'List every template a render call can reference: built-in A4 report templates for render_report, built-in slide templates for the render_slides_* tools, and — when brand_ref is given — the brand-owned templates of that brandbook. Each entry says which tools accept it and whether it is builtin or brand-owned.',
    { brand_ref: z.string().optional().describe('Optional brand reference, e.g. brand://acme/primary, to also list that brandbook\'s templates') },
    async ({ brand_ref }) => {
      const reportTemplates = listTemplates().map((template) => ({
        template_ref: template.name,
        kind: 'report' as const,
        owner: 'builtin' as const,
        use_with: ['render_report'],
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
      const brandTemplates = brand_ref ? (await listBrandTemplates(cfg.brandDir, brand_ref)).map((template) => brandTemplateEntry(brand_ref, template)) : [];
      const templates = [...reportTemplates, ...builtinSlideTemplates, ...brandTemplates];
      const payload = { brand_dir: cfg.brandDir, brand_ref, templates };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  );
}
