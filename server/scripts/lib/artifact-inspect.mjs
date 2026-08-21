import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function zipEntries(buffer) {
  const entries = [];
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('not a ZIP archive');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const method = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function stripTimestamps(buffer) {
  return Buffer.from(buffer.toString('latin1').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, 'QA-TIMESTAMP'), 'latin1');
}

export function pptxContentHash(buffer) {
  const hash = createHash('sha256');
  for (const entry of zipEntries(buffer).sort((left, right) => (left.name < right.name ? -1 : 1))) {
    hash.update(entry.name).update(stripTimestamps(entry.data));
  }
  return hash.digest('hex');
}

export function pdfContentHash(buffer) {
  const normalized = buffer
    .toString('latin1')
    .replace(/\/CreationDate\s*\(D:[^)]*\)/g, '')
    .replace(/\/ModDate\s*\(D:[^)]*\)/g, '')
    .replace(/\/ID\s*\[[^\]]*\]/g, '');
  return sha256(Buffer.from(normalized, 'latin1'));
}
