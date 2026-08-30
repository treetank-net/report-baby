#!/usr/bin/env node

import assert from 'node:assert/strict';
import { comparePdfLayouts, formatPdfLayoutDiff, inspectColumnBalance, inspectPdfSpacing, parsePdfLayoutXml } from './lib/pdf-layout-diff.mjs';

function pdfXml(lines) {
  return `<doc><page width="595" height="842"><flow>${lines.map(({ x, y, text }) => `<line xMin="${x}" yMin="${y}" xMax="${x + 100}" yMax="${y + 10}">${text.split(' ').map((word, index) => `<word xMin="${x + index * 20}" yMin="${y}" xMax="${x + index * 20 + 10}" yMax="${y + 10}">${word}</word>`).join('')}</line>`).join('')}</flow></page></doc>`;
}

const expected = parsePdfLayoutXml(pdfXml([
  { x: 40, y: 50, text: 'A heading stays here' },
  { x: 40, y: 62, text: 'The first paragraph remains readable' },
  { x: 40, y: 74, text: 'The second paragraph follows normally' },
]));
const actual = parsePdfLayoutXml(pdfXml([
  { x: 40, y: 58, text: 'A heading stays here' },
  { x: 40, y: 70, text: 'The first paragraph remains readable' },
  { x: 40, y: 110, text: 'The second paragraph follows normally' },
]));
const report = comparePdfLayouts(expected, actual, {
  pointsPerInch: 72,
  pointsPerInch: 72,
  movement_warn_mm: 1,
  movement_error_mm: 5,
  line_gap_warn_mm: 5,
  line_gap_severe_mm: 10,
  page_edge_ratio: 0.12,
  max_spacing_findings: 12,
  anchor_token_count: 2,
  lane_origin_tolerance_mm: 2,
});

assert.equal(report.pages.delta, 0);
assert.equal(report.text.missing.length, 0);
assert.equal(report.text.extra.length, 0);
assert.ok(report.movements.some((movement) => movement.text === 'A heading stays here'));
assert.ok(report.spacing.some((finding) => finding.after.includes('first paragraph')));
assert.ok(report.spacingFindings.some((finding) => finding.after.includes('first paragraph')));
assert.equal(report.status, 'changed');
assert.match(formatPdfLayoutDiff(report), /large or irregular vertical gaps/u);

const spacing = inspectPdfSpacing(parsePdfLayoutXml(pdfXml([
  { x: 40, y: 50, text: 'Header subtitle' },
  { x: 40, y: 90, text: 'First body line' },
])), {
  pointsPerInch: 72,
  line_gap_warn_mm: 5,
  line_gap_severe_mm: 10,
  page_edge_ratio: 0.12,
  max_spacing_findings: 12,
  lane_origin_tolerance_mm: 2,
});
assert.equal(spacing.length, 1);
assert.ok(Math.abs(spacing[0].gapMm - 10.5833) < 0.001);

const identical = comparePdfLayouts(expected, expected, {
  pointsPerInch: 72,
  movement_warn_mm: 1,
  movement_error_mm: 5,
  line_gap_warn_mm: 5,
  line_gap_severe_mm: 10,
  page_edge_ratio: 0.12,
  max_spacing_findings: 12,
  lane_origin_tolerance_mm: 2,
  anchor_token_count: 2,
});
assert.equal(identical.status, 'identical');

const columns = inspectColumnBalance(parsePdfLayoutXml('<doc><page width="595" height="842"><flow><line xMin="40" yMin="100" xMax="140" yMax="110"><word xMin="40" yMin="100" xMax="50" yMax="110">left</word></line><line xMin="350" yMin="100" xMax="450" yMax="110"><word xMin="350" yMin="100" xMax="360" yMax="110">right</word></line></flow></page></doc>'), {
  column_count: 2,
  column_span_exclusion_factor: 1.3,
  column_fill_warn_ratio: 0.45,
  column_ink_balance_warn_ratio: 0.55,
  page_edge_ratio: 0.12,
});
assert.equal(columns[0].lineBalance, 1);
assert.equal(columns[0].inkBalance, 1);

const incomplete = parsePdfLayoutXml(pdfXml([{ x: 40, y: 50, text: 'A heading stays here' }]));
const incompleteReport = comparePdfLayouts(expected, incomplete, {
  pointsPerInch: 72,
  movement_warn_mm: 1,
  movement_error_mm: 5,
  line_gap_warn_mm: 5,
  line_gap_severe_mm: 10,
  page_edge_ratio: 0.12,
  max_spacing_findings: 12,
  lane_origin_tolerance_mm: 2,
  anchor_token_count: 2,
});
assert.ok(incompleteReport.text.missing.some((item) => item.token === 'paragraph'));
console.log('pdf layout diff tests passed');
