#!/usr/bin/env node

// PROTOTYPE — render a plan as an inspectable PDF and calculate a soft score.
// The plan evaluator remains the authority for legality; this artifact exists
// to expose geometry and compare otherwise legal alternatives.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { jsPDF } from 'jspdf';
import { parse } from 'yaml';

const root = process.cwd();
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const requestPath = resolve(argument('--request', '/tmp/report-baby-transinfo-editorial-second/batch.json'));
const outputPath = resolve(argument('--out', join(dirname(requestPath), 'composition-debug.pdf')));
const mapOutputPath = resolve(argument('--map-out', outputPath.replace(/\.pdf$/u, '-map.pdf')));
const scorePath = resolve(argument('--score-out', outputPath.replace(/\.pdf$/u, '.score.json')));
const config = parse(await readFile(join(root, 'templates/composition-score-prototype.yml'), 'utf8'));
const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));

function color(value) {
  return Array.isArray(value) ? value : [0, 0, 0];
}

function setColor(pdf, method, value) {
  pdf[method](...color(value));
}

function ratio(left, right) {
  return right > 0 ? left / right : 0;
}

function allLines(plan) {
  return [...(plan.lines ?? []), ...(plan.insertionLines ?? [])];
}

function occupiedPlacementKeys(plan) {
  return new Set((plan.flowPlacements ?? []).filter((placement) => placement.hasContent).map((placement) => `${placement.flowId}:${placement.page}:${placement.routeIndex}`));
}

function scorePlan(plan, evaluation) {
  const values = config.score;
  const components = [];
  const hardViolations = (evaluation?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === 'error');
  const placements = (plan.flowPlacements ?? []).filter((placement) => placement.flowId === 'main');
  const lines = allLines(plan);
  const occupied = placements.filter((placement) => placement.hasContent);
  components.push({ name: 'occupied-placement', points: occupied.length * values.occupied_placement_bonus, detail: `${occupied.length} occupied main placements` });

  const occupiedKeys = occupiedPlacementKeys(plan);
  const internalEmpty = placements.filter((placement, index) => {
    if (placement.hasContent || placement.blockedBy.length > 0) return false;
    const before = placements.slice(0, index).some((candidate) => occupiedKeys.has(`${candidate.flowId}:${candidate.page}:${candidate.routeIndex}`));
    const after = placements.slice(index + 1).some((candidate) => occupiedKeys.has(`${candidate.flowId}:${candidate.page}:${candidate.routeIndex}`));
    return before && after;
  });
  components.push({ name: 'internal-empty-placement', points: -internalEmpty.length * values.internal_empty_penalty, detail: `${internalEmpty.length} empty placements between occupied placements` });

  const pageBalances = [];
  for (const page of new Set(placements.map((placement) => placement.page))) {
    const columns = placements.filter((placement) => placement.page === page && placement.routeIndex < values.column_count);
    const counts = columns.map((column) => column.lineCount);
    if (counts.length < 2 || Math.max(...counts) === 0) continue;
    const balance = Math.min(...counts) / Math.max(...counts);
    pageBalances.push({ page, balance });
  }
  const balancedPages = pageBalances.filter((item) => item.balance >= values.balanced_columns_threshold).length;
  components.push({ name: 'column-balance', points: balancedPages * values.balanced_columns_bonus, detail: pageBalances.map((item) => `p${item.page}=${item.balance.toFixed(2)}`).join(', ') || 'no two-column pages' });

  const fullWidthInsertions = (plan.graphicPlacements ?? []).filter((graphic) => graphic.graphicId.startsWith('insertion:') && graphic.wrap === 'around' && graphic.box.width >= Math.max(...placements.map((placement) => placement.box.width), 0) * values.full_width_measure_factor);
  components.push({ name: 'full-width-insertion', points: fullWidthInsertions.length * values.full_width_insertion_bonus, detail: `${fullWidthInsertions.length} insertion(s) span the column measure` });

  const trailing = placements.filter((placement, index) => index < placements.length - 1 && placement.hasContent && placement.lineCount > 0);
  const trailingPenalty = trailing.reduce((sum, placement) => {
    const lastLine = lines.filter((line) => line.flowId === placement.flowId && line.slotId === placement.slotId).sort((left, right) => left.box.y - right.box.y).at(-1);
    if (!lastLine) return sum;
    const gapRatio = ratio(placement.box.y + placement.box.height - (lastLine.box.y + lastLine.box.height), placement.box.height);
    return sum + (gapRatio >= values.trailing_gap_ratio_threshold ? values.visible_trailing_gap_penalty : 0);
  }, 0);
  components.push({ name: 'visible-trailing-gap', points: -trailingPenalty, detail: `${trailing.length} non-terminal placement(s) inspected` });

  const headingBlocks = new Set((plan.trace?.blocks ?? []).filter((block) => block.kind === 'heading').map((block) => block.blockId));
  const headingLines = lines.filter((line) => headingBlocks.has(line.blockId));
  const headingWithFollowingBlock = [...headingBlocks].filter((blockId) => headingLines.some((heading) => heading.blockId === blockId && lines.some((line) => line.flowId === heading.flowId
    && line.page === heading.page
    && line.slotId === heading.slotId
    && line.blockId !== heading.blockId
    && line.box.y >= heading.box.y + heading.box.height)));
  components.push({ name: 'heading-following-line', points: headingWithFollowingBlock.length * values.heading_following_line_bonus, detail: `${headingWithFollowingBlock.length} heading block(s) keep following text in the same placement` });

  const insertionTargetFractions = config.debug.preferred_insertion_fractions;
  const insertionTargetPoints = (plan.pages ?? []).flatMap((page) => {
    const pagePlacements = placements.filter((placement) => placement.page === page.page);
    if (pagePlacements.length === 0) return [];
    const pageTop = Math.min(...pagePlacements.map((placement) => placement.box.y));
    const pageBottom = Math.max(...pagePlacements.map((placement) => placement.box.y + placement.box.height));
    const height = pageBottom - pageTop;
    const insertions = (plan.graphicPlacements ?? []).filter((graphic) => graphic.page === page.page && graphic.graphicId.startsWith('insertion:') && graphic.wrap === 'around');
    return insertions.map((graphic, index) => {
      const target = insertionTargetFractions[Math.min(index, insertionTargetFractions.length - 1)];
      const actual = height > 0 ? ((graphic.box.y + graphic.box.height / 2) - pageTop) / height : target;
      return values.insertion_target_bonus - Math.abs(actual - target) * values.insertion_target_penalty_per_fraction;
    });
  }).reduce((sum, points) => sum + points, 0);
  components.push({ name: 'insertion-vertical-rhythm', points: insertionTargetPoints, detail: 'quotes are compared with configured quarter-page preferences' });

  const softScore = values.base + components.reduce((sum, component) => sum + component.points, 0);
  return {
    legal: evaluation?.status !== 'rejected' && hardViolations.length === 0,
    status: evaluation?.status ?? 'unknown',
    score: hardViolations.length === 0 ? softScore : Number.NEGATIVE_INFINITY,
    hardViolations: hardViolations.map((diagnostic) => diagnostic.code),
    components,
    note: 'Heuristic prototype score; it is meaningful only for comparing plans under the same template and config.',
  };
}

function alpha(pdf, value) {
  if (typeof pdf.GState === 'function' && typeof pdf.setGState === 'function') pdf.setGState(new pdf.GState({ opacity: value }));
}

function drawDebugPdf(plan, score) {
  const first = plan.pages?.[0] ?? { width: 210, height: 297 };
  const pdf = new jsPDF({ unit: 'mm', format: [first.width, first.height], compress: true });
  const lines = allLines(plan);
  const debug = { ...config.debug, ...renderConfig.composition_debug };
  const headingBlocks = new Set((plan.trace?.blocks ?? []).filter((block) => block.kind === 'heading').map((block) => block.blockId));
  for (const page of plan.pages ?? []) {
    if (page.page !== 1) pdf.addPage([page.width, page.height]);
    pdf.setLineWidth(debug.line_width);
    setColor(pdf, 'setTextColor', debug.title_color);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(debug.header_size);
    pdf.text(`DEBUG PAGE ${page.page} · ${score.legal ? 'legal' : 'REJECTED'} · score ${Number.isFinite(score.score) ? score.score.toFixed(1) : '−∞'}`, debug.page_padding, debug.page_padding);

    for (const placement of plan.flowPlacements ?? []) {
      if (placement.page !== page.page) continue;
      const empty = !placement.hasContent && placement.blockedBy.length === 0;
      const placementColor = empty ? debug.empty_color : placement.flowId === 'quotes' ? debug.quote_color : debug.placement_color;
      setColor(pdf, 'setDrawColor', placementColor);
      setColor(pdf, 'setFillColor', placementColor);
      pdf.setLineWidth(debug.placement_line_width);
      alpha(pdf, debug.placement_fill_opacity);
      pdf.rect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, 'F');
      alpha(pdf, 1);
      pdf.setLineDashPattern(empty ? [1, 1] : [2, 1], 0);
      pdf.rect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, 'S');
      pdf.setLineDashPattern([], 0);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(debug.label_size);
      pdf.text(`${placement.flowId} · r${placement.routeIndex} · ${placement.hasContent ? `${placement.lineCount} lines` : 'EMPTY'}${placement.blockedBy.length ? ` · blocked by ${placement.blockedBy.join(', ')}` : ''}`, placement.box.x + debug.label_gap, Math.max(debug.page_padding + debug.header_size + debug.label_gap, placement.box.y + debug.label_gap));
    }

    for (const graphic of plan.graphicPlacements ?? []) {
      if (graphic.page !== page.page) continue;
      const obstacle = graphic.wrap === 'around' || graphic.graphicId.startsWith('insertion:');
      if (!obstacle) continue;
      setColor(pdf, 'setDrawColor', debug.obstacle_color);
      setColor(pdf, 'setFillColor', debug.obstacle_color);
      pdf.setLineWidth(debug.obstacle_line_width);
      alpha(pdf, debug.obstacle_fill_opacity);
      pdf.rect(graphic.box.x, graphic.box.y, graphic.box.width, graphic.box.height, 'FD');
      alpha(pdf, 1);
      pdf.setFontSize(debug.label_size);
      pdf.text(`OBSTACLE · ${graphic.graphicId}`, graphic.box.x + debug.label_gap, graphic.box.y + debug.label_gap + debug.label_size);
    }

    for (const placement of [...(plan.blockPlacements ?? []), ...(plan.tablePlacements ?? [])]) {
      if (placement.page !== page.page) continue;
      setColor(pdf, 'setDrawColor', debug.block_color);
      pdf.setLineWidth(debug.line_width);
      pdf.rect(placement.box.x, placement.box.y, placement.box.width, placement.box.height, 'S');
      pdf.setFontSize(debug.label_size);
      pdf.text(`BLOCK · ${placement.blockId}`, placement.box.x + debug.label_gap, placement.box.y + debug.label_gap + debug.label_size);
    }

    for (const glyph of plan.glyphPlacements ?? []) {
      if (glyph.page !== page.page) continue;
      const glyphColor = glyph.source === 'authored' ? debug.empty_color : debug.glyph_color;
      setColor(pdf, 'setDrawColor', glyphColor);
      pdf.setLineWidth(debug.glyph_line_width);
      pdf.setLineDashPattern([1, 1], 0);
      pdf.rect(glyph.box.x, glyph.box.y, glyph.box.width, glyph.box.height, 'S');
      pdf.setLineDashPattern([], 0);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(debug.label_size);
      const labelY = Math.max(debug.page_padding + debug.header_size + debug.label_gap, glyph.box.y - debug.label_gap);
      pdf.text(`GLYPH · ${glyph.source} · ${glyph.glyphId} · ${glyph.anchor}`, glyph.box.x, labelY);
    }

    for (const line of lines.filter((candidate) => candidate.page === page.page)) {
      const lineColor = headingBlocks.has(line.blockId) ? debug.heading_color : line.flowId === 'quotes' ? debug.quote_color : line.flowId === 'intro' ? debug.intro_color : debug.main_color;
      setColor(pdf, 'setDrawColor', lineColor);
      setColor(pdf, 'setFillColor', lineColor);
      pdf.setLineWidth(debug.line_width);
      alpha(pdf, debug.line_fill_opacity);
      pdf.rect(line.box.x, line.box.y, line.box.width, line.box.height, 'F');
      alpha(pdf, 1);
      if (line.layer === 'insertion' || line.startWord === 0) {
        pdf.setFontSize(debug.label_size);
        pdf.text(`${line.flowId}:${basename(line.blockId)} · ${line.startWord}-${line.endWord}`, line.box.x + debug.label_gap, line.box.y + line.box.height - debug.label_gap);
      }
    }
  }
  return Buffer.from(pdf.output('arraybuffer'));
}

const raw = JSON.parse(await readFile(requestPath, 'utf8'));
const request = Array.isArray(raw) ? raw[0]?.args : raw;
if (!request || typeof request !== 'object') throw new Error(`Expected a render request or batch at ${requestPath}.`);
const cli = resolve(root, 'cli-bundle.cjs');
const sourcePdfPath = resolve(request.output_path ?? outputPath.replace(/\.pdf$/u, '-source.pdf'));
if (sourcePdfPath === outputPath) throw new Error(`Debug output must differ from source PDF: ${sourcePdfPath}`);
const renderNormal = spawnSync(process.execPath, [cli, '--json', 'render_report'], { cwd: root, input: JSON.stringify({ ...request, output_path: sourcePdfPath, composition_debug: false, diagnostics: 'full' }), encoding: 'utf8' });
if (renderNormal.status !== 0) throw new Error(`normal render_report failed: ${renderNormal.stderr || renderNormal.stdout}`);
const rendered = spawnSync(process.execPath, [cli, '--json', 'render_report'], { cwd: root, input: JSON.stringify({ ...request, output_path: outputPath, composition_debug: true, diagnostics: 'full' }), encoding: 'utf8' });
if (rendered.status !== 0) throw new Error(`debug render_report failed: ${rendered.stderr || rendered.stdout}`);
const result = JSON.parse(rendered.stdout);
const plan = result.compositionPlan;
if (!plan) throw new Error('render_report did not return compositionPlan; use diagnostics: full.');
const score = scorePlan(plan, result.compositionEvaluation);
await writeFile(mapOutputPath, drawDebugPdf(plan, score));
await writeFile(scorePath, JSON.stringify({ source: requestPath, sourcePdf: sourcePdfPath, output: outputPath, mapOutput: mapOutputPath, score, pages: plan.pages.length, lines: allLines(plan).length, glyphPlacements: plan.glyphPlacements ?? [], flowPlacements: plan.flowPlacements ?? [] }, null, 2));
console.log(JSON.stringify({ status: 'passed', debugPdf: outputPath, mapPdf: mapOutputPath, sourcePdf: sourcePdfPath, scorePath, pages: plan.pages.length, lines: allLines(plan).length, score }, null, 2));
