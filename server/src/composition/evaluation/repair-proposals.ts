import { readRenderConfig } from '../../template/builtins.js';
import type { CompositionDocument } from '../contracts/model.js';
import type {
  CompositionBox,
  CompositionPlan,
  CompositionMoveRepairProposal,
  CompositionRelocateRepairProposal,
  CompositionOmitRepairProposal,
  CompositionPlacementScore,
  CompositionRepairProposal,
  CompositionScoreComponent,
  CompositionScorePlacement,
  CompositionSpacingSubject,
} from '../contracts/engine-contracts.js';
import { elementProximityReports } from '../observability/proximity-report.js';
import { allLines } from './plan-queries.js';
import { rectIntersectionArea } from '../geometry/rectangles.js';
import { scorePlacementForGraphic } from './score-attribution.js';

type DetailRecord = Record<string, unknown>;

interface MovableGraphic {
  placement: CompositionPlan['graphicPlacements'][number];
  bounds: CompositionBox;
  axis: 'x' | 'y';
}

function isRecord(value: unknown): value is DetailRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function numberAt(record: DetailRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textAt(record: DetailRecord, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] as string : undefined;
}

function boxAt(value: unknown): CompositionBox | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberAt(value, 'x');
  const y = numberAt(value, 'y');
  const width = numberAt(value, 'width');
  const height = numberAt(value, 'height');
  return x === undefined || y === undefined || width === undefined || height === undefined
    ? undefined
    : { x, y, width, height };
}

function recordsAt(component: CompositionScoreComponent, key: string): DetailRecord[] {
  const value = component.details?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function placementForSubject(
  subject: unknown,
  page: number,
  score: CompositionPlacementScore[],
): CompositionScorePlacement | undefined {
  if (!isRecord(subject)) return undefined;
  const subjectId = textAt(subject, 'id');
  const blockId = textAt(subject, 'blockId');
  const graphic = subject.kind === 'graphic';
  return score.map((entry) => entry.placement).find((placement) => placement.page === page
    && (graphic ? placement.graphicId === subjectId : placement.blockId === blockId)
    && (textAt(subject, 'slotId') === undefined || placement.slotId === textAt(subject, 'slotId')));
}

function placementForInsertionRecord(
  record: DetailRecord,
  placementScores: CompositionPlacementScore[],
): CompositionScorePlacement | undefined {
  const graphicId = textAt(record, 'graphicId');
  const page = numberAt(record, 'page');
  const slotId = textAt(record, 'slotId');
  if (!graphicId || page === undefined) return undefined;
  return placementScores.map((entry) => entry.placement).find((placement) => placement.page === page
    && placement.graphicId === graphicId
    && (slotId === undefined || placement.slotId === slotId));
}

function movableGraphic(plan: CompositionPlan, placement: CompositionScorePlacement): MovableGraphic | undefined {
  const graphicId = placement.graphicId;
  if (!graphicId) return undefined;
  const graphic = plan.graphicPlacements.find((candidate) => candidate.graphicId === graphicId && candidate.page === placement.page);
  if (!graphic) return undefined;
  if (graphicId.startsWith('insertion:')) {
    const blockId = placement.blockId ?? graphicId.slice('insertion:'.length);
    const frame = (plan.movableInsertionFrames ?? []).find((candidate) => candidate.page === placement.page
      && candidate.blockId === blockId
      && (placement.flowId === undefined || candidate.flowId === placement.flowId));
    return frame ? { placement: graphic, bounds: frame.box, axis: frame.axis } : undefined;
  }
  const frame = (plan.movableGraphicFrames ?? []).find((candidate) => candidate.page === placement.page && candidate.graphicId === graphicId);
  return frame ? { placement: graphic, bounds: frame.box, axis: frame.axis } : undefined;
}

function position(box: { x: number; y: number; width: number; height: number }, axis: 'x' | 'y'): { start: number; end: number } {
  const start = axis === 'x' ? box.x : box.y;
  return { start, end: start + (axis === 'x' ? box.width : box.height) };
}

function directionAwayFrom(
  box: { x: number; y: number; width: number; height: number },
  other: { x: number; y: number; width: number; height: number },
  axis: 'x' | 'y',
): CompositionMoveRepairProposal['direction'] {
  const own = position(box, axis);
  const peer = position(other, axis);
  const negative = axis === 'x' ? 'left' : 'up';
  const positive = axis === 'x' ? 'right' : 'down';
  if (own.end <= peer.start) return negative;
  if (peer.end <= own.start) return positive;
  const ownCenter = (own.start + own.end) / 2;
  const peerCenter = (peer.start + peer.end) / 2;
  return ownCenter <= peerCenter ? negative : positive;
}

function signedMovement(direction: CompositionMoveRepairProposal['direction'], distance: number): number {
  return direction === 'left' || direction === 'up' ? -distance : distance;
}

function availableMovement(movable: MovableGraphic, axis: 'x' | 'y', direction: CompositionMoveRepairProposal['direction']): number {
  if (movable.axis !== axis) return 0;
  const current = movable.placement.box;
  const bounds = movable.bounds;
  if (direction === 'left') return Math.max(0, current.x - bounds.x);
  if (direction === 'right') return Math.max(0, bounds.x + bounds.width - (current.x + current.width));
  if (direction === 'up') return Math.max(0, current.y - bounds.y);
  return Math.max(0, bounds.y + bounds.height - (current.y + current.height));
}

function proximityDeficit(plan: CompositionPlan, document: CompositionDocument): number {
  return elementProximityReports(plan, document)
    .reduce((sum, observation) => sum + Math.max(0, observation.metrics.deficit ?? 0), 0);
}

function estimateProximityGain(
  plan: CompositionPlan,
  document: CompositionDocument,
  movable: MovableGraphic,
  axis: 'x' | 'y',
  direction: CompositionMoveRepairProposal['direction'],
  distance: number,
): number {
  const delta = signedMovement(direction, distance);
  const candidate = {
    ...plan,
    graphicPlacements: plan.graphicPlacements.map((graphic) => graphic.id !== movable.placement.id ? graphic : {
      ...graphic,
      box: { ...graphic.box, [axis]: graphic.box[axis] + delta },
    }),
  };
  const before = proximityDeficit(plan, document);
  const after = proximityDeficit(candidate, document);
  return Math.max(0, before - after) * readRenderConfig().compositionScore.elementProximityPenalty;
}

function proximityProposals(
  document: CompositionDocument,
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const proposals: CompositionRepairProposal[] = [];
  const minimumStep = readRenderConfig().compositionSearch.minimumGeometryStepMm;
  for (const record of recordsAt(component, 'records')) {
    const axis = record.axis === 'x' || record.axis === 'y' ? record.axis : undefined;
    const from = placementForSubject(record.from, numberAt(record, 'page') ?? -1, placementScores);
    const to = placementForSubject(record.to, numberAt(record, 'page') ?? -1, placementScores);
    const fromBox = boxAt(record.fromBox);
    const toBox = boxAt(record.toBox);
    const deficit = numberAt(record, 'deficit') ?? 0;
    const movementBudget = numberAt(record, 'movementBudget') ?? 0;
    if (!axis || !from || !to || !fromBox || !toBox || deficit <= 0 || movementBudget <= 0) continue;
    const distance = Math.min(deficit, movementBudget);
    if (distance < minimumStep) continue;
    const endpoints = [
      { placement: from, box: fromBox, other: toBox },
      { placement: to, box: toBox, other: fromBox },
    ];
    for (const endpoint of endpoints) {
      const movable = movableGraphic(plan, endpoint.placement);
      if (!movable || movable.axis !== axis) continue;
      const direction = directionAwayFrom(endpoint.box, endpoint.other, axis);
      const allowedDistance = Math.min(distance, availableMovement(movable, axis, direction));
      if (allowedDistance < minimumStep) continue;
      const estimate = estimateProximityGain(plan, document, movable, axis, direction, allowedDistance);
      if (estimate <= 0) continue;
      const peer = endpoint.placement.id === from.id ? to : from;
      const sign = signedMovement(direction, allowedDistance);
      proposals.push({
        id: `${component.code}:${endpoint.placement.id}:${axis}:${sign}`,
        placement: endpoint.placement,
        action: 'move',
        axis,
        direction,
        distance: allowedDistance,
        sourceCode: component.code,
        estimatedPoints: estimate,
        estimateKind: 'local-geometry',
        legalCapability: 'declared-movable-frame',
        legalBounds: { ...movable.bounds },
        evidencePlacementId: peer.id,
        measuredGap: numberAt(record, 'gap'),
        targetGap: numberAt(record, 'minimumGap'),
      });
    }
  }
  return proposals;
}

function insertionSymmetryProposals(
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const config = readRenderConfig();
  const tolerance = config.compositionScore.insertionSymmetryToleranceMm;
  const penalty = config.compositionScore.insertionSymmetryPenalty;
  const minimumStep = config.compositionSearch.minimumGeometryStepMm;
  const proposals: CompositionRepairProposal[] = [];
  for (const record of recordsAt(component, 'records')) {
    const placement = placementForInsertionRecord(record, placementScores);
    if (!placement) continue;
    const observation = plan.spacing?.observations?.find((candidate) => candidate.kind === 'insertion-rhythm'
      && candidate.page === placement.page
      && candidate.graphicId === placement.graphicId
      && candidate.slotId === placement.slotId);
    const before = observation?.metrics.beforeTextGap;
    const after = observation?.metrics.afterTextGap;
    if (before === undefined || after === undefined || before <= 0 || after <= 0) continue;
    const asymmetry = Math.abs(before - after);
    if (asymmetry <= tolerance) continue;
    const movable = movableGraphic(plan, placement);
    if (!movable || movable.axis !== 'y') continue;
    const direction = before < after ? 'down' : 'up';
    const distance = Math.min(asymmetry / 2, availableMovement(movable, 'y', direction));
    if (distance < minimumStep) continue;
    const beforeAfterMove = before + (direction === 'down' ? distance : -distance);
    const afterAfterMove = after + (direction === 'down' ? -distance : distance);
    const remainingAsymmetry = Math.abs(beforeAfterMove - afterAfterMove);
    const estimatedPoints = (Math.max(0, asymmetry - tolerance) - Math.max(0, remainingAsymmetry - tolerance)) * penalty;
    if (estimatedPoints <= 0) continue;
    proposals.push({
      id: `${component.code}:${placement.id}:${direction}:${distance}`,
      placement,
      action: 'move',
      axis: 'y',
      direction,
      distance,
      sourceCode: component.code,
      estimatedPoints,
      estimateKind: 'local-geometry',
      legalCapability: 'declared-movable-frame',
      legalBounds: { ...movable.bounds },
      measuredGap: asymmetry,
      targetGap: tolerance,
    });
  }
  return proposals;
}

function insertionDistributionProposals(
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionMoveRepairProposal[] {
  const config = readRenderConfig();
  const tolerance = config.compositionScore.insertionDistributionToleranceMm;
  const penalty = config.compositionScore.insertionDistributionPenalty;
  const minimumStep = config.compositionSearch.minimumGeometryStepMm;
  const proposals: CompositionMoveRepairProposal[] = [];
  for (const record of recordsAt(component, 'records')) {
    const key = textAt(record, 'key');
    if (!key) continue;
    const separator = key.indexOf(':');
    const page = Number(separator < 0 ? key : key.slice(0, separator));
    const regionId = separator < 0 ? undefined : key.slice(separator + 1);
    if (!Number.isInteger(page)) continue;
    const observations = (plan.spacing?.observations ?? [])
      .filter((observation) => observation.kind === 'insertion-rhythm'
        && observation.page === page
        && (regionId === undefined || (observation.regionId ?? '') === regionId))
      .sort((left, right) => (left.box?.y ?? 0) - (right.box?.y ?? 0));
    for (let index = 0; index < observations.length; index += 1) {
      const observation = observations[index]!;
      const previousGap = index === 0 ? observation.metrics.regionStartGap : observation.metrics.previousInsertionGap;
      const nextGap = index === observations.length - 1 ? observation.metrics.regionEndGap : observation.metrics.nextInsertionGap;
      if (previousGap === undefined || nextGap === undefined) continue;
      const asymmetry = Math.abs(previousGap - nextGap);
      if (asymmetry <= tolerance) continue;
      const placement = placementForInsertionRecord({
        page: observation.page,
        graphicId: observation.graphicId,
        slotId: observation.slotId,
      }, placementScores);
      if (!placement) continue;
      const movable = movableGraphic(plan, placement);
      if (!movable || movable.axis !== 'y') continue;
      const direction: CompositionMoveRepairProposal['direction'] = previousGap < nextGap ? 'down' : 'up';
      const distance = Math.min(asymmetry / 2, availableMovement(movable, 'y', direction));
      if (distance < minimumStep) continue;
      const remainingAsymmetry = Math.max(0, asymmetry - distance * 2);
      const estimatedPoints = (Math.max(0, asymmetry - tolerance) - Math.max(0, remainingAsymmetry - tolerance)) * penalty;
      if (estimatedPoints <= 0) continue;
      proposals.push({
        id: `${component.code}:${placement.id}:${direction}:${distance}`,
        placement,
        action: 'move',
        axis: 'y',
        direction,
        distance,
        sourceCode: component.code,
        estimatedPoints,
        estimateKind: 'local-geometry',
        legalCapability: 'declared-movable-frame',
        legalBounds: { ...movable.bounds },
        measuredGap: asymmetry,
        targetGap: tolerance,
      });
    }
  }
  return proposals;
}

function spacingRhythmProposals(
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const config = readRenderConfig();
  const tolerance = config.compositionScore.spacingProfileToleranceMm;
  const penalty = config.compositionScore.spacingProfilePenalty;
  const minimumStep = config.compositionSearch.minimumGeometryStepMm;
  const proposals: CompositionRepairProposal[] = [];
  for (const record of recordsAt(component, 'records')) {
    const placement = placementForInsertionRecord(record, placementScores);
    const side = textAt(record, 'side');
    const gap = numberAt(record, 'gap');
    const target = numberAt(record, 'target');
    if (!placement || (side !== 'before' && side !== 'after') || gap === undefined || target === undefined) continue;
    const excess = Math.max(0, Math.abs(gap - target) - tolerance);
    if (excess <= 0) continue;
    const movable = movableGraphic(plan, placement);
    if (!movable || movable.axis !== 'y') continue;
    const gapTooSmall = gap < target;
    const direction = side === 'before'
      ? (gapTooSmall ? 'down' : 'up')
      : (gapTooSmall ? 'up' : 'down');
    const distance = Math.min(excess, availableMovement(movable, 'y', direction));
    if (distance < minimumStep) continue;
    const gapChange = side === 'before'
      ? (direction === 'down' ? distance : -distance)
      : (direction === 'up' ? distance : -distance);
    const remainingExcess = Math.max(0, Math.abs(gap + gapChange - target) - tolerance);
    const estimatedPoints = (excess - remainingExcess) * penalty;
    if (estimatedPoints <= 0) continue;
    proposals.push({
      id: `${component.code}:${placement.id}:${side}:${direction}:${distance}`,
      placement,
      action: 'move',
      axis: 'y',
      direction,
      distance,
      sourceCode: component.code,
      estimatedPoints,
      estimateKind: 'local-geometry',
      legalCapability: 'declared-movable-frame',
      legalBounds: { ...movable.bounds },
      measuredGap: gap,
      targetGap: target,
    });
  }
  return proposals;
}

function glyphOverlapAreaAt(
  box: CompositionBox,
  textCells: CompositionBox[],
  minimumArea: number,
): number {
  return textCells.reduce((area, textCell) => {
      const overlapArea = rectIntersectionArea(box, textCell);
      return area + (overlapArea >= minimumArea ? overlapArea : 0);
    }, 0);
}

function textPlacementForGlyphRecord(
  record: DetailRecord,
  page: number,
  placementScores: CompositionPlacementScore[],
): CompositionScorePlacement | undefined {
  const blockId = textAt(record, 'blockId');
  const flowId = textAt(record, 'flowId');
  const slotId = textAt(record, 'textSlotId');
  if (!blockId) return undefined;
  return placementScores.map((entry) => entry.placement).find((placement) => placement.page === page
    && placement.blockId === blockId
    && (flowId === undefined || placement.flowId === flowId)
    && (slotId === undefined || placement.slotId === slotId));
}

function glyphTargetGraphicId(
  glyph: NonNullable<CompositionPlan['glyphPlacements']>[number],
  plan: CompositionPlan,
): string | undefined {
  if (glyph.targetType === 'graphic') {
    return plan.graphicPlacements.find((placement) => placement.graphicId === glyph.targetId || placement.id === glyph.targetId)?.graphicId;
  }
  const insertionId = `insertion:${glyph.targetId}`;
  return plan.graphicPlacements.some((placement) => placement.graphicId === insertionId) ? insertionId : undefined;
}

function glyphOverlapProposals(
  document: CompositionDocument,
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const config = readRenderConfig();
  const minimumStep = config.compositionSearch.minimumGeometryStepMm;
  const minimumArea = config.compositionScore.glyphOverlapMinAreaMm2;
  const penalty = config.compositionScore.glyphOverlapPenalty;
  const cellsByPage = new Map<number, Array<{ blockId: string; box: CompositionBox }>>();
  for (const line of allLines(plan)) {
    const cells = line.glyphSamplingBoxes?.map((sample) => ({ blockId: line.blockId, box: sample.box })) ?? [];
    if (cells.length > 0) cellsByPage.set(line.page, [...(cellsByPage.get(line.page) ?? []), ...cells]);
  }
  const recordsByGlyph = new Map<string, DetailRecord[]>();
  for (const record of recordsAt(component, 'records')) {
    const glyphPlacementId = textAt(record, 'glyphPlacementId');
    if (!glyphPlacementId) continue;
    recordsByGlyph.set(glyphPlacementId, [...(recordsByGlyph.get(glyphPlacementId) ?? []), record]);
  }
  const proposals: CompositionRepairProposal[] = [];
  for (const [glyphPlacementId, records] of recordsByGlyph) {
    const glyph = plan.glyphPlacements?.find((candidate) => candidate.id === glyphPlacementId);
    if (!glyph) continue;
    const graphicId = glyphTargetGraphicId(glyph, plan);
    const graphicPlanPlacement = graphicId
      ? plan.graphicPlacements.find((placement) => placement.page === glyph.page && placement.graphicId === graphicId)
      : undefined;
    const graphicScorePlacement = graphicPlanPlacement
      ? scorePlacementForGraphic(document, graphicPlanPlacement)
      : undefined;
    if (!graphicScorePlacement) continue;
    const movable = movableGraphic(plan, graphicScorePlacement);
    if (!movable) continue;
    const glyphMovesWithBlock = glyph.targetType === 'block' ? glyph.targetId : undefined;
    const textCells = (cellsByPage.get(glyph.page) ?? [])
      .filter((cell) => cell.blockId !== glyphMovesWithBlock)
      .map((cell) => cell.box);
    const affectedTextCells = textCells
      .map((box) => ({ box, area: rectIntersectionArea(glyph.box, box) }))
      .filter((cell) => cell.area >= minimumArea);
    if (affectedTextCells.length === 0) continue;
    const currentOverlapArea = affectedTextCells.reduce((sum, cell) => sum + cell.area, 0);
    const evidencePlacement = records.map((record) => textPlacementForGlyphRecord(record, glyph.page, placementScores)).find(Boolean);
    const directions = movable.axis === 'x'
      ? [{ direction: 'left' as const, sign: -1 }, { direction: 'right' as const, sign: 1 }]
      : [{ direction: 'up' as const, sign: -1 }, { direction: 'down' as const, sign: 1 }];
    for (const { direction, sign } of directions) {
      const axis = movable.axis;
      const glyphStart = glyph.box[axis];
      const glyphExtent = axis === 'x' ? glyph.box.width : glyph.box.height;
      const distanceNeeded = Math.max(...affectedTextCells.map(({ box }) => {
        const cellStart = box[axis];
        const cellExtent = axis === 'x' ? box.width : box.height;
        return sign < 0
          ? glyphStart + glyphExtent - cellStart + minimumStep
          : cellStart + cellExtent - glyphStart + minimumStep;
      }));
      const allowedDistance = Math.min(distanceNeeded, availableMovement(movable, axis, direction));
      if (allowedDistance < minimumStep) continue;
      const candidateGlyphBox = { ...glyph.box, [axis]: glyphStart + (sign * allowedDistance) };
      const remainingOverlapArea = glyphOverlapAreaAt(candidateGlyphBox, textCells, minimumArea);
      const estimatedPoints = (currentOverlapArea - remainingOverlapArea) * penalty;
      if (estimatedPoints <= 0) continue;
      proposals.push({
        id: `glyph-overlap:${graphicScorePlacement.id}:${direction}:${allowedDistance}`,
        placement: graphicScorePlacement,
        action: 'move',
        axis,
        direction,
        distance: allowedDistance,
        sourceCode: component.code,
        estimatedPoints,
        estimateKind: 'local-geometry',
        legalCapability: 'declared-movable-frame',
        legalBounds: { ...movable.bounds },
        ...(evidencePlacement === undefined ? {} : { evidencePlacementId: evidencePlacement.id }),
        overlapArea: currentOverlapArea,
      });
    }
  }
  return proposals;
}

function orphanProposals(
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const config = readRenderConfig();
  const proposals: CompositionRepairProposal[] = [];
  const limit = config.compositionSearch.maxCandidatesPerRefinement;
  for (const orphan of recordsAt(component, 'orphans')) {
    const orphanBlockId = textAt(orphan, 'blockId');
    const graphicId = textAt(orphan, 'graphicId');
    const page = numberAt(orphan, 'page');
    const lineHeight = numberAt(orphan, 'lineHeight');
    if (!orphanBlockId || !graphicId || page === undefined || lineHeight === undefined || lineHeight <= 0) continue;
    const placement = plan.graphicPlacements.find((graphic) => graphic.graphicId === graphicId && graphic.page === page);
    if (!placement) continue;
    const scorePlacement = placementScores.find((entry) => entry.placement.page === page
      && entry.placement.graphicId === graphicId)?.placement;
    if (!scorePlacement) continue;
    const textEvidencePlacement = placementScores.find((entry) => entry.placement.page === page
      && entry.placement.blockId === orphanBlockId)?.placement;
    const insertionBlockId = graphicId.startsWith('insertion:') ? graphicId.slice('insertion:'.length) : undefined;
    const frame = graphicId.startsWith('insertion:')
      ? (plan.movableInsertionFrames ?? []).find((candidate) => candidate.page === page && candidate.blockId === insertionBlockId)
      : undefined;
    const graphicFrame = (plan.movableGraphicFrames ?? []).find((candidate) => candidate.page === page && candidate.graphicId === graphicId);
    const bounds = frame?.box ?? graphicFrame?.box;
    const axis = frame?.axis ?? graphicFrame?.axis;
    if (!bounds || axis !== 'y') continue;
    const directions: Array<{ direction: 'up' | 'down'; distance: number }> = [
      { direction: 'up', distance: Math.max(0, placement.box.y - bounds.y) },
      { direction: 'down', distance: Math.max(0, bounds.y + bounds.height - (placement.box.y + placement.box.height)) },
    ];
    for (const { direction, distance } of directions) {
      const lineSteps = Math.floor(distance / lineHeight);
      for (let step = 1; step <= lineSteps && proposals.length < limit; step += 1) {
        const displacement = step * lineHeight;
        proposals.push({
          id: `${component.code}:${scorePlacement.id}:${orphanBlockId}:${direction}:${displacement}`,
          placement: scorePlacement,
          action: 'move',
          axis: 'y',
          direction,
          distance: displacement,
          sourceCode: component.code,
          estimatedPoints: config.compositionScore.orphanPenalty,
          estimateKind: 'orphan-recovery',
          legalCapability: 'declared-movable-frame',
          legalBounds: { ...bounds },
          ...(textEvidencePlacement === undefined ? {} : { evidencePlacementId: textEvidencePlacement.id }),
          orphanCount: 1,
          lineHeight,
        });
      }
      if (proposals.length >= limit) return proposals;
    }
  }
  return proposals;
}

/** Find unoccupied insertion-capability instances that can accept one block. */
function relocationDestinations(
  plan: CompositionPlan,
  placement: CompositionScorePlacement,
): Array<{ page: number; slotId: string; box: CompositionBox }> {
  const flowId = placement.flowId;
  const blockId = placement.blockId;
  if (!flowId || !blockId || !placement.graphicId?.startsWith('insertion:')) return [];
  const occupiedSlotIds = new Set(plan.graphicPlacements
    .filter((candidate) => candidate.graphicId.startsWith('insertion:'))
    .map((candidate) => candidate.slotId));
  const currentSlotId = placement.slotId;
  return plan.slots
    .filter((slot) => slot.flowId === flowId
      && slot.id !== currentSlotId
      && !occupiedSlotIds.has(slot.id)
      && slot.kind === 'text'
      && (slot.allowedRoles === undefined || slot.allowedRoles.includes('quote') || slot.allowedRoles.length === 0)
      && (slot.allowedBlockIds === undefined || slot.allowedBlockIds.includes(blockId)))
    .sort((left, right) => left.page - right.page
      || left.box.y - right.box.y
      || left.box.x - right.box.x
      || left.id.localeCompare(right.id))
    .map((slot) => ({
      page: slot.page,
      slotId: slot.id.replace(/^\d+:/u, ''),
      box: { ...slot.box },
    }));
}

/** Propose relocating an insertion when its current page causes a named quality defect. */
function relocationProposals(
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRelocateRepairProposal[] {
  const config = readRenderConfig();
  const limit = config.compositionSearch.maxCandidatesPerRefinement;
  const proposals: CompositionRelocateRepairProposal[] = [];
  const records = component.code === 'orphan-lines'
    ? recordsAt(component, 'orphans')
    : recordsAt(component, 'records');
  const candidateRecords = component.code === 'content-spread'
    ? [...records].sort((left, right) => (numberAt(right, 'deviation') ?? 0) - (numberAt(left, 'deviation') ?? 0)).slice(0, 1)
    : records;
  for (const record of candidateRecords) {
    const page = numberAt(record, 'page');
    const insertionSubject = component.code === 'orphan-lines'
      ? undefined
      : [record.from, record.to]
        .filter(isRecord)
        .find((subject) => textAt(subject, 'id')?.startsWith('insertion:'));
    const graphicId = component.code === 'orphan-lines' || component.code === 'content-spread'
      ? textAt(record, 'graphicId')
      : insertionSubject ? textAt(insertionSubject, 'id') : undefined;
    const blockId = component.code === 'orphan-lines' || component.code === 'content-spread'
      ? textAt(record, 'blockId')
      : insertionSubject ? textAt(insertionSubject, 'blockId') : undefined;
    if (!graphicId || page === undefined || !blockId) continue;
    const placement = placementScores.find((entry) => entry.placement.page === page
      && entry.placement.graphicId === graphicId)?.placement;
    if (!placement) continue;
    const destinations = relocationDestinations(plan, placement);
    const destinationsToTry = component.code === 'content-spread'
      ? [...destinations]
        .sort((left, right) => Math.abs(left.page / Math.max(1, plan.pages.length) - (numberAt(record, 'expectedProgress') ?? 0))
          - Math.abs(right.page / Math.max(1, plan.pages.length) - (numberAt(record, 'expectedProgress') ?? 0))
          || left.page - right.page
          || left.slotId.localeCompare(right.slotId))
        .slice(0, 1)
      : destinations;
    const evidencePlacement = component.code === 'orphan-lines'
      ? placementScores.find((entry) => entry.placement.page === page && entry.placement.blockId === blockId)?.placement
      : [record.from, record.to]
        .filter(isRecord)
        .map((subject) => placementForSubject(subject, page, placementScores))
        .find((candidate) => candidate !== undefined && candidate.id !== placement.id);
    const lineHeight = component.code === 'orphan-lines' ? numberAt(record, 'lineHeight') : undefined;
    const estimatedPoints = component.code === 'orphan-lines'
      ? config.compositionScore.orphanPenalty
      : component.code === 'content-spread'
        ? Math.max(0, (numberAt(record, 'deviation') ?? 0) - config.compositionScore.contentSpreadTolerance) * config.compositionScore.contentSpreadPenalty
        : Math.max(0, numberAt(record, 'deficit') ?? 0) * config.compositionScore.elementProximityPenalty;
    if (estimatedPoints <= 0) continue;
    for (const destination of destinationsToTry) {
      proposals.push({
        id: `${component.code}:relocate:${placement.id}:${destination.page}:${destination.slotId}`,
        placement,
        action: 'relocate',
        destination,
        sourceCode: component.code,
        estimatedPoints,
        estimateKind: 'relocation',
        legalCapability: 'compatible-slot',
        ...(evidencePlacement === undefined ? {} : { evidencePlacementId: evidencePlacement.id }),
        ...(component.code === 'orphan-lines' ? { orphanCount: numberAt(record, 'orphanCount') ?? 1 } : {}),
        ...(lineHeight === undefined ? {} : { lineHeight }),
      });
      if (proposals.length >= limit) return proposals;
    }
  }
  return proposals;
}

function fragmentedBlockIds(component: CompositionScoreComponent): string[] {
  if (!isRecord(component.details) || !Array.isArray(component.details.fragmentedBlockIds)) return [];
  return component.details.fragmentedBlockIds.filter((value): value is string => typeof value === 'string');
}

function paragraphFragmentationProposals(
  document: CompositionDocument,
  plan: CompositionPlan,
  component: CompositionScoreComponent,
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const config = readRenderConfig();
  const minimumStep = config.compositionSearch.minimumGeometryStepMm;
  const limit = config.compositionSearch.maxCandidatesPerRefinement;
  const proposals: CompositionRepairProposal[] = [];
  for (const blockId of fragmentedBlockIds(component)) {
    const lines = plan.lines.filter((line) => line.blockId === blockId);
    const pages = [...new Set(lines.map((line) => line.page))];
    for (const page of pages) {
      const pageLines = lines.filter((line) => line.page === page);
      for (const graphic of plan.graphicPlacements) {
        if (graphic.page !== page || graphic.wrap !== 'around') continue;
        const verticalPeerLines = pageLines.filter((line) => line.box.y < graphic.box.y + graphic.box.height
          && graphic.box.y < line.box.y + line.box.height);
        const hasLeftPeer = verticalPeerLines.some((line) => line.box.x + line.box.width <= graphic.box.x + Number.EPSILON);
        const hasRightPeer = verticalPeerLines.some((line) => line.box.x >= graphic.box.x + graphic.box.width - Number.EPSILON);
        if (!hasLeftPeer || !hasRightPeer) continue;
        const scorePlacement = scorePlacementForGraphic(document, graphic);
        const textEvidencePlacement = placementScores.find((entry) => entry.placement.page === page
          && entry.placement.blockId === blockId)?.placement;
        const movable = movableGraphic(plan, scorePlacement);
        if (!movable || movable.axis !== 'y') continue;
        const lineHeight = Math.min(...verticalPeerLines.map((line) => line.box.height).filter((height) => height > 0));
        if (!Number.isFinite(lineHeight) || lineHeight <= 0) continue;
        const directions: Array<{ direction: 'up' | 'down'; distance: number }> = [
          { direction: 'up', distance: Math.max(0, graphic.box.y - movable.bounds.y) },
          { direction: 'down', distance: Math.max(0, movable.bounds.y + movable.bounds.height - (graphic.box.y + graphic.box.height)) },
        ];
        for (const { direction, distance } of directions) {
          const lineSteps = Math.floor(distance / lineHeight);
          for (let step = 1; step <= lineSteps && proposals.length < limit; step += 1) {
            const displacement = step * lineHeight;
            proposals.push({
              id: `${component.code}:${scorePlacement.id}:${blockId}:${direction}:${displacement}`,
              placement: scorePlacement,
              action: 'move',
              axis: 'y',
              direction,
              distance: displacement,
              sourceCode: component.code,
              estimatedPoints: config.compositionScore.paragraphFragmentationPenalty,
              estimateKind: 'fragmentation-recovery',
              legalCapability: 'declared-movable-frame',
              legalBounds: { ...movable.bounds },
              ...(textEvidencePlacement === undefined ? {} : { evidencePlacementId: textEvidencePlacement.id }),
              lineHeight,
            });
          }
          if (proposals.length >= limit) return proposals;
        }
      }
    }
  }
  return proposals;
}

function optionalOmissionProposals(
  document: CompositionDocument,
  placementScores: CompositionPlacementScore[],
): CompositionOmitRepairProposal[] {
  const proposals: CompositionOmitRepairProposal[] = [];
  for (const [flowId, flow] of Object.entries(document.flows)) {
    if (flowId === 'main') continue;
    for (const block of flow.blocks) {
      if (block.allowOmission !== true) continue;
      const insertionGraphicId = `insertion:${block.id}`;
      const score = placementScores.find((candidate) => candidate.placement.flowId === flowId
        && candidate.placement.blockId === block.id
        && candidate.placement.graphicId === insertionGraphicId);
      if (!score) continue;
      const estimatedPoints = score.contributions
        .filter((contribution) => contribution.points < 0)
        .reduce((total, contribution) => total - contribution.points, 0);
      if (estimatedPoints <= 0) continue;
      proposals.push({
        id: `optional-omission:${score.placement.id}`,
        placement: score.placement,
        action: 'omit',
        sourceCode: score.contributions.find((contribution) => contribution.points < 0)?.code ?? 'placement-score',
        estimatedPoints,
        estimateKind: 'optional-omission',
        legalCapability: 'input-allows-omission',
      });
    }
  }
  return proposals;
}

/** Build bounded move proposals from scored geometry; every proposal still needs a full replan. */
export function compositionRepairProposals(
  document: CompositionDocument,
  plan: CompositionPlan,
  breakdown: CompositionScoreComponent[],
  placementScores: CompositionPlacementScore[],
): CompositionRepairProposal[] {
  const proximity = breakdown.find((component) => component.code === 'element-proximity');
  const symmetry = breakdown.find((component) => component.code === 'insertion-symmetry');
  const distribution = breakdown.find((component) => component.code === 'insertion-distribution');
  const contentSpread = breakdown.find((component) => component.code === 'content-spread');
  const spacingRhythm = breakdown.find((component) => component.code === 'spacing-rhythm');
  const fragmentation = breakdown.find((component) => component.code === 'paragraph-fragmentation');
  const orphan = breakdown.find((component) => component.code === 'orphan-lines');
  const glyphOverlap = breakdown.find((component) => component.code === 'glyph-overlap');
  const proposals = [
    ...(proximity ? proximityProposals(document, plan, proximity, placementScores) : []),
    ...(symmetry ? insertionSymmetryProposals(plan, symmetry, placementScores) : []),
    ...(distribution ? insertionDistributionProposals(plan, distribution, placementScores) : []),
    ...(spacingRhythm ? spacingRhythmProposals(plan, spacingRhythm, placementScores) : []),
    ...(fragmentation ? paragraphFragmentationProposals(document, plan, fragmentation, placementScores) : []),
    ...(orphan ? orphanProposals(plan, orphan, placementScores) : []),
    ...(orphan ? relocationProposals(plan, orphan, placementScores) : []),
    ...(proximity ? relocationProposals(plan, proximity, placementScores) : []),
    ...(contentSpread ? relocationProposals(plan, contentSpread, placementScores) : []),
    ...(glyphOverlap ? glyphOverlapProposals(document, plan, glyphOverlap, placementScores) : []),
    ...optionalOmissionProposals(document, placementScores),
  ];
  return proposals
    .sort((left, right) => right.estimatedPoints - left.estimatedPoints || left.id.localeCompare(right.id))
    .slice(0, readRenderConfig().compositionSearch.maxCandidatesPerRefinement);
}
