export const FONT_FAMILY = 'DejaVu Sans';

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
  const charW = size * 0.55;
  const max = Math.floor(maxWidth / charW);
  if (text.length <= max) return text;
  if (max <= 1) return '…';
  return text.slice(0, max - 1) + '…';
}

function text(x: number, y: number, content: unknown, opts: { size?: number; color?: string; anchor?: string; weight?: number } = {}): string {
  const size = opts.size ?? 13;
  const color = opts.color ?? INK;
  const anchor = opts.anchor ?? 'start';
  const weight = opts.weight ?? 400;
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-weight="${weight}">${esc(content)}</text>`;
}

function header(width: number, opts: ChartOptions | MetricOptions): { svg: string; top: number } {
  if (!opts.title && !opts.subtitle) return { svg: '', top: 24 };
  const parts: string[] = [];
  let y = 38;
  if (opts.title) {
    parts.push(text(32, y, opts.title, { size: 21, weight: 700 }));
    y += opts.subtitle ? 24 : 0;
  }
  if (opts.subtitle) {
    parts.push(text(32, y, opts.subtitle, { size: 13, color: MUTED }));
  }
  return { svg: parts.join(''), top: y + 28 };
}

function open(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`;
}

export function barChart(opts: ChartOptions): string {
  const width = opts.width ?? 820;
  const height = opts.height ?? 480;
  const { svg: head, top } = header(width, opts);

  const padL = 60;
  const padR = 28;
  const padBottom = 56;
  const plotTop = top;
  const plotLeft = padL;
  const plotW = width - padL - padR;
  const plotH = height - plotTop - padBottom;
  const plotBottom = plotTop + plotH;

  const max = niceCeil(Math.max(0, ...opts.data.map((d) => d.value)));
  const ticks = 4;
  const parts: string[] = [open(width, height), head];

  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = plotBottom - (v / max) * plotH;
    parts.push(`<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotW}" y2="${y}" stroke="${i === 0 ? AXIS : GRID}" stroke-width="1"/>`);
    parts.push(text(plotLeft - 10, y + 4, fmt(v, opts.prefix, opts.suffix), { size: 11, color: MUTED, anchor: 'end' }));
  }

  const n = opts.data.length || 1;
  const slot = plotW / n;
  const barW = Math.min(slot * 0.62, 96);

  opts.data.forEach((d, i) => {
    const cx = plotLeft + i * slot + slot / 2;
    const x = cx - barW / 2;
    const h = max > 0 ? (d.value / max) * plotH : 0;
    const y = plotBottom - h;
    const color = d.color ?? PALETTE[i % PALETTE.length];
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="5" fill="${color}"/>`);
    parts.push(text(cx, y - 8, fmt(d.value, opts.prefix, opts.suffix), { size: 12, weight: 600, anchor: 'middle' }));
    parts.push(text(cx, plotBottom + 20, truncate(d.label, slot - 6, 12), { size: 12, color: MUTED, anchor: 'middle' }));
  });

  parts.push('</svg>');
  return parts.join('');
}

export function lineChart(opts: ChartOptions): string {
  const width = opts.width ?? 820;
  const height = opts.height ?? 480;
  const { svg: head, top } = header(width, opts);

  const padL = 60;
  const padR = 28;
  const padBottom = 56;
  const plotTop = top;
  const plotLeft = padL;
  const plotW = width - padL - padR;
  const plotH = height - plotTop - padBottom;
  const plotBottom = plotTop + plotH;

  const max = niceCeil(Math.max(0, ...opts.data.map((d) => d.value)));
  const ticks = 4;
  const parts: string[] = [open(width, height), head];

  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = plotBottom - (v / max) * plotH;
    parts.push(`<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotW}" y2="${y}" stroke="${i === 0 ? AXIS : GRID}" stroke-width="1"/>`);
    parts.push(text(plotLeft - 10, y + 4, fmt(v, opts.prefix, opts.suffix), { size: 11, color: MUTED, anchor: 'end' }));
  }

  const n = opts.data.length;
  const accent = opts.data[0]?.color ?? PALETTE[0];
  const px = (i: number) => plotLeft + (n <= 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const py = (v: number) => plotBottom - (max > 0 ? (v / max) * plotH : 0);

  const pts = opts.data.map((d, i) => `${px(i).toFixed(1)},${py(d.value).toFixed(1)}`);
  if (pts.length > 0) {
    const area = `M ${px(0).toFixed(1)} ${plotBottom} L ${pts.join(' L ')} L ${px(n - 1).toFixed(1)} ${plotBottom} Z`;
    parts.push(`<path d="${area}" fill="${accent}" fill-opacity="0.12"/>`);
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  }

  opts.data.forEach((d, i) => {
    parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(d.value).toFixed(1)}" r="3.5" fill="#ffffff" stroke="${accent}" stroke-width="2"/>`);
    parts.push(text(px(i), plotBottom + 20, truncate(d.label, plotW / n - 4, 12), { size: 12, color: MUTED, anchor: 'middle' }));
    if (n <= 12) parts.push(text(px(i), py(d.value) - 10, fmt(d.value, opts.prefix, opts.suffix), { size: 11, weight: 600, anchor: 'middle' }));
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
  const height = opts.height ?? 460;
  const { svg: head, top } = header(width, opts);
  const parts: string[] = [open(width, height), head];

  const total = opts.data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1;
  const cy = top + (height - top) / 2;
  const ro = Math.min((height - top - 48) / 2, 150);
  const ri = ro * 0.6;
  const cx = top + ro + 24;

  let angle = -Math.PI / 2;
  opts.data.forEach((d, i) => {
    const frac = Math.max(0, d.value) / total;
    const a1 = angle + frac * Math.PI * 2;
    const color = d.color ?? PALETTE[i % PALETTE.length];
    if (frac > 0) parts.push(`<path d="${ringPath(cx, cy, ro, ri, angle, a1)}" fill="${color}"/>`);
    angle = a1;
  });

  parts.push(text(cx, cy - 4, fmt(total, opts.prefix, opts.suffix), { size: 22, weight: 700, anchor: 'middle' }));
  parts.push(text(cx, cy + 16, 'total', { size: 11, color: MUTED, anchor: 'middle' }));

  const legendX = cx + ro + 36;
  let ly = cy - (opts.data.length * 26) / 2 + 8;
  opts.data.forEach((d, i) => {
    const color = d.color ?? PALETTE[i % PALETTE.length];
    const pct = ((Math.max(0, d.value) / total) * 100).toFixed(pct100(d.value, total) ? 0 : 1);
    parts.push(`<rect x="${legendX}" y="${ly - 10}" width="13" height="13" rx="3" fill="${color}"/>`);
    parts.push(text(legendX + 22, ly, truncate(d.label, width - legendX - 130, 13), { size: 13, color: INK }));
    parts.push(text(width - 28, ly, `${fmt(d.value, opts.prefix, opts.suffix)}  ·  ${pct}%`, { size: 13, color: MUTED, anchor: 'end' }));
    ly += 26;
  });

  parts.push('</svg>');
  return parts.join('');
}

function pct100(v: number, total: number): boolean {
  return Math.abs((v / total) * 100 - Math.round((v / total) * 100)) < 0.05;
}

export function metricCards(opts: MetricOptions): string {
  const width = opts.width ?? 820;
  const { svg: head, top } = header(width, opts);
  const cards = opts.cards;
  const cols = Math.min(opts.columns ?? Math.min(cards.length, 3), cards.length || 1);
  const rows = Math.ceil(cards.length / cols);

  const padX = 32;
  const gap = 16;
  const cardW = (width - padX * 2 - gap * (cols - 1)) / cols;
  const cardH = 112;
  const height = top + rows * cardH + (rows - 1) * gap + 28;

  const parts: string[] = [open(width, height), head];

  cards.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + gap);
    const y = top + row * (cardH + gap);
    parts.push(`<rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="10" fill="${SOFT}" stroke="#e2e8f0" stroke-width="1"/>`);
    parts.push(text(x + 18, y + 28, String(c.label).toUpperCase(), { size: 11, color: MUTED, weight: 600 }));
    parts.push(text(x + 18, y + 66, c.value, { size: 28, weight: 700 }));
    if (c.delta) {
      const color = c.trend === 'down' ? BAD : c.trend === 'up' ? GOOD : MUTED;
      const arrow = c.trend === 'down' ? '▼' : c.trend === 'up' ? '▲' : '';
      parts.push(text(x + 18, y + 92, `${arrow} ${c.delta}`.trim(), { size: 13, color, weight: 600 }));
    } else if (c.note) {
      parts.push(text(x + 18, y + 92, truncate(c.note, cardW - 30, 12), { size: 12, color: MUTED }));
    }
  });

  parts.push('</svg>');
  return parts.join('');
}

export type ChartType = 'bar' | 'line' | 'pie';

export function renderChart(type: ChartType, opts: ChartOptions): string {
  if (type === 'line') return lineChart(opts);
  if (type === 'pie') return pieChart(opts);
  return barChart(opts);
}
