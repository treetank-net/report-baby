export interface TemplateInfo {
  name: string;
  description: string;
}

const TEMPLATES: TemplateInfo[] = [
  {
    name: 'default-report',
    description: 'Client-facing report with branded header, KPI grid, narrative sections, chart area, and footer.',
  },
  {
    name: 'campaign-summary',
    description: 'Compact performance summary for paid media or analytics work: KPI cards, insights, next actions.',
  },
];

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface DefaultReportData {
  title?: string;
  subtitle?: string;
  brand?: string;
  period?: string;
  intro?: string;
  metrics?: Array<{ label: string; value: string | number; change?: string; note?: string }>;
  sections?: Array<{ heading: string; body: string }>;
  chart_html?: string;
  highlights?: string[];
  footer?: string;
}

function renderDefaultReport(data: DefaultReportData): string {
  const title = escapeHtml(data.title ?? 'Report');
  const subtitle = escapeHtml(data.subtitle ?? '');
  const brand = escapeHtml(data.brand ?? '');
  const period = escapeHtml(data.period ?? '');
  const intro = escapeHtml(data.intro ?? '');
  const footer = escapeHtml(data.footer ?? '');
  const chartHtml = typeof data.chart_html === 'string' && data.chart_html.trim() ? data.chart_html : '';

  const metrics = (data.metrics ?? [])
    .map((m) => `
        <article class="metric-card">
          <div class="metric-label">${escapeHtml(m.label)}</div>
          <div class="metric-value">${escapeHtml(m.value)}</div>
          ${m.change ? `<div class="metric-change">${escapeHtml(m.change)}</div>` : ''}
          ${m.note ? `<div class="metric-note">${escapeHtml(m.note)}</div>` : ''}
        </article>`)
    .join('');

  const sections = (data.sections ?? [])
    .map((s) => `
      <section class="report-section">
        <h2>${escapeHtml(s.heading)}</h2>
        <p>${escapeHtml(s.body)}</p>
      </section>`)
    .join('');

  const highlights = (data.highlights ?? [])
    .map((h) => `<li>${escapeHtml(h)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root {
    --accent: #14532d;
    --accent-2: #0f766e;
    --ink: #111827;
    --muted: #64748b;
    --line: #dbe3ea;
    --soft: #f4f7f6;
    --bg: #ffffff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    font-size: 14px;
    line-height: 1.55;
  }
  .page { max-width: 920px; margin: 0 auto; padding: 48px 56px; }
  .report-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 28px;
    border-bottom: 3px solid var(--accent);
    padding-bottom: 20px;
    margin-bottom: 32px;
  }
  .brand { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  .report-header h1 { font-size: 30px; line-height: 1.12; margin: 6px 0 2px; }
  .report-header .subtitle { color: var(--muted); font-size: 15px; }
  .period { flex: 0 0 auto; text-align: right; color: var(--muted); font-size: 13px; }
  .intro { font-size: 15px; color: #334155; margin: 0 0 26px; max-width: 760px; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 8px 0 30px; }
  .metric-card {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px;
    min-height: 112px;
    background: var(--soft);
  }
  .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .metric-value { font-weight: 750; font-size: 25px; line-height: 1.15; margin-top: 8px; }
  .metric-change { color: var(--accent-2); font-weight: 700; margin-top: 6px; }
  .metric-note { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .content-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(220px, 0.8fr); gap: 28px; align-items: start; }
  .chart-panel {
    border: 1px solid var(--line);
    border-radius: 8px;
    min-height: 260px;
    padding: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    background: #ffffff;
    overflow: hidden;
  }
  .chart-panel svg, .chart-panel canvas, .chart-panel img { max-width: 100%; max-height: 300px; }
  .highlights {
    border-left: 3px solid var(--accent);
    padding: 2px 0 2px 18px;
    margin: 0;
    color: #334155;
  }
  .highlights li { margin: 0 0 10px; }
  .report-section { break-inside: avoid; }
  .report-section h2 { font-size: 18px; margin: 0 0 6px; }
  .report-section p { margin: 0 0 20px; color: #334155; }
  .report-footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
  @media print {
    .page { padding: 38px 44px; }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="report-header">
      <div>
        ${brand ? `<div class="brand">${brand}</div>` : ''}
        <h1>${title}</h1>
        ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
      </div>
      ${period ? `<div class="period">${period}</div>` : ''}
    </header>

    ${intro ? `<p class="intro">${intro}</p>` : ''}

    ${metrics ? `<section class="metrics">${metrics}</section>` : ''}

    <main class="content-grid">
      <div>
        ${sections}
      </div>
      <aside>
        <div class="chart-panel">${chartHtml || 'Chart area'}</div>
        ${highlights ? `<ul class="highlights">${highlights}</ul>` : ''}
      </aside>
    </main>

    ${!sections && !highlights && !chartHtml ? '<section class="report-section"><h2>Summary</h2><p>No narrative content was provided.</p></section>' : ''}

    ${footer ? `<footer class="report-footer">${footer}</footer>` : ''}
  </div>
</body>
</html>`;
}

function renderCampaignSummary(data: DefaultReportData): string {
  return renderDefaultReport({
    title: data.title ?? 'Campaign summary',
    subtitle: data.subtitle ?? 'Performance snapshot and next actions',
    brand: data.brand,
    period: data.period,
    intro: data.intro,
    metrics: data.metrics,
    chart_html: data.chart_html,
    highlights: data.highlights,
    sections: data.sections,
    footer: data.footer,
  });
}

export function renderTemplate(name: string, data: Record<string, unknown>): string {
  if (name === 'default-report') {
    return renderDefaultReport(data as DefaultReportData);
  }
  if (name === 'campaign-summary') {
    return renderCampaignSummary(data as DefaultReportData);
  }
  throw new Error(`Unknown template: ${name}. Available: ${TEMPLATES.map((t) => t.name).join(', ')}`);
}
