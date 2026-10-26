---
name: recipe-setup
description: Save or edit a report recipe so a recurring report can be refreshed for new dates with one command. Use when the user wants to save the queries behind a report built in this session (Google Ads, GA4, Meta, HubSpot or any MCP connector), change a saved recipe, attach an HTML template, or schedule the report.
argument-hint: "<client>/<name> [what to change]"
---

# Recipe setup

A recipe is a client's saved report: the data-fetching tool calls with date placeholders, plus an optional HTML template. marketing-context-mcp stores it; report-baby runs it with `/recipe-run`. Target: $ARGUMENTS

## Save from this session

1. Collect the data calls that built the report in this conversation. Skip exploratory and failed calls, schema lookups, and calls whose result was not used.
2. Turn each into a step `{ id, tool, args, page_params?, description? }`:
   - `id`: short lowercase name, e.g. `ads_by_country`.
   - `tool`: the name as called, e.g. `mcp__claude_ai_HubSpot__search_crm_objects`, or the plain name for our plugins, e.g. `execute_gaql` (a `__` suffix matches).
   - `args`: the exact arguments, with every date of the report period replaced by a placeholder:
     - `{{start}}` / `{{end}}` for YYYY-MM-DD dates, e.g. GAQL `BETWEEN '{{start}}' AND '{{end}}'`;
     - `{{start_iso}}` / `{{end_iso}}` for ISO timestamps;
     - `{{start_ms}}` / `{{end_ms}}` for epoch milliseconds, e.g. HubSpot `BETWEEN` filters.
     
     For a comparison period, use the same forms with a `prev_` prefix, e.g. `{{prev_start}}`. Remove per-call telemetry such as HubSpot `chatInsights`. A step without any placeholder returns the same data every run, so check that this is intended.
   - `page_params`: arguments that only select a page (`offset`, `after`, `page`).
3. Prefer one aggregated query over many raw ones: GAQL with `segments.*` grouping, GA4 dimensions, or an MCC-level query instead of one call per account. A search that only feeds a count (e.g. new HubSpot contacts) needs `limit: 1`: the reported `total` is kept without paging. Split counts by a property with one step per value and an `EQ` filter rather than paging through every record.
4. Optional template: copy the report HTML to a local file and replace its hard-coded numbers with a script that reads `window.RECIPE_DATA = { recipe, period, comparison?, steps: { <step id>: [records] }, totals: { <step id>: source-reported total } }`. Put `<!--RECIPE_DATA-->` before that script and `<!--RECIPE_CONCLUSIONS-->` where the conclusions go.
5. `save_recipe { client_slug, name, description, steps, template_html_path? }`. Read the warnings it returns.
6. For a recurring report, `append_task { client_slug, recipe: "<client>/<name>", ... }` with its cadence.

## Edit

1. `list_recipes { client_slug, name }` returns the recipe JSON.
2. Change the steps and save it again under the same name with `save_recipe`. Omit `template_html_path` to keep the current template.

## Check

Run `/recipe-run <client>/<name> last_7_days` once. Every call must produce a "captured" receipt. A "NOT captured ... arguments differ" notice names the argument that does not match the recipe, so fix that step.
