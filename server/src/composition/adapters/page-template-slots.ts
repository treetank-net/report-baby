import type { PageGeometry } from '../../template/geometry.js';
import type { CompiledTemplate } from '../../template/contracts.js';
import type {
  CompositionBlockKind,
  CompositionBlockRole,
  CompositionSlotTemplate,
} from '../contracts/model.js';

export function normalizedBox(
  frame: { x: number; y: number; width: number; height: number },
  geometry: PageGeometry,
): { x: number; y: number; width: number; height: number } {
  return {
    x: frame.x * geometry.width,
    y: frame.y * geometry.height,
    width: frame.width * geometry.width,
    height: frame.height * geometry.height,
  };
}

export function slotGrowth(
  source: CompiledTemplate['slots'][string],
  geometry: PageGeometry,
): CompositionSlotTemplate['grow'] | undefined {
  if (!source.grow) return undefined;
  const frame = source.frame;
  const frameY = frame.y * geometry.height;
  const pageBottom = geometry.bands.footer?.top ?? geometry.height - geometry.margins.bottom;
  const maxHeight = source.grow.auto
    ? Math.max(frame.height * geometry.height, pageBottom - frameY)
    : source.grow.maxHeight * geometry.height;
  return {
    axis: source.grow.axis,
    maxHeight,
    ...(source.grow.pushes === undefined ? {} : { pushes: [...source.grow.pushes] }),
  };
}

function sourceSlotIdsForFlow(compiled: CompiledTemplate, flowId: string, sourceSlotIds?: string[]): string[] {
  return sourceSlotIds ?? compiled.flows[flowId]?.slots ?? [];
}

export function declaredTextSlotsForFlow(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
  sourceSlotIds?: string[],
): CompositionSlotTemplate[] {
  return sourceSlotIdsForFlow(compiled, flowId, sourceSlotIds).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || source.kind !== 'text') return [];
    const growth = slotGrowth(source, pageGeometry);
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'text' as const,
      box: normalizedBox(source.frame, pageGeometry),
      ...(source.role ? { allowedRoles: [source.role as CompositionBlockRole] } : {}),
      ...(source.role === 'intro' || source.role === 'title' ? { firstPageOnly: true } : {}),
      ...(source.allowedBlockIds ? { allowedBlockIds: source.allowedBlockIds } : {}),
      ...(source.allowedBlockKinds ? { allowedBlockKinds: source.allowedBlockKinds as CompositionBlockKind[] } : {}),
      ...(source.textAlign ? { textAlign: source.textAlign } : {}),
      ...(source.verticalAlign ? { verticalAlign: source.verticalAlign } : {}),
      ...(source.fitContent === undefined ? {} : { fitContent: source.fitContent }),
      ...(growth === undefined ? {} : { grow: growth }),
    }];
  });
}

/**
 * @planner-target composition/adapters/page-template-slots.ts
 * @planner-responsibility Attach content-segment targets to declared main-slot growth.
 */
export function addContentSegmentGrowthTargets(
  slot: CompositionSlotTemplate,
  source: CompiledTemplate['slots'][string],
  segments: CompositionSlotTemplate[],
): CompositionSlotTemplate {
  if (!slot.grow || segments.length === 0) return slot;
  if (!source.grow?.auto && (source.grow?.pushes?.length ?? 0) === 0) return slot;
  const bottom = slot.box.y + slot.box.height;
  const pushes = segments.filter((segment) => segment.box.y >= bottom).map((segment) => segment.id);
  return {
    ...slot,
    grow: { ...slot.grow, pushes: [...new Set([...(slot.grow.pushes ?? []), ...pushes])] },
  };
}

export function declaredMainTextSlots(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
  sourceSlotIds: string[],
  segments: CompositionSlotTemplate[],
): CompositionSlotTemplate[] {
  return declaredTextSlotsForFlow(compiled, flowId, pageGeometry, sourceSlotIds)
    .filter((slot) => slot.id !== 'content')
    .map((slot) => {
      const source = compiled.slots[slot.id];
      return source ? addContentSegmentGrowthTargets(slot, source, segments) : slot;
    });
}

function blockKindsForSource(kind: CompiledTemplate['slots'][string]['kind']): CompositionBlockKind[] {
  return kind === 'image'
    ? ['image']
    : kind === 'metric-card'
      ? ['metric']
      : kind === 'chart'
        ? ['chart', 'image']
        : ['table'];
}

export function declaredBlockSlotsForFlow(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
  sourceSlotIds?: string[],
): CompositionSlotTemplate[] {
  return sourceSlotIdsForFlow(compiled, flowId, sourceSlotIds).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || !['image', 'metric-card', 'chart', 'table'].includes(source.kind)) return [];
    const growth = slotGrowth(source, pageGeometry);
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'block' as const,
      box: normalizedBox(source.frame, pageGeometry),
      ...(source.role ? { allowedRoles: [source.role as CompositionBlockRole] } : {}),
      ...(source.role === 'intro' || source.role === 'title' ? { firstPageOnly: true } : {}),
      allowedBlockKinds: (source.allowedBlockKinds as CompositionBlockKind[] | undefined) ?? blockKindsForSource(source.kind),
      ...(growth === undefined ? {} : { grow: growth }),
    }];
  });
}

export function declaredLockupSlotsForFlow(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
): CompositionSlotTemplate[] {
  return (compiled.flows[flowId]?.slots ?? []).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || source.kind !== 'lockup') return [];
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'block' as const,
      box: normalizedBox(source.frame, pageGeometry),
      ...(source.role ? { allowedRoles: [source.role as CompositionBlockRole] } : {}),
      ...(source.role === 'intro' || source.role === 'title' ? { firstPageOnly: true } : {}),
      allowedBlockKinds: ['lockup' as CompositionBlockKind],
      ...(source.fitContent === undefined ? {} : { fitContent: source.fitContent }),
      ...(slotGrowth(source, pageGeometry) === undefined ? {} : { grow: slotGrowth(source, pageGeometry) }),
    }];
  });
}

export function declaredGraphicSlots(
  compiled: CompiledTemplate,
  pageGeometry: PageGeometry,
): CompositionSlotTemplate[] {
  return Object.entries(compiled.slots)
    .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1]?.kind === 'graphic')
    .map(([id, source]) => ({
      id,
      regionId: source.region ?? 'content',
      kind: 'graphic' as const,
    box: normalizedBox(source.frame, pageGeometry),
    }));
}

export function expandGrowthTargets(
  slots: CompositionSlotTemplate[],
  segments: CompositionSlotTemplate[],
): CompositionSlotTemplate[] {
  return slots.map((slot) => {
    if (!slot.grow?.pushes?.includes('content')) return slot;
    return {
      ...slot,
      grow: {
        ...slot.grow,
        pushes: [...new Set(slot.grow.pushes.flatMap((target) => target === 'content' ? segments.map((segment) => segment.id) : [target]))],
      },
    };
  });
}
