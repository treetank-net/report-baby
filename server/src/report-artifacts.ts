import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import PptxGenJS from 'pptxgenjs';
import { readRenderConfig } from './builtin-template-source.js';

const execFileAsync = promisify(execFile);

function rasterError(error: any): Error {
  if (error?.code === 'ENOENT') return new Error('Report PNG/PPTX output requires the system pdftoppm command (Poppler). Install poppler-utils and retry.');
  return new Error(`Report PDF rasterization failed: ${error?.message ?? error}`);
}

async function rasterizePdf(pdf: Buffer): Promise<Buffer[]> {
  const temporary = await mkdtemp(join(tmpdir(), 'report-baby-report-raster-'));
  try {
    const pdfPath = join(temporary, 'report.pdf');
    const prefix = join(temporary, 'page');
    const config = readRenderConfig().reportOutput;
    await writeFile(pdfPath, pdf);
    try {
      await execFileAsync('pdftoppm', [
        '-png',
        '-scale-to-x', String(config.pngWidthPx),
        '-scale-to-y', '-1',
        pdfPath,
        prefix,
      ], { maxBuffer: 1024 * 1024 });
    } catch (error: any) {
      throw rasterError(error);
    }
    const pageNames = (await readdir(temporary))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0] ?? 0) - Number(right.match(/\d+/)?.[0] ?? 0));
    if (pageNames.length === 0) throw new Error('Report PDF rasterization produced no PNG pages.');
    return await Promise.all(pageNames.map((name) => readFile(join(temporary, name))));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function validatePrefix(prefix: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error('filename_prefix may contain only letters, numbers, underscores, and hyphens.');
}

export async function renderReportPngFiles(pdf: Buffer, outputDir: string, filenamePrefix: string): Promise<string[]> {
  validatePrefix(filenamePrefix);
  const pages = await rasterizePdf(pdf);
  const paths: string[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const path = join(outputDir, `${filenamePrefix}-${String(index + 1).padStart(2, '0')}.png`);
    await writeFile(path, pages[index]);
    paths.push(path);
  }
  return paths;
}

export async function renderReportPptx(pdf: Buffer): Promise<{ buffer: Buffer; pages: number }> {
  const pages = await rasterizePdf(pdf);
  const config = readRenderConfig().reportOutput;
  const layoutName = 'REPORT_BABY_A4';
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: layoutName, width: config.pptxWidthInches, height: config.pptxHeightInches });
  pptx.layout = layoutName;
  pptx.author = 'TreeTank report-baby';
  pptx.company = 'TreeTank';
  pptx.subject = 'Rasterized A4 report';
  pptx.title = 'Report';
  for (const page of pages) {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const data = `data:image/png;base64,${page.toString('base64')}`;
    slide.addImage({ data, x: 0, y: 0, w: config.pptxWidthInches, h: config.pptxHeightInches });
  }
  return { buffer: Buffer.from(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer), pages: pages.length };
}
