import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionLayout,
} from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionTextMetrics,
} from '../contracts/engine-contracts.js';
import { readRenderConfig } from '../../template/builtins.js';
import { routeLayout } from './page-state.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { insertionContentHeight, insertionContentIsComplete, measureInsertionContent } from './insertion-measurement.js';
import { isAtomicBlock } from './page-state.js';
import { rectsOverlap } from '../geometry/rectangles.js';
import { regionForSlot, relaxInsertionPlacementGravity, visualLoadWeightForPlacement } from './placement-gravity.js';
import { resolvePlacementPolicy } from './placement-policy.js';

type InsertionSlotCandidate = {
  page: number;
  slotId: string;
  box: CompositionRect;
};


function insertionProposalCanFollow(previous: PlannedInsertion | undefined, candidate: PlannedInsertion): boolean {
  if (!previous) return true;
  if (candidate.page < previous.page) return false;
  if (candidate.page !== previous.page) return true;
  return !rectsOverlap(previous.box, candidate.box);
}

function horizontalIntervalsOverlap(left: CompositionRect, right: CompositionRect): boolean {
  return left.x < right.x + right.width - Number.EPSILON
    && right.x < left.x + left.width - Number.EPSILON;
}

function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

/**
 * An insertion slot is an explicit content seam.  Its role/kind/id filters
 * decide which non-main blocks may enter it; the route itself decides that
 * the block is painted as an obstacle rather than as an ordinary flow.
 */
export function insertionSlotAcceptsBlock(
  definition: CompositionLayout['pageTemplates'][number]['slots'][number],
  flowId: string,
  block: CompositionBlock,
): boolean {
  if (definition.kind === 'graphic' || definition.reserved) return false;
  if (definition.flowId !== undefined && definition.flowId !== flowId) return false;
  if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) return false;
  if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) return false;
  if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) return false;
  if (definition.kind === 'block') return isAtomicBlock(block) || block.kind === 'table';
  return true;
}

function insertionSlotDefinitions(
  template: CompositionLayout,
  route: CompositionFlowRoute,
): CompositionLayout['pageTemplates'][number]['slots'] {
  const definitions = new Map<string, CompositionLayout['pageTemplates'][number]['slots'][number]>();
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    for (const slotId of route.insertionSlots ?? []) {
      const slot = layout?.slots.find((candidate) => candidate.id === slotId);
      if (slot) definitions.set(slot.id, slot);
    }
  }
  return [...definitions.values()];
}

/** Return blocks explicitly claimed by insertion slots in a named flow. */
export function insertionBlocksForFlow(
  template: CompositionLayout,
  flowId: string,
  blocks: CompositionBlock[],
): CompositionBlock[] {
  if (flowId === 'main') return [];
  const route = template.routes[flowId];
  if (!route?.insertionSlots?.length) return [];
  const definitions = insertionSlotDefinitions(template, route);
  return blocks.filter((block) => definitions.some((definition) => insertionSlotAcceptsBlock(definition, flowId, block)));
}

function insertionSlotCandidates(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  block?: CompositionBlock,
): InsertionSlotCandidate[] {
  if (!route.insertionSlots?.length) return [];
  const candidates: InsertionSlotCandidate[] = [];
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    if (!layout) continue;
    for (const slotId of route.insertionSlots) {
      const slot = layout.slots.find((candidate) => candidate.id === slotId && (block === undefined || insertionSlotAcceptsBlock(candidate, flowId, block)));
      if (slot) candidates.push({ page, slotId, box: { ...slot.box } });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x || left.slotId.localeCompare(right.slotId));
}

function insertionProposalSignature(proposals: Map<string, PlannedInsertion>): string {
  return [...proposals.entries()]
    .map(([key, proposal]) => `${key}@${proposal.page}:${proposal.slotId}:${proposal.box.x},${proposal.box.y},${proposal.box.width},${proposal.box.height}`)
    .join('|');
}

function candidateSupportsBlock(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  candidate: InsertionSlotCandidate,
  block: CompositionBlock,
): boolean {
  const layout = routeLayout(route, template, candidate.page);
  const definition = layout?.slots.find((slot) => slot.id === candidate.slotId);
  return definition !== undefined && insertionSlotAcceptsBlock(definition, flowId, block);
}

function candidatePolicy(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  candidate: InsertionSlotCandidate,
  block: CompositionBlock,
): ReturnType<typeof resolvePlacementPolicy> {
  const layout = routeLayout(route, template, candidate.page);
  const definition = layout?.slots.find((slot) => slot.id === candidate.slotId);
  return definition
    ? resolvePlacementPolicy(template, flowId, block, definition)
    : { distribution: 'free', distributionSource: 'planner-default' };
}

function candidateRankForDistribution(
  distribution: ReturnType<typeof resolvePlacementPolicy>['distribution'],
  blockIndex: number,
  blockCount: number,
  candidateCount: number,
): number {
  if (candidateCount <= 1 || distribution === 'free' || distribution === 'clustered') return 0;
  const progress = (blockIndex + 0.5) / Math.max(1, blockCount);
  return Math.max(0, Math.min(candidateCount - 1, progress * candidateCount - 0.5));
}

function candidateDistanceFromRank(index: number, rank: number): number {
  return Math.abs(index - rank);
}

function orderedCandidateIndexes(
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  block: CompositionBlock,
  blockIndex: number,
  blockCount: number,
  candidates: InsertionSlotCandidate[],
  previousCandidateIndex: number,
): number[] {
  const supported = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidateSupportsBlock(template, route, flowId, candidate, block));
  const policy = supported[0]
    ? candidatePolicy(template, route, flowId, supported[0].candidate, block)
    : { distribution: 'free' as const };
  const rank = candidateRankForDistribution(policy.distribution, blockIndex, blockCount, candidates.length);
  return supported
    .filter(({ index }) => index > previousCandidateIndex)
    .sort((left, right) => {
      const leftDistance = candidateDistanceFromRank(left.index, rank);
      const rightDistance = candidateDistanceFromRank(right.index, rank);
      return leftDistance - rightDistance || left.index - right.index;
    })
    .map(({ index }) => index);
}

function materializedBlockPages(plan: CompositionPlan, flowId: string, blockId: string): number[] {
  const pages = new Set<number>();
  for (const line of plan.lines) {
    if (line.flowId === flowId && line.blockId === blockId) pages.add(line.page);
  }
  for (const line of plan.insertionLines ?? []) {
    if (line.flowId === flowId && line.blockId === blockId) pages.add(line.page);
  }
  for (const placement of plan.blockPlacements) {
    const slot = plan.slots.find((candidate) => candidate.page === placement.page
      && (candidate.id === placement.slotId || placement.slotId.startsWith(`${candidate.id}:`)));
    if (placement.blockId === blockId && slot?.flowId === flowId) pages.add(placement.page);
  }
  for (const placement of plan.tablePlacements) {
    const slot = plan.slots.find((candidate) => candidate.page === placement.page
      && (candidate.id === placement.slotId || placement.slotId.startsWith(`${candidate.id}:`)));
    if (placement.blockId === blockId && slot?.flowId === flowId) pages.add(placement.page);
  }
  return [...pages].sort((left, right) => left - right);
}

function candidateRespectsSourceRelation(
  plan: CompositionPlan,
  policy: ReturnType<typeof resolvePlacementPolicy>,
  candidate: InsertionSlotCandidate,
): boolean {
  if (!policy.source || policy.source.strength !== 'require-same-page') return true;
  const sourcePages = materializedBlockPages(plan, policy.source.flowId, policy.source.blockId);
  return sourcePages.length === 0 || sourcePages.includes(candidate.page);
}

type MainProgress = { start: number; end: number; center: number };

type GroupAssignmentOption = {
  candidate: InsertionSlotCandidate;
  proposal: PlannedInsertion;
  policy: ReturnType<typeof resolvePlacementPolicy>;
  progress: number;
  candidateOrder: number;
  slotKey: string;
  weight: number;
  sourcePages: number[];
};

type GroupAssignmentItem = {
  key: string;
  flowId: string;
  block: CompositionBlock;
  blockIndex: number;
  blockCount: number;
  groupKey: string;
  distribution: Exclude<ReturnType<typeof resolvePlacementPolicy>['distribution'], 'free' | 'clustered'>;
  current?: PlannedInsertion;
  options: GroupAssignmentOption[];
  order: number;
};

type GroupAssignmentState = {
  cost: number;
  lastPage: number;
  selected: Map<string, GroupAssignmentOption>;
  usedSlots: Set<string>;
  lastCandidateByFlow: Map<string, number>;
};

function mainProgressByPage(plan: CompositionPlan): Map<number, MainProgress> {
  const lines = plan.lines.filter((line) => line.flowId === 'main' && line.layer !== 'insertion');
  const totalWords = Math.max(1, ...lines.map((line) => line.endWord));
  const progress = new Map<number, MainProgress>();
  for (const page of new Set(lines.map((line) => line.page))) {
    const pageLines = lines.filter((line) => line.page === page);
    const start = Math.min(...pageLines.map((line) => line.startWord)) / totalWords;
    const end = Math.max(...pageLines.map((line) => line.endWord)) / totalWords;
    progress.set(page, { start, end, center: (start + end) / 2 });
  }
  return progress;
}

function progressForInsertionPage(progress: Map<number, MainProgress>, page: number): number {
  const measured = progress.get(page);
  if (measured) return measured.center;
  const before = [...progress.entries()]
    .filter(([candidate]) => candidate < page)
    .sort((left, right) => right[0] - left[0])[0];
  if (before) return before[1].end;
  const after = [...progress.entries()]
    .filter(([candidate]) => candidate > page)
    .sort((left, right) => left[0] - right[0])[0];
  return after?.[1].start ?? 0;
}

function groupKeyForPolicy(
  candidate: InsertionSlotCandidate,
  template: CompositionLayout,
  route: CompositionFlowRoute,
  flowId: string,
  block: CompositionBlock,
): string | undefined {
  const layout = routeLayout(route, template, candidate.page);
  const definition = layout?.slots.find((slot) => slot.id === candidate.slotId);
  const policy = definition ? resolvePlacementPolicy(template, flowId, block, definition) : undefined;
  if (!definition || !policy?.rhythmGroup) return undefined;
  return `${definition.regionId}:${policy.rhythmGroup}`;
}

function sourceOrderForGroupItem(
  document: CompositionDocument,
  item: { flowId: string; block: CompositionBlock; blockIndex: number; blockCount: number; policy: ReturnType<typeof resolvePlacementPolicy>; current?: PlannedInsertion },
  progress: Map<number, MainProgress>,
): number {
  const source = item.policy.source;
  if (source) {
    const sourceBlocks = document.flows[source.flowId]?.blocks ?? [];
    const sourceIndex = sourceBlocks.findIndex((block) => block.id === source.blockId);
    if (sourceIndex >= 0) return (sourceIndex + 0.5) / Math.max(1, sourceBlocks.length);
  }
  if (item.current) return progressForInsertionPage(progress, item.current.page);
  return (item.blockIndex + 0.5) / Math.max(1, item.blockCount);
}

function sourcePagesForPolicy(plan: CompositionPlan, policy: ReturnType<typeof resolvePlacementPolicy>): number[] {
  if (!policy.source) return [];
  return materializedBlockPages(plan, policy.source.flowId, policy.source.blockId);
}

function candidateAssignmentCost(
  item: GroupAssignmentItem,
  option: GroupAssignmentOption,
  target: number,
  score: Record<string, number>,
): number {
  let cost = Math.abs(option.progress - target) * score.contentSpreadPenalty;
  if (option.policy.source?.strength === 'prefer-same-page'
    && option.sourcePages.length > 0
    && !option.sourcePages.includes(option.candidate.page)) {
    cost += score.sourceRelationPreferencePenalty;
  }
  if (item.current
    && item.current.page === option.candidate.page
    && item.current.slotId === option.candidate.slotId) {
    cost -= Number.EPSILON;
  }
  return cost;
}

function groupTargets(items: GroupAssignmentItem[]): Map<string, number> {
  const weightForItem = (item: GroupAssignmentItem): number => {
    const current = item.current === undefined
      ? undefined
      : item.options.find((option) => option.candidate.page === item.current!.page && option.candidate.slotId === item.current!.slotId);
    if (current) return Math.max(1, current.weight);
    const average = item.options.reduce((sum, option) => sum + option.weight, 0) / Math.max(1, item.options.length);
    return Math.max(1, average);
  };
  const totalWeight = items.reduce((sum, item) => sum + weightForItem(item), 0);
  let accumulated = 0;
  const targets = new Map<string, number>();
  for (const item of items) {
    const weight = weightForItem(item);
    targets.set(item.key, (accumulated + weight / 2) / Math.max(1, totalWeight));
    accumulated += weight;
  }
  return targets;
}

function buildGroupAssignmentItems(
  document: CompositionDocument,
  template: CompositionLayout,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
  current: Map<string, PlannedInsertion>,
): Map<string, GroupAssignmentItem[]> {
  const progress = mainProgressByPage(plan);
  const measuredProposals = new Map<string, PlannedInsertion>();
  const groups = new Map<string, GroupAssignmentItem[]>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const blocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    for (const [blockIndex, block] of blocks.entries()) {
      const key = insertionKey(flowId, block.id);
      const currentProposal = current.get(key);
      const candidates = insertionSlotCandidates(template, route, flowId, block);
      if (candidates.length === 0) continue;
      const currentCandidate = currentProposal
        ? candidates.find((candidate) => candidate.page === currentProposal.page && candidate.slotId === currentProposal.slotId)
        : undefined;
      const baseCandidate = currentCandidate ?? candidates[0]!;
      const baseLayout = routeLayout(route, template, baseCandidate.page);
      const baseDefinition = baseLayout?.slots.find((slot) => slot.id === baseCandidate.slotId);
      if (!baseDefinition) continue;
      const basePolicy = resolvePlacementPolicy(template, flowId, block, baseDefinition);
      if (basePolicy.distribution !== 'spread-through-content' && basePolicy.distribution !== 'spread-across-pages') continue;
      const baseGroup = groupKeyForPolicy(baseCandidate, template, route, flowId, block);
      if (!baseGroup) continue;
      const allCandidates = insertionSlotCandidates(template, route, flowId);
      const options = candidates.flatMap((candidate): GroupAssignmentOption[] => {
        const candidateLayout = routeLayout(route, template, candidate.page);
        const definition = candidateLayout?.slots.find((slot) => slot.id === candidate.slotId);
        if (!definition) return [];
        const policy = resolvePlacementPolicy(template, flowId, block, definition);
        if (policy.distribution !== basePolicy.distribution || groupKeyForPolicy(candidate, template, route, flowId, block) !== baseGroup) return [];
        if (!candidateRespectsSourceRelation(plan, policy, candidate)) return [];
        const measurementKey = `${flowId}:${block.id}:${candidateLayout?.id ?? candidate.page}:${candidate.slotId}:${candidate.box.width}:${candidate.box.height}`;
        const proposal = measuredProposals.get(measurementKey)
          ?? fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        measuredProposals.set(measurementKey, proposal);
        const region = regionForSlot(template, proposal, definition);
        const candidateOrder = allCandidates.findIndex((entry) => entry.page === candidate.page && entry.slotId === candidate.slotId);
        return [{
          candidate,
          proposal,
          policy,
          progress: progressForInsertionPage(progress, candidate.page),
          candidateOrder,
          slotKey: `${candidate.page}:${candidate.slotId}`,
          weight: visualLoadWeightForPlacement(proposal.box, region),
          sourcePages: sourcePagesForPolicy(plan, policy),
        }];
      });
      if (options.length === 0) continue;
      const provisional = {
        flowId,
        block,
        blockIndex,
        blockCount: blocks.length,
        policy: basePolicy,
        current: currentProposal,
      };
      const item: GroupAssignmentItem = {
        key,
        flowId,
        block,
        blockIndex,
        blockCount: blocks.length,
        groupKey: baseGroup,
        distribution: basePolicy.distribution,
        current: currentProposal,
        options,
        order: sourceOrderForGroupItem(document, provisional, progress),
      };
      const assignmentGroup = `${baseGroup}:${basePolicy.distribution}`;
      groups.set(assignmentGroup, [...(groups.get(assignmentGroup) ?? []), item]);
    }
  }
  return groups;
}

function assignGroupItems(
  items: GroupAssignmentItem[],
): Map<string, PlannedInsertion> | undefined {
  if (items.length < 2) return undefined;
  const ordered = [...items].sort((left, right) => left.order - right.order
    || left.flowId.localeCompare(right.flowId)
    || left.blockIndex - right.blockIndex
    || left.key.localeCompare(right.key));
  if (ordered[0]?.distribution === 'spread-across-pages') {
    const eligiblePages = [...new Set(ordered.flatMap((item) => item.options.map((option) => option.candidate.page)))].sort((left, right) => left - right);
    for (const item of ordered) {
      for (const option of item.options) {
        const pageIndex = eligiblePages.indexOf(option.candidate.page);
        option.progress = pageIndex < 0 ? option.progress : (pageIndex + 0.5) / Math.max(1, eligiblePages.length);
      }
    }
  }
  const targets = groupTargets(ordered);
  const config = readRenderConfig();
  const score = config.compositionScore;
  const beamWidth = Math.max(1, config.compositionSearch.maxInitialCandidates);
  let states: GroupAssignmentState[] = [{ cost: 0, lastPage: 0, selected: new Map(), usedSlots: new Set(), lastCandidateByFlow: new Map() }];
  for (const item of ordered) {
    const target = targets.get(item.key) ?? 0;
    const options = [...item.options].sort((left, right) => candidateAssignmentCost(item, left, target, score)
      - candidateAssignmentCost(item, right, target, score)
      || (item.current && left.candidate.page === item.current.page && left.candidate.slotId === item.current.slotId ? -1 : 1)
      || left.candidate.page - right.candidate.page
      || left.candidateOrder - right.candidateOrder);
    const next: GroupAssignmentState[] = [];
    for (const state of states) {
      for (const option of options) {
        const previousCandidateOrder = state.lastCandidateByFlow.get(item.flowId);
        if (previousCandidateOrder !== undefined && option.candidateOrder < previousCandidateOrder) continue;
        if (option.candidate.page < state.lastPage || state.usedSlots.has(option.slotKey)) continue;
        const selected = new Map(state.selected);
        selected.set(item.key, option);
        const usedSlots = new Set(state.usedSlots);
        usedSlots.add(option.slotKey);
        const lastCandidateByFlow = new Map(state.lastCandidateByFlow);
        lastCandidateByFlow.set(item.flowId, option.candidateOrder);
        next.push({
          cost: state.cost + candidateAssignmentCost(item, option, target, score),
          lastPage: option.candidate.page,
          selected,
          usedSlots,
          lastCandidateByFlow,
        });
      }
    }
    if (next.length === 0) return undefined;
    const unique = new Map<string, GroupAssignmentState>();
    for (const state of next) {
      const signature = [...state.selected.entries()]
        .map(([key, option]) => `${key}@${option.slotKey}`)
        .join('|');
      const previous = unique.get(signature);
      if (!previous || state.cost < previous.cost) unique.set(signature, state);
    }
    states = [...unique.values()]
      .sort((left, right) => left.cost - right.cost)
      .slice(0, beamWidth);
  }
  const best = states[0];
  if (!best || best.selected.size !== ordered.length) return undefined;
  const currentCost = ordered.reduce((sum, item) => {
    const current = item.current;
    const option = item.options.find((candidate) => current
      && candidate.candidate.page === current.page
      && candidate.candidate.slotId === current.slotId);
    if (!option) return Number.POSITIVE_INFINITY;
    return sum + candidateAssignmentCost(item, option, targets.get(item.key) ?? 0, score);
  }, 0);
  if (best.cost >= currentCost - Number.EPSILON) return undefined;
  return new Map([...best.selected.entries()].map(([key, option]) => [
    key,
    itemByKey(ordered, key)?.current
      && itemByKey(ordered, key)!.current!.page === option.candidate.page
      && itemByKey(ordered, key)!.current!.slotId === option.candidate.slotId
      ? itemByKey(ordered, key)!.current!
      : option.proposal,
  ]));
}

function itemByKey(items: GroupAssignmentItem[], key: string): GroupAssignmentItem | undefined {
  return items.find((item) => item.key === key);
}

function assignHardSourceRelations(
  document: CompositionDocument,
  template: CompositionLayout,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
  current: Map<string, PlannedInsertion>,
): Map<string, PlannedInsertion> {
  const assigned = new Map(current);
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const blocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    let previous: PlannedInsertion | undefined;
    for (const block of blocks) {
      const key = insertionKey(flowId, block.id);
      const currentProposal = assigned.get(key);
      const candidates = insertionSlotCandidates(template, route, flowId, block);
      if (!currentProposal || candidates.length === 0) {
        previous = currentProposal ?? previous;
        continue;
      }
      const currentCandidate = candidates.find((candidate) => candidate.page === currentProposal.page && candidate.slotId === currentProposal.slotId);
      const currentDefinition = currentCandidate
        ? routeLayout(route, template, currentCandidate.page)?.slots.find((slot) => slot.id === currentCandidate.slotId)
        : undefined;
      const currentPolicy = currentDefinition ? resolvePlacementPolicy(template, flowId, block, currentDefinition) : undefined;
      if (!currentPolicy?.source || currentPolicy.source.strength !== 'require-same-page') {
        previous = currentProposal;
        continue;
      }
      const sourcePages = materializedBlockPages(plan, currentPolicy.source.flowId, currentPolicy.source.blockId);
      if (sourcePages.length === 0 || sourcePages.includes(currentProposal.page)) {
        previous = currentProposal;
        continue;
      }
      const nextBlockIndex = blocks.indexOf(block) + 1;
      const next = blocks[nextBlockIndex] ? assigned.get(insertionKey(flowId, blocks[nextBlockIndex]!.id)) : undefined;
      const compatible = candidates
        .filter((candidate) => sourcePages.includes(candidate.page))
        .map((candidate) => fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate }))
        .filter((proposal) => insertionProposalCanFollow(previous, proposal)
          && (next === undefined || insertionProposalCanFollow(proposal, next)))
        .sort((left, right) => Math.abs(left.page - currentProposal.page) - Math.abs(right.page - currentProposal.page)
          || left.page - right.page
          || left.box.y - right.box.y);
      const replacement = compatible[0];
      if (replacement) assigned.set(key, replacement);
      previous = replacement ?? currentProposal;
    }
  }
  return assigned;
}

/** Assign mixed-flow rhythm groups once from measured main-flow progress. */
export function assignInsertionGroupsFromPlan(
  document: CompositionDocument,
  template: CompositionLayout,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
  current: Map<string, PlannedInsertion>,
): Map<string, PlannedInsertion> {
  const assigned = assignHardSourceRelations(document, template, plan, metrics, current);
  const groups = buildGroupAssignmentItems(document, template, plan, metrics, assigned);
  for (const items of groups.values()) {
    const replacement = assignGroupItems(items);
    if (!replacement) continue;
    for (const [key, proposal] of replacement) assigned.set(key, proposal);
  }
  return assigned;
}

function fitInsertionProposal(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  proposal: PlannedInsertion,
): PlannedInsertion {
  const flow = document.flows[proposal.flowId];
  const block = flow?.blocks.find((candidate) => candidate.id === proposal.blockId);
  const route = template.routes[proposal.flowId];
  const layout = route ? routeLayout(route, template, proposal.page) : undefined;
  if (!block) return proposal;
  const definition = layout?.slots.find((candidate) => candidate.id === proposal.slotId && insertionSlotAcceptsBlock(candidate, proposal.flowId, block));
  if (!definition?.fitContent) return proposal;
  let measurement: ReturnType<typeof measureInsertionContent>;
  try {
    measurement = measureInsertionContent(metrics, definition, proposal.box, block);
  } catch {
    return proposal;
  }
  if (!measurement || insertionContentHeight(measurement) <= 0 || (measurement.kind === 'table' && !insertionContentIsComplete(measurement, block))) return proposal;
  const contentHeight = insertionContentHeight(measurement);
  const maximumHeight = definition.grow?.axis === 'y' ? definition.grow.maxHeight : proposal.box.height;
  return {
    ...proposal,
    box: {
      ...proposal.box,
      height: Math.min(maximumHeight, contentHeight),
    },
  };
}

/** Reconstruct insertion proposals from a previous plan. */
export function insertionProposalsFromPlan(
  document: CompositionDocument,
  template: CompositionLayout,
  plan: CompositionPlan,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const insertionBlocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    const candidates = insertionSlotCandidates(template, route, flowId);
    const blockIndexes = new Map(flow.blocks.map((block, index) => [block.id, index]));
    const placedItems = [
      ...plan.lines.filter((line) => line.flowId === flowId && line.layer !== 'insertion'),
      ...plan.blockPlacements.filter((placement) => blockIndexes.has(placement.blockId)),
      ...plan.tablePlacements.filter((placement) => blockIndexes.has(placement.blockId)),
    ];
    let previousCandidateIndex = -1;
    let previousProposal: PlannedInsertion | undefined;
    for (const block of insertionBlocks) {
      const quoteIndex = blockIndexes.get(block.id) ?? Number.POSITIVE_INFINITY;
      const line = plan.lines
        .filter((candidate) => candidate.flowId === flowId && candidate.blockId === block.id)
        .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0];
      const placed = line
        ?? plan.blockPlacements
          .filter((candidate) => candidate.blockId === block.id)
          .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0]
        ?? plan.tablePlacements
          .filter((candidate) => candidate.blockId === block.id)
          .sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.box.x - right.box.x)[0];
      const currentIndex = placed
        ? candidates.findIndex((candidate) => candidate.page === placed.page && candidate.slotId === placed.slotId.replace(/^\d+:/u, '') && candidateSupportsBlock(template, route, flowId, candidate, block))
        : -1;
      const earliestIndex = Math.max(previousCandidateIndex + 1, currentIndex, 0);
      let selectedIndex = -1;
      let selected: PlannedInsertion | undefined;
      for (let index = earliestIndex; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (!candidateSupportsBlock(template, route, flowId, candidate, block)) continue;
        const policy = candidatePolicy(template, route, flowId, candidate, block);
        if (!candidateRespectsSourceRelation(plan, policy, candidate)) continue;
        const predecessors = placedItems.filter((item) => (blockIndexes.get(item.blockId) ?? Number.POSITIVE_INFINITY) < quoteIndex);
        const predecessorOnLaterPage = predecessors.some((item) => item.page > candidate.page);
        const predecessorInSameTextInterval = predecessors.some((item) => item.page === candidate.page
          && horizontalIntervalsOverlap(item.box, candidate.box)
          && item.box.y + item.box.height > candidate.box.y + Number.EPSILON);
        if (predecessorOnLaterPage || predecessorInSameTextInterval) continue;
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        if (!insertionProposalCanFollow(previousProposal, proposal)) continue;
        selectedIndex = index;
        selected = proposal;
        break;
      }
      if (selectedIndex < 0 || !selected) continue;
      proposals.set(insertionKey(flowId, block.id), selected);
      previousCandidateIndex = selectedIndex;
      previousProposal = selected;
    }
  }
  return proposals;
}

/** Seed hard insertion proposals in authored reading order. */
export function seedInsertionProposals(
  document: CompositionDocument,
  template: CompositionLayout,
  metrics: CompositionTextMetrics,
): Map<string, PlannedInsertion> {
  const proposals = new Map<string, PlannedInsertion>();
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const insertionBlocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    const candidates = insertionSlotCandidates(template, route, flowId);
    let previousCandidateIndex = -1;
    let previousProposal: PlannedInsertion | undefined;
    insertionBlocks.forEach((block, blockIndex) => {
      let selectedIndex = -1;
      let selectedProposal: PlannedInsertion | undefined;
      const candidateIndexes = orderedCandidateIndexes(
        template,
        route,
        flowId,
        block,
        blockIndex,
        insertionBlocks.length,
        candidates,
        previousCandidateIndex,
      );
      for (const index of candidateIndexes) {
        const candidate = candidates[index];
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        if (!insertionProposalCanFollow(previousProposal, proposal)) continue;
        selectedIndex = index;
        selectedProposal = proposal;
        break;
      }
      if (selectedIndex < 0 || !selectedProposal) return;
      proposals.set(insertionKey(flowId, block.id), selectedProposal);
      previousCandidateIndex = selectedIndex;
      previousProposal = selectedProposal;
    });
  }
  return proposals;
}

/**
 * Generate bounded insertion corrections for explicitly affected blocks.
 * The current proposal map is preserved for every unrelated block; only a
 * compatible later slot or an input-authorized omission is materialized.
 */
export function insertionProposalCorrections(
  document: CompositionDocument,
  template: CompositionLayout,
  metrics: CompositionTextMetrics,
  current: Map<string, PlannedInsertion>,
  affectedKeys: ReadonlySet<string>,
  maxCandidates = Number.MAX_SAFE_INTEGER,
): Map<string, PlannedInsertion>[] {
  const corrections: Map<string, PlannedInsertion>[] = [];
  const signatures = new Set<string>();
  const addCorrection = (candidate: Map<string, PlannedInsertion>): boolean => {
    const signature = insertionProposalSignature(candidate);
    if (signatures.has(signature)) return false;
    signatures.add(signature);
    corrections.push(candidate);
    return corrections.length >= maxCandidates;
  };
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    const blocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    const candidates = insertionSlotCandidates(template, route, flowId);
    for (const [blockIndex, block] of blocks.entries()) {
      const key = insertionKey(flowId, block.id);
      if (!affectedKeys.has(key)) continue;
      const currentProposal = current.get(key);
      const previous = blockIndex > 0 ? current.get(insertionKey(flowId, blocks[blockIndex - 1]!.id)) : undefined;
      const next = current.get(insertionKey(flowId, blocks[blockIndex + 1]?.id ?? ''));
      for (const candidate of candidates) {
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...candidate });
        if (currentProposal
          && proposal.page === currentProposal.page
          && proposal.slotId === currentProposal.slotId
          && proposal.box.x === currentProposal.box.x
          && proposal.box.y === currentProposal.box.y
          && proposal.box.width === currentProposal.box.width
          && proposal.box.height === currentProposal.box.height) continue;
        if (!insertionProposalCanFollow(previous, proposal) || (next !== undefined && !insertionProposalCanFollow(proposal, next))) continue;
        const correction = new Map(current);
        correction.set(key, proposal);
        if (addCorrection(correction)) return corrections;
      }
      if (block.allowOmission === true && currentProposal !== undefined) {
        const correction = new Map(current);
        correction.delete(key);
        if (addCorrection(correction)) return corrections;
      }
    }
  }
  return corrections;
}

/**
 * Generate bounded activation alternatives for reusable insertion capabilities.
 * Leaving any compatible capability unused is represented by the ordinary
 * bounded candidate/omission paths below; no first-slot special case is needed.
 */
export function seedInsertionProposalCandidates(
  document: CompositionDocument,
  template: CompositionLayout,
  metrics: CompositionTextMetrics,
  maxCandidates = Number.MAX_SAFE_INTEGER,
  applyGravity = true,
): Map<string, PlannedInsertion>[] {
  const rawSeed = seedInsertionProposals(document, template, metrics);
  const seed = applyGravity
    ? relaxInsertionPlacementGravity(document, template, rawSeed).proposals
    : rawSeed;
  const candidates = [seed];
  const signatures = new Set([insertionProposalSignature(seed)]);
  const addCandidate = (candidate: Map<string, PlannedInsertion>): void => {
    if (candidates.length >= maxCandidates) return;
    const signature = insertionProposalSignature(candidate);
    if (signatures.has(signature)) return;
    signatures.add(signature);
    candidates.push(candidate);
  };
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const route = template.routes[flowId];
    if (flowId === 'main' || !route?.insertionSlots?.length) continue;
    const blocks = insertionBlocksForFlow(template, flowId, flow.blocks);
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const block = blocks[blockIndex]!;
      const key = insertionKey(flowId, block.id);
      const current = seed.get(key);
      if (!current) continue;
      const options = insertionSlotCandidates(template, route, flowId, block);
      const previous = blockIndex > 0 ? seed.get(insertionKey(flowId, blocks[blockIndex - 1]!.id)) : undefined;
      const next = seed.get(insertionKey(flowId, blocks[blockIndex + 1]?.id ?? ''));
      const previousIndex = previous ? options.findIndex((candidate) => candidate.page === previous.page && candidate.slotId === previous.slotId && candidate.box.x === previous.box.x && candidate.box.y === previous.box.y) : -1;
      const nextIndex = next ? options.findIndex((candidate) => candidate.page === next.page && candidate.slotId === next.slotId && candidate.box.x === next.box.x && candidate.box.y === next.box.y) : options.length;
      for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        if (optionIndex === previousIndex || optionIndex === nextIndex || optionIndex <= previousIndex || optionIndex >= nextIndex) continue;
        const proposal = fitInsertionProposal(document, metrics, template, { flowId, blockId: block.id, ...options[optionIndex]! });
        if (!insertionProposalCanFollow(previous, proposal) || (next !== undefined && !insertionProposalCanFollow(proposal, next))) continue;
        const alternative = new Map(seed);
        alternative.set(key, proposal);
        addCandidate(alternative);
        if (candidates.length >= maxCandidates) return candidates;
      }
      if (candidates.length >= maxCandidates) return candidates;
    }
  }
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    for (const block of insertionBlocksForFlow(template, flowId, flow.blocks)) {
      if (!block.allowOmission) continue;
      const key = insertionKey(flowId, block.id);
      if (!seed.has(key)) continue;
      const omitted = new Map(seed);
      omitted.delete(key);
      addCandidate(omitted);
      if (candidates.length >= maxCandidates) return candidates;
    }
  }
  return candidates;
}

/** Find the next planned insertion that must remain below current text. */
export function nextInsertionProposal(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): PlannedInsertion | undefined {
  if ((flow.insertionSlots?.length ?? 0) === 0) return undefined;
  return blocks
    .slice(blockIndex + 1)
    .map((block) => proposals.get(insertionKey(flowId, block.id)))
    .filter((proposal): proposal is PlannedInsertion => proposal !== undefined && proposal.page === page && proposal.box.y > afterY + Number.EPSILON)
    .sort((left, right) => left.box.y - right.box.y)[0];
}

/** Return the next insertion's vertical boundary, if one exists. */
export function nextInsertionBoundary(
  flow: CompositionFlowRoute,
  blocks: CompositionBlock[],
  blockIndex: number,
  page: number,
  proposals: Map<string, PlannedInsertion>,
  flowId: string,
  afterY = Number.NEGATIVE_INFINITY,
): number | undefined {
  return nextInsertionProposal(flow, blocks, blockIndex, page, proposals, flowId, afterY)?.box.y;
}
