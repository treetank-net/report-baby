import { readRenderConfig } from '../../template/builtins.js';
import type { CompositionDocument } from '../contracts/model.js';
import type {
  CompositionBox,
  CompositionPlan,
  CompositionMoveRepairProposal,
  CompositionOmitRepairProposal,
  CompositionPlacementScore,
  CompositionRepairProposal,
  CompositionScoreComponent,
  CompositionScorePlacement,
  CompositionSpacingSubject,
} from '../contracts/engine-contracts.js';
import { elementProximityReports } from '../observability/proximity-report.js';
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
  const spacingRhythm = breakdown.find((component) => component.code === 'spacing-rhythm');
  const fragmentation = breakdown.find((component) => component.code === 'paragraph-fragmentation');
  const orphan = breakdown.find((component) => component.code === 'orphan-lines');
  return [
    ...(proximity ? proximityProposals(document, plan, proximity, placementScores) : []),
    ...(symmetry ? insertionSymmetryProposals(plan, symmetry, placementScores) : []),
    ...(spacingRhythm ? spacingRhythmProposals(plan, spacingRhythm, placementScores) : []),
    ...(fragmentation ? paragraphFragmentationProposals(document, plan, fragmentation, placementScores) : []),
    ...(orphan ? orphanProposals(plan, orphan, placementScores) : []),
    ...optionalOmissionProposals(document, placementScores),
  ].slice(0, readRenderConfig().compositionSearch.maxCandidatesPerRefinement);
}
