import type { jsPDF } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { newPdf, pdfFont, renderSvgToPng } from './render.js';
import { renderChart, type ChartDatum, type ChartType } from './svg.js';

export interface TemplateInfo {
  name: string;
  description: string;
}

const TEMPLATES: TemplateInfo[] = [
  {
    name: 'default-report',
    description: 'Client-facing report: branded header, KPI grid, embedded charts, narrative sections, data table, highlights, footer. Multi-page A4 PDF.',
  },
  {
    name: 'campaign-summary',
    description: 'Compact paid-media / analytics snapshot: title defaults to "Campaign summary", same building blocks as default-report.',
  },
];

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES;
}

export interface ReportChart {
  type: ChartType;
  title?: string;
  subtitle?: string;
  prefix?: string;
  suffix?: string;
  data: ChartDatum[];
}

export interface ReportData {
  title?: string;
  subtitle?: string;
  brand?: string;
  period?: string;
  intro?: string;
  kpis?: Array<{ label: string; value: string | number; delta?: string; trend?: 'up' | 'down' | 'flat'; note?: string }>;
  charts?: ReportChart[];
  sections?: Array<{ heading: string; body: string }>;
  table?: { head: string[]; body: Array<Array<string | number>>; caption?: string };
  highlights?: string[];
  footer?: string;
}

const ACCENT: [number, number, number] = [37, 99, 235];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const LINE: [number, number, number] = [226, 232, 240];
const SOFT: [number, number, number] = [248, 250, 252];
const GOOD: [number, number, number] = [22, 163, 74];
const BAD: [number, number, number] = [220, 38, 38];

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 18;
const CONTENT_W = PAGE_W - MARGIN * 2;

class Cursor {
  y = MARGIN;
  constructor(private doc: jsPDF) {}
  ensure(height: number): void {
    if (this.y + height > PAGE_H - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }
}

function renderHeader(doc: jsPDF, cur: Cursor, data: ReportData): void {
  const font = pdfFont();
  let hasTopLine = false;
  if (data.brand) {
    doc.setFont(font, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...ACCENT);
    doc.text(String(data.brand).toUpperCase(), MARGIN, cur.y);
    hasTopLine = true;
  }
  if (data.period) {
    doc.setFont(font, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    doc.text(String(data.period), PAGE_W - MARGIN, cur.y, { align: 'right' });
    hasTopLine = true;
  }
  if (hasTopLine) cur.y += 9;

  doc.setFont(font, 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  const title = data.title ?? 'Report';
  const titleLines = doc.splitTextToSize(title, CONTENT_W);
  doc.text(titleLines, MARGIN, cur.y + 2);
  cur.y += titleLines.length * 9;

  if (data.subtitle) {
    doc.setFont(font, 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...MUTED);
    const subLines = doc.splitTextToSize(data.subtitle, CONTENT_W);
    doc.text(subLines, MARGIN, cur.y + 2);
    cur.y += subLines.length * 5.5;
  }
  cur.y += 4;
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, cur.y, PAGE_W - MARGIN, cur.y);
  cur.y += 10;
}

function renderIntro(doc: jsPDF, cur: Cursor, data: ReportData): void {
  if (!data.intro) return;
  doc.setFont(pdfFont(), 'normal');
  doc.setFontSize(11);
  doc.setTextColor(51, 65, 85);
  const lines = doc.splitTextToSize(data.intro, CONTENT_W);
  cur.ensure(lines.length * 5.2 + 6);
  doc.text(lines, MARGIN, cur.y);
  cur.y += lines.length * 5.2 + 8;
}

function renderKpis(doc: jsPDF, cur: Cursor, data: ReportData): void {
  const kpis = data.kpis ?? [];
  if (kpis.length === 0) return;
  const font = pdfFont();
  const cols = Math.min(kpis.length, 3);
  const gap = 5;
  const cardW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cardH = 26;
  const rows = Math.ceil(kpis.length / cols);
  cur.ensure(rows * (cardH + gap));

  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (col === 0 && row > 0) cur.y += cardH + gap;
    const x = MARGIN + col * (cardW + gap);
    const y = cur.y;
    doc.setFillColor(...SOFT);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
    doc.setFont(font, 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(String(k.label).toUpperCase(), x + 5, y + 7);
    doc.setFont(font, 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(String(k.value), x + 5, y + 16);
    if (k.delta) {
      const color = k.trend === 'down' ? BAD : k.trend === 'up' ? GOOD : MUTED;
      const arrow = k.trend === 'down' ? '▼ ' : k.trend === 'up' ? '▲ ' : '';
      doc.setFont(font, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...color);
      doc.text(`${arrow}${k.delta}`, x + 5, y + 22);
    } else if (k.note) {
      doc.setFont(font, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(k.note, cardW - 9)[0], x + 5, y + 22);
    }
  });
  cur.y += cardH + 12;
}

async function renderCharts(doc: jsPDF, cur: Cursor, data: ReportData): Promise<void> {
  for (const chart of data.charts ?? []) {
    const svg = renderChart(chart.type, {
      title: chart.title,
      subtitle: chart.subtitle,
      prefix: chart.prefix,
      suffix: chart.suffix,
      data: chart.data,
    });
    const png = await renderSvgToPng(svg, 1400);
    const pxW = png.readUInt32BE(16);
    const pxH = png.readUInt32BE(20);
    const h = (pxH / pxW) * CONTENT_W;
    cur.ensure(h + 8);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    doc.addImage(dataUrl, 'PNG', MARGIN, cur.y, CONTENT_W, h);
    cur.y += h + 10;
  }
}

function renderSections(doc: jsPDF, cur: Cursor, data: ReportData): void {
  const font = pdfFont();
  for (const s of data.sections ?? []) {
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    const bodyLines = doc.splitTextToSize(s.body, CONTENT_W);
    cur.ensure(8 + bodyLines.length * 5);
    doc.setTextColor(...INK);
    doc.text(s.heading, MARGIN, cur.y);
    cur.y += 6;
    doc.setFont(font, 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(51, 65, 85);
    doc.text(bodyLines, MARGIN, cur.y);
    cur.y += bodyLines.length * 5 + 6;
  }
}

function renderTable(doc: jsPDF, cur: Cursor, data: ReportData): void {
  if (!data.table) return;
  const font = pdfFont();
  if (data.table.caption) {
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    cur.ensure(10);
    doc.text(data.table.caption, MARGIN, cur.y);
    cur.y += 4;
  }
  const tableOptions: UserOptions = {
    head: [data.table.head],
    body: data.table.body.map((r) => r.map((c) => String(c))),
    startY: cur.y + 2,
    margin: { left: MARGIN, right: MARGIN },
    styles: { font, fontSize: 9, cellPadding: 2.5, textColor: INK, lineColor: LINE, lineWidth: 0.2 },
    headStyles: { font, fontStyle: 'bold', fillColor: ACCENT, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: SOFT },
  };
  (doc as jsPDF & { autoTable: (options: UserOptions) => void }).autoTable(tableOptions);
  cur.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
}

function renderHighlights(doc: jsPDF, cur: Cursor, data: ReportData): void {
  const highlights = data.highlights ?? [];
  if (highlights.length === 0) return;
  const font = pdfFont();
  doc.setFont(font, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  cur.ensure(10);
  doc.text('Highlights', MARGIN, cur.y);
  cur.y += 6;
  doc.setFont(font, 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(51, 65, 85);
  for (const h of highlights) {
    const lines = doc.splitTextToSize(h, CONTENT_W - 6);
    cur.ensure(lines.length * 5 + 2);
    doc.setFillColor(...ACCENT);
    doc.circle(MARGIN + 1.2, cur.y - 1.4, 0.9, 'F');
    doc.text(lines, MARGIN + 6, cur.y);
    cur.y += lines.length * 5 + 2;
  }
  cur.y += 6;
}

function renderFooter(doc: jsPDF, data: ReportData): void {
  const font = pdfFont();
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
    doc.setFont(font, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    if (data.footer) doc.text(String(data.footer), MARGIN, PAGE_H - 7);
    doc.text(`${p} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
  }
}

export async function renderReportPdf(name: string, data: ReportData): Promise<Buffer> {
  const resolved = resolveTemplate(name, data);
  const doc = newPdf('portrait');
  const cur = new Cursor(doc);
  renderHeader(doc, cur, resolved);
  renderIntro(doc, cur, resolved);
  renderKpis(doc, cur, resolved);
  await renderCharts(doc, cur, resolved);
  renderSections(doc, cur, resolved);
  renderTable(doc, cur, resolved);
  renderHighlights(doc, cur, resolved);
  renderFooter(doc, resolved);
  return Buffer.from(doc.output('arraybuffer'));
}

function resolveTemplate(name: string, data: ReportData): ReportData {
  if (name === 'default-report') return data;
  if (name === 'campaign-summary') {
    return {
      ...data,
      title: data.title ?? 'Campaign summary',
      subtitle: data.subtitle ?? 'Performance snapshot and next actions',
    };
  }
  throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((t) => t.name).join(', ')}`);
}
