import { inflateSync } from 'node:zlib';

export interface PngRaster {
  width: number;
  height: number;
  channels: 3 | 4;
  pixels: Buffer;
}

function uint32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32BE(offset);
}

/** Decode the PNG forms accepted by the asset preparation path into pixels. */
export function decodePng(source: Buffer): PngRaster {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!source.subarray(0, 8).equals(signature)) throw new Error('Only PNG assets can be decoded into a raster.');
  let width = 0;
  let height = 0;
  let channels: 3 | 4 = 3;
  let interlace = 0;
  const idat: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= source.length) {
    const length = uint32(source, offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = uint32(data, 0);
      height = uint32(data, 4);
      const bitDepth = data[8];
      const colorType = data[9];
      interlace = data[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[10] !== 0 || data[11] !== 0 || interlace !== 0) {
        throw new Error('PNG rasters must be non-interlaced 8-bit RGB or RGBA images.');
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (!width || !height || idat.length === 0) throw new Error('PNG is missing image data.');
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * rowBytes);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[sourceOffset++];
    const rowStart = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const above = y > 0 ? pixels[rowStart - rowBytes + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowStart - rowBytes + x - channels] : 0;
      const value = raw[sourceOffset++];
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = above;
      else if (filter === 3) predicted = Math.floor((left + above) / 2);
      else if (filter === 4) {
        const estimate = left + above - upperLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - above);
        const pc = Math.abs(estimate - upperLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
      pixels[rowStart + x] = (value + predicted) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

export function decodePngDataUri(data: string): PngRaster | undefined {
  const match = /^data:image\/png;base64,(.+)$/su.exec(data);
  if (!match) return undefined;
  try {
    return decodePng(Buffer.from(match[1], 'base64'));
  } catch {
    return undefined;
  }
}
