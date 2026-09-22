import type {
  CompositionBlock,
  CompositionLayout,
  CompositionPlacementDistribution,
  CompositionPlacementPolicyPreference,
  CompositionSlotTemplate,
  CompositionPlacementPolicySource,
  CompositionResolvedPlacementPolicy,
} from '../contracts/model.js';

export type PlacementPolicySource = CompositionPlacementPolicySource;
export type ResolvedPlacementPolicy = CompositionResolvedPlacementPolicy;

function mergePreference(
  current: CompositionPlacementPolicyPreference,
  next: CompositionPlacementPolicyPreference | undefined,
): CompositionPlacementPolicyPreference {
  if (!next) return current;
  return {
    ...current,
    ...(next.distribution === undefined ? {} : { distribution: next.distribution }),
    ...(next.rhythmGroup === undefined ? {} : { rhythmGroup: next.rhythmGroup }),
    ...(next.source === undefined ? {} : { source: next.source }),
  };
}

function capabilityDefault(slot: CompositionSlotTemplate, flowId: string): CompositionPlacementPolicyPreference {
  if (slot.placement?.mode !== 'fluid-y') return {};
  if (slot.flowId === 'main' || flowId === 'main') return {};
  return {
    distribution: slot.placement.distribution ?? 'spread-through-content',
    ...(slot.placement.rhythmGroup === undefined
      ? { rhythmGroup: `main:${slot.placement.region}` }
      : { rhythmGroup: slot.placement.rhythmGroup }),
  };
}

/** Resolve one insertion's soft intent without changing its legal capability. */
export function resolvePlacementPolicy(
  layout: CompositionLayout,
  flowId: string,
  block: CompositionBlock,
  slot: CompositionSlotTemplate,
): ResolvedPlacementPolicy {
  const flowPreference = layout.placementPolicies?.flows?.[flowId];
  const blockPreference = layout.placementPolicies?.blocks?.[flowId]?.[block.id]
    ?? Object.entries(layout.placementPolicies?.blocks?.[flowId] ?? {})
      .find(([id]) => block.id.startsWith(`${id}:`))?.[1];
  const capability = capabilityDefault(slot, flowId);
  const merged = mergePreference(mergePreference(capability, flowPreference), blockPreference);
  const distributionSource: PlacementPolicySource = blockPreference?.distribution !== undefined
    ? 'input-block'
    : flowPreference?.distribution !== undefined
      ? 'input-flow'
      : capability.distribution !== undefined
        ? 'template'
        : 'planner-default';
  const rhythmGroupSource = blockPreference?.rhythmGroup !== undefined
    ? 'input-block'
    : flowPreference?.rhythmGroup !== undefined
      ? 'input-flow'
      : capability.rhythmGroup !== undefined
        ? 'template'
        : undefined;
  const sourceRelationSource = blockPreference?.source !== undefined
    ? 'input-block'
    : flowPreference?.source !== undefined
      ? 'input-flow'
      : undefined;
  return {
    distribution: merged.distribution ?? 'free',
    ...(merged.rhythmGroup === undefined ? {} : { rhythmGroup: merged.rhythmGroup }),
    ...(merged.source === undefined ? {} : { source: merged.source }),
    distributionSource,
    ...(rhythmGroupSource === undefined ? {} : { rhythmGroupSource }),
    ...(sourceRelationSource === undefined ? {} : { sourceRelationSource }),
  };
}
