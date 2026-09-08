/**
 * Normalize authored text to the word sequence used by wrapping, planning
 * traces and evaluator coverage checks.
 */
/**
 * @planner-target composition/text/tokenization.ts
 * @planner-responsibility Keep the current wordsOf implementation intact until its target seam is extracted.
 */
export function wordsOf(text: string | undefined): string[] {
  return text?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

/** Return the authored word count using the shared tokenization rule. */
/**
 * @planner-target composition/text/tokenization.ts
 * @planner-responsibility Keep the current wordCountOf implementation intact until its target seam is extracted.
 */
export function wordCountOf(text: string | undefined): number {
  return wordsOf(text).length;
}
