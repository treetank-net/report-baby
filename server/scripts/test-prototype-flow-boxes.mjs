#!/usr/bin/env node

// PROTOTYPE TEST HARNESS — intro represented as a normal first-page flow box.
// The checks use the plan and rendered artifacts independently of evaluator
// status so a visually clipped box cannot be declared successful accidentally.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/report-baby-flow-box-contract');
const generator = join(root, 'scripts', 'prototype-composition-kernel.mjs');
const ids = [
  'flowBoxShort',
  'flowBoxExpanded',
  'flowBoxNearPageEnd',
  'flowBoxKeepsHeading',
  'flowBoxLoremVariant',
  'flowBoxImpossible',
  'flowBoxEmpty',
  'flowBoxOverLeadSecondary',
  'flowBoxOverSecondarySidebar',
  'flowBoxOverAllRegions',
  'flowBoxPartialLeadToSidebar',
  'flowBoxFloatQuotes',
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function planFor(id) {
  const path = join(outputRoot, id, 'plan.json');
  assert(existsSync(path), `${id}: missing plan artifact`);
  return { path, plan: JSON.parse(readFileSync(path, 'utf8')) };
}

function assertBoxGeometry(plan) {
  if (plan.fixture === 'flow-box-empty') {
    assert(plan.boxes.length === 0, `${plan.fixture}: empty box retained spacing or placement`);
    assert(plan.lines.length > 0, `${plan.fixture}: content disappeared after empty-box collapse`);
    return;
  }
  assert(plan.boxes.length > 0, `${plan.fixture}: expected at least one flow box`);
  for (const box of plan.boxes) {
    assert(box.page === 0, `${plan.fixture}: flow box moved away from page 1`);
    assert(box.lines.length > 0, `${plan.fixture}: flow box has no planned text lines`);
    for (const line of box.lines) {
      assert(line.x >= box.x && line.x + line.width <= box.x + box.width + 0.01, `${plan.fixture}: flow-box line escapes horizontally`);
      assert(line.y >= box.y && line.y + line.height <= box.y + box.height + 0.01, `${plan.fixture}: flow-box line escapes vertically`);
    }
  }
  const blockBoxes = plan.boxes.filter((box) => box.placement !== 'float');
  for (const box of blockBoxes) {
    if (plan.source.sidebarStart === 'prelude' && box.spanRegions?.includes('sidebar')) assert(plan.pages[0].sidebar.y > box.y, `${plan.fixture}: sidebar was not pushed below a spanning box`);
  }
  for (const page of plan.pages.slice(1)) {
    assert(!plan.boxes.some((candidate) => candidate.page === page.index), `${plan.fixture}: flow box appeared on continuation page ${page.index + 1}`);
  }
  if (plan.pages.length > 1 && blockBoxes.length > 0) {
    assert(plan.pages[0].article.tracks.some((track, index) => track.y > plan.pages[1].article.tracks[index].y), `${plan.fixture}: first-page box did not reduce any spanned body start`);
    assert(plan.pages.slice(1).every((page) => page.article.tracks.every((track) => track.y === page.article.tracks[0].y)), `${plan.fixture}: continuation tracks are not aligned`);
  }
}

rmSync(outputRoot, { recursive: true, force: true });
execFileSync(process.execPath, [generator, '--case', ids.join(','), '--out', outputRoot], {
  stdio: 'ignore',
  timeout: 120000,
});

const reports = ids.map((id) => {
  const { plan } = planFor(id);
  const expected = plan.qa?.expectedStatus ?? 'accepted';
  assert(plan.status === expected || (expected === 'accepted' && plan.status === 'accepted-with-decisions'), `${id}: expected ${expected}, got ${plan.status}`);
  assertBoxGeometry(plan);
  const articleLinesOnFirstPage = plan.lines.filter((line) => line.region === 'article' && line.page === 0);
  if (plan.qa.minPages !== undefined) assert(plan.pages.length >= plan.qa.minPages, `${id}: expected at least ${plan.qa.minPages} pages, got ${plan.pages.length}`);
  if (plan.qa.minFirstArticleLines !== undefined) assert(articleLinesOnFirstPage.length >= plan.qa.minFirstArticleLines, `${id}: expected first-page article content`);
  if (plan.qa.maxFirstArticleLines !== undefined) assert(articleLinesOnFirstPage.length <= plan.qa.maxFirstArticleLines, `${id}: first-page article was not near the page end`);
  if (plan.qa.firstPageArticleLines !== undefined) assert(articleLinesOnFirstPage.length === plan.qa.firstPageArticleLines, `${id}: expected ${plan.qa.firstPageArticleLines} first-page article lines, got ${articleLinesOnFirstPage.length}`);
  if (id === 'flowBoxShort') {
    assert(new Set(articleLinesOnFirstPage.map((line) => line.track)).size === plan.pages[0].article.tracks.length, `${id}: remaining content did not use the available article tracks`);
  }
  if (id === 'flowBoxKeepsHeading') {
    const headingId = `${plan.fixture}-heading`;
    const bodyId = `${plan.fixture}-body`;
    const heading = plan.lines.find((line) => line.blockId === headingId);
    const body = plan.lines.find((line) => line.blockId === bodyId);
    assert(heading && body && heading.page === body.page && heading.track === body.track, `${id}: heading/body keep cluster split after box`);
  }
  if (id === 'flowBoxImpossible') {
    assert(plan.violations.some((violation) => violation.code === 'FLOW_BOX_OVERFLOW'), `${id}: missing flow-box overflow diagnostic`);
    assert(!existsSync(join(outputRoot, id, `${plan.fixture}.pdf`)), `${id}: rejected box unexpectedly produced a PDF`);
  }
  if (id === 'flowBoxOverLeadSecondary') {
    const box = plan.boxes[0];
    assert(box.tracks.join(',') === 'lead,secondary', `${id}: explicit article span changed unexpectedly`);
    assert(plan.pages[0].article.tracks[0].y === plan.pages[0].article.tracks[1].y, `${id}: selected article tracks diverged vertically`);
    assert(plan.pages[0].sidebar.y < plan.pages[0].article.tracks[0].y, `${id}: unselected sidebar was also pushed`);
  }
  if (id === 'flowBoxOverSecondarySidebar') {
    const box = plan.boxes[0];
    assert(box.tracks.join(',') === 'secondary,sidebar', `${id}: sidebar span was not preserved`);
    assert(plan.pages[0].article.tracks[0].y < plan.pages[0].article.tracks[1].y, `${id}: lead track was pushed despite not being spanned`);
    assert(plan.pages[0].sidebar.y > box.y, `${id}: sidebar did not move below its spanning box`);
  }
  if (id === 'flowBoxOverAllRegions') {
    assert(plan.boxes[0].tracks.join(',') === 'lead,secondary,sidebar', `${id}: all-region span was not preserved`);
    assert(plan.pages[0].article.tracks.every((track) => track.y > plan.boxes[0].y), `${id}: article tracks did not move below all-region box`);
    assert(plan.pages[0].sidebar.y > plan.boxes[0].y, `${id}: sidebar did not move below all-region box`);
  }
  if (id === 'flowBoxPartialLeadToSidebar') {
    const box = plan.boxes[0];
    assert(box.x > plan.pages[0].article.tracks[0].x, `${id}: partial span did not inset its left edge`);
    assert(box.x + box.width < plan.pages[0].sidebar.x + plan.pages[0].sidebar.width, `${id}: partial span did not inset its right edge`);
    assert(box.tracks.join(',') === 'lead,secondary,sidebar', `${id}: partial span lost its region coverage`);
  }
  if (id === 'flowBoxFloatQuotes') {
    const floatBoxes = plan.boxes.filter((box) => box.placement === 'float');
    assert(floatBoxes.length === 2, `${id}: expected two floating quote boxes, got ${floatBoxes.length}`);
    assert(plan.decisions.filter((decision) => decision.code === 'FLOW_BOX_FLOAT_PLACED').length === 2, `${id}: floating boxes were not recorded as placement decisions`);
    assert(!plan.violations.some((violation) => violation.code === 'LINE_INTERSECTS_FLOW_BOX'), `${id}: text intersects a floating quote box`);
    assert(plan.lines.some((line) => line.wrap?.imageIds?.some((boxId) => floatBoxes.some((box) => box.id === boxId))), `${id}: text did not flow around a floating quote box`);
  }
  return { id, status: plan.status, pages: plan.pages.length, boxHeight: plan.boxes[0]?.height ?? 0, firstPageArticleLines: articleLinesOnFirstPage.length };
});

console.log(JSON.stringify({ status: 'passed', fixtureCount: reports.length, reports }, null, 2));
