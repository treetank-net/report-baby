import { execFileSync } from 'node:child_process';

export class PdfTextExtractionError extends Error {
  constructor(pdfPath, cause) {
    super(`Unable to extract selectable text from PDF '${pdfPath}'.`, { cause });
    this.name = 'PdfTextExtractionError';
    this.code = 'PDF_TEXT_EXTRACTION_FAILED';
    this.pdfPath = pdfPath;
  }
}

/**
 * Extract text while keeping artifact decoding separate from oracle rules.
 * An empty string is a valid extraction result for a PDF without selectable
 * text; only a failed pdftotext process is an extraction error.
 */
export function extractPdfText(pdfPath, options = []) {
  try {
    return execFileSync('pdftotext', [...options, pdfPath, '-'], { encoding: 'utf8' });
  } catch (cause) {
    throw new PdfTextExtractionError(pdfPath, cause);
  }
}

export function extractPdfWords(pdfPath) {
  const xml = extractPdfText(pdfPath, ['-bbox-layout']);
  const result = [];
  let page = 0;
  for (const pageMatch of xml.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/gu)) {
    for (const wordMatch of pageMatch[1].matchAll(/<word\s+xMin="([\d.-]+)"\s+yMin="([\d.-]+)"\s+xMax="([\d.-]+)"\s+yMax="([\d.-]+)"[^>]*>([\s\S]*?)<\/word>/gu)) {
      result.push({
        page,
        xMin: Number(wordMatch[1]),
        yMin: Number(wordMatch[2]),
        xMax: Number(wordMatch[3]),
        yMax: Number(wordMatch[4]),
        text: wordMatch[5].replace(/<[^>]+>/gu, ''),
      });
    }
    page += 1;
  }
  return result;
}
