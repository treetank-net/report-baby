import type { jsPDF } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { statSync } from 'node:fs';
import { assetDataUri, defaultRenderTheme } from './brand-context.js';
import { readBuiltinPageTemplateSource, readRenderConfig } from './builtin-template-source.js';
import type { RenderTheme } from './core/model/render-theme.js';
import { pageGeometryFromTemplate, type PageGeometry, type PageSegment } from './page-geometry.js';
import { loadRenderFontSet, newPdf, pdfFont, readableTextColor, renderSvgToPng, type RenderFontSet } from './render-primitives.js';
import { compileTemplateSource, type CompiledTemplate } from './template-contract.js';
import {
  drawStyledLine,
  fontCoverage,
  layoutStyledText,
  FALLBACK_FAMILY,
  LITERAL_MARKUP_WARNING,
  missingCodePoints,
  stripInlineMarkup,
  tableFallbackWarning,
  splitUncovered,
  styledLineWidth,
  styledRuns,
  wrapStyledRuns,
  breakStyledParagraph,
  type StyledRun,
  type StyledTextContext,
} from './text-runs.js';
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
  {
    name: 'pages/editorial-two-column',
    description: 'Configurable editorial A4 page: two explicit columns, template-owned gutter and reserved header/footer bands.',
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
  sections?: Array<{ heading: string; body: string; level?: 1 | 2 }>;
  table?: { head: string[]; body: Array<Array<string | number>>; caption?: string };
  highlights?: string[];
  highlights_title?: string;
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
const PT_TO_MM = 25.4 / 72;

const DEFAULT_PAGE_GEOMETRY: PageGeometry = {
  width: PAGE_W,
  height: PAGE_H,
  margin: MARGIN,
  margins: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
  content: { x: MARGIN, top: MARGIN, width: CONTENT_W, bottom: PAGE_H - MARGIN },
  segments: [{ x: MARGIN, top: MARGIN, width: CONTENT_W, bottom: PAGE_H - MARGIN }],
  blockFrames: {},
  flow: { align: 'left', hyphenate: false },
  dynamicFlow: false,
};

interface PdfGaps {
  introBottomGap: number;
  kpiBottomGap: number;
  sectionBottomGap: number;
  sectionChapterTopGap: number;
  highlightLineGap: number;
  highlightsBottomGap: number;
}

function pdfGaps(factor = 1): PdfGaps {
  return {
    introBottomGap: PDF_CONFIG.introBottomGap * factor,
    kpiBottomGap: PDF_CONFIG.kpiBottomGap * factor,
    sectionBottomGap: PDF_CONFIG.sectionBottomGap * factor,
    sectionChapterTopGap: PDF_CONFIG.sectionChapterTopGap * factor,
    highlightLineGap: PDF_CONFIG.highlightLineGap * factor,
    highlightsBottomGap: PDF_CONFIG.highlightsBottomGap * factor,
  };
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(normalized, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

class Cursor {
  private segment: PageSegment;
  private segmentIndex = 0;
  private activeBlockName: string | undefined;
  private readonly baseSegments: PageSegment[];
  constructor(private doc: jsPDF, private pageBackground: string, private onNewPage?: (cursor: Cursor) => void, private geometry = DEFAULT_PAGE_GEOMETRY) {
    this.baseSegments = geometry.segments.map((segment) => ({ ...segment }));
    this.segment = { ...geometry.content };
    this.paintPage();
  }
  get x(): number { return this.segment.x; }
  get y(): number { return this.segment.top; }
  set y(value: number) { this.segment.top = value; }
  get width(): number { return this.segment.width; }
  get bottom(): number { return this.segment.bottom; }
  get flow(): PageGeometry['flow'] { return this.geometry.flow; }
  get dynamicFlow(): boolean { return this.geometry.dynamicFlow; }
  block(name: string): PageSegment | undefined { return this.geometry.blockFrames[name]; }
  moveTo(segment: PageSegment): void { this.segment = { ...segment }; }
  activateBlock(name: string, minimumTop?: number): void {
    const frame = this.geometry.blockFrames[name];
    if (!frame) return;
    const top = minimumTop === undefined ? frame.top : Math.max(frame.top, minimumTop);
    const segments = this.baseSegments
      .filter((segment) => segment.x < frame.x + frame.width && segment.x + segment.width > frame.x)
      .map((segment) => ({
        x: Math.max(segment.x, frame.x),
        top: Math.max(segment.top, top),
        width: Math.min(segment.x + segment.width, frame.x + frame.width) - Math.max(segment.x, frame.x),
        // The frame defines where the block starts. The footer text baseline
        // is the usable end of the narrative flow, so this keeps dynamic
        // columns from ending at the narrative frame's nominal height.
        bottom: Math.min(PDF_CONFIG.footerTextY, this.geometry.height),
      }))
      .filter((segment) => segment.width > 0 && segment.bottom > segment.top);
    if (segments.length === 0) return;
    this.activeBlockName = name;
    this.geometry.segments = segments;
    this.segmentIndex = 0;
    this.segment = { ...segments[0] };
  }
  setFlowTop(top: number): void {
    if (this.geometry.segments.length <= 1) return;
    const nextTop = Math.max(top, this.geometry.segments[0]?.top ?? top);
    this.geometry.segments = this.geometry.segments.map((segment) => ({ ...segment, top: nextTop }));
    this.segment = { ...this.geometry.segments[this.segmentIndex] };
  }
  flowFrom(top: number): void {
    this.activeBlockName = undefined;
    this.geometry.segments = this.baseSegments.map((segment) => ({ ...segment }));
    this.segmentIndex = 0;
    this.setFlowTop(top);
  }
  releaseBlock(): void {
    const currentTop = this.y;
    const currentIndex = this.segmentIndex;
    const flowTop = this.geometry.segments[0]?.top ?? currentTop;
    this.activeBlockName = undefined;
    this.geometry.segments = this.baseSegments
      .map((segment) => ({
        ...segment,
        top: Math.max(segment.top, flowTop),
        bottom: this.dynamicFlow ? Math.min(PDF_CONFIG.footerTextY, this.geometry.height) : segment.bottom,
      }))
      .filter((segment) => segment.bottom > segment.top);
    this.segmentIndex = Math.min(currentIndex, Math.max(0, this.geometry.segments.length - 1));
    const segment = this.geometry.segments[this.segmentIndex] ?? this.geometry.content;
    this.segment = { ...segment, top: Math.max(segment.top, currentTop) };
  }
  private resetSegments(): void {
    this.segmentIndex = 0;
    this.geometry.segments = this.baseSegments
      .map((segment) => ({
        ...segment,
        bottom: this.dynamicFlow ? Math.min(PDF_CONFIG.footerTextY, this.geometry.height) : segment.bottom,
      }))
      .filter((segment) => segment.bottom > segment.top);
    this.segment = { ...(this.geometry.segments[0] ?? this.geometry.content) };
  }
  flowBreak(): void {
    if (this.segmentIndex + 1 < this.geometry.segments.length) {
      this.segmentIndex += 1;
      this.segment = { ...this.geometry.segments[this.segmentIndex] };
      return;
    }
    this.breakPage();
  }
  private paintPage(): void {
    this.doc.setFillColor(...rgb(this.pageBackground));
    this.doc.rect(0, 0, this.geometry.width, this.geometry.height, 'F');
  }
  ensure(height: number): void {
    if (this.y + height > this.bottom) {
      this.flowBreak();
    }
  }
  keepTogether(blockHeight: number, minLeadHeight: number): void {
    const remaining = this.bottom - this.y;
    if (blockHeight <= remaining) return;
    const usableHeight = Math.max(...this.geometry.segments.map((segment) => segment.bottom - segment.top));
    const cannotFitOnAnyPage = blockHeight > usableHeight;
    const leavesUsableSpaceBehind = remaining >= minLeadHeight && remaining / usableHeight >= PDF_CONFIG.keepTogetherWasteRatio;
    this.ensure(cannotFitOnAnyPage || leavesUsableSpaceBehind ? minLeadHeight : blockHeight);
  }
  breakPage(): void {
    const activeBlockName = this.activeBlockName;
    this.doc.addPage();
    this.paintPage();
    this.resetSegments();
    this.onNewPage?.(this);
    if (activeBlockName) this.activateBlock(activeBlockName, this.y);
    else this.setFlowTop(this.y);
  }
}

function boldRuns(runs: StyledRun[]): StyledRun[] {
  return runs.map((run) => ({ ...run, bold: true }));
}

function drawStyledLines(doc: jsPDF, lines: StyledRun[][], x: number, y: number, lineHeight: number, text: StyledTextContext): void {
  lines.forEach((line, index) => drawStyledLine(doc, line, x, y + index * lineHeight, text));
}

function lineHasInk(line: StyledRun[]): boolean {
  return line.some((run) => run.text.trim().length > 0);
}

function splitWithoutWidows(lines: StyledRun[][], available: number): number {
  if (available >= lines.length) return lines.length;
  const ink = lines.map(lineHasInk);
  const inkAfter = (from: number): number => ink.slice(from).filter(Boolean).length;
  const inkBefore = (to: number): number => ink.slice(0, to).filter(Boolean).length;
  for (let take = available; take > 0; take -= 1) {
    if (!ink[take]) continue;
    if (inkAfter(take) < PDF_CONFIG.widowMinLines) continue;
    if (inkBefore(take) < PDF_CONFIG.orphanMinLines) continue;
    return take;
  }
  return 0;
}

function drawJustifiedLine(doc: jsPDF, line: StyledRun[], x: number, y: number, width: number, text: StyledTextContext): void {
  const gaps = line.reduce((count, run) => count + (run.text.match(/\s/g)?.length ?? 0), 0);
  const naturalWidth = styledLineWidth(doc, line, text);
  if (gaps === 0 || naturalWidth >= width) {
    drawStyledLine(doc, line, x, y, text);
    return;
  }
  const extra = (width - naturalWidth) / gaps;
  let cursor = x;
  for (const run of line) {
    const pieces = run.text.split(/(\s+)/).filter(Boolean);
    for (const piece of pieces) {
      applyFontForRun(doc, run, text);
      doc.text(piece, cursor, y);
      cursor += doc.getTextWidth(piece) + (/^\s+$/.test(piece) ? extra : 0);
    }
  }
}

function applyFontForRun(doc: jsPDF, run: StyledRun, text: StyledTextContext): void {
  const family = run.fallback ? FALLBACK_FAMILY : text.family;
  doc.setFont(family, run.bold ? 'bold' : 'normal');
}

function drawParagraph(doc: jsPDF, cur: Cursor, lines: StyledRun[][], lineHeight: number, text: StyledTextContext, x?: number): void {
  let remaining = lines;
  let brokeWithoutProgress = false;
  while (remaining.length > 0) {
    const available = Math.floor((cur.bottom - cur.y) / lineHeight);
    const take = brokeWithoutProgress ? Math.max(1, Math.min(available, remaining.length)) : splitWithoutWidows(remaining, available);
    if (take <= 0) {
      cur.flowBreak();
      brokeWithoutProgress = true;
      continue;
    }
    brokeWithoutProgress = false;
    const chunk = remaining.slice(0, take);
    chunk.forEach((line, index) => {
      const isFinalLine = remaining.length === chunk.length && index === chunk.length - 1;
      if (cur.flow.align === 'justify' && !isFinalLine) drawJustifiedLine(doc, line, x ?? cur.x, cur.y + index * lineHeight, cur.width, text);
      else drawStyledLine(doc, line, x ?? cur.x, cur.y + index * lineHeight, text);
    });
    cur.y += chunk.length * lineHeight;
    remaining = remaining.slice(chunk.length);
    if (remaining.length > 0) cur.flowBreak();
  }
}

function drawDynamicParagraph(doc: jsPDF, cur: Cursor, content: string, lineHeight: number, text: StyledTextContext): void {
  const runs = styledRuns(content, text);
  let startNode = 0;
  let brokeWithoutProgress = false;
  while (true) {
    const result = breakStyledParagraph(doc, runs, cur.width * PDF_CONFIG.dynamicTextWidthFactor, text, cur.flow.align, startNode);
    if (result.lines.length === 0) return;
    const qualityWarnings = [
      result.forcedLines > 0 ? `Page flow produced ${result.forcedLines} forced overfull line(s).` : undefined,
      result.maxStretch > 2.2 ? `Page flow stretched a space to ${result.maxStretch.toFixed(2)}x its natural width.` : undefined,
      result.maxConsecutiveHyphenated > 4 ? `Page flow used hyphenation on ${result.maxConsecutiveHyphenated} consecutive lines.` : undefined,
    ].filter((warning): warning is string => Boolean(warning));
    for (const warning of qualityWarnings) if (text.warnings && !text.warnings.includes(warning)) text.warnings.push(warning);
    const available = Math.floor((cur.bottom - cur.y) / lineHeight);
    const take = brokeWithoutProgress
      ? Math.max(1, Math.min(available, result.lines.length))
      : splitWithoutWidows(result.lines.map((line) => line.runs), available);
    if (take <= 0) {
      cur.flowBreak();
      brokeWithoutProgress = true;
      continue;
    }
    brokeWithoutProgress = false;
    result.lines.slice(0, take).forEach((line, index) => {
      const isFinalLine = take === result.lines.length && index === take - 1;
      if (cur.flow.align === 'justify' && !isFinalLine) drawJustifiedLine(doc, line.runs, cur.x, cur.y + index * lineHeight, cur.width * PDF_CONFIG.dynamicTextWidthFactor, text);
      else drawStyledLine(doc, line.runs, cur.x, cur.y + index * lineHeight, text);
    });
    cur.y += take * lineHeight;
    startNode = result.lines[take - 1].endNode;
    if (startNode >= result.endNode) return;
    cur.flowBreak();
  }
}

interface PdfAsset {
  data: string;
  format: 'PNG' | 'JPEG';
}

const preparedBrandAssetCache = new Map<string, PdfAsset>();

export function clearPreparedBrandAssetCache(): void {
  preparedBrandAssetCache.clear();
}

async function prepareBrandAsset(path: string | undefined, width: number): Promise<PdfAsset | undefined> {
  if (!path) return undefined;
  const metadata = statSync(path);
  const targetPx = Math.round(width * PDF_CONFIG.assetRasterDensity);
  const cacheKey = `${path}|${metadata.mtimeMs}|${targetPx}|${PDF_CONFIG.assetRasterDensity}`;
  const cached = preparedBrandAssetCache.get(cacheKey);
  if (cached) return cached;
  const uri = await assetDataUri(path);
  if (!uri) return undefined;
  if (uri.startsWith('data:image/svg+xml')) {
    const svg = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf8');
    const png = await renderSvgToPng(svg, targetPx);
    const asset = { data: `data:image/png;base64,${png.toString('base64')}`, format: 'PNG' as const };
    preparedBrandAssetCache.set(cacheKey, asset);
    return asset;
  }
  const asset = { data: uri, format: uri.startsWith('data:image/jpeg') ? 'JPEG' as const : 'PNG' as const };
  preparedBrandAssetCache.set(cacheKey, asset);
  return asset;
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

function withPreservedTextStyle(doc: jsPDF, draw: () => void): void {
  const font = doc.getFont();
  const size = doc.getFontSize();
  const color = doc.getTextColor();
  draw();
  doc.setFont(font.fontName, font.fontStyle);
  doc.setFontSize(size);
  doc.setTextColor(color);
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

  const drawFollowingPageChrome = (doc: jsPDF): void => withPreservedTextStyle(doc, () => {
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
  });

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
      if (backgroundAsset || band) {
        cur.y = Math.max(cur.y, PDF_CONFIG.headerBandHeight + PDF_CONFIG.headerBottomGap);
      }
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

function renderIntro(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, text: StyledTextContext, gaps: PdfGaps): void {
  if (!data.intro) return;
  doc.setFont(pdfFont(theme), 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  doc.setTextColor(...rgb(theme.foreground));
  const block = cur.block('intro');
  const narrative = cur.dynamicFlow ? cur.block('narrative') : undefined;
  if (block) {
    // The nominal intro frame is sized for the usual one-line lead. In a
    // dynamic page, a longer intro must consume the space before narrative
    // flow instead of being moved into a column by keepTogether().
    cur.moveTo({
      ...block,
      top: Math.max(block.top, cur.y),
      bottom: Math.max(block.bottom, narrative?.bottom ?? block.bottom),
    });
  }
  const lines = layoutStyledText(doc, data.intro, cur.width, text);
  cur.keepTogether(lines.length * PDF_CONFIG.introLineHeight + PDF_CONFIG.introKeepPadding, PDF_CONFIG.introLineHeight * PDF_CONFIG.introMinLeadLines);
  if (cur.dynamicFlow) drawDynamicParagraph(doc, cur, data.intro, PDF_CONFIG.introLineHeight, text);
  else drawParagraph(doc, cur, lines, PDF_CONFIG.introLineHeight, text);
  if (block) cur.flowFrom(Math.max(cur.y + gaps.introBottomGap, block.bottom));
  else cur.y += gaps.introBottomGap;
}

function kpiColumnCount(count: number): number {
  const max = Math.min(count, PDF_CONFIG.kpiColumns);
  for (let cols = max; cols >= 2; cols -= 1) if (count % cols !== 1) return cols;
  return max;
}

function fitOneLine(doc: jsPDF, text: string, width: number): string {
  const lines = doc.splitTextToSize(text, width) as string[];
  if (lines.length <= 1) return lines[0] ?? '';
  let head = lines[0];
  while (head.length > 1 && doc.getTextWidth(`${head}…`) > width) head = head.slice(0, -1);
  return `${head.replace(/[\s,;:.\u2013\u2014-]+$/, '')}…`;
}

function renderKpis(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, text: StyledTextContext, gaps: PdfGaps): void {
  const kpis = data.kpis ?? [];
  if (kpis.length === 0) return;
  const font = pdfFont(theme);
  const cols = kpiColumnCount(kpis.length);
  const gap = PDF_CONFIG.kpiGap;
  const cardW = (cur.width - gap * (cols - 1)) / cols;
  const cardH = PDF_CONFIG.kpiHeight;
  const rows = Math.ceil(kpis.length / cols);
  cur.ensure(rows * (cardH + gap));

  kpis.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    if (col === 0 && row > 0) cur.y += cardH + gap;
    const x = cur.x + col * (cardW + gap);
    const y = cur.y;
    doc.setFillColor(...rgb(theme.soft));
    doc.setDrawColor(...rgb(theme.line));
    doc.setLineWidth(PDF_CONFIG.kpiLineWidth);
    doc.roundedRect(x, y, cardW, cardH, PDF_CONFIG.kpiRadius, PDF_CONFIG.kpiRadius, 'FD');
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.kpiLabelSize);
    doc.setTextColor(...rgb(theme.muted));
    drawStyledLine(doc, boldRuns(splitUncovered([{ text: String(k.label).toUpperCase(), bold: true, fallback: false }], text)), x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiLabelY, text);
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.kpiValueSize);
    doc.setTextColor(...rgb(theme.foreground));
    drawStyledLine(doc, boldRuns(splitUncovered([{ text: String(k.value), bold: true, fallback: false }], text)), x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiValueY, text);
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
      drawStyledLine(doc, splitUncovered([{ text: fitOneLine(doc, k.note, cardW - PDF_CONFIG.kpiPadding * 2), bold: false, fallback: false }], text), x + PDF_CONFIG.kpiPadding, y + PDF_CONFIG.kpiDeltaY, text);
    }
  });
  cur.y += cardH + gaps.kpiBottomGap;
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
    const h = (pxH / pxW) * cur.width;
    cur.ensure(h + PDF_CONFIG.chartKeepPadding);
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    doc.addImage(dataUrl, 'PNG', cur.x, cur.y, cur.width, h);
    cur.y += h + PDF_CONFIG.chartBottomGap;
  }
}

function renderSections(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, text: StyledTextContext, gaps: PdfGaps): void {
  const font = pdfFont(theme);
  const sections = data.sections ?? [];
  const narrativeFrame = cur.dynamicFlow ? cur.block('narrative') : undefined;
  if (narrativeFrame) cur.activateBlock('narrative', cur.y);
  sections.forEach((s, index) => {
    const sub = s.level === 2;
    const headingSize = sub ? PDF_CONFIG.sectionSubheadingSize : PDF_CONFIG.sectionHeadingSize;
    const headingLineHeight = sub ? PDF_CONFIG.sectionSubheadingLineHeight : PDF_CONFIG.sectionHeadingLineHeight;
    const headingGap = sub ? PDF_CONFIG.sectionSubheadingGap : PDF_CONFIG.sectionHeadingGap;
    doc.setFont(font, 'bold');
    doc.setFontSize(headingSize);
    const headingLines = cur.dynamicFlow
      ? wrapStyledRuns(doc, boldRuns(styledRuns(s.heading, text)), cur.width * PDF_CONFIG.headingCaptionWidthFactor, text)
      : layoutStyledText(doc, s.heading, cur.width, text).map(boldRuns);
    const headingH = headingLines.length * headingLineHeight;
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.bodySize);
    const bodyLines = s.body.trim().length > 0 ? layoutStyledText(doc, s.body, cur.width, text) : [];
    const leadLines = Math.min(bodyLines.length, PDF_CONFIG.sectionMinLeadLines);
    if (!sub && index > 0) {
      const required = headingH + headingGap + (cur.dynamicFlow ? Math.min(leadLines, 2) : leadLines) * PDF_CONFIG.bodyLineHeight;
      if (!cur.dynamicFlow || cur.bottom - cur.y >= gaps.sectionChapterTopGap + required) cur.y += gaps.sectionChapterTopGap;
    }
    if (cur.dynamicFlow) {
      // Dynamic paragraphs already apply widow/orphan rules while consuming
      // each segment. Keeping the whole section together here can discard
      // several usable lines at the bottom of a column just to move a tail
      // to the next column.
      cur.ensure(headingH + headingGap + Math.min(leadLines, 2) * PDF_CONFIG.bodyLineHeight);
    } else {
      cur.keepTogether(headingH + headingGap + bodyLines.length * PDF_CONFIG.bodyLineHeight, headingH + headingGap + leadLines * PDF_CONFIG.bodyLineHeight);
    }
    doc.setFont(font, 'bold');
    doc.setFontSize(headingSize);
    doc.setTextColor(...rgb(theme.foreground));
    drawStyledLines(doc, headingLines, cur.x, cur.y, headingLineHeight, text);
    cur.y += headingH;
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.bodySize);
    doc.setTextColor(...rgb(theme.foreground));
    if (bodyLines.length > 0) {
      if (cur.dynamicFlow) drawDynamicParagraph(doc, cur, s.body, PDF_CONFIG.bodyLineHeight, text);
      else drawParagraph(doc, cur, bodyLines, PDF_CONFIG.bodyLineHeight, text);
    }
    const sectionGap = bodyLines.length > 0 ? gaps.sectionBottomGap : PDF_CONFIG.sectionSubheadingGap;
    const nextSectionNeedsSpace = index < sections.length - 1 && cur.dynamicFlow;
    if (!nextSectionNeedsSpace || cur.bottom - cur.y >= sectionGap + PDF_CONFIG.bodyLineHeight) cur.y += sectionGap;
  });
  if (narrativeFrame) cur.releaseBlock();
}

function addUnsupportedPageBlockWarning(templateName: string, block: string, warnings: string[]): void {
  const warning = `Report template '${templateName}' does not render ${block} blocks; use default-report or move the content to sections/highlights.`;
  if (!warnings.includes(warning)) warnings.push(warning);
}

function warnAboutTableText(table: NonNullable<ReportData['table']>, text: StyledTextContext): void {
  if (!text.warnings) return;
  const cells = [...table.head, ...table.body.flat()].map(String).join(' ');
  const missing = missingCodePoints(cells, text.coverage);
  if (missing.length > 0) {
    const warning = tableFallbackWarning(text.family, missing);
    if (!text.warnings.includes(warning)) text.warnings.push(warning);
  }
  if (/\*\*|__|(?<![*\w])\*[^*\n]+\*(?![*\w])/.test(cells) && !text.warnings.includes(LITERAL_MARKUP_WARNING)) text.warnings.push(LITERAL_MARKUP_WARNING);
}

function measureTablePages(tableOptions: UserOptions, fontSet: RenderFontSet): Map<number, Set<number>> {
  const measureDoc = newPdf('portrait', 'a4', fontSet);
  const rowsByPage = new Map<number, Set<number>>();
  const measureOptions: UserOptions = {
    ...tableOptions,
    willDrawPage: undefined,
    didDrawCell: (hook: any) => {
      if (hook.section !== 'body' || !Number.isInteger(hook.row?.index)) return;
      const page = Number(hook.pageNumber ?? 1);
      const rows = rowsByPage.get(page) ?? new Set<number>();
      rows.add(hook.row.index);
      rowsByPage.set(page, rows);
    },
  };
  (measureDoc as jsPDF & { autoTable: (options: UserOptions) => void }).autoTable(measureOptions);
  return rowsByPage;
}

function tablePageRowCounts(rowsByPage: Map<number, Set<number>>): number[] {
  return [...rowsByPage.entries()].sort(([left], [right]) => left - right).map(([, rows]) => rows.size);
}

interface TableRowMeasurements {
  head: number;
  body: number[];
}

function measureTableRows(tableOptions: UserOptions, fontSet: RenderFontSet): TableRowMeasurements {
  const measureDoc = newPdf('portrait', 'a4', fontSet);
  let head = 0;
  const body: number[] = [];
  const margin = tableOptions.margin && typeof tableOptions.margin === 'object' ? tableOptions.margin : {};
  const measureOptions: UserOptions = {
    ...tableOptions,
    startY: 0,
    margin: { ...margin, top: 0, bottom: 0 },
    willDrawPage: undefined,
    didDrawCell: (hook: any) => {
      const height = Number(hook.cell?.height ?? 0);
      if (hook.section === 'head') head = Math.max(head, height);
      if (hook.section === 'body' && Number.isInteger(hook.row?.index)) body[hook.row.index] = Math.max(body[hook.row.index] ?? 0, height);
    },
  };
  (measureDoc as jsPDF & { autoTable: (options: UserOptions) => void }).autoTable(measureOptions);
  return { head, body };
}

function drawDynamicTableRow(
  doc: jsPDF,
  cur: Cursor,
  cells: string[],
  widths: number[],
  y: number,
  height: number,
  font: string,
  fill: [number, number, number],
  line: [number, number, number],
  foreground: [number, number, number],
  bold: boolean,
): void {
  const lineHeight = PDF_CONFIG.tableFontSize * PT_TO_MM * 1.2;
  let x = cur.x;
  cells.forEach((cell, index) => {
    const width = widths[index] ?? widths.at(-1) ?? cur.width;
    doc.setFillColor(...fill);
    doc.setDrawColor(...line);
    doc.setLineWidth(PDF_CONFIG.tableLineWidth);
    doc.rect(x, y, width, height, 'FD');
    doc.setFont(font, bold ? 'bold' : 'normal');
    doc.setFontSize(PDF_CONFIG.tableFontSize);
    doc.setTextColor(...foreground);
    const lines = doc.splitTextToSize(cell, Math.max(1, width - PDF_CONFIG.tableCellPadding * 2)).slice(0, Math.max(1, Math.floor(height / lineHeight))) as string[];
    const textHeight = lines.length * lineHeight;
    lines.forEach((line, lineIndex) => doc.text(line, x + PDF_CONFIG.tableCellPadding, y + (height - textHeight) / 2 + lineHeight * (lineIndex + 0.8)));
    x += width;
  });
}

function renderDynamicTable(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, header: ReportHeaderRenderer, text: StyledTextContext, fontSet: RenderFontSet): void {
  if (!data.table) return;
  const font = pdfFont(theme);
  warnAboutTableText(data.table, text);
  const tableHead = data.table.head.map((cell) => stripInlineMarkup(String(cell)));
  const tableBody = data.table.body.map((row) => row.map((cell) => stripInlineMarkup(String(cell))));
  const tableOptions: UserOptions = {
    head: [tableHead],
    body: tableBody,
    margin: { top: header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap, left: cur.x, right: PAGE_W - cur.x - cur.width, bottom: 0 },
    styles: { font, fontSize: PDF_CONFIG.tableFontSize, cellPadding: PDF_CONFIG.tableCellPadding, textColor: rgb(theme.foreground), fillColor: rgb(theme.background), lineColor: rgb(theme.line), lineWidth: PDF_CONFIG.tableLineWidth },
    headStyles: { font, fontStyle: 'bold', fillColor: rgb(theme.primary), textColor: rgb(readableTextColor(theme.primary, theme, PDF_CONFIG.tableFontSize * PT_TO_PX, true)) },
    alternateRowStyles: { fillColor: rgb(theme.soft) },
    didParseCell: ({ cell }) => {
      if (missingCodePoints(cell.text.join(' '), text.coverage).length > 0) cell.styles.font = FALLBACK_FAMILY;
    },
  };
  const measurements = measureTableRows(tableOptions, fontSet);
  const captionLines = data.table.caption && cur.dynamicFlow
    ? wrapStyledRuns(doc, boldRuns(styledRuns(data.table.caption, text)), cur.width * PDF_CONFIG.headingCaptionWidthFactor, text)
    : [];

  const captionLineHeight = PDF_CONFIG.sectionHeadingLineHeight;
  const captionHeight = data.table.caption ? captionLines.length * captionLineHeight + PDF_CONFIG.tableCaptionGap + PDF_CONFIG.tableCaptionBottomGap : 0;
  const minimumRows = Math.min(PDF_CONFIG.tableWidowMinRows - 1, tableBody.length);
  const fallbackRowHeight = PDF_CONFIG.tableFontSize * PT_TO_MM + PDF_CONFIG.tableCellPadding * 2;
  const minimumTableHeight = (measurements.head || fallbackRowHeight)
    + measurements.body.slice(0, minimumRows).reduce((sum, height) => sum + (height || fallbackRowHeight), 0);
  while (cur.y + captionHeight + PDF_CONFIG.tableStartOffset + minimumTableHeight > cur.bottom) cur.flowBreak();
  if (data.table.caption) {
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
    doc.setTextColor(...rgb(theme.foreground));
    drawStyledLines(doc, captionLines, cur.x, cur.y, captionLineHeight, text);
    cur.y += captionLines.length * captionLineHeight + PDF_CONFIG.tableCaptionBottomGap;
  }

  const columnCount = Math.max(tableHead.length, ...tableBody.map((row) => row.length), 1);
  const widths = Array.from({ length: columnCount }, () => cur.width / columnCount);
  const headHeight = measurements.head || PDF_CONFIG.tableFontSize * PT_TO_MM + PDF_CONFIG.tableCellPadding * 2;
  let rowIndex = 0;
  while (rowIndex < tableBody.length || rowIndex === 0 && tableBody.length === 0) {
    const startRow = rowIndex;
    let height = headHeight;
    while (
      rowIndex < tableBody.length
      && rowIndex - startRow < PDF_CONFIG.tableFlowMaxRows
      && cur.y + PDF_CONFIG.tableStartOffset + height + (measurements.body[rowIndex] ?? headHeight) <= cur.bottom
    ) {
      height += measurements.body[rowIndex] ?? headHeight;
      rowIndex += 1;
    }
    const rowsInChunk = rowIndex - startRow;
    const requiredRows = startRow === 0 ? Math.min(minimumRows, tableBody.length) : 0;
    if (rowsInChunk < requiredRows || (rowsInChunk === 0 && tableBody.length > 0)) {
      cur.flowBreak();
      continue;
    }
    let rowY = cur.y + PDF_CONFIG.tableStartOffset;
    drawDynamicTableRow(doc, cur, tableHead, widths, rowY, headHeight, font, rgb(theme.primary), rgb(theme.line), rgb(readableTextColor(theme.primary, theme, PDF_CONFIG.tableFontSize * PT_TO_PX, true)), true);
    rowY += headHeight;
    for (let index = startRow; index < rowIndex; index += 1) {
      const rowHeight = measurements.body[index] ?? headHeight;
      drawDynamicTableRow(doc, cur, tableBody[index], widths, rowY, rowHeight, font, index % 2 === 0 ? rgb(theme.soft) : rgb(theme.background), rgb(theme.line), rgb(theme.foreground), false);
      rowY += rowHeight;
    }
    cur.y = rowY + PDF_CONFIG.tableBottomGap;
    if (rowIndex >= tableBody.length) break;
    cur.flowBreak();
  }
}

function renderTable(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, header: ReportHeaderRenderer, text: StyledTextContext, fontSet: RenderFontSet): void {
  if (!data.table) return;
  if (cur.dynamicFlow) {
    renderDynamicTable(doc, cur, data, theme, header, text, fontSet);
    return;
  }
  const font = pdfFont(theme);
  const firstRowsH = PDF_CONFIG.tableCaptionHeight;
  const captionHeight = data.table.caption ? PDF_CONFIG.tableCaptionGap + PDF_CONFIG.tableCaptionBottomGap : 0;
  cur.ensure(captionHeight + firstRowsH);
  warnAboutTableText(data.table, text);
  const drawCaption = (): void => {
    if (!data.table?.caption) return;
    doc.setFont(font, 'bold');
    doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
    doc.setTextColor(...rgb(theme.foreground));
    drawStyledLine(doc, boldRuns(styledRuns(data.table.caption, text)), cur.x, cur.y, text);
    cur.y += PDF_CONFIG.tableCaptionBottomGap;
  };
  let tableInitialPage = doc.getNumberOfPages();
  const tableOptions: UserOptions = {
    head: [data.table.head.map((c) => stripInlineMarkup(String(c)))],
    body: data.table.body.map((r) => r.map((c) => stripInlineMarkup(String(c)))),
    startY: cur.y + (data.table.caption ? PDF_CONFIG.tableCaptionBottomGap : 0) + PDF_CONFIG.tableStartOffset,
    margin: { top: header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap, left: cur.x, right: PAGE_W - cur.x - cur.width },
    styles: { font, fontSize: PDF_CONFIG.tableFontSize, cellPadding: PDF_CONFIG.tableCellPadding, textColor: rgb(theme.foreground), fillColor: rgb(theme.background), lineColor: rgb(theme.line), lineWidth: PDF_CONFIG.tableLineWidth },
    headStyles: { font, fontStyle: 'bold', fillColor: rgb(theme.primary), textColor: rgb(readableTextColor(theme.primary, theme, PDF_CONFIG.tableFontSize * PT_TO_PX, true)) },
    alternateRowStyles: { fillColor: rgb(theme.soft) },
    didParseCell: ({ cell }) => {
      if (missingCodePoints(cell.text.join(' '), text.coverage).length > 0) cell.styles.font = FALLBACK_FAMILY;
    },
    willDrawPage: ({ doc: pageDoc, pageNumber }) => {
      const documentPage = pageDoc.getNumberOfPages();
      if (documentPage > tableInitialPage) {
        pageDoc.setFillColor(...rgb(theme.background));
        pageDoc.rect(0, 0, PAGE_W, PAGE_H, 'F');
        if (documentPage > 1 || pageNumber > 1) header.drawFollowingPageChrome(pageDoc);
      }
    },
  };
  const currentPageRows = tablePageRowCounts(measureTablePages(tableOptions, fontSet));
  const currentTail = currentPageRows.at(-1) ?? 0;
  if (currentPageRows.length > 1 && currentTail < PDF_CONFIG.tableWidowMinRows) {
    const freshStartY = header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap + captionHeight;
    const freshPageRows = tablePageRowCounts(measureTablePages({ ...tableOptions, startY: freshStartY }, fontSet));
    if (freshPageRows.length === 1) {
      cur.breakPage();
      tableInitialPage = doc.getNumberOfPages();
    }
  }
  drawCaption();
  tableOptions.startY = cur.y + PDF_CONFIG.tableStartOffset;
  (doc as jsPDF & { autoTable: (options: UserOptions) => void }).autoTable(tableOptions);
  cur.y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + PDF_CONFIG.tableBottomGap;
}

function planBulletPages(heights: number[], startY: number, pageTop: number, pageBottom: number, minCarry: number): number[][] {
  const pages: number[][] = [[]];
  let y = startY;
  let index = 0;
  while (index < heights.length) {
    const page = pages.at(-1)!;
    const height = heights[index];
    const fresh = page.length === 0 && y === pageTop;
    if (y + height > pageBottom && !fresh) {
      pages.push([]);
      y = pageTop;
      continue;
    }
    let probe = y + height;
    let stranded = 0;
    for (const next of heights.slice(index + 1)) {
      if (probe + next <= pageBottom) probe += next;
      else stranded += 1;
    }
    if (stranded > 0 && stranded < minCarry && !fresh) {
      pages.push([]);
      y = pageTop;
      continue;
    }
    page.push(index);
    y += height;
    index += 1;
  }
  return pages;
}

function renderHighlights(
  doc: jsPDF,
  cur: Cursor,
  data: ReportData,
  theme: RenderTheme,
  text: StyledTextContext,
  gaps: PdfGaps,
  contentTop: number,
): void {
  const highlights = data.highlights ?? [];
  if (highlights.length === 0) return;
  if (cur.dynamicFlow) {
    renderDynamicHighlights(doc, cur, data, theme, text, gaps);
    return;
  }
  const font = pdfFont(theme);
  const bulletWidth = cur.width - PDF_CONFIG.highlightIndent;
  const pageBottom = cur.bottom;
  doc.setFont(font, 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  const bulletLines = highlights.map((h) => layoutStyledText(doc, h, bulletWidth, text));
  const heights = bulletLines.map((lines) => lines.length * PDF_CONFIG.bodyLineHeight + gaps.highlightLineGap);
  const headingHeight = PDF_CONFIG.highlightsHeadingHeight;
  let plan = planBulletPages(heights, cur.y + headingHeight, contentTop, pageBottom, PDF_CONFIG.widowMinBullets);
  if (plan[0].length === 0) {
    cur.breakPage();
    plan = planBulletPages(heights, cur.y + headingHeight, contentTop, pageBottom, PDF_CONFIG.widowMinBullets);
  }
  doc.setFont(font, 'bold');
  doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
  doc.setTextColor(...rgb(theme.foreground));
  drawStyledLine(doc, boldRuns(styledRuns(data.highlights_title ?? 'Highlights', text)), cur.x, cur.y, text);
  cur.y += headingHeight;
  for (const [pageIndex, indices] of plan.entries()) {
    if (pageIndex > 0) cur.breakPage();
    for (const index of indices) {
      doc.setFillColor(...rgb(theme.primary));
      doc.circle(cur.x + PDF_CONFIG.highlightBulletX, cur.y - PDF_CONFIG.highlightBulletY, PDF_CONFIG.highlightBulletRadius, 'F');
      doc.setFont(font, 'normal');
      doc.setFontSize(PDF_CONFIG.bodySize);
      doc.setTextColor(...rgb(theme.foreground));
      drawStyledLines(doc, bulletLines[index], cur.x + PDF_CONFIG.highlightIndent, cur.y, PDF_CONFIG.bodyLineHeight, text);
      cur.y += heights[index];
    }
  }
  cur.y += gaps.highlightsBottomGap;
}

function renderDynamicHighlights(doc: jsPDF, cur: Cursor, data: ReportData, theme: RenderTheme, text: StyledTextContext, gaps: PdfGaps): void {
  const highlights = data.highlights ?? [];
  const font = pdfFont(theme);
  doc.setFont(font, 'normal');
  doc.setFontSize(PDF_CONFIG.bodySize);
  const bulletLines = highlights.map((highlight) => layoutStyledText(doc, highlight, (cur.width - PDF_CONFIG.highlightIndent) * PDF_CONFIG.dynamicTextWidthFactor, text));
  const heights = bulletLines.map((lines) => lines.length * PDF_CONFIG.bodyLineHeight + gaps.highlightLineGap);
  const headingLines = wrapStyledRuns(doc, boldRuns(styledRuns(data.highlights_title ?? 'Highlights', text)), cur.width * PDF_CONFIG.headingCaptionWidthFactor, text);
  const headingHeight = headingLines.length * PDF_CONFIG.sectionHeadingLineHeight;
  const firstRows = Math.min(PDF_CONFIG.widowMinBullets, highlights.length);
  const firstHeight = headingHeight + heights.slice(0, firstRows).reduce((sum, height) => sum + height, 0);
  while (cur.y + firstHeight > cur.bottom) cur.flowBreak();
  doc.setFont(font, 'bold');
  doc.setFontSize(PDF_CONFIG.sectionHeadingSize);
  doc.setTextColor(...rgb(theme.foreground));
  drawStyledLines(doc, headingLines, cur.x, cur.y, PDF_CONFIG.sectionHeadingLineHeight, text);
  cur.y += headingHeight;
  for (const [index, lines] of bulletLines.entries()) {
    if (cur.y + heights[index] > cur.bottom) cur.flowBreak();
    doc.setFillColor(...rgb(theme.primary));
    doc.circle(cur.x + PDF_CONFIG.highlightBulletX, cur.y - PDF_CONFIG.highlightBulletY, PDF_CONFIG.highlightBulletRadius, 'F');
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.bodySize);
    doc.setTextColor(...rgb(theme.foreground));
    drawStyledLines(doc, lines, cur.x + PDF_CONFIG.highlightIndent, cur.y, PDF_CONFIG.bodyLineHeight, text);
    cur.y += heights[index];
  }
  if (cur.y + gaps.highlightsBottomGap <= cur.bottom) cur.y += gaps.highlightsBottomGap;
}

function renderFooter(doc: jsPDF, data: ReportData, theme: RenderTheme, geometry = DEFAULT_PAGE_GEOMETRY): void {
  const font = pdfFont(theme);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const coverPage = Boolean(data.title_page && p === 1);
    const footerLine = coverPage ? theme.titleSubtitleColor : theme.line;
    const footerText = coverPage ? theme.titleSubtitleColor : theme.muted;
    doc.setDrawColor(...rgb(footerLine));
    doc.setLineWidth(PDF_CONFIG.footerLineWidth);
    const footerY = geometry.height - (PAGE_H - PDF_CONFIG.footerY);
    doc.line(geometry.margins.left, footerY, geometry.width - geometry.margins.right, footerY);
    doc.setFont(font, 'normal');
    doc.setFontSize(PDF_CONFIG.footerFontSize);
    doc.setTextColor(...rgb(footerText));
    const footerTextY = geometry.height - (PAGE_H - PDF_CONFIG.footerTextY);
    if (data.footer) doc.text(String(data.footer), geometry.margins.left, footerTextY);
    doc.text(`${p} / ${pages}`, geometry.width - geometry.margins.right, footerTextY, { align: 'right' });
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

interface RenderReportAttempt {
  buffer: Buffer;
  pages: number;
  lastPageFill: number;
}

async function renderReportAttempt(name: string, data: ReportData, theme: RenderTheme, gaps: PdfGaps, warnings: string[]): Promise<RenderReportAttempt> {
  const template = resolveTemplate(name, data);
  const resolved = template.data;
  const geometry = template.page ? pageGeometryFromTemplate(template.compiled!) : DEFAULT_PAGE_GEOMETRY;
  const fontSet = await loadRenderFontSet(theme);
  const doc = newPdf('portrait', template.page ? [geometry.width, geometry.height] : 'a4', fontSet);
  const family = pdfFont(theme);
  const text: StyledTextContext = {
    family,
    coverage: family === 'DejaVu' ? undefined : fontCoverage(fontSet.regular),
    warnings,
    hyphenate: geometry.flow.hyphenate,
  };
  const header = await createReportHeader(resolved, theme);
  const cur = new Cursor(doc, theme.background, (cursor) => {
    header.drawFollowingPage(doc, cursor);
    cursor.setFlowTop(cursor.y);
  }, geometry);
  if (resolved.title_page) {
    await renderTitlePage(doc, resolved, theme);
    cur.breakPage();
    cur.setFlowTop(cur.y);
  } else {
    header.drawFirstPage(doc, cur);
    cur.setFlowTop(cur.y);
  }
  renderIntro(doc, cur, resolved, theme, text, gaps);
  const pageBlocksSupported = !geometry.dynamicFlow;
  if (pageBlocksSupported) {
    renderKpis(doc, cur, resolved, theme, text, gaps);
    await renderCharts(doc, cur, resolved, theme);
  } else {
    if (resolved.kpis?.length) addUnsupportedPageBlockWarning(name, 'KPI', warnings);
    if (resolved.charts?.length) addUnsupportedPageBlockWarning(name, 'chart', warnings);
  }
  renderSections(doc, cur, resolved, theme, text, gaps);
  renderTable(doc, cur, resolved, theme, header, text, fontSet);
  renderHighlights(doc, cur, resolved, theme, text, gaps, header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap);
  renderFooter(doc, resolved, theme, geometry);
  const pages = doc.getNumberOfPages();
  const contentStart = header.followingPageHeight() + PDF_CONFIG.headerRepeatBottomGap;
  const contentHeight = geometry.height - geometry.margins.bottom - contentStart;
  const lastPageFill = pages > 1 && contentHeight > 0
    ? Math.max(0, Math.min(1, (cur.y - contentStart) / contentHeight))
    : 1;
  return { buffer: Buffer.from(doc.output('arraybuffer')), pages, lastPageFill };
}

export async function renderReportPdf(name: string, data: ReportData, theme = defaultRenderTheme(), warnings: string[] = []): Promise<Buffer> {
  const original = await renderReportAttempt(name, data, theme, pdfGaps(), warnings);
  if (original.pages <= 1 || original.lastPageFill >= PDF_CONFIG.minLastPageFill) return original.buffer;
  for (const factor of [PDF_CONFIG.lastPageGapFactor1, PDF_CONFIG.lastPageGapFactor2]) {
    const tightened = await renderReportAttempt(name, data, theme, pdfGaps(factor), warnings);
    if (tightened.pages < original.pages) {
      warnings.push(`A4 report gaps tightened by factor ${factor} to avoid a near-empty final page.`);
      return tightened.buffer;
    }
  }
  return original.buffer;
}

interface ResolvedReportTemplate {
  data: ReportData;
  page?: CompiledTemplate['page'];
  compiled?: CompiledTemplate;
}

function resolveTemplate(name: string, data: ReportData): ResolvedReportTemplate {
  const pageSource = readBuiltinPageTemplateSource(name);
  if (pageSource) {
    const compiled = compileTemplateSource(pageSource.source);
    return { data, page: compiled.page, compiled };
  }
  const templateName = name.split('/').filter(Boolean).at(-1) ?? name;
  if (templateName === 'default-report') return { data };
  if (templateName === 'campaign-summary') {
    return {
      data: {
        ...data,
        title: data.title ?? 'Campaign summary',
        subtitle: data.subtitle ?? 'Performance snapshot and next actions',
      },
    };
  }
  throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((t) => t.name).join(', ')}`);
}
