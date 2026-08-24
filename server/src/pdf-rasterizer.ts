import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);

export async function rasterizePdf(pdf: Buffer, width: number, height: number, firstPage?: number, lastPage?: number): Promise<Buffer[]> {
  const temporary = await mkdtemp(join(tmpdir(), 'report-baby-pdf-raster-'));
  try {
    const pdfPath = join(temporary, 'input.pdf');
    const prefix = join(temporary, 'page');
    await writeFile(pdfPath, pdf);
    const args = ['-png', '-scale-to-x', String(width), '-scale-to-y', String(height)];
    if (firstPage !== undefined) args.push('-f', String(firstPage));
    if (lastPage !== undefined) args.push('-l', String(lastPage));
    args.push(pdfPath, prefix);
    try {
      await execFileAsync('pdftoppm', args, { maxBuffer: 1024 * 1024 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error('Slide PNG output requires the system pdftoppm command (Poppler). Install poppler-utils and retry.');
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`pdftoppm failed while rasterizing the slide PDF: ${message}`);
    }
    const files = (await readdir(temporary)).filter((file) => file.startsWith('page-') && file.endsWith('.png')).sort();
    if (files.length === 0) throw new Error('pdftoppm completed without producing any slide PNG pages.');
    return Promise.all(files.map((file) => readFile(join(temporary, file))));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
