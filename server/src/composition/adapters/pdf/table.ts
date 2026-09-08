import type { jsPDF } from 'jspdf';
import type { CompositionBlock, CompositionTable } from '../../model.js';
import type { CompositionPlan, CompositionTextMetrics } from '../../contracts/engine-contracts.js';
import type {
  JsPdfCompositionTableRenderer,
  JsPdfCompositionTableStyle,
} from '../../contracts/pdf.js';

function tableFromBlock(block: CompositionBlock): CompositionTable {
  if (block.kind !== 'table' || !block.table) throw new Error(`Block '${block.id}' is not a table.`);
  return block.table;
}

function tableColumnWidths(pdf: jsPDF, family: string, table: CompositionTable, width: number, style: JsPdfCompositionTableStyle): number[] {
  const columnCount = Math.max(table.head.length, ...table.body.map((row) => row.length), 1);
  pdf.setFont(family, 'normal');
  pdf.setFontSize(style.fontSize);
  const naturalWidths = Array.from({ length: columnCount }, (_, index) => {
    const bodyWidth = Math.max(0, ...table.body.map((row) => pdf.getTextWidth(String(row[index] ?? ''))));
    pdf.setFont(family, 'bold');
    const headWidth = pdf.getTextWidth(String(table.head[index] ?? ''));
    pdf.setFont(family, 'normal');
    return Math.max(bodyWidth, headWidth) + style.cellPadding * 2;
  });
  const naturalTotal = naturalWidths.reduce((sum, item) => sum + item, 0);
  if (!Number.isFinite(naturalTotal) || naturalTotal <= 0) return Array.from({ length: columnCount }, () => width / columnCount);
  return naturalWidths.map((item) => width * item / naturalTotal);
}

function tableLineHeight(style: JsPdfCompositionTableStyle): number {
  return style.fontSize * 25.4 / 72 * style.lineHeightRatio;
}

function tableRowHeight(pdf: jsPDF, family: string, row: Array<string | number>, widths: number[], style: JsPdfCompositionTableStyle, bold: boolean): number {
  pdf.setFont(family, bold ? 'bold' : 'normal');
  pdf.setFontSize(style.fontSize);
  const lineHeight = tableLineHeight(style);
  const lines = row.map((cell, index) => pdf.splitTextToSize(String(cell), Math.max(1, widths[index] - style.cellPadding * 2)) as string[]);
  return Math.max(1, ...lines.map((items) => items.length)) * lineHeight + style.cellPadding * 2;
}

function tableRowsFromBlock(block: CompositionBlock): { table: CompositionTable; head: Array<string | number>; body: Array<Array<string | number>> } {
  const table = tableFromBlock(block);
  return { table, head: table.head, body: table.body };
}

function drawCompositionTable(pdf: jsPDF, family: string, block: CompositionBlock, placement: CompositionPlan['tablePlacements'][number], style: JsPdfCompositionTableStyle): void {
  const { table, head, body } = tableRowsFromBlock(block);
  const widths = tableColumnWidths(pdf, family, table, placement.box.width, style);
  const lineHeight = tableLineHeight(style);
  let y = placement.box.y;
  const drawRow = (row: Array<string | number>, bold: boolean, fill: [number, number, number], rowIndex: number) => {
    const height = tableRowHeight(pdf, family, row, widths, style, bold);
    let x = placement.box.x;
    pdf.setFont(family, bold ? 'bold' : 'normal');
    pdf.setFontSize(style.fontSize);
    pdf.setTextColor(...(bold ? style.headerTextColor : style.textColor));
    row.forEach((cell, index) => {
      const width = widths[index] ?? widths.at(-1)!;
      pdf.setFillColor(...fill);
      pdf.setDrawColor(...style.lineColor);
      pdf.setLineWidth(style.lineWidth);
      pdf.rect(x, y, width, height, 'FD');
      const lines = pdf.splitTextToSize(String(cell), Math.max(1, width - style.cellPadding * 2)) as string[];
      lines.forEach((line, lineIndex) => pdf.text(line, x + style.cellPadding, y + style.cellPadding + lineHeight * (lineIndex + 0.8)));
      x += width;
    });
    y += height;
    return { height, rowIndex };
  };
  if (placement.repeatsHeader || placement.startRow === 0) {
    drawRow(head, true, style.headerFillColor, -1);
  }
  for (let rowIndex = placement.startRow; rowIndex < placement.endRow; rowIndex += 1) {
    drawRow(body[rowIndex] ?? [], false, rowIndex % 2 === 0 ? style.rowFillColor : style.alternateRowFillColor, rowIndex);
  }
}

export function createJsPdfTableBlockCapabilities(
  doc: jsPDF,
  family: string,
  style: JsPdfCompositionTableStyle,
): { measureTable: NonNullable<CompositionTextMetrics['measureTable']>; renderer: JsPdfCompositionTableRenderer } {
  if (!Number.isFinite(style.fontSize) || style.fontSize <= 0 || !Number.isFinite(style.lineHeightRatio) || style.lineHeightRatio <= 0 || !Number.isInteger(style.maxRowsPerFragment) || style.maxRowsPerFragment <= 0) {
    throw new Error('Table block style requires positive font, line-height and row-fragment limits.');
  }
  return {
    measureTable(block, box, startRow, options = { repeatHeader: startRow === 0 }) {
      const { table, head, body } = tableRowsFromBlock(block);
      if (!Number.isFinite(box.width) || box.width <= style.cellPadding * 2) throw new Error(`Table block '${block.id}' has no usable width.`);
      if (!Number.isInteger(startRow) || startRow < 0 || startRow >= body.length) throw new Error(`Table block '${block.id}' has invalid start row ${startRow}.`);
      const widths = tableColumnWidths(doc, family, table, box.width, style);
      let height = options.repeatHeader || startRow === 0
        ? tableRowHeight(doc, family, head, widths, style, true)
        : 0;
      let endRow = startRow;
      while (endRow < body.length && endRow - startRow < style.maxRowsPerFragment) {
        const nextHeight = tableRowHeight(doc, family, body[endRow] ?? [], widths, style, false);
        if (endRow > startRow && height + nextHeight > box.height) break;
        height += nextHeight;
        endRow += 1;
      }
      return { height, endRow };
    },
    renderer(pdf, block, placement) {
      drawCompositionTable(pdf, family, block, placement, style);
    },
  };
}
