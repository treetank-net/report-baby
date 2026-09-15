import assert from 'node:assert/strict';

/**
 * @test-decision plan-assertion
 * @test-action Keep this shared assertion in the plan-only editorial contract; do not require a rendered artifact.
 */
export function plannedLines(plan) {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

/**
 * @test-decision plan-assertion
 * @test-action Keep numbered source coverage as a semantic plan assertion, independent of PDF extraction.
 */
export function numberedTokens(text, prefixes) {
  const pattern = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  return [...text.matchAll(new RegExp(`\\b(?:${pattern})\\d{4}\\b`, 'gu'))].map((match) => match[0]);
}

/**
 * @test-decision plan-assertion
 * @test-action Keep token numbering validation in the plan contract; PDF token parity belongs to the opt-in visual gate.
 */
export function numbers(tokens) {
  return tokens.map((token) => Number(token.match(/\d{4}$/u)?.[0]));
}

/**
 * @test-decision plan-assertion
 * @test-action Keep exact source coverage in the plan contract; do not duplicate this assertion in backend tests.
 */
export function assertExactNumberSet(actual, expected, message) {
  const sortedActual = [...actual].sort((a, b) => a - b);
  assert.deepEqual(sortedActual, expected, message);
}

/**
 * @test-decision plan-assertion
 * @test-action Keep the flow-barrier registry assertion as plan geometry validation without rasterization.
 */
export function assertFlowBarrierBoxCandidates(result) {
  const candidates = result.plan.flowBarrierBoxCandidates ?? [];
  assert.ok(candidates.length > 0, 'editorial plan must expose flow barrier box candidates');
  assert.ok(result.plan.decisions.some((decision) => decision.code === 'FLOW_BARRIER_BOXES_CONSUMED'), 'editorial planner must consume flow barrier box candidates while wrapping text');
  for (const candidate of candidates) {
    assert.equal(typeof candidate.flowId, 'string');
    assert.ok(candidate.previousSourceId || candidate.nextSourceId);
    assert.ok(candidate.box.width > 0 && candidate.box.height > 0, `flow barrier box candidate must have a positive box: ${JSON.stringify(candidate)}`);
    for (const sourceId of [candidate.previousSourceId, candidate.nextSourceId].filter(Boolean)) {
      const source = result.plan.graphicPlacements.find((graphic) => graphic.graphicId === sourceId && graphic.page === candidate.page);
      assert.ok(source, `flow barrier box candidate must reference an existing graphic: ${JSON.stringify(candidate)}`);
    }
    const placement = result.plan.flowPlacements.find((flowPlacement) => flowPlacement.id === candidate.placementId && flowPlacement.page === candidate.page);
    assert.ok(placement, `flow barrier box candidate must reference an existing flow placement: ${JSON.stringify(candidate)}`);
    assert.ok(candidate.box.x >= placement.box.x && candidate.box.x + candidate.box.width <= placement.box.x + placement.box.width);
    assert.ok(candidate.box.y >= placement.box.y && candidate.box.y + candidate.box.height <= placement.box.y + placement.box.height);
  }
  assert.ok(candidates.some((candidate) => candidate.flowId === 'main' && (candidate.previousSourceId?.startsWith('insertion:') || candidate.nextSourceId?.startsWith('insertion:'))), 'editorial main flow must expose at least one insertion candidate');
}

/**
 * @test-decision plan-assertion
 * @test-action Keep flow-barrier containment as a plan assertion; pixel occupancy is tested only by the visual gate.
 */
export function assertOrdinaryLinesRespectFlowBarrierBoxCandidates(result) {
  const candidatesByPlacement = new Map();
  for (const candidate of result.plan.flowBarrierBoxCandidates ?? []) {
    const group = candidatesByPlacement.get(candidate.placementId) ?? [];
    group.push(candidate);
    candidatesByPlacement.set(candidate.placementId, group);
  }
  for (const placement of result.plan.flowPlacements ?? []) {
    const candidates = candidatesByPlacement.get(placement.id);
    if (!candidates) continue;
    const lines = result.plan.lines.filter((line) => line.page === placement.page && line.slotId === placement.slotId);
    for (const line of lines) {
      assert.ok(candidates.some((candidate) => line.box.y >= candidate.box.y
        && line.box.y + line.box.height <= candidate.box.y + candidate.box.height),
      `ordinary line escaped its consumed flow barrier candidate: ${JSON.stringify({ line, candidates })}`);
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep route continuity in the plan contract; it does not require rendering.
 */
export function assertNoInternalRouteGaps(result) {
  for (const page of result.plan.pages) {
    const layout = result.template.pageTemplates.find((candidate) => candidate.id === page.pageTemplateId);
    const route = result.template.routes.main;
    const slots = route.slots;
    const occupied = new Set(result.plan.lines
      .filter((line) => line.flowId === 'main' && line.page === page.page && line.routeIndex !== undefined)
      .map((line) => line.routeIndex));
    const ordered = [...occupied].sort((a, b) => a - b);
    if (ordered.length < 2) continue;
    for (let index = ordered[0]; index <= ordered.at(-1); index += 1) {
      if (occupied.has(index)) continue;
      const slotId = slots[index];
      const definition = layout?.slots.find((slot) => slot.id === slotId);
      if (definition?.kind === 'block') continue;
      assert.fail(`page ${page.page} has an unfilled main-flow route segment ${index} before later content`);
    }
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep continuation-column ordering in the plan contract; do not rasterize to prove it.
 */
export function assertNoEmptyContinuationColumn(result) {
  const mainLines = result.plan.lines.filter((line) => line.flowId === 'main' && !line.blockId.startsWith('header') && !line.blockId.startsWith('footer'));
  for (const page of result.plan.pages.slice(0, -1)) {
    const pageLines = mainLines.filter((line) => line.page === page.page);
    if (pageLines.length === 0) continue;
    const segmentLines = result.plan.slots
      .filter((slot) => slot.page === page.page && slot.id.includes(':segment-'))
      .map((slot) => ({ slotId: slot.id, slot, lines: pageLines.filter((line) => line.slotId === slot.id) }))
      .sort((left, right) => left.slot.box.x - right.slot.box.x);
    if (segmentLines.length < 2) continue;
    assert.ok(segmentLines[0].lines.length > 0, `page ${page.page} entered a later column without using the first column`);
    assert.ok(segmentLines[1].lines.length > 0, `page ${page.page} left the second column empty before continuing the flow to the next page`);
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep placement registry consistency as a semantic plan invariant.
 */
export function assertFlowPlacementRegistryMatchesPlan(result) {
  const registry = result.plan.flowPlacements ?? [];
  const allPlannedLines = plannedLines(result.plan);
  const routedTextSlots = result.plan.slots.filter((slot) => slot.kind === 'text'
    && slot.flowId !== undefined
    && slot.routeIndex !== undefined);
  assert.equal(new Set(registry.map((placement) => placement.id)).size, registry.length, 'flow placement registry must not contain duplicate placement ids');
  assert.deepEqual(
    new Set(registry.map((placement) => placement.slotId)),
    new Set(routedTextSlots.map((slot) => slot.id)),
    'flow placement registry must include every routed text slot, including empty capacity',
  );
  for (const placement of registry) {
    const lines = allPlannedLines.filter((line) => line.flowId === placement.flowId && line.slotId === placement.slotId);
    const blockIds = [...new Set(lines.map((line) => line.blockId))];
    assert.equal(placement.hasContent, lines.length > 0, `flow placement ${placement.id} hasContent must match its actual lines`);
    assert.equal(placement.lineCount, lines.length, `flow placement ${placement.id} lineCount must match its actual lines`);
    assert.deepEqual(placement.blockIds, blockIds, `flow placement ${placement.id} must identify its actual blocks`);
    assert.ok(Number.isFinite(placement.box.x) && Number.isFinite(placement.box.y)
      && placement.box.width > 0 && placement.box.height > 0,
    `flow placement ${placement.id} must expose usable geometry`);
    assert.ok(lines.every((line) => line.routeIndex === undefined || line.routeIndex === placement.routeIndex), `flow placement ${placement.id} must own all routed lines from its route index`);
  }
}

/**
 * @test-decision plan-assertion
 * @test-action Keep physical reading order in the plan contract; PDF text extraction is redundant for the fast gate.
 */
export function assertPhysicalReadingOrder(result, fixture) {
  const authoredBlockOrder = new Map(fixture.sourceShape.map((block, index) => [block.id, index]));
  const planNumbers = numbers(numberedTokens(plannedLines(result.plan)
    .sort((left, right) => (authoredBlockOrder.get(left.blockId) ?? Number.MAX_SAFE_INTEGER) - (authoredBlockOrder.get(right.blockId) ?? Number.MAX_SAFE_INTEGER) || left.startWord - right.startWord)
    .map((line) => line.text).join(' '), fixture.tokenPrefixes));
  assert.deepEqual(planNumbers, Array.from({ length: fixture.totalMainWords }, (_, index) => index + 1), 'planner reading order must be monotonically increasing');
}

/**
 * @test-decision plan-assertion
 * @test-action Keep authored quote geometry and flow ownership in the plan-only editorial contract.
 */
export function assertQuoteFlowOwnership(result, fixture, renderConfig) {
  assert.equal(result.plan.lines.some((line) => line.layer === 'insertion'), false, 'ordinary flow must not contain insertion lines');
  assert.equal(new Set((result.plan.insertionLines ?? []).map((line) => line.blockId)).size, 4, 'all four authored quotes must be present in the insertion layer');
  assert.equal((result.plan.insertionLines ?? []).every((line) => line.flowId === 'quotes'), true, 'quote text must remain in the quote flow');
  assert.equal(result.plan.lines.some((line) => line.blockId.startsWith('quote-')), false, 'quote text must never enter the main flow');
  const quoteGlyphs = (result.plan.glyphPlacements ?? []).filter((glyph) => glyph.targetType === 'block' && result.document.flows.quotes.blocks.some((block) => block.id === glyph.targetId));
  assert.equal(quoteGlyphs.length, 8, 'each of the four quote blocks must resolve its opening and closing glyph object');
  assert.ok(quoteGlyphs.every((glyph) => glyph.source === 'authored'), 'quote marks must come from explicit authored glyph objects');
  assert.ok(quoteGlyphs.filter((glyph) => glyph.anchor === 'text-end').every((glyph) => glyph.anchorMeasureStyleName === undefined), 'closing quote glyphs must anchor to the visible quote text width');
  assert.ok(quoteGlyphs.every((glyph) => glyph.box.width > 0 && glyph.box.height > 0 && Number.isFinite(glyph.baselineY)), 'quote glyph objects must expose measurable geometry and baseline');
  const insertionGroups = new Map();
  for (const line of result.plan.insertionLines ?? []) {
    const group = insertionGroups.get(line.slotId) ?? [];
    group.push(line);
    insertionGroups.set(line.slotId, group);
  }
  const tolerance = renderConfig.quality.pdf_pixel_qa.placement_tolerance_mm;
  for (const [slotId, lines] of insertionGroups) {
    const slot = result.plan.slots.find((candidate) => candidate.id === slotId);
    assert.ok(slot, `quote line references missing slot ${slotId}`);
    const lineTop = Math.min(...lines.map((line) => line.box.y));
    const lineBottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
    const lineCenter = (lineTop + lineBottom) / 2;
    const slotCenter = slot.box.y + slot.box.height / 2;
    assert.ok(Math.abs(lineCenter - slotCenter) <= tolerance, `quote is not vertically centered: ${JSON.stringify({ slotId, lineTop, lineBottom, slot: slot.box, tolerance })}`);
  }
  const introBlockIds = new Set(fixture.sourceShape.filter((block) => block.role === 'intro').map((block) => block.id));
  const introLines = result.plan.lines.filter((line) => introBlockIds.has(line.blockId));
  assert.ok(introLines.length > 0, 'numbered fixture must place its intro content');
  assert.equal(introLines.every((line) => line.slotId.endsWith(':intro')), true, 'intro content must use the semantic intro slot instead of ordinary column flow');
}

/**
 * @test-decision plan-assertion
 * @test-action Keep template ownership assertions here because they prove the editorial flow contract without backend output.
 */
export function assertEditorialTemplateContract(result) {
  assert.equal(result.template.headingKeepWithNextLines, 1, 'editorial template must configure one protected body line after a heading');
  const ordinaryLayout = result.template.pageTemplates.find((layout) => layout.id === 'pages/editorial-inset-two-column') ?? result.template.pageTemplates[0];
  const ordinaryRoute = result.template.routes.main.slots;
  assert.equal(ordinaryRoute.filter((slotId) => slotId.includes(':segment-')).length, 2, 'main flow must retain one segment per column');
  assert.equal(result.template.routes.main.insertionSlots, undefined, 'main flow must not own quote insertions');
  assert.deepEqual(result.template.routes.quotes.insertionSlots, ['quote-a', 'quote-b', 'quote-c'], 'quotes must be declared as a separate obstacle flow with three per-page insertion slots');
  assert.deepEqual(result.template.routes.intro.slots, ['intro'], 'intro Markdown image and lead must share a dedicated flow');
  assert.equal(result.template.routes.chart, undefined, 'editorial inset template must not reserve a chart section');
}
