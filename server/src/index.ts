import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configFromEnv } from './config.js';
import { registerRenderTools } from './tools/render.js';
import { registerAuthTools } from './tools/auth.js';

async function main() {
  const server = new McpServer({
    name: 'report-baby',
    version: '0.2.0',
  }, {
    instructions: [
      'This server is a self-contained render engine: it turns structured data into polished PNG charts and PDF reports locally. No accounts, no auth, no network, no headless browser — pure compute, fully bundled.',
      'Charts (render_chart) and metric cards (render_metric_cards) produce standalone PNGs to paste into a document or chat. render_report produces a multi-page A4 PDF as the final client-facing deliverable.',
      'For a chart, pass the raw data values (label/value pairs) — do NOT hand-build SVG unless you need something the chart types do not cover (then use render_svg; text needs font-family="DejaVu Sans").',
      'Render tools return the PATH to the written file. Do NOT pull rendered images into context to read numbers — you already have the source data. Only pass return_image: true when you must visually judge layout or aesthetics.',
    ].join(' '),
  });

  const cfg = configFromEnv();

  registerAuthTools(server, cfg);
  registerRenderTools(server, cfg);

  const transport = new StdioServerTransport();
  setInterval(() => undefined, 2147483647);
  process.stdin.resume();
  await server.connect(transport);
}

main().catch((err: any) => {
  process.stderr.write(`report-baby failed to start: ${err.message}\n`);
  process.exit(1);
});
