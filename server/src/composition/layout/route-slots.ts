import type { CompositionBlock, CompositionLayoutTemplate, CompositionSlotTemplate } from '../model.js';
import type { CompositionSlot } from '../engine.js';

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Keep the current isAtomicBlock implementation intact until its target seam is extracted.
 */
export function isAtomicBlock(block: CompositionBlock): boolean {
  return block.atomic === true || block.kind === 'metric' || block.kind === 'chart';
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Keep the current requiresBlockSlot implementation intact until its target seam is extracted.
 */
function requiresBlockSlot(block: CompositionBlock): boolean {
  return isAtomicBlock(block) && (block.kind !== 'image' || block.role === 'chart' || block.role === 'metric');
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Keep the current blockMatchesAllowedId implementation intact until its target seam is extracted.
 */
function blockMatchesAllowedId(blockId: string, allowedIds: string[]): boolean {
  return allowedIds.some((allowedId) => blockId === allowedId || blockId.startsWith(`${allowedId}:`));
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Keep the current routeHasBlockSlot implementation intact until its target seam is extracted.
 */
function routeHasBlockSlot(layout: CompositionLayoutTemplate, slotIds: string[]): boolean {
  return slotIds.some((id) => layout.slots.some((slot) => slot.id === id && slot.kind === 'block'));
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Apply the complete slot-to-block compatibility contract for one concrete slot.
 *
 * Callers remain responsible for deciding which route positions to inspect;
 * this predicate only answers whether one slot may accept the block.
 */
function slotMatchesBlock(
  definition: CompositionSlotTemplate,
  hasBlockSlot: boolean,
  flowId: string,
  block: CompositionBlock,
  slots?: ReadonlyMap<string, CompositionSlot>,
): boolean {
  if (definition.flowId !== undefined && definition.flowId !== flowId) return false;
  if (definition.allowedRoles?.includes('quote') && slots?.get(definition.id)?.state === 'exhausted') return false;
  if (definition.allowedRoles && !definition.allowedRoles.includes(block.role)) return false;
  if (definition.allowedBlockIds && !blockMatchesAllowedId(block.id, definition.allowedBlockIds)) return false;
  if (definition.kind === 'block' && !isAtomicBlock(block) && block.kind !== 'table') return false;
  if (definition.allowedBlockKinds && !definition.allowedBlockKinds.includes(block.kind)) return false;
  if (definition.kind === 'text' && hasBlockSlot && (requiresBlockSlot(block) || block.kind === 'table') && !definition.allowedBlockKinds?.includes(block.kind)) return false;
  return true;
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Select the first compatible slot without changing page or plan state.
 */
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
    const definition = layout.slots.find((slot) => slot.id === slotIds[index]);
    if (definition && slotMatchesBlock(definition, hasBlockSlot, flowId, block, slots)) return { definition, routeIndex: index };
  }
  return undefined;
}

/**
 * @planner-target composition/route-slots.ts
 * @planner-responsibility Report whether a compatible slot remains from a route position onward.
 */
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
    return slot.id === id && slotMatchesBlock(slot, hasBlockSlot, flowId, block, slots);
  }));
}
