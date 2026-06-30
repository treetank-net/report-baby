import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { configFromEnv } from './config.js';
import { registerRenderTools } from './tools/render.js';
import { registerAuthTools } from './tools/auth.js';

async function main() {
  const server = new McpServer({
    name: 'report-baby',
    version: '0.1.1',
  }, {
    instructions: [
      'This server renders HTML into polished PDF/PNG files via headless Chromium. It is a pure render engine: no accounts, no auth, no external mutations.',
      'For a final, human-facing deliverable (e.g. a client report) generate complete, self-contained HTML and render it with render_html_to_pdf, or use render_report with the built-in styled template plus your data.',
      'Render tools return the PATH to the written file, not the file itself. Do NOT pull rendered images into context to read numbers — you have the source data already. Only pass return_image: true when you must visually judge layout or aesthetics.',
      'Charts are out of scope for this server: embed inline Chart.js or pre-rendered SVG in the HTML you pass; report-baby only rasterizes/paginates it.',
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
