function readUint16(font: Uint8Array, at: number): number {
  return (font[at] << 8) | font[at + 1];
}

function readUint32(font: Uint8Array, at: number): number {
  return ((font[at] << 24) | (font[at + 1] << 16) | (font[at + 2] << 8) | font[at + 3]) >>> 0;
}

function findCmapTable(font: Uint8Array): number | undefined {
  const tables = readUint16(font, 4);
  for (let index = 0; index < tables; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(font[record], font[record + 1], font[record + 2], font[record + 3]);
    if (tag === 'cmap') return readUint32(font, record + 8);
  }
  return undefined;
}

function pickUnicodeSubtable(font: Uint8Array, cmap: number): number | undefined {
  const encodings = readUint16(font, cmap + 2);
  let format4: number | undefined;
  let format12: number | undefined;
  for (let index = 0; index < encodings; index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = readUint16(font, record);
    const encoding = readUint16(font, record + 2);
    const subtable = cmap + readUint32(font, record + 4);
    const format = readUint16(font, subtable);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    if (format === 12) format12 = subtable;
    else if (format === 4 && format4 === undefined) format4 = subtable;
  }
  return format12 ?? format4;
}

function collectFormat4(font: Uint8Array, subtable: number, covered: Set<number>): void {
  const segments = readUint16(font, subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment += 1) {
    const end = readUint16(font, endCodes + segment * 2);
    const start = readUint16(font, startCodes + segment * 2);
    if (start > end || start === 0xffff) continue;
    const rangeOffset = readUint16(font, rangeOffsets + segment * 2);
    for (let code = start; code <= end && code !== 0xffff; code += 1) {
      if (rangeOffset === 0) {
        covered.add(code);
        continue;
      }
      const glyphAt = rangeOffsets + segment * 2 + rangeOffset + (code - start) * 2;
      if (glyphAt + 1 < font.length && readUint16(font, glyphAt) !== 0) covered.add(code);
    }
  }
}

function collectFormat12(font: Uint8Array, subtable: number, covered: Set<number>): void {
  const groups = readUint32(font, subtable + 12);
  for (let group = 0; group < groups; group += 1) {
    const at = subtable + 16 + group * 12;
    if (at + 11 >= font.length) return;
    const start = readUint32(font, at);
    const end = readUint32(font, at + 4);
    if (readUint32(font, at + 8) === 0) continue;
    if (start > end || start > 0x10ffff) continue;
    for (let code = start; code <= Math.min(end, 0x10ffff); code += 1) covered.add(code);
  }
}

const coverageCache = new WeakMap<Uint8Array, Set<number>>();

/** Read Unicode code-point coverage from a TrueType font's cmap table. */
export function fontCoverage(font: Uint8Array): Set<number> | undefined {
  const cached = coverageCache.get(font);
  if (cached) return cached;
  try {
    const cmap = findCmapTable(font);
    if (cmap === undefined) return undefined;
    const subtable = pickUnicodeSubtable(font, cmap);
    if (subtable === undefined) return undefined;
    const covered = new Set<number>();
    if (readUint16(font, subtable) === 12) collectFormat12(font, subtable, covered);
    else collectFormat4(font, subtable, covered);
    if (covered.size === 0) return undefined;
    coverageCache.set(font, covered);
    return covered;
  } catch {
    return undefined;
  }
}
