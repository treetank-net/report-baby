import { z } from 'zod';
import { mkdir } from 'fs/promises';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { configFromEnv, getConfigDir } from './config.js';
import { registerRenderTools } from './tools/render-tools.js';
import { registerBrandTools } from './tools/brand-tools.js';
import { registerAuthTools } from './tools/auth.js';

type Handler = (args: any, extra?: any) => any;

const tools = new Map<string, { shape: any; handler: Handler }>();
const execFileAsync = promisify(execFile);

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
  brandPath?: string;
  gitRef?: string;
  json: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  const toolArgs: string[] = [];
  let brandUrl: string | undefined;
  let brandPath: string | undefined;
  let gitRef: string | undefined;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--brand-url' || arg === '--brand-path' || arg === '--git-ref') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--brand-url') brandUrl = value;
      if (arg === '--brand-path') brandPath = value;
      if (arg === '--git-ref') gitRef = value;
      index += 1;
      continue;
    }
    toolArgs.push(arg);
  }
  if (brandPath && !brandUrl) throw new Error('--brand-path requires --brand-url.');
  return { toolArgs, brandUrl, brandPath, gitRef, json };
}

async function prepareBrandDirectory(options: CliOptions): Promise<void> {
  if (!options.brandUrl) return;
  const ref = options.gitRef ?? 'HEAD';
  const brandPath = options.brandPath ?? '.';
  const key = createHash('sha256').update(JSON.stringify([options.brandUrl, ref, brandPath])).digest('hex').slice(0, 32);
  const cacheRoot = join(getConfigDir(), 'brand-cache');
  const checkout = join(cacheRoot, key);
  await mkdir(cacheRoot, { recursive: true });
  try {
    await execFileAsync('git', ['-C', checkout, 'rev-parse', '--is-inside-work-tree']);
  } catch {
    const cloneArgs = ['clone', '--depth', '1', '--filter=blob:none', '--sparse'];
    if (options.gitRef) cloneArgs.push('--branch', options.gitRef);
    cloneArgs.push(options.brandUrl, checkout);
    await execFileAsync('git', cloneArgs, { maxBuffer: 1024 * 1024 });
  }
  await execFileAsync('git', ['-C', checkout, 'sparse-checkout', 'set', brandPath], { maxBuffer: 1024 * 1024 });
  process.env.REPORT_BABY_BRAND_DIR = join(checkout, brandPath);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  await prepareBrandDirectory(options);
  const cfg = configFromEnv();
  registerAuthTools(collector, cfg);
  registerBrandTools(collector, cfg);
  registerRenderTools(collector, cfg);

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
  const input = raw && raw.trim() ? JSON.parse(raw) : {};
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
