import PptxGenJS from 'pptxgenjs';
import { newPdf, renderSvgToPng } from './render.js';
import { FONT_FAMILY, PALETTE, renderChart, type ChartDatum, type ChartType, type MetricCard } from './svg.js';

export type Slide =
  | { type: 'title'; title: string; subtitle?: string; eyebrow?: string }
  | { type: 'metrics'; title: string; subtitle?: string; metrics: MetricCard[] }
  | { type: 'chart'; title: string; subtitle?: string; chart: { type: ChartType; data: ChartDatum[]; prefix?: string; suffix?: string } }
  | { type: 'table'; title: string; subtitle?: string; head: string[]; body: Array<Array<string | number>> }
  | { type: 'narrative'; title: string; subtitle?: string; body: string; highlights?: string[] }
  | { type: 'conclusions'; title: string; subtitle?: string; items: string[] };

export interface SlideDeck {
  title?: string;
  brand?: string;
  footer?: string;
  slides: Slide[];
}

const WIDTH = 1600;
const HEIGHT = 900;
const INK = '#0f172a';
const MUTED = '#64748b';
const ACCENT = '#2563eb';
const SOFT = '#f8fafc';
const LINE = '#e2e8f0';

function escapeXml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function text(x: number, y: number, value: unknown, size: number, options: { color?: string; weight?: number; anchor?: 'start' | 'middle' | 'end' } = {}): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" fill="${options.color ?? INK}" font-weight="${options.weight ?? 400}" text-anchor="${options.anchor ?? 'start'}">${escapeXml(value)}</text>`;
}

function wrap(value: string, maxChars: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrappedText(x: number, y: number, value: string, size: number, maxChars: number, lineHeight: number, options: { color?: string; weight?: number } = {}): string {
  return wrap(value, maxChars).map((line, index) => text(x, y + index * lineHeight, line, size, options)).join('');
}

function frame(deck: SlideDeck, slide: Slide, index: number): string[] {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`, `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`];
  if (slide.type !== 'title') {
    if (deck.brand) parts.push(text(80, 64, deck.brand.toUpperCase(), 20, { color: ACCENT, weight: 700 }));
    parts.push(text(80, 132, slide.title, 48, { weight: 700 }));
    if (slide.subtitle) parts.push(text(80, 174, slide.subtitle, 23, { color: MUTED }));
    parts.push(`<line x1="80" y1="202" x2="1520" y2="202" stroke="${LINE}" stroke-width="2"/>`);
  }
  parts.push(`<line x1="80" y1="842" x2="1520" y2="842" stroke="${LINE}" stroke-width="2"/>`);
  if (deck.footer) parts.push(text(80, 874, deck.footer, 16, { color: MUTED }));
  parts.push(text(1520, 874, `${index + 1} / ${deck.slides.length}`, 16, { color: MUTED, anchor: 'end' }));
  return parts;
}

async function chartImage(slide: Extract<Slide, { type: 'chart' }>): Promise<string> {
  const svg = renderChart(slide.chart.type, { ...slide.chart, width: 1320, height: 570 });
  const png = await renderSvgToPng(svg, 1320);
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function renderSlideSvg(deck: SlideDeck, slide: Slide, index: number): Promise<string> {
  const parts = frame(deck, slide, index);
  if (slide.type === 'title') {
    if (slide.eyebrow || deck.brand) parts.push(text(800, 250, slide.eyebrow ?? deck.brand?.toUpperCase(), 24, { color: ACCENT, weight: 700, anchor: 'middle' }));
    parts.push(wrappedText(800, 390, slide.title, 66, 38, 78, { weight: 700 }).replaceAll('text-anchor="start"', 'text-anchor="middle"'));
    if (slide.subtitle) parts.push(wrappedText(800, 570, slide.subtitle, 30, 62, 42, { color: MUTED }).replaceAll('text-anchor="start"', 'text-anchor="middle"'));
  } else if (slide.type === 'metrics') {
    const columns = Math.min(3, slide.metrics.length);
    const rows = Math.ceil(slide.metrics.length / columns);
    const gap = 28;
    const cardWidth = (1440 - gap * (columns - 1)) / columns;
    const cardHeight = Math.min(240, (590 - gap * (rows - 1)) / rows);
    slide.metrics.forEach((metric, metricIndex) => {
      const col = metricIndex % columns;
      const row = Math.floor(metricIndex / columns);
      const x = 80 + col * (cardWidth + gap);
      const y = 238 + row * (cardHeight + gap);
      parts.push(`<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="18" fill="${SOFT}" stroke="${LINE}" stroke-width="2"/>`);
      parts.push(text(x + 32, y + 54, metric.label.toUpperCase(), 19, { color: MUTED, weight: 700 }));
      parts.push(text(x + 32, y + 126, metric.value, 48, { weight: 700 }));
      if (metric.delta) parts.push(text(x + 32, y + 178, metric.delta, 23, { color: metric.trend === 'down' ? '#dc2626' : metric.trend === 'up' ? '#16a34a' : MUTED, weight: 700 }));
      if (metric.note) parts.push(text(x + 32, y + cardHeight - 28, metric.note, 18, { color: MUTED }));
    });
  } else if (slide.type === 'chart') {
    parts.push(`<image href="${await chartImage(slide)}" x="140" y="230" width="1320" height="570" preserveAspectRatio="xMidYMid meet"/>`);
  } else if (slide.type === 'table') {
    const columns = slide.head.length;
    const colWidth = 1440 / columns;
    const rows = slide.body.slice(0, 10);
    const rowHeight = Math.min(54, 560 / (rows.length + 1));
    slide.head.forEach((cell, col) => {
      const x = 80 + col * colWidth;
      parts.push(`<rect x="${x}" y="236" width="${colWidth}" height="${rowHeight}" fill="${ACCENT}"/>`);
      parts.push(text(x + 18, 236 + rowHeight * 0.66, cell, 19, { color: '#ffffff', weight: 700 }));
    });
    rows.forEach((row, rowIndex) => row.forEach((cell, col) => {
      const x = 80 + col * colWidth;
      const y = 236 + (rowIndex + 1) * rowHeight;
      parts.push(`<rect x="${x}" y="${y}" width="${colWidth}" height="${rowHeight}" fill="${rowIndex % 2 ? SOFT : '#ffffff'}" stroke="${LINE}" stroke-width="1"/>`);
      parts.push(text(x + 18, y + rowHeight * 0.66, String(cell).slice(0, 46), 18));
    }));
  } else if (slide.type === 'narrative') {
    parts.push(wrappedText(80, 282, slide.body, 29, 88, 42, { color: '#334155' }));
    (slide.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => {
      const y = 580 + itemIndex * 58;
      parts.push(`<circle cx="94" cy="${y - 8}" r="7" fill="${ACCENT}"/>`);
      parts.push(wrappedText(120, y, item, 22, 92, 30, { weight: 700 }));
    });
  } else if (slide.type === 'conclusions') {
    slide.items.slice(0, 7).forEach((item, itemIndex) => {
      const y = 270 + itemIndex * 78;
      parts.push(`<rect x="80" y="${y - 35}" width="48" height="48" rx="12" fill="${PALETTE[itemIndex % PALETTE.length]}"/>`);
      parts.push(text(104, y - 3, itemIndex + 1, 22, { color: '#ffffff', weight: 700, anchor: 'middle' }));
      parts.push(wrappedText(156, y, item, 25, 92, 32, { weight: 600 }));
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

export async function renderSlidesPng(deck: SlideDeck, selectedIndex?: number): Promise<Buffer[]> {
  const indexes = selectedIndex === undefined ? deck.slides.map((_, index) => index) : [selectedIndex];
  return Promise.all(indexes.map(async (index) => {
    const slide = deck.slides[index];
    if (!slide) throw new Error(`Slide index ${index} is outside 0..${deck.slides.length - 1}`);
    return renderSvgToPng(await renderSlideSvg(deck, slide, index), WIDTH);
  }));
}

export async function renderSlidesPdf(deck: SlideDeck): Promise<Buffer> {
  const doc = newPdf('landscape', [225, 400]);
  for (let index = 0; index < deck.slides.length; index++) {
    if (index > 0) doc.addPage([225, 400], 'landscape');
    const png = (await renderSlidesPng(deck, index))[0];
    doc.addImage(`data:image/png;base64,${png.toString('base64')}`, 'PNG', 0, 0, 400, 225);
  }
  return Buffer.from(doc.output('arraybuffer'));
}

function addPptxHeader(pptxSlide: PptxGenJS.Slide, shapeType: PptxGenJS['ShapeType'], deck: SlideDeck, slide: Exclude<Slide, { type: 'title' }>, index: number): void {
  if (deck.brand) pptxSlide.addText(deck.brand.toUpperCase(), { x: 0.67, y: 0.28, w: 5, h: 0.25, fontFace: 'Aptos', fontSize: 10, bold: true, color: '2563EB', margin: 0 });
  pptxSlide.addText(slide.title, { x: 0.67, y: 0.68, w: 12, h: 0.45, fontFace: 'Aptos Display', fontSize: 24, bold: true, color: '0F172A', margin: 0 });
  if (slide.subtitle) pptxSlide.addText(slide.subtitle, { x: 0.67, y: 1.2, w: 12, h: 0.3, fontFace: 'Aptos', fontSize: 12, color: '64748B', margin: 0 });
  pptxSlide.addShape(shapeType.line, { x: 0.67, y: 1.65, w: 12, h: 0, line: { color: 'E2E8F0', width: 1 } });
  pptxSlide.addShape(shapeType.line, { x: 0.67, y: 7.02, w: 12, h: 0, line: { color: 'E2E8F0', width: 1 } });
  if (deck.footer) pptxSlide.addText(deck.footer, { x: 0.67, y: 7.15, w: 9, h: 0.18, fontFace: 'Aptos', fontSize: 8, color: '64748B', margin: 0 });
  pptxSlide.addText(`${index + 1} / ${deck.slides.length}`, { x: 11.7, y: 7.15, w: 1, h: 0.18, fontFace: 'Aptos', fontSize: 8, color: '64748B', align: 'right', margin: 0 });
}

export async function renderSlidesPptx(deck: SlideDeck): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'TreeTank report-baby';
  pptx.subject = deck.title ?? 'Presentation';
  pptx.title = deck.title ?? deck.slides[0]?.title ?? 'Presentation';
  pptx.company = deck.brand ?? 'TreeTank';
  for (let index = 0; index < deck.slides.length; index++) {
    const content = deck.slides[index];
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    if (content.type === 'title') {
      slide.addText(content.eyebrow ?? deck.brand ?? '', { x: 2, y: 1.65, w: 9.33, h: 0.3, fontFace: 'Aptos', fontSize: 12, bold: true, color: '2563EB', align: 'center', margin: 0 });
      slide.addText(content.title, { x: 1.4, y: 2.45, w: 10.53, h: 1.2, fontFace: 'Aptos Display', fontSize: 34, bold: true, color: '0F172A', align: 'center', valign: 'middle', margin: 0.04, breakLine: false });
      if (content.subtitle) slide.addText(content.subtitle, { x: 2, y: 4.1, w: 9.33, h: 0.65, fontFace: 'Aptos', fontSize: 17, color: '64748B', align: 'center', valign: 'middle', margin: 0 });
    } else {
      addPptxHeader(slide, pptx.ShapeType, deck, content, index);
      if (content.type === 'metrics') {
        const cols = Math.min(3, content.metrics.length);
        content.metrics.forEach((metric, metricIndex) => {
          const x = 0.67 + (metricIndex % cols) * (12 / cols);
          const y = 1.95 + Math.floor(metricIndex / cols) * 2.15;
          const w = 11.6 / cols;
          slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 1.78, rectRadius: 0.08, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 } });
          slide.addText(metric.label.toUpperCase(), { x: x + 0.25, y: y + 0.22, w: w - 0.5, h: 0.25, fontFace: 'Aptos', fontSize: 10, bold: true, color: '64748B', margin: 0 });
          slide.addText(String(metric.value), { x: x + 0.25, y: y + 0.65, w: w - 0.5, h: 0.5, fontFace: 'Aptos Display', fontSize: 25, bold: true, color: '0F172A', margin: 0 });
          if (metric.delta ?? metric.note) slide.addText(metric.delta ?? metric.note ?? '', { x: x + 0.25, y: y + 1.28, w: w - 0.5, h: 0.25, fontFace: 'Aptos', fontSize: 11, bold: Boolean(metric.delta), color: metric.trend === 'down' ? 'DC2626' : metric.trend === 'up' ? '16A34A' : '64748B', margin: 0 });
        });
      } else if (content.type === 'chart') {
        slide.addImage({ data: await chartImage(content), x: 1.17, y: 1.85, w: 11, h: 4.75 });
      } else if (content.type === 'table') {
        slide.addTable([content.head, ...content.body.slice(0, 10)].map((row) => row.map((cell) => ({ text: String(cell) }))), { x: 0.67, y: 1.92, w: 12, h: 4.75, border: { type: 'solid', color: 'E2E8F0', pt: 1 }, fontFace: 'Aptos', fontSize: 10, color: '0F172A', fill: { color: 'FFFFFF' }, margin: 0.08, bold: false, rowH: 0.38 });
      } else if (content.type === 'narrative') {
        slide.addText(content.body, { x: 0.67, y: 2.05, w: 12, h: 2.3, fontFace: 'Aptos', fontSize: 16, color: '334155', breakLine: false, valign: 'top', margin: 0 });
        (content.highlights ?? []).slice(0, 4).forEach((item, itemIndex) => slide.addText([{ text: item, options: { bullet: { indent: 14 }, bold: true } }], { x: 0.82, y: 4.65 + itemIndex * 0.48, w: 11.5, h: 0.35, fontFace: 'Aptos', fontSize: 13, color: '0F172A', margin: 0 }));
      } else if (content.type === 'conclusions') {
        content.items.slice(0, 7).forEach((item, itemIndex) => {
          const y = 2.02 + itemIndex * 0.65;
          slide.addShape(pptx.ShapeType.roundRect, { x: 0.67, y, w: 0.4, h: 0.4, rectRadius: 0.04, fill: { color: PALETTE[itemIndex % PALETTE.length].slice(1) }, line: { color: PALETTE[itemIndex % PALETTE.length].slice(1) } });
          slide.addText(String(itemIndex + 1), { x: 0.67, y: y + 0.08, w: 0.4, h: 0.16, fontFace: 'Aptos', fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', margin: 0 });
          slide.addText(item, { x: 1.3, y: y - 0.02, w: 11.2, h: 0.46, fontFace: 'Aptos', fontSize: 14, bold: true, color: '0F172A', margin: 0 });
        });
      }
    }
  }
  return Buffer.from(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer);
}
