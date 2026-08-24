import { z } from 'zod';
import { existsSync, statSync } from 'node:fs';
import { configFromEnv } from './config.js';
import { registerRenderTools } from './tools/render-tools.js';
import { registerBrandTools } from './tools/brand-tools.js';
import { registerAuthTools } from './tools/auth.js';

type Handler = (args: any, extra?: any) => any;

const tools = new Map<string, { shape: any; handler: Handler }>();
const collector: any = {
  tool(...args: any[]) {
    const name = args[0] as string;
    const handler = args[args.length - 1] as Handler;
    const shape = args.slice(1, -1).find((arg) => arg && typeof arg === 'object') ?? {};
    tools.set(name, { shape, handler });
  },
};

async function readInput(jsonArg: string | undefined, shape: any): Promise<string | undefined> {
  if (jsonArg !== undefined && jsonArg !== '-') return jsonArg;
  const hasArguments = Object.keys(shape ?? {}).length > 0;
  if (!hasArguments || (jsonArg === undefined && process.stdin.isTTY)) return jsonArg;
  return new Promise<string>((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buffer += chunk));
    process.stdin.on('end', () => resolve(buffer));
  });
}

interface CliOptions {
  toolArgs: string[];
  brandUrl?: string;
  brandZip?: string;
  brandPath?: string;
  gitRef?: string;
  contentRoot?: string;
  json: boolean;
  batch: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  const toolArgs: string[] = [];
  let brandUrl: string | undefined;
  let brandZip: string | undefined;
  let brandPath: string | undefined;
  let gitRef: string | undefined;
  let contentRoot: string | undefined;
  let json = false;
  let batch = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--batch') {
      batch = true;
      continue;
    }
    if (arg === '--brand-url' || arg === '--brand-zip' || arg === '--brand-path' || arg === '--git-ref' || arg === '--content-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--brand-url') brandUrl = value;
      if (arg === '--brand-zip') brandZip = value;
      if (arg === '--brand-path') brandPath = value;
      if (arg === '--git-ref') gitRef = value;
      if (arg === '--content-root') contentRoot = value;
      index += 1;
      continue;
    }
    toolArgs.push(arg);
  }
  if (brandUrl && brandZip) throw new Error('--brand-url and --brand-zip are mutually exclusive.');
  if (brandPath && !brandUrl && !brandZip) throw new Error('--brand-path requires --brand-url or --brand-zip.');
  return { toolArgs, brandUrl, brandZip, brandPath, gitRef, contentRoot, json, batch };
}

function cliBrandSource(options: CliOptions): Record<string, string> | undefined {
  if (options.brandZip) return { zip_path: options.brandZip, ...(options.brandPath ? { brand_path: options.brandPath } : {}) };
  if (!options.brandUrl) return undefined;
  if (existsSync(options.brandUrl)) return statSync(options.brandUrl).isDirectory()
    ? { directory_path: options.brandUrl, ...(options.brandPath ? { brand_path: options.brandPath } : {}) }
    : { zip_path: options.brandUrl, ...(options.brandPath ? { brand_path: options.brandPath } : {}) };
  const isGit = /\.git(?:$|[?#])/i.test(options.brandUrl);
  return isGit
    ? { git_url: options.brandUrl, ...(options.brandPath ? { brand_path: options.brandPath } : {}), ...(options.gitRef ? { ref: options.gitRef } : {}) }
    : { zip_url: options.brandUrl, ...(options.brandPath ? { brand_path: options.brandPath } : {}) };
}

function applyCliOverrides(input: any, options: CliOptions): any {
  const output = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  if (options.contentRoot && output.content_root === undefined) output.content_root = options.contentRoot;
  const source = cliBrandSource(options);
  if (source && output.brand_source === undefined) output.brand_source = source;
  return output;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buffer += chunk));
    process.stdin.on('end', () => resolve(buffer));
  });
}

async function runBatch(options: CliOptions): Promise<void> {
  const requests = JSON.parse(await readStdin()) as Array<{ tool: string; args?: unknown }>;
  if (!Array.isArray(requests)) throw new Error('--batch expects a JSON array on stdin.');
  for (const request of requests) {
    const tool = tools.get(request.tool);
    if (!tool) throw new Error(`unknown tool in batch: ${request.tool}`);
    const input = applyCliOverrides(request.args ?? {}, options);
    const parsed = Object.keys(tool.shape ?? {}).length ? z.object(tool.shape).parse(input) : input;
    const result = await tool.handler(parsed, {});
    if (result?.isError) throw new Error(JSON.stringify(result));
    process.stdout.write(`${JSON.stringify(result?.structuredContent ?? result)}\n`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const cfg = configFromEnv();
  registerAuthTools(collector, cfg);
  registerBrandTools(collector, cfg);
  registerRenderTools(collector, cfg);

  if (options.batch) {
    await runBatch(options);
    return;
  }

  const [nameArg, jsonArg] = options.toolArgs;
  if (!nameArg || nameArg === '--list' || nameArg === '-l') {
    for (const [name, tool] of tools) {
      const keys = Object.keys(tool.shape ?? {});
      process.stdout.write(`${name}${keys.length ? `  (${keys.join(', ')})` : ''}\n`);
    }
    return;
  }

  const tool = tools.get(nameArg);
  if (!tool) {
    process.stderr.write(`unknown tool: ${nameArg}\nrun --list to see available tools\n`);
    process.exitCode = 2;
    return;
  }

  const raw = await readInput(jsonArg, tool.shape);
  const input = applyCliOverrides(raw && raw.trim() ? JSON.parse(raw) : {}, options);
  const parsed = Object.keys(tool.shape ?? {}).length ? z.object(tool.shape).parse(input) : input;
  const result = await tool.handler(parsed, {});

  if (result?.isError) {
    process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }
  const structuredContent = result?.structuredContent ?? result;
  if (options.json) {
    process.stdout.write(`${JSON.stringify(structuredContent, null, 2)}\n`);
    return;
  }
  const path = structuredContent?.path;
  process.stdout.write(path ? `${path}\n` : `${JSON.stringify(structuredContent, null, 2)}\n`);
  if (path && Array.isArray(structuredContent?.warnings)) {
    for (const warning of structuredContent.warnings) {
      process.stderr.write(`report-baby warning: ${typeof warning === 'string' ? warning : JSON.stringify(warning)}\n`);
    }
  }
}

main().catch((error: any) => {
  process.stderr.write(`report-baby cli: ${error?.message ?? error}\n`);
  process.exitCode = 1;
});
