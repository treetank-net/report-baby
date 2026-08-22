import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { inspectBrand, inspectBrandTemplate, listBrandbooks, listBrandTemplates } from '../brand.js';
import type { ReportConfig } from '../config.js';

export function registerBrandTools(server: McpServer, cfg: ReportConfig): void {
  server.tool(
    'list_brandbooks',
    'List locally configured brandbooks and their named profiles. Brandbooks are discovered below the configured report-baby brand directory.',
    {},
    async () => {
      const brandbooks = await listBrandbooks(cfg.brandDir);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brand_dir: cfg.brandDir, brandbooks }, null, 2) }] };
    },
  );

  server.tool(
    'inspect_brand',
    'Resolve and inspect one brand profile without rendering an artifact. Use references such as brand://acme/primary.',
    {
      brand_ref: z.string().describe('Brand profile reference, e.g. brand://acme/primary'),
      surface: z.string().optional().describe('Optional output surface used to select light/dark values'),
    },
    async ({ brand_ref, surface }) => {
      const context = await inspectBrand(cfg.brandDir, brand_ref, surface, cfg.brandSourceRoots);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ brand_ref, surface, theme: context.theme, diagnostics: context.diagnostics }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_brand_templates',
    'List read-only brand-owned page and slide templates available in a brandbook.',
    {
      brand_ref: z.string().describe('Brand reference, e.g. brand://acme/primary'),
    },
    async ({ brand_ref }) => {
      const templates = await listBrandTemplates(cfg.brandDir, brand_ref);
      return { content: [{ type: 'text' as const, text: JSON.stringify({ brand_ref, templates }, null, 2) }] };
    },
  );

  server.tool(
    'inspect_brand_template',
    'Inspect and validate one brand-owned template without changing the brandbook.',
    {
      brand_ref: z.string().describe('Brand reference, e.g. brand://acme/primary'),
      template_ref: z.string().describe('Brand-local template reference, e.g. slides/title'),
    },
    async ({ brand_ref, template_ref }) => {
      const template = await inspectBrandTemplate(cfg.brandDir, brand_ref, template_ref);
      return { content: [{ type: 'text' as const, text: JSON.stringify(template, null, 2) }] };
    },
  );
}
