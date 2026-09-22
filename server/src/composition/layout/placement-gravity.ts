import { readRenderConfig } from '../../template/builtins.js';
import type {
  CompositionBlock,
  CompositionLayout,
  CompositionRect,
  CompositionSlotTemplate,
} from '../contracts/model.js';
import type { PlannedInsertion } from './planner-candidates.js';
import { routeLayout } from './page-state.js';
import { resolvePlacementPolicy, type ResolvedPlacementPolicy } from './placement-policy.js';

type GravityItem = {
  key: string;
  proposal: PlannedInsertion;
  block: CompositionBlock;
  slot: CompositionSlotTemplate;
  policy: ResolvedPlacementPolicy;
  region: CompositionRect;
  order: number;
  weight: number;
  sourceOrder?: number;
  sourceCount?: number;
};

type GravityAnchor = {
  page: number;
  box: CompositionRect;
  spacingProfile: CompositionSlotTemplate['spacingProfile'];
};

export interface PlacementGravityTrace {
  iterations: number;
  movedCount: number;
  maxDisplacement: number;
  groupCount: number;
  anchorCount: number;
  stoppedBy: 'converged' | 'budget' | 'no-movement';
}

export interface PlacementGravityResult {
  proposals: Map<string, PlannedInsertion>;
  trace: PlacementGravityTrace;
}

function unionVerticalRegion(slots: CompositionSlotTemplate[]): CompositionRect {
  const first = slots[0]?.box ?? { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...slots.map((slot) => slot.box.x));
  const right = Math.max(...slots.map((slot) => slot.box.x + slot.box.width));
  const top = Math.min(...slots.map((slot) => slot.box.y));
  const bottom = Math.max(...slots.map((slot) => slot.box.y + slot.box.height));
  return { x: Number.isFinite(left) ? left : first.x, y: Number.isFinite(top) ? top : first.y, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function slotForProposal(
  layout: CompositionLayout,
  proposal: PlannedInsertion,
  block: CompositionBlock,
): CompositionSlotTemplate | undefined {
  const route = layout.routes[proposal.flowId];
  if (!route) return undefined;
  const pageLayout = routeLayout(route, layout, proposal.page);
  const exact = pageLayout?.slots.find((slot) => slot.id === proposal.slotId);
  if (exact) return exact;
  return pageLayout?.slots.find((slot) => slot.placement?.mode === 'fluid-y'
    && slot.flowId === proposal.flowId
    && slot.allowedRoles?.includes(block.role));
}

export function regionForSlot(layout: CompositionLayout, proposal: PlannedInsertion, slot: CompositionSlotTemplate): CompositionRect {
  const route = layout.routes[proposal.flowId];
  const pageLayout = route ? routeLayout(route, layout, proposal.page) : undefined;
  const region = slot.placement?.mode === 'fluid-y' ? slot.placement.region : undefined;
  const candidates = pageLayout?.slots.filter((candidate) => candidate.placement?.mode === 'fluid-y'
    && candidate.placement.region === region
    && candidate.regionId === slot.regionId) ?? [slot];
  return unionVerticalRegion(candidates);
}

function blockOrder(
  document: { flows: Record<string, { blocks: CompositionBlock[] }> },
  proposal: PlannedInsertion,
  block: CompositionBlock,
): number {
  const index = document.flows[proposal.flowId]?.blocks.findIndex((candidate) => candidate.id === block.id);
  return index === undefined || index < 0 ? block.id.length : index;
}

function sourceBlockOrder(
  document: { flows: Record<string, { blocks: CompositionBlock[] }> },
  flowId: string,
  blockId: string,
): number | undefined {
  const index = document.flows[flowId]?.blocks.findIndex((candidate) => candidate.id === blockId);
  return index === undefined || index < 0 ? undefined : index;
}

/** Return the geometry-only visual-load weight used by gravity and diagnostics. */
export function visualLoadWeightForPlacement(box: CompositionRect, region: CompositionRect): number {
  const regionArea = Math.max(1, region.width * region.height);
  const areaShare = (box.width * box.height) / regionArea;
  const heightShare = box.height / Math.max(1, region.height);
  const score = readRenderConfig().compositionScore;
  const weightedLoad = areaShare * score.visualLoadAreaWeight
    + heightShare * score.visualLoadVerticalWeight;
  return 1 + weightedLoad;
}

function spacingTarget(profile: CompositionSlotTemplate['spacingProfile']): number {
  const score = readRenderConfig().compositionScore;
  if (profile === 'compact') return score.spacingProfileCompactTargetMm;
  if (profile === 'open') return score.spacingProfileOpenTargetMm;
  return score.spacingProfileNormalTargetMm;
}

function groupKey(item: GravityItem): string {
  return `${item.proposal.page}:${item.slot.regionId}:${item.policy.rhythmGroup ?? item.proposal.flowId}`;
}

function eligibleItems(
  layout: CompositionLayout,
  document: { flows: Record<string, { blocks: CompositionBlock[] }> },
  proposals: Map<string, PlannedInsertion>,
): GravityItem[] {
  const items: GravityItem[] = [];
  for (const [key, proposal] of proposals) {
    const block = document.flows[proposal.flowId]?.blocks.find((candidate) => candidate.id === proposal.blockId);
    const slot = block ? slotForProposal(layout, proposal, block) : undefined;
    if (!block || !slot || slot.placement?.mode !== 'fluid-y') continue;
    const policy = resolvePlacementPolicy(layout, proposal.flowId, block, slot);
    if (policy.distribution === 'free') continue;
    const region = regionForSlot(layout, proposal, slot);
    items.push({
      key,
      proposal,
      block,
      slot,
      policy,
      region,
      order: blockOrder(document, proposal, block),
      weight: visualLoadWeightForPlacement(proposal.box, region),
      ...(policy.source
        ? {
          sourceOrder: sourceBlockOrder(document, policy.source.flowId, policy.source.blockId),
          sourceCount: document.flows[policy.source.flowId]?.blocks.length,
        }
        : {}),
    });
  }
  return items;
}

function sourceTargetY(item: GravityItem): number | undefined {
  if (item.sourceOrder === undefined || !item.sourceCount || item.sourceCount <= 0) return undefined;
  const progress = (item.sourceOrder + 0.5) / item.sourceCount;
  return item.region.y + item.region.height * progress - item.proposal.box.height / 2;
}

function desiredPositions(items: GravityItem[]): Map<string, number> {
  const targets = new Map<string, number>();
  const grouped = new Map<string, GravityItem[]>();
  for (const item of items) grouped.set(groupKey(item), [...(grouped.get(groupKey(item)) ?? []), item]);
  for (const group of grouped.values()) {
    const ordered = [...group].sort((left, right) => left.proposal.box.y - right.proposal.box.y || left.order - right.order || left.key.localeCompare(right.key));
    const region = unionVerticalRegion(ordered.map((item) => item.slot));
    const totalHeight = ordered.reduce((sum, item) => sum + item.proposal.box.height, 0);
    const distributedGap = Math.max(0, (region.height - totalHeight) / (ordered.length + 1));
    const clusteredGap = Math.min(...ordered.map((item) => spacingTarget(item.slot.spacingProfile)));
    const clustered = ordered.every((item) => item.policy.distribution === 'clustered');
    let cursor = region.y + (clustered ? 0 : distributedGap);
    for (const item of ordered) {
      const sourceTarget = sourceTargetY(item);
      const search = readRenderConfig().compositionSearch;
      const relationWeight = item.policy.source?.strength === 'require-same-page'
        ? search.gravitySourceRequireWeight
        : search.gravitySourcePreferWeight;
      const target = sourceTarget === undefined
        ? cursor
        : cursor + (sourceTarget - cursor) * relationWeight;
      targets.set(item.key, Math.max(region.y, Math.min(region.y + region.height - item.proposal.box.height, target)));
      cursor = target + item.proposal.box.height + (clustered ? clusteredGap : distributedGap);
    }
  }
  return targets;
}

function clampY(item: GravityItem, y: number): number {
  const minimum = item.region.y;
  const maximum = item.region.y + item.region.height - item.proposal.box.height;
  return Math.max(minimum, Math.min(maximum, y));
}

function fixedGravityAnchors(layout: CompositionLayout): GravityAnchor[] {
  const anchors: GravityAnchor[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= layout.maxPages; page += 1) {
    for (const [flowId, route] of Object.entries(layout.routes)) {
      if (flowId === 'main') continue;
      const pageLayout = routeLayout(route, layout, page);
      for (const slotId of route.slots) {
        const slot = pageLayout?.slots.find((candidate) => candidate.id === slotId);
        if (!slot || slot.placement?.mode === 'fluid-y') continue;
        const key = `${page}:${slot.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        anchors.push({ page, box: { ...slot.box }, spacingProfile: slot.spacingProfile });
      }
    }
    const pageLayout = routeLayout({ slots: [], continuation: 'allowed' }, layout, page);
    for (const slot of pageLayout?.slots ?? []) {
      if (slot.kind !== 'graphic' || slot.placement?.mode === 'fluid-y') continue;
      const key = `${page}:${slot.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ page, box: { ...slot.box }, spacingProfile: slot.spacingProfile });
    }
  }
  return anchors;
}

function applyAnchorRepulsion(items: GravityItem[], anchors: GravityAnchor[], positions: Map<string, number>): void {
  for (const item of items) {
    const currentY = positions.get(item.key) ?? item.proposal.box.y;
    for (const anchor of anchors) {
      if (anchor.page !== item.proposal.page) continue;
      if (item.proposal.box.x + item.proposal.box.width <= anchor.box.x + Number.EPSILON
        || anchor.box.x + anchor.box.width <= item.proposal.box.x + Number.EPSILON) continue;
      const gap = spacingTarget(item.slot.spacingProfile ?? anchor.spacingProfile);
      const itemCenter = currentY + item.proposal.box.height / 2;
      const anchorCenter = anchor.box.y + anchor.box.height / 2;
      const required = itemCenter <= anchorCenter
        ? anchor.box.y - gap - item.proposal.box.height
        : anchor.box.y + anchor.box.height + gap;
      const next = itemCenter <= anchorCenter
        ? Math.min(currentY, required)
        : Math.max(currentY, required);
      positions.set(item.key, clampY(item, next));
    }
  }
}

function applyPairwiseRepulsion(items: GravityItem[], positions: Map<string, number>): void {
  const byPage = new Map<number, GravityItem[]>();
  for (const item of items) byPage.set(item.proposal.page, [...(byPage.get(item.proposal.page) ?? []), item]);
  for (const pageItems of byPage.values()) {
    const ordered = [...pageItems].sort((left, right) => (positions.get(left.key) ?? left.proposal.box.y) - (positions.get(right.key) ?? right.proposal.box.y));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      if (groupKey(previous) !== groupKey(current)) continue;
      if (previous.proposal.box.x + previous.proposal.box.width <= current.proposal.box.x + Number.EPSILON
        || current.proposal.box.x + current.proposal.box.width <= previous.proposal.box.x + Number.EPSILON) continue;
      const previousY = positions.get(previous.key) ?? previous.proposal.box.y;
      const currentY = positions.get(current.key) ?? current.proposal.box.y;
      const required = previousY + previous.proposal.box.height + spacingTarget(current.slot.spacingProfile);
      if (currentY >= required) continue;
      const correction = (required - currentY) / 2;
      // A light element should yield first when two obstacles compete for the
      // same interval.  This keeps a large image as a stable visual anchor
      // while allowing a short quote to absorb most of the correction.
      const previousMobility = 1 / Math.max(1, previous.weight);
      const currentMobility = 1 / Math.max(1, current.weight);
      const mobilityTotal = previousMobility + currentMobility;
      const previousCorrection = correction * previousMobility / mobilityTotal;
      const currentCorrection = correction * currentMobility / mobilityTotal;
      positions.set(previous.key, clampY(previous, previousY - previousCorrection));
      positions.set(current.key, clampY(current, currentY + currentCorrection));
    }
  }
}

/**
 * Improve fluid insertion coordinates without remeasuring or reflowing text.
 * The returned map is still only a seed; legality and quality are decided by
 * the normal complete-plan materialization/evaluation pass.
 */
export function relaxInsertionPlacementGravity(
  document: { flows: Record<string, { blocks: CompositionBlock[] }> },
  layout: CompositionLayout,
  proposals: Map<string, PlannedInsertion>,
  budget?: { iterations?: number; damping?: number; convergenceMm?: number },
): PlacementGravityResult {
  const items = eligibleItems(layout, document, proposals);
  const anchors = fixedGravityAnchors(layout);
  const iterations = budget?.iterations ?? readRenderConfig().compositionSearch.gravityIterations;
  const damping = budget?.damping ?? readRenderConfig().compositionSearch.gravityDamping;
  const convergence = budget?.convergenceMm ?? readRenderConfig().compositionSearch.gravityConvergenceMm;
  const targets = desiredPositions(items);
  const positions = new Map(items.map((item) => [item.key, item.proposal.box.y] as const));
  const groupCount = new Set(items.map(groupKey)).size;
  let maxDisplacement = 0;
  let completedIterations = 0;
  let stoppedBy: PlacementGravityTrace['stoppedBy'] = 'no-movement';
  for (let iteration = 0; iteration < Math.max(0, iterations); iteration += 1) {
    let iterationMaximum = 0;
    for (const item of items) {
      const current = positions.get(item.key) ?? item.proposal.box.y;
      const target = targets.get(item.key) ?? current;
      const weightedDamping = damping / item.weight;
      const next = clampY(item, current + (target - current) * Math.max(0, Math.min(1, weightedDamping)));
      positions.set(item.key, next);
      iterationMaximum = Math.max(iterationMaximum, Math.abs(next - current));
    }
    applyAnchorRepulsion(items, anchors, positions);
    applyPairwiseRepulsion(items, positions);
    maxDisplacement = Math.max(maxDisplacement, iterationMaximum);
    completedIterations = iteration + 1;
    if (iterationMaximum <= convergence) {
      stoppedBy = 'converged';
      break;
    }
    stoppedBy = 'budget';
  }
  const relaxed = new Map(proposals);
  let movedCount = 0;
  for (const item of items) {
    const y = positions.get(item.key) ?? item.proposal.box.y;
    if (Math.abs(y - item.proposal.box.y) <= Number.EPSILON) continue;
    movedCount += 1;
    relaxed.set(item.key, { ...item.proposal, box: { ...item.proposal.box, y } });
  }
  return {
    proposals: relaxed,
    trace: { iterations: completedIterations, movedCount, maxDisplacement, groupCount, anchorCount: anchors.length, stoppedBy },
  };
}
