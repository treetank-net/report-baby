import { DOMParser, parseHTML } from 'linkedom';
import { svg2pdf } from 'svg2pdf.js';
import type { RenderTheme } from '../contracts/render-theme.js';
import { assetDataUri, defaultRenderTheme } from '../brand/context.js';
import { loadRenderFontSet, newPdf, registerPdfFontSet } from '../rendering/primitives.js';
import { rasterizePdf } from '../rendering/pdf-rasterizer.js';
import { FONT_FAMILY } from '../rendering/svg.js';
import type { SlideDeck } from './contracts.js';
import { renderSlideSvg } from './svg-renderer.js';
import { HEIGHT, PDF_HEIGHT_MM, PDF_WIDTH_MM, RENDER_CONFIG, WIDTH } from './slide-layout.js';

export async function renderSlidesPng(deck: SlideDeck, selectedIndex?: number, theme = defaultRenderTheme()): Promise<Buffer[]> {
  if (selectedIndex !== undefined && !deck.slides[selectedIndex]) throw new Error(`Slide index ${selectedIndex} is outside 0..${deck.slides.length - 1}`);
  const pdf = await renderSlidesPdf(deck, theme);
  return rasterizePdf(pdf, WIDTH, HEIGHT, selectedIndex === undefined ? undefined : selectedIndex + 1, selectedIndex === undefined ? undefined : selectedIndex + 1);
}

let slidePdfRenderQueue: Promise<void> = Promise.resolve();

function dataUriImageDimensions(source: string): [number, number] {
  const match = source.match(/^data:image\/([^;,]+)(?:;[^,]*)?,(.+)$/i);
  if (!match) throw new Error('PDF image renderer only supports data URI images.');
  const bytes = Buffer.from(decodeURIComponent(match[2]!), source.includes(';base64,') ? 'base64' : 'utf8');
  const format = match[1]!.toLowerCase();
  if (format === 'png' && bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (format === 'jpeg' || format === 'jpg') {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1]!;
      const length = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      offset += 2 + length;
    }
  }
  throw new Error(`Unsupported PDF image format: ${format}`);
}

class PdfImage {
  width = 0;
  height = 0;
  onload?: () => void;
  onerror?: (error: unknown) => void;

  set src(source: string) {
    try {
      [this.width, this.height] = dataUriImageDimensions(source);
      queueMicrotask(() => this.onload?.());
    } catch (error) {
      queueMicrotask(() => this.onerror?.(error));
    }
  }
}

export async function renderSlidesPdf(deck: SlideDeck, theme = defaultRenderTheme()): Promise<Buffer> {
  const previous = slidePdfRenderQueue;
  let release!: () => void;
  slidePdfRenderQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await renderSlidesPdfUnlocked(deck, theme);
  } finally {
    release();
  }
}

async function renderSlidesPdfUnlocked(deck: SlideDeck, theme: RenderTheme): Promise<Buffer> {
  const pageWidth = PDF_WIDTH_MM;
  const pageHeight = PDF_HEIGHT_MM;
  const pdfScale = pageWidth / WIDTH;
  const fontSet = await loadRenderFontSet(theme);
  const doc = newPdf('landscape', [pageHeight, pageWidth], fontSet);
  const registeredFamilies = new Set([fontSet.family]);
  const globalScope = globalThis as any;
  const previousDocument = globalScope.document;
  const previousDOMParser = globalScope.DOMParser;
  const previousImage = globalScope.Image;
  const svgDocument = parseHTML('<!doctype html><html><body></body></html>').document as any;
  svgDocument.implementation = { createHTMLDocument: () => parseHTML('<!doctype html><html><body></body></html>').document };
  const createElementNS = svgDocument.createElementNS.bind(svgDocument);
  svgDocument.createElementNS = (namespace: string, name: string) => {
    const element = createElementNS(namespace, name) as any;
    if (name === 'text') {
      element.getBBox = () => {
        const size = Number.parseFloat(element.getAttribute('font-size') ?? '0') || 0;
        const family = element.getAttribute('font-family') ?? '';
        const glyphWidth = family.toLowerCase().includes('mono') ? RENDER_CONFIG.text.monoEstimatedGlyphWidth : RENDER_CONFIG.text.bodyGlyphWidth;
        return { width: (element.textContent ?? '').length * size * glyphWidth, height: size };
      };
    }
    return element;
  };
  globalScope.document = svgDocument;
  globalScope.DOMParser = DOMParser;
  globalScope.Image = PdfImage;
  try {
    for (let index = 0; index < deck.slides.length; index++) {
      if (index > 0) doc.addPage([pageHeight, pageWidth], 'landscape');
      const slideTheme = deck.slideThemes?.[index] ?? theme;
      const slideFontSet = await loadRenderFontSet(slideTheme);
      if (!registeredFamilies.has(slideFontSet.family)) {
        registerPdfFontSet(doc, slideFontSet);
        registeredFamilies.add(slideFontSet.family);
      }
      const pdfFontFamily = slideFontSet.family === 'DejaVu Sans' ? 'DejaVu' : slideFontSet.family;
      const svg = await renderSlideSvg(deck, deck.slides[index]!, index, slideTheme);
      const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
      const textElements = Array.from(root.querySelectorAll('text')).map((element) => ({ value: element.textContent ?? '', x: Number.parseFloat(element.getAttribute('x') ?? '0'), y: Number.parseFloat(element.getAttribute('y') ?? '0'), size: Number.parseFloat(element.getAttribute('font-size') ?? '0'), family: element.getAttribute('font-family') ?? FONT_FAMILY, weight: element.getAttribute('font-weight') ?? '400', color: element.getAttribute('fill') ?? '#000000', anchor: element.getAttribute('text-anchor') ?? 'start' }));
      root.querySelectorAll('text').forEach((element) => element.setAttribute('display', 'none'));
      await svg2pdf(root as unknown as Element, doc, { x: 0, y: 0, width: pageWidth, height: pageHeight });
      textElements.forEach((textElement) => {
        const fontWeight = Number.parseInt(textElement.weight, 10);
        const fontStyle = textElement.weight === 'bold' || (!Number.isNaN(fontWeight) && fontWeight >= 600) ? 'bold' : 'normal';
        const color = textElement.color.match(/^#([0-9a-f]{6})$/i)?.[1] ?? '000000';
        doc.setFont(pdfFontFamily, fontStyle);
        doc.setFontSize(textElement.size * pdfScale * RENDER_CONFIG.canvas.pointsPerInch / 25.4);
        doc.setTextColor(Number.parseInt(color.slice(0, 2), 16), Number.parseInt(color.slice(2, 4), 16), Number.parseInt(color.slice(4, 6), 16));
        doc.text(textElement.value, textElement.x * pdfScale, textElement.y * pdfScale, { align: textElement.anchor === 'middle' ? 'center' : textElement.anchor === 'end' ? 'right' : 'left', baseline: 'alphabetic' });
      });
    }
  } finally {
    globalScope.document = previousDocument;
    globalScope.DOMParser = previousDOMParser;
    globalScope.Image = previousImage;
  }
  return Buffer.from(doc.output('arraybuffer'));
}
