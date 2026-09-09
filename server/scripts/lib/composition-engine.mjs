// Transitional composition-engine seam.
//
// The prototype kernel remains the implementation for now, but callers no
// longer need to know its legacy `blocks` / `sidebar` input shape. The next
// migration step can replace the injected planner without changing this
// semantic input adapter or its parity tests.

import { createPrototypePlanner } from '../prototype-composition-kernel.mjs';

const legacyPlanFixture = createPrototypePlanner();

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function flowBlocks(flow, fallback = []) {
  if (Array.isArray(flow)) return flow;
  if (flow && typeof flow === 'object' && Array.isArray(flow.blocks)) return flow.blocks;
  return fallback;
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function legacyRole(role, kind) {
  if (kind === 'heading' || role === 'heading') return 'section_heading';
  if (role === 'intro') return 'intro';
  if (role === 'sidebar') return 'sidebar';
  return 'body';
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function legacyText(block) {
  if (typeof block.text === 'string') return block.text;
  if (block.kind === 'metric' && block.metric) {
    return [block.metric.label, block.metric.value, block.metric.delta, block.metric.note].filter(Boolean).join(' ');
  }
  if (block.kind === 'chart' && block.chart) {
    return [block.chart.title, block.chart.subtitle, ...block.chart.data.map((datum) => `${datum.label} ${datum.value}`)].filter(Boolean).join(' ');
  }
  if (block.kind === 'table' && block.table) {
    return [block.table.caption, ...block.table.head, ...block.table.body.flat()].filter((value) => value !== undefined && value !== null).join(' · ');
  }
  return '';
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function legacyBlock(block) {
  if (!block || typeof block !== 'object') throw new TypeError('Composition flow blocks must be objects.');
  if (typeof block.type === 'string') return block;
  const kind = typeof block.kind === 'string' ? block.kind : 'paragraph';
  const type = kind === 'heading' ? 'heading' : kind === 'list-item' ? 'list-item' : kind;
  const keepNext = block.keepWithNextLines === undefined ? undefined : { lines: block.keepWithNextLines };
  return {
    ...block,
    type,
    role: legacyRole(block.role, kind),
    text: legacyText(block),
    ...(keepNext ? { keepNext } : {}),
  };
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function slotId(page, regionId) {
  return `${page + 1}:${regionId}`;
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function slotFromRegion(page, regionId, region, flowId) {
  return {
    id: slotId(page.index, regionId),
    page: page.index + 1,
    regionId,
    flowId,
    box: { x: region.x, y: region.y, width: region.width, height: region.bottom - region.y },
    state: 'open',
  };
}

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
function compositionPlanFromLegacy(legacyPlan) {
  const pages = legacyPlan.pages.map((page) => ({
    page: page.index + 1,
    layoutId: legacyPlan.preset ?? 'prototype',
    width: legacyPlan.pageSize.width_mm,
    height: legacyPlan.pageSize.height_mm,
  }));
  const slotDefinitions = legacyPlan.pages.flatMap((page) => [
    ...page.article.tracks.map((track) => slotFromRegion(page, track.id, track, 'main')),
    slotFromRegion(page, 'sidebar', page.sidebar, 'sidebar'),
  ]);
  const linePlacements = legacyPlan.lines.map((line, index) => ({
    id: `line:${index + 1}`,
    blockId: line.blockId,
    slotId: slotId(line.page, line.region === 'sidebar' ? 'sidebar' : line.track),
    page: line.page + 1,
    box: { x: line.x, y: line.y, width: line.width, height: line.height },
    startWord: line.startWord,
    endWord: line.endWord,
  }));
  const graphicPlacements = [
    ...legacyPlan.images.map((image) => ({
      id: `image:${image.id}`,
      blockId: image.anchorBlock ?? image.id,
      slotId: slotId(image.page, image.tracks?.[0] ?? (image.track === 'sidebar' ? 'sidebar' : image.track)),
      page: image.page + 1,
      box: { x: image.x, y: image.y, width: image.width, height: image.height },
    })),
    ...legacyPlan.boxes.map((box) => ({
      id: `box:${box.id}`,
      blockId: box.id,
      slotId: slotId(box.page, box.tracks?.[0] ?? 'main'),
      page: box.page + 1,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
    })),
  ];
  const occupancy = new Map();
  for (const placement of [...linePlacements, ...graphicPlacements]) {
    const bottom = placement.box.y + placement.box.height;
    occupancy.set(placement.slotId, Math.max(occupancy.get(placement.slotId) ?? Number.NEGATIVE_INFINITY, bottom));
  }
  const slots = slotDefinitions.map((slot) => {
    const occupiedBottom = occupancy.get(slot.id);
    if (occupiedBottom === undefined) return slot;
    return {
      ...slot,
      state: occupiedBottom >= slot.box.y + slot.box.height ? 'exhausted' : 'partial',
    };
  });
  const diagnostics = [
    ...legacyPlan.diagnostics.map((diagnostic) => ({
      severity: 'warning',
      code: diagnostic.code,
      message: `Composition diagnostic ${diagnostic.code}.`,
      ...(diagnostic.page === undefined ? {} : { page: diagnostic.page + 1 }),
      ...(diagnostic.track ? { slotId: slotId(diagnostic.page ?? 0, diagnostic.track) } : {}),
      details: { ...diagnostic },
    })),
    ...legacyPlan.violations.map((violation) => ({
      severity: 'error',
      code: violation.code,
      message: `Composition violation ${violation.code}.`,
      details: { ...violation },
    })),
  ];
  const regionForBlock = new Map(legacyPlan.source.blocks.map((block) => [block.id, block.region === 'sidebar' ? 'sidebar' : 'main']));
  const sourceByBlock = new Map(legacyPlan.source.blocks.map((block) => [block.id, block]));
  const linesByBlock = new Map();
  for (const line of legacyPlan.lines) {
    const lines = linesByBlock.get(line.blockId) ?? [];
    lines.push(line);
    linesByBlock.set(line.blockId, lines);
  }
  const residualContent = [];
  for (const source of legacyPlan.source.blocks) {
    const lines = [...(linesByBlock.get(source.id) ?? [])].sort((left, right) => left.startWord - right.startWord);
    const totalWords = source.wordCount;
    const consumedEnd = lines.reduce((maximum, line) => Math.max(maximum, line.endWord), 0);
    if (consumedEnd >= totalWords) continue;
    const lastLine = lines.at(-1);
    residualContent.push({
      flowId: regionForBlock.get(source.id) ?? 'main',
      blockId: source.id,
      reason: lines.length ? 'partial-block-remainder' : 'not-placed-by-prototype',
      consumed: { start: 0, end: consumedEnd },
      remaining: { start: consumedEnd, end: totalWords },
      ...(lastLine ? { lastLegalSlotId: slotId(lastLine.page, lastLine.region === 'sidebar' ? 'sidebar' : lastLine.track) } : {}),
    });
  }
  return {
    pages,
    slots,
    placements: [...linePlacements, ...graphicPlacements],
    graphicPlacements: graphicPlacements.map((placement) => ({
      id: placement.id,
      graphicId: placement.blockId,
      slotId: placement.slotId,
      page: placement.page,
      shape: legacyPlan.images.find((image) => image.id === placement.blockId)?.shape ?? 'rectangle',
      wrap: 'around',
      box: placement.box,
    })),
    lines: legacyPlan.lines.map((line) => ({
      blockId: line.blockId,
      flowId: line.region === 'sidebar' ? 'sidebar' : 'main',
      slotId: slotId(line.page, line.region === 'sidebar' ? 'sidebar' : line.track),
      page: line.page + 1,
      text: line.text,
      box: { x: line.x, y: line.y, width: line.width, height: line.height },
      naturalWidth: line.naturalWidth,
      startWord: line.startWord,
      endWord: line.endWord,
    })),
    decisions: legacyPlan.decisions,
    diagnostics,
    residualContent,
  };
}

/**
 * Convert the current prototype fixture into the small semantic document
 * accepted by the composition-engine seam.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function documentFromLegacyFixture(fixture) {
  const { blocks, sidebar, ...rest } = fixture;
  return {
    ...rest,
    flows: {
      main: { blocks: Array.isArray(blocks) ? blocks : [] },
      sidebar: { blocks: Array.isArray(sidebar) ? sidebar : [] },
    },
    images: Array.isArray(fixture.images) ? fixture.images : [],
  };
}

/**
 * Convert the semantic document back to the legacy kernel input. This is the
 * compatibility boundary; the kernel itself is deliberately not aware of
 * the new naming.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function legacyFixtureFromDocument(document) {
  if (!document || typeof document !== 'object') throw new TypeError('Composition document must be an object.');
  const flows = document.flows && typeof document.flows === 'object' ? document.flows : {};
  for (const [flowId, flow] of Object.entries(flows)) {
    if (!['main', 'sidebar'].includes(flowId) && flowBlocks(flow).length > 0) {
      throw new Error(`The prototype composition adapter cannot route flow '${flowId}' yet.`);
    }
  }
  const main = flowBlocks(flows.main, document.blocks).map(legacyBlock);
  const sidebar = flowBlocks(flows.sidebar, document.sidebar).map(legacyBlock);
  const {
    flows: _flows,
    regions: _regions,
    routes: _routes,
    placements: _placements,
    blocks: _blocks,
    sidebar: _sidebar,
    ...rest
  } = document;
  return {
    ...rest,
    blocks: main,
    sidebar,
    images: Array.isArray(document.images) ? document.images : [],
  };
}

/**
 * Plan a semantic composition document with the current prototype kernel.
 * `planner` is injectable so the legacy implementation can be replaced after
 * parity is established without changing callers.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function createCompositionEngine({ planner = legacyPlanFixture } = {}) {
  if (typeof planner !== 'function') throw new TypeError('Composition planner must be a function.');
  return {
    plan(document, metrics) {
      return planner(legacyFixtureFromDocument(document), metrics);
    },
  };
}

export const compositionEngine = createCompositionEngine();

/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function planComposition(document, metrics) {
  return compositionEngine.plan(document, metrics);
}

/**
 * Transitional projection of the prototype result into the renderer-neutral
 * engine contract. The raw plan remains available for parity and debugging.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function planCompositionContract(document, metrics) {
  const raw = compositionEngine.plan(document, metrics);
  const plan = compositionPlanFromLegacy(raw.plan);
  const status = raw.plan.status === 'rejected'
    ? 'rejected'
    : raw.plan.status === 'accepted-with-warnings'
      ? 'accepted-with-warnings'
      : 'accepted';
  return {
    plan,
    evaluation: {
      status,
      diagnostics: plan.diagnostics,
      residualContent: plan.residualContent,
    },
    raw,
  };
}
