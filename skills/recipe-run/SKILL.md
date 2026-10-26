---
name: recipe-run
description: Refresh a saved report recipe for a new period without pulling raw data into the conversation, then write the conclusions. Use when the user asks to re-run, refresh or repeat a recurring report, or a due task carries a recipe.
argument-hint: "<client>/<name> [preset | start end] [previous_period|previous_year]"
---

# Recipe run

Arguments: $ARGUMENTS. They give the recipe as `<client>/<name>`, a preset (`yesterday`, `last_7_days`, `last_28_days`, `last_week`, `last_month`, `month_to_date`) or `start end` dates, and optionally a comparison. If no recipe is given, use `list_recipes`. If no period is given, use `last_7_days`.

1. Call `start_recipe_run { recipe, preset | start + end, compare? }`.
2. Make every returned call with exactly those arguments, and run independent calls in parallel. Each result comes back as a "report-baby captured" receipt:
   - more pages exist: repeat the call with the page argument it names;
   - "NOT captured ... arguments differ": repeat the call with the recipe's arguments;
   - no receipt at all: the hook is not active here, so tell the user and continue with the visible data.
3. Call `finish_recipe_run {}`.
4. Read the data: run `inspect_recipe_run { view: "overview" }`, then `aggregate` with `group_by`, `metrics` and `filters` to answer specific questions. Use `sample` only if a field is unclear. Compare with the previous period when the run has one.
5. Write short, concrete conclusions with numbers, changes against the comparison period, and what to do next. Save them with `finish_recipe_run { conclusions_markdown }`. The markdown supports paragraphs, `- ` bullets, `### ` headings and `**bold**`.
6. Call `append_review { client_slug, platform, period, summary_path: <conclusions_md> }`. If a recurring task drove this run, also call `mark_task_run`.
7. Reply with the `report_html` path and a two- to three-line summary. Do not repeat the full conclusions.
