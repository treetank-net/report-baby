import type { FlatRecord, RecordCell } from './records.js';

export interface InspectionLimits {
  sampleRows: number;
  maxSampleRows: number;
  topValues: number;
  maxAggregateRows: number;
  maxOverviewFields: number;
  maxCellChars: number;
  maxTopValuesDistinctRatio: number;
}

export type FieldKind = 'number' | 'date' | 'boolean' | 'text' | 'identifier';

export interface FieldProfile {
  field: string;
  kind: FieldKind;
  present: number;
  min?: number | string;
  max?: number | string;
  sum?: number;
  distinct?: number;
  top?: { value: string; count: number }[];
}

export type AggregateOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';
export type FilterOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface AggregateMetric {
  op: AggregateOp;
  field?: string;
}

export interface RecordFilter {
  field: string;
  op: FilterOp;
  value?: string;
  values?: string[];
}

export interface AggregateRequest {
  group_by: string[];
  metrics: AggregateMetric[];
  filters: RecordFilter[];
  sort_by?: string;
  limit?: number;
}

const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const IDENTIFIER_FIELD = /(?:^|[._])(?:id|ids|uuid|guid|resource_name)$|(?:^|[._])hs_object_id$/i;

function isPresent(cell: RecordCell | undefined): cell is string | number | boolean {
  return cell !== undefined && cell !== null && cell !== '';
}

export function numericValue(cell: RecordCell | undefined): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell === 'string' && NUMERIC.test(cell.trim())) return Number(cell);
  return undefined;
}

function roundedForDisplay(value: number): number {
  if (Number.isInteger(value)) return value;
  return Math.abs(value) >= 1 ? Math.round(value * 100) / 100 : Number(value.toPrecision(3));
}

function truncated(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}

function classifyField(field: string, values: (string | number | boolean)[]): FieldKind {
  if (IDENTIFIER_FIELD.test(field)) return 'identifier';
  if (values.every((value) => typeof value === 'boolean' || value === 'true' || value === 'false')) return 'boolean';
  if (values.every((value) => numericValue(value) !== undefined)) return 'number';
  if (values.every((value) => typeof value === 'string' && ISO_DATE_PREFIX.test(value))) return 'date';
  return 'text';
}

function fieldsByFrequency(records: FlatRecord[]): string[] {
  const counts = new Map<string, number>();
  for (const record of records) for (const [field, cell] of Object.entries(record)) if (isPresent(cell)) counts.set(field, (counts.get(field) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([field]) => field);
}

function topValues(values: string[], limits: InspectionLimits): { distinct: number; top: { value: string; count: number }[] } {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limits.topValues)
    .map(([value, count]) => ({ value: truncated(value, limits.maxCellChars), count }));
  return { distinct: counts.size, top };
}

export function profileFields(records: FlatRecord[], limits: InspectionLimits): { fields: FieldProfile[]; omittedFields: string[] } {
  const ordered = fieldsByFrequency(records);
  const fields = ordered.slice(0, limits.maxOverviewFields).map((field): FieldProfile => {
    const values = records.map((record) => record[field]).filter(isPresent);
    const kind = classifyField(field, values);
    const profile: FieldProfile = { field, kind, present: values.length };
    if (kind === 'number') {
      const numbers = values.map((value) => numericValue(value) as number);
      return { ...profile, min: roundedForDisplay(Math.min(...numbers)), max: roundedForDisplay(Math.max(...numbers)), sum: roundedForDisplay(numbers.reduce((total, value) => total + value, 0)) };
    }
    if (kind === 'date') {
      const dates = (values as string[]).slice().sort();
      return { ...profile, min: dates[0], max: dates[dates.length - 1] };
    }
    const ranked = topValues(values.map(String), limits);
    if (kind === 'identifier' || (ranked.distinct > limits.topValues && ranked.distinct > values.length * limits.maxTopValuesDistinctRatio)) return { ...profile, distinct: ranked.distinct };
    return { ...profile, ...ranked };
  });
  return { fields, omittedFields: ordered.slice(limits.maxOverviewFields) };
}

export function sampleRecords(records: FlatRecord[], fields: string[] | undefined, rows: number | undefined, limits: InspectionLimits): FlatRecord[] {
  const count = Math.min(Math.max(1, rows ?? limits.sampleRows), limits.maxSampleRows);
  return records.slice(0, count).map((record) => {
    const selected = fields?.length ? fields : Object.keys(record);
    return Object.fromEntries(selected.filter((field) => field in record).map((field) => {
      const cell = record[field];
      return [field, typeof cell === 'string' ? truncated(cell, limits.maxCellChars) : cell];
    }));
  });
}

function compareCells(left: RecordCell | undefined, right: string): number | undefined {
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
  if (!isPresent(left)) return undefined;
  return String(left).localeCompare(right);
}

export function recordMatchesFilter(record: FlatRecord, filter: RecordFilter): boolean {
  const cell = record[filter.field];
  const value = filter.value ?? '';
  switch (filter.op) {
    case 'eq': return compareCells(cell, value) === 0;
    case 'neq': return compareCells(cell, value) !== 0;
    case 'contains': return isPresent(cell) && String(cell).toLowerCase().includes(value.toLowerCase());
    case 'in': return isPresent(cell) && (filter.values ?? []).includes(String(cell));
    case 'gt': return (compareCells(cell, value) ?? -1) > 0;
    case 'gte': return (compareCells(cell, value) ?? -1) >= 0;
    case 'lt': return (compareCells(cell, value) ?? 1) < 0;
    case 'lte': return (compareCells(cell, value) ?? 1) <= 0;
  }
}

export function metricLabel(metric: AggregateMetric): string {
  return metric.field ? `${metric.op}(${metric.field})` : metric.op;
}

function metricValue(records: FlatRecord[], metric: AggregateMetric): number | string | null {
  if (metric.op === 'count') return metric.field ? records.filter((record) => isPresent(record[metric.field as string])).length : records.length;
  if (!metric.field) throw new Error(`Metric '${metric.op}' needs a field.`);
  const field = metric.field;
  if (metric.op === 'distinct') return new Set(records.map((record) => record[field]).filter(isPresent).map(String)).size;
  const numbers = records.map((record) => numericValue(record[field])).filter((value): value is number => value !== undefined);
  if (!numbers.length) {
    if (metric.op !== 'min' && metric.op !== 'max') return null;
    const texts = records.map((record) => record[field]).filter(isPresent).map(String).sort();
    return texts.length ? (metric.op === 'min' ? texts[0] : texts[texts.length - 1]) : null;
  }
  const sum = numbers.reduce((total, value) => total + value, 0);
  if (metric.op === 'sum') return roundedForDisplay(sum);
  if (metric.op === 'avg') return roundedForDisplay(sum / numbers.length);
  return roundedForDisplay(metric.op === 'min' ? Math.min(...numbers) : Math.max(...numbers));
}

export function aggregateRecords(records: FlatRecord[], request: AggregateRequest, limits: InspectionLimits): { rows: Record<string, RecordCell>[]; groups: number; matched: number } {
  const metrics = request.metrics.length ? request.metrics : [{ op: 'count' as const }];
  const matched = records.filter((record) => request.filters.every((filter) => recordMatchesFilter(record, filter)));
  const groups = new Map<string, FlatRecord[]>();
  for (const record of matched) {
    const key = JSON.stringify(request.group_by.map((field) => record[field] ?? null));
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const rows = [...groups.entries()].map(([key, members]) => {
    const keyValues = JSON.parse(key) as RecordCell[];
    const row: Record<string, RecordCell> = Object.fromEntries(request.group_by.map((field, index) => [field, keyValues[index]]));
    for (const metric of metrics) row[metricLabel(metric)] = metricValue(members, metric);
    return row;
  });
  const sortKey = request.sort_by ?? metricLabel(metrics[0]);
  const descending = !sortKey.startsWith('+');
  const column = sortKey.replace(/^[+-]/, '');
  rows.sort((left, right) => {
    const leftNumber = numericValue(left[column]);
    const rightNumber = numericValue(right[column]);
    const order = leftNumber !== undefined && rightNumber !== undefined ? leftNumber - rightNumber : String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
    return descending ? -order : order;
  });
  const limit = Math.min(Math.max(1, request.limit ?? limits.maxAggregateRows), limits.maxAggregateRows);
  return { rows: rows.slice(0, limit), groups: rows.length, matched: matched.length };
}
