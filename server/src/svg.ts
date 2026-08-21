export const FONT_FAMILY = 'DejaVu Sans';
import type { RenderTheme } from './brand.js';
import { readRenderConfig } from './builtin-template-loader.js';

const RENDER_CONFIG = readRenderConfig();
const CHART_CONFIG = RENDER_CONFIG.chart;
const LEGACY = RENDER_CONFIG.legacy;

export const PALETTE = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#22c55e'];
const INK = '#0f172a';
const MUTED = '#64748b';
const GRID = '#e7edf3';
const AXIS = '#cbd5e1';
const SOFT = '#f8fafc';
const GOOD = '#16a34a';
const BAD = '#dc2626';

export interface ChartDatum {
  label: string;
  value: number;
  color?: string;
}

export interface ChartOptions {
  title?: string;
  subtitle?: string;
  width?: number;
  height?: number;
  prefix?: string;
  suffix?: string;
  data: ChartDatum[];
  theme?: RenderTheme;
}

export interface MetricCard {
  label: string;
  value: string | number;
  delta?: string;
  trend?: 'up' | 'down' | 'flat';
  note?: string;
}

export interface MetricOptions {
  title?: string;
  subtitle?: string;
  width?: number;
  columns?: number;
  cards: MetricCard[];
  theme?: RenderTheme;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(v: number, prefix = '', suffix = ''): string {
  const abs = Math.abs(v);
  let body: string;
  if (abs >= 1_000_000) body = (v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
  else if (abs >= 10_000) body = (v / 1_000).toFixed(0) + 'k';
  else body = String(Math.round(v * 100) / 100);
  return `${prefix}${body}${suffix}`;
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 2.5) nice = 2.5;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function truncate(text: string, maxWidth: number, size: number): string {
  const charW = size * CHART_CONFIG.glyphWidth;
  const max = Math.floor(maxWidth / charW);
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return text.slice(0, max - 1) + '…';
}

function text(x: number, y: number, content: unknown, opts: { size?: number; color?: string; anchor?: string; weight?: number } = {}): string {
  const size = opts.size ?? CHART_CONFIG.textSize;
  const color = opts.color ?? INK;
  const anchor = opts.anchor ?? 'start';
  const weight = opts.weight ?? 400;
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(content)}</text>`;
}

function header(width: number, opts: ChartOptions | MetricOptions): { svg: string; top: number } {
  const theme = opts.theme;
  if (!opts.title && !opts.subtitle) return { svg: '', top: CHART_CONFIG.headerEmptyTop };
  const parts: string[] = [];
  let y = CHART_CONFIG.headerTitleY;
  if (opts.title) {
    parts.push(text(CHART_CONFIG.headerX, y, opts.title, { size: CHART_CONFIG.headerTitleSize, weight: 700, color: theme?.foreground ?? INK }));
    y += opts.subtitle ? CHART_CONFIG.headerTitleGap : 0;
  }
  if (opts.subtitle) {
    parts.push(text(CHART_CONFIG.headerX, y, opts.subtitle, { size: CHART_CONFIG.headerSubtitleSize, color: theme?.muted ?? MUTED }));
  }
  return { svg: parts.join(''), top: y + CHART_CONFIG.headerBottomGap };
}

function open(width: number, height: number, theme?: RenderTheme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="${theme?.background ?? '#ffffff'}"/>`;
}

export function barChart(opts: ChartOptions): string {
  const width = opts.width ?? CHART_CONFIG.width;
  const height = opts.height ?? CHART_CONFIG.height;
  const { svg: head, top } = header(width, opts);

  const padL = CHART_CONFIG.padLeft;
  const padR = CHART_CONFIG.padRight;
  const padBottom = CHART_CONFIG.padBottom;
  const plotTop = top;
  const plotLeft = padL;
  const plotW = width - padL - padR;
  const plotH = height - plotTop - padBottom;
  const plotBottom = plotTop + plotH;

  const max = niceCeil(Math.max(0, ...opts.data.map((d) => d.value)));
  const ticks = CHART_CONFIG.ticks;
  const parts: string[] = [open(width, height, opts.theme), head];
  const grid = opts.theme?.line ?? GRID;
  const axis = opts.theme?.line ?? AXIS;
  const muted = opts.theme?.muted ?? MUTED;
  const ink = opts.theme?.foreground ?? INK;

  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = plotBottom - (v / max) * plotH;
    parts.push(`<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotW}" y2="${y}" stroke="${i === 0 ? axis : grid}" stroke-width="${CHART_CONFIG.gridLineWidth}"/>`);
    parts.push(text(plotLeft - CHART_CONFIG.tickLabelOffset, y + CHART_CONFIG.tickLabelBaseline, fmt(v, opts.prefix, opts.suffix), { size: CHART_CONFIG.tickLabelSize, color: muted, anchor: 'end' }));
  }

  const n = opts.data.length || 1;
  const slot = plotW / n;
  const barW = Math.min(slot * CHART_CONFIG.barSlotRatio, CHART_CONFIG.barMaxWidth);

  opts.data.forEach((d, i) => {
    const cx = plotLeft + i * slot + slot / 2;
    const x = cx - barW / 2;
    const h = max > 0 ? (d.value / max) * plotH : 0;
    const y = plotBottom - h;
    const color = d.color ?? opts.theme?.palette[i % (opts.theme.palette.length || 1)] ?? PALETTE[i % PALETTE.length];
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${CHART_CONFIG.barRadius}" fill="${color}"/>`);
    parts.push(text(cx, y - CHART_CONFIG.valueOffset, fmt(d.value, opts.prefix, opts.suffix), { size: CHART_CONFIG.barValueSize, color: ink, weight: 600, anchor: 'middle' }));
    parts.push(text(cx, plotBottom + CHART_CONFIG.barLabelGap, truncate(d.label, slot - CHART_CONFIG.barLabelReserve, CHART_CONFIG.barLabelSize), { size: CHART_CONFIG.barLabelSize, color: muted, anchor: 'middle' }));
  });

  parts.push('</svg>');
  return parts.join('');
}

export function lineChart(opts: ChartOptions): string {
  const width = opts.width ?? CHART_CONFIG.width;
  const height = opts.height ?? CHART_CONFIG.height;
  const { svg: head, top } = header(width, opts);

  const padL = CHART_CONFIG.padLeft;
  const padR = CHART_CONFIG.padRight;
  const padBottom = CHART_CONFIG.padBottom;
  const plotTop = top;
  const plotLeft = padL;
  const plotW = width - padL - padR;
  const plotH = height - plotTop - padBottom;
  const plotBottom = plotTop + plotH;

  const max = niceCeil(Math.max(0, ...opts.data.map((d) => d.value)));
  const ticks = CHART_CONFIG.ticks;
  const parts: string[] = [open(width, height, opts.theme), head];
  const grid = opts.theme?.line ?? GRID;
  const axis = opts.theme?.line ?? AXIS;
  const muted = opts.theme?.muted ?? MUTED;
  const ink = opts.theme?.foreground ?? INK;

  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = plotBottom - (v / max) * plotH;
    parts.push(`<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotW}" y2="${y}" stroke="${i === 0 ? axis : grid}" stroke-width="${CHART_CONFIG.gridLineWidth}"/>`);
    parts.push(text(plotLeft - CHART_CONFIG.tickLabelOffset, y + CHART_CONFIG.tickLabelBaseline, fmt(v, opts.prefix, opts.suffix), { size: CHART_CONFIG.tickLabelSize, color: muted, anchor: 'end' }));
  }

  const n = opts.data.length;
  const accent = opts.data[0]?.color ?? opts.theme?.primary ?? PALETTE[0];
  const px = (i: number) => plotLeft + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const py = (v: number) => plotBottom - (max > 0 ? (v / max) * plotH : 0);

  const pts = opts.data.map((d, i) => `${px(i).toFixed(1)},${py(d.value).toFixed(1)}`);
  if (pts.length > 0) {
    const area = `M ${px(0).toFixed(1)} ${plotBottom} L ${pts.join(' L ')} L ${px(n - 1).toFixed(1)} ${plotBottom} Z`;
    parts.push(`<path d="${area}" fill="${accent}" fill-opacity="${CHART_CONFIG.lineAreaOpacity}"/>`);
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${accent}" stroke-width="${CHART_CONFIG.lineWidth}" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  opts.data.forEach((d, i) => {
    parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(d.value).toFixed(1)}" r="${CHART_CONFIG.pointRadius}" fill="#ffffff" stroke="${accent}" stroke-width="${CHART_CONFIG.linePointStrokeWidth}"/>`);
    parts.push(text(px(i), plotBottom + CHART_CONFIG.lineLabelGap, truncate(d.label, plotW / n - CHART_CONFIG.lineLabelReserve, CHART_CONFIG.lineLabelSize), { size: CHART_CONFIG.lineLabelSize, color: muted, anchor: 'middle' }));
    if (n <= CHART_CONFIG.lineValueMaxPoints) {
      const above = py(d.value) - CHART_CONFIG.lineValueOffset;
      const valueY = above - CHART_CONFIG.lineValueSize < plotTop ? py(d.value) + CHART_CONFIG.lineValueOffset + CHART_CONFIG.lineValueSize : above;
      parts.push(text(px(i), valueY, fmt(d.value, opts.prefix, opts.suffix), { size: CHART_CONFIG.lineValueSize, color: ink, weight: 600, anchor: 'middle' }));
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

function ringPath(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const ox0 = cx + ro * Math.cos(a0), oy0 = cy + ro * Math.sin(a0);
  const ox1 = cx + ro * Math.cos(a1), oy1 = cy + ro * Math.sin(a1);
  const ix1 = cx + ri * Math.cos(a1), iy1 = cy + ri * Math.sin(a1);
  const ix0 = cx + ri * Math.cos(a0), iy0 = cy + ri * Math.sin(a0);
  return `M ${ox0.toFixed(2)} ${oy0.toFixed(2)} A ${ro} ${ro} 0 ${large} 1 ${ox1.toFixed(2)} ${oy1.toFixed(2)} ` +
    `L ${ix1.toFixed(2)} ${iy1.toFixed(2)} A ${ri} ${ri} 0 ${large} 0 ${ix0.toFixed(2)} ${iy0.toFixed(2)} Z`;
}

export function pieChart(opts: ChartOptions): string {
  const width = opts.width ?? 820;
  const height = opts.height ?? CHART_CONFIG.pieHeight;
  const { svg: head, top } = header(width, opts);
  const parts: string[] = [open(width, height, opts.theme), head];
  const ink = opts.theme?.foreground ?? INK;
  const muted = opts.theme?.muted ?? MUTED;

  const total = opts.data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const cy = top + (height - top) / 2;
  const ro = Math.min((height - top - CHART_CONFIG.pieRingGap) / 2, CHART_CONFIG.pieOuterRadius);
  const ri = ro * CHART_CONFIG.pieInnerRatio;
  const cx = top + ro + CHART_CONFIG.pieCenterOffset;

  let angle = -Math.PI / 2;
  opts.data.forEach((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const a1 = angle + frac * Math.PI * 2;
    const color = d.color ?? opts.theme?.palette[i % (opts.theme.palette.length || 1)] ?? PALETTE[i % PALETTE.length];
    if (frac > 0) parts.push(`<path d="${ringPath(cx, cy, ro, ri, angle, a1)}" fill="${color}"/>`);
    angle = a1;
  });

  parts.push(text(cx, cy - CHART_CONFIG.pieTotalBaseline, fmt(total, opts.prefix, opts.suffix), { size: CHART_CONFIG.pieTotalSize, weight: 700, color: ink, anchor: 'middle' }));
  parts.push(text(cx, cy + CHART_CONFIG.pieCaptionBaseline, 'total', { size: CHART_CONFIG.pieCaptionSize, color: muted, anchor: 'middle' }));

  const legendX = cx + ro + CHART_CONFIG.pieLegendGap;
  let ly = cy - (opts.data.length * CHART_CONFIG.pieLegendStep) / 2 + CHART_CONFIG.pieLegendTopOffset;
  opts.data.forEach((d, i) => {
    const color = d.color ?? opts.theme?.palette[i % (opts.theme.palette.length || 1)] ?? PALETTE[i % PALETTE.length];
    const pct = ((Math.max(0, d.value) / total) * 100).toFixed(pct100(d.value, total) ? 0 : 1);
    parts.push(`<rect x="${legendX}" y="${ly - CHART_CONFIG.pieLegendSwatchBaseline}" width="${CHART_CONFIG.pieLegendSwatch}" height="${CHART_CONFIG.pieLegendSwatch}" rx="${CHART_CONFIG.pieLegendSwatchRadius}" fill="${color}"/>`);
    parts.push(text(legendX + CHART_CONFIG.pieLegendLabelOffset, ly, truncate(d.label, width - legendX - CHART_CONFIG.pieLegendLabelReserve, CHART_CONFIG.pieLegendLabelSize), { size: CHART_CONFIG.pieLegendLabelSize, color: ink }));
    parts.push(text(width - CHART_CONFIG.pieLegendValueInset, ly, `${fmt(d.value, opts.prefix, opts.suffix)}  ·  ${pct}%`, { size: CHART_CONFIG.pieLegendLabelSize, color: muted, anchor: 'end' }));
    ly += CHART_CONFIG.pieLegendStep;
  });

  parts.push('</svg>');
  return parts.join('');
}

function pct100(v: number, total: number): boolean {
  return Math.abs((v / total) * 100 - Math.round((v / total) * 100)) < 0.05;
}

export function metricCards(opts: MetricOptions): string {
  const width = opts.width ?? CHART_CONFIG.width;
  const { svg: head, top } = header(width, opts);
  const cards = opts.cards;
  const cols = Math.min(opts.columns ?? Math.min(cards.length, CHART_CONFIG.metricColumns), cards.length || 1);
  const rows = Math.ceil(cards.length / cols);

  const padX = CHART_CONFIG.metricPaddingX;
  const gap = CHART_CONFIG.metricGap;
  const cardW = (width - padX * 2 - gap * (cols - 1)) / cols;
  const cardH = CHART_CONFIG.metricHeight;
  const height = top + rows * cardH + (rows - 1) * gap + CHART_CONFIG.metricBottom;

  const parts: string[] = [open(width, height, opts.theme), head];

  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + gap);
    const y = top + row * (cardH + gap);
    const soft = opts.theme?.soft ?? SOFT;
    const line = opts.theme?.line ?? '#e2e8f0';
    const foreground = opts.theme?.foreground ?? INK;
    const muted = opts.theme?.muted ?? MUTED;
    parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="${CHART_CONFIG.metricRadius}" fill="${soft}" stroke="${line}" stroke-width="${CHART_CONFIG.metricLineWidth}"/>`);
    parts.push(text(x + CHART_CONFIG.metricLabelX, y + CHART_CONFIG.metricLabelY, String(c.label).toUpperCase(), { size: CHART_CONFIG.metricLabelSize, color: muted, weight: 600 }));
    parts.push(text(x + CHART_CONFIG.metricLabelX, y + CHART_CONFIG.metricValueY, c.value, { size: CHART_CONFIG.metricValueSize, color: foreground, weight: 700 }));
    if (c.delta) {
      const color = c.trend === 'down' ? opts.theme?.danger ?? BAD : c.trend === 'up' ? opts.theme?.success ?? GOOD : muted;
      const arrow = c.trend === 'down' ? '▼' : c.trend === 'up' ? '▲' : '';
      parts.push(text(x + CHART_CONFIG.metricLabelX, y + CHART_CONFIG.metricDeltaY, `${arrow} ${c.delta}`.trim(), { size: CHART_CONFIG.metricDeltaSize, color, weight: 600 }));
    } else if (c.note) {
      parts.push(text(x + CHART_CONFIG.metricLabelX, y + CHART_CONFIG.metricDeltaY, truncate(c.note, cardW - CHART_CONFIG.metricNoteReserve, CHART_CONFIG.metricNoteSize), { size: CHART_CONFIG.metricNoteSize, color: muted }));
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

export type ChartType = 'bar' | 'line' | 'pie';

export function renderChart(type: ChartType, opts: ChartOptions): string {
  const svg = type === 'line' ? lineChart(opts) : type === 'pie' ? pieChart(opts) : barChart(opts);
  const family = opts.theme?.fontFamily;
  return family ? svg.replaceAll(`font-family="${FONT_FAMILY}"`, `font-family="${family.replaceAll('"', '&quot;')}"`) : svg;
}
