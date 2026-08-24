import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { brandCapabilities, inspectBrand, inspectBrandTemplate, listBrandbooks, listBrandTemplates } from '../brand-context.js';
import type { ReportConfig } from '../config.js';
import { brandSourceSchema } from '../contract/schema.js';

export function registerBrandTools(server: McpServer, cfg: ReportConfig): void {
  server.tool(
    'list_brandbooks',
    'List brandbooks and their named profiles from the configured directory or a request-level directory/ZIP/Git source.',
    { brand_source: brandSourceSchema.optional().describe('Optional source to inspect instead of the process-level brand directory') },
    async ({ brand_source }) => {
      const brandbooks = await listBrandbooks(cfg.brandDir, brand_source);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brand_dir: cfg.brandDir, brand_source, brandbooks }, null, 2) }] };
    },
  );

  server.tool(
    'inspect_brand',
    'Resolve and inspect one brand profile without rendering an artifact. Use brand_source for a request-level directory/ZIP/Git source and a path-based reference such as brand://acme/profiles/primary.',
    {
      brand_ref: z.string().describe('Path-based brand/profile reference; the first segment selects a directory and the remainder selects a profile file, e.g. brand://acme/profiles/primary'),
      surface: z.string().optional().describe('Optional output surface used to select light/dark values'),
      brand_source: brandSourceSchema.optional().describe('Optional source to inspect instead of the process-level brand directory'),
    },
    async ({ brand_ref, surface, brand_source }) => {
      const context = await inspectBrand(cfg.brandDir, brand_ref, surface, cfg.brandSourceRoots, brand_source);
      const templates = await listBrandTemplates(cfg.brandDir, brand_ref, brand_source);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ brand_ref, surface, theme: context.theme, diagnostics: context.diagnostics, capabilities: { ...brandCapabilities(context), brand_templates: templates } }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_brand_templates',
    'List read-only brand-owned page and slide templates available in a brandbook or request-level directory/ZIP/Git source.',
    {
      brand_ref: z.string().describe('Brand reference, e.g. brand://acme/profiles/primary'),
      brand_source: brandSourceSchema.optional().describe('Optional source to inspect instead of the process-level brand directory'),
    },
    async ({ brand_ref, brand_source }) => {
      const templates = await listBrandTemplates(cfg.brandDir, brand_ref, brand_source);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brand_ref, brand_source, templates }, null, 2) }] };
    },
  );

  server.tool(
    'inspect_brand_template',
    'Inspect and validate one brand-owned template without changing the brandbook. Supports request-level directory/ZIP/Git sources.',
    {
      brand_ref: z.string().describe('Brand reference, e.g. brand://acme/profiles/primary'),
      template_ref: z.string().describe('Brand-local template reference, e.g. slides/title'),
      brand_source: brandSourceSchema.optional().describe('Optional source to inspect instead of the process-level brand directory'),
    },
    async ({ brand_ref, template_ref, brand_source }) => {
      const template = await inspectBrandTemplate(cfg.brandDir, brand_ref, template_ref, brand_source);
      return { content: [{ type: 'text' as const, text: JSON.stringify(template, null, 2) }] };
    },
  );
}
