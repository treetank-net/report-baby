import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configFromEnv } from './config.js';
import { registerRenderTools } from './tools/render-tools.js';
import { registerBrandTools } from './tools/brand-tools.js';
import { registerAuthTools } from './tools/auth.js';
import { SERVER_VERSION } from './version.js';

async function main() {
  const server = new McpServer({
    name: 'report-baby',
    version: SERVER_VERSION,
  }, {
    instructions: [
      'This server is a self-contained render engine: it turns structured data into polished PNG charts and PDF reports locally. No accounts, no auth, no headless browser — pure compute, fully bundled.',
      'Charts and metric cards produce standalone PNGs. render_report produces the canonical multi-page A4 PDF; render_report_png rasterizes its pages to PNG and render_report_pptx embeds those pages in a portrait PPTX. Presentation tools share one bounded slide model and produce 16:9 PDF, selected or complete PNG slides, and editable PPTX.',
      'A slide can carry notes: speaker narration that is never drawn on the slide. Only render_slides_pptx keeps it (in the PowerPoint notes slide shown in presenter view); render_slides_pdf and render_slides_png drop it and report a counted warning.',
      'For a chart, pass the raw data values (label/value pairs) — do NOT hand-build SVG unless you need something the chart types do not cover (then use render_svg; text needs font-family="DejaVu Sans").',
      'Render tools return the PATH to the written file plus a compact summary: resolved brand profile, template_ref, slide count and deduplicated warnings. Do NOT pull rendered images into context to read numbers — you already have the source data. Only pass return_image: true when you must visually judge layout or aesthetics.',
      'The render_slides_* tools accept diagnostics: "full" to add the per-slide pixel layout plans; that payload costs thousands of tokens per deck, so request it only when a layout is actually broken.',
      'Brand profiles are referenced explicitly, for example brand://acme/primary. Use list_brandbooks or inspect_brand to discover and validate them. Render overrides are one-call-only and never mutate the brandbook.',
    ].join(' '),
  });

  const cfg = configFromEnv();

  registerAuthTools(server, cfg);
  registerBrandTools(server, cfg);
  registerRenderTools(server, cfg);

  const transport = new StdioServerTransport();
  setInterval(() => undefined, 2147483647);
  await server.connect(transport);
  process.stdin.resume();
}

main().catch((err: any) => {
  process.stderr.write(`report-baby failed to start: ${err.message}\n`);
  process.exit(1);
});
