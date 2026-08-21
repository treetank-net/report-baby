import type { jsPDF } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { assetDataUri, defaultRenderTheme, type RenderTheme } from './brand.js';
import { readRenderConfig } from './builtin-template-loader.js';
import { loadRenderFontSet, newPdf, pdfFont, readableTextColor, renderSvgToPng } from './render.js';
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

export interface ReportTitlePage {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  period?: string;
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
  title_page?: ReportTitlePage;
}

const RENDER_CONFIG = readRenderConfig();
const PDF_CONFIG = RENDER_CONFIG.pdf;
const PT_TO_PX = RENDER_CONFIG.canvas.width / RENDER_CONFIG.canvas.pptxWidth / RENDER_CONFIG.canvas.pointsPerInch;
const CHART_CONFIG = RENDER_CONFIG.chart;
const PAGE_W = PDF_CONFIG.pageWidth;
const PAGE_H = PDF_CONFIG.pageHeight;
const MARGIN = PDF_CONFIG.margin;
const CONTENT_W = PAGE_W - MARGIN * 2;
const USABLE_H = PAGE_H - MARGIN * 2;

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

class Cursor {
  y = MARGIN;
  constructor(private doc: jsPDF, private pageBackground: string, private onNewPage?: (cursor: Cursor) => void) {
    this.paintPage();
  }
  private paintPage(): void {
    this.doc.setFillColor(...rgb(this.pageBackground));
    this.doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  }
  ensure(height: number): void {
    if (this.y + height > PAGE_H - MARGIN) {
      this.doc.addPage();
      this.paintPage();
      this.y = MARGIN;
      this.onNewPage?.(this);
    }
  }
  keepTogether(blockHeight: number, minLeadHeight: number): void {
    this.ensure(blockHeight <= USABLE_H ? blockHeight : minLeadHeight);
  }
  breakPage(): void {
      this.doc.addPage();
      this.paintPage();
      this.y = MARGIN;
      this.onNewPage?.(this);
  }
}

function drawParagraph(doc: jsPDF, cur: Cursor, lines: string[], lineHeight: number, x = MARGIN): void {
  let remaining = lines;
  while (remaining.length > 0) {
    const fit = Math.max(1, Math.floor((PAGE_H - MARGIN - cur.y) / lineHeight));
    const chunk = remaining.slice(0, fit);
    doc.text(chunk, x, cur.y);
    cur.y += chunk.length * lineHeight;
    remaining = remaining.slice(chunk.length);
    if (remaining.length > 0) cur.breakPage();
  }
}

interface PdfAsset {
  data: string;
  format: 'PNG' | 'JPEG';
}

async function prepareBrandAsset(path: string | undefined, width: number): Promise<PdfAsset | undefined> {
  const uri = await assetDataUri(path);
  if (!uri) return undefined;
  if (uri.startsWith('data:image/svg+xml')) {
    const svg = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf8');
    const png = await renderSvgToPng(svg, Math.round(width * PDF_CONFIG.assetRasterDensity));
    return { data: `data:image/png;base64,${png.toString('base64')}`, format: 'PNG' };
  }
  return { data: uri, format: uri.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG' };
}

function addPreparedBrandAsset(doc: jsPDF, asset: PdfAsset | undefined, x: number, y: number, width: number, height: number): void {
  if (asset) doc.addImage(asset.data, asset.format, x, y, width, height);
}

function addPreparedBrandAssetContain(doc: jsPDF, asset: PdfAsset | undefined, x: number, y: number, width: number, height: number): void {
  if (!asset) return;
  const properties = doc.getImageProperties(asset.data);
  const scale = Math.min(width / properties.width, height / properties.height);
  const renderedWidth = properties.width * scale;
  const renderedHeight = properties.height * scale;
  const renderedX = x + (width - renderedWidth) / 2;
  const renderedY = y + (height - renderedHeight) / 2;
  doc.addImage(asset.data, asset.format, renderedX, renderedY, renderedWidth, renderedHeight);
}

function addPreparedBrandAssetCover(doc: jsPDF, asset: PdfAsset | undefined, x: number, y: number, width: number, height: number): void {
  if (!asset) return;
  const properties = doc.getImageProperties(asset.data);
  const scale = Math.max(width / properties.width, height / properties.height);
  const renderedWidth = properties.width * scale;
  const renderedHeight = properties.height * scale;
  const renderedX = x + (width - renderedWidth) / 2;
  const renderedY = y + (height - renderedHeight) / 2;
  doc.saveGraphicsState();
  doc.rect(x, y, width, height, null);
  doc.clip();
  doc.discardPath();
  doc.addImage(asset.data, asset.format, renderedX, renderedY, renderedWidth, renderedHeight);
  doc.restoreGraphicsState();
}

interface ReportHeaderRenderer {
  drawFirstPage(doc: jsPDF, cur: Cursor): void;
  followingPageHeight(): number;
  drawFollowingPageChrome(doc: jsPDF): void;
  drawFollowingPage(doc: jsPDF, cur: Cursor): void;
}

async function createReportHeader(data: ReportData, theme: RenderTheme): Promise<ReportHeaderRenderer> {
  const font = pdfFont(theme);
  const reportHeaderStyle = theme.reportHeaderStyle;
  const band = reportHeaderStyle === 'accent-band' ? theme.primary : reportHeaderStyle === 'dark-band' ? theme.background : undefined;
  const headerText = band ? readableTextColor(band, theme, PDF_CONFIG.headerTitleSize * PT_TO_PX, true) : reportHeaderStyle === 'image-band' ? theme.imageTextColor : theme.foreground;
  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoMarkPath = theme.logoVariant === 'white' ? theme.logoWhiteMarkPath ?? theme.logoMarkPath : theme.logoMarkPath;
  const logoWidth = logoMarkPath ? PDF_CONFIG.headerLogoMarkWidth : PDF_CONFIG.headerLogoWidth;
  const logoY = PDF_CONFIG.headerLogoY;
  const logoHeight = PDF_CONFIG.headerLogoHeight;
  const title = data.title ?? 'Report';
  const backgroundAsset = reportHeaderStyle === 'image-band'
    ? await prepareBrandAsset(theme.reportHeaderImagePath ?? theme.backgroundImagePath, PAGE_W)
    : undefined;
  const logoAsset = await prepareBrandAsset(logoMarkPath ?? logoPath, logoWidth);

  const drawTopLine = (doc: jsPDF, baseline: number, compact = false): void => {
    const size = compact ? PDF_CONFIG.headerBrandCompactSize : PDF_CONFIG.headerBrandSize;
    if (data.brand && theme.showReportBrandName) {
      doc.setFont(font, 'bold');
      doc.setFontSize(size);
      doc.setTextColor(...rgb(band ? readableTextColor(band, theme, size * PT_TO_PX, true) : reportHeaderStyle === 'image-band' ? theme.imageTextColor : theme.primary));
      doc.text(String(data.brand).toUpperCase(), MARGIN + logoWidth + PDF_CONFIG.headerBrandGap, baseline);
    }
    if (data.period) {
      doc.setFont(font, 'normal');
      doc.setFontSize(compact ? PDF_CONFIG.headerPeriodCompactSize : PDF_CONFIG.headerPeriodSize);
      doc.setTextColor(...rgb(band ? readableTextColor(band, theme, PDF_CONFIG.headerPeriodSize * PT_TO_PX, false) : reportHeaderStyle === 'image-band' ? theme.imageTextColor : theme.muted));
      doc.text(String(data.period), PAGE_W - MARGIN, baseline, { align: 'right' });
    }
  };

  const followingPageHeight = backgroundAsset || band ? PDF_CONFIG.headerRepeatBandHeight : PDF_CONFIG.headerRepeatHeight;

  const drawFollowingPageChrome = (doc: jsPDF): void => {
    if (backgroundAsset) addPreparedBrandAssetCover(doc, backgroundAsset, 0, 0, PAGE_W, followingPageHeight);
    if (band) {
      doc.setFillColor(...rgb(band));
      doc.rect(0, 0, PAGE_W, followingPageHeight, 'F');
    }
    addPreparedBrandAssetContain(doc, logoAsset, MARGIN, PDF_CONFIG.headerRepeatLogoY, logoWidth, PDF_CONFIG.headerRepeatLogoHeight);
    drawTopLine(doc, PDF_CONFIG.headerRepeatTopLineY, true);
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.bodySize);
    doc.setTextColor(...rgb(headerText));
    const repeatedTitle = doc.splitTextToSize(theme.titleCase === 'upper' ? title.toUpperCase() : title, CONTENT_W).slice(0, 1);
    doc.text(repeatedTitle, MARGIN, PDF_CONFIG.headerRepeatTitleY);
    if (!band && reportHeaderStyle !== 'image-band') {
      doc.setDrawColor(...rgb(theme.primary));
      doc.setLineWidth(PDF_CONFIG.headerRepeatRuleWidth);
      doc.line(MARGIN, followingPageHeight, PAGE_W - MARGIN, followingPageHeight);
    }
  };

  return {
    drawFirstPage(doc, cur) {
      if (backgroundAsset) addPreparedBrandAssetCover(doc, backgroundAsset, 0, 0, PAGE_W, PDF_CONFIG.headerBandHeight);
      if (band) {
        doc.setFillColor(...rgb(band));
        doc.rect(0, 0, PAGE_W, PDF_CONFIG.headerBandHeight, 'F');
      }
      addPreparedBrandAssetContain(doc, logoAsset, MARGIN, logoY, logoWidth, logoHeight);
      const lockupBaseline = logoY + logoHeight * PDF_CONFIG.headerLockupBaselineRatio;
      cur.y = band || reportHeaderStyle === 'image-band' ? PDF_CONFIG.headerBandTitleTop : PDF_CONFIG.headerTitleTop;
      const hasTopLine = Boolean((data.brand && theme.showReportBrandName) || data.period);
      drawTopLine(doc, lockupBaseline);
      if (hasTopLine) cur.y += PDF_CONFIG.headerTopLineGap;

      doc.setFont(font, 'bold');
      doc.setFontSize(PDF_CONFIG.headerTitleSize);
      doc.setTextColor(...rgb(headerText));
      const titleLines = doc.splitTextToSize(title, CONTENT_W);
      const titleX = theme.titleAlign === 'center' ? PAGE_W / 2 : MARGIN;
      doc.text(theme.titleCase === 'upper' ? titleLines.map((line: string) => String(line).toUpperCase()) : titleLines, titleX, cur.y + PDF_CONFIG.headerTextBaselineOffset, { align: theme.titleAlign === 'center' ? 'center' : 'left' });
      cur.y += titleLines.length * PDF_CONFIG.headerTitleLineHeight;

      if (data.subtitle) {
        doc.setFont(font, 'normal');
        doc.setFontSize(PDF_CONFIG.headerSubtitleSize);
        doc.setTextColor(...rgb(band ? readableTextColor(band, theme, PDF_CONFIG.headerPeriodSize * PT_TO_PX, false) : reportHeaderStyle === 'image-band' ? theme.imageTextColor : theme.muted));
        const subLines = doc.splitTextToSize(data.subtitle, CONTENT_W);
        doc.text(subLines, MARGIN, cur.y + PDF_CONFIG.headerTextBaselineOffset);
        cur.y += subLines.length * PDF_CONFIG.headerSubtitleLineHeight;
      }
      cur.y += PDF_CONFIG.headerRuleGap;
      if (!band && reportHeaderStyle !== 'image-band') {
        doc.setDrawColor(...rgb(theme.primary));
        doc.setLineWidth(PDF_CONFIG.headerRuleWidth);
        doc.line(MARGIN, cur.y, PAGE_W - MARGIN, cur.y);
      }
      cur.y += PDF_CONFIG.headerBottomGap;
    },
    followingPageHeight() {
      return followingPageHeight;
    },
    drawFollowingPageChrome,
    drawFollowingPage(doc, cur) {
      drawFollowingPageChrome(doc);
      cur.y = followingPageHeight + PDF_CONFIG.headerRepeatBottomGap;
    },
  };
}

function renderIntro(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme): void {
  if (!data.intro) return;
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  doc.setTextColor(...rgb(theme.foreground));
  const lines = doc.splitTextToSize(data.intro, CONTENT_W);
  cur.keepTogether(lines.length * PDF_CONFIG.introLineHeight + PDF_CONFIG.introKeepPadding, PDF_CONFIG.introLineHeight * PDF_CONFIG.introMinLeadLines);
  drawParagraph(doc, cur, lines, PDF_CONFIG.introLineHeight);
  cur.y += PDF_CONFIG.introBottomGap;
}

function renderKpis(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme): void {
  const kpis = data.kpis ?? [];
  if (kpis.length === 0) return;
  const font = pdfFont(theme);
  const cols = Math.min(kpis.length, PDF_CONFIG.kpiColumns);
  const gap = PDF_CONFIG.kpiGap;
  const cardW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cardH = PDF_CONFIG.kpiHeight;
  const rows = Math.ceil(kpis.length / cols);
  cur.ensure(rows * (cardH + gap));

  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (col === 0 && row > 0) cur.y += cardH + gap;
    const x = MARGIN + col * (cardW + gap);
    const y = cur.y;
    doc.setFillColor(...rgb(theme.soft));
    doc.setDrawColor(...rgb(theme.line));
    doc.setLineWidth(PDF_CONFIG.kpiLineWidth);
    doc.roundedRect(x, y, cardW, cardH, PDF_CONFIG.kpiRadius, PDF_CONFIG.kpiRadius, 'FD');
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.kpiLabelSize);
    doc.setTextColor(...rgb(theme.muted));
    doc.text(String(k.label).toUpperCase(), x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiLabelY);
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.kpiValueSize);
    doc.setTextColor(...rgb(theme.foreground));
    doc.text(String(k.value), x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiValueY);
    if (k.delta) {
      const color = k.trend === 'down' ? rgb(theme.danger) : k.trend === 'up' ? rgb(theme.success) : rgb(theme.muted);
      const arrow = k.trend === 'down' ? '▼ ' : k.trend === 'up' ? '▲ ' : '';
      doc.setFont(font, 'bold');
      doc.setFontSize(PDF_CONFIG.kpiDeltaSize);
      doc.setTextColor(...color);
      doc.text(`${arrow}${k.delta}`, x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiDeltaY);
    } else if (k.note) {
      doc.setFont(font, 'normal');
      doc.setFontSize(PDF_CONFIG.kpiNoteSize);
      doc.setTextColor(...rgb(theme.muted));
      doc.text(doc.splitTextToSize(k.note, cardW - PDF_CONFIG.kpiPadding * 2)[0], x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiDeltaY);
    }
  });
  cur.y += cardH + PDF_CONFIG.kpiBottomGap;
}

async function renderCharts(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme): Promise<void> {
  const fontSet = await loadRenderFontSet(theme);
  for (const chart of data.charts ?? []) {
    const svg = renderChart(chart.type, {
      title: chart.title,
      subtitle: chart.subtitle,
      prefix: chart.prefix,
      suffix: chart.suffix,
      data: chart.data.map((datum, index) => ({ ...datum, color: datum.color ?? theme.palette[index % theme.palette.length] })),
      theme,
    });
    const png = await renderSvgToPng(svg, CHART_CONFIG.renderWidth, fontSet);
    const pxW = png.readUInt32BE(16);
    const pxH = png.readUInt32BE(20);
    const h = (pxH / pxW) * CONTENT_W;
    cur.ensure(h + PDF_CONFIG.chartKeepPadding);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    doc.addImage(dataUrl, 'PNG', MARGIN, cur.y, CONTENT_W, h);
    cur.y += h + PDF_CONFIG.chartBottomGap;
  }
}

function renderSections(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme): void {
  const font = pdfFont(theme);
  for (const s of data.sections ?? []) {
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
    const headingLines = doc.splitTextToSize(s.heading, CONTENT_W);
    const headingH = headingLines.length * PDF_CONFIG.sectionHeadingLineHeight;
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.bodySize);
    const bodyLines = doc.splitTextToSize(s.body, CONTENT_W);
    cur.keepTogether(headingH + PDF_CONFIG.sectionHeadingGap + bodyLines.length * PDF_CONFIG.bodyLineHeight, headingH + PDF_CONFIG.sectionHeadingGap + PDF_CONFIG.sectionMinLeadLines * PDF_CONFIG.bodyLineHeight);
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
    doc.setTextColor(...rgb(theme.foreground));
    doc.text(headingLines, MARGIN, cur.y);
    cur.y += headingH;
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.bodySize);
    doc.setTextColor(...rgb(theme.foreground));
    drawParagraph(doc, cur, bodyLines, PDF_CONFIG.bodyLineHeight);
    cur.y += PDF_CONFIG.sectionBottomGap;
  }
}

function renderTable(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, header: ReportHeaderRenderer): void {
  if (!data.table) return;
  const font = pdfFont(theme);
  const firstRowsH = PDF_CONFIG.tableCaptionHeight;
  if (data.table.caption) {
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
    doc.setTextColor(...rgb(theme.foreground));
    cur.ensure(PDF_CONFIG.tableCaptionGap + firstRowsH);
    doc.text(data.table.caption, MARGIN, cur.y);
    cur.y += PDF_CONFIG.tableCaptionBottomGap;
  } else {
    cur.ensure(firstRowsH);
  }
  const tableInitialPage = doc.getNumberOfPages();
  const tableOptions: UserOptions = {
    head: [data.table.head],
    body: data.table.body.map((r) => r.map((c) => String(c))),
    startY: cur.y + PDF_CONFIG.tableStartOffset,
    margin: { top: header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap, left: MARGIN, right: MARGIN },
    styles: { font, fontSize: PDF_CONFIG.tableFontSize, cellPadding: PDF_CONFIG.tableCellPadding, textColor: rgb(theme.foreground), fillColor: rgb(theme.background), lineColor: rgb(theme.line), lineWidth: PDF_CONFIG.tableLineWidth },
    headStyles: { font, fontStyle: 'bold', fillColor: rgb(theme.primary), textColor: rgb(readableTextColor(theme.primary, theme, PDF_CONFIG.tableFontSize * PT_TO_PX, true)) },
    alternateRowStyles: { fillColor: rgb(theme.soft) },
    willDrawPage: ({ doc: pageDoc, pageNumber }) => {
      const documentPage = pageDoc.getNumberOfPages();
      if (documentPage > tableInitialPage) {
        pageDoc.setFillColor(...rgb(theme.background));
        pageDoc.rect(0, 0, PAGE_W, PAGE_H, 'F');
        if (documentPage > 1 || pageNumber > 1) header.drawFollowingPageChrome(pageDoc);
      }
    },
  };
  (doc as jsPDF & { autoTable: (options: UserOptions) => void }).autoTable(tableOptions);
  cur.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + PDF_CONFIG.tableBottomGap;
}

function renderHighlights(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme): void {
  const highlights = data.highlights ?? [];
  if (highlights.length === 0) return;
  const font = pdfFont(theme);
  doc.setFont(font, 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  const firstLines = doc.splitTextToSize(highlights[0], CONTENT_W - PDF_CONFIG.highlightIndent);
  doc.setFont(font, 'bold');
  doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
  doc.setTextColor(...rgb(theme.foreground));
  cur.ensure(PDF_CONFIG.highlightsHeadingGap + firstLines.length * PDF_CONFIG.bodyLineHeight + PDF_CONFIG.highlightLineGap);
  doc.text('Highlights', MARGIN, cur.y);
  cur.y += PDF_CONFIG.highlightsHeadingHeight;
  doc.setFont(font, 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  doc.setTextColor(...rgb(theme.foreground));
  for (const h of highlights) {
    const lines = doc.splitTextToSize(h, CONTENT_W - PDF_CONFIG.highlightIndent);
    cur.ensure(lines.length * PDF_CONFIG.bodyLineHeight + PDF_CONFIG.highlightLineGap);
    doc.setFillColor(...rgb(theme.primary));
    doc.circle(MARGIN + PDF_CONFIG.highlightBulletX, cur.y - PDF_CONFIG.highlightBulletY, PDF_CONFIG.highlightBulletRadius, 'F');
    doc.text(lines, MARGIN + PDF_CONFIG.highlightIndent, cur.y);
    cur.y += lines.length * PDF_CONFIG.bodyLineHeight + PDF_CONFIG.highlightLineGap;
  }
  cur.y += PDF_CONFIG.highlightsBottomGap;
}

function renderFooter(doc: jsPDF, data: ReportData, theme: RenderTheme): void {
  const font = pdfFont(theme);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const coverPage = Boolean(data.title_page && p === 1);
    const footerLine = coverPage ? theme.titleSubtitleColor : theme.line;
    const footerText = coverPage ? theme.titleSubtitleColor : theme.muted;
    doc.setDrawColor(...rgb(footerLine));
    doc.setLineWidth(PDF_CONFIG.footerLineWidth);
    doc.line(MARGIN, PDF_CONFIG.footerY, PAGE_W - MARGIN, PDF_CONFIG.footerY);
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.footerFontSize);
    doc.setTextColor(...rgb(footerText));
    if (data.footer) doc.text(String(data.footer), MARGIN, PDF_CONFIG.footerTextY);
    doc.text(`${p} / ${pages}`, PAGE_W - MARGIN, PDF_CONFIG.footerTextY, { align: 'right' });
  }
}

async function renderTitlePage(doc: jsPDF, data: ReportData, theme: RenderTheme): Promise<void> {
  const page = data.title_page;
  if (!page) return;
  const font = pdfFont(theme);
  const backgroundAsset = await prepareBrandAsset(theme.coverImagePath, PAGE_W);
  const coverBand = theme.headerStyle === 'accent-band' ? theme.primary : theme.headerStyle === 'dark-band' ? theme.background : undefined;
  const hasGraphic = Boolean(backgroundAsset) || Boolean(coverBand) || Boolean(theme.coverBackground);
  doc.setFillColor(...rgb(theme.coverBackground ?? coverBand ?? theme.background));
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  if (backgroundAsset) addPreparedBrandAssetCover(doc, backgroundAsset, 0, 0, PAGE_W, PAGE_H);
  if (theme.imageScrim) {
    doc.setFillColor(...rgb(theme.imageScrim.color));
    doc.setGState?.(new (doc as unknown as { GState: new (options: { opacity: number }) => unknown }).GState({ opacity: theme.imageScrim.opacity }));
    doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
    doc.setGState?.(new (doc as unknown as { GState: new (options: { opacity: number }) => unknown }).GState({ opacity: 1 }));
  }

  const logoPath = theme.logoVariant === 'white' ? theme.logoWhitePath ?? theme.logoPath : theme.logoPath;
  const logoAsset = await prepareBrandAsset(logoPath, PDF_CONFIG.titleLogoWidth);
  if (logoAsset) addPreparedBrandAssetContain(doc, logoAsset, PAGE_W - MARGIN - PDF_CONFIG.titleLogoWidth, PDF_CONFIG.titleLogoY, PDF_CONFIG.titleLogoWidth, PDF_CONFIG.titleLogoHeight);
  if (page.period) {
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.titlePeriodSize);
    doc.setTextColor(...rgb(hasGraphic ? theme.titleSubtitleColor : theme.muted));
    doc.text(page.period, PAGE_W - MARGIN, PDF_CONFIG.titlePeriodY, { align: 'right' });
  }

  const x = theme.titleAlign === 'center' ? PAGE_W / 2 : MARGIN;
  let y = PDF_CONFIG.titleY;
  if (page.eyebrow) {
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.titleEyebrowSize);
    doc.setTextColor(...rgb(hasGraphic ? theme.titleAccentColor : theme.primary));
    doc.text(page.eyebrow.toUpperCase(), x, y, { align: theme.titleAlign === 'center' ? 'center' : 'left' });
    y += PDF_CONFIG.titleEyebrowLineHeight;
  }
  if (page.title) {
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.titleSize);
    doc.setTextColor(...rgb(hasGraphic ? theme.titleColor : theme.foreground));
    const titleLines = doc.splitTextToSize(page.title, CONTENT_W);
    doc.text(titleLines, x, y, { align: theme.titleAlign === 'center' ? 'center' : 'left' });
    y += titleLines.length * PDF_CONFIG.titleLineHeight + PDF_CONFIG.titleBottomGap;
  }
  if (page.subtitle) {
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.titleSubtitleSize);
    doc.setTextColor(...rgb(hasGraphic ? theme.titleSubtitleColor : theme.muted));
    const subtitleLines = doc.splitTextToSize(page.subtitle, CONTENT_W);
    doc.text(subtitleLines, x, y, { align: theme.titleAlign === 'center' ? 'center' : 'left' });
  }
}

export async function renderReportPdf(name: string, data: ReportData, theme = defaultRenderTheme()): Promise<Buffer> {
  const resolved = resolveTemplate(name, data);
  const fontSet = await loadRenderFontSet(theme);
  const doc = newPdf('portrait', 'a4', fontSet);
  const header = await createReportHeader(resolved, theme);
  const cur = new Cursor(doc, theme.background, (cursor) => header.drawFollowingPage(doc, cursor));
  if (resolved.title_page) {
    await renderTitlePage(doc, resolved, theme);
    cur.breakPage();
  } else {
    header.drawFirstPage(doc, cur);
  }
  renderIntro(doc, cur, resolved, theme);
  renderKpis(doc, cur, resolved, theme);
  await renderCharts(doc, cur, resolved, theme);
  renderSections(doc, cur, resolved, theme);
  renderTable(doc, cur, resolved, theme, header);
  renderHighlights(doc, cur, resolved, theme);
  renderFooter(doc, resolved, theme);
  return Buffer.from(doc.output('arraybuffer'));
}

function resolveTemplate(name: string, data: ReportData): ReportData {
  const templateName = name.split('/').filter(Boolean).at(-1) ?? name;
  if (templateName === 'default-report') return data;
  if (templateName === 'campaign-summary') {
    return {
      ...data,
      title: data.title ?? 'Campaign summary',
      subtitle: data.subtitle ?? 'Performance snapshot and next actions',
    };
  }
  throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((t) => t.name).join(', ')}`);
}
