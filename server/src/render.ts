import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';
import wasmBinary from '@resvg/resvg-wasm/index_bg.wasm';
import fontRegular from './assets/font.ttf';
import fontBold from './assets/font-bold.ttf';
import { FONT_FAMILY } from './svg.js';

applyPlugin(jsPDF);

const fontRegularBase64 = Buffer.from(fontRegular).toString('base64');
const fontBoldBase64 = Buffer.from(fontBold).toString('base64');

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) wasmReady = initWasm(wasmBinary);
  return wasmReady;
}

export async function renderSvgToPng(svg: string, width?: number): Promise<Buffer> {
  await ensureWasm();
  const options: ConstructorParameters<typeof Resvg>[1] = {
    font: {
      fontBuffers: [fontRegular, fontBold],
      defaultFontFamily: FONT_FAMILY,
      loadSystemFonts: false,
    },
  };
  if (width) options.fitTo = { mode: 'width', value: width };
  const resvg = new Resvg(svg, options);
  const png = resvg.render().asPng();
  return Buffer.from(png);
}

export function newPdf(orientation: 'portrait' | 'landscape' = 'portrait', format: string | [number, number] = 'a4'): jsPDF {
  const doc = new jsPDF({ orientation, unit: 'mm', format, compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', fontRegularBase64);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBoldBase64);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  return doc;
}

export function pdfFont(): string {
  return 'DejaVu';
}
