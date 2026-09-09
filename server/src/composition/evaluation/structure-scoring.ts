import { readRenderConfig } from '../../template/builtins.js';

import type { CompositionBlock, CompositionDocument } from '../contracts/model.js';
import type { CompositionLine, CompositionPlan, CompositionScoreComponent } from '../contracts/engine-contracts.js';

import { allLines } from './plan-queries.js';

function scoreConfigNumber(key: string): number {
  const value = readRenderConfig().compositionScore[key];
  if (!Number.isFinite(value)) throw new Error(`Render configuration is missing finite composition_score.${key}.`);
  return value;
}

type FragmentLocation = {
  page: number;
  slotId: string;
  routeIndex?: number;
  lineCount: number;
};

type ListContinuityDetail = {
  flowId: string;
  blockIds: string[];
  itemFragmentations: Array<{ blockId: string; fragments: number }>;
  pageSplits: Array<{ fromBlockId: string; toBlockId: string; page: number; nextPage: number }>;
  columnSplits: Array<{ fromBlockId: string; toBlockId: string; page: number; fromSlotId: string; toSlotId: string }>;
};

type TableContinuityDetail = {
  blockId: string;
  flowId?: string;
  fragments: number;
  pageSplits: number;
  columnSplits: number;
  widowFragments: Array<{ page: number; startRow: number; endRow: number; repeatsHeader: boolean }>;
};

type TinyFragmentDetail = {
  blockId: string;
  flowId: string;
  kind: CompositionBlock['kind'];
  page: number;
  slotId: string;
  lineCount: number;
  side: 'first' | 'last';
};

function visualLineOrder(left: CompositionLine, right: CompositionLine): number {
  return left.page - right.page
    || (left.routeIndex ?? 0) - (right.routeIndex ?? 0)
    || left.box.y - right.box.y
    || left.box.x - right.box.x;
}

function fragmentLocations(lines: CompositionLine[]): FragmentLocation[] {
  const groups = new Map<string, FragmentLocation>();
  for (const line of lines) {
    const key = `${line.page}:${line.slotId}:${line.routeIndex ?? ''}`;
    const previous = groups.get(key);
    groups.set(key, previous === undefined
      ? { page: line.page, slotId: line.slotId, ...(line.routeIndex === undefined ? {} : { routeIndex: line.routeIndex }), lineCount: 1 }
      : { ...previous, lineCount: previous.lineCount + 1 });
  }
  return [...groups.values()].sort((left, right) => left.page - right.page
    || (left.routeIndex ?? 0) - (right.routeIndex ?? 0)
    || left.slotId.localeCompare(right.slotId));
}

function linesByBlock(plan: CompositionPlan): Map<string, CompositionLine[]> {
  const grouped = new Map<string, CompositionLine[]>();
  for (const line of allLines(plan)) grouped.set(line.blockId, [...(grouped.get(line.blockId) ?? []), line]);
  return grouped;
}

function contiguousListRuns(document: CompositionDocument): Array<{ flowId: string; blocks: CompositionBlock[] }> {
  return Object.values(document.flows).flatMap((flow) => {
    const runs: Array<{ flowId: string; blocks: CompositionBlock[] }> = [];
    let current: CompositionBlock[] = [];
    const flush = (): void => {
      if (current.length > 0) runs.push({ flowId: flow.id, blocks: current });
      current = [];
    };
    for (const block of flow.blocks) {
      if (block.kind === 'list-item') current.push(block);
      else flush();
    }
    flush();
    return runs;
  });
}

function listContinuityDetails(document: CompositionDocument, plan: CompositionPlan): ListContinuityDetail[] {
  const grouped = linesByBlock(plan);
  return contiguousListRuns(document).map(({ flowId, blocks }) => {
    const itemFragmentations = blocks.flatMap((block) => {
      const fragments = fragmentLocations(grouped.get(block.id) ?? []).length;
      return fragments > 1 ? [{ blockId: block.id, fragments }] : [];
    });
    const transitions = blocks.flatMap((block, index) => {
      if (index === 0) return [];
      const previousLines = [...(grouped.get(blocks[index - 1].id) ?? [])].sort(visualLineOrder);
      const currentLines = [...(grouped.get(block.id) ?? [])].sort(visualLineOrder);
      const previous = previousLines.at(-1);
      const current = currentLines[0];
      if (!previous || !current || (previous.page === current.page && previous.slotId === current.slotId)) return [];
      return [{ previous, current, fromBlockId: blocks[index - 1].id, toBlockId: block.id }];
    });
    return {
      flowId,
      blockIds: blocks.map((block) => block.id),
      itemFragmentations,
      pageSplits: transitions.flatMap(({ previous, current, fromBlockId, toBlockId }) => previous.page === current.page
        ? []
        : [{ fromBlockId, toBlockId, page: previous.page, nextPage: current.page }]),
      columnSplits: transitions.flatMap(({ previous, current, fromBlockId, toBlockId }) => previous.page !== current.page
        ? []
        : [{ fromBlockId, toBlockId, page: previous.page, fromSlotId: previous.slotId, toSlotId: current.slotId }]),
    };
  }).filter((detail) => detail.itemFragmentations.length > 0 || detail.pageSplits.length > 0 || detail.columnSplits.length > 0);
}

function blockFlowIds(document: CompositionDocument): Map<string, string> {
  return new Map(Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => [block.id, flow.id] as const)));
}

function tableContinuityDetails(document: CompositionDocument, plan: CompositionPlan): TableContinuityDetail[] {
  const flowIds = blockFlowIds(document);
  const minimumRows = Math.max(1, Math.floor(scoreConfigNumber('tableWidowMinRows')));
  const grouped = new Map<string, typeof plan.tablePlacements>();
  for (const placement of plan.tablePlacements) grouped.set(placement.blockId, [...(grouped.get(placement.blockId) ?? []), placement]);
  return [...grouped.entries()].flatMap(([blockId, placements]) => {
    const ordered = [...placements].sort((left, right) => left.startRow - right.startRow || left.page - right.page);
    if (ordered.length < 2 && !ordered.some((placement) => placement.repeatsHeader && placement.endRow - placement.startRow < minimumRows)) return [];
    const pageSplits = ordered.slice(1).filter((placement, index) => placement.page !== ordered[index].page).length;
    const columnSplits = ordered.slice(1).filter((placement, index) => placement.page === ordered[index].page && placement.slotId !== ordered[index].slotId).length;
    const widowFragments = ordered
      .filter((placement) => placement.repeatsHeader && placement.endRow - placement.startRow < minimumRows)
      .map((placement) => ({ page: placement.page, startRow: placement.startRow, endRow: placement.endRow, repeatsHeader: placement.repeatsHeader }));
    return [{ blockId, ...(flowIds.get(blockId) === undefined ? {} : { flowId: flowIds.get(blockId) }), fragments: ordered.length, pageSplits, columnSplits, widowFragments }];
  });
}

function tinyFragmentDetails(document: CompositionDocument, plan: CompositionPlan): TinyFragmentDetail[] {
  const limit = Math.max(1, Math.floor(scoreConfigNumber('tinyFragmentMaxLines')));
  const flowIds = blockFlowIds(document);
  const grouped = linesByBlock(plan);
  return [...grouped.entries()].flatMap(([blockId, lines]) => {
    const block = Object.values(document.flows).flatMap((flow) => flow.blocks).find((candidate) => candidate.id === blockId);
    if (!block || (block.kind !== 'paragraph' && block.kind !== 'list-item')) return [];
    const locations = fragmentLocations(lines);
    if (locations.length < 2) return [];
    return [
      ...(locations[0].lineCount <= limit ? [{ blockId, flowId: flowIds.get(blockId) ?? '', kind: block.kind, page: locations[0].page, slotId: locations[0].slotId, lineCount: locations[0].lineCount, side: 'first' as const }] : []),
      ...(locations.at(-1)!.lineCount <= limit ? [{ blockId, flowId: flowIds.get(blockId) ?? '', kind: block.kind, page: locations.at(-1)!.page, slotId: locations.at(-1)!.slotId, lineCount: locations.at(-1)!.lineCount, side: 'last' as const }] : []),
    ];
  });
}

export function scoreListContinuity(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const details = listContinuityDetails(document, plan);
  const itemFragmentations = details.reduce((sum, detail) => sum + detail.itemFragmentations.length, 0);
  const pageSplits = details.reduce((sum, detail) => sum + detail.pageSplits.length, 0);
  const columnSplits = details.reduce((sum, detail) => sum + detail.columnSplits.length, 0);
  const points = -itemFragmentations * scoreConfigNumber('listItemFragmentationPenalty')
    -pageSplits * scoreConfigNumber('listSplitPenalty')
    -columnSplits * scoreConfigNumber('listColumnSplitPenalty');
  return { code: 'list-continuity', value: itemFragmentations + pageSplits + columnSplits, points, details: { runs: details, itemFragmentations, pageSplits, columnSplits } };
}

export function scoreTableContinuity(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const details = tableContinuityDetails(document, plan);
  const fragments = details.reduce((sum, detail) => sum + Math.max(0, detail.fragments - 1), 0);
  const pageSplits = details.reduce((sum, detail) => sum + detail.pageSplits, 0);
  const columnSplits = details.reduce((sum, detail) => sum + detail.columnSplits, 0);
  const widowFragments = details.reduce((sum, detail) => sum + detail.widowFragments.length, 0);
  const points = -fragments * scoreConfigNumber('tableSplitPenalty')
    -columnSplits * scoreConfigNumber('tableColumnSplitPenalty')
    -widowFragments * scoreConfigNumber('tableWidowPenalty');
  return { code: 'table-continuity', value: fragments + columnSplits + widowFragments, points, details: { tables: details, fragments, pageSplits, columnSplits, widowFragments } };
}

export function scoreTinyFragments(document: CompositionDocument, plan: CompositionPlan): CompositionScoreComponent {
  const fragments = tinyFragmentDetails(document, plan);
  return {
    code: 'tiny-fragments',
    value: fragments.length,
    points: -fragments.length * scoreConfigNumber('tinyFragmentPenalty'),
    details: { maxLines: Math.max(1, Math.floor(scoreConfigNumber('tinyFragmentMaxLines'))), fragments },
  };
}
