import type { RenderTheme } from '../core/model/render-theme.js';

export const DEFAULT_THEME: RenderTheme = {
  background: '#ffffff',
  foreground: '#0f172a',
  primary: '#2563eb',
  secondary: '#0ea5e9',
  muted: '#64748b',
  line: '#e2e8f0',
  soft: '#f8fafc',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f59e0b',
  palette: ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e'],
  fontFamily: 'DejaVu Sans',
  headingFontFamily: 'DejaVu Sans',
  bodyScale: 1,
  headingScale: 1,
  pptxHeadingScale: 1,
  fitStrategy: 'none',
  minBodyPt: 10,
  minHeadingPt: 18,
  density: 'comfortable',
  headerStyle: 'plain',
  reportHeaderStyle: 'plain',
  showReportBrandName: true,
  titleAlign: 'left',
  titleCase: 'normal',
  titleColor: '#ffffff',
  titleAccentColor: '#ffffff',
  titleSubtitleColor: '#ffffff',
  titleLogoWidthPx: 210,
  titleLogoHeightPx: 48,
  headingWeight: 700,
  bodyWeight: 400,
  radius: 10,
  logoVariant: 'default',
  backgroundImageOpacity: 0.16,
  imageTextColor: '#ffffff',
  imageTextSafeArea: { x: 0.05, y: 0.18, width: 0.58, height: 0.55 },
};

function parseHexColor(value: string | undefined): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? '').trim());
  if (!match) return undefined;
  const raw = match[1].length === 3 ? match[1].split('').map((part) => part + part).join('') : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16)) as [number, number, number];
}

function channelLuminance(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function rgbLuminance(channels: [number, number, number]): number {
  return 0.2126 * channelLuminance(channels[0]) + 0.7152 * channelLuminance(channels[1]) + 0.0722 * channelLuminance(channels[2]);
}

export function colorContrastRatio(foreground: string | undefined, background: string | undefined): number | undefined {
  const first = parseHexColor(foreground);
  const second = parseHexColor(background);
  if (!first || !second) return undefined;
  const lighter = Math.max(rgbLuminance(first), rgbLuminance(second));
  const darker = Math.min(rgbLuminance(first), rgbLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableInk(background: string | undefined, candidates: Array<string | undefined>, minimum: number): string {
  const scored = candidates
    .map((candidate) => ({ candidate, ratio: colorContrastRatio(candidate, background) }))
    .filter((entry): entry is { candidate: string; ratio: number } => Boolean(entry.candidate) && entry.ratio !== undefined);
  const preferred = scored.find((entry) => entry.ratio >= minimum);
  if (preferred) return preferred.candidate;
  const best = scored.reduce<{ candidate: string; ratio: number } | undefined>((winner, entry) => (!winner || entry.ratio > winner.ratio ? entry : winner), undefined);
  return best?.candidate ?? candidates.find((candidate): candidate is string => Boolean(candidate)) ?? '#ffffff';
}

export function defaultRenderTheme(): RenderTheme {
  return { ...DEFAULT_THEME, palette: [...DEFAULT_THEME.palette], imageTextSafeArea: { ...DEFAULT_THEME.imageTextSafeArea } };
}
