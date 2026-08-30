#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — plan-level acceptance tests.
// It intentionally does not trust the renderer's own evaluation field.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-composition-contract-test');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const runA = join(outputRoot, 'run-a');
const runB = join(outputRoot, 'run-b');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function runGenerator(output) {
  rmSync(output, { recursive: true, force: true });
  execFileSync(process.execPath, [generator, '--no-render', '--case', 'all', '--out', output], {
    stdio: 'ignore',
    timeout: 120000,
  });
}

function readPlan(rootDir, fixture) {
  const directory = readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(rootDir, entry.name))
    .find((candidate) => {
      try {
        return JSON.parse(readFileSync(join(candidate, 'plan.json'), 'utf8')).fixture === fixture;
      } catch {
        return false;
      }
    });
  assert(directory, `Missing plan for fixture ${fixture}`);
  return JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
}

function regionForLine(plan, line) {
  if (line.region === 'sidebar') return plan.pages[line.page]?.sidebar;
  return plan.pages[line.page]?.article?.tracks?.find((track) => track.id === line.track);
}

function imageIntervalAt(image, y) {
  if (y < image.y || y > image.y + image.height) return null;
  if (image.shape === 'ellipse') {
    const normalized = (y - (image.y + image.height / 2)) / (image.height / 2);
    const radius = image.width / 2 * Math.sqrt(Math.max(0, 1 - normalized * normalized));
    const center = image.x + image.width / 2;
    return { left: center - radius, right: center + radius };
  }
  if (image.shape === 'diagonal' || image.shape === 'staircase') {
    const normalized = Math.max(-1, Math.min(1, (y - (image.y + image.height / 2)) / (image.height / 2)));
    const fraction = normalized < 0 ? image.wrapFractions[0] : image.wrapFractions[1];
    if (image.side === 'left') return { left: image.x, right: image.x + image.width * fraction };
    return { left: image.x + image.width * (1 - fraction), right: image.x + image.width };
  }
  if (image.shape === 'triangle') {
    const progress = Math.max(0, Math.min(1, (y - image.y) / image.height));
    const fraction = image.apex === 'bottom' ? 1 - progress : progress;
    if (image.side === 'left') return { left: image.x, right: image.x + image.width * fraction };
    return { left: image.x + image.width * (1 - fraction), right: image.x + image.width };
  }
  if (image.shape === 'star') {
    const points = [];
    const centerX = image.x + image.width / 2;
    const centerY = image.y + image.height / 2;
    for (let index = 0; index < image.starPoints * 2; index += 1) {
      const radius = index % 2 === 0 ? 1 : image.starInnerRatio;
      const angle = -Math.PI / 2 + (index * Math.PI) / image.starPoints;
      points.push([
        centerX + Math.cos(angle) * (image.width / 2) * radius,
        centerY + Math.sin(angle) * (image.height / 2) * radius,
      ]);
    }
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const first = points[index];
      const second = points[(index + 1) % points.length];
      if (first[1] === second[1] || y < Math.min(first[1], second[1]) || y >= Math.max(first[1], second[1])) continue;
      intersections.push(first[0] + ((y - first[1]) * (second[0] - first[0])) / (second[1] - first[1]));
    }
    if (intersections.length >= 2) return { left: Math.min(...intersections), right: Math.max(...intersections) };
  }
  return { left: image.x, right: image.x + image.width };
}

function lineIntersectsImage(line, image) {
  if (image.position?.wrap === false || line.page !== image.page || line.region !== 'article') return false;
  if (!(image.tracks?.includes(line.track) || line.track === image.track)) return false;
  const renderedWidth = line.finalLine ? line.naturalWidth : line.width;
  return [line.y + 0.05, line.y + line.height / 2, line.y + line.height - 0.05].some((y) => {
    const interval = imageIntervalAt(image, y);
    return interval && line.x < interval.right - 0.01 && line.x + renderedWidth > interval.left + 0.01;
  });
}

function expectedRejected(fixtureOrPlan) {
  const fixture = typeof fixtureOrPlan === 'string' ? fixtureOrPlan : fixtureOrPlan.fixture;
  const qaExpected = typeof fixtureOrPlan === 'string' ? null : fixtureOrPlan.qa?.expectedStatus;
  return qaExpected === 'rejected' || new Set([
    'large-image-rejected',
    'unsatisfiable',
    'unsupported-arabic-bidi',
    'unsupported-cjk-vertical',
    'unsupported-vertical-lr',
  ]).has(fixture);
}

function checkSourceRanges(plan, errors) {
  const source = new Map(plan.source.blocks.map((block) => [block.id, block]));
  for (const block of plan.source.blocks) {
    const lines = plan.lines.filter((line) => line.blockId === block.id).sort((a, b) => a.startWord - b.startWord);
    let cursor = 0;
    for (const line of lines) {
      if (line.endWord <= line.startWord) errors.push({ code: 'EMPTY_SOURCE_RANGE', blockId: block.id });
      if (line.startWord !== cursor) errors.push({ code: cursor < line.startWord ? 'SOURCE_RANGE_GAP' : 'SOURCE_RANGE_OVERLAP', blockId: block.id, expected: cursor, actual: line.startWord });
      cursor = Math.max(cursor, line.endWord);
    }
    if (plan.status !== 'rejected' && plan.status !== 'accepted-with-warnings' && cursor !== block.wordCount) errors.push({ code: 'SOURCE_RANGE_INCOMPLETE', blockId: block.id, expected: block.wordCount, actual: cursor });
    if (source.get(block.id)?.marker && lines.length && !lines[0].marker) errors.push({ code: 'MARKER_NOT_ON_FIRST_LINE', blockId: block.id });
  }
}

function checkReadingOrder(plan, errors) {
  const sourceOrder = new Map(plan.source.blocks.map((block, index) => [block.id, index]));
  for (const region of ['article', 'sidebar']) {
    const lines = plan.lines.filter((line) => line.region === region).sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (region === 'article') {
        const aTrack = plan.pages[a.page].article.tracks.findIndex((track) => track.id === a.track);
        const bTrack = plan.pages[b.page].article.tracks.findIndex((track) => track.id === b.track);
        if (aTrack !== bTrack) return aTrack - bTrack;
      }
      return a.y - b.y || a.line - b.line;
    });
    let previous = null;
    for (const line of lines) {
      const current = [sourceOrder.get(line.blockId), line.startWord];
      if (previous && (current[0] < previous[0] || (current[0] === previous[0] && current[1] < previous[1]))) {
        errors.push({ code: 'READING_ORDER_REGRESSION', region, blockId: line.blockId, page: line.page, track: line.track });
      }
      previous = current;
    }
  }
}

function checkGeometry(plan, errors) {
  const previousByFragmentainer = new Map();
  for (const line of plan.lines) {
    const region = regionForLine(plan, line);
    if (!region) {
      errors.push({ code: 'UNKNOWN_FRAGMENTAINER', blockId: line.blockId, page: line.page, track: line.track });
      continue;
    }
    const renderedWidth = line.finalLine ? line.naturalWidth : line.width;
    if (line.x < region.x - 0.01 || line.x + renderedWidth > region.x + region.width + 0.05) errors.push({ code: 'LINE_OUTSIDE_REGION', blockId: line.blockId, page: line.page, track: line.track });
    if (line.y < region.y - 0.01 || line.y + line.height > region.bottom + 0.05) errors.push({ code: 'LINE_OUTSIDE_BLOCK_RANGE', blockId: line.blockId, page: line.page, track: line.track });
    for (const field of ['x', 'y', 'width', 'naturalWidth', 'height']) {
      if (!Number.isFinite(line[field])) errors.push({ code: 'NON_FINITE_LINE_GEOMETRY', blockId: line.blockId, field });
    }
    if (line.width <= 0 || line.height <= 0) errors.push({ code: 'NON_POSITIVE_LINE_GEOMETRY', blockId: line.blockId });
    const fragmentainerKey = `${line.page}:${line.region}:${line.track}`;
    const previous = previousByFragmentainer.get(fragmentainerKey);
    if (previous && line.y < previous.y + previous.height - 0.01) {
      errors.push({ code: 'TEXT_LINE_OVERLAP', blockId: line.blockId, previousBlockId: previous.blockId, page: line.page, track: line.track });
    }
    if (!previous || line.y > previous.y) previousByFragmentainer.set(fragmentainerKey, line);
    if (line.overfull) errors.push({ code: 'OVERFULL_LINE', blockId: line.blockId });
    for (const image of plan.images) if (lineIntersectsImage(line, image)) errors.push({ code: 'LINE_INTERSECTS_IMAGE', blockId: line.blockId, image: image.id, page: line.page });
  }
}

function checkRequiredKeeps(plan, errors) {
  if (plan.status === 'rejected' || plan.status === 'accepted-with-warnings') return;
  for (const keep of plan.source.keeps.filter((candidate) => candidate.strength === 'required')) {
    const sourceSubject = plan.source.blocks.find((block) => block.id === keep.subject);
    const sourceCompanion = plan.source.blocks.find((block) => block.id === keep.companion);
    if (!sourceSubject || !sourceCompanion) continue;
    const subjectLines = plan.lines.filter((line) => line.blockId === keep.subject).sort((a, b) => a.startWord - b.startWord);
    const companionLines = plan.lines.filter((line) => line.blockId === keep.companion).sort((a, b) => a.startWord - b.startWord);
    const requiredCount = Math.min(keep.lines ?? 1, sourceCompanion.wordCount);
    const requiredCompanionLines = companionLines.slice(0, requiredCount);
    const cluster = [...subjectLines, ...requiredCompanionLines];
    if (!cluster.length || requiredCompanionLines.length < requiredCount) {
      errors.push({ code: 'REQUIRED_KEEP_CONTENT_MISSING', constraint: keep.id });
      continue;
    }
    const locations = new Set(cluster.map((line) => `${line.page}:${line.region}:${line.track}`));
    if (locations.size !== 1) errors.push({ code: 'REQUIRED_KEEP_SPLIT', constraint: keep.id, locations: [...locations] });
    if (companionLines[0]?.startWord !== 0) errors.push({ code: 'REQUIRED_KEEP_COMPANION_NOT_FROM_START', constraint: keep.id, actual: companionLines[0]?.startWord });
  }
}

function checkImages(plan, errors) {
  const sourceImages = new Map(plan.source.images.map((image) => [image.id, image]));
  const placed = new Map();
  for (const image of plan.images) {
    placed.set(image.id, (placed.get(image.id) ?? 0) + 1);
    if (!Number.isFinite(image.page) || !Number.isFinite(image.x) || !Number.isFinite(image.y)) errors.push({ code: 'IMAGE_MISSING_GEOMETRY', image: image.id });
  }
  for (const [id, count] of placed) if (count !== 1) errors.push({ code: 'IMAGE_PLACEMENT_NOT_UNIQUE', image: id, count });
  for (const image of plan.source.images) {
    const actual = plan.images.filter((candidate) => candidate.id === image.id);
    if (plan.status !== 'rejected' && plan.status !== 'accepted-with-warnings' && actual.length !== 1) errors.push({ code: 'IMAGE_NOT_PLACED_ON_ACCEPTED_PLAN', image: image.id, count: actual.length });
    if (image.pagePolicy === 'page-only' && actual.length === 1 && actual[0].page !== image.fixedPage) errors.push({ code: 'IMAGE_PAGE_POLICY_VIOLATED', image: image.id, expected: image.fixedPage, actual: actual[0].page });
  }
  for (const image of plan.images) {
    if (!sourceImages.has(image.id)) errors.push({ code: 'UNDECLARED_IMAGE_PLACEMENT', image: image.id });
  }
}

function checkOutcome(plan, errors) {
  const rejected = expectedRejected(plan);
  if (rejected && plan.status !== 'rejected') errors.push({ code: 'EXPECTED_REJECTION_MISSING', fixture: plan.fixture });
  if (!rejected && plan.status === 'rejected') errors.push({ code: 'UNEXPECTED_REJECTION', fixture: plan.fixture });
  if (plan.status === 'rejected') {
    if (plan.outcome?.status !== 'rejected') errors.push({ code: 'REJECTION_OUTCOME_MISSING', fixture: plan.fixture });
    if (!plan.outcome?.unsatisfiedCore?.length) errors.push({ code: 'REJECTION_CORE_MISSING', fixture: plan.fixture });
    if (plan.outcome?.artifact) errors.push({ code: 'REJECTED_ARTIFACT_PRESENT', fixture: plan.fixture });
  } else if (plan.status === 'accepted-with-warnings') {
    if (!plan.outcome?.warnings?.length) errors.push({ code: 'WARNING_OUTCOME_MISSING', fixture: plan.fixture });
  } else if (plan.evaluation?.violations?.length) {
    errors.push({ code: 'ACCEPTED_PLAN_HAS_VIOLATIONS', fixture: plan.fixture, violations: plan.evaluation.violations });
  }
  const pageIndexes = plan.pages.map((page) => page.index).sort((a, b) => a - b);
  if (pageIndexes.some((index, position) => index !== position)) errors.push({ code: 'PAGE_INDEX_GAP', fixture: plan.fixture, pageIndexes });
}

function checkExpectedDecisions(plan, errors) {
  const decisions = new Set(plan.decisions.map((decision) => decision.code));
  const required = {
    'large-block-scaled': ['IMAGE_SCALED_TO_FRAGMENTAINER'],
    'large-block-explicit-slot': ['IMAGE_RESERVED_SLOT'],
    'large-float-promoted': ['FLOAT_PROMOTED_TO_BLOCK'],
  }[plan.fixture] ?? [];
  for (const code of required) if (!decisions.has(code)) errors.push({ code: 'EXPECTED_DECISION_MISSING', fixture: plan.fixture, expected: code });
  if (plan.fixture === 'cross-column-continuation') {
    if (plan.pages.length < 2) errors.push({ code: 'CONTINUATION_PAGE_MISSING', fixture: plan.fixture });
    if (plan.images.length !== 1 || plan.images[0].page !== 0) errors.push({ code: 'PAGE_ONLY_IMAGE_REPAINTED_OR_MISPLACED', fixture: plan.fixture });
  }
  if (plan.fixture === 'short' && plan.pages.length !== 1) errors.push({ code: 'PHANTOM_PAGE', fixture: plan.fixture });
  if (plan.fixture === 'long' && plan.pages.length < 2) errors.push({ code: 'LONG_FLOW_NOT_CONTINUED', fixture: plan.fixture });
  if (plan.fixture === 'justified-columns' && plan.pages.length < 2) errors.push({ code: 'JUSTIFIED_FLOW_NOT_CONTINUED', fixture: plan.fixture });
  if (plan.fixture === 'stair-step-wrap' || plan.fixture === 'stair-step-corrected' || plan.fixture === 'triangle-wrap') {
    const expectedImage = plan.fixture === 'stair-step-wrap'
      ? 'image-stair-step'
      : plan.fixture === 'stair-step-corrected' ? 'image-stair-step-corrected' : 'image-triangle';
    const wrapped = plan.lines
      .filter((line) => line.wrap?.imageId === expectedImage && line.wrap.availableX > plan.pages[line.page].article.tracks.find((track) => track.id === line.track).x + 0.01);
    const steps = [];
    for (const line of wrapped) {
      const previous = steps.at(-1);
      if (!previous || Math.abs(previous.availableX - line.wrap.availableX) > 0.01) {
        steps.push({ availableX: line.wrap.availableX, lines: 1 });
      } else {
        previous.lines += 1;
      }
    }
    if (steps.length < 2) errors.push({ code: 'STAIRCASE_WRAP_NOT_RECORDED', fixture: plan.fixture, steps });
    for (let index = 1; index < steps.length; index += 1) {
      if (steps[index].availableX <= steps[index - 1].availableX) errors.push({ code: 'STAIRCASE_WRAP_NOT_MONOTONIC', fixture: plan.fixture, steps });
    }
  }
  if (plan.fixture === 'multi-shape-collage') {
    const wrapped = plan.lines.filter((line) => line.wrap?.imageIds?.length === 3);
    if (!wrapped.length) errors.push({ code: 'MULTI_SHAPE_BARRIER_NOT_COMBINED', fixture: plan.fixture });
    if (!plan.images.every((image) => plan.images.filter((candidate) => candidate.y === image.y).length === 3)) {
      errors.push({ code: 'MULTI_SHAPE_IMAGES_NOT_COLOCATED', fixture: plan.fixture });
    }
  }
}

function evaluatePlan(plan) {
  const errors = [];
  checkSourceRanges(plan, errors);
  checkReadingOrder(plan, errors);
  // A rejected plan may intentionally contain the offending partial placement
  // (for example an overfull unbreakable token); geometry is fail-closed only
  // for plans that claim acceptance.
  if (plan.status !== 'rejected' && plan.status !== 'accepted-with-warnings') checkGeometry(plan, errors);
  checkRequiredKeeps(plan, errors);
  checkImages(plan, errors);
  checkOutcome(plan, errors);
  checkExpectedDecisions(plan, errors);
  return errors;
}

function canonical(plan) {
  return JSON.stringify(plan);
}

function main() {
  mkdirSync(outputRoot, { recursive: true });
  runGenerator(runA);
  runGenerator(runB);
  const fixtures = JSON.parse(readFileSync(join(runA, 'report.json'), 'utf8')).map((entry) => entry.fixture);
  const result = [];
  for (const fixture of fixtures) {
    const planA = readPlan(runA, fixture);
    const planB = readPlan(runB, fixture);
    const errors = evaluatePlan(planA);
    assert(canonical(planA) === canonical(planB), `${fixture}: non-deterministic canonical plan`);
    result.push({ fixture, status: planA.status, errors });
  }

  const baseline = readPlan(runA, 'baseline');
  const mutatedGeometry = structuredClone(baseline);
  mutatedGeometry.lines[0].x = -100;
  const geometryMutationErrors = [];
  checkGeometry(mutatedGeometry, geometryMutationErrors);
  assert(geometryMutationErrors.some((error) => error.code === 'LINE_OUTSIDE_REGION'), 'mutation gate: geometry mutation was not detected');
  const mutatedRange = structuredClone(baseline);
  const rangeBlockId = baseline.source.blocks
    .map((block) => ({ block, lines: baseline.lines.filter((line) => line.blockId === block.id).sort((left, right) => left.startWord - right.startWord) }))
    .find((candidate) => candidate.lines.length >= 2)?.block.id;
  const rangeLines = mutatedRange.lines.filter((line) => line.blockId === rangeBlockId).sort((left, right) => left.startWord - right.startWord);
  rangeLines[1].startWord = rangeLines[0].startWord;
  assert(evaluatePlan(mutatedRange).some((error) => error.code === 'SOURCE_RANGE_OVERLAP'), 'mutation gate: source-range mutation was not detected');
  const mutatedKeep = structuredClone(baseline);
  const keepCompanionLine = mutatedKeep.lines.find((line) => line.blockId === 'section-1-body' && line.startWord === 0);
  keepCompanionLine.track = 'secondary';
  mutatedKeep.status = 'accepted-with-decisions';
  const keepMutationErrors = [];
  checkRequiredKeeps(mutatedKeep, keepMutationErrors);
  assert(keepMutationErrors.some((error) => error.code === 'REQUIRED_KEEP_SPLIT'), 'mutation gate: keep mutation was not detected');

  const failing = result.filter((entry) => entry.errors.length);
  writeFileSync(join(outputRoot, 'contract-report.json'), `${JSON.stringify({ results: result, mutationGate: 'passed' }, null, 2)}\n`);
  if (failing.length) fail(`Composition contract failed: ${JSON.stringify(failing, null, 2)}`);
  console.log(JSON.stringify({ status: 'passed', fixtures: result.length, mutationGate: 'passed', report: join(outputRoot, 'contract-report.json') }, null, 2));
}

main();
