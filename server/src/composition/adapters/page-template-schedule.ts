/**
 * A page-template schedule is a document-level declaration.  It selects the
 * template used to materialise a page; it never selects a flow or a slot.
 */
export interface PageTemplateScheduleCountRange {
  min: number;
  max: number;
}

export type PageTemplateScheduleCount = number | PageTemplateScheduleCountRange;

export interface PageTemplateScheduleEntryInput {
  pages: {
    from?: number;
    to?: number;
    count?: PageTemplateScheduleCount;
  };
  templateRef: string;
}

export interface NormalizedPageTemplateRange {
  from: number;
  to?: number;
  templateRef: string;
}

export interface PageTemplateScheduleVariant {
  entries: NormalizedPageTemplateRange[];
  /** The finite upper bound, when the schedule has no open tail. */
  maxPages?: number;
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${path} must be a positive integer.`);
  return value;
}

function validateCount(count: PageTemplateScheduleCount, path: string): PageTemplateScheduleCount {
  if (typeof count === 'number') return positiveInteger(count, path);
  const min = positiveInteger(count.min, `${path}.min`);
  const max = positiveInteger(count.max, `${path}.max`);
  if (min > max) throw new Error(`${path}.min must not exceed ${path}.max.`);
  return { min, max };
}

function countValues(count: PageTemplateScheduleCountRange): number[] {
  return Array.from({ length: count.max - count.min + 1 }, (_, index) => count.min + index);
}

function entryVariants(
  input: PageTemplateScheduleEntryInput,
  previousTo: number | undefined,
  isFirst: boolean,
  isLast: boolean,
): Array<{ ranges: NormalizedPageTemplateRange[]; nextTo?: number }> {
  const { pages, templateRef } = input;
  if (typeof templateRef !== 'string' || templateRef.length === 0) {
    throw new Error('page_template_schedule.template_ref must be a non-empty string.');
  }
  const from = pages.from ?? (previousTo === undefined ? 1 : previousTo + 1);
  positiveInteger(from, 'page_template_schedule.pages.from');
  if (isFirst && from !== 1) throw new Error('The first page-template schedule entry must start at page 1.');
  if (pages.to !== undefined) positiveInteger(pages.to, 'page_template_schedule.pages.to');
  if (pages.to !== undefined && pages.to < from) throw new Error('page_template_schedule.pages.to must not precede from.');
  const count = pages.count === undefined ? undefined : validateCount(pages.count, 'page_template_schedule.pages.count');
  if (pages.to !== undefined && count !== undefined) {
    if (typeof count === 'number' && pages.to - from + 1 !== count) {
      throw new Error('page_template_schedule.pages.from, to and count must describe the same range.');
    }
    if (typeof count !== 'number' && (pages.to - from + 1 < count.min || pages.to - from + 1 > count.max)) {
      throw new Error('page_template_schedule.pages.to must fall within the supplied count range.');
    }
  }
  if (pages.to === undefined && count === undefined && !isLast) {
    throw new Error('An open page-template schedule entry must be the final entry.');
  }
  if (pages.to === undefined && count === undefined) {
    return [{ ranges: [{ from, templateRef }], nextTo: undefined }];
  }
  if (pages.to !== undefined) {
    return [{ ranges: [{ from, to: pages.to, templateRef }], nextTo: pages.to }];
  }
  if (typeof count === 'number') {
    const to = from + count - 1;
    return [{ ranges: [{ from, to, templateRef }], nextTo: to }];
  }
  if (!count || typeof count === 'number') throw new Error('Invalid page-template schedule count range.');
  const range = count;
  return countValues(range).map((length) => {
    const to = from + length - 1;
    return { ranges: [{ from, to, templateRef }], nextTo: to };
  });
}

function normalizeEntryShape(input: PageTemplateScheduleEntryInput, index: number): PageTemplateScheduleEntryInput {
  if (!input || typeof input !== 'object' || !input.pages || typeof input.pages !== 'object') {
    throw new Error(`page_template_schedule[${index}].pages must be an object.`);
  }
  const pages = input.pages;
  if (pages.to !== undefined && pages.from === undefined && pages.count === undefined) {
    throw new Error(`page_template_schedule[${index}].pages.to requires from or count.`);
  }
  return input;
}

function validateContiguity(entries: NormalizedPageTemplateRange[]): void {
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const next = entries[index + 1];
    if (!next || current.to === undefined) {
      if (current.to === undefined && next) throw new Error('An open page-template schedule entry must be final.');
      continue;
    }
    if (next.from !== current.to + 1) throw new Error('Page-template schedule entries must be contiguous without gaps or overlaps.');
  }
}

/** Normalize exact and ranged schedule entries into deterministic candidates. */
export function normalizePageTemplateSchedule(input: PageTemplateScheduleEntryInput[]): PageTemplateScheduleVariant[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('page_template_schedule must contain at least one entry.');
  const normalized = input.map(normalizeEntryShape);
  const variants: PageTemplateScheduleVariant[] = [];
  const visit = (index: number, previousTo: number | undefined, entries: NormalizedPageTemplateRange[]): void => {
    if (index >= normalized.length) {
      validateContiguity(entries);
      const last = entries.at(-1);
      variants.push({ entries, ...(last?.to === undefined ? {} : { maxPages: last.to }) });
      return;
    }
    const options = entryVariants(normalized[index], previousTo, index === 0, index === normalized.length - 1);
    for (const option of options) visit(index + 1, option.nextTo, [...entries, ...option.ranges]);
  };
  visit(0, undefined, []);
  return variants;
}

/** Return the template reference selected for one page, if the page is covered. */
export function templateRefAtPage(schedule: PageTemplateScheduleVariant, page: number): string | undefined {
  return schedule.entries.find((entry) => page >= entry.from && (entry.to === undefined || page <= entry.to))?.templateRef;
}
