import { join } from 'path';

export interface ReportConfig {
  outputDir: string;
  chromiumChannel?: string;
}

function isValidEnv(val: string | undefined): val is string {
  return !!val && !val.includes('${');
}

function env(name: string): string {
  const v = process.env[name];
  return isValidEnv(v) ? v : '';
}

export function getConfigDir(): string {
  const explicit = env('REPORT_BABY_DATA');
  if (explicit) return explicit;
  const home = process.env['HOME'] || process.env['USERPROFILE'] || process.env['APPDATA'];
  if (home) return join(home, '.report-baby');
  return join(process.platform === 'win32' ? (process.env['TEMP'] || 'C:\\Temp') : '/tmp', '.report-baby');
}

export function getOutputDir(): string {
  return join(getConfigDir(), 'out');
}

export function configFromEnv(): ReportConfig {
  const chromiumChannel = env('REPORT_BABY_CHROMIUM_CHANNEL');
  return {
    outputDir: getOutputDir(),
    chromiumChannel: chromiumChannel || undefined,
  };
}
