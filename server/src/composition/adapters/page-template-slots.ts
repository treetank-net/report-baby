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

export function slotFrame(
  source: CompiledTemplate['slots'][string],
  continuation: boolean,
): { x: number; y: number; width: number; height: number } {
  return continuation ? source.continuationFrame ?? source.frame : source.frame;
}

export function slotGrowth(
  source: CompiledTemplate['slots'][string],
  geometry: PageGeometry,
  continuation = false,
): CompositionSlotTemplate['grow'] | undefined {
  if (!source.grow) return undefined;
  const frame = slotFrame(source, continuation);
  const frameY = frame.y * geometry.height;
  const pageBottom = geometry.bands.footer?.top ?? geometry.continuationBottom ?? geometry.height - geometry.margins.bottom;
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
  continuation = false,
  sourceSlotIds?: string[],
): CompositionSlotTemplate[] {
  return sourceSlotIdsForFlow(compiled, flowId, sourceSlotIds).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || source.kind !== 'text') return [];
    const growth = slotGrowth(source, pageGeometry, continuation);
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'text' as const,
      box: normalizedBox(slotFrame(source, continuation), pageGeometry),
      ...(source.role ? { allowedRoles: [source.role as CompositionBlockRole] } : {}),
      ...(source.allowedBlockIds ? { allowedBlockIds: source.allowedBlockIds } : {}),
      ...(source.allowedBlockKinds ? { allowedBlockKinds: source.allowedBlockKinds as CompositionBlockKind[] } : {}),
      ...(source.textAlign ? { textAlign: source.textAlign } : {}),
      ...(source.verticalAlign ? { verticalAlign: source.verticalAlign } : {}),
      ...(source.fitContent === undefined ? {} : { fitContent: source.fitContent }),
      ...(growth === undefined ? {} : { grow: growth }),
    }];
  });
}

export function addAutomaticSegmentPushes(
  slot: CompositionSlotTemplate,
  source: CompiledTemplate['slots'][string],
  segments: CompositionSlotTemplate[],
): CompositionSlotTemplate {
  if (!source.grow?.auto) return slot;
  const bottom = slot.box.y + slot.box.height;
  const pushes = segments.filter((segment) => segment.box.y >= bottom).map((segment) => segment.id);
  return {
    ...slot,
    grow: slot.grow ? { ...slot.grow, pushes: [...new Set([...(slot.grow.pushes ?? []), ...pushes])] } : undefined,
  };
}

export function declaredMainTextSlots(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
  sourceSlotIds: string[],
  segments: CompositionSlotTemplate[],
  continuation = false,
): CompositionSlotTemplate[] {
  return declaredTextSlotsForFlow(compiled, flowId, pageGeometry, continuation, sourceSlotIds)
    .filter((slot) => slot.id !== 'content')
    .map((slot) => {
      const source = compiled.slots[slot.id];
      return source ? addAutomaticSegmentPushes(slot, source, segments) : slot;
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
  continuation = false,
): CompositionSlotTemplate[] {
  return sourceSlotIdsForFlow(compiled, flowId, sourceSlotIds).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || !['image', 'metric-card', 'chart', 'table'].includes(source.kind)) return [];
    const growth = slotGrowth(source, pageGeometry, continuation);
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'block' as const,
      box: normalizedBox(slotFrame(source, continuation), pageGeometry),
      ...(source.role ? { allowedRoles: [source.role as CompositionBlockRole] } : {}),
      allowedBlockKinds: (source.allowedBlockKinds as CompositionBlockKind[] | undefined) ?? blockKindsForSource(source.kind),
      ...(growth === undefined ? {} : { grow: growth }),
    }];
  });
}

export function declaredLockupSlotsForFlow(
  compiled: CompiledTemplate,
  flowId: string,
  pageGeometry: PageGeometry,
  continuation = false,
): CompositionSlotTemplate[] {
  return (compiled.flows[flowId]?.slots ?? []).flatMap((slotId) => {
    const source = compiled.slots[slotId];
    if (!source || source.kind !== 'lockup') return [];
    return [{
      id: slotId,
      regionId: source.region ?? flowId,
      flowId,
      kind: 'graphic' as const,
      reserved: true,
      box: normalizedBox(slotFrame(source, continuation), pageGeometry),
    }];
  });
}

export function declaredGraphicSlots(
  compiled: CompiledTemplate,
  pageGeometry: PageGeometry,
  continuation = false,
): CompositionSlotTemplate[] {
  return Object.entries(compiled.slots)
    .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1]?.kind === 'graphic')
    .map(([id, source]) => ({
      id,
      regionId: source.region ?? 'content',
      kind: 'graphic' as const,
      box: normalizedBox(slotFrame(source, continuation), pageGeometry),
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
