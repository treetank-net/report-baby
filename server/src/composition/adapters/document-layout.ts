import type { DocumentLayoutInput } from '../../contracts/input/schema.js';

export interface CompositionPageTemplateAssignment {
  from: number;
  to?: number;
  templateRef: string;
  pageTemplateId?: string;
}

export interface DocumentLayoutVariant {
  entries: CompositionPageTemplateAssignment[];
  /** Finite upper bound; an open `remaining` tail has no finite bound here. */
  maxPages?: number;
}

interface EntryBranch {
  assignment: CompositionPageTemplateAssignment;
  nextPage?: number;
}

function startPage(previousTo: number | undefined): number {
  return previousTo === undefined ? 1 : previousTo + 1;
}

function exactEnd(from: number, count: number): number {
  return from + count - 1;
}

function entryBranches(
  input: DocumentLayoutInput[number],
  previousTo: number | undefined,
  index: number,
  isLast: boolean,
): EntryBranch[] {
  const first = index === 0;
  const pages = input.pages;
  const templateRef = input.template;
  const expectedFrom = startPage(previousTo);

  if (pages === 'remaining') {
    if (!isLast) return [];
    return [{ assignment: { from: expectedFrom, templateRef } }];
  }

  if ('from' in pages) {
    if (first && pages.from !== 1) return [];
    if (pages.from !== expectedFrom) return [];
    return [{
      assignment: { from: pages.from, to: pages.to, templateRef },
      nextPage: pages.to,
    }];
  }

  const count = pages.count;
  const counts = typeof count === 'number'
    ? [count]
    : Array.from({ length: count.max - count.min + 1 }, (_, offset) => count.min + offset);
  return counts.map((length) => {
    const to = exactEnd(expectedFrom, length);
    return {
      assignment: { from: expectedFrom, to, templateRef },
      nextPage: to,
    };
  });
}

function formatBranchSummary(input: DocumentLayoutInput): string {
  return input.map((entry, index) => `entry ${index}: ${JSON.stringify(entry.pages)} -> ${entry.template}`).join('; ');
}

/**
 * Normalize the canonical document layout into contiguous page assignments.
 * Count ranges are expanded into deterministic variants; branches that cannot
 * join a following absolute range are discarded before the final validation.
 */
export function normalizeDocumentLayout(input: DocumentLayoutInput): DocumentLayoutVariant[] {
  const variants: DocumentLayoutVariant[] = [];
  const visit = (index: number, previousTo: number | undefined, entries: CompositionPageTemplateAssignment[]): void => {
    if (index >= input.length) {
      const last = entries.at(-1);
      variants.push({
        entries,
        ...(last?.to === undefined ? {} : { maxPages: last.to }),
      });
      return;
    }
    for (const branch of entryBranches(input[index], previousTo, index, index === input.length - 1)) {
      visit(index + 1, branch.nextPage, [...entries, branch.assignment]);
    }
  };
  visit(0, undefined, []);
  if (variants.length === 0) {
    throw new Error(`No contiguous document layout variant exists. ${formatBranchSummary(input)}`);
  }
  return variants;
}

/** Discard finite layout branches that cannot fit the configured page limit. */
export function documentLayoutVariantsWithinPageLimit(
  variants: DocumentLayoutVariant[],
  maxPages: number,
): DocumentLayoutVariant[] {
  const bounded = variants.filter((variant) => variant.maxPages === undefined || variant.maxPages <= maxPages);
  if (bounded.length === 0) {
    const finiteEnds = variants.map((variant) => variant.maxPages).filter((value): value is number => value !== undefined);
    const shortest = Math.min(...finiteEnds);
    throw new Error(`No document layout variant fits the configured page limit of ${maxPages}; the shortest finite variant ends at page ${shortest}. Shorten a layout span or increase the configured limit.`);
  }
  return bounded;
}

/** Return the assignment that owns one materialized page. */
export function pageTemplateAssignmentForPage(
  assignments: CompositionPageTemplateAssignment[],
  page: number,
): CompositionPageTemplateAssignment | undefined {
  return assignments.find((entry) => page >= entry.from && (entry.to === undefined || page <= entry.to));
}
