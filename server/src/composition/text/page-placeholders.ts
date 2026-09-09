/** Resolve the page metadata placeholders shared by planning and rendering. */
export function resolvePagePlaceholders(text: string, page: number, pageCount: number): string {
  return text
    .replaceAll('{{page.number}}', String(page))
    .replaceAll('{{page.count}}', String(pageCount));
}
