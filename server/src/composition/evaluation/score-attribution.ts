import type { CompositionDocument } from '../contracts/model.js';
import type {
  CompositionPlan,
  CompositionPlacementScore,
  CompositionScoreComponent,
  CompositionScorePlacement,
} from '../contracts/engine-contracts.js';

type DetailRecord = Record<string, unknown>;

interface PlacementIndex {
  placements: CompositionScorePlacement[];
  byId: Map<string, CompositionScorePlacement>;
  byBlock: Map<string, CompositionScorePlacement[]>;
  byGraphic: Map<string, CompositionScorePlacement[]>;
  byPage: Map<number, CompositionScorePlacement[]>;
  byPageSlot: Map<string, CompositionScorePlacement[]>;
  byFlowPage: Map<string, CompositionScorePlacement[]>;
  byPageRegion: Map<string, CompositionScorePlacement[]>;
}

function isRecord(value: unknown): value is DetailRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function indexedAppend<T>(index: Map<string | number, T[]>, key: string | number, value: T): void {
  index.set(key, [...(index.get(key) ?? []), value]);
}

function placementKey(page: number, slotId: string | undefined, flowId: string | undefined, blockId: string | undefined, fallbackId: string): string {
  return `${page}:${slotId ?? ''}:${flowId ?? ''}:${blockId ?? fallbackId}`;
}

/** Project a material graphic into the same stable placement identity used by score attribution. */
export function scorePlacementForGraphic(document: CompositionDocument, graphic: CompositionPlan['graphicPlacements'][number]): CompositionScorePlacement {
  const blockId = graphic.graphicId.startsWith('insertion:') ? graphic.graphicId.slice('insertion:'.length) : undefined;
  const flowId = blockId === undefined
    ? undefined
    : Object.values(document.flows).find((flow) => flow.blocks.some((block) => block.id === blockId))?.id;
  return {
    id: placementKey(graphic.page, graphic.slotId, flowId, blockId, graphic.graphicId),
    kind: 'graphic',
    page: graphic.page,
    slotId: graphic.slotId,
    graphicId: graphic.graphicId,
    ...(blockId === undefined ? {} : { blockId }),
    ...(flowId === undefined ? {} : { flowId }),
  };
}

function placementIndex(document: CompositionDocument, plan: CompositionPlan): PlacementIndex {
  const grouped = new Map<string, CompositionScorePlacement>();
  const blockFlowIds = new Map(Object.values(document.flows).flatMap((flow) => flow.blocks.map((block) => [block.id, flow.id] as const)));
  const add = (placement: CompositionScorePlacement, key: string): void => {
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, placement);
      return;
    }
    const precedence = { text: 0, block: 1, table: 2, graphic: 3, glyph: 4 } as const;
    if (precedence[placement.kind] > precedence[existing.kind]) existing.kind = placement.kind;
    existing.graphicId ??= placement.graphicId;
    existing.glyphId ??= placement.glyphId;
    existing.flowId ??= placement.flowId;
    existing.blockId ??= placement.blockId;
  };

  for (const line of [...plan.lines, ...(plan.insertionLines ?? [])]) {
    const flowId = line.flowId || blockFlowIds.get(line.blockId);
    const placement: CompositionScorePlacement = {
      id: placementKey(line.page, line.slotId, flowId, line.blockId, line.blockId),
      kind: 'text', page: line.page, slotId: line.slotId, blockId: line.blockId,
      ...(flowId === undefined ? {} : { flowId }),
    };
    add(placement, placement.id);
  }
  for (const block of plan.blockPlacements) {
    const flowId = blockFlowIds.get(block.blockId);
    const placement: CompositionScorePlacement = {
      id: placementKey(block.page, block.slotId, flowId, block.blockId, block.id),
      kind: 'block', page: block.page, slotId: block.slotId, blockId: block.blockId,
      ...(flowId === undefined ? {} : { flowId }),
    };
    add(placement, placement.id);
  }
  for (const table of plan.tablePlacements) {
    const flowId = blockFlowIds.get(table.blockId);
    const placement: CompositionScorePlacement = {
      id: placementKey(table.page, table.slotId, flowId, table.blockId, table.id),
      kind: 'table', page: table.page, slotId: table.slotId, blockId: table.blockId,
      ...(flowId === undefined ? {} : { flowId }),
    };
    add(placement, placement.id);
  }
  for (const graphic of plan.graphicPlacements) {
    const placement = scorePlacementForGraphic(document, graphic);
    add(placement, placement.id);
  }
  for (const glyph of plan.glyphPlacements ?? []) {
    const placement: CompositionScorePlacement = {
      id: glyph.id, kind: 'glyph', page: glyph.page, glyphId: glyph.glyphId,
      ...(glyph.flowId === undefined ? {} : { flowId: glyph.flowId }),
      ...(glyph.targetType === 'block' ? { blockId: glyph.targetId } : { graphicId: glyph.targetId }),
      ...(glyph.slotId === undefined ? {} : { slotId: glyph.slotId }),
    };
    add(placement, `glyph:${glyph.id}`);
  }

  const placements = [...grouped.values()].sort((left, right) => left.id.localeCompare(right.id));
  const index: PlacementIndex = {
    placements,
    byId: new Map(),
    byBlock: new Map(),
    byGraphic: new Map(),
    byPage: new Map(),
    byPageSlot: new Map(),
    byFlowPage: new Map(),
    byPageRegion: new Map(),
  };
  for (const placement of placements) {
    index.byId.set(placement.id, placement);
    if (placement.blockId !== undefined) indexedAppend(index.byBlock, placement.blockId, placement);
    if (placement.graphicId !== undefined) indexedAppend(index.byGraphic, placement.graphicId, placement);
    indexedAppend(index.byPage, placement.page, placement);
    if (placement.slotId !== undefined) indexedAppend(index.byPageSlot, `${placement.page}:${placement.slotId}`, placement);
    if (placement.flowId !== undefined) indexedAppend(index.byFlowPage, `${placement.flowId}:${placement.page}`, placement);
  }
  for (const slot of plan.slots) {
    const placementsInSlot = index.byPageSlot.get(`${slot.page}:${slot.id}`) ?? [];
    if (placementsInSlot.length > 0) index.byPageRegion.set(`${slot.page}:${slot.regionId}`, [
      ...(index.byPageRegion.get(`${slot.page}:${slot.regionId}`) ?? []),
      ...placementsInSlot,
    ]);
  }
  return index;
}

function matchingPlacements(index: PlacementIndex, record: DetailRecord): CompositionScorePlacement[] {
  let scoped = index.placements;
  if (finiteNumber(record.page)) scoped = scoped.filter((placement) => placement.page === record.page);
  if (typeof record.flowId === 'string') scoped = scoped.filter((placement) => placement.flowId === record.flowId);
  if (typeof record.slotId === 'string') scoped = scoped.filter((placement) => placement.slotId === record.slotId);
  const referenced = new Set<CompositionScorePlacement>();
  if (typeof record.blockId === 'string') for (const placement of index.byBlock.get(record.blockId) ?? []) referenced.add(placement);
  if (typeof record.graphicId === 'string') for (const placement of index.byGraphic.get(record.graphicId) ?? []) referenced.add(placement);
  if (typeof record.glyphPlacementId === 'string' && index.byId.has(record.glyphPlacementId)) referenced.add(index.byId.get(record.glyphPlacementId)!);
  if (typeof record.placementId === 'string' && index.byId.has(record.placementId)) referenced.add(index.byId.get(record.placementId)!);
  if (typeof record.id === 'string') {
    const byGraphic = index.byGraphic.get(record.id);
    const byBlock = index.byBlock.get(record.id);
    for (const placement of [...(byGraphic ?? []), ...(byBlock ?? [])]) referenced.add(placement);
  }
  return referenced.size > 0 ? scoped.filter((placement) => referenced.has(placement)) : [];
}

function addStringIds(index: PlacementIndex, key: string, value: unknown, affected: Set<CompositionScorePlacement>): void {
  if (!Array.isArray(value)) return;
  for (const id of value) {
    if (typeof id !== 'string') continue;
    if (key === 'blockingInsertionIds') {
      for (const placement of index.byGraphic.get(id) ?? []) affected.add(placement);
    } else {
      for (const placement of index.byBlock.get(id) ?? []) affected.add(placement);
    }
  }
}

function collectDetailPlacements(index: PlacementIndex, value: unknown, affected: Set<CompositionScorePlacement>, key = ''): void {
  if (Array.isArray(value)) {
    if (key === 'keptHeadingIds' || key === 'fragmentedBlockIds' || key === 'blockIds' || key === 'blockingInsertionIds') {
      addStringIds(index, key, value, affected);
    }
    for (const item of value) collectDetailPlacements(index, item, affected);
    return;
  }
  if (!isRecord(value)) return;
  const referencesPage = finiteNumber(value.page);
  const hasIdentity = typeof value.flowId === 'string'
    || typeof value.blockId === 'string'
    || typeof value.graphicId === 'string'
    || typeof value.slotId === 'string'
    || typeof value.glyphPlacementId === 'string'
    || typeof value.placementId === 'string';
  if (hasIdentity) {
    for (const placement of matchingPlacements(index, value)) affected.add(placement);
  }
  if (typeof value.fromBlockId === 'string') {
    for (const placement of index.byBlock.get(value.fromBlockId) ?? []) affected.add(placement);
  }
  if (typeof value.toBlockId === 'string') {
    for (const placement of index.byBlock.get(value.toBlockId) ?? []) affected.add(placement);
  }
  if (typeof value.key === 'string') {
    const separator = value.key.indexOf(':');
    const page = Number(value.key.slice(0, separator));
    if (separator > 0 && Number.isInteger(page)) {
      const regionId = value.key.slice(separator + 1);
      for (const placement of index.byPageRegion.get(`${page}:${regionId}`) ?? []) affected.add(placement);
    }
  }
  const hasNestedPair = isRecord(value.from) || isRecord(value.to);
  if (referencesPage && !hasIdentity && !hasNestedPair && (key === 'pages' || 'gap' in value || 'deficit' in value)) {
    for (const placement of index.byPage.get(value.page as number) ?? []) affected.add(placement);
  }
  for (const [childKey, child] of Object.entries(value)) collectDetailPlacements(index, child, affected, childKey);
}

function collectPages(value: unknown, pages: Set<number>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectPages(item, pages);
    return;
  }
  if (!isRecord(value)) return;
  if (finiteNumber(value.page)) pages.add(value.page);
  for (const child of Object.values(value)) collectPages(child, pages);
}

function placementsForComponent(
  component: CompositionScoreComponent,
  document: CompositionDocument,
  plan: CompositionPlan,
  index: PlacementIndex,
): CompositionScorePlacement[] {
  const affected = new Set<CompositionScorePlacement>();
  if (component.code === 'glyph-overlap') {
    const records = isRecord(component.details) && Array.isArray(component.details.records) ? component.details.records : [];
    for (const record of records) {
      if (!isRecord(record) || !finiteNumber(record.page)) continue;
      if (typeof record.glyphPlacementId === 'string') {
        for (const placement of index.placements) {
          if (placement.kind === 'glyph' && placement.id === record.glyphPlacementId && placement.page === record.page) affected.add(placement);
        }
      }
      if (typeof record.blockId === 'string') {
        for (const placement of index.byBlock.get(record.blockId) ?? []) {
          if (placement.page === record.page) affected.add(placement);
        }
      }
    }
  } else if (component.code === 'empty-regions') {
    const regions = isRecord(component.details) && Array.isArray(component.details.regions) ? component.details.regions : [];
    for (const region of regions) {
      if (!isRecord(region) || !finiteNumber(region.page)) continue;
      const regionPlacements = typeof region.regionId === 'string'
        ? index.byPageRegion.get(`${region.page}:${region.regionId}`) ?? []
        : [];
      if (regionPlacements.length > 0) {
        for (const placement of regionPlacements) affected.add(placement);
      } else {
        // An empty region has no local placement to own its penalty. In that
        // case, use the material placements on the same page as deterministic
        // participants in this page-level whitespace score.
        for (const placement of index.byPage.get(region.page) ?? []) affected.add(placement);
      }
    }
  } else {
    collectDetailPlacements(index, component.details, affected);
  }
  if (component.code === 'column-balance' && isRecord(component.details) && Array.isArray(component.details.pages)) {
    for (const pageRecord of component.details.pages) {
      if (!isRecord(pageRecord) || typeof pageRecord.page !== 'string') continue;
      const separator = pageRecord.page.lastIndexOf(':');
      const flowId = pageRecord.page.slice(0, separator);
      const page = Number(pageRecord.page.slice(separator + 1));
      if (separator > 0 && Number.isInteger(page)) {
        for (const placement of index.byFlowPage.get(`${flowId}:${page}`) ?? []) affected.add(placement);
      }
    }
  }
  if (component.code === 'header-spacing' && isRecord(component.details) && Array.isArray(component.details.pages)) {
    for (const pageRecord of component.details.pages) {
      if (!isRecord(pageRecord) || !finiteNumber(pageRecord.page)) continue;
      let pairPlacements = 0;
      for (const subject of [pageRecord.from, pageRecord.to]) {
        if (!isRecord(subject)) continue;
        const matches = matchingPlacements(index, { page: pageRecord.page, ...subject });
        for (const placement of matches) affected.add(placement);
        pairPlacements += matches.length;
      }
      if (pairPlacements === 0) {
        for (const placement of index.byPage.get(pageRecord.page) ?? []) affected.add(placement);
      }
    }
  }
  if (component.code === 'orphan-lines') {
    for (const orphan of isRecord(component.details) && Array.isArray(component.details.orphans) ? component.details.orphans : []) {
      if (!isRecord(orphan) || !finiteNumber(orphan.page)) continue;
      if (typeof orphan.blockId === 'string') {
        for (const placement of index.byBlock.get(orphan.blockId) ?? []) {
          if (placement.page === orphan.page && (orphan.slotId === undefined || placement.slotId === orphan.slotId)) affected.add(placement);
        }
      }
      if (typeof orphan.graphicId === 'string') {
        for (const placement of index.byGraphic.get(orphan.graphicId) ?? []) if (placement.page === orphan.page) affected.add(placement);
      }
    }
  }
  if (component.code === 'contrast') {
    const assessments = isRecord(component.details) && Array.isArray(component.details.assessments) ? component.details.assessments : [];
    for (const assessment of assessments) {
      if (!isRecord(assessment)) continue;
      if (typeof assessment.graphicId === 'string') {
        for (const placement of index.byGraphic.get(assessment.graphicId) ?? []) affected.add(placement);
      } else if (finiteNumber(assessment.page)) {
        for (const placement of index.byPage.get(assessment.page) ?? []) affected.add(placement);
      }
    }
  }
  if (affected.size === 0 && component.points !== 0) {
    const reportedPages = new Set<number>();
    collectPages(component.details, reportedPages);
    for (const page of reportedPages) {
      for (const placement of index.byPage.get(page) ?? []) affected.add(placement);
    }
    // A genuinely plan-wide component with no page-scoped evidence is shared
    // deterministically across all materialized placements.
    if (reportedPages.size === 0) for (const placement of index.placements) affected.add(placement);
  }
  if (affected.size === 0 && component.points !== 0 && document.flows) {
    throw new Error(`Cannot attribute non-zero composition score component '${component.code}' to a material placement.`);
  }
  return [...affected].sort((left, right) => left.id.localeCompare(right.id));
}

/** Attribute each existing whole-plan component exactly once across its measured placements. */
export function attributeCompositionScore(
  document: CompositionDocument,
  plan: CompositionPlan,
  breakdown: CompositionScoreComponent[],
): CompositionPlacementScore[] {
  const index = placementIndex(document, plan);
  const byPlacement = new Map<string, CompositionPlacementScore>();
  for (const component of breakdown) {
    if (component.points === 0) continue;
    const placements = placementsForComponent(component, document, plan, index);
    if (placements.length === 0) continue;
    let allocated = 0;
    placements.forEach((placement, position) => {
      const points = position === placements.length - 1
        ? component.points - allocated
        : component.points / placements.length;
      allocated += points;
      const existing = byPlacement.get(placement.id) ?? { placement, points: 0, contributions: [] };
      existing.points += points;
      existing.contributions.push({ code: component.code, points });
      byPlacement.set(placement.id, existing);
    });
  }
  return [...byPlacement.values()].sort((left, right) => left.placement.id.localeCompare(right.placement.id));
}
