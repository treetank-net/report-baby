import type { CompositionBlock, CompositionLayoutTemplate, CompositionSlotTemplate } from './model.js';
import type { CompositionSlot } from './engine.js';

export function isAtomicBlock(block: CompositionBlock): boolean {
  return block.atomic === true || block.kind === 'metric' || block.kind === 'chart';
}

function requiresBlockSlot(block: CompositionBlock): boolean {
  return isAtomicBlock(block) && (block.kind !== 'image' || block.role === 'chart' || block.role === 'metric');
}

function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

function routeHasBlockSlot(layout: CompositionLayoutTemplate, slotIds: string[]): boolean {
  return slotIds.some((id) => layout.slots.some((slot) => slot.id === id && slot.kind === 'block'));
}

/** Selects the first compatible slot without changing page or plan state. */
export function slotFor(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): { definition: CompositionSlotTemplate; routeIndex: number } | undefined {
  const hasBlockSlot = routeHasBlockSlot(layout, slotIds);
  for (let index = routeIndex; index < slotIds.length; index += 1) {
    const id = slotIds[index];
    const definition = layout.slots.find((slot) => slot.id === id && (slot.flowId === undefined || slot.flowId === flowId));
    if (!definition) continue;
    if (definition.allowedRoles?.includes('quote') && slots?.get(id)?.state === 'exhausted') continue;
    if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) continue;
    if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) continue;
    if (definition.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') continue;
    if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) continue;
    if (definition.kind === 'text' && hasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !definition.allowedBlockKinds?.includes(block.kind)) continue;
    return { definition, routeIndex: index };
  }
  return undefined;
}

/** Reports whether a compatible slot remains from a route position onward. */
export function hasRoleEligibleSlot(
  layout: CompositionLayoutTemplate,
  slotIds: string[],
  routeIndex: number,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): boolean {
  const hasBlockSlot = routeHasBlockSlot(layout, slotIds);
  return slotIds.slice(routeIndex).some((id) => layout.slots.some((slot) => {
    if (slot.id !== id || (slot.flowId !== undefined && slot.flowId !== flowId)) return false;
    if (slot.allowedRoles?.includes('quote') && slots?.get(id)?.state === 'exhausted') return false;
    if (slot.allowedRoles && !slot.allowedRoles.includes(block.role)) return false;
    if (slot.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') return false;
    if (slot.allowedBlockKinds && !slot.allowedBlockKinds.includes(block.kind)) return false;
    if (slot.kind === 'text' && hasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !slot.allowedBlockKinds?.includes(block.kind)) return false;
    return !slot.allowedBlockIds || blockMatchesAllowedId(block.id, slot.allowedBlockIds);
  }));
}
