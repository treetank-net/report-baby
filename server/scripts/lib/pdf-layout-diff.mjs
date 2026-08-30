import { execFileSync } from 'node:child_process';

const TOKEN_RE = /[^\p{L}\p{N}]+/gu;

export function decodeXml(value) {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'");
}

export function normalizeToken(value) {
  return value.toLocaleLowerCase('und').replace(TOKEN_RE, '');
}

export function normalizedTokens(text) {
  return text.split(/\s+/u).map(normalizeToken).filter(Boolean);
}

function numberAttribute(attributes, name) {
  const match = new RegExp(`${name}="([\\d.-]+)"`, 'u').exec(attributes);
  return match ? Number(match[1]) : null;
}

function parseLine(attributes, body, page) {
  const words = [];
  const wordPattern = /<word\s+([^>]+)>([\s\S]*?)<\/word>/gu;
  let match;
  while ((match = wordPattern.exec(body))) {
    words.push({
      xMin: numberAttribute(match[1], 'xMin'),
      yMin: numberAttribute(match[1], 'yMin'),
      xMax: numberAttribute(match[1], 'xMax'),
      yMax: numberAttribute(match[1], 'yMax'),
      text: decodeXml(match[2].replace(/<[^>]+>/gu, '')),
    });
  }
  const text = words.map((word) => word.text).join(' ');
  return {
    page,
    xMin: numberAttribute(attributes, 'xMin'),
    yMin: numberAttribute(attributes, 'yMin'),
    xMax: numberAttribute(attributes, 'xMax'),
    yMax: numberAttribute(attributes, 'yMax'),
    text,
    tokens: normalizedTokens(text),
    words,
  };
}

export function parsePdfLayoutXml(xml) {
  const pages = [];
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/gu;
  let pageMatch;
  let pageIndex = 0;
  while ((pageMatch = pagePattern.exec(xml))) {
    const lines = [];
    const linePattern = /<line\b([^>]*)>([\s\S]*?)<\/line>/gu;
    let lineMatch;
    while ((lineMatch = linePattern.exec(pageMatch[2]))) {
      const line = parseLine(lineMatch[1], lineMatch[2], pageIndex + 1);
      if (line.tokens.length) lines.push(line);
    }
    pages.push({
      page: pageIndex + 1,
      widthPoints: numberAttribute(pageMatch[1], 'width'),
      heightPoints: numberAttribute(pageMatch[1], 'height'),
      lines,
    });
    pageIndex += 1;
  }
  return { pages };
}

export function readPdfLayout(pdfPath) {
  return parsePdfLayoutXml(execFileSync('pdftotext', ['-bbox-layout', pdfPath, '-'], { encoding: 'utf8' }));
}

export function inspectColumnBalance(layout, options = {}) {
  const requiredSettings = ['column_count', 'column_span_exclusion_factor', 'column_fill_warn_ratio', 'column_ink_balance_warn_ratio', 'page_edge_ratio'];
  const missingSettings = requiredSettings.filter((key) => !Number.isFinite(options[key]));
  if (missingSettings.length) throw new Error(`pdf column inspection requires quality.layout_diff settings: ${missingSettings.join(', ')}`);
  const columnCount = Math.max(1, Math.floor(options.column_count));
  return layout.pages.map((page) => {
    const pageWidth = page.widthPoints ?? 0;
    const pageHeight = page.heightPoints ?? 0;
    const columnWidth = pageWidth / columnCount;
    const lines = page.lines.filter((line) => {
      if (!pageWidth || !pageHeight) return true;
      return line.yMin >= pageHeight * options.page_edge_ratio && line.yMax <= pageHeight * (1 - options.page_edge_ratio);
    });
    const columns = Array.from({ length: columnCount }, () => ({ lineCount: 0, inkProxy: 0 }));
    for (const line of lines) {
      const lineWidth = Math.max(0, line.xMax - line.xMin);
      if (lineWidth > columnWidth * options.column_span_exclusion_factor) continue;
      const center = (line.xMin + line.xMax) / 2;
      const index = Math.min(columnCount - 1, Math.max(0, Math.floor(center / columnWidth)));
      const lineHeight = Math.max(1, line.yMax - line.yMin);
      columns[index].lineCount += 1;
      columns[index].inkProxy += lineWidth * lineHeight;
    }
    const lineCounts = columns.map((column) => column.lineCount);
    const inkValues = columns.map((column) => column.inkProxy);
    const lineMax = Math.max(...lineCounts, 0);
    const inkMax = Math.max(...inkValues, 0);
    const lineMin = Math.min(...lineCounts, lineMax);
    const inkMin = Math.min(...inkValues, inkMax);
    const lineBalance = lineMax > 0 ? lineMin / lineMax : 1;
    const inkBalance = inkMax > 0 ? inkMin / inkMax : 1;
    const warnings = [];
    const isFinalPage = page.page === layout.pages.at(-1)?.page;
    const startedColumns = columns.filter((column) => column.lineCount > 0).length;
    if (!isFinalPage && startedColumns >= 2 && lineMax > 0 && lineBalance < options.column_fill_warn_ratio) warnings.push('line-fill');
    if (!isFinalPage && startedColumns >= 2 && inkMax > 0 && inkBalance < options.column_ink_balance_warn_ratio) warnings.push('ink-balance');
    return {
      page: page.page,
      columns,
      lineBalance: round(lineBalance),
      inkBalance: round(inkBalance),
      warnings,
    };
  });
}

function allLines(layout) {
  return layout.pages.flatMap((page) => page.lines);
}

function tokenCounts(layout) {
  const counts = new Map();
  for (const token of allLines(layout).flatMap((line) => line.tokens)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function countDifferences(expected, actual) {
  const missing = [];
  const extra = [];
  for (const [token, count] of expected) {
    const difference = count - (actual.get(token) ?? 0);
    if (difference > 0) missing.push({ token, count: difference });
  }
  for (const [token, count] of actual) {
    const difference = count - (expected.get(token) ?? 0);
    if (difference > 0) extra.push({ token, count: difference });
  }
  return { missing, extra };
}

function lineKey(line) {
  return line.tokens.join(' ');
}

function lineSignature(line, anchorTokenCount) {
  if (line.tokens.length < anchorTokenCount) return null;
  const prefix = line.tokens.slice(0, anchorTokenCount);
  const suffix = line.tokens.slice(-anchorTokenCount);
  return `${prefix.join(' ')} … ${suffix.join(' ')}`;
}

function uniqueLineIndex(lines, key) {
  const matches = lines.filter((line) => lineKey(line) === key);
  return matches.length === 1 ? matches[0] : null;
}

function matchLines(expectedLines, actualLines, anchorTokenCount) {
  const matches = [];
  const used = new Set();
  for (const expected of expectedLines) {
    let actual = uniqueLineIndex(actualLines, lineKey(expected));
    if (actual && used.has(actual)) actual = null;
    if (!actual) {
      const signature = lineSignature(expected, anchorTokenCount);
      if (signature) {
        const candidates = actualLines.filter((line) => !used.has(line) && lineSignature(line, anchorTokenCount) === signature);
        if (candidates.length === 1) actual = candidates[0];
      }
    }
    if (actual) {
      used.add(actual);
      matches.push({ expected, actual });
    }
  }
  return matches;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function laneGroups(lines, tolerancePoints) {
  const lanes = [];
  for (const line of [...lines].sort((left, right) => left.xMin - right.xMin || left.yMin - right.yMin)) {
    const lane = lanes.find((candidate) => Math.abs(candidate.origin - line.xMin) <= tolerancePoints);
    if (lane) lane.lines.push(line);
    else lanes.push({ origin: line.xMin, lines: [line] });
  }
  return lanes;
}

function horizontallyOverlaps(left, right) {
  return Math.min(left.xMax, right.xMax) > Math.max(left.xMin, right.xMin);
}

function hasInterveningText(pageLines, previous, current) {
  return pageLines.some((line) => line !== previous && line !== current
    && line.yMax > previous.yMax
    && line.yMin < current.yMin
    && (horizontallyOverlaps(line, current) || !horizontallyOverlaps(line, previous)));
}

function spacingFindings(layout, settings, pointsToMm) {
  const findings = [];
  const tolerancePoints = settings.lane_origin_tolerance_mm / pointsToMm;
  const warnPoints = settings.line_gap_warn_mm / pointsToMm;
  const severePoints = settings.line_gap_severe_mm / pointsToMm;
  for (const page of layout.pages) {
    const pageHeightPoints = page.heightPoints ?? 0;
    const pageLines = [...page.lines];
    for (const lane of laneGroups(page.lines, tolerancePoints)) {
      const lines = [...lane.lines].sort((left, right) => left.yMin - right.yMin);
      const gaps = [];
      for (let index = 1; index < lines.length; index += 1) {
        gaps.push(Math.max(0, lines[index].yMin - lines[index - 1].yMax));
      }
      const normalGap = median(gaps);
      for (let index = 1; index < lines.length; index += 1) {
        const previous = lines[index - 1];
        const current = lines[index];
        const gap = Math.max(0, current.yMin - previous.yMax);
        if (gap < warnPoints) continue;
        if (hasInterveningText(pageLines, previous, current)) continue;
        const pageEdge = pageHeightPoints > 0
          && (previous.yMax <= pageHeightPoints * settings.page_edge_ratio
            || current.yMin >= pageHeightPoints * (1 - settings.page_edge_ratio));
        findings.push({
          severity: pageEdge ? 'info' : gap >= severePoints ? 'error' : 'warning',
          kind: pageEdge ? 'page-edge' : 'content-gap',
          page: page.page,
          gapMm: gap * pointsToMm,
          normalGapMm: normalGap * pointsToMm,
          after: previous.text,
          before: current.text,
        });
      }
    }
  }
  return findings
    .sort((left, right) => ({ error: 0, warning: 1, info: 2 }[left.severity] - ({ error: 0, warning: 1, info: 2 }[right.severity]) || right.gapMm - left.gapMm))
    .slice(0, settings.max_spacing_findings);
}

export function inspectPdfSpacing(layout, options = {}) {
  const requiredSettings = ['lane_origin_tolerance_mm', 'line_gap_warn_mm', 'line_gap_severe_mm', 'page_edge_ratio', 'max_spacing_findings'];
  const missingSettings = requiredSettings.filter((key) => !Number.isFinite(options[key]));
  if (!Number.isFinite(options.pointsPerInch) || missingSettings.length) {
    throw new Error(`pdf spacing inspection requires render-config quality.layout_diff and canvas.points_per_inch; missing ${missingSettings.concat(Number.isFinite(options.pointsPerInch) ? [] : ['pointsPerInch']).join(', ')}`);
  }
  return spacingFindings(layout, options, 25.4 / options.pointsPerInch);
}

function spacingDifferenceKey(finding) {
  return `${finding.page}|${normalizeToken(finding.after)}|${normalizeToken(finding.before)}`;
}

function spacingDifferences(expected, actual, settings) {
  const expectedByKey = new Map(expected.map((finding) => [spacingDifferenceKey(finding), finding]));
  const changed = [];
  for (const finding of actual) {
    const before = expectedByKey.get(spacingDifferenceKey(finding));
    if (!before) {
      changed.push({ ...finding, change: 'added' });
      continue;
    }
    const deltaMm = finding.gapMm - before.gapMm;
    if (Math.abs(deltaMm) >= settings.movement_warn_mm) {
      const severity = finding.kind === 'page-edge'
        ? 'info'
        : Math.abs(deltaMm) >= settings.line_gap_severe_mm ? 'error' : 'warning';
      changed.push({ ...finding, severity, change: 'changed', gapDeltaMm: deltaMm, previousGapMm: before.gapMm });
    }
  }
  return changed.sort((left, right) => ({ error: 0, warning: 1, info: 2 }[left.severity] - ({ error: 0, warning: 1, info: 2 }[right.severity]) || right.gapMm - left.gapMm));
}

function envelope(layout, pointsToMm) {
  return layout.pages.map((page) => {
    const lines = page.lines;
    if (!lines.length) return { page: page.page, lineCount: 0 };
    return {
      page: page.page,
      lineCount: lines.length,
      topMm: Math.min(...lines.map((line) => line.yMin * pointsToMm)),
      bottomMm: Math.max(...lines.map((line) => line.yMax * pointsToMm)),
      leftMm: Math.min(...lines.map((line) => line.xMin * pointsToMm)),
      rightMm: Math.max(...lines.map((line) => line.xMax * pointsToMm)),
      firstText: lines[0].text,
      lastText: lines[lines.length - 1].text,
    };
  });
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export function comparePdfLayouts(expected, actual, options = {}) {
  const requiredSettings = ['movement_warn_mm', 'movement_error_mm', 'lane_origin_tolerance_mm', 'line_gap_warn_mm', 'line_gap_severe_mm', 'page_edge_ratio', 'max_spacing_findings', 'anchor_token_count'];
  const missingSettings = requiredSettings.filter((key) => !Number.isFinite(options[key]));
  if (!Number.isFinite(options.pointsPerInch) || missingSettings.length) {
    throw new Error(`pdf layout diff requires render-config quality.layout_diff and canvas.points_per_inch; missing ${missingSettings.concat(Number.isFinite(options.pointsPerInch) ? [] : ['pointsPerInch']).join(', ')}`);
  }
  const pointsToMm = 25.4 / options.pointsPerInch;
  const settings = options;
  const expectedLines = allLines(expected);
  const actualLines = allLines(actual);
  const matches = matchLines(expectedLines, actualLines, settings.anchor_token_count);
  const movements = matches.map(({ expected: before, actual: after }) => {
    const dx = (after.xMin - before.xMin) * pointsToMm;
    const dy = (after.yMin - before.yMin) * pointsToMm;
    const widthDelta = ((after.xMax - after.xMin) - (before.xMax - before.xMin)) * pointsToMm;
    const heightDelta = ((after.yMax - after.yMin) - (before.yMax - before.yMin)) * pointsToMm;
    const pageChanged = before.page !== after.page;
    const distance = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(widthDelta), Math.abs(heightDelta));
    return {
      text: before.text,
      expected: { page: before.page, xMm: round(before.xMin * pointsToMm), yMm: round(before.yMin * pointsToMm) },
      actual: { page: after.page, xMm: round(after.xMin * pointsToMm), yMm: round(after.yMin * pointsToMm) },
      delta: { page: after.page - before.page, xMm: round(dx), yMm: round(dy), widthMm: round(widthDelta), heightMm: round(heightDelta) },
      severity: pageChanged || distance >= settings.movement_error_mm ? 'error' : distance >= settings.movement_warn_mm ? 'warning' : 'info',
    };
  }).filter((movement) => movement.severity !== 'info');
  const text = countDifferences(tokenCounts(expected), tokenCounts(actual));
  const expectedSpacing = spacingFindings(expected, settings, pointsToMm);
  const actualSpacing = spacingFindings(actual, settings, pointsToMm);
  const spacing = spacingDifferences(expectedSpacing, actualSpacing, settings);
  const expectedEnvelope = envelope(expected, pointsToMm);
  const actualEnvelope = envelope(actual, pointsToMm);
  const envelopeChanges = actualEnvelope.flatMap((after) => {
    const before = expectedEnvelope.find((item) => item.page === after.page);
    if (!before || !after.lineCount) return [];
    const changes = {
      page: after.page,
      topDeltaMm: after.topMm - before.topMm,
      bottomDeltaMm: after.bottomMm - before.bottomMm,
      leftDeltaMm: after.leftMm - before.leftMm,
      rightDeltaMm: after.rightMm - before.rightMm,
      lineDelta: after.lineCount - before.lineCount,
    };
    const changed = [changes.topDeltaMm, changes.bottomDeltaMm, changes.leftDeltaMm, changes.rightDeltaMm]
      .some((value) => Math.abs(value) >= settings.movement_warn_mm) || changes.lineDelta !== 0;
    return changed ? [{ ...changes, topDeltaMm: round(changes.topDeltaMm), bottomDeltaMm: round(changes.bottomDeltaMm), leftDeltaMm: round(changes.leftDeltaMm), rightDeltaMm: round(changes.rightDeltaMm) }] : [];
  });
  return {
    status: text.missing.length || text.extra.length ? 'incomparable-content' : movements.length || spacing.some((item) => item.severity !== 'info') || envelopeChanges.length || expected.pages.length !== actual.pages.length ? 'changed' : 'identical',
    hasErrors: text.missing.length || text.extra.length || movements.some((item) => item.severity === 'error') || spacing.some((item) => item.severity === 'error'),
    pages: { expected: expected.pages.length, actual: actual.pages.length, delta: actual.pages.length - expected.pages.length },
    text: { expectedTokens: [...tokenCounts(expected).values()].reduce((sum, count) => sum + count, 0), actualTokens: [...tokenCounts(actual).values()].reduce((sum, count) => sum + count, 0), missing: text.missing, extra: text.extra },
    matchedLines: matches.length,
    movements: movements.sort((left, right) => (right.severity === 'error') - (left.severity === 'error') || Math.max(Math.abs(right.delta.xMm), Math.abs(right.delta.yMm)) - Math.max(Math.abs(left.delta.xMm), Math.abs(left.delta.yMm))),
    spacing,
    spacingFindings: actualSpacing,
    envelopeChanges,
    expectedEnvelope,
    actualEnvelope,
  };
}

function shorten(value, maxLength) {
  const text = value.replace(/\s+/gu, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function formatPdfLayoutDiff(report, paths = {}) {
  const lines = [
    'PDF layout diff',
    `expected: ${paths.expected ?? '(memory)'} | actual: ${paths.actual ?? '(memory)'}`,
    `status: ${report.status}`,
    ...(report.status === 'incomparable-content' ? ['comparison: source text differs; geometry findings are partial and require a deliberate fixture decision'] : []),
    `pages: ${report.pages.expected} -> ${report.pages.actual} (delta ${report.pages.delta})`,
    `text tokens: ${report.text.expectedTokens} -> ${report.text.actualTokens}; missing ${report.text.missing.length}; extra ${report.text.extra.length}`,
    `matched text lines: ${report.matchedLines}`,
  ];
  if (report.text.missing.length) lines.push(`missing text: ${report.text.missing.slice(0, 12).map((item) => `${item.token}×${item.count}`).join(', ')}`);
  if (report.text.extra.length) lines.push(`extra text: ${report.text.extra.slice(0, 12).map((item) => `${item.token}×${item.count}`).join(', ')}`);
  if (report.movements.length) {
    lines.push('text movements:');
    for (const movement of report.movements.slice(0, 20)) {
      const delta = movement.delta;
      lines.push(`  [${movement.severity}] "${shorten(movement.text, 72)}" p${movement.expected.page} (${movement.expected.xMm},${movement.expected.yMm}) -> p${movement.actual.page} (${movement.actual.xMm},${movement.actual.yMm}); Δx ${delta.xMm}mm, Δy ${delta.yMm}mm`);
    }
  }
  if (report.envelopeChanges.length) {
    lines.push('page text envelope changes:');
    for (const change of report.envelopeChanges) {
      lines.push(`  p${change.page}: top ${change.topDeltaMm >= 0 ? '+' : ''}${change.topDeltaMm}mm, bottom ${change.bottomDeltaMm >= 0 ? '+' : ''}${change.bottomDeltaMm}mm, left ${change.leftDeltaMm >= 0 ? '+' : ''}${change.leftDeltaMm}mm, right ${change.rightDeltaMm >= 0 ? '+' : ''}${change.rightDeltaMm}mm, lines ${change.lineDelta >= 0 ? '+' : ''}${change.lineDelta}`);
    }
  }
  if (report.spacing.length) {
    lines.push('large or irregular vertical gaps:');
    for (const finding of report.spacing) {
      const label = finding.kind === 'page-edge' ? 'page edge' : 'content';
      const change = finding.change === 'changed' ? `, previous ${finding.previousGapMm.toFixed(1)}mm` : '';
      lines.push(`  [${finding.severity}/${label}/${finding.change}] p${finding.page}: ${finding.gapMm.toFixed(1)}mm after "${shorten(finding.after, 48)}" before "${shorten(finding.before, 48)}" (lane normal ${finding.normalGapMm.toFixed(1)}mm${change})`);
    }
  }
  if (report.spacingFindings?.length) {
    lines.push('observed large or irregular vertical gaps:');
    for (const finding of report.spacingFindings) {
      const label = finding.kind === 'page-edge' ? 'page edge' : 'content';
      lines.push(`  [${finding.severity}/${label}] p${finding.page}: ${finding.gapMm.toFixed(1)}mm after "${shorten(finding.after, 48)}" before "${shorten(finding.before, 48)}" (lane normal ${finding.normalGapMm.toFixed(1)}mm)`);
    }
  }
  return `${lines.join('\n')}\n`;
}
