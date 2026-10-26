export type RecordCell = string | number | boolean | null;
export type FlatRecord = Record<string, RecordCell>;

export interface ExtractedRecords {
  format: 'json' | 'tsv' | 'text';
  records: FlatRecord[];
  totalReported?: number;
  nextPage?: Record<string, string>;
}

const RECORD_ARRAY_KEYS = ['results', 'rows', 'data', 'items', 'records'];
const HOISTED_OBJECT_KEYS = new Set(['properties']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

export function responseTexts(toolResponse: unknown): string[] {
  if (typeof toolResponse === 'string') return [toolResponse];
  if (Array.isArray(toolResponse)) {
    return toolResponse.flatMap((block) => (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []));
  }
  if (isPlainObject(toolResponse) && Array.isArray(toolResponse.content)) return responseTexts(toolResponse.content);
  return [];
}

function flattenInto(target: FlatRecord, value: unknown, prefix: string): void {
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) flattenInto(target, item, `${prefix}.${key}`);
    return;
  }
  if (Array.isArray(value)) target[prefix] = JSON.stringify(value);
  else if (value === undefined) return;
  else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) target[prefix] = value;
  else target[prefix] = String(value);
}

export function flattenRecord(value: Record<string, unknown>): FlatRecord {
  const record: FlatRecord = {};
  for (const [key, item] of Object.entries(value)) {
    if (HOISTED_OBJECT_KEYS.has(key) && isPlainObject(item)) {
      for (const [innerKey, innerValue] of Object.entries(item)) {
        if (!(innerKey in value)) flattenInto(record, innerValue, innerKey);
      }
    } else flattenInto(record, item, key);
  }
  return record;
}

function locateRecordArray(document: unknown): Record<string, unknown>[] | undefined {
  if (isRecordArray(document)) return document;
  if (Array.isArray(document)) return [];
  if (!isPlainObject(document)) return undefined;
  for (const key of RECORD_ARRAY_KEYS) {
    if (isRecordArray(document[key])) return document[key];
    if (Array.isArray(document[key])) return [];
  }
  return Object.values(document).find(isRecordArray);
}

function jsonPaging(document: unknown): Pick<ExtractedRecords, 'totalReported' | 'nextPage'> {
  if (!isPlainObject(document)) return {};
  const totalReported = typeof document.total === 'number' ? document.total : typeof document.rowCount === 'number' ? document.rowCount : undefined;
  const nextPage: Record<string, string> = {};
  const after = isPlainObject(document.paging) && isPlainObject(document.paging.next) ? document.paging.next.after : undefined;
  if (typeof after === 'string' || typeof after === 'number') nextPage.after = String(after);
  if (typeof document.nextPageToken === 'string' && document.nextPageToken) nextPage.pageToken = document.nextPageToken;
  const records = locateRecordArray(document)?.length ?? 0;
  if (typeof document.offset === 'number' && totalReported !== undefined && document.offset < totalReported && records > 0) nextPage.offset = String(document.offset);
  return { ...(totalReported !== undefined ? { totalReported } : {}), ...(Object.keys(nextPage).length ? { nextPage } : {}) };
}

function parseJsonDocument(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/^[[{]/m);
    if (start <= 0) return undefined;
    try {
      return JSON.parse(trimmed.slice(start));
    } catch {
      return undefined;
    }
  }
}

function tsvCell(value: string): RecordCell {
  if (value === '') return null;
  return value.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
}

function parseTsvDocument(text: string): ExtractedRecords | undefined {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const comments = lines.filter((line) => line.startsWith('#'));
  const body = lines.filter((line) => line.trim() !== '' && !line.startsWith('#'));
  if (body.length === 0 || !body[0].includes('\t')) return undefined;
  const header = body[0].split('\t');
  const constants: FlatRecord = {};
  const constantLine = comments.find((line) => /^# [a-z_][\w.]*=/.test(line) && !line.startsWith('# totals'));
  if (constantLine) {
    for (const match of constantLine.slice(2).matchAll(/([a-z_][\w.]*)=(\S*)/g)) constants[match[1]] = tsvCell(match[2]);
  }
  const records = body.slice(1).map((line) => {
    const cells = line.split('\t');
    const record: FlatRecord = { ...constants };
    header.forEach((column, index) => {
      record[column] = tsvCell(cells[index] ?? '');
    });
    return record;
  });
  const pageNote = comments.map((line) => line.match(/page: (\d+) for more/)).find(Boolean);
  return { format: 'tsv', records, ...(pageNote ? { nextPage: { page: pageNote[1] } } : {}) };
}

export function extractRecords(toolResponse: unknown): ExtractedRecords {
  const texts = responseTexts(toolResponse);
  const extracted: ExtractedRecords = { format: 'text', records: [] };
  for (const text of texts) {
    const document = parseJsonDocument(text);
    const records = document === undefined ? undefined : locateRecordArray(document);
    if (records) {
      extracted.format = 'json';
      extracted.records.push(...records.map(flattenRecord));
      Object.assign(extracted, jsonPaging(document));
      continue;
    }
    const table = parseTsvDocument(text);
    if (table) {
      extracted.format = 'tsv';
      extracted.records.push(...table.records);
      if (table.nextPage) extracted.nextPage = table.nextPage;
    }
  }
  return extracted;
}
