import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runProcess } from './process.mjs';

/**
 * @test-decision visual-gate
 * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
 */
export function decodePpm(buffer) {
  if (buffer.subarray(0, 2).toString('ascii') !== 'P6') throw new Error('raster output must be an RGB PPM');
  let offset = 2;
  /**
   * @test-decision visual-gate
   * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
   */
  const token = () => {
    while (offset < buffer.length && /\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 35) {
      while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      return token();
    }
    const start = offset;
    while (offset < buffer.length && !/\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
    return buffer.subarray(start, offset).toString('ascii');
  };
  const width = Number(token());
  const height = Number(token());
  if (Number(token()) !== 255) throw new Error('raster output must use 8-bit RGB samples');
  if (!/\s/u.test(String.fromCharCode(buffer[offset]))) throw new Error('raster output is missing the header delimiter');
  // Consume the header delimiter only: binary pixel values may themselves be
  // whitespace bytes and must not be skipped.
  offset += buffer[offset] === 13 && buffer[offset + 1] === 10 ? 2 : 1;
  const pixels = buffer.subarray(offset);
  if (!Number.isInteger(width) || !Number.isInteger(height) || pixels.length < width * height * 3) throw new Error('raster output is truncated');
  return { width, height, pixels };
}

/**
 * @test-decision visual-gate
 * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
 */
function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 3;
  return [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
}

/**
 * @test-decision visual-gate
 * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
 */
export function inkProfileInBox(image, box, pageSize, qa) {
  const scaleX = image.width / pageSize.width;
  const scaleY = image.height / pageSize.height;
  const inset = qa.rectangle_inset_px;
  const x0 = Math.max(0, Math.floor(box.x * scaleX) + inset);
  const y0 = Math.max(0, Math.floor(box.y * scaleY) + inset);
  const x1 = Math.min(image.width - 1, Math.ceil((box.x + box.width) * scaleX) - inset);
  const y1 = Math.min(image.height - 1, Math.ceil((box.y + box.height) * scaleY) - inset);
  const background = pixelAt(image, 0, 0);
  let inkPixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const rowInk = [];
  for (let y = y0; y <= y1; y += 1) {
    let rowCount = 0;
    let rowMinX = Number.POSITIVE_INFINITY;
    let rowMaxX = Number.NEGATIVE_INFINITY;
    for (let x = x0; x <= x1; x += 1) {
      const pixel = pixelAt(image, x, y);
      const isInk = Math.max(
        Math.abs(pixel[0] - background[0]),
        Math.abs(pixel[1] - background[1]),
        Math.abs(pixel[2] - background[2]),
      ) >= qa.background_delta_min;
      if (!isInk) continue;
      inkPixels += 1;
      rowCount += 1;
      rowMinX = Math.min(rowMinX, x);
      rowMaxX = Math.max(rowMaxX, x);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (rowCount > 0) rowInk.push({ y, inkPixels: rowCount, minX: rowMinX, maxX: rowMaxX });
  }
  const bands = [];
  for (const row of rowInk) {
    const previous = bands.at(-1);
    if (previous && row.y === previous.endY + 1) {
      previous.endY = row.y;
      previous.inkPixels += row.inkPixels;
      previous.minX = Math.min(previous.minX, row.minX);
      previous.maxX = Math.max(previous.maxX, row.maxX);
    } else bands.push({ startY: row.y, endY: row.y, inkPixels: row.inkPixels, minX: row.minX, maxX: row.maxX });
  }
  /**
   * @test-decision visual-gate
   * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
   */
  const toMm = (value, scale) => value / scale;
  return {
    status: inkPixels === 0 ? 'empty' : 'occupied',
    inkPixels,
    boxMm: { x: box.x, y: box.y, width: box.width, height: box.height },
    boundsPx: inkPixels === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    boundsMm: inkPixels === 0 ? null : { x: toMm(minX, scaleX), y: toMm(minY, scaleY), width: toMm(maxX - minX + 1, scaleX), height: toMm(maxY - minY + 1, scaleY) },
    rowBands: bands.map((band) => ({ x: toMm(band.minX, scaleX), y: toMm(band.startY, scaleY), width: toMm(band.maxX - band.minX + 1, scaleX), height: toMm(band.endY - band.startY + 1, scaleY), inkPixels: band.inkPixels })),
  };
}

/**
 * @test-decision visual-gate
 * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
 */
export async function inspectPdfInk({ artifactPath, pages, lines, slots, pageSize, qa }) {
  if (!qa || !Number.isFinite(qa.raster_dpi)) throw new Error('render config must define quality.pdf_pixel_qa.raster_dpi');
  const rasterDirectory = await mkdtemp(join(tmpdir(), 'report-baby-ink-raster-'));
  try {
    const prefix = join(rasterDirectory, 'page');
    const raster = runProcess('pdftoppm', ['-f', '1', '-l', String(pages.length), '-r', String(qa.raster_dpi), artifactPath, prefix], { timeout: 30_000 });
    if (raster.status !== 0) throw new Error(raster.stderr || raster.stdout || 'pdftoppm failed');
    const rasterFiles = new Map((await readdir(rasterDirectory)).flatMap((filename) => {
      const match = /^page-(\d+)\.ppm$/u.exec(filename);
      return match ? [[Number(match[1]), join(rasterDirectory, filename)]] : [];
    }));
    const images = pages.map((page) => {
      const path = rasterFiles.get(page.page);
      if (!path) throw new Error(`missing raster page ${page.page}`);
      return { page: page.page, image: decodePpm(readFileSync(path)) };
    });
    /**
     * @test-decision visual-gate
     * @test-action Keep this backend/artifact helper behind one showcase or compatibility gate; plan assertions must not call it.
     */
    const profile = (item) => {
      const image = images.find((candidate) => candidate.page === item.page)?.image;
      if (!image) throw new Error(`missing raster page ${item.page}`);
      return { page: item.page, ...(item.id ? { id: item.id } : {}), ...(item.slotId ? { slotId: item.slotId } : {}), ...inkProfileInBox(image, item.box, pageSize, qa) };
    };
    return {
      coordinateSystem: { unit: 'mm', origin: 'top-left of page', pageWidth: pageSize.width, pageHeight: pageSize.height },
      rasterDpi: qa.raster_dpi,
      backgroundDeltaMin: qa.background_delta_min,
      minimumInkPixels: qa.minimum_ink_pixels,
      lineChecks: lines.map(profile),
      slotChecks: slots.map(profile),
    };
  } finally {
    await rm(rasterDirectory, { recursive: true, force: true });
  }
}
