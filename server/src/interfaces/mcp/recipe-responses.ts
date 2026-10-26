import type { FieldProfile } from '../../recipes/inspection.js';
import type { RecordCell } from '../../recipes/records.js';

type TableCell = RecordCell | undefined;

function tsvCell(value: TableCell): string {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

export function tsvTable(headLines: string[], rows: Record<string, TableCell>[], preferredColumns?: string[]): string {
  const discovered = preferredColumns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const columns = discovered.filter((column) => rows.some((row) => tsvCell(row[column]) !== ''));
  const lines = headLines.map((line) => `# ${line}`);
  if (columns.length && rows.length) {
    lines.push(columns.join('\t'));
    for (const row of rows) lines.push(columns.map((column) => tsvCell(row[column])).join('\t'));
  }
  return lines.join('\n');
}

export function fieldProfileRows(fields: FieldProfile[]): Record<string, TableCell>[] {
  return fields.map((profile) => ({
    field: profile.field,
    kind: profile.kind,
    present: profile.present,
    distinct: profile.distinct,
    min: profile.min,
    max: profile.max,
    sum: profile.sum,
    top: profile.top?.map((entry) => `${entry.value}:${entry.count}`).join(' ~ '),
  }));
}

export const FIELD_PROFILE_COLUMNS = ['field', 'kind', 'present', 'distinct', 'min', 'max', 'sum', 'top'];
