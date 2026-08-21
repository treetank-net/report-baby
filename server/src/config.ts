import { isAbsolute, join, resolve } from 'path';

export interface ReportConfig {
  outputDir: string;
  brandDir: string;
  brandSourceRoots: string[];
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

export function getBrandDir(): string {
  const store = env('REPORT_BABY_BRAND_STORE');
  if (store) return store;
  const explicit = env('REPORT_BABY_BRAND_DIR');
  if (explicit) return explicit;
  return join(getConfigDir(), 'brands');
}

export function getBrandSourceRoots(): string[] {
  return env('REPORT_BABY_BRAND_SOURCE_ROOTS')
    .split(':')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
    .map((entry) => resolve(entry));
}

export function configFromEnv(): ReportConfig {
  return {
    outputDir: getOutputDir(),
    brandDir: getBrandDir(),
    brandSourceRoots: getBrandSourceRoots(),
  };
}
