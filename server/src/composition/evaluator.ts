import { readRenderConfig } from '../builtin-template-source.js';
import type { CompositionBlock, CompositionDocument } from './model.js';
import type {
  CompositionDiagnostic,
  CompositionEvaluation,
  CompositionLine,
  CompositionPlan,
  CompositionSlot,
  CompositionScoreComponent,
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

function allLines(plan: CompositionPlan): CompositionPlan['lines'] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function scoreConfigNumber(key: string): number {
  const value = readRenderConfig().compositionScore[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite composition_score.${key}.`);
  return value;
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
  nextLineHeight = line.box.height,
): number {
  const lineHeight = nextLineHeight;
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

function plannerFoundNoUsableLine(
  plan: CompositionPlan,
  blockId: string,
  slotId: string,
  minimum: number,
): boolean {
  const capacityDecision = plan.decisions.find((decision) => decision.code === 'BLOCK_PUSHED_TO_NEXT_SLOT'
    && decision.blockId === blockId
    && decision.slotId === slotId);
  const capacityDetails = capacityDecision?.details as { availableLines?: unknown; attemptedLines?: unknown } | undefined;
  const availableLines = capacityDetails?.availableLines;
  if (typeof availableLines === 'number' && availableLines < minimum) return true;
  if (typeof capacityDetails?.attemptedLines === 'number' && capacityDetails.attemptedLines < minimum) return true;
  if (plan.decisions.some((decision) => decision.code === 'LIST_ITEM_PUSHED_TO_NEXT_SLOT'
    && decision.blockId === blockId
    && decision.slotId === slotId
    && decision.reason === 'keep-list-item-together-below-minimum-fragment')) return true;
  if (plan.decisions.some((decision) => decision.code === 'KEEP_CLUSTER_PUSHED'
    && decision.blockId === blockId
    && (decision.slotId === slotId || decision.from === slotId)
    && decision.reason === 'insufficient-local-capacity')) return true;
  return plan.decisions.some((decision) => {
    if (decision.code !== 'FLOW_SEGMENT_ADVANCED' || decision.slotId !== slotId) return false;
    const details = decision.details as { nextBlockId?: unknown; nextBlockAvailableLines?: unknown } | undefined;
    return details?.nextBlockId === blockId
      && typeof details.nextBlockAvailableLines === 'number'
      && details.nextBlockAvailableLines < minimum;
  });
}

function checkEmptyFlowPlacements(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  const fallbackContent = new Set<string>();
  for (const line of allLines(plan)) fallbackContent.add(`${line.flowId}:${line.slotId}`);
  for (const placement of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    const flowId = 'flowId' in placement ? placement.flowId : blockFlowIds.get(placement.blockId);
    if (flowId) fallbackContent.add(`${flowId}:${placement.slotId}`);
  }
  if (plan.flowPlacements) {
    for (const placement of plan.flowPlacements) {
      const slot = slotFor(plan, placement.slotId);
      if (!slot) {
        diagnostics.push(error(
          'FLOW_PLACEMENT_TARGET_MISSING',
          `Flow placement '${placement.id}' targets missing slot '${placement.slotId}'.`,
          { flowId: placement.flowId, page: placement.page, slotId: placement.slotId },
        ));
      } else if (placement.page !== slot.page || !fitsInside(placement.box, slot.box)) {
        diagnostics.push(error(
          'FLOW_PLACEMENT_OUTSIDE_SLOT',
          `Flow placement '${placement.id}' leaves slot '${slot.id}'.`,
          { flowId: placement.flowId, page: placement.page, slotId: placement.slotId },
        ));
      }
      const lines = allLines(plan).filter((line) => line.flowId === placement.flowId && line.slotId === placement.slotId);
      const actualBlockIds = new Set(lines.map((line) => line.blockId));
      for (const item of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
        const flowId = 'flowId' in item ? item.flowId : blockFlowIds.get(item.blockId);
        if (flowId === placement.flowId && item.slotId === placement.slotId) actualBlockIds.add(item.blockId);
      }
      const expectedBlockIds = [...actualBlockIds].sort();
      const declaredBlockIds = [...new Set(placement.blockIds)].sort();
      if (placement.hasContent !== (expectedBlockIds.length > 0)
        || placement.lineCount !== lines.length
        || JSON.stringify(declaredBlockIds) !== JSON.stringify(expectedBlockIds)) {
        diagnostics.push(error(
          'FLOW_PLACEMENT_CONTENT_MISMATCH',
          `Flow placement '${placement.id}' does not match the content actually assigned to its slot.`,
          {
            flowId: placement.flowId,
            page: placement.page,
            slotId: placement.slotId,
            details: {
              declared: { hasContent: placement.hasContent, lineCount: placement.lineCount, blockIds: declaredBlockIds },
              actual: { hasContent: expectedBlockIds.length > 0, lineCount: lines.length, blockIds: expectedBlockIds },
            },
          },
        ));
      }
    }
  }
  const registry = plan.flowPlacements ?? plan.slots
    .filter((slot): slot is CompositionSlot & { flowId: string; routeIndex: number } => slot.flowId !== undefined && slot.routeIndex !== undefined && slot.kind === 'text')
    .map((slot) => ({
      flowId: slot.flowId,
      page: slot.page,
      slotId: slot.id,
      routeIndex: slot.routeIndex,
      state: slot.state,
      hasContent: fallbackContent.has(`${slot.flowId}:${slot.id}`),
      blockedBy: plan.graphicPlacements.filter((graphic) => graphic.page === slot.page && graphic.wrap === 'around' && fitsInside(slot.box, graphic.box)).map((graphic) => graphic.graphicId),
    }));
  for (const flowId of new Set(registry.map((placement) => placement.flowId))) {
    const placements = registry.filter((placement) => placement.flowId === flowId).sort((left, right) => left.page - right.page || left.routeIndex - right.routeIndex);
    const occupied = placements.filter((placement) => placement.hasContent);
    if (occupied.length < 2) continue;
    const firstOccupied = placements.indexOf(occupied[0]);
    const lastOccupied = placements.lastIndexOf(occupied.at(-1)!);
    for (const empty of placements.slice(firstOccupied, lastOccupied + 1).filter((placement) => !placement.hasContent && placement.state !== 'exhausted' && placement.blockedBy.length === 0)) {
      const beforeEmpty = placements.slice(0, placements.indexOf(empty));
      const preceding = [...beforeEmpty].reverse().find((placement) => placement.hasContent);
      const following = placements.slice(placements.indexOf(empty) + 1).find((placement) => placement.hasContent);
      if (!preceding || !following) continue;
      diagnostics.push(error(
        'EMPTY_FLOW_PLACEMENT',
        `Flow '${flowId}' leaves placement '${empty.slotId}' empty between occupied placements.`,
        {
          flowId,
          page: empty.page,
          slotId: empty.slotId,
          details: {
            precedingSlotId: preceding.slotId,
            precedingPage: preceding.page,
            followingSlotId: following.slotId,
            followingPage: following.page,
            routeIndex: empty.routeIndex,
          },
        },
      ));
    }
  }
}

function checkFlowBarrierBoxCandidates(plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  for (const candidate of plan.flowBarrierBoxCandidates ?? []) {
    if (candidate.box.width <= 0 || candidate.box.height <= 0) {
      diagnostics.push(error(
        'FLOW_BARRIER_CANDIDATE_INVALID',
        `Flow barrier candidate '${candidate.id}' has no usable geometry.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId },
      ));
      continue;
    }
    const placement = plan.flowPlacements?.find((item) => item.id === candidate.placementId && item.page === candidate.page);
    if (!placement) {
      diagnostics.push(error(
        'FLOW_BARRIER_CANDIDATE_PLACEMENT_MISSING',
        `Flow barrier candidate '${candidate.id}' references missing placement '${candidate.placementId}'.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId },
      ));
    } else if (!fitsInside(candidate.box, placement.box)) {
      diagnostics.push(error(
        'FLOW_BARRIER_CANDIDATE_OUTSIDE_PLACEMENT',
        `Flow barrier candidate '${candidate.id}' leaves flow placement '${placement.id}'.`,
        { flowId: candidate.flowId, page: candidate.page, slotId: placement.slotId },
      ));
    }
    for (const sourceId of [candidate.previousSourceId, candidate.nextSourceId].filter((value): value is string => value !== undefined)) {
      const source = plan.graphicPlacements.find((graphic) => graphic.page === candidate.page && (graphic.graphicId === sourceId || graphic.id === sourceId));
      if (!source) {
        diagnostics.push(error(
          'FLOW_BARRIER_CANDIDATE_SOURCE_MISSING',
          `Flow barrier candidate '${candidate.id}' references missing obstacle '${sourceId}'.`,
          { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId, details: { sourceId } },
        ));
      } else if (source.wrap !== 'around') {
        diagnostics.push(error(
          'FLOW_BARRIER_CANDIDATE_SOURCE_NOT_WRAPPING',
          `Flow barrier candidate '${candidate.id}' references non-wrapping obstacle '${sourceId}'.`,
          { flowId: candidate.flowId, page: candidate.page, slotId: candidate.placementId, details: { sourceId } },
        ));
      }
    }
  }
}

function scoreColumnBalance(plan: CompositionPlan): CompositionScoreComponent {
  const columnCount = Math.max(1, Math.floor(scoreConfigNumber('columnCount')));
  const lineCounts = new Map<string, number>();
  for (const line of allLines(plan)) {
    if (line.routeIndex === undefined) continue;
    const key = `${line.flowId}:${line.page}:${line.routeIndex}`;
    lineCounts.set(key, (lineCounts.get(key) ?? 0) + 1);
  }
  const routesByFlowPage = new Map<string, Set<number>>();
  for (const placement of plan.flowPlacements ?? []) {
    if (placement.routeIndex >= columnCount) continue;
    const key = `${placement.flowId}:${placement.page}`;
    const routes = routesByFlowPage.get(key) ?? new Set<number>();
    routes.add(placement.routeIndex);
    routesByFlowPage.set(key, routes);
  }
  const pageBalances = [...routesByFlowPage.entries()].flatMap(([key, routes]) => {
    if (routes.size < 2) return [];
    const counts = [...routes].sort((left, right) => left - right).map((routeIndex) => lineCounts.get(`${key}:${routeIndex}`) ?? 0);
    const maximum = Math.max(...counts);
    return maximum > 0 ? [{ page: key, balance: Math.min(...counts) / maximum, counts }] : [];
  });
  const value = pageBalances.length > 0
    ? pageBalances.reduce((sum, page) => sum + page.balance, 0) / pageBalances.length
    : 0;
  return {
    code: 'column-balance',
    value,
    points: value * scoreConfigNumber('columnBalanceWeight'),
    details: { pages: pageBalances },
  };
}

function scoreHeadingFollowingLine(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const headingIds = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks.filter((block: CompositionBlock) => block.kind === 'heading').map((block) => block.id)));
  const headings = allLines(plan).filter((line) => headingIds.has(line.blockId));
  const kept = new Set(headings
    .filter((heading) => allLines(plan).some((line) => line.blockId !== heading.blockId
      && line.flowId === heading.flowId
      && line.page === heading.page
      && line.slotId === heading.slotId
      && line.box.y >= heading.box.y + heading.box.height))
    .map((heading) => heading.blockId));
  return {
    code: 'heading-following-line',
    value: kept.size,
    points: kept.size * scoreConfigNumber('headingFollowingLineBonus'),
    details: { headingCount: new Set(headings.map((heading) => heading.blockId)).size, keptHeadingIds: [...kept].sort() },
  };
}

function scoreParagraphFragmentation(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const paragraphIds = new Set(Object.values(document.flows).flatMap((flow) => flow.blocks
    .filter((block: CompositionBlock) => block.kind === 'paragraph')
    .map((block) => block.id)));
  const locations = new Map<string, Set<string>>();
  for (const line of plan.lines) {
    if (!paragraphIds.has(line.blockId)) continue;
    const blockLocations = locations.get(line.blockId) ?? new Set<string>();
    blockLocations.add(`${line.page}:${line.slotId}`);
    locations.set(line.blockId, blockLocations);
  }
  const fragmentedIds = [...locations.entries()]
    .filter(([, blockLocations]) => blockLocations.size > 1)
    .map(([blockId]) => blockId)
    .sort();
  return {
    code: 'paragraph-fragmentation',
    value: fragmentedIds.length,
    points: -fragmentedIds.length * scoreConfigNumber('paragraphFragmentationPenalty'),
    details: { fragmentedBlockIds: fragmentedIds },
  };
}

function horizontalOverlap(first: { x: number; width: number }, second: { x: number; width: number }): boolean {
  return Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x);
}

function scoreInsertionSpacing(plan: CompositionPlan): CompositionScoreComponent {
  const insertions = new Map<string, CompositionLine[]>();
  for (const line of plan.insertionLines ?? []) {
    const key = `${line.blockId}:${line.page}:${line.slotId}`;
    insertions.set(key, [...(insertions.get(key) ?? []), line]);
  }
  const ordinaryLines = plan.lines.filter((line) => line.layer !== 'insertion');
  const details = [...insertions.values()].flatMap((lines) => {
    const firstLine = lines[0];
    const obstacle = plan.graphicPlacements.find((graphic) => graphic.graphicId === `insertion:${firstLine.blockId}` && graphic.page === firstLine.page);
    if (!obstacle) return [];
    const contentTop = Math.min(...lines.map((line) => line.box.y));
    const contentBottom = Math.max(...lines.map((line) => line.box.y + line.box.height));
    const internalTop = contentTop - obstacle.box.y;
    const internalBottom = obstacle.box.y + obstacle.box.height - contentBottom;
    const overlappingSlots = plan.slots.filter((slot) => slot.page === obstacle.page
      && slot.id !== obstacle.slotId
      && slot.kind === 'text'
      && horizontalOverlap(slot.box, obstacle.box));
    const streamGaps = overlappingSlots.flatMap((slot) => {
      const linesInSlot = ordinaryLines.filter((line) => line.page === obstacle.page && line.slotId === slot.id);
      const previous = linesInSlot
        .filter((line) => line.box.y + line.box.height <= obstacle.box.y)
        .sort((left, right) => (right.box.y + right.box.height) - (left.box.y + left.box.height))[0];
      const next = linesInSlot
        .filter((line) => line.box.y >= obstacle.box.y + obstacle.box.height)
        .sort((left, right) => left.box.y - right.box.y)[0];
      if (!previous || !next) return [];
      const before = obstacle.box.y - (previous.box.y + previous.box.height);
      const after = next.box.y - (obstacle.box.y + obstacle.box.height);
      return [{ slotId: slot.id, before, after, imbalance: Math.abs(before - after) }];
    });
    const externalImbalance = streamGaps.length > 0
      ? streamGaps.reduce((sum, gap) => sum + gap.imbalance, 0) / streamGaps.length
      : 0;
    const beforeGaps = streamGaps.map((gap) => gap.before);
    const afterGaps = streamGaps.map((gap) => gap.after);
    const spread = (values: number[]) => values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
    const crossStreamSpread = (spread(beforeGaps) + spread(afterGaps)) / 2;
    return [{
      blockId: firstLine.blockId,
      page: obstacle.page,
      obstacle: { ...obstacle.box },
      content: { top: contentTop, bottom: contentBottom },
      internal: { top: internalTop, bottom: internalBottom, imbalance: Math.abs(internalTop - internalBottom) },
      streams: streamGaps,
      externalImbalance,
      crossStreamSpread,
    }];
  });
  const internalImbalance = details.reduce((sum, insertion) => sum + insertion.internal.imbalance, 0);
  const externalImbalance = details.reduce((sum, insertion) => sum + insertion.externalImbalance, 0);
  const crossStreamSpread = details.reduce((sum, insertion) => sum + insertion.crossStreamSpread, 0);
  const points = -internalImbalance * scoreConfigNumber('insertionInternalSpacingPenalty')
    - externalImbalance * scoreConfigNumber('insertionExternalSpacingPenalty')
    - crossStreamSpread * scoreConfigNumber('insertionCrossStreamSpacingPenalty');
  return {
    code: 'insertion-spacing',
    value: internalImbalance + externalImbalance + crossStreamSpread,
    points,
    details: { insertions: details },
  };
}

function scoreLegalPlan(document: CompositionDocument, plan: CompositionPlan): { score: number; breakdown: CompositionScoreComponent[] } {
  const breakdown = [scoreColumnBalance(plan), scoreHeadingFollowingLine(document, plan), scoreParagraphFragmentation(document, plan), scoreInsertionSpacing(plan)];
  return {
    score: scoreConfigNumber('base') + breakdown.reduce((sum, component) => sum + component.points, 0),
    breakdown,
  };
}

function checkEarlyRouteTransitions(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const minimum = plan.minimumFragmentLines;
  if (minimum === undefined || !Number.isInteger(minimum) || minimum <= 0) return;
  const byFlowAndPage = new Map<string, CompositionPlan['lines']>();
  const sourceBlocks = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks).map((block) => [block.id, block]));
  for (const line of allLines(plan)) {
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
      const nextLineHeight = nextLines.find((line) => line.box.height > 0)?.box.height ?? previous.box.height;
      const usable = usableLinesAfter(previous, slot, plan.graphicPlacements, nextLineHeight);
      if (plannerFoundNoUsableLine(plan, nextLines[0].blockId, previous.slotId, minimum)) continue;
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

function blockMatchesSlot(block: CompositionDocument['flows'][string]['blocks'][number], slot: CompositionSlot): boolean {
  if (slot.allowedRoles && !slot.allowedRoles.includes(block.role)) return false;
  if (slot.allowedBlockKinds && !slot.allowedBlockKinds.includes(block.kind)) return false;
  if (slot.allowedBlockIds && !slot.allowedBlockIds.some((id) => block.id === id || block.id.startsWith(`${id}:`))) return false;
  if (slot.kind === 'block' && !block.atomic && block.kind !== 'table') return false;
  if (block.kind === 'table' && slot.kind !== 'block') return false;
  if ((block.kind === 'metric' || block.kind === 'chart') && slot.kind !== 'block') return false;
  if (slot.kind === 'graphic') return false;
  return true;
}

function checkEmptyAndUnderfilledSlots(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const minimum = plan.minimumFragmentLines ?? 1;
  if (!Number.isInteger(minimum) || minimum <= 0) return;
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  const items = [
    ...allLines(plan).map((line) => ({ ...line, flowId: line.flowId })),
    ...plan.blockPlacements.map((placement) => ({ ...placement, flowId: blockFlowIds.get(placement.blockId) })),
    ...plan.tablePlacements.map((placement) => ({ ...placement, flowId: blockFlowIds.get(placement.blockId) })),
  ];
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (plan.repeatFlowIds?.includes(flowId)) continue;
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    const flowItems = items.filter((item) => item.flowId === flowId);
    for (const page of plan.pages) {
      const pageSlots = plan.slots.filter((slot) => slot.page === page.page && slot.flowId === flowId && slot.routeIndex !== undefined && slot.kind === 'text');
      for (const slot of pageSlots) {
        if (slot.allowedRoles?.includes('quote')) continue;
        const slotItems = flowItems.filter((item) => item.slotId === slot.id);
        const laterItems = flowItems.filter((item) => item.page > page.page || (item.page === page.page && (item.routeIndex ?? Number.NEGATIVE_INFINITY) > slot.routeIndex!));
        if (laterItems.length === 0) continue;
        const hasEligibleLaterBlock = laterItems.some((item) => {
          const block = flow.blocks.find((candidate) => candidate.id === item.blockId);
          return block !== undefined && blockMatchesSlot(block, slot);
        });
        if (!hasEligibleLaterBlock) continue;
        const firstLaterIndex = laterItems
          .map((item) => blockIndexes.get(item.blockId))
          .filter((index): index is number => index !== undefined)
          .sort((left, right) => left - right)[0];
        const hasEarlierFlowMaterial = firstLaterIndex !== undefined && flowItems.some((item) => {
          const index = blockIndexes.get(item.blockId);
          return index !== undefined && index < firstLaterIndex;
        });
        if (!hasEarlierFlowMaterial) continue;
        const lastAuthoredIndex = (slotItems.length > 0
          ? slotItems
            .map((item) => blockIndexes.get(item.blockId))
            .filter((index): index is number => index !== undefined)
            .sort((left, right) => right - left)[0]
          : flowItems
            .filter((item) => item.page < slot.page || (item.page === slot.page && (item.routeIndex ?? Number.NEGATIVE_INFINITY) < slot.routeIndex!))
            .map((item) => blockIndexes.get(item.blockId))
            .filter((index): index is number => index !== undefined)
            .sort((left, right) => right - left)[0]) ?? -1;
        const nextAuthoredBlock = flow.blocks.find((_, index) => index > lastAuthoredIndex);
        if (!nextAuthoredBlock || !blockMatchesSlot(nextAuthoredBlock, slot) || nextAuthoredBlock.role === 'quote') continue;
        const fullyCoveredByObstacle = plan.graphicPlacements.some((graphic) => graphic.page === slot.page
          && graphic.wrap === 'around'
          && fitsInside(slot.box, graphic.box));
        if (fullyCoveredByObstacle) continue;
        if (slotItems.length === 0) {
          const nextLine = laterItems.find((item) => 'box' in item && item.box.height > 0);
          const lineHeight = nextLine?.box.height ?? slot.box.height;
          const availableLines = Math.floor(slot.box.height / lineHeight);
          if (availableLines < minimum) continue;
          diagnostics.push(error(
            'EMPTY_FLOW_SLOT',
            `Flow '${flowId}' skips empty slot '${slot.id}' while later content is placed (next authored block: ${nextAuthoredBlock?.id ?? 'unknown'}).`,
            {
              flowId,
              page: page.page,
              slotId: slot.id,
              details: {
                routeIndex: slot.routeIndex,
                availableLines,
                minimumFragmentLines: minimum,
                nextSlotId: laterItems[0].slotId,
                nextPage: laterItems[0].page,
              },
            },
          ));
          continue;
        }
        const last = [...slotItems].sort((left, right) => left.box.y - right.box.y).at(-1)!;
        if (!('flowId' in last) || !('box' in last) || !('startWord' in last)) continue;
        const nextLineHeight = laterItems.find((item) => 'box' in item && item.box.height > 0)?.box.height
          ?? (last as CompositionPlan['lines'][number]).box.height;
        const usable = usableLinesAfter(last as CompositionPlan['lines'][number], slot, plan.graphicPlacements, nextLineHeight);
        if (plannerFoundNoUsableLine(plan, nextAuthoredBlock.id, slot.id, minimum)) continue;
        if (usable < minimum) continue;
        diagnostics.push(error(
          'FLOW_SLOT_UNDERFILLED',
          `Flow '${flowId}' leaves ${usable} usable line(s) in '${slot.id}' before later content.`,
          {
            flowId,
            page: page.page,
            slotId: slot.id,
            details: {
              routeIndex: slot.routeIndex,
              usableLines: usable,
              minimumFragmentLines: minimum,
              nextSlotId: laterItems[0].slotId,
              nextPage: laterItems[0].page,
            },
          },
        ));
      }
    }
  }
}

function checkInsertionSourceOrder(document: CompositionDocument, plan: CompositionPlan, diagnostics: CompositionDiagnostic[]): void {
  const placedItems = [
    ...allLines(plan),
    ...plan.blockPlacements,
    ...plan.tablePlacements,
  ];
  const blockFlowIds = new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block) => [block.id, flowId] as const)));
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    for (const [quoteIndex, quote] of flow.blocks.entries()) {
      if (quote.role !== 'quote') continue;
      const quoteLines = allLines(plan).filter((line) => line.flowId === flowId && line.blockId === quote.id);
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
      const successorBeforeQuote = successors.find((item) => {
        if (item.page < quotePage) return true;
        if (item.page !== quotePage || item.box.y >= quoteBox.y) return false;
        // A full-width insertion is an overlay on the continuous route. A
        // successor that has already entered a later physical column may
        // legitimately occupy that column's upper area; that area is later
        // in column reading order even though its y-coordinate is above the
        // overlay. Only content in the first column is before the insertion.
        const itemSlot = slotFor(plan, item.slotId);
        const laterColumn = itemSlot?.routeIndex !== undefined
          && item.box.x >= quoteBox.x + quoteBox.width / 2;
        return !laterColumn;
      });
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
  checkEmptyFlowPlacements(document, plan, diagnostics);
  checkFlowBarrierBoxCandidates(plan, diagnostics);
  checkEmptyAndUnderfilledSlots(document, plan, diagnostics);
  checkEarlyRouteTransitions(document, plan, diagnostics);
  checkInsertionSourceOrder(document, plan, diagnostics);
  const repeatedFlows = new Set(plan.repeatFlowIds ?? []);
  for (const message of document.diagnostics ?? []) {
    diagnostics.push({ severity: 'warning', code: 'DOCUMENT_DIAGNOSTIC', message });
  }
  const seenLines = new Set<string>();
  for (const line of allLines(plan)) {
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
  const planned = allLines(plan);
  for (let index = 0; index < planned.length; index += 1) {
    const line = planned[index];
    for (let other = index + 1; other < planned.length; other += 1) {
      const candidate = planned[other];
      if (line.page === candidate.page && line.slotId === candidate.slotId && overlaps(line.box, candidate.box)) {
        diagnostics.push(error('LINE_OVERLAP', `Lines for '${line.blockId}' and '${candidate.blockId}' overlap in slot '${line.slotId}'.`, { slotId: line.slotId, page: line.page, firstBlockId: line.blockId, secondBlockId: candidate.blockId }));
      }
    }
  }
  for (const line of allLines(plan)) {
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
      ...allLines(plan).filter((line) => line.blockId === blockId),
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
      for (const line of allLines(plan).filter((candidate) => candidate.blockId === block.id && candidate.routeIndex !== undefined)) {
        const indexes = insertionRouteIndexes.get(line.page) ?? new Set<number>();
        indexes.add(line.routeIndex!);
        insertionRouteIndexes.set(line.page, indexes);
      }
    }
    const flowingBlockIds = new Set(flow.blocks.filter((block) => block.kind !== 'table').map((block) => block.id));
    for (const blockId of flowingBlockIds) {
      const fragments = allLines(plan)
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
      ...allLines(plan).filter((line) => blockIds.has(line.blockId)),
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
          severity: 'error',
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
    for (const line of allLines(plan)) {
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
    for (const line of allLines(plan)) {
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
      const ranges = allLines(plan)
        .filter((line) => line.flowId === flowId && line.blockId === block.id)
        .map((line) => ({ start: line.startWord, end: line.endWord }))
        .sort((left, right) => left.start - right.start || left.end - right.end);
      if (repeatedFlows.has(flowId)) {
        const pages = [...new Set(allLines(plan)
          .filter((line) => line.flowId === flowId && line.blockId === block.id)
          .map((line) => line.page))];
        for (const page of pages) {
          const pageRanges = allLines(plan)
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
  const hardViolations = diagnostics.filter((item) => item.severity === 'error');
  const scored = hasErrors ? { score: Number.NEGATIVE_INFINITY, breakdown: [] } : scoreLegalPlan(document, plan);
  return {
    status: hasErrors ? 'rejected' : diagnostics.length > 0 ? 'accepted-with-warnings' : 'accepted',
    diagnostics,
    hardViolations,
    score: scored.score,
    scoreBreakdown: scored.breakdown,
    residualContent: plan.residualContent,
  };
}
