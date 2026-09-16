/*
 * Test-only migration seam.
 *
 * Production deliberately does not understand the former report object
 * (title/sections/charts/etc.). Existing fixture stories are kept because
 * they are valuable visual/regression cases, but this translator is the only
 * place where those stories are rewritten into the public flow contract.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function legacyFixtureToCompositionInput(report = {}) {
  const flows = {};
  const main = [];
  /**
   * @test-decision plan-fixture-or-assertion
   * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
   */
  const add = (type, value) => { if (value !== undefined && value !== null) main.push({ type, ...value }); };

  if (report.intro?.trim()) add('text', { id: 'intro', role: 'intro', text: report.intro });
  for (const [index, metric] of (report.kpis ?? []).entries()) add('metric', { id: `metric-${index + 1}`, ...metric });
  for (const [index, chart] of (report.charts ?? []).entries()) {
    const { type, ...rest } = chart;
    add('chart', { id: `chart-${index + 1}`, chart_type: type, ...rest });
  }
  for (const [index, section] of (report.sections ?? []).entries()) {
    const sectionId = `section-${index + 1}`;
    add('heading', { id: `${sectionId}-heading`, role: 'heading', text: section.heading, level: section.level });
    if (section.body?.trim() || section.content?.length) {
      add('text', { id: `${sectionId}-body`, role: 'body', ...(section.body === undefined ? {} : { text: section.body }), ...(section.content === undefined ? {} : { content: section.content }) });
    }
  }
  if (report.table) {
    add('heading', { id: 'table-heading', role: 'heading', text: report.table.caption ?? 'Table' });
    add('table', { id: 'table', role: 'table', ...report.table });
  }
  if (report.highlights?.length) {
    add('heading', { id: 'highlights-heading', role: 'heading', text: report.highlights_title ?? 'Highlights' });
    for (const [index, text] of report.highlights.entries()) add('list-item', { id: `highlight-${index + 1}`, text });
  }
  flows.main = { blocks: main };

  const header = [];
  if (report.brand?.trim()) header.push({ type: 'text', id: 'header-brand', role: 'header', text: report.brand.toUpperCase(), keep_with_next_lines: 1 });
  if (report.title?.trim()) header.push({ type: 'heading', id: 'header-title', role: 'header', text: report.title, keep_with_next_lines: report.subtitle?.trim() ? 1 : 0 });
  if (report.subtitle?.trim()) header.push({ type: 'text', id: 'header-subtitle', role: 'header', text: report.subtitle });
  if (report.period?.trim()) header.push({ type: 'text', id: 'header-period', role: 'header', text: report.period });
  if (header.length) flows.header = { blocks: header };

  if (report.footer?.trim()) flows.footer = { blocks: [{ type: 'text', id: 'footer', role: 'footer', text: `${report.footer}    {{page.number}} / {{page.count}}` }] };

  if (report.title_page) {
    const page = report.title_page;
    const blocks = [];
    if (page.eyebrow?.trim()) blocks.push({ type: 'heading', id: 'title-page-eyebrow', role: 'eyebrow', text: page.eyebrow.toUpperCase(), keep_with_next_lines: 1 });
    if (page.title?.trim()) blocks.push({ type: 'heading', id: 'title-page-title', role: 'title', text: page.title, keep_with_next_lines: page.subtitle?.trim() ? 1 : 0 });
    if (page.subtitle?.trim()) blocks.push({ type: 'text', id: 'title-page-subtitle', role: 'subtitle', text: page.subtitle });
    if (page.period?.trim()) blocks.push({ type: 'text', id: 'title-page-period', role: 'subtitle', text: page.period });
    flows.title = { blocks };
  }

  return { flows };
}
