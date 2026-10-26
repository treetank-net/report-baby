import type { RecipeArgValue } from './recipe.js';

export interface RecipePeriod {
  start: string;
  end: string;
}

export type PeriodPreset = 'yesterday' | 'last_7_days' | 'last_28_days' | 'last_week' | 'last_month' | 'month_to_date';
export type ComparisonMode = 'previous_period' | 'previous_year';

export const PERIOD_PRESETS: readonly PeriodPreset[] = ['yesterday', 'last_7_days', 'last_28_days', 'last_week', 'last_month', 'month_to_date'];
export const COMPARISON_MODES: readonly ComparisonMode[] = ['previous_period', 'previous_year'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return isoDay(new Date(utcDate(iso).getTime() + days * DAY_MS));
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isoFromParts(year: number, monthIndex: number, day: number): string {
  return isoDay(new Date(Date.UTC(year, monthIndex, day)));
}

export function localToday(now: Date = new Date()): string {
  return isoFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

export function assertValidPeriod(period: RecipePeriod): void {
  for (const [label, value] of [['start', period.start], ['end', period.end]] as const) {
    if (!ISO_DATE.test(value) || Number.isNaN(utcDate(value).getTime()) || isoDay(utcDate(value)) !== value) throw new Error(`${label} '${value}' must be a calendar date in YYYY-MM-DD form.`);
  }
  if (period.start > period.end) throw new Error(`start ${period.start} is after end ${period.end}.`);
}

export function presetPeriod(preset: PeriodPreset, today: string): RecipePeriod {
  const yesterday = addDays(today, -1);
  const date = utcDate(today);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  switch (preset) {
    case 'yesterday': return { start: yesterday, end: yesterday };
    case 'last_7_days': return { start: addDays(today, -7), end: yesterday };
    case 'last_28_days': return { start: addDays(today, -28), end: yesterday };
    case 'last_week': {
      const daysSinceMonday = (date.getUTCDay() + 6) % 7;
      const thisMonday = addDays(today, -daysSinceMonday);
      return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
    }
    case 'last_month': return { start: isoFromParts(year, month - 1, 1), end: isoFromParts(year, month, 0) };
    case 'month_to_date': {
      if (date.getUTCDate() === 1) throw new Error('month_to_date is empty on the first day of a month; use last_month.');
      return { start: isoFromParts(year, month, 1), end: yesterday };
    }
  }
}

function coversWholeMonths(period: RecipePeriod): boolean {
  const end = utcDate(period.end);
  return period.start.endsWith('-01') && end.getUTCDate() === lastDayOfMonth(end.getUTCFullYear(), end.getUTCMonth());
}

function shiftYear(iso: string, years: number): string {
  const date = utcDate(iso);
  const year = date.getUTCFullYear() + years;
  const day = Math.min(date.getUTCDate(), lastDayOfMonth(year, date.getUTCMonth()));
  return isoFromParts(year, date.getUTCMonth(), day);
}

export function comparisonPeriod(period: RecipePeriod, mode: ComparisonMode): RecipePeriod {
  if (mode === 'previous_year') return { start: shiftYear(period.start, -1), end: shiftYear(period.end, -1) };
  if (coversWholeMonths(period)) {
    const start = utcDate(period.start);
    const end = utcDate(period.end);
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    return { start: isoFromParts(start.getUTCFullYear(), start.getUTCMonth() - months, 1), end: addDays(period.start, -1) };
  }
  const days = Math.round((utcDate(period.end).getTime() - utcDate(period.start).getTime()) / DAY_MS) + 1;
  return { start: addDays(period.start, -days), end: addDays(period.start, -1) };
}

function periodSubstitutions(period: RecipePeriod, prefix: string): Record<string, string> {
  const startIso = `${period.start}T00:00:00.000Z`;
  const endIso = `${period.end}T23:59:59.999Z`;
  return {
    [`{{${prefix}start}}`]: period.start,
    [`{{${prefix}end}}`]: period.end,
    [`{{${prefix}start_iso}}`]: startIso,
    [`{{${prefix}end_iso}}`]: endIso,
    [`{{${prefix}start_ms}}`]: String(Date.parse(startIso)),
    [`{{${prefix}end_ms}}`]: String(Date.parse(endIso)),
  };
}

export function substitutePeriods(value: RecipeArgValue, period: RecipePeriod, comparison: RecipePeriod | undefined): RecipeArgValue {
  if (typeof value === 'string') {
    const substitutions = { ...(comparison ? periodSubstitutions(comparison, 'prev_') : {}), ...periodSubstitutions(period, '') };
    let text = value;
    for (const [placeholder, replacement] of Object.entries(substitutions)) text = text.split(placeholder).join(replacement);
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => substitutePeriods(item, period, comparison));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitutePeriods(item, period, comparison)]));
  return value;
}
