import type { CompositionBlock, CompositionDocument, CompositionRect } from './model.js';
import type {
  CompositionFlowBarrierBoxCandidate,
  CompositionFlowPlacement,
  CompositionGraphicPlacement,
  CompositionLine,
  CompositionPlan,
  CompositionSlot,
} from './engine.js';

function rectBottom(rect: CompositionRect): number {
  return rect.y + rect.height;
}

function horizontalOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const overlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  return overlap > Number.EPSILON * Math.max(1, Math.abs(first.x), Math.abs(first.width), Math.abs(second.x), Math.abs(second.width)) * 32;
}

function rectsOverlap(first: CompositionRect, second: CompositionRect): boolean {
  const horizontal = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const vertical = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  const scale = Math.max(1, Math.abs(first.x), Math.abs(first.y), Math.abs(first.width), Math.abs(first.height), Math.abs(second.x), Math.abs(second.y), Math.abs(second.width), Math.abs(second.height));
  return horizontal > Number.EPSILON * scale * 32 && vertical > Number.EPSILON * scale * 32;
}

function coversFlowWidth(flow: CompositionRect, graphic: CompositionRect): boolean {
  return graphic.x <= flow.x && graphic.x + graphic.width >= flow.x + flow.width;
}

function plannedLines(plan: CompositionPlan): CompositionLine[] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function blockFlowIds(document: CompositionDocument): Map<string, string> {
  return new Map(Object.entries(document.flows).flatMap(([flowId, flow]) => flow.blocks.map((block: CompositionBlock) => [block.id, flowId] as const)));
}

/** Builds the renderer-neutral flow-to-slot projection used by tracing and evaluation. */
export function registerFlowPlacements(document: CompositionDocument, plan: CompositionPlan): CompositionFlowPlacement[] {
  const flowIdsByBlock = blockFlowIds(document);
  const contentBySlot = new Map<string, Set<string>>();
  const linesBySlot = new Map<string, number>();
  const addContent = (flowId: string | undefined, slotId: string, blockId: string): void => {
    if (!flowId) return;
    const key = `${flowId}:${slotId}`;
    const blockIds = contentBySlot.get(key) ?? new Set<string>();
    blockIds.add(blockId);
    contentBySlot.set(key, blockIds);
  };
  for (const line of plannedLines(plan)) {
    addContent(line.flowId, line.slotId, line.blockId);
    linesBySlot.set(line.slotId, (linesBySlot.get(line.slotId) ?? 0) + 1);
  }
  for (const placement of [...plan.placements, ...plan.blockPlacements, ...plan.tablePlacements]) {
    addContent(flowIdsByBlock.get(placement.blockId), placement.slotId, placement.blockId);
  }
  return plan.slots
    .filter((slot): slot is CompositionSlot & { flowId: string; routeIndex: number } => slot.flowId !== undefined && slot.routeIndex !== undefined && slot.kind === 'text')
    .map((slot) => {
      const key = `${slot.flowId}:${slot.id}`;
      const blockIds = [...(contentBySlot.get(key) ?? new Set<string>())];
      const blockedBy = plan.graphicPlacements
        .filter((graphic) => graphic.page === slot.page && graphic.wrap === 'around'
          && graphic.box.x <= slot.box.x
          && graphic.box.y <= slot.box.y
          && rectBottom(graphic.box) >= rectBottom(slot.box)
          && graphic.box.x + graphic.box.width >= slot.box.x + slot.box.width)
        .map((graphic) => graphic.graphicId);
      return {
        id: `flow-placement:${slot.id}`,
        flowId: slot.flowId,
        page: slot.page,
        slotId: slot.id,
        routeIndex: slot.routeIndex,
        box: { ...slot.box },
        state: slot.state,
        hasContent: blockIds.length > 0,
        blockIds,
        lineCount: linesBySlot.get(slot.id) ?? 0,
        blockedBy,
      };
    })
    .sort((left, right) => left.page - right.page || left.routeIndex - right.routeIndex || left.slotId.localeCompare(right.slotId));
}

/** Splits a text-flow placement at each overlapping wrap graphic. */
export function splitFlowBarrierBoxCandidates(
  textPlacements: Array<Pick<CompositionFlowPlacement, 'id' | 'flowId' | 'page' | 'slotId' | 'box'>>,
  graphics: CompositionGraphicPlacement[],
): CompositionFlowBarrierBoxCandidate[] {
  const barriers = graphics.filter((candidate) => candidate.wrap === 'around');
  const candidates: CompositionFlowBarrierBoxCandidate[] = [];
  for (const placement of textPlacements) {
    const placementBottom = rectBottom(placement.box);
    const boundaries = barriers
      .filter((candidate) => candidate.page === placement.page && candidate.slotId !== placement.slotId && horizontalOverlap(placement.box, candidate.box) && rectsOverlap(placement.box, candidate.box))
      .filter((candidate) => coversFlowWidth(placement.box, candidate.box))
      .sort((left, right) => left.box.y - right.box.y || left.graphicId.localeCompare(right.graphicId));
    if (boundaries.length === 0) continue;
    let segmentTop = placement.box.y;
    let previousSourceId: string | undefined;
    for (const boundary of boundaries) {
      const boundaryTop = Math.max(placement.box.y, Math.min(placementBottom, boundary.box.y));
      if (boundaryTop > segmentTop) {
        candidates.push({
          id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:${boundary.graphicId}`,
          flowId: placement.flowId,
          ...(previousSourceId === undefined ? {} : { previousSourceId }),
          nextSourceId: boundary.graphicId,
          placementId: placement.id,
          page: placement.page,
          box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: boundaryTop - segmentTop },
        });
      }
      segmentTop = Math.max(segmentTop, Math.min(placementBottom, rectBottom(boundary.box)));
      previousSourceId = boundary.graphicId;
    }
    if (placementBottom > segmentTop) {
      candidates.push({
        id: `flow-barrier-box:${placement.page}:${placement.flowId}:${placement.id}:${previousSourceId ?? 'flow-start'}:flow-end`,
        flowId: placement.flowId,
        ...(previousSourceId === undefined ? {} : { previousSourceId }),
        placementId: placement.id,
        page: placement.page,
        box: { x: placement.box.x, y: segmentTop, width: placement.box.width, height: placementBottom - segmentTop },
      });
    }
  }
  return candidates.sort((left, right) => left.page - right.page || left.box.y - right.box.y || left.flowId.localeCompare(right.flowId) || left.placementId.localeCompare(right.placementId) || (left.nextSourceId ?? '').localeCompare(right.nextSourceId ?? ''));
}

export function flowBarrierBoxCandidatesForSlot(
  page: number,
  slot: CompositionSlot,
  flowId: string,
  graphics: CompositionGraphicPlacement[],
): CompositionFlowBarrierBoxCandidate[] {
  if (slot.kind !== 'text') return [];
  return splitFlowBarrierBoxCandidates([{
    id: `flow-placement:${slot.id}`,
    flowId,
    page,
    slotId: slot.id,
    box: { ...slot.box },
  }], graphics);
}

export function registerFlowBarrierBoxCandidates(plan: CompositionPlan): CompositionFlowBarrierBoxCandidate[] {
  const textPlacements = (plan.flowPlacements ?? []).filter((placement) => placement.flowId !== undefined);
  return splitFlowBarrierBoxCandidates(textPlacements, plan.graphicPlacements);
}
