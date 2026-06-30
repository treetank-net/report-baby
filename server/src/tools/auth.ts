import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ReportConfig } from '../config.js';

const REPO_RAW = 'https://raw.githubusercontent.com/treetank-net/report-baby/main';

function getPluginRoot(): string {
  return process.env['CLAUDE_PLUGIN_ROOT'] || process.cwd();
}

function getLocalVersion(): string {
  try {
    const pkgPath = join(getPluginRoot(), 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch { return '0.0.0'; }
}

async function downloadFile(remotePath: string, localPath: string): Promise<boolean> {
  const res = await fetch(`${REPO_RAW}/${remotePath}`);
  if (!res.ok) return false;
  writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
  return true;
}

function parseSemver(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
}

function semverGt(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return false;
}

function extractChangelog(text: string, fromVer: string, toVer: string): string {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: { version: string; body: string[] } | null = null;
  const flush = () => {
    if (current && semverGt(current.version, fromVer) && !semverGt(current.version, toVer)) {
      sections.push([`## ${current.version}`, ...current.body].join('\n').trimEnd());
    }
  };
  for (const line of lines) {
    const m = line.match(/^##\s+v?(\d+\.\d+\.\d+)/);
    if (m) {
      flush();
      current = { version: m[1], body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();
  return sections.join('\n\n').trim();
}

async function fetchChangelog(fromVer: string, toVer: string): Promise<string> {
  try {
    const res = await fetch(`${REPO_RAW}/CHANGELOG.md`);
    if (!res.ok) return '';
    return extractChangelog(await res.text(), fromVer, toVer);
  } catch { return ''; }
}

export function registerAuthTools(server: McpServer, _cfg: ReportConfig) {
  server.tool(
    'check_update',
    'Check for plugin updates and install them. After updating, the user must restart the session for changes to take effect.',
    {},
    async () => {
      const localVer = getLocalVersion();
      try {
        const res = await fetch(`${REPO_RAW}/package.json`);
        if (!res.ok) {
          return { content: [{ type: 'text', text: `Cannot reach update server. Current version: ${localVer}` }] };
        }
        const remote = await res.json() as { version?: string };
        const remoteVer = remote.version || '0.0.0';

        if (remoteVer === localVer) {
          return { content: [{ type: 'text', text: `Already up to date: ${localVer}` }] };
        }

        const root = getPluginRoot();
        const results: string[] = [];
        const changelog = await fetchChangelog(localVer, remoteVer);

        const files = [
          ['server/bundle.cjs', join(root, 'server', 'bundle.cjs')],
          ['package.json', join(root, 'package.json')],
          ['scripts/start-mcp.js', join(root, 'scripts', 'start-mcp.js')],
          ['CHANGELOG.md', join(root, 'CHANGELOG.md')],
        ];
        for (const [remote, local] of files) {
          const ok = await downloadFile(remote, local);
          results.push(`${remote}: ${ok ? 'OK' : 'FAILED'}`);
        }

        return {
          content: [{
            type: 'text',
            text: [
              `Updated ${localVer} → ${remoteVer}`,
              ...(changelog ? ['', "What's new:", changelog] : []),
              '',
              ...results,
              '',
              'Restart the session for changes to take effect.',
            ].join('\n'),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text', text: `Update check failed: ${err.message}. Current version: ${localVer}` }] };
      }
    },
  );
}
