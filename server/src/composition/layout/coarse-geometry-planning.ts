import type { CompositionBlock, CompositionDocument, CompositionFlowRoute, CompositionLayout, CompositionRect } from '../contracts/model.js';
import type { CompositionPlan, CompositionTextMetrics } from '../contracts/engine-contracts.js';
import { routeLayout, routeSlots, slotFor } from './page-state.js';
import { lineHeight, styleFor, textPadding, wordsForBlock, wrapBlock } from '../text/text-layout.js';
import { insertionBlocksForFlow, insertionSlotCandidates } from './insertion-layout.js';
import { insertionKey, type PlannedInsertion } from './planner-candidates.js';
import { resolvePlacementPolicy } from './placement-policy.js';
import { readRenderConfig, type RenderConfig } from '../../template/builtins.js';

export interface CoarseMainPageProgress {
  page: number;
  start: number;
  end: number;
  center: number;
  occupiedHeight: number;
  capacityHeight: number;
}

export interface CoarseContentMass {
  blockId: string;
  blockKind: CompositionBlock['kind'];
  blockStartWord: number;
  blockEndWord: number;
  atomic?: boolean;
  page: number;
  slotId: string;
  box: CompositionRect;
  startWord: number;
  endWord: number;
  /** Configured inter-block spacing, retained only when exact flow can keep it in this region. */
  leadingGap?: number;
  /** Height reserved after a heading for its required following lines. */
  keepWithNextHeight?: number;
  keepWithNextLines?: number;
  uncertainty: 'text-width-estimate' | 'renderer-block-measurement';
  lineWordCounts?: number[];
  lineHeight?: number;
}

/** Intrinsic measurement at one actual container width, before any page cuts. */
export interface CoarseBlockMeasurement {
  blockId: string;
  width: number;
  unbrokenHeight: number;
  lineCount?: number;
  uncertainty: CoarseContentMass['uncertainty'];
}

export interface CoarseBreakSensitiveRegion {
  blockId: string;
  blockIds: string[];
  page: number;
  slotId: string;
  box: CompositionRect;
  startWord: number;
  endWord: number;
  rule: 'heading-following-lines' | 'paragraph-edge-lines' | 'atomic-block';
  severity: 'hard' | 'soft';
  minimumFragmentLines?: number;
}

export interface CoarseProjectionAssessment {
  newCutCount: number;
  estimatedBreakPenalty: number;
  unplacedWordCount: number;
  insertionOverlapArea?: number;
  sensitiveCuts: Array<{ blockId: string; page: number; slotId: string; box: CompositionRect; cutWord: number; rule: CoarseBreakSensitiveRegion['rule']; estimatedPenalty: number }>;
}

export interface CoarseMissingMeasurement {
  blockId: string;
  page: number;
  slotId: string;
  reason: 'atomic-block-height-metric-unavailable';
}

export interface CoarseUnassignedInsertion {
  flowId: string;
  blockId: string;
  legalCandidateCount: number;
  reason: 'no-legal-candidate' | 'capacity-or-order-conflict' | 'source-relation-conflict' | 'continuation-policy-conflict';
  sourceRelationConflict?: {
    flowId: string;
    blockId: string;
    strength: 'require-same-page';
    estimatedSourcePages: number[];
    candidatePages: number[];
  };
  continuationPolicyConflict?: {
    anchorPage: number;
    candidatePages: number[];
  };
}

export interface CoarseExactPageComparison {
  page: number;
  estimatedMassUnits: number;
  exactTextWords: number;
  estimatedProgressStart?: number;
  estimatedProgressEnd?: number;
  exactProgressStart?: number;
  exactProgressEnd?: number;
  blocks?: Array<{
    blockId: string;
    estimatedMassUnits: number;
    exactTextWords: number;
    estimatedLineCount?: number;
    exactLineCount?: number;
    estimatedBySlot: Array<{ slotId: string; massUnits: number; estimatedLineCount?: number; occupiedHeight: number; unoccupiedEnvelopeHeight: number; leftX: number; rightX: number; topY: number; bottomY: number }>;
    exactBySlot: Array<{ slotId: string; words: number; exactLineCount: number; occupiedHeight: number; unoccupiedEnvelopeHeight: number; leftX: number; rightX: number; topY: number; bottomY: number }>;
  }>;
}

export interface CoarseExactPlanComparison {
  estimatedTerminalPage?: number;
  exactMainTerminalPage?: number;
  exactTextWordCount: number;
  unrepresentedNonTextMassBlockCount: number;
  pages: CoarseExactPageComparison[];
}

/** Include measured main-flow block placements when finding the exact terminal page. */
function exactMainContentPages(document: CompositionDocument, plan: CompositionPlan): number[] {
  const mainBlockIds = new Set((document.flows.main?.blocks ?? []).map(({ id }) => id));
  const pages = new Set(plan.lines
    .filter((line) => line.flowId === 'main' && line.layer !== 'insertion')
    .map(({ page }) => page));
  for (const placement of [...(plan.blockPlacements ?? []), ...(plan.tablePlacements ?? [])]) {
    const slot = plan.slots.find((candidate) => candidate.page === placement.page && candidate.id === placement.slotId);
    if (mainBlockIds.has(placement.blockId) && slot?.flowId === 'main') pages.add(placement.page);
  }
  return [...pages].sort((left, right) => left - right);
}

interface SlotComparisonExtents {
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
  occupiedHeight: number;
}

interface ExactSlotComparison extends SlotComparisonExtents {
  words: number;
  lines: number;
}

interface EstimatedSlotComparison extends SlotComparisonExtents {
  massUnits: number;
  lines: number;
}

export interface CoarseMainRegion {
  page: number;
  slotId: string;
  box: CompositionRect;
}

export interface CoarseDynamicReservation {
  flowId: string;
  page: number;
  slotId: string;
  displacedMainSlotIds: string[];
  estimatedHeight: number;
  displacement: number;
}

export interface CoarseGeometryEstimate {
  regions: CoarseMainRegion[];
  dynamicReservations: CoarseDynamicReservation[];
  mainProgressByPage: Map<number, CoarseMainPageProgress>;
  contentMass: CoarseContentMass[];
  blockMeasurements: CoarseBlockMeasurement[];
  breakSensitiveRegions: CoarseBreakSensitiveRegion[];
  minimumLinesAtEnd: number;
  missingMeasurements: CoarseMissingMeasurement[];
  terminalPage?: number;
  unplacedWordCount: number;
  displacedWordCount?: number;
}

type CoarseRegion = CoarseMainRegion;

function coarseMassUnitCount(block: CompositionBlock): number {
  if (block.kind === 'table') return block.table?.body.length ?? 0;
  if (block.atomic === true || ['image', 'metric', 'chart', 'lockup'].includes(block.kind)) return 1;
  return wordsForBlock(block).length;
}

/** Compare the baseline rectangle estimate with exact main-flow line coverage by page. */
export function compareCoarseEstimateToExactPlan(
  document: CompositionDocument,
  estimate: CoarseGeometryEstimate,
  plan: CompositionPlan,
): CoarseExactPlanComparison {
  const mainBlocks = document.flows.main?.blocks ?? [];
  const blockOffsets = new Map<string, number>();
  const blockWordCounts = new Map(mainBlocks
    .filter((block) => ['paragraph', 'heading', 'list-item'].includes(block.kind))
    .map((block) => [block.id, wordsForBlock(block).length] as const));
  let massOffset = 0;
  let unrepresentedNonTextMassBlockCount = 0;
  for (const block of mainBlocks) {
    blockOffsets.set(block.id, massOffset);
    massOffset += coarseMassUnitCount(block);
    if (!['paragraph', 'heading', 'list-item'].includes(block.kind) && coarseMassUnitCount(block) > 0) unrepresentedNonTextMassBlockCount += 1;
  }
  const exactByPage = new Map<number, {
    start: number;
    end: number;
    words: number;
    byBlock: Map<string, { words: number; lines: number; bySlot: Map<string, ExactSlotComparison> }>;
  }>();
  for (const line of plan.lines) {
    if (line.flowId !== 'main' || line.layer === 'insertion') continue;
    const blockOffset = blockOffsets.get(line.blockId);
    const wordCount = blockWordCounts.get(line.blockId);
    if (blockOffset === undefined || wordCount === undefined) continue;
    const start = blockOffset + line.startWord;
    const end = blockOffset + line.endWord;
    const page = exactByPage.get(line.page) ?? {
      start,
      end,
      words: 0,
      byBlock: new Map<string, { words: number; lines: number; bySlot: Map<string, ExactSlotComparison> }>(),
    };
    page.start = Math.min(page.start, start);
    page.end = Math.max(page.end, end);
    const exactWords = Math.max(0, Math.min(wordCount, line.endWord) - Math.max(0, line.startWord));
    page.words += exactWords;
    const exactBlock = page.byBlock.get(line.blockId) ?? { words: 0, lines: 0, bySlot: new Map<string, ExactSlotComparison>() };
    exactBlock.words += exactWords;
    exactBlock.lines += 1;
    const slotGeometry = exactBlock.bySlot.get(line.slotId) ?? { words: 0, lines: 0, occupiedHeight: 0, leftX: line.box.x, rightX: line.box.x + line.box.width, topY: line.box.y, bottomY: line.box.y + line.box.height };
    slotGeometry.words += exactWords;
    slotGeometry.occupiedHeight += line.box.height;
    slotGeometry.lines += 1;
    slotGeometry.leftX = Math.min(slotGeometry.leftX, line.box.x);
    slotGeometry.rightX = Math.max(slotGeometry.rightX, line.box.x + line.box.width);
    slotGeometry.topY = Math.min(slotGeometry.topY, line.box.y);
    slotGeometry.bottomY = Math.max(slotGeometry.bottomY, line.box.y + line.box.height);
    exactBlock.bySlot.set(line.slotId, slotGeometry);
    page.byBlock.set(line.blockId, exactBlock);
    exactByPage.set(line.page, page);
  }
  const totalMassUnits = Math.max(1, massOffset);
  const estimatedByPage = new Map<number, CoarseMainPageProgress>();
  const estimatedWordsByPage = new Map<number, number>();
  const estimatedWordsByPageAndBlock = new Map<number, Map<string, { massUnits: number; lines: number; bySlot: Map<string, EstimatedSlotComparison> }>>();
  for (const progress of estimate.mainProgressByPage.values()) estimatedByPage.set(progress.page, progress);
  for (const mass of estimate.contentMass) {
    const massUnits = mass.endWord - mass.startWord;
    estimatedWordsByPage.set(mass.page, (estimatedWordsByPage.get(mass.page) ?? 0) + massUnits);
    const byBlock = estimatedWordsByPageAndBlock.get(mass.page) ?? new Map<string, { massUnits: number; lines: number; bySlot: Map<string, EstimatedSlotComparison> }>();
    const estimatedBlock = byBlock.get(mass.blockId) ?? { massUnits: 0, lines: 0, bySlot: new Map<string, EstimatedSlotComparison>() };
    estimatedBlock.massUnits += massUnits;
    if (mass.lineWordCounts !== undefined) estimatedBlock.lines += mass.lineWordCounts.length;
    const slotGeometry = estimatedBlock.bySlot.get(mass.slotId) ?? { massUnits: 0, lines: 0, occupiedHeight: 0, leftX: mass.box.x, rightX: mass.box.x + mass.box.width, topY: mass.box.y, bottomY: mass.box.y + mass.box.height };
    slotGeometry.massUnits += massUnits;
    slotGeometry.occupiedHeight += mass.box.height;
    if (mass.lineWordCounts !== undefined) slotGeometry.lines += mass.lineWordCounts.length;
    slotGeometry.leftX = Math.min(slotGeometry.leftX, mass.box.x);
    slotGeometry.rightX = Math.max(slotGeometry.rightX, mass.box.x + mass.box.width);
    slotGeometry.topY = Math.min(slotGeometry.topY, mass.box.y);
    slotGeometry.bottomY = Math.max(slotGeometry.bottomY, mass.box.y + mass.box.height);
    estimatedBlock.bySlot.set(mass.slotId, slotGeometry);
    byBlock.set(mass.blockId, estimatedBlock);
    estimatedWordsByPageAndBlock.set(mass.page, byBlock);
  }
  const pages = [...new Set([...estimatedByPage.keys(), ...exactByPage.keys()])]
    .sort((left, right) => left - right)
    .map((page): CoarseExactPageComparison => {
      const estimateProgress = estimatedByPage.get(page);
      const exact = exactByPage.get(page);
      const estimatedByBlock = estimatedWordsByPageAndBlock.get(page) ?? new Map<string, { massUnits: number; lines: number; bySlot: Map<string, EstimatedSlotComparison> }>();
      const exactByBlock = exact?.byBlock ?? new Map<string, { words: number; lines: number; bySlot: Map<string, ExactSlotComparison> }>();
      const blockIds = [...new Set([...estimatedByBlock.keys(), ...exactByBlock.keys()])]
        .sort((left, right) => (blockOffsets.get(left) ?? Number.MAX_SAFE_INTEGER) - (blockOffsets.get(right) ?? Number.MAX_SAFE_INTEGER));
      return {
        page,
        estimatedMassUnits: estimatedWordsByPage.get(page) ?? 0,
        exactTextWords: exact?.words ?? 0,
        ...(estimateProgress ? { estimatedProgressStart: estimateProgress.start, estimatedProgressEnd: estimateProgress.end } : {}),
        ...(exact ? { exactProgressStart: exact.start / totalMassUnits, exactProgressEnd: exact.end / totalMassUnits } : {}),
        ...(blockIds.length === 0 ? {} : { blocks: blockIds.map((blockId) => {
          const estimatedBlock = estimatedByBlock.get(blockId);
          const exactBlock = exactByBlock.get(blockId);
          return {
            blockId,
            estimatedMassUnits: estimatedBlock?.massUnits ?? 0,
            exactTextWords: exactBlock?.words ?? 0,
            ...(estimatedBlock && estimatedBlock.lines > 0 ? { estimatedLineCount: estimatedBlock.lines } : {}),
            ...(exactBlock && exactBlock.lines > 0 ? { exactLineCount: exactBlock.lines } : {}),
            estimatedBySlot: [...(estimatedBlock?.bySlot ?? new Map<string, EstimatedSlotComparison>())]
              .map(([slotId, geometry]) => ({ slotId, massUnits: geometry.massUnits, ...(geometry.lines > 0 ? { estimatedLineCount: geometry.lines } : {}), occupiedHeight: geometry.occupiedHeight, unoccupiedEnvelopeHeight: Math.max(0, geometry.bottomY - geometry.topY - geometry.occupiedHeight), leftX: geometry.leftX, rightX: geometry.rightX, topY: geometry.topY, bottomY: geometry.bottomY })),
            exactBySlot: [...(exactBlock?.bySlot ?? new Map<string, ExactSlotComparison>())]
              .map(([slotId, geometry]) => ({ slotId, words: geometry.words, exactLineCount: geometry.lines, occupiedHeight: geometry.occupiedHeight, unoccupiedEnvelopeHeight: Math.max(0, geometry.bottomY - geometry.topY - geometry.occupiedHeight), leftX: geometry.leftX, rightX: geometry.rightX, topY: geometry.topY, bottomY: geometry.bottomY })),
          };
        }) }),
      };
    });
  const exactContentPages = exactMainContentPages(document, plan);
  return {
    ...(estimate.terminalPage === undefined ? {} : { estimatedTerminalPage: estimate.terminalPage }),
    ...(exactContentPages.length === 0 ? {} : { exactMainTerminalPage: exactContentPages.at(-1) }),
    exactTextWordCount: [...exactByPage.values()].reduce((sum, page) => sum + page.words, 0),
    unrepresentedNonTextMassBlockCount,
    pages,
  };
}

/** Reuse one fixed coarse estimate to compare a different exact candidate without re-estimating or reassigning. */
export function compareExactPlanToCoarseBaseline(
  document: CompositionDocument,
  baseline: CoarseExactPlanComparison,
  plan: CompositionPlan,
): CoarseExactPlanComparison {
  const mainBlocks = document.flows.main?.blocks ?? [];
  const blockOffsets = new Map<string, number>();
  const blockWordCounts = new Map(mainBlocks
    .filter((block) => ['paragraph', 'heading', 'list-item'].includes(block.kind))
    .map((block) => [block.id, wordsForBlock(block).length] as const));
  let massOffset = 0;
  for (const block of mainBlocks) {
    blockOffsets.set(block.id, massOffset);
    massOffset += coarseMassUnitCount(block);
  }
  const exactByPage = new Map<number, { start: number; end: number; words: number; blocks: Map<string, { words: number; lines: number; bySlot: Map<string, ExactSlotComparison> }> }>();
  for (const line of plan.lines) {
    if (line.flowId !== 'main' || line.layer === 'insertion') continue;
    const offset = blockOffsets.get(line.blockId);
    const wordCount = blockWordCounts.get(line.blockId);
    if (offset === undefined || wordCount === undefined) continue;
    const start = offset + line.startWord;
    const end = offset + line.endWord;
    const page = exactByPage.get(line.page) ?? { start, end, words: 0, blocks: new Map() };
    page.start = Math.min(page.start, start);
    page.end = Math.max(page.end, end);
    const words = Math.max(0, Math.min(wordCount, line.endWord) - Math.max(0, line.startWord));
    page.words += words;
    const block = page.blocks.get(line.blockId) ?? { words: 0, lines: 0, bySlot: new Map<string, ExactSlotComparison>() };
    block.words += words;
    block.lines += 1;
    const slotGeometry = block.bySlot.get(line.slotId) ?? { words: 0, lines: 0, occupiedHeight: 0, leftX: line.box.x, rightX: line.box.x + line.box.width, topY: line.box.y, bottomY: line.box.y + line.box.height };
    slotGeometry.words += words;
    slotGeometry.occupiedHeight += line.box.height;
    slotGeometry.lines += 1;
    slotGeometry.leftX = Math.min(slotGeometry.leftX, line.box.x);
    slotGeometry.rightX = Math.max(slotGeometry.rightX, line.box.x + line.box.width);
    slotGeometry.topY = Math.min(slotGeometry.topY, line.box.y);
    slotGeometry.bottomY = Math.max(slotGeometry.bottomY, line.box.y + line.box.height);
    block.bySlot.set(line.slotId, slotGeometry);
    page.blocks.set(line.blockId, block);
    exactByPage.set(line.page, page);
  }
  const totalMassUnits = Math.max(1, massOffset);
  const baselinePages = new Map(baseline.pages.map((page) => [page.page, page] as const));
  const pages = [...new Set([...baselinePages.keys(), ...exactByPage.keys()])]
    .sort((left, right) => left - right)
    .map((page): CoarseExactPageComparison => {
      const estimated = baselinePages.get(page);
      const exact = exactByPage.get(page);
      const estimatedBlocks = new Map((estimated?.blocks ?? []).map((block) => [block.blockId, block] as const));
      const exactBlocks = exact?.blocks ?? new Map<string, { words: number; lines: number; bySlot: Map<string, ExactSlotComparison> }>();
      const blockIds = [...new Set([...estimatedBlocks.keys(), ...exactBlocks.keys()])]
        .sort((left, right) => (blockOffsets.get(left) ?? Number.MAX_SAFE_INTEGER) - (blockOffsets.get(right) ?? Number.MAX_SAFE_INTEGER));
      return {
        page,
        estimatedMassUnits: estimated?.estimatedMassUnits ?? 0,
        exactTextWords: exact?.words ?? 0,
        ...(estimated?.estimatedProgressStart === undefined ? {} : { estimatedProgressStart: estimated.estimatedProgressStart }),
        ...(estimated?.estimatedProgressEnd === undefined ? {} : { estimatedProgressEnd: estimated.estimatedProgressEnd }),
        ...(exact ? { exactProgressStart: exact.start / totalMassUnits, exactProgressEnd: exact.end / totalMassUnits } : {}),
        ...(blockIds.length === 0 ? {} : { blocks: blockIds.map((blockId) => {
          const estimatedBlock = estimatedBlocks.get(blockId);
          const exactBlock = exactBlocks.get(blockId);
          return {
            blockId,
            estimatedMassUnits: estimatedBlock?.estimatedMassUnits ?? 0,
            exactTextWords: exactBlock?.words ?? 0,
            ...(estimatedBlock?.estimatedLineCount === undefined ? {} : { estimatedLineCount: estimatedBlock.estimatedLineCount }),
            ...(exactBlock && exactBlock.lines > 0 ? { exactLineCount: exactBlock.lines } : {}),
            estimatedBySlot: estimatedBlock?.estimatedBySlot ?? [],
            exactBySlot: [...(exactBlock?.bySlot ?? new Map<string, ExactSlotComparison>())]
              .map(([slotId, geometry]) => ({ slotId, words: geometry.words, exactLineCount: geometry.lines, occupiedHeight: geometry.occupiedHeight, unoccupiedEnvelopeHeight: Math.max(0, geometry.bottomY - geometry.topY - geometry.occupiedHeight), leftX: geometry.leftX, rightX: geometry.rightX, topY: geometry.topY, bottomY: geometry.bottomY })),
          };
        }) }),
      };
    });
  const exactContentPages = exactMainContentPages(document, plan);
  return {
    ...(baseline.estimatedTerminalPage === undefined ? {} : { estimatedTerminalPage: baseline.estimatedTerminalPage }),
    ...(exactContentPages.length === 0 ? {} : { exactMainTerminalPage: exactContentPages.at(-1) }),
    exactTextWordCount: [...exactByPage.values()].reduce((sum, page) => sum + page.words, 0),
    unrepresentedNonTextMassBlockCount: baseline.unrepresentedNonTextMassBlockCount,
    pages,
  };
}

interface CoarseInsertionCandidate {
  proposal: PlannedInsertion;
  progress: number;
  candidateIndex: number;
  weight: number;
  sourceRelationMatches: boolean;
  spacingTarget: number;
}

interface CoarseInsertionItem {
  key: string;
  flowId: string;
  block: CompositionBlock;
  groupKey: string;
  distribution: 'free' | 'clustered' | 'spread-through-content' | 'spread-across-pages';
  candidates: CoarseInsertionCandidate[];
  targetProgress?: number;
  eligiblePages: number[];
}

export interface CoarseAssignmentSearch {
  beamWidth: number;
  expandedStates: number;
  prunedStates: number;
  completeLayoutsCompared: number;
  exhaustive: boolean;
  assignedRequiredCount: number;
  assignedCount: number;
  nonBodyAssignments: number;
  progressDeviation: number;
  spacingDeficit: number;
  pageLoadImbalance: number;
  objectiveCost: number;
  projectedLayoutsCompared: number;
  projectionAssessment: CoarseProjectionAssessment;
  projectedAlternatives: Array<{ assignments: Array<{ flowId: string; blockId: string; page: number; slotId: string }>; objectiveCost: number; progressDeviation: number; assessment: CoarseProjectionAssessment; selected: boolean }>;
  targets: Array<{ flowId: string; blockId: string; page: number; slotId: string; targetProgress: number; actualProgress: number; contentProgress: number; visualLoad: number }>;
}

interface CoarseAssignmentState {
  selections: Map<string, CoarseInsertionCandidate>;
  usedSlots: Set<string>;
  lastByFlow: Map<string, CoarseInsertionCandidate>;
  blockedFlows: Set<string>;
  assignedRequiredCount: number;
  nonBodyAssignments: number;
  progressDeviation: number;
  spacingDeficit: number;
  pageLoadImbalance: number;
  objectiveCost: number;
}

export interface CoarseInsertionConfiguration {
  proposals: Map<string, PlannedInsertion>;
  projected: CoarseGeometryEstimate;
  search: CoarseAssignmentSearch;
}

/** Locate a slot on the continuous, unobstructed document mass axis. */
function coarseProgressAtInsertion(estimate: CoarseGeometryEstimate, proposal: PlannedInsertion): number {
  const pageProgress = estimate.mainProgressByPage.get(proposal.page);
  if (!pageProgress) {
    const before = [...estimate.mainProgressByPage.values()].filter((entry) => entry.page < proposal.page).at(-1);
    if (before) return before.end;
    return [...estimate.mainProgressByPage.values()].find((entry) => entry.page > proposal.page)?.start ?? 0;
  }
  const centerY = proposal.box.y + proposal.box.height / 2;
  const masses = estimate.contentMass.filter((mass) => mass.page === proposal.page);
  const totalMass = masses.reduce((sum, mass) => sum + mass.endWord - mass.startWord, 0);
  if (totalMass <= 0) return pageProgress.center;
  const massBefore = masses.reduce((sum, mass) => {
    const fraction = Math.max(0, Math.min(1, (centerY - mass.box.y) / Math.max(Number.EPSILON, mass.box.height)));
    return sum + (mass.endWord - mass.startWord) * fraction;
  }, 0);
  return pageProgress.start + (pageProgress.end - pageProgress.start) * massBefore / totalMass;
}

function routeAllowsCoarseInsertionContinuation(route: CompositionFlowRoute, previousPage: number | undefined, candidatePage: number): boolean {
  return previousPage === undefined
    || route.continuation === 'allowed'
    || route.repeat === 'each-page'
    || candidatePage === previousPage;
}

/** Measure every insertion candidate before choosing any document assignment. */
function measureCoarseInsertionItems(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  estimate: CoarseGeometryEstimate,
): CoarseInsertionItem[] {
  const items: CoarseInsertionItem[] = [];
  const score = readRenderConfig().compositionScore;
  const bodyPages = new Set(estimate.contentMass.filter((mass) => mass.endWord > mass.startWord).map((mass) => mass.page));
  for (const [flowId, flow] of Object.entries(document.flows)) {
    const route = template.routes[flowId];
    if (flowId === 'main' || !route?.insertionSlots?.length) continue;
    const candidateOrder = new Map(insertionSlotCandidates(template, route, flowId)
      .map((candidate, index) => [`${candidate.page}:${candidate.slotId}`, index] as const));
    for (const block of insertionBlocksForFlow(template, flowId, flow.blocks)) {
      const measured = insertionSlotCandidates(template, route, flowId, block).flatMap((candidate, candidateIndex) => {
        const definition = routeLayout(route, template, candidate.page)?.slots.find((slot) => slot.id === candidate.slotId);
        if (!definition) return [];
        const policy = resolvePlacementPolicy(template, flowId, block, definition);
        const estimatedSize = definition.fitContent ? estimatedBlockHeight(block, metrics, candidate.box.width, candidate.box.height) : undefined;
        const proposal: PlannedInsertion = {
          flowId, blockId: block.id, page: candidate.page, slotId: candidate.slotId,
          box: definition.fitContent
            ? { ...candidate.box, height: Math.max(Number.EPSILON, Math.min(definition.grow?.axis === 'y' ? definition.grow.maxHeight : candidate.box.height, estimatedSize?.height ?? candidate.box.height)) }
            : { ...candidate.box },
        };
        const regions = estimate.regions.filter((region) => region.page === candidate.page);
        const regionArea = regions.reduce((sum, region) => sum + region.box.width * region.box.height, 0);
        const regionHeight = regions.length > 0
          ? Math.max(...regions.map((region) => region.box.y + region.box.height)) - Math.min(...regions.map((region) => region.box.y))
          : candidate.box.height;
        const weight = Math.max(Number.EPSILON,
          proposal.box.width * proposal.box.height / Math.max(Number.EPSILON, regionArea || candidate.box.width * candidate.box.height) * score.visualLoadAreaWeight
          + proposal.box.height / Math.max(Number.EPSILON, regionHeight) * score.visualLoadVerticalWeight);
        const sourceMass = policy.source?.flowId === 'main' ? estimate.contentMass.filter((mass) => mass.blockId === policy.source!.blockId) : [];
        return [{ policy, groupKey: `${definition.regionId}:${policy.rhythmGroup ?? flowId}:${policy.distribution}`, candidate: {
          proposal, progress: coarseProgressAtInsertion(estimate, proposal),
          candidateIndex: candidateOrder.get(`${candidate.page}:${candidate.slotId}`) ?? candidateIndex,
          weight,
          spacingTarget: definition.spacingProfile === 'compact' ? score.spacingProfileCompactTargetMm
            : definition.spacingProfile === 'open' ? score.spacingProfileOpenTargetMm : score.spacingProfileNormalTargetMm,
          sourceRelationMatches: policy.source?.strength !== 'require-same-page' || sourceMass.length === 0 || sourceMass.some((mass) => mass.page === candidate.page),
        } }];
      });
      const first = measured[0];
      if (!first) {
        items.push({ key: insertionKey(flowId, block.id), flowId, block, groupKey: flowId, distribution: 'free', candidates: [], eligiblePages: [] });
        continue;
      }
      const candidates = measured.filter((entry) => entry.groupKey === first.groupKey).map((entry) => entry.candidate);
      const pages = [...new Set(candidates.map(({ proposal }) => proposal.page))].sort((a, b) => a - b);
      items.push({ key: insertionKey(flowId, block.id), flowId, block, groupKey: first.groupKey, distribution: first.policy.distribution,
        candidates, eligiblePages: pages.some((page) => bodyPages.has(page)) ? pages.filter((page) => bodyPages.has(page)) : pages });
    }
  }
  const groups = new Map<string, CoarseInsertionItem[]>();
  for (const item of items) groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
  for (const group of groups.values()) {
    const weights = group.map((item) => item.candidates.reduce((sum, candidate) => sum + candidate.weight, 0) / Math.max(1, item.candidates.length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let accumulated = 0;
    for (const [index, item] of group.entries()) {
      if (item.distribution === 'spread-through-content') item.targetProgress = (accumulated + weights[index]! / 2) / Math.max(Number.EPSILON, totalWeight);
      if (item.distribution === 'spread-across-pages') item.targetProgress = (index + 0.5) / group.length;
      accumulated += weights[index]!;
    }
  }
  return items;
}

function coarseCandidateTargetProgress(item: CoarseInsertionItem, candidate: CoarseInsertionCandidate): number {
  return item.distribution === 'spread-across-pages'
    ? (item.eligiblePages.indexOf(candidate.proposal.page) + 0.5) / Math.max(1, item.eligiblePages.length)
    : candidate.progress;
}

/** Evaluate the complete geometry of a retained assignment, including cross-flow spacing. */
function calculateCoarseAssignmentCost(items: CoarseInsertionItem[], state: CoarseAssignmentState, search: RenderConfig['compositionSearch'], projected?: CoarseGeometryEstimate): void {
  let progressDeviation = 0;
  let spacingDeficit = 0;
  let pageLoadImbalance = 0;
  const selected = items.flatMap((item) => {
    const candidate = state.selections.get(item.key);
    if (!candidate) return [];
    if (item.targetProgress !== undefined) {
      const actual = projected && item.distribution === 'spread-through-content'
        ? coarseProgressAtInsertion(projected, candidate.proposal) : coarseCandidateTargetProgress(item, candidate);
      progressDeviation += Math.abs(actual - item.targetProgress);
    } else {
      progressDeviation += candidate.candidateIndex;
    }
    return [{ item, candidate }];
  });
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      const a = selected[left]!.candidate.proposal;
      const b = selected[right]!.candidate.proposal;
      if (a.page !== b.page || Math.min(a.box.x + a.box.width, b.box.x + b.box.width) <= Math.max(a.box.x, b.box.x)) continue;
      const gap = Math.max(a.box.y, b.box.y) - Math.min(a.box.y + a.box.height, b.box.y + b.box.height);
      const target = Math.max(selected[left]!.candidate.spacingTarget, selected[right]!.candidate.spacingTarget);
      spacingDeficit += Math.max(0, target - gap) / Math.max(Number.EPSILON, target);
    }
  }
  const groups = new Map<string, typeof selected>();
  for (const entry of selected) {
    if (entry.item.distribution === 'spread-across-pages') groups.set(entry.item.groupKey, [...(groups.get(entry.item.groupKey) ?? []), entry]);
  }
  for (const group of groups.values()) {
    const pages = [...new Set(group.flatMap(({ item }) => item.eligiblePages))];
    const totalLoad = group.reduce((sum, { candidate }) => sum + candidate.weight, 0);
    const targetLoad = totalLoad / Math.max(1, pages.length);
    pageLoadImbalance += pages.reduce((sum, page) => sum + Math.abs(group.filter(({ candidate }) => candidate.proposal.page === page)
      .reduce((load, { candidate }) => load + candidate.weight, 0) - targetLoad), 0) / Math.max(Number.EPSILON, totalLoad);
  }
  state.progressDeviation = progressDeviation;
  state.spacingDeficit = spacingDeficit;
  state.pageLoadImbalance = pageLoadImbalance;
  state.objectiveCost = progressDeviation * search.coarseAssignmentProgressWeight
    + spacingDeficit * search.coarseAssignmentSpacingWeight + pageLoadImbalance * search.coarseAssignmentPageLoadWeight;
}

function compareCoarseAssignments(left: CoarseAssignmentState, right: CoarseAssignmentState): number {
  return right.assignedRequiredCount - left.assignedRequiredCount
    || right.selections.size - left.selections.size
    || left.nonBodyAssignments - right.nonBodyAssignments
    || left.objectiveCost - right.objectiveCost;
}

/** Measure insertion collisions before comparing text displacement costs. */
function calculateCoarseInsertionOverlap(proposals: ReadonlyMap<string, PlannedInsertion>): number {
  const insertions = [...proposals.values()];
  let area = 0;
  for (let left = 0; left < insertions.length; left += 1) {
    for (let right = left + 1; right < insertions.length; right += 1) {
      const a = insertions[left]!;
      const b = insertions[right]!;
      if (a.page !== b.page) continue;
      const width = Math.max(0, Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x));
      const height = Math.max(0, Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y));
      area += width * height;
    }
  }
  return area;
}

/** Retain bounded alternatives across all flows, then select a whole-document assignment. */
export function planCoarseInsertionAssignments(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  estimate: CoarseGeometryEstimate,
  current: ReadonlyMap<string, PlannedInsertion>,
): CoarseInsertionConfiguration & { alternatives: CoarseInsertionConfiguration[] } {
  const items = measureCoarseInsertionItems(document, metrics, template, estimate);
  const config = readRenderConfig();
  const search = config.compositionSearch;
  const beamWidth = search.coarseAssignmentBeamWidth;
  const bodyPages = new Set(estimate.contentMass.filter((mass) => mass.endWord > mass.startWord).map((mass) => mass.page));
  let expandedStates = 0;
  let prunedStates = 0;
  let states: CoarseAssignmentState[] = [{ selections: new Map(), usedSlots: new Set(), lastByFlow: new Map(), blockedFlows: new Set(),
    assignedRequiredCount: 0, nonBodyAssignments: 0, progressDeviation: 0, spacingDeficit: 0, pageLoadImbalance: 0, objectiveCost: 0 }];
  for (const item of items) {
    const nextStates: CoarseAssignmentState[] = [];
    for (const state of states) {
      const previous = state.lastByFlow.get(item.flowId);
      const choices = state.blockedFlows.has(item.flowId) ? [] : item.candidates.filter((candidate) => candidate.sourceRelationMatches
        && !state.usedSlots.has(`${candidate.proposal.page}:${candidate.proposal.slotId}`)
        && (!previous || candidate.candidateIndex >= previous.candidateIndex && candidate.proposal.page >= previous.proposal.page)
        && routeAllowsCoarseInsertionContinuation(template.routes[item.flowId]!, previous?.proposal.page, candidate.proposal.page));
      if (choices.length === 0) {
        const blocked = { ...state, blockedFlows: new Set([...state.blockedFlows, item.flowId]) };
        nextStates.push(blocked);
        continue;
      }
      for (const candidate of choices) {
        const next: CoarseAssignmentState = { ...state,
          selections: new Map([...state.selections, [item.key, candidate]]),
          usedSlots: new Set([...state.usedSlots, `${candidate.proposal.page}:${candidate.proposal.slotId}`]),
          lastByFlow: new Map([...state.lastByFlow, [item.flowId, candidate]]),
          assignedRequiredCount: state.assignedRequiredCount + (item.block.allowOmission === true ? 0 : 1),
          nonBodyAssignments: state.nonBodyAssignments + (bodyPages.has(candidate.proposal.page) ? 0 : 1),
        };
        calculateCoarseAssignmentCost(items, next, search);
        nextStates.push(next);
        expandedStates += 1;
      }
    }
    nextStates.sort(compareCoarseAssignments);
    prunedStates += Math.max(0, nextStates.length - beamWidth);
    states = nextStates.slice(0, beamWidth);
  }
  states.sort(compareCoarseAssignments);
  const projectedAlternatives = states.slice(0, search.coarseProjectionCandidateCount).map((state) => {
    const proposals = new Map(current);
    for (const item of items) proposals.delete(item.key);
    for (const [key, candidate] of state.selections) proposals.set(key, candidate.proposal);
    const projected = projectCoarseInsertionDisplacement(estimate, template, proposals);
    const assessment = { ...assessCoarseProjection(estimate, projected, config), insertionOverlapArea: calculateCoarseInsertionOverlap(proposals) };
    const projectedState = { ...state };
    calculateCoarseAssignmentCost(items, projectedState, search, projected);
    projectedState.objectiveCost += assessment.estimatedBreakPenalty * search.coarseAssignmentBreakPenaltyWeight;
    return { state: projectedState, projected, assessment, proposals, unobstructedPreferred: state === states[0] };
  });
  projectedAlternatives.sort((left, right) => right.state.assignedRequiredCount - left.state.assignedRequiredCount
    || right.state.selections.size - left.state.selections.size
    || left.assessment.insertionOverlapArea - right.assessment.insertionOverlapArea
    || left.assessment.unplacedWordCount - right.assessment.unplacedWordCount
    || left.state.nonBodyAssignments - right.state.nonBodyAssignments
    || left.state.objectiveCost - right.state.objectiveCost);
  const configurations = projectedAlternatives.map((selectedAlternative): CoarseInsertionConfiguration => {
    const selected = selectedAlternative.state;
    return { proposals: selectedAlternative.proposals, projected: selectedAlternative.projected, search: {
      beamWidth, expandedStates, prunedStates, completeLayoutsCompared: states.length, exhaustive: prunedStates === 0 && projectedAlternatives.length === states.length,
      assignedRequiredCount: selected.assignedRequiredCount, assignedCount: selected.selections.size,
      nonBodyAssignments: selected.nonBodyAssignments, progressDeviation: selected.progressDeviation,
      spacingDeficit: selected.spacingDeficit, pageLoadImbalance: selected.pageLoadImbalance, objectiveCost: selected.objectiveCost,
      projectedLayoutsCompared: projectedAlternatives.length,
      projectionAssessment: selectedAlternative.assessment,
      projectedAlternatives: projectedAlternatives.map((alternative) => ({
        assignments: [...alternative.state.selections.values()].map(({ proposal }) => ({ flowId: proposal.flowId, blockId: proposal.blockId, page: proposal.page, slotId: proposal.slotId })),
        objectiveCost: alternative.state.objectiveCost,
        progressDeviation: alternative.state.progressDeviation,
        assessment: alternative.assessment,
        selected: alternative === selectedAlternative,
      })),
      targets: items.flatMap((item) => {
        const candidate = selected.selections.get(item.key);
        return !candidate || item.targetProgress === undefined ? [] : [{ flowId: item.flowId, blockId: item.block.id,
          page: candidate.proposal.page, slotId: candidate.proposal.slotId, targetProgress: item.targetProgress,
          actualProgress: item.distribution === 'spread-through-content' ? coarseProgressAtInsertion(selectedAlternative.projected, candidate.proposal) : coarseCandidateTargetProgress(item, candidate), contentProgress: candidate.progress, visualLoad: candidate.weight }];
      }),
    } };
  });
  // Retain the unobstructed incumbent as an exact comparison, so a cheap
  // prediction cannot silently discard the previous gravity-first choice.
  const incumbentIndex = projectedAlternatives.findIndex((alternative) => alternative.unobstructedPreferred);
  const exactOrder = [...new Set([0, incumbentIndex, ...configurations.map((_, index) => index)])].filter((index) => index >= 0);
  return { ...configurations[0]!, alternatives: exactOrder.map((index) => configurations[index]!) };
}

/** Compatibility seam for callers that need only the selected assignment. */
export function assignCoarseInsertionProposals(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  estimate: CoarseGeometryEstimate,
  current: ReadonlyMap<string, PlannedInsertion>,
): Map<string, PlannedInsertion> {
  return planCoarseInsertionAssignments(document, metrics, template, estimate, current).proposals;
}

/** Report insertion content that could not be assigned without weakening route or order constraints. */
export function unassignedCoarseInsertionItems(
  document: CompositionDocument,
  template: CompositionLayout,
  assigned: ReadonlyMap<string, PlannedInsertion>,
  estimate?: CoarseGeometryEstimate,
): CoarseUnassignedInsertion[] {
  const unassigned: CoarseUnassignedInsertion[] = [];
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    const route = template.routes[flowId];
    if (!route?.insertionSlots?.length) continue;
    for (const block of insertionBlocksForFlow(template, flowId, flow.blocks)) {
      if (assigned.has(insertionKey(flowId, block.id))) continue;
      const candidates = insertionSlotCandidates(template, route, flowId, block);
      const legalCandidateCount = candidates.length;
      const sourceRelations = candidates.flatMap((candidate) => {
        const definition = routeLayout(route, template, candidate.page)?.slots.find((slot) => slot.id === candidate.slotId);
        if (!definition) return [];
        const source = resolvePlacementPolicy(template, flowId, block, definition).source;
        return source?.strength === 'require-same-page' ? [{ source, page: candidate.page }] : [];
      });
      const sourcePages = new Set(estimate?.contentMass
        .filter((mass) => sourceRelations.some(({ source }) => source.flowId === 'main' && source.blockId === mass.blockId))
        .map((mass) => mass.page) ?? []);
      const sourceRelationConflict = sourceRelations.length === candidates.length
        && sourceRelations.length > 0
        && sourcePages.size > 0
        && sourceRelations.every(({ page }) => !sourcePages.has(page))
        ? {
          flowId: sourceRelations[0]!.source.flowId,
          blockId: sourceRelations[0]!.source.blockId,
          strength: 'require-same-page' as const,
          estimatedSourcePages: [...sourcePages].sort((left, right) => left - right),
          candidatePages: [...new Set(sourceRelations.map(({ page }) => page))].sort((left, right) => left - right),
        }
        : undefined;
      const candidatePages = [...new Set(candidates.map((candidate) => candidate.page))].sort((left, right) => left - right);
      const flowAssignments = [...assigned.values()].filter((proposal) => proposal.flowId === flowId);
      const anchorPage = flowAssignments.map((proposal) => proposal.page).sort((left, right) => left - right)[0];
      const assignedSlotKeys = new Set([...assigned.values()].map((proposal) => `${proposal.page}:${proposal.slotId}`));
      const continuationPolicyConflict = !sourceRelationConflict
        && route.continuation === 'forbidden'
        && route.repeat !== 'each-page'
        && anchorPage !== undefined
        && candidates.some((candidate) => candidate.page > anchorPage)
        && candidates.filter((candidate) => candidate.page === anchorPage)
          .every((candidate) => assignedSlotKeys.has(`${candidate.page}:${candidate.slotId}`))
        ? { anchorPage, candidatePages }
        : undefined;
      unassigned.push({
        flowId,
        blockId: block.id,
        legalCandidateCount,
        reason: sourceRelationConflict ? 'source-relation-conflict' : continuationPolicyConflict ? 'continuation-policy-conflict' : legalCandidateCount === 0 ? 'no-legal-candidate' : 'capacity-or-order-conflict',
        ...(sourceRelationConflict ? { sourceRelationConflict } : {}),
        ...(continuationPolicyConflict ? { continuationPolicyConflict } : {}),
      });
    }
  }
  return unassigned;
}

function estimatedTextLineWordCounts(
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  width: number,
  startWord: number,
): number[] {
  const words = wordsForBlock(block);
  if (words.length <= startWord) return [];
  const leading = lineHeight(metrics, block);
  // Reuse the exact line measurement contract without retaining line boxes in
  // the coarse plan. This keeps inline runs, indentation, trailing marks and
  // renderer ink bounds in sync while the estimate still stores rectangles.
  return wrapBlock(
    metrics,
    block,
    startWord,
    { x: 0, y: 0, width, height: Number.MAX_VALUE },
    0,
    Number.MAX_VALUE,
    [],
    leading,
  ).map((line) => line.endWord - line.startWord);
}

function estimatedBlockHeight(
  block: CompositionBlock,
  metrics: CompositionTextMetrics,
  width: number,
  regionHeight: number,
  includeTextPadding = true,
  startWord = 0,
): { height?: number; words: number; lineWordCounts?: number[]; uncertainty: CoarseContentMass['uncertainty'] } {
  if (block.kind === 'table') {
    const rows = Math.max(1, block.table?.body.length ?? 1);
    return { height: rows * lineHeight(metrics, block), words: rows, uncertainty: 'text-width-estimate' };
  }
  if ((block.atomic === true || ['image', 'metric', 'chart', 'lockup'].includes(block.kind)) && metrics.measureBlock) {
    const measured = metrics.measureBlock(block, { x: 0, y: 0, width, height: regionHeight });
    return { height: measured.height, words: 1, uncertainty: 'renderer-block-measurement' };
  }
  if (block.atomic === true || ['image', 'metric', 'chart', 'lockup'].includes(block.kind)) {
    return { words: 1, uncertainty: 'renderer-block-measurement' };
  }
  const words = wordsForBlock(block);
  if (words.length <= startWord) return { height: 0, words: 0, lineWordCounts: [], uncertainty: 'text-width-estimate' };
  const lineWordCounts = estimatedTextLineWordCounts(block, metrics, width, startWord);
  const padding = textPadding(metrics, block);
  return {
    height: lineWordCounts.length * lineHeight(metrics, block)
      + (includeTextPadding ? padding.top + padding.bottom : 0),
    words: words.length - startWord,
    lineWordCounts,
    uncertainty: 'text-width-estimate',
  };
}

/** Check the existing main-flow route contract before counting a block in a coarse region. */
function coarseRegionAcceptsMainBlock(
  template: CompositionLayout,
  region: CoarseMainRegion,
  block: CompositionBlock,
): boolean {
  const route = template.routes.main;
  const layout = route && routeLayout(route, template, region.page);
  if (!route || !layout) return false;
  const routeIndex = route.slots.indexOf(region.slotId);
  if (routeIndex < 0) return false;
  const definition = layout.slots.find((slot) => slot.id === region.slotId);
  if (!definition || (definition.firstPageOnly && region.page > (layout.firstPageNumber ?? 1))) return false;
  return slotFor(layout, route.slots, routeIndex, 'main', block)?.definition.id === region.slotId;
}

function mainRegions(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
): { regions: CoarseRegion[]; dynamicReservations: CoarseDynamicReservation[]; missingMeasurements: CoarseMissingMeasurement[] } {
  const route = template.routes.main;
  if (!route) return { regions: [], dynamicReservations: [], missingMeasurements: [] };
  const regions: CoarseRegion[] = [];
  const dynamicReservations: CoarseDynamicReservation[] = [];
  const missingMeasurements: CoarseMissingMeasurement[] = [];
  const firstPage = route.startPage ?? 1;
  for (let page = firstPage; page <= template.maxPages; page += 1) {
    const layout = routeLayout(route, template, page);
    if (!layout) continue;
    const mainSlotIds = routeSlots(route, layout);
    for (const id of mainSlotIds) {
      const definition = layout.slots.find((slot) => slot.id === id);
      if (!definition) continue;
      const firstPageContentSlot = page === (layout.firstPageNumber ?? 1)
        && layout.firstPageContentTop !== undefined
        && layout.firstPageContentSlotIds?.includes(definition.id);
      const box = firstPageContentSlot
        ? { ...definition.box, y: layout.firstPageContentTop!, height: Math.max(0, definition.box.y + definition.box.height - layout.firstPageContentTop!) }
        : { ...definition.box };
      regions.push({ page, slotId: id, box });
    }

    const leadFlows = Object.entries(document.flows)
      .filter(([flowId]) => flowId !== 'main')
      .map(([flowId, flow]) => ({ flowId, flow, route: template.routes[flowId] }))
      .filter((item) => item.route !== undefined && (item.route.insertionSlots?.length ?? 0) === 0)
      .filter((item) => item.route!.repeat === 'each-page' || page === (item.route!.startPage ?? 1))
      .sort((left, right) => (right.route!.priority ?? 0) - (left.route!.priority ?? 0));
    for (const { flowId, flow, route: flowRoute } of leadFlows) {
      const flowLayout = routeLayout(flowRoute!, template, page);
      const pushingSlots = flowRoute!.slots
        .map((slotId) => flowLayout?.slots.find((slot) => slot.id === slotId))
        .filter((slot) => slot?.grow?.axis === 'y'
          && (slot.grow.pushes ?? []).some((target) => mainSlotIds.includes(target)));
      for (const pushingSlot of pushingSlots) {
        if (!pushingSlot?.grow) continue;
        const acceptedBlocks = flow.blocks.filter((block) =>
          (!pushingSlot.allowedRoles || pushingSlot.allowedRoles.includes(block.role))
          && (!pushingSlot.allowedBlockIds || pushingSlot.allowedBlockIds.some((id) => block.id === id || block.id.startsWith(`${id}:`)))
          && (!pushingSlot.allowedBlockKinds || pushingSlot.allowedBlockKinds.includes(block.kind)));
        let estimatedHeight = 0;
        let previousBlock: CompositionBlock | undefined;
        let isMeasurable = true;
        for (const block of acceptedBlocks) {
          const measured = estimatedBlockHeight(block, metrics, pushingSlot.box.width, pushingSlot.grow.maxHeight);
          if (measured.height === undefined) {
            missingMeasurements.push({ blockId: block.id, page, slotId: pushingSlot.id, reason: 'atomic-block-height-metric-unavailable' });
            isMeasurable = false;
            break;
          }
          estimatedHeight += (previousBlock ? metrics.blockGap?.(styleFor(previousBlock), styleFor(block)) ?? 0 : 0)
            + measured.height;
          previousBlock = block;
        }
        if (!isMeasurable || acceptedBlocks.length === 0) continue;
        const requestedBottom = pushingSlot.fitContent
          ? Math.max(pushingSlot.box.y, pushingSlot.box.y + estimatedHeight)
          : Math.max(pushingSlot.box.y + pushingSlot.box.height, pushingSlot.box.y + estimatedHeight);
        const grownBottom = Math.min(pushingSlot.box.y + pushingSlot.grow.maxHeight, requestedBottom);
        const displacement = Math.max(0, grownBottom - (pushingSlot.box.y + pushingSlot.box.height));
        if (displacement <= Number.EPSILON) continue;
        const displacedMainSlotIds = (pushingSlot.grow.pushes ?? []).filter((target) => mainSlotIds.includes(target));
        for (const region of regions) {
          if (region.page !== page || !displacedMainSlotIds.includes(region.slotId)) continue;
          region.box = { ...region.box, y: region.box.y + displacement, height: Math.max(0, region.box.height - displacement) };
        }
        dynamicReservations.push({ flowId, page, slotId: pushingSlot.id, displacedMainSlotIds, estimatedHeight, displacement });
      }
    }
  }
  return { regions, dynamicReservations, missingMeasurements };
}

/** Cut insertion spans from text regions and push aggregate mass forward once. */
/** Locate policy-sensitive text bands using measured word/line boundaries, not glyph rectangles. */
function calculateCoarseBreakSensitiveRegions(masses: CoarseContentMass[], minimumLines: number): CoarseBreakSensitiveRegion[] {
  return masses.flatMap((mass, index): CoarseBreakSensitiveRegion[] => {
    const context = { blockId: mass.blockId, blockIds: [mass.blockId], page: mass.page, slotId: mass.slotId };
    if (mass.atomic) return [{ ...context, box: mass.box, startWord: mass.startWord, endWord: mass.endWord, rule: 'atomic-block', severity: 'hard' }];
    if (mass.keepWithNextHeight !== undefined && mass.startWord === mass.blockStartWord) {
      const following = masses[index + 1];
      const followingWords = following?.lineWordCounts?.slice(0, mass.keepWithNextLines).reduce((sum, words) => sum + words, 0);
      return [{
        ...context, box: { ...mass.box, height: mass.box.height + mass.keepWithNextHeight },
        ...(following && followingWords !== undefined && following.startWord === mass.endWord
          ? { blockIds: [mass.blockId, following.blockId], endWord: following.startWord + followingWords } : { endWord: mass.endWord }),
        startWord: mass.startWord, rule: 'heading-following-lines', severity: 'hard',
      }];
    }
    if (mass.blockKind !== 'paragraph' || mass.lineWordCounts === undefined || mass.lineHeight === undefined) return [];
    const count = Math.min(minimumLines, mass.lineWordCounts.length);
    const height = count * mass.lineHeight;
    const regions: CoarseBreakSensitiveRegion[] = [];
    if (mass.startWord === mass.blockStartWord) regions.push({
      ...context, box: { ...mass.box, height }, startWord: mass.startWord,
      endWord: mass.startWord + mass.lineWordCounts.slice(0, count).reduce((sum, words) => sum + words, 0),
      rule: 'paragraph-edge-lines', severity: 'soft', minimumFragmentLines: minimumLines,
    });
    if (mass.endWord === mass.blockEndWord) regions.push({
      ...context, box: { ...mass.box, y: mass.box.y + mass.box.height - height, height },
      startWord: mass.endWord - mass.lineWordCounts.slice(-count).reduce((sum, words) => sum + words, 0), endWord: mass.endWord,
      rule: 'paragraph-edge-lines', severity: 'soft', minimumFragmentLines: minimumLines,
    });
    return regions;
  });
}

/** Estimate additional break cost relative to the unobstructed flow; exact evaluation stays with the engine. */
export function assessCoarseProjection(baseline: CoarseGeometryEstimate, projected: CoarseGeometryEstimate, config = readRenderConfig()): CoarseProjectionAssessment {
  const baselineCuts = new Set(baseline.contentMass.filter((mass) => mass.endWord < mass.blockEndWord).map((mass) => `${mass.blockId}:${mass.endWord}`));
  const newCuts = projected.contentMass.filter((mass) => mass.endWord < mass.blockEndWord && !baselineCuts.has(`${mass.blockId}:${mass.endWord}`));
  const fragmentedParagraphs = new Set(newCuts.filter((mass) => mass.blockKind === 'paragraph').map((mass) => mass.blockId));
  const sensitiveCuts = newCuts.flatMap((mass): CoarseProjectionAssessment['sensitiveCuts'] => {
    const sensitive = baseline.breakSensitiveRegions.find((region) => region.blockIds.includes(mass.blockId)
      && mass.endWord > region.startWord && mass.endWord < region.endWord);
    if (!sensitive) return [];
    const estimatedPenalty = sensitive.rule === 'paragraph-edge-lines'
      ? config.compositionScore.orphanPenalty : config.compositionScore.headingFollowingLineBonus;
    return [{ blockId: mass.blockId, page: mass.page, slotId: mass.slotId, box: mass.box,
      cutWord: mass.endWord, rule: sensitive.rule, estimatedPenalty }];
  });
  return {
    newCutCount: newCuts.length,
    estimatedBreakPenalty: fragmentedParagraphs.size * config.compositionScore.paragraphFragmentationPenalty
      + sensitiveCuts.reduce((sum, cut) => sum + cut.estimatedPenalty, 0),
    unplacedWordCount: projected.unplacedWordCount,
    sensitiveCuts,
  };
}

export function projectCoarseInsertionDisplacement(
  estimate: CoarseGeometryEstimate,
  template: CompositionLayout,
  insertionProposals: ReadonlyMap<string, { flowId?: string; page: number; slotId: string; box: CompositionRect }>,
): CoarseGeometryEstimate {
  const regions = estimate.regions;
  const blocked = new Map<string, Array<{ obstacleStart: number; obstacleEnd: number }>>();
  for (const region of regions) {
    const route = template.routes.main;
    const layout = route ? routeLayout(route, template, region.page) : undefined;
    const mainSlotIds = new Set(route?.slots ?? []);
    const insertionSlotIds = new Set(Object.entries(template.routes)
      .flatMap(([flowId, insertionRoute]) => flowId === 'main' ? [] : insertionRoute.insertionSlots ?? []));
    const fixedSlots = (layout?.slots ?? [])
      .filter((slot) => !mainSlotIds.has(slot.id)
        && !insertionSlotIds.has(slot.id)
        && (slot.reserved === true || slot.kind === 'graphic' || (slot.flowId !== undefined && slot.flowId !== 'main')))
      .map((slot) => ({ flowId: undefined, page: region.page, slotId: slot.id, box: slot.box }));
    const insertionObstacles = [...insertionProposals.values()]
      .filter((proposal) => proposal.page === region.page)
      .map((proposal) => ({ ...proposal }));
    const spans = [...insertionObstacles, ...fixedSlots]
      .flatMap((proposal) => {
        const left = proposal.box.x;
        const right = proposal.box.x + proposal.box.width;
        if (left >= region.box.x + region.box.width || right <= region.box.x) return [];
        return [{
          obstacleStart: Math.max(region.box.y, proposal.box.y),
          obstacleEnd: Math.min(region.box.y + region.box.height, proposal.box.y + proposal.box.height),
        }];
      })
      .filter((span) => span.obstacleEnd > span.obstacleStart)
      .sort((left, right) => left.obstacleStart - right.obstacleStart);
    blocked.set(`${region.page}:${region.slotId}`, spans);
  }

  const cursors = regions.map((region) => region.box.y);
  const regionIndexByKey = new Map(regions.map((region, index) => [`${region.page}:${region.slotId}`, index]));
  const projected: CoarseContentMass[] = [];
  let regionIndex = 0;
  let unplacedWordCount = estimate.unplacedWordCount;
  let displacedWordCount = 0;
  let lastProjectedRegionIndex: number | undefined;
  let lastProjectedBlockId: string | undefined;
  const maxPushSteps = regions.length + [...blocked.values()].reduce((sum, spans) => sum + spans.length, 0) + 1;
  for (const source of estimate.contentMass) {
    const sourceRegionIndex = regionIndexByKey.get(`${source.page}:${source.slotId}`);
    // Preserve the measured break between source regions. Spare room left by a
    // widow/orphan adjustment must not pull a later fragment back into the
    // preceding column when this pass projects text a second time.
    if (sourceRegionIndex !== undefined) regionIndex = Math.max(regionIndex, sourceRegionIndex);
    let leadingGapPending = source.blockId !== lastProjectedBlockId;
    if (source.lineWordCounts && source.lineHeight !== undefined && source.lineHeight > 0) {
      let lineIndex = 0;
      let wordCursor = source.startWord;
      let attempts = 0;
      const maxLinePushSteps = source.lineWordCounts.length * (regions.length + 1)
        + [...blocked.values()].reduce((sum, spans) => sum + spans.length, 0) + 1;
      while (lineIndex < source.lineWordCounts.length && regionIndex < regions.length && attempts < maxLinePushSteps) {
        attempts += 1;
        const region = regions[regionIndex]!;
        const spans = blocked.get(`${region.page}:${region.slotId}`) ?? [];
        let cursor = cursors[regionIndex]!;
        const obstruction = spans.find((span) => cursor >= span.obstacleStart && cursor < span.obstacleEnd);
        if (obstruction) {
          cursor = obstruction.obstacleEnd;
          cursors[regionIndex] = cursor;
          lastProjectedRegionIndex = undefined;
          continue;
        }
        const clusterHeight = source.keepWithNextHeight ?? 0;
        if (lineIndex === 0 && clusterHeight > 0) {
          const nextObstruction = spans.find((span) => span.obstacleStart > cursor);
          const availableEnd = Math.min(region.box.y + region.box.height, nextObstruction?.obstacleStart ?? Number.POSITIVE_INFINITY);
          const requiredClusterHeight = (source.leadingGap ?? 0)
            + source.lineWordCounts.length * source.lineHeight
            + clusterHeight;
          const fitTolerance = Number.EPSILON * Math.max(1, Math.abs(requiredClusterHeight), Math.abs(availableEnd - cursor)) * 1024;
          if (availableEnd - cursor + fitTolerance < requiredClusterHeight) {
            if (nextObstruction) {
              cursors[regionIndex] = nextObstruction.obstacleEnd;
            } else {
              regionIndex += 1;
            }
            lastProjectedRegionIndex = undefined;
            continue;
          }
        }
        if (leadingGapPending) {
          const gap = source.leadingGap ?? 0;
          const nextObstruction = spans.find((span) => span.obstacleStart > cursor);
          const canKeepGap = lastProjectedRegionIndex === regionIndex
            && gap > 0
            && cursor + gap <= region.box.y + region.box.height
            && (nextObstruction === undefined || cursor + gap <= nextObstruction.obstacleStart);
          if (canKeepGap) cursor += gap;
          leadingGapPending = false;
        }
        const nextObstruction = spans.find((span) => span.obstacleStart > cursor);
        const availableEnd = Math.min(region.box.y + region.box.height, nextObstruction?.obstacleStart ?? Number.POSITIVE_INFINITY);
        const availableHeight = Math.max(0, availableEnd - cursor);
        const lineFitTolerance = Number.EPSILON * Math.max(1, Math.abs(availableHeight), Math.abs(source.lineHeight)) * 1024;
        const fittingLines = Math.min(
          source.lineWordCounts.length - lineIndex,
          Math.max(0, Math.floor((availableHeight + lineFitTolerance) / source.lineHeight)),
        );
        if (fittingLines === 0) {
          if (nextObstruction) {
            cursors[regionIndex] = nextObstruction.obstacleEnd;
            lastProjectedRegionIndex = undefined;
          } else {
            regionIndex += 1;
            lastProjectedRegionIndex = undefined;
          }
          continue;
        }
        const placedLineWordCounts = source.lineWordCounts.slice(lineIndex, lineIndex + fittingLines);
        const placedWords = placedLineWordCounts.reduce((sum, lineWords) => sum + lineWords, 0);
        const placedHeight = fittingLines * source.lineHeight;
        const box = { x: region.box.x, y: cursor, width: region.box.width, height: placedHeight };
        projected.push({
          ...source,
          page: region.page,
          slotId: region.slotId,
          box,
          startWord: wordCursor,
          endWord: wordCursor + placedWords,
          lineWordCounts: placedLineWordCounts,
        });
        if (region.page !== source.page || Math.abs(box.y - source.box.y) > Number.EPSILON) displacedWordCount += placedWords;
        cursors[regionIndex] = cursor + placedHeight;
        lastProjectedRegionIndex = regionIndex;
        lastProjectedBlockId = source.blockId;
        wordCursor += placedWords;
        lineIndex += fittingLines;
        if (cursors[regionIndex]! >= region.box.y + region.box.height - Number.EPSILON) {
          regionIndex += 1;
          lastProjectedRegionIndex = undefined;
        }
      }
      if (lineIndex < source.lineWordCounts.length) {
        unplacedWordCount += source.lineWordCounts.slice(lineIndex).reduce((sum, lineWords) => sum + lineWords, 0);
      }
      continue;
    }
    let heightRemaining = source.box.height;
    let wordsRemaining = Math.max(0, source.endWord - source.startWord);
    let wordCursor = source.startWord;
    let attempts = 0;
    while ((heightRemaining > Number.EPSILON || wordsRemaining > 0) && regionIndex < regions.length && attempts < maxPushSteps) {
      attempts += 1;
      const region = regions[regionIndex]!;
      const spans = blocked.get(`${region.page}:${region.slotId}`) ?? [];
      let cursor = cursors[regionIndex]!;
      const obstruction = spans.find((span) => cursor >= span.obstacleStart && cursor < span.obstacleEnd);
      if (obstruction && cursor < obstruction.obstacleEnd) {
        cursor = Math.max(cursor, obstruction.obstacleEnd);
        cursors[regionIndex] = cursor;
        lastProjectedRegionIndex = undefined;
      }
      if (leadingGapPending) {
        const gap = source.leadingGap ?? 0;
        const nextObstruction = spans.find((span) => span.obstacleStart > cursor);
        const canKeepGap = lastProjectedRegionIndex === regionIndex
          && gap > 0
          && cursor + gap <= region.box.y + region.box.height
          && (nextObstruction === undefined || cursor + gap <= nextObstruction.obstacleStart);
        if (canKeepGap) cursor += gap;
        leadingGapPending = false;
      }
      const nextObstruction = spans.find((span) => span.obstacleStart > cursor);
      const availableEnd = Math.min(region.box.y + region.box.height, nextObstruction?.obstacleStart ?? Number.POSITIVE_INFINITY);
      const availableHeight = Math.max(0, availableEnd - cursor);
      if (availableHeight <= Number.EPSILON) {
        regionIndex += 1;
        continue;
      }
      const placedHeight = Math.min(heightRemaining, availableHeight);
      const placedWords = wordsRemaining === 0
        ? 0
        : Math.min(wordsRemaining, placedHeight >= heightRemaining ? wordsRemaining : Math.max(1, Math.floor(wordsRemaining * placedHeight / Math.max(heightRemaining, Number.EPSILON))));
      const box = { x: region.box.x, y: cursor, width: region.box.width, height: placedHeight };
      projected.push({
        ...source,
        page: region.page,
        slotId: region.slotId,
        box,
        startWord: wordCursor,
        endWord: wordCursor + placedWords,
      });
      if (region.page !== source.page || Math.abs(box.y - source.box.y) > Number.EPSILON) displacedWordCount += placedWords;
      cursor += placedHeight;
      cursors[regionIndex] = cursor;
      lastProjectedRegionIndex = regionIndex;
      lastProjectedBlockId = source.blockId;
      heightRemaining -= placedHeight;
      wordsRemaining -= placedWords;
      wordCursor += placedWords;
      if (cursors[regionIndex]! >= region.box.y + region.box.height - Number.EPSILON) {
        regionIndex += 1;
        lastProjectedRegionIndex = undefined;
      }
    }
    if (wordsRemaining > 0) unplacedWordCount += wordsRemaining;
  }

  const totalWords = Math.max(1, ...projected.map((mass) => mass.endWord));
  const pageRanges = new Map<number, { start: number; end: number; occupiedHeight: number; capacityHeight: number }>();
  for (const mass of projected) {
    const range = pageRanges.get(mass.page) ?? { start: mass.startWord, end: mass.endWord, occupiedHeight: 0, capacityHeight: 0 };
    range.start = Math.min(range.start, mass.startWord);
    range.end = Math.max(range.end, mass.endWord);
    range.occupiedHeight += mass.box.height;
    pageRanges.set(mass.page, range);
  }
  for (const region of regions) {
    const range = pageRanges.get(region.page) ?? { start: totalWords, end: totalWords, occupiedHeight: 0, capacityHeight: 0 };
    range.capacityHeight += region.box.height;
    pageRanges.set(region.page, range);
  }
  const mainProgressByPage = new Map<number, CoarseMainPageProgress>();
  for (const [page, range] of pageRanges) {
    const start = range.start / totalWords;
    const end = range.end / totalWords;
    mainProgressByPage.set(page, { page, start, end, center: (start + end) / 2, occupiedHeight: range.occupiedHeight, capacityHeight: range.capacityHeight });
  }
  return {
    regions,
    dynamicReservations: estimate.dynamicReservations,
    mainProgressByPage,
    contentMass: projected,
    blockMeasurements: estimate.blockMeasurements,
    breakSensitiveRegions: calculateCoarseBreakSensitiveRegions(projected, estimate.minimumLinesAtEnd),
    minimumLinesAtEnd: estimate.minimumLinesAtEnd,
    missingMeasurements: estimate.missingMeasurements,
    ...(projected.length === 0 ? {} : { terminalPage: Math.max(...projected.map((mass) => mass.page)) }),
    unplacedWordCount,
    displacedWordCount,
  };
}

/** Estimate aggregate main-flow rectangles before movable insertion obstacles are applied. */
export function estimateCoarseMainGeometry(
  document: CompositionDocument,
  metrics: CompositionTextMetrics,
  template: CompositionLayout,
  configuredMinimumLinesAtEnd = readRenderConfig().pdf.orphanMinLines,
): CoarseGeometryEstimate {
  const regionEstimate = mainRegions(document, metrics, template);
  const regions = regionEstimate.regions;
  const blocks = document.flows.main?.blocks ?? [];
  const totalWords = Math.max(1, blocks.reduce((sum, block) => sum + coarseMassUnitCount(block), 0));
  const remainingByRegion = regions.map((region) => ({ ...region, cursor: region.box.y, bottom: region.box.y + region.box.height }));
  const contentMass: CoarseContentMass[] = [];
  const blockMeasurements = new Map<string, CoarseBlockMeasurement>();
  const missingMeasurements: CoarseMissingMeasurement[] = [...regionEstimate.missingMeasurements];
  let regionIndex = 0;
  let consumedWords = 0;
  let unplacedWordCount = 0;
  let previousBlock: CompositionBlock | undefined;
  let previousBlockLastRegionKey: string | undefined;
  const pageRanges = new Map<number, { start: number; end: number; occupiedHeight: number; capacityHeight: number }>();

  for (const [blockIndex, block] of blocks.entries()) {
    const sourceWords = coarseMassUnitCount(block);
    if (sourceWords === 0) continue;
    let remainingWords = sourceWords;
    let leadingGapPending = true;
    while (remainingWords > 0 && regionIndex < remainingByRegion.length) {
      const region = remainingByRegion[regionIndex]!;
      if (!coarseRegionAcceptsMainBlock(template, region, block)) {
        regionIndex += 1;
        continue;
      }
      const regionKey = `${region.page}:${region.slotId}`;
      const verticalGap = leadingGapPending
        ? (previousBlock && previousBlockLastRegionKey === regionKey
          ? metrics.blockGap?.(styleFor(previousBlock), styleFor(block)) ?? 0
          : 0)
        : 0;
      const blockWordOffset = sourceWords - remainingWords;
      const measurementKey = `${block.id}:${region.box.width}`;
      if (!blockMeasurements.has(measurementKey)) {
        const unbroken = estimatedBlockHeight(block, metrics, region.box.width, region.box.height, false, 0);
        if (unbroken.height !== undefined) blockMeasurements.set(measurementKey, {
          blockId: block.id, width: region.box.width, unbrokenHeight: unbroken.height,
          ...(unbroken.lineWordCounts === undefined ? {} : { lineCount: unbroken.lineWordCounts.length }),
          uncertainty: unbroken.uncertainty,
        });
      }
      const measured = estimatedBlockHeight(block, metrics, region.box.width, region.box.height, false, blockWordOffset);
      if (measured.height === undefined) {
        missingMeasurements.push({ blockId: block.id, page: region.page, slotId: region.slotId, reason: 'atomic-block-height-metric-unavailable' });
        unplacedWordCount += remainingWords;
        remainingWords = 0;
        break;
      }
      const available = Math.max(0, region.bottom - region.cursor - verticalGap);
      const nextBlock = blocks[blockIndex + 1];
      const keepLines = block.kind === 'heading'
        ? block.keepWithNextLines ?? template.headingKeepWithNextLines ?? 0
        : 0;
      const keepWithNextHeight = keepLines > 0 && nextBlock
        ? (metrics.blockGap?.(styleFor(block), styleFor(nextBlock)) ?? 0)
          + lineHeight(metrics, nextBlock) * keepLines
        : 0;
      if (keepLines > 0 && nextBlock) {
        const requiredClusterHeight = verticalGap + measured.height + keepWithNextHeight;
        if (available < requiredClusterHeight) {
          regionIndex += 1;
          continue;
        }
      }
      const leading = lineHeight(metrics, block);
      let placedHeight: number;
      let wordsInPiece: number;
      let placedLineWordCounts: number[] | undefined;
      if (measured.lineWordCounts) {
        const lineFitTolerance = Number.EPSILON * Math.max(1, Math.abs(available), Math.abs(leading)) * 1024;
        let fittingLines = Math.min(measured.lineWordCounts.length, Math.max(0, Math.floor((available + lineFitTolerance) / leading)));
        const remainingLines = measured.lineWordCounts.length - fittingLines;
        if (remainingLines > 0 && remainingLines < configuredMinimumLinesAtEnd) {
          fittingLines = Math.max(0, fittingLines - (configuredMinimumLinesAtEnd - remainingLines));
        }
        if (fittingLines === 0) {
          regionIndex += 1;
          continue;
        }
        placedLineWordCounts = measured.lineWordCounts.slice(0, fittingLines);
        placedHeight = fittingLines * leading;
        wordsInPiece = placedLineWordCounts.reduce((sum, lineWords) => sum + lineWords, 0);
      } else {
        const proportionalHeight = measured.height * (remainingWords / sourceWords);
        if (available <= 0) {
          regionIndex += 1;
          continue;
        }
        placedHeight = Math.min(available, proportionalHeight);
        wordsInPiece = placedHeight >= proportionalHeight - Number.EPSILON
          ? remainingWords
          : Math.min(remainingWords, Math.max(1, Math.floor(remainingWords * placedHeight / Math.max(proportionalHeight, Number.EPSILON))));
      }
      const startWord = consumedWords + (sourceWords - remainingWords);
      const endWord = startWord + wordsInPiece;
      const massBox = { x: region.box.x, y: region.cursor + verticalGap, width: region.box.width, height: placedHeight };
      contentMass.push({
        blockId: block.id,
        blockKind: block.kind,
        blockStartWord: consumedWords,
        blockEndWord: consumedWords + sourceWords,
        ...(block.atomic === true || ['image', 'metric', 'chart', 'lockup'].includes(block.kind) ? { atomic: true } : {}),
        page: region.page,
        slotId: region.slotId,
        box: massBox,
        startWord,
        endWord,
        ...(leadingGapPending && verticalGap > 0 ? { leadingGap: verticalGap } : {}),
        ...(leadingGapPending && keepWithNextHeight > 0 ? { keepWithNextHeight, keepWithNextLines: keepLines } : {}),
        uncertainty: measured.uncertainty,
        ...(placedLineWordCounts === undefined ? {} : { lineWordCounts: placedLineWordCounts, lineHeight: leading }),
      });
      const range = pageRanges.get(region.page) ?? { start: startWord, end: endWord, occupiedHeight: 0, capacityHeight: 0 };
      range.start = Math.min(range.start, startWord);
      range.end = Math.max(range.end, endWord);
      range.occupiedHeight += placedHeight + verticalGap;
      pageRanges.set(region.page, range);
      region.cursor += verticalGap + placedHeight;
      previousBlockLastRegionKey = regionKey;
      remainingWords -= wordsInPiece;
      leadingGapPending = false;
      if (remainingWords > 0 || region.cursor >= region.bottom) regionIndex += 1;
    }
    if (remainingWords > 0) unplacedWordCount += remainingWords;
    consumedWords += sourceWords;
    previousBlock = block;
  }

  for (const region of remainingByRegion) {
    const range = pageRanges.get(region.page) ?? { start: consumedWords, end: consumedWords, occupiedHeight: 0, capacityHeight: 0 };
    range.capacityHeight += region.box.height;
    pageRanges.set(region.page, range);
  }
  const mainProgressByPage = new Map<number, CoarseMainPageProgress>();
  for (const [page, range] of pageRanges) {
    const start = range.start / totalWords;
    const end = range.end / totalWords;
    mainProgressByPage.set(page, {
      page,
      start,
      end,
      center: (start + end) / 2,
      occupiedHeight: range.occupiedHeight,
      capacityHeight: range.capacityHeight,
    });
  }
  return {
    regions,
    dynamicReservations: regionEstimate.dynamicReservations,
    mainProgressByPage,
    contentMass,
    blockMeasurements: [...blockMeasurements.values()],
    breakSensitiveRegions: calculateCoarseBreakSensitiveRegions(contentMass, configuredMinimumLinesAtEnd),
    minimumLinesAtEnd: configuredMinimumLinesAtEnd,
    missingMeasurements,
    ...(contentMass.length === 0 ? {} : { terminalPage: Math.max(...contentMass.map((mass) => mass.page)) }),
    unplacedWordCount,
  };
}
