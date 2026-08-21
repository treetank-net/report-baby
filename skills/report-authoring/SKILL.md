---
name: report-authoring
description: How to compose polished A4 reports, 16:9 presentations, editable PPTX files, and PNG charts with report-baby. Use when building a client-facing report or presentation deliverable from marketing/analytics data.
---

# Authoring reports with report-baby

## Pick the right tool

- **`render_report`** — the end-of-task deliverable: multi-page A4 PDF from one structured `data` object. Use for anything the user will send to a client or manager.
- **`render_chart`** — one standalone PNG chart (bar / line / pie) to paste into chat or a doc.
- **`render_metric_cards`** — one PNG grid of KPI cards.
- **`render_svg`** — escape hatch for fully custom graphics; every text node needs `font-family="DejaVu Sans"`.
- **`render_slides_pdf`** — complete local 16:9 presentation from the shared slide model.
- **`render_slides_png`** — all slides or one `slide_index` as deterministic 1600×900 PNG files.
- **`render_slides_pptx`** — editable PPTX from the same model; charts are images, while text, KPI cards, tables, and shapes remain editable.

All tools return the PATH to the written file. Never pull the rendered file back into context to read numbers — you already have the source data. Visually inspect (Read on PDF pages, `return_image: true` on PNGs) only when you must judge layout or aesthetics.

The response is deliberately compact: the path, the resolved brand profile, `template_ref`, the slide count, and warnings deduplicated across slides (one entry with the number of slides it affected). Only when a slide layout is visibly wrong, re-run the same call with `diagnostics: "full"` to get the per-slide pixel plans (`slidePlans`, `slotRules`, slot boxes) — that payload costs thousands of tokens per deck.

## Workflow

1. Collect and verify all numbers FIRST. The report is a formatting step, not an analysis step.
2. Build the `data` object (shape below). Format numbers as display strings yourself (`"36,2%"`, `"12 480 zł"`) — the renderer does not apply locale formatting. Chart `value`s are the exception: always raw numbers.
3. Call `render_report`. Pass `output_path` explicitly when the user should find the file (project dir); otherwise it lands in `~/.report-baby/out`.
4. If the deliverable matters, Read the first pages of the PDF once to check for clipped labels, then fix labels — not the engine.

## `render_report` data shape

Only present blocks render, in this fixed order: header → intro → kpis → charts → sections → table → highlights (+ footer on every page).

```json
{
  "brand": "Client name",
  "period": "1–31.05.2026",
  "title": "Monthly performance report",
  "subtitle": "Google Ads + Meta, all accounts",
  "title_page": {
    "eyebrow": "CLIENT · REPORT",
    "title": "Monthly performance report",
    "subtitle": "One short sentence explaining the report",
    "period": "Q2 2026"
  },
  "intro": "Lead paragraph: what happened this period and why it matters.",
  "kpis": [
    { "label": "Revenue", "value": "124 300 zł", "delta": "+18% MoM", "trend": "up" },
    { "label": "ROAS", "value": "4,2", "delta": "−0,3 vs target", "trend": "down" },
    { "label": "Conversions", "value": 812, "note": "excl. brand" }
  ],
  "charts": [
    { "type": "bar", "title": "Spend by channel", "suffix": " zł", "data": [ { "label": "Search", "value": 18200 }, { "label": "PMax", "value": 9400 } ] },
    { "type": "pie", "title": "Conversions by source", "data": [ { "label": "Google", "value": 512 }, { "label": "Meta", "value": 300 } ] }
  ],
  "sections": [
    { "heading": "What worked", "body": "Plain-prose narrative. No markdown — the renderer prints text verbatim." }
  ],
  "table": {
    "caption": "Campaign detail",
    "head": ["Campaign", "Spend", "Conv.", "CPA"],
    "body": [ ["Brand PL", "4 100 zł", 210, "19,50 zł"], ["Generic PL", "9 800 zł", 240, "40,80 zł"] ]
  },
  "highlights": ["One-line takeaway per bullet."],
  "footer": "Source: Google Ads API, 6.07.2026."
}
```

`title_page` is optional. When present, it creates a separate branded cover;
the regular report content starts on page two. Keep the cover text short and
let the selected brand profile provide the logo, background, contrast, and
alignment.

## Layout guardrails (avoid clipped text)

- `kpis[].label` — max ~28 chars; renders UPPERCASE in a 3-column grid (a 4th card wraps to the next row). `delta`/`note` — max ~35 chars, one line.
- `charts[].title` — max ~55 chars. `pie` renders as a donut with the item count in the middle; use `suffix`/`prefix` on `bar`/`line` for units.
- `footer` — max ~120 chars, single line shared with the page number.
- `period` and `brand` share one line — keep both short.
- `sections[].body` and `intro` — plain prose only; markdown syntax (`**`, `##`, `-`) prints literally. Length is fine: text flows across pages, and headings always stay with their body (never orphaned at a page bottom).
- `table` — any column count, but past ~6 columns cells get cramped; prefer splitting into two tables.

## Shared slide model

Use one `data` object for all three presentation formats. Keep the model bounded to `title`, `metrics`, `chart`, `table`, `narrative`, and `conclusions` slide types. Do not create a second planning path per format.

```json
{
  "title": "Quarterly results",
  "brand": "Client name",
  "footer": "Source: verified analytics data",
  "slides": [
    { "type": "title", "title": "Quarterly results", "subtitle": "Management summary" },
    { "type": "metrics", "title": "Key KPIs", "metrics": [{ "label": "Revenue", "value": "1.2M zł", "delta": "+12%", "trend": "up" }] },
    { "type": "chart", "title": "Revenue trend", "chart": { "type": "bar", "data": [{ "label": "May", "value": 30 }, { "label": "June", "value": 42 }] } },
    { "type": "table", "title": "Channel detail", "head": ["Channel", "Result"], "body": [["SEO", 42], ["Ads", 37]] },
    { "type": "narrative", "title": "Interpretation", "body": "Plain prose.", "highlights": ["One short emphasis"] },
    { "type": "conclusions", "title": "Next actions", "items": ["Scale the winning channel"] }
  ]
}
```

Keep metric slides to 6 cards, narrative highlights to 4, conclusions to 7, and visible table rows to 10. Use `slide_index` (zero-based) to regenerate one PNG without touching unrelated slides. Preserve the same source object when producing PDF, PNG, and PPTX so content and ordering stay aligned.

## Common mistakes

- `table` takes `head` + `body` (arrays), NOT `columns`/`rows`.
- Chart data is `data: [{label, value}]` per chart, NOT `labels`/`values` arrays.
- Chart types are exactly `bar`, `line`, `pie` (`pie` = donut). There is no `donut`/`stacked`/`area` type.
- KPI delta color comes from `trend` (`up` = green, `down` = red) — a "down" that is good news (e.g. lower CPA) still renders red; phrase the delta accordingly or use `note` instead.
- Polish and other diacritics are fully supported (DejaVu Sans is embedded) — never transliterate.
