import type { CompositionDocument } from './model.js';
import type {
  CompositionDiagnostic,
  CompositionEvaluation,
  CompositionPlan,
  CompositionSlot,
} from './engine.js';
import { graphicIntervalsForLine } from './graphic-geometry.js';

function wordsOf(text: string | undefined): string[] {
  return text?.trim().split(/\s+/u).filter(Boolean) ?? [];
}

function error(code: string, message: string, details: Record<string, unknown> = {}): CompositionDiagnostic {
  return { severity: 'error', code, message, ...(Object.keys(details).length ? { details } : {}) };
}

function slotFor(plan: CompositionPlan, slotId: string): CompositionSlot | undefined {
  return plan.slots.find((slot) => slot.id === slotId);
}

function geometryTolerance(...values: number[]): number {
  return Number.EPSILON * Math.max(1, ...values.map((value) => Math.abs(value))) * 64;
}

function fitsInside(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }): boolean {
  const tolerance = geometryTolerance(inner.x, inner.y, inner.width, inner.height, outer.x, outer.y, outer.width, outer.height);
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  const horizontal = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const vertical = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const scale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(a.width), Math.abs(a.height), Math.abs(b.x), Math.abs(b.y), Math.abs(b.width), Math.abs(b.height));
  const precision = Number.EPSILON * scale * 32;
  return horizontal > precision && vertical > precision;
}

function lineEntersGraphic(line: CompositionPlan['lines'][number], graphic: CompositionPlan['graphicPlacements'][number]): boolean {
  return graphicIntervalsForLine(graphic, line.box.y, line.box.height).some((interval) => {
    const overlap = Math.min(line.box.x + line.box.width, interval.end) - Math.max(line.box.x, interval.start);
    const scale = Math.max(1, Math.abs(line.box.x), Math.abs(line.box.width), Math.abs(interval.start), Math.abs(interval.end));
    return overlap > Number.EPSILON * scale * 32;
  });
}

function usableLinesAfter(
  line: CompositionPlan['lines'][number],
  slot: CompositionSlot,
  graphics: CompositionPlan['graphicPlacements'],
): number {
  const lineHeight = line.box.height;
  if (lineHeight <= 0) return 0;
  let usable = 0;
  for (let y = line.box.y + lineHeight; y + lineHeight <= slot.box.y + slot.box.height + geometryTolerance(y, slot.box.y + slot.box.height); y += lineHeight) {
    const available = graphics.some((graphic) => graphic.page === line.page
      && graphic.slotId !== slot.id
      && graphic.wrap === 'around'
      && lineEntersGraphic({ ...line, box: { ...line.box, y } }, graphic));
    if (!available) usable += 1;
  }
  return usable;
}

function checkEarlyRouteTransitions(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const minimum = plan.minimumFragmentLines;
  if (minimum === undefined || !Number.isInteger(minimum) || minimum <= 0) return;
  const byFlowAndPage = new Map<string, CompositionPlan['lines']>();
  const sourceBlocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  for (const line of plan.lines) {
    if (line.routeIndex === undefined) continue;
    const key = `${line.flowId}:${line.page}`;
    byFlowAndPage.set(key, [...(byFlowAndPage.get(key) ?? []), line]);
  }
  for (const [key, lines] of byFlowAndPage) {
    const ordered = [...lines].sort((left, right) => (left.routeIndex ?? 0) - (right.routeIndex ?? 0) || left.box.y - right.box.y || left.box.x - right.box.x);
    const routeGroups = new Map<number, CompositionPlan['lines']>();
    for (const line of ordered) routeGroups.set(line.routeIndex!, [...(routeGroups.get(line.routeIndex!) ?? []), line]);
    const routeIndexes = [...routeGroups.keys()].sort((left, right) => left - right);
    for (let index = 1; index < routeIndexes.length; index += 1) {
      const previousLines = routeGroups.get(routeIndexes[index - 1])!;
      const nextLines = routeGroups.get(routeIndexes[index])!;
      const previous = [...previousLines].sort((left, right) => left.box.y - right.box.y).at(-1)!;
      const slot = slotFor(plan, previous.slotId);
      if (!slot || slot.regionId !== 'content') continue;
      const previousBlock = sourceBlocks.get(previous.blockId);
      if (previousBlock?.role === 'intro' || previousBlock?.role === 'title' || previousBlock?.role === 'subtitle') continue;
      const usable = usableLinesAfter(previous, slot, plan.graphicPlacements);
      if (usable < minimum) continue;
      diagnostics.push(error(
        'FLOW_FRAGMENT_UNDERFILLED',
        `Flow '${key.split(':')[0]}' advanced to route segment ${routeIndexes[index]} while ${usable} usable line(s) remained in '${previous.slotId}'.`,
        {
          flowId: key.split(':')[0],
          page: previous.page,
          slotId: previous.slotId,
          details: {
            previousRouteIndex: routeIndexes[index - 1],
            nextRouteIndex: routeIndexes[index],
            nextSlotId: nextLines[0].slotId,
            usableLines: usable,
            minimumFragmentLines: minimum,
          },
        },
      ));
    }
  }
}

function checkInsertionSourceOrder(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const placedItems = [
    ...plan.lines,
    ...plan.blockPlacements,
    ...plan.tablePlacements,
  ];
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    for (const [quoteIndex, quote] of flow.blocks.entries()) {
      if (quote.role !== 'quote') continue;
      const quoteLines = plan.lines.filter((line) => line.flowId === flowId && line.blockId === quote.id);
      if (quoteLines.length === 0) continue;
      const quoteGraphic = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${quote.id}`);
      if (!quoteGraphic) continue;
      const quotePage = quoteGraphic?.page ?? quoteLines[0].page;
      const quoteBox = quoteGraphic?.box ?? quoteLines.reduce((box, line) => ({
        x: Math.min(box.x, line.box.x),
        y: Math.min(box.y, line.box.y),
        width: Math.max(box.x + box.width, line.box.x + line.box.width) - Math.min(box.x, line.box.x),
        height: Math.max(box.y + box.height, line.box.y + line.box.height) - Math.min(box.y, line.box.y),
      }), { ...quoteLines[0].box });
      const itemFlowId = (item: typeof placedItems[number]): string | undefined => 'flowId' in item ? item.flowId : blockFlowIds.get(item.blockId);
      const predecessors = placedItems.filter((item) => itemFlowId(item) === flowId && (blockIndexes.get(item.blockId) ?? Number.POSITIVE_INFINITY) < quoteIndex);
      const successors = placedItems.filter((item) => itemFlowId(item) === flowId && (blockIndexes.get(item.blockId) ?? Number.NEGATIVE_INFINITY) > quoteIndex);
      const predecessorAfterQuote = predecessors.find((item) => item.page > quotePage || (item.page === quotePage && item.box.y >= quoteBox.y + quoteBox.height));
      if (predecessorAfterQuote) {
        diagnostics.push(error(
          'INSERTION_SOURCE_ORDER_VIOLATION',
          `Content preceding insertion '${quote.id}' is placed after its obstacle.`,
          { flowId, blockId: quote.id, page: quotePage, details: { predecessorBlockId: predecessorAfterQuote.blockId, predecessorPage: predecessorAfterQuote.page, predecessorY: predecessorAfterQuote.box.y, obstacleY: quoteBox.y, obstacleBottom: quoteBox.y + quoteBox.height } },
        ));
      }
      const successorBeforeQuote = successors.find((item) => item.page < quotePage || (item.page === quotePage && item.box.y < quoteBox.y));
      if (successorBeforeQuote) {
        diagnostics.push(error(
          'INSERTION_SOURCE_ORDER_VIOLATION',
          `Content following insertion '${quote.id}' is placed before its obstacle.`,
          { flowId, blockId: quote.id, page: quotePage, details: { successorBlockId: successorBeforeQuote.blockId, successorPage: successorBeforeQuote.page, successorY: successorBeforeQuote.box.y, obstacleY: quoteBox.y } },
        ));
      }
    }
  }
}

/**
 * Evaluate the renderer-neutral text plan before a backend is allowed to draw.
 * This evaluator intentionally knows nothing about PDF, PNG or jsPDF.
 */
export function evaluateCompositionPlan(document: CompositionDocument, plan: CompositionPlan): CompositionEvaluation {
  const diagnostics = [...plan.diagnostics];
  checkEarlyRouteTransitions(document, plan, diagnostics);
  checkInsertionSourceOrder(document, plan, diagnostics);
  const repeatedFlows = new Set(plan.repeatFlowIds ?? []);
  for (const message of document.diagnostics ?? []) {
    diagnostics.push({ severity: 'warning', code: 'DOCUMENT_DIAGNOSTIC', message });
  }
  const seenLines = new Set<string>();
  for (const line of plan.lines) {
    const slot = slotFor(plan, line.slotId);
    if (!slot) {
      diagnostics.push(error('LINE_TARGET_MISSING', `Line for '${line.blockId}' targets missing slot '${line.slotId}'.`, { blockId: line.blockId, slotId: line.slotId }));
      continue;
    }
    const key = `${line.flowId}:${line.blockId}:${line.startWord}:${line.endWord}${repeatedFlows.has(line.flowId) ? `:${line.page}` : ''}`;
    if (seenLines.has(key)) diagnostics.push(error('DUPLICATE_CONTENT', `Content range '${key}' was placed more than once.`, { blockId: line.blockId, slotId: line.slotId }));
    seenLines.add(key);
    if (line.page !== slot.page || !fitsInside(line.box, slot.box)) {
      diagnostics.push(error('LINE_OUTSIDE_SLOT', `Line for '${line.blockId}' leaves slot '${slot.id}'.`, { blockId: line.blockId, slotId: slot.id, page: line.page }));
    }
  }
  for (let index = 0; index < plan.lines.length; index += 1) {
    const line = plan.lines[index];
    for (let other = index + 1; other < plan.lines.length; other += 1) {
      const candidate = plan.lines[other];
      if (line.page === candidate.page && line.slotId === candidate.slotId && overlaps(line.box, candidate.box)) {
        diagnostics.push(error('LINE_OVERLAP', `Lines for '${line.blockId}' and '${candidate.blockId}' overlap in slot '${line.slotId}'.`, { slotId: line.slotId, page: line.page, firstBlockId: line.blockId, secondBlockId: candidate.blockId }));
      }
    }
  }
  for (const line of plan.lines) {
    for (const graphic of plan.graphicPlacements) {
      if (graphic.page === line.page && graphic.slotId !== line.slotId && graphic.wrap === 'around' && lineEntersGraphic(line, graphic)) {
        diagnostics.push(error('LINE_GRAPHIC_OVERLAP', `Line for '${line.blockId}' enters wrapping graphic '${graphic.graphicId}'.`, { blockId: line.blockId, graphicId: graphic.graphicId, slotId: line.slotId, page: line.page }));
      }
    }
  }
  for (const placement of plan.placements) {
    const slot = slotFor(plan, placement.slotId);
    if (!slot) {
      diagnostics.push(error('PLACEMENT_TARGET_MISSING', `Placement for '${placement.blockId}' targets missing slot '${placement.slotId}'.`, { blockId: placement.blockId, slotId: placement.slotId }));
      continue;
    }
    if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) {
      diagnostics.push(error('PLACEMENT_OUTSIDE_SLOT', `Placement for '${placement.blockId}' leaves slot '${slot.id}'.`, { blockId: placement.blockId, slotId: slot.id, page: placement.page }));
    }
  }
  const sourceBlocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  const deferredInsertionBlocks = new Set(plan.decisions
    .filter((decision) => decision.code === 'INSERTION_DEFERRED' && typeof decision.blockId === 'string')
    .map((decision) => decision.blockId as string));
  const repositionedInsertionBlocks = new Set(plan.decisions
    .filter((decision) => decision.code === 'INSERTION_REPOSITIONED' && typeof decision.blockId === 'string')
    .map((decision) => decision.blockId as string));
  const visualKey = (item: { page: number; routeIndex?: number; box: { x: number; y: number } }): [number, number, number, number] | undefined => item.routeIndex === undefined
    ? undefined
    : [item.page, item.routeIndex, item.box.y, item.box.x];
  const firstVisualPlacement = (blockId: string): [number, number, number, number] | undefined => {
    const candidates = [
      ...plan.lines.filter((line) => line.blockId === blockId),
      ...plan.blockPlacements.filter((placement) => placement.blockId === blockId),
      ...plan.tablePlacements.filter((placement) => placement.blockId === blockId),
    ].map(visualKey).filter((key): key is [number, number, number, number] => key !== undefined);
    return candidates.sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2] || left[3] - right[3])[0];
  };
  for (const flow of Object.values(document.flows)) {
    if (repeatedFlows.has(flow.id)) continue;
    let previous: { blockId: string; key: [number, number, number, number] } | undefined;
    for (const block of flow.blocks) {
      const key = firstVisualPlacement(block.id);
      if (!key) continue;
      const insertionOrderException = Boolean(
        previous && (deferredInsertionBlocks.has(previous.blockId)
          || repositionedInsertionBlocks.has(previous.blockId)
          || deferredInsertionBlocks.has(block.id)
          || repositionedInsertionBlocks.has(block.id)),
      );
      if (previous && !insertionOrderException && (key[0] < previous.key[0]
        || (key[0] === previous.key[0] && key[1] < previous.key[1])
        || (key[0] === previous.key[0] && key[1] === previous.key[1] && (key[2] < previous.key[2]
          || (key[2] === previous.key[2] && key[3] < previous.key[3]))))) {
        diagnostics.push(error(
          'CONTENT_ORDER_VIOLATION',
          `Block '${block.id}' is visually placed before preceding block '${previous.blockId}' in flow '${flow.id}'.`,
          { flowId: flow.id, blockId: block.id, previousBlockId: previous.blockId, actual: key, previous: previous.key },
        ));
      }
      if (!insertionOrderException) previous = { blockId: block.id, key };
    }
    const insertionRouteIndexes = new Map<number, Set<number>>();
    for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
      for (const line of plan.lines.filter((candidate) => candidate.blockId === block.id && candidate.routeIndex !== undefined)) {
        const indexes = insertionRouteIndexes.get(line.page) ?? new Set<number>();
        indexes.add(line.routeIndex!);
        insertionRouteIndexes.set(line.page, indexes);
      }
    }
    const flowingBlockIds = new Set(flow.blocks.filter((block) => block.kind !== 'table').map((block) => block.id));
    for (const blockId of flowingBlockIds) {
      const fragments = plan.lines
        .filter((line) => line.flowId === flow.id && line.blockId === blockId && line.routeIndex !== undefined)
        .sort((left, right) => left.startWord - right.startWord || left.page - right.page || (left.routeIndex ?? 0) - (right.routeIndex ?? 0));
      for (let index = 1; index < fragments.length; index += 1) {
        const previousFragment = fragments[index - 1];
        const fragment = fragments[index];
        if (previousFragment.page !== fragment.page || fragment.routeIndex === previousFragment.routeIndex) continue;
        if ((fragment.routeIndex ?? 0) < (previousFragment.routeIndex ?? 0)) continue;
        const insertionIndexes = insertionRouteIndexes.get(fragment.page) ?? new Set<number>();
        if ([...insertionIndexes].some((routeIndex) => routeIndex > (previousFragment.routeIndex ?? 0) && routeIndex < (fragment.routeIndex ?? 0))) {
          diagnostics.push(error(
            'BLOCK_SPLITS_ACROSS_INSERTION',
            `Block '${blockId}' is split across a full-width insertion in flow '${flow.id}'.`,
            {
              flowId: flow.id,
              blockId,
              page: fragment.page,
              previousRouteIndex: previousFragment.routeIndex,
              routeIndex: fragment.routeIndex,
            },
          ));
          continue;
        }
        const previousSlot = slotFor(plan, previousFragment.slotId);
        if (!previousSlot) continue;
        const previousBottom = previousFragment.box.y + previousFragment.box.height;
        const slotBottom = previousSlot.box.y + previousSlot.box.height;
        const unusedSpace = slotBottom - previousBottom;
        // A final line may leave a little more than one line-height at the
        // bottom because the block started after a fractional inter-block
        // gap. That is not an early column advance; a clearly visible
        // multi-line blank band is.
        if (unusedSpace > previousFragment.box.height * 2 + geometryTolerance(previousBottom, slotBottom)) {
          diagnostics.push(error(
            'FLOW_COLUMN_ADVANCE_EARLY',
            `Block '${blockId}' continues into a later route segment before the preceding segment is exhausted.`,
            {
              flowId: flow.id,
              blockId,
              page: fragment.page,
              slotId: fragment.slotId,
              details: {
                previousSlotId: previousFragment.slotId,
                previousRouteIndex: previousFragment.routeIndex,
                routeIndex: fragment.routeIndex,
                previousBottom,
                previousSlotBottom: slotBottom,
              },
            },
          ));
        }
      }
    }
    let previousQuote: { blockId: string; key: [number, number, number, number] } | undefined;
    for (const block of flow.blocks.filter((candidate) => candidate.role === 'quote')) {
      const key = firstVisualPlacement(block.id);
      if (!key) continue;
      if (previousQuote && (key[0] < previousQuote.key[0]
        || (key[0] === previousQuote.key[0] && key[1] < previousQuote.key[1])
        || (key[0] === previousQuote.key[0] && key[1] === previousQuote.key[1] && (key[2] < previousQuote.key[2]
          || (key[2] === previousQuote.key[2] && key[3] < previousQuote.key[3]))))) {
        diagnostics.push(error(
          'QUOTE_ORDER_VIOLATION',
          `Quote '${block.id}' is visually placed before preceding quote '${previousQuote.blockId}' in flow '${flow.id}'.`,
          { flowId: flow.id, blockId: block.id, previousBlockId: previousQuote.blockId, actual: key, previous: previousQuote.key },
        ));
      }
      previousQuote = { blockId: block.id, key };
    }
    const blockIds = new Set(flow.blocks.map((block) => block.id));
    const occupiedRouteIndexes = new Map<number, Set<number>>();
    for (const item of [
      ...plan.lines.filter((line) => blockIds.has(line.blockId)),
      ...plan.blockPlacements.filter((placement) => blockIds.has(placement.blockId)),
      ...plan.tablePlacements.filter((placement) => blockIds.has(placement.blockId)),
    ]) {
      if (item.routeIndex === undefined) continue;
      const indexes = occupiedRouteIndexes.get(item.page) ?? new Set<number>();
      indexes.add(item.routeIndex);
      occupiedRouteIndexes.set(item.page, indexes);
    }
    const collapsedRouteIndexes = new Map<number, Set<number>>();
    const blockedRouteIndexes = new Map<number, Set<number>>();
    for (const decision of plan.decisions) {
      if (decision.flowId !== flow.id || typeof decision.routeIndex !== 'number' || typeof decision.page !== 'number') continue;
      if (decision.code === 'FLOW_SEGMENT_BLOCKED_BY_INSERTION') {
        const indexes = blockedRouteIndexes.get(decision.page) ?? new Set<number>();
        indexes.add(decision.routeIndex);
        blockedRouteIndexes.set(decision.page, indexes);
        continue;
      }
      if (decision.code !== 'OPTIONAL_INSERTION_COLLAPSED') continue;
      const indexes = collapsedRouteIndexes.get(decision.page) ?? new Set<number>();
      indexes.add(decision.routeIndex);
      collapsedRouteIndexes.set(decision.page, indexes);
    }
    for (const [page, indexes] of occupiedRouteIndexes) {
      if (page === 1) continue;
      // Atomic slots may be intentionally sparse on a continuation page (for
      // example a fourth metric reusing the first card slot). Their unused
      // card positions are not text-flow gaps and are validated by the
      // atomic-placement checks instead.
      if (plan.blockPlacements.some((placement) => placement.page === page)
        || plan.tablePlacements.some((placement) => placement.page === page)) continue;
      const ordered = [...indexes].sort((left, right) => left - right);
      if (ordered.length < 2) continue;
      const collapsed = collapsedRouteIndexes.get(page) ?? new Set<number>();
      const blocked = blockedRouteIndexes.get(page) ?? new Set<number>();
      for (let index = ordered[0] + 1; index < ordered.at(-1)!; index += 1) {
        if (indexes.has(index) || collapsed.has(index) || blocked.has(index)) continue;
        diagnostics.push({
          severity: 'warning',
          code: 'ROUTE_SEGMENT_GAP',
          message: `Flow '${flow.id}' leaves route segment ${index} empty before later content on page ${page}.`,
          flowId: flow.id,
          page,
          details: { routeIndex: index, occupiedRouteIndexes: ordered },
        });
      }
    }
  }
  const seenTableRows = new Map<string, number>();
  for (const placement of plan.tablePlacements ?? []) {
    const source = sourceBlocks.get(placement.blockId);
    const table = source?.kind === 'table' ? source.table : undefined;
    if (!source) diagnostics.push(error('TABLE_SOURCE_MISSING', `Table placement '${placement.blockId}' has no source block.`, { blockId: placement.blockId, slotId: placement.slotId }));
    else if (source.kind !== 'table' || !table) diagnostics.push(error('TABLE_KIND_MISMATCH', `Placement '${placement.blockId}' does not reference a table block.`, { blockId: placement.blockId, slotId: placement.slotId }));
    const slot = slotFor(plan, placement.slotId);
    if (!slot) {
      diagnostics.push(error('TABLE_PLACEMENT_TARGET_MISSING', `Table placement '${placement.blockId}' targets missing slot '${placement.slotId}'.`, { blockId: placement.blockId, slotId: placement.slotId }));
    } else if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) {
      diagnostics.push(error('TABLE_PLACEMENT_OUTSIDE_SLOT', `Table placement '${placement.blockId}' leaves slot '${slot.id}'.`, { blockId: placement.blockId, slotId: placement.slotId, page: placement.page }));
    }
    const rowCount = table?.body.length ?? 0;
    if (!Number.isInteger(placement.startRow) || !Number.isInteger(placement.endRow) || placement.startRow < 0 || placement.endRow <= placement.startRow || placement.endRow > rowCount) {
      diagnostics.push(error('TABLE_ROW_RANGE_INVALID', `Table placement '${placement.blockId}' has an invalid row range.`, { blockId: placement.blockId, startRow: placement.startRow, endRow: placement.endRow, rowCount }));
    } else {
      const expected = seenTableRows.get(placement.blockId) ?? 0;
      if (placement.startRow !== expected) diagnostics.push(error('TABLE_ROW_COVERAGE_GAP', `Table '${placement.blockId}' is not covered continuously by row fragments.`, { blockId: placement.blockId, expected, actual: { start: placement.startRow, end: placement.endRow } }));
      seenTableRows.set(placement.blockId, Math.max(expected, placement.endRow));
    }
    for (const line of plan.lines) {
      if (line.page === placement.page && overlaps(line.box, placement.box)) diagnostics.push(error('TABLE_TEXT_OVERLAP', `Table '${placement.blockId}' overlaps text for '${line.blockId}'.`, { blockId: placement.blockId, secondBlockId: line.blockId, page: placement.page, slotId: placement.slotId }));
    }
    for (const other of plan.blockPlacements) {
      if (other.page === placement.page && overlaps(other.box, placement.box)) diagnostics.push(error('TABLE_BLOCK_OVERLAP', `Table '${placement.blockId}' overlaps block '${other.blockId}'.`, { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page }));
    }
  }
  for (const placement of plan.tablePlacements ?? []) {
    for (const other of plan.tablePlacements ?? []) {
      if (other === placement) break;
      if (other.page === placement.page && overlaps(other.box, placement.box)) diagnostics.push(error('TABLE_OVERLAP', `Table fragments '${other.blockId}' and '${placement.blockId}' overlap.`, { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page }));
    }
  }
  for (const flow of Object.values(document.flows)) {
    for (const block of flow.blocks) {
      if (block.kind !== 'table' || !block.table || block.table.body.length === 0) continue;
      const placedUntil = seenTableRows.get(block.id) ?? 0;
      if (placedUntil !== block.table.body.length) diagnostics.push(error('TABLE_NOT_FULLY_PLACED', `Table '${block.id}' has ${block.table.body.length - placedUntil} unplaced row(s).`, { flowId: flow.id, blockId: block.id, placedUntil, rowCount: block.table.body.length }));
    }
  }
  const seenAtomicBlocks = new Set<string>();
  for (const placement of plan.blockPlacements) {
    const source = sourceBlocks.get(placement.blockId);
    if (!source) {
      diagnostics.push(error('BLOCK_SOURCE_MISSING', `Atomic block placement '${placement.blockId}' has no source block.`, { blockId: placement.blockId, slotId: placement.slotId }));
    } else {
      if (!source.atomic) diagnostics.push(error('NON_ATOMIC_BLOCK_PLACED', `Block '${placement.blockId}' is placed atomically but is not marked atomic.`, { blockId: placement.blockId, slotId: placement.slotId }));
      if (source.kind !== placement.kind) diagnostics.push(error('BLOCK_KIND_MISMATCH', `Placement for '${placement.blockId}' has kind '${placement.kind}', but its source kind is '${source.kind}'.`, { blockId: placement.blockId, slotId: placement.slotId }));
      if (source.kind === 'image' && (!source.image || !document.assets?.some((asset) => asset.id === source.image?.assetId))) {
        diagnostics.push(error('IMAGE_ASSET_NOT_FOUND', `Image block '${placement.blockId}' references a missing asset.`, { blockId: placement.blockId, slotId: placement.slotId, details: { assetId: source.image?.assetId } }));
      }
    }
    if (seenAtomicBlocks.has(placement.blockId)) diagnostics.push(error('DUPLICATE_BLOCK_PLACEMENT', `Atomic block '${placement.blockId}' was placed more than once.`, { blockId: placement.blockId, slotId: placement.slotId }));
    seenAtomicBlocks.add(placement.blockId);
    const slot = slotFor(plan, placement.slotId);
    if (!slot) {
      diagnostics.push(error('BLOCK_PLACEMENT_TARGET_MISSING', `Atomic block '${placement.blockId}' targets missing slot '${placement.slotId}'.`, { blockId: placement.blockId, slotId: placement.slotId }));
      continue;
    }
    if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) {
      diagnostics.push(error('BLOCK_PLACEMENT_OUTSIDE_SLOT', `Atomic block '${placement.blockId}' leaves slot '${slot.id}'.`, { blockId: placement.blockId, slotId: slot.id, page: placement.page }));
    }
    const wrappedImage = source?.kind === 'image' && (source.image?.wrap === 'left' || source.image?.wrap === 'right');
    for (const line of plan.lines) {
      if (!wrappedImage && line.page === placement.page && overlaps(line.box, placement.box)) diagnostics.push(error('BLOCK_TEXT_OVERLAP', `Atomic block '${placement.blockId}' overlaps text for '${line.blockId}'.`, { blockId: placement.blockId, secondBlockId: line.blockId, page: placement.page, slotId: placement.slotId }));
    }
    for (const other of plan.blockPlacements) {
      if (other === placement) break;
      if (other.page === placement.page && overlaps(other.box, placement.box)) diagnostics.push(error('BLOCK_OVERLAP', `Atomic blocks '${other.blockId}' and '${placement.blockId}' overlap.`, { blockId: placement.blockId, secondBlockId: other.blockId, page: placement.page }));
    }
  }
  for (const flow of Object.values(document.flows)) {
    for (const block of flow.blocks) {
      if (!block.atomic) continue;
      const placements = plan.blockPlacements.filter((placement) => placement.blockId === block.id);
      if (placements.length === 0) diagnostics.push(error('ATOMIC_BLOCK_NOT_FULLY_PLACED', `Atomic block '${block.id}' has no planned placement.`, { blockId: block.id, flowId: flow.id }));
    }
  }
  for (const graphic of plan.graphicPlacements) {
    if (graphic.assetId !== undefined && !document.assets?.some((asset) => asset.id === graphic.assetId)) {
      diagnostics.push(error('GRAPHIC_ASSET_NOT_FOUND', `Graphic '${graphic.graphicId}' references missing asset '${graphic.assetId}'.`, { graphicId: graphic.graphicId, assetId: graphic.assetId }));
    }
    const slot = slotFor(plan, graphic.slotId);
    if (!slot) {
      diagnostics.push(error('GRAPHIC_TARGET_MISSING', `Graphic '${graphic.graphicId}' targets missing slot '${graphic.slotId}'.`, { graphicId: graphic.graphicId, slotId: graphic.slotId }));
      continue;
    }
    if (graphic.page !== slot.page || !fitsInside(graphic.box, slot.box)) {
      diagnostics.push(error('GRAPHIC_OUTSIDE_SLOT', `Graphic '${graphic.graphicId}' leaves slot '${slot.id}'.`, { graphicId: graphic.graphicId, slotId: slot.id, page: graphic.page }));
    }
  }
  for (const residual of plan.residualContent) {
    diagnostics.push(error('RESIDUAL_CONTENT', `Flow '${residual.flowId}' still contains content from '${residual.blockId}'.`, { flowId: residual.flowId, blockId: residual.blockId, remaining: residual.remaining ?? null, remainingRows: residual.remainingRows ?? null }));
  }
  for (const [flowId, flow] of Object.entries(document.flows)) {
    for (const block of flow.blocks) {
      const wordCount = wordsOf(block.text).length;
      if (wordCount === 0) continue;
      const ranges = plan.lines
        .filter((line) => line.flowId === flowId && line.blockId === block.id)
        .map((line) => ({ start: line.startWord, end: line.endWord }))
        .sort((left, right) => left.start - right.start || left.end - right.end);
      if (repeatedFlows.has(flowId)) {
        const pages = [...new Set(plan.lines
          .filter((line) => line.flowId === flowId && line.blockId === block.id)
          .map((line) => line.page))];
        for (const page of pages) {
          const pageRanges = plan.lines
            .filter((line) => line.flowId === flowId && line.blockId === block.id && line.page === page)
            .map((line) => ({ start: line.startWord, end: line.endWord }))
            .sort((left, right) => left.start - right.start || left.end - right.end);
          let pageExpected = 0;
          for (const range of pageRanges) {
            if (range.start !== pageExpected) {
              diagnostics.push(error('CONTENT_COVERAGE_GAP', `Repeated block '${block.id}' in flow '${flowId}' is not covered continuously on page ${page}.`, { flowId, blockId: block.id, page, expected: pageExpected, actual: range }));
              break;
            }
            pageExpected = range.end;
          }
          if (pageExpected !== wordCount) diagnostics.push(error('CONTENT_COVERAGE_GAP', `Repeated block '${block.id}' in flow '${flowId}' is incomplete on page ${page}.`, { flowId, blockId: block.id, page, expected: wordCount, actual: pageExpected }));
        }
        continue;
      }
      let expected = 0;
      for (const range of ranges) {
        if (range.start !== expected) {
          diagnostics.push(error('CONTENT_COVERAGE_GAP', `Block '${block.id}' in flow '${flowId}' is not covered continuously.`, { flowId, blockId: block.id, expected, actual: range }));
          break;
        }
        if (range.end <= range.start || range.end > wordCount) {
          diagnostics.push(error('CONTENT_RANGE_INVALID', `Block '${block.id}' in flow '${flowId}' has an invalid planned word range.`, { flowId, blockId: block.id, range, wordCount }));
          break;
        }
        expected = range.end;
      }
      if (expected !== wordCount) {
        diagnostics.push(error('CONTENT_NOT_FULLY_PLACED', `Block '${block.id}' in flow '${flowId}' has ${wordCount - expected} unplaced word(s).`, { flowId, blockId: block.id, placedUntil: expected, wordCount }));
      }
    }
  }
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  return {
    status: hasErrors ? 'rejected' : diagnostics.length > 0 ? 'accepted-with-warnings' : 'accepted',
    diagnostics,
    residualContent: plan.residualContent,
  };
}
