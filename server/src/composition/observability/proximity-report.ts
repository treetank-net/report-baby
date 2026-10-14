import { readRenderConfig } from '../../template/builtins.js';
import type { CompositionDocument } from '../contracts/model.js';
import type {
  CompositionBox,
  CompositionPlan,
  CompositionSpacingObservation,
  CompositionSpacingSubject,
} from '../contracts/engine-contracts.js';
import { plannedLines } from '../layout/plan-lines.js';
import { isPlannedInsertionPlacement } from '../layout/flow-space.js';

/** Geometry-only proximity evidence; candidate generation remains in layout. */

interface ProximitySubject {
  page: number;
  reference: CompositionSpacingSubject;
  box: CompositionBox;
  profile?: 'compact' | 'normal' | 'open';
  movementAxis?: 'x' | 'y';
  insertion: boolean;
  around?: boolean;
}

function bottom(box: CompositionBox): number {
  return box.y + box.height;
}

function right(box: CompositionBox): number {
  return box.x + box.width;
}

function unionBoxes(boxes: CompositionBox[]): CompositionBox | undefined {
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const rightEdge = Math.max(...boxes.map(right));
  const bottomEdge = Math.max(...boxes.map(bottom));
  return { x: left, y: top, width: rightEdge - left, height: bottomEdge - top };
}

function flowByBlock(document: CompositionDocument): Map<string, string> {
  return new Map(Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => [block.id, flow.id] as const)));
}

function subjectKey(page: number, slotId: string, blockId: string, kind: string): string {
  return `${page}:${slotId}:${kind}:${blockId}`;
}

function addSubject(subjects: Map<string, ProximitySubject>, key: string, subject: ProximitySubject): void {
  const existing = subjects.get(key);
  if (!existing) {
    subjects.set(key, subject);
    return;
  }
  existing.box = unionBoxes([existing.box, subject.box]) ?? existing.box;
}

function blockSubjects(plan: CompositionPlan, document: CompositionDocument): ProximitySubject[] {
  const flows = flowByBlock(document);
  const slots = new Map(plan.slots.map((slot) => [slot.id, slot]));
  const groups = new Map<string, ProximitySubject>();
  for (const line of plannedLines(plan)) {
    if (line.layer === 'insertion') continue;
    const slot = slots.get(line.slotId);
    if (!slot) continue;
    const flowId = line.flowId || flows.get(line.blockId);
    addSubject(groups, subjectKey(line.page, line.slotId, line.blockId, 'block'), {
      reference: { kind: 'block', id: line.blockId, blockId: line.blockId, flowId, slotId: line.slotId },
      page: line.page,
      box: { ...line.box },
      profile: slot.spacingProfile,
      insertion: false,
    });
  }
  for (const placement of [...plan.blockPlacements, ...plan.tablePlacements]) {
    // An insertion's enclosing graphic already represents this material
    // subject. Counting its atomic/table placement again invents a self-pair.
    if (isPlannedInsertionPlacement(plan, placement.blockId, placement.page)) continue;
    const slot = slots.get(placement.slotId);
    if (!slot) continue;
    const flowId = flows.get(placement.blockId);
    addSubject(groups, subjectKey(placement.page, placement.slotId, placement.blockId, 'block'), {
      reference: { kind: 'block', id: placement.blockId, blockId: placement.blockId, flowId, slotId: placement.slotId },
      page: placement.page,
      box: { ...placement.box },
      profile: slot.spacingProfile,
      insertion: false,
    });
  }
  return [...groups.values()];
}

function graphicSubjects(plan: CompositionPlan): ProximitySubject[] {
  const slots = new Map(plan.slots.map((slot) => [slot.id, slot]));
  const subjects: ProximitySubject[] = [];
  for (const placement of plan.graphicPlacements) {
    const slot = slots.get(placement.slotId);
    if (!slot) continue;
    const insertion = placement.graphicId.startsWith('insertion:');
    subjects.push({
      reference: {
        kind: 'graphic',
        id: placement.graphicId,
        ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
        ...(insertion ? { blockId: placement.graphicId.slice('insertion:'.length) } : {}),
        slotId: placement.slotId,
      },
      page: placement.page,
      box: { ...placement.box },
      profile: slot.spacingProfile,
      movementAxis: graphicMovementAxis(plan, placement.graphicId, placement.page),
      insertion,
      around: placement.wrap === 'around',
    });
  }
  return subjects;
}

function isOpeningElement(subject: ProximitySubject): boolean {
  return subject.reference.flowId === 'intro';
}

function isInsertion(subject: ProximitySubject): boolean {
  return subject.insertion;
}

function shouldMeasurePair(first: ProximitySubject, second: ProximitySubject): boolean {
  if (first.page !== second.page) return false;
  if (first.reference.flowId !== undefined
    && first.reference.flowId === second.reference.flowId
    && !isInsertion(first)
    && !isInsertion(second)) return false;
  if (!isInsertion(first) && !isInsertion(second) && !isOpeningElement(first) && !isOpeningElement(second)) return false;
  if (first.reference.kind === 'graphic' && first.around && second.reference.flowId === 'main' && !isOpeningElement(second)) return false;
  if (second.reference.kind === 'graphic' && second.around && first.reference.flowId === 'main' && !isOpeningElement(first)) return false;
  return true;
}

function verticalGap(first: CompositionBox, second: CompositionBox): number {
  if (bottom(first) <= second.y) return second.y - bottom(first);
  if (bottom(second) <= first.y) return first.y - bottom(second);
  return -Math.min(bottom(first), bottom(second)) + Math.max(first.y, second.y);
}

function horizontalGap(first: CompositionBox, second: CompositionBox): number {
  if (right(first) <= second.x) return second.x - right(first);
  if (right(second) <= first.x) return first.x - right(second);
  return -(Math.min(right(first), right(second)) - Math.max(first.x, second.x));
}

function proximityAxis(first: CompositionBox, second: CompositionBox): { axis: 'x' | 'y'; gap: number } | undefined {
  const gapX = horizontalGap(first, second);
  const gapY = verticalGap(first, second);
  const xOverlaps = gapX < 0;
  const yOverlaps = gapY < 0;
  if (xOverlaps && yOverlaps) return gapX >= gapY ? { axis: 'x', gap: gapX } : { axis: 'y', gap: gapY };
  if (xOverlaps) return { axis: 'y', gap: gapY };
  if (yOverlaps) return { axis: 'x', gap: gapX };
  return undefined;
}

function graphicMovementAxis(plan: CompositionPlan, graphicId: string, page: number): 'x' | 'y' | undefined {
  if (graphicId.startsWith('insertion:')) {
    const blockId = graphicId.slice('insertion:'.length);
    return (plan.movableInsertionFrames ?? []).find((frame) => frame.page === page && frame.blockId === blockId)?.axis;
  }
  return (plan.movableGraphicFrames ?? []).find((frame) => frame.page === page && frame.graphicId === graphicId)?.axis;
}

/** Identify local spacing relations without rewarding distances across intervening boxes. */
function areProximitySubjectsAdjacent(first: ProximitySubject, second: ProximitySubject, subjects: ProximitySubject[], axis: 'x' | 'y'): boolean {
  const start = axis === 'y' ? Math.min(bottom(first.box), bottom(second.box)) : Math.min(right(first.box), right(second.box));
  const end = axis === 'y' ? Math.max(first.box.y, second.box.y) : Math.max(first.box.x, second.box.x);
  return !subjects.some((subject) => subject !== first && subject !== second && subject.page === first.page
    && (axis === 'y'
      ? subject.box.y >= start && bottom(subject.box) <= end
        && Math.min(right(first.box), right(second.box), right(subject.box)) > Math.max(first.box.x, second.box.x, subject.box.x)
      : subject.box.x >= start && right(subject.box) <= end
        && Math.min(bottom(first.box), bottom(second.box), bottom(subject.box)) > Math.max(first.box.y, second.box.y, subject.box.y)));
}

function spacingTarget(profile: ProximitySubject['profile'], score: ReturnType<typeof readRenderConfig>['compositionScore']): number {
  if (profile === 'compact') return score.spacingProfileCompactTargetMm;
  if (profile === 'open') return score.spacingProfileOpenTargetMm;
  return score.spacingProfileNormalTargetMm;
}

function pairSpacingTarget(
  first: ProximitySubject,
  second: ProximitySubject,
  score: ReturnType<typeof readRenderConfig>['compositionScore'],
): number {
  return Math.max(spacingTarget(first.profile, score), spacingTarget(second.profile, score));
}

function proximityObservation(
  first: ProximitySubject,
  second: ProximitySubject,
  gap: number,
  minimumGap: number,
  moveBudget: number,
): CompositionSpacingObservation {
  const deficit = Math.max(0, minimumGap - gap);
  const movementNeeded = deficit;
  const profile = first.profile ?? second.profile ?? 'normal';
  return {
    kind: 'element-proximity',
    page: first.page,
    from: first.reference,
    to: second.reference,
    fromBox: { ...first.box },
    toBox: { ...second.box },
    profile,
    box: { ...first.box },
    movementAvailable: false,
    metrics: {
      gap,
      minimumGap,
      deficit,
      movementNeeded,
      movementBudget: moveBudget,
      ...(gap < 0 ? { overlap: Math.abs(gap) } : {}),
    },
    reasons: gap < 0 ? ['elements-overlap'] : gap < minimumGap ? ['elements-too-close'] : [],
  };
}

/**
 * @planner-target composition/observability/proximity-report.ts
 * @planner-responsibility Measure actionable proximity between intro, insertion and neighboring content elements.
 */
export function elementProximityReports(plan: CompositionPlan, document: CompositionDocument): CompositionSpacingObservation[] {
  const config = readRenderConfig().compositionScore;
  const moveBudget = config.elementProximityMoveBudgetMm;
  const subjects = [...blockSubjects(plan, document), ...graphicSubjects(plan)];
  const reports: CompositionSpacingObservation[] = [];
  for (let index = 0; index < subjects.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < subjects.length; nextIndex += 1) {
      const first = subjects[index];
      const second = subjects[nextIndex];
      if (first.reference.slotId === second.reference.slotId && first.reference.id === second.reference.id) continue;
      if (!shouldMeasurePair(first, second)) continue;
      const measured = proximityAxis(first.box, second.box);
      if (!measured) continue;
      const gap = measured.gap;
      const minimumGap = pairSpacingTarget(first, second, config);
      const report = proximityObservation(first, second, gap, minimumGap, moveBudget);
      report.axis = measured.axis;
      report.adjacent = areProximitySubjectsAdjacent(first, second, subjects, measured.axis);
      report.movementAvailable = [first, second].some((subject) => subject.movementAxis === measured.axis);
      report.metrics.gapX = horizontalGap(first.box, second.box);
      report.metrics.gapY = verticalGap(first.box, second.box);
      reports.push(report);
    }
  }
  return reports.sort((left, right) => left.page - right.page
    || (left.from?.id ?? '').localeCompare(right.from?.id ?? '')
    || (left.to?.id ?? '').localeCompare(right.to?.id ?? ''));
}
