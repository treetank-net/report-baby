import { readRenderConfig } from '../../template/builtins.js';
import type { CompositionDocument } from '../contracts/model.js';
import type {
  CompositionBox,
  CompositionPlan,
  CompositionSpacingObservation,
  CompositionSpacingSubject,
} from '../contracts/engine-contracts.js';
import { plannedLines } from '../layout/plan-lines.js';

/** Geometry-only proximity evidence; candidate generation remains in layout. */

interface ProximitySubject {
  page: number;
  reference: CompositionSpacingSubject;
  box: CompositionBox;
  profile?: 'compact' | 'normal' | 'open';
  movable: boolean;
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

function horizontalOverlap(first: CompositionBox, second: CompositionBox): boolean {
  return Math.min(right(first), right(second)) > Math.max(first.x, second.x);
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
      movable: false,
      insertion: false,
    });
  }
  for (const placement of [...plan.blockPlacements, ...plan.tablePlacements]) {
    const slot = slots.get(placement.slotId);
    if (!slot) continue;
    const flowId = flows.get(placement.blockId);
    addSubject(groups, subjectKey(placement.page, placement.slotId, placement.blockId, 'block'), {
      reference: { kind: 'block', id: placement.blockId, blockId: placement.blockId, flowId, slotId: placement.slotId },
      page: placement.page,
      box: { ...placement.box },
      profile: slot.spacingProfile,
      movable: false,
      insertion: false,
    });
  }
  return [...groups.values()];
}

function insertionSubjects(plan: CompositionPlan): ProximitySubject[] {
  const slots = new Map(plan.slots.map((slot) => [slot.id, slot]));
  const subjects: ProximitySubject[] = [];
  for (const placement of plan.graphicPlacements.filter((graphic) => graphic.graphicId.startsWith('insertion:'))) {
    const slot = slots.get(placement.slotId);
    if (!slot) continue;
    subjects.push({
      reference: {
        kind: 'graphic',
        id: placement.graphicId,
        ...(slot.flowId === undefined ? {} : { flowId: slot.flowId }),
        blockId: placement.graphicId.slice('insertion:'.length),
        slotId: placement.slotId,
      },
      page: placement.page,
      box: { ...placement.box },
      profile: slot.spacingProfile,
      movable: (plan.movableInsertionFrames ?? []).some((frame) => frame.page === placement.page
          && frame.flowId === (slot.flowId ?? '')
          && frame.blockId === placement.graphicId.slice('insertion:'.length)),
      insertion: true,
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
    movementAvailable: [first, second].some((subject) => isInsertion(subject) && subject.movable),
    metrics: {
      gap,
      minimumGap,
      deficit,
      movementNeeded,
      movementBudget: moveBudget,
      ...(gap < 0 ? { overlap: Math.abs(gap) } : {}),
    },
    reasons: [gap < 0 ? 'elements-overlap' : 'elements-too-close'],
  };
}

/**
 * @planner-target composition/observability/proximity-report.ts
 * @planner-responsibility Measure actionable proximity between intro, insertion and neighboring content elements.
 */
export function elementProximityReports(plan: CompositionPlan, document: CompositionDocument): CompositionSpacingObservation[] {
  const config = readRenderConfig().compositionScore;
  const moveBudget = config.elementProximityMoveBudgetMm;
  const subjects = [...blockSubjects(plan, document), ...insertionSubjects(plan)];
  const reports: CompositionSpacingObservation[] = [];
  for (let index = 0; index < subjects.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < subjects.length; nextIndex += 1) {
      const first = subjects[index];
      const second = subjects[nextIndex];
      if (first.reference.slotId === second.reference.slotId && first.reference.id === second.reference.id) continue;
      if (!shouldMeasurePair(first, second) || !horizontalOverlap(first.box, second.box)) continue;
      const gap = verticalGap(first.box, second.box);
      const minimumGap = pairSpacingTarget(first, second, config);
      if (gap >= minimumGap) continue;
      const report = proximityObservation(first, second, gap, minimumGap, moveBudget);
      reports.push(report);
    }
  }
  return reports.sort((left, right) => left.page - right.page
    || (left.from?.id ?? '').localeCompare(right.from?.id ?? '')
    || (left.to?.id ?? '').localeCompare(right.to?.id ?? ''));
}
