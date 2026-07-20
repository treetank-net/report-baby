import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ReportConfig } from '../config.js';
import { listTemplates, renderReportPdf, type ReportData } from '../templates.js';
import { renderChart, metricCards, type ChartType } from '../svg.js';
import { renderSvgToPng } from '../render.js';
import { renderSlidesPdf, renderSlidesPng, renderSlidesPptx, type SlideDeck } from '../slides.js';

const datumSchema = z.object({
  label: z.string(),
  value: z.number(),
  color: z.string().optional(),
});

const cardSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  delta: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  note: z.string().optional(),
});

const reportChartSchema = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  prefix: z.string().optional().describe('Prepended to values, e.g. "$"'),
  suffix: z.string().optional().describe('Appended to values, e.g. "%"'),
  data: z.array(datumSchema).min(1),
});

const reportDataSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  brand: z.string().optional().describe('Client/company name shown in the top-left corner'),
  period: z.string().optional().describe('Reporting period shown in the top-right corner; keep short'),
  intro: z.string().optional().describe('Lead paragraph under the title'),
  kpis: z.array(cardSchema).optional().describe('KPI cards; keep labels under ~28 chars to avoid clipping'),
  charts: z.array(reportChartSchema).optional(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).optional().describe('Narrative sections; heading stays on the same page as the body'),
  table: z
    .object({
      head: z.array(z.string()).min(1),
      body: z.array(z.array(z.union([z.string(), z.number()]))),
      caption: z.string().optional(),
    })
    .optional(),
  highlights: z.array(z.string()).optional().describe('Bullet list rendered under a "Highlights" heading'),
  footer: z.string().optional().describe('Shown on every page; keep under ~120 chars'),
});

const slideCommonSchema = {
  title: z.string(),
  subtitle: z.string().optional(),
};

const slideSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('title'), ...slideCommonSchema, eyebrow: z.string().optional() }),
  z.object({ type: z.literal('metrics'), ...slideCommonSchema, metrics: z.array(cardSchema).min(1).max(6) }),
  z.object({
    type: z.literal('chart'),
    ...slideCommonSchema,
    chart: z.object({ type: z.enum(['bar', 'line', 'pie']), data: z.array(datumSchema).min(1), prefix: z.string().optional(), suffix: z.string().optional() }),
  }),
  z.object({ type: z.literal('table'), ...slideCommonSchema, head: z.array(z.string()).min(1), body: z.array(z.array(z.union([z.string(), z.number()]))) }),
  z.object({ type: z.literal('narrative'), ...slideCommonSchema, body: z.string(), highlights: z.array(z.string()).max(4).optional() }),
  z.object({ type: z.literal('conclusions'), ...slideCommonSchema, items: z.array(z.string()).min(1).max(7) }),
]);

const slideDeckSchema = z.object({
  title: z.string().optional(),
  brand: z.string().optional(),
  footer: z.string().optional(),
  slides: z.array(slideSchema).min(1),
});

function outputPath(cfg: ReportConfig, explicit: string | undefined, ext: string): string {
  if (explicit && explicit.length > 0) return explicit;
  return join(cfg.outputDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${ext}`);
}

async function writePng(cfg: ReportConfig, svg: string, width: number | undefined, explicit: string | undefined, returnImage: boolean) {
  await mkdir(cfg.outputDir, { recursive: true });
  const out = outputPath(cfg, explicit, 'png');
  const png = await renderSvgToPng(svg, width);
  await writeFile(out, png);
  const content: any[] = [{ type: 'text' as const, text: out }];
  if (returnImage) content.push({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' });
  return { content };
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
    },
    async ({ type, data, title, subtitle, prefix, suffix, width, output_path, return_image }) => {
      const svg = renderChart(type as ChartType, { data, title, subtitle, prefix, suffix });
      return writePng(cfg, svg, width, output_path, return_image);
    },
  );

  server.tool(
    'render_slides_pdf',
    'Render a complete presentation as a local 16:9 PDF from a bounded shared slide model. Existing render_report A4 behavior is unchanged. Returns the PDF path.',
    { data: slideDeckSchema, output_path: z.string().optional() },
    async ({ data, output_path }) => {
      const out = outputPath(cfg, output_path, 'pdf');
      await writeArtifact(out, await renderSlidesPdf(data as SlideDeck));
      return { content: [{ type: 'text' as const, text: out }] };
    },
  );

  server.tool(
    'render_slides_png',
    'Render the shared slide model to deterministic 1600x900 PNG files. Optionally render one zero-based slide_index without regenerating unrelated slides. Returns the written paths.',
    { data: slideDeckSchema, slide_index: z.number().int().nonnegative().optional(), output_dir: z.string().optional(), filename_prefix: z.string().optional().default('slide') },
    async ({ data, slide_index, output_dir, filename_prefix }) => {
      const directory = output_dir ?? cfg.outputDir;
      await mkdir(directory, { recursive: true });
      const buffers = await renderSlidesPng(data as SlideDeck, slide_index);
      const indexes = slide_index === undefined ? data.slides.map((_, index) => index) : [slide_index];
      const paths: string[] = [];
      for (let index = 0; index < buffers.length; index++) {
        const path = join(directory, `${filename_prefix}-${String(indexes[index] + 1).padStart(2, '0')}.png`);
        await writeFile(path, buffers[index]);
        paths.push(path);
      }
      return { content: [{ type: 'text' as const, text: paths.join('\n') }] };
    },
  );

  server.tool(
    'render_slides_pptx',
    'Render the shared slide model to an editable 16:9 PPTX. Text, KPI cards, tables, and basic shapes stay editable; charts are embedded as deterministic images. Returns the PPTX path.',
    { data: slideDeckSchema, output_path: z.string().optional() },
    async ({ data, output_path }) => {
      const out = outputPath(cfg, output_path, 'pptx');
      await writeArtifact(out, await renderSlidesPptx(data as SlideDeck));
      return { content: [{ type: 'text' as const, text: out }] };
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
    },
    async ({ cards, title, subtitle, columns, width, output_path, return_image }) => {
      const svg = metricCards({ cards, title, subtitle, columns, width });
      return writePng(cfg, svg, width, output_path, return_image);
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
    'Opinionated end-of-task deliverable: a built-in styled template plus structured data → polished multi-page A4 PDF (branded header, KPI grid, embedded charts, narrative sections, data table, highlights, footer). All data fields are optional — only present blocks render, in the order: header, intro, kpis, charts, sections, table, highlights. Returns the path to the written PDF. Use this for the final client-facing report.',
    {
      template: z.string().optional().default('default-report'),
      data: reportDataSchema,
      output_path: z.string().optional(),
    },
    async ({ template, data, output_path }) => {
      await mkdir(cfg.outputDir, { recursive: true });
      const out = outputPath(cfg, output_path, 'pdf');
      const pdf = await renderReportPdf(template, data as ReportData);
      await writeFile(out, pdf);
      return { content: [{ type: 'text' as const, text: out }] };
    },
  );

  server.tool(
    'list_templates',
    'List the built-in report templates available to render_report.',
    {},
    async () => {
      const lines = listTemplates().map((t) => `- ${t.name}: ${t.description}`);
      return { content: [{ type: 'text' as const, text: ['Available templates:', ...lines].join('\n') }] };
    },
  );
}
