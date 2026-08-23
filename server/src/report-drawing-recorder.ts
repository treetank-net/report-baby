import type { jsPDF } from 'jspdf';

export interface ReportDrawing {
  page: number;
  kind: 'text' | 'rect' | 'roundedRect' | 'circle' | 'line' | 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

type JsPdfMethod = (...args: any[]) => any;

function numberAt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function install(doc: jsPDF, name: string, draw: (args: any[]) => Omit<ReportDrawing, 'page' | 'kind'> | undefined, kind: ReportDrawing['kind'], output: ReportDrawing[]): void {
  const original = (doc as unknown as Record<string, JsPdfMethod>)[name];
  if (typeof original !== 'function') return;
  (doc as unknown as Record<string, JsPdfMethod>)[name] = function recordedMethod(this: jsPDF, ...args: any[]) {
    const result = original.apply(this, args);
    const box = draw(args);
    if (box) output.push({ page: this.getNumberOfPages(), kind, ...box });
    return result;
  };
}

/**
 * Record the public drawing calls made by the report renderer.
 * The wrapper does not alter jsPDF behaviour and is intentionally separate
 * from PDF parsing so layout tests can inspect the renderer in-process.
 */
export function installReportDrawingRecorder(doc: jsPDF, output: ReportDrawing[]): void {
  install(doc, 'text', (args) => {
    const value = args[0];
    const lines = Array.isArray(value) ? value.length : 1;
    let x = numberAt(args[1]);
    const y = numberAt(args[2]);
    const width = Array.isArray(value)
      ? Math.max(0, ...value.map((line) => doc.getTextWidth(String(line))))
      : doc.getTextWidth(String(value));
    const options = args[3] && typeof args[3] === 'object' ? args[3] : {};
    if (options.align === 'right') x -= width;
    if (options.align === 'center') x -= width / 2;
    // jsPDF's y coordinate is a baseline. Keep the recorded primitive at that
    // baseline; font ascent is renderer-specific and is not a layout box.
    const height = 0;
    return { x, y, width, height, text: Array.isArray(value) ? value.join(' ') : String(value) };
  }, 'text', output);
  install(doc, 'rect', (args) => ({ x: numberAt(args[0]), y: numberAt(args[1]), width: numberAt(args[2]), height: numberAt(args[3]) }), 'rect', output);
  install(doc, 'roundedRect', (args) => ({ x: numberAt(args[0]), y: numberAt(args[1]), width: numberAt(args[2]), height: numberAt(args[3]) }), 'roundedRect', output);
  install(doc, 'circle', (args) => {
    const radius = numberAt(args[2]);
    return { x: numberAt(args[0]) - radius, y: numberAt(args[1]) - radius, width: radius * 2, height: radius * 2 };
  }, 'circle', output);
  install(doc, 'line', (args) => ({ x: Math.min(numberAt(args[0]), numberAt(args[2])), y: Math.min(numberAt(args[1]), numberAt(args[3])), width: Math.abs(numberAt(args[2]) - numberAt(args[0])), height: Math.abs(numberAt(args[3]) - numberAt(args[1])) }), 'line', output);
  install(doc, 'addImage', (args) => ({ x: numberAt(args[2]), y: numberAt(args[3]), width: numberAt(args[4]), height: numberAt(args[5]) }), 'image', output);
}
