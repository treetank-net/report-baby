/**
 * Normalize authored text to the word sequence used by wrapping, planning
 * traces and evaluator coverage checks.
 */
export function wordsOf(text: string | undefined): string[] {
  return text?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

/** Return the authored word count using the shared tokenization rule. */
export function wordCountOf(text: string | undefined): number {
  return wordsOf(text).length;
}
