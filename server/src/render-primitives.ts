import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { readFile } from 'node:fs/promises';
import { jsPDF } from 'jspdf';
import { readableInk } from './brand-context.js';
import type { RenderTheme } from './core/model/render-theme.js';
import { readRenderConfig } from './builtin-template-source.js';
import { applyPlugin } from 'jspdf-autotable';
import wasmBinary from '@resvg/resvg-wasm/index_bg.wasm';
import fontRegular from './assets/font.ttf';
import fontBold from './assets/font-bold.ttf';
import { FONT_FAMILY } from './svg.js';

applyPlugin(jsPDF);

const fontRegularBase64 = Buffer.from(fontRegular).toString('base64');
const fontBoldBase64 = Buffer.from(fontBold).toString('base64');

export function readableTextColor(background: string | undefined, theme: RenderTheme, sizePx: number, bold: boolean): string {
  const contrast = readRenderConfig().contrast;
  const largeThreshold = bold ? contrast.largeBoldTextPx : contrast.largeTextPx;
  const minimum = sizePx >= largeThreshold ? contrast.largeMinimum : contrast.bodyMinimum;
  return readableInk(background, ['#ffffff', theme.background, theme.foreground, '#000000'], minimum);
}

export interface RenderFontSet {
  regular: Uint8Array;
  bold: Uint8Array;
  family: string;
}

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(wasmBinary);
  return wasmReady;
}

export async function loadRenderFontSet(theme?: Partial<Pick<RenderTheme, 'fontRegularPath' | 'fontBoldPath' | 'fontFamily'>>): Promise<RenderFontSet> {
  const [regular, bold] = await Promise.all([
    theme?.fontRegularPath ? readFile(theme.fontRegularPath) : Promise.resolve(fontRegular),
    theme?.fontBoldPath ? readFile(theme.fontBoldPath) : Promise.resolve(fontBold),
  ]);
  return { regular, bold, family: theme?.fontRegularPath ? theme.fontFamily ?? FONT_FAMILY : FONT_FAMILY };
}

export async function renderSvgToPng(svg: string, width?: number, fontSet?: RenderFontSet): Promise<Buffer> {
  await ensureWasm();
  const fonts = fontSet ?? await loadRenderFontSet();
  const options: ConstructorParameters<typeof Resvg>[1] = {
    font: {
      fontBuffers: [fonts.regular, fonts.bold, fontRegular, fontBold],
      defaultFontFamily: fonts.family,
      loadSystemFonts: false,
    },
  };
  if (width) options.fitTo = { mode: 'width', value: width };
  const resvg = new Resvg(svg, options);
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export function registerPdfFontSet(doc: jsPDF, fontSet: RenderFontSet): void {
  if (fontSet.family === 'DejaVu Sans') return;
  const fileStem = `Brand-${fontSet.family.replace(/[^a-z0-9]+/gi, '-')}`;
  doc.addFileToVFS(`${fileStem}-Regular.ttf`, Buffer.from(fontSet.regular).toString('base64'));
  doc.addFont(`${fileStem}-Regular.ttf`, fontSet.family, 'normal');
  doc.addFileToVFS(`${fileStem}-Bold.ttf`, Buffer.from(fontSet.bold).toString('base64'));
  doc.addFont(`${fileStem}-Bold.ttf`, fontSet.family, 'bold');
}

export function newPdf(orientation: 'portrait' | 'landscape' = 'portrait', format: string | [number, number] = 'a4', fontSet?: RenderFontSet): jsPDF {
  const doc = new jsPDF({ orientation, unit: 'mm', format, compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', fontRegularBase64);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBoldBase64);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  if (fontSet) registerPdfFontSet(doc, fontSet);
  doc.setFont(fontSet?.family === 'DejaVu Sans' ? 'DejaVu' : fontSet?.family ?? 'DejaVu', 'normal');
  return doc;
}

export function pdfFont(theme?: Partial<Pick<RenderTheme, 'fontRegularPath' | 'fontFamily'>>): string {
  return theme?.fontRegularPath ? theme.fontFamily ?? 'DejaVu' : 'DejaVu';
}
