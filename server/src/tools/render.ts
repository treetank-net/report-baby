import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mkdir, readFile } from 'fs/promises';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ReportConfig } from '../config.js';
import { listTemplates, renderTemplate } from '../templates.js';
import {
  renderHtmlToImage,
  renderHtmlToPdf,
  renderUrlToImage,
  renderUrlToPdf,
  type ImageOptions,
  type PdfOptions,
} from '../render.js';

const pdfOptionsSchema = z
  .object({
    format: z.string().optional(),
    landscape: z.boolean().optional(),
    margin: z.string().optional(),
    print_background: z.boolean().optional(),
  })
  .optional();

const imageOptionsSchema = z
  .object({
    width: z.number().optional(),
    height: z.number().optional(),
    device_scale_factor: z.number().optional(),
    full_page: z.boolean().optional(),
    type: z.enum(['png', 'jpeg']).optional(),
  })
  .optional();

function requireHtmlXor(html?: string, htmlPath?: string) {
  const hasHtml = typeof html === 'string' && html.length > 0;
  const hasPath = typeof htmlPath === 'string' && htmlPath.length > 0;
  if (hasHtml === hasPath) {
    throw new Error('Provide exactly one of html or html_path.');
  }
}

function outputPath(cfg: ReportConfig, explicit: string | undefined, ext: string): string {
  if (explicit && explicit.length > 0) return explicit;
  return join(cfg.outputDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.${ext}`);
}

function pdfOptions(options: z.infer<NonNullable<typeof pdfOptionsSchema>>): PdfOptions {
  const margin = options?.margin
    ? { top: options.margin, right: options.margin, bottom: options.margin, left: options.margin }
    : undefined;
  return {
    format: options?.format,
    landscape: options?.landscape,
    margin,
    printBackground: options?.print_background,
  };
}

function imageOptions(options: z.infer<NonNullable<typeof imageOptionsSchema>>): ImageOptions {
  return {
    width: options?.width,
    height: options?.height,
    deviceScaleFactor: options?.device_scale_factor,
    fullPage: options?.full_page,
    type: options?.type,
  };
}

async function htmlInput(html?: string, htmlPath?: string): Promise<string> {
  if (html) return html;
  if (!htmlPath) throw new Error('Provide html or html_path.');
  return readFile(htmlPath, 'utf-8');
}

async function fileResponse(path: string, returnImage = false, type: 'png' | 'jpeg' = 'png') {
  const content: any[] = [{ type: 'text' as const, text: path }];
  if (returnImage) {
    const data = await readFile(path);
    content.push({
      type: 'image' as const,
      data: data.toString('base64'),
      mimeType: type === 'jpeg' ? 'image/jpeg' : 'image/png',
    });
  }
  return { content };
}

function imageExt(explicit: string | undefined, options: z.infer<NonNullable<typeof imageOptionsSchema>>): 'png' | 'jpeg' {
  if (options?.type) return options.type;
  const ext = explicit ? extname(explicit).toLowerCase() : '';
  return ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : 'png';
}

export function registerRenderTools(server: McpServer, cfg: ReportConfig) {
  server.tool(
    'render_html_to_pdf',
    'Render an HTML string or HTML file to a PDF via headless Chromium. Returns the path to the written PDF file (not the file content).',
    {
      html: z.string().optional(),
      html_path: z.string().optional(),
      output_path: z.string().optional(),
      options: pdfOptionsSchema,
    },
    async ({ html, html_path, output_path, options }) => {
      requireHtmlXor(html, html_path);
      const out = outputPath(cfg, output_path, 'pdf');
      const rendered = await renderHtmlToPdf(cfg, await htmlInput(html, html_path), out, pdfOptions(options));
      return fileResponse(rendered);
    },
  );

  server.tool(
    'render_html_to_image',
    'Render an HTML string or HTML file to a PNG/JPEG via headless Chromium. Returns the path to the written image file. Set return_image to also include the image in the response (only when the LLM must judge layout/aesthetics).',
    {
      html: z.string().optional(),
      html_path: z.string().optional(),
      output_path: z.string().optional(),
      options: imageOptionsSchema,
      return_image: z.boolean().optional().default(false),
    },
    async ({ html, html_path, output_path, options, return_image }) => {
      requireHtmlXor(html, html_path);
      const ext = imageExt(output_path, options);
      const out = outputPath(cfg, output_path, ext === 'jpeg' ? 'jpg' : 'png');
      const rendered = await renderHtmlToImage(cfg, await htmlInput(html, html_path), out, imageOptions({ ...options, type: ext }));
      return fileResponse(rendered, return_image, ext);
    },
  );

  server.tool(
    'render_url_to_pdf',
    'Navigate to a URL and render it to a PDF via headless Chromium. Returns the path to the written PDF file.',
    {
      url: z.string().url(),
      output_path: z.string().optional(),
      options: pdfOptionsSchema,
    },
    async ({ url, output_path, options }) => {
      const out = outputPath(cfg, output_path, 'pdf');
      const rendered = await renderUrlToPdf(cfg, url, out, pdfOptions(options));
      return fileResponse(rendered);
    },
  );

  server.tool(
    'render_url_to_image',
    'Navigate to a URL and render it to a PNG/JPEG via headless Chromium. Returns the path to the written image file. Set return_image to also include the image in the response (only when the LLM must judge layout/aesthetics).',
    {
      url: z.string().url(),
      output_path: z.string().optional(),
      options: imageOptionsSchema,
      return_image: z.boolean().optional().default(false),
    },
    async ({ url, output_path, options, return_image }) => {
      const ext = imageExt(output_path, options);
      const out = outputPath(cfg, output_path, ext === 'jpeg' ? 'jpg' : 'png');
      const rendered = await renderUrlToImage(cfg, url, out, imageOptions({ ...options, type: ext }));
      return fileResponse(rendered, return_image, ext);
    },
  );

  server.tool(
    'render_report',
    'Opinionated end-of-task deliverable: feed a built-in styled template plus your data and get a polished PDF/PNG report file. Returns the path to the written file. Use this for the "nice client-facing report" at the end.',
    {
      template: z.string().optional().default('default-report'),
      data: z.record(z.any()),
      output_path: z.string().optional(),
      format: z.enum(['pdf', 'png']).optional().default('pdf'),
      options: z.union([pdfOptionsSchema, imageOptionsSchema]).optional(),
      return_image: z.boolean().optional().default(false),
    },
    async ({ template, data, output_path, format, options, return_image }) => {
      await mkdir(cfg.outputDir, { recursive: true });
      const html = renderTemplate(template, data);
      if (format === 'png') {
        const out = outputPath(cfg, output_path, 'png');
        const rendered = await renderHtmlToImage(cfg, html, out, imageOptions({ ...(options as any), type: 'png' }));
        return fileResponse(rendered, return_image, 'png');
      }
      const out = outputPath(cfg, output_path, 'pdf');
      const rendered = await renderHtmlToPdf(cfg, html, out, pdfOptions(options as any));
      return fileResponse(rendered);
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
