import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ReportConfig } from '../config.js';
import { listTemplates, renderReportPdf, type ReportData } from '../templates.js';
import { renderChart, metricCards, type ChartType } from '../svg.js';
import { renderSvgToPng } from '../render.js';

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
