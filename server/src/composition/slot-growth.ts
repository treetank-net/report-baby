import { rectBottom } from './page-management.js';
import type {
  FlowPlanningContext,
  FlowRuntime,
  FlowTarget,
} from './flow-planning-types.js';
import { recordFlowDecision } from './planning-records.js';

/** Apply one legal slot-growth operation, move pushed slots, and record it. */
/**
 * @planner-target composition/slot-growth.ts
 * @planner-responsibility Apply one legal slot-growth operation, move pushed slots, and record the result.
 */
export function growSlot(
  context: FlowPlanningContext,
  runtime: FlowRuntime,
  target: FlowTarget,
  requiredBottom: number,
): void {
  const { currentPage, definition } = target;
  const slot = currentPage.slots.get(definition.id);
  if (!slot) return;
  const growth = definition.grow;
  if (!growth || growth.axis !== 'y') return;
  const maxBottom = definition.box.y + growth.maxHeight;
  const nextBottom = Math.min(maxBottom, Math.max(rectBottom(slot.box), requiredBottom));
  const delta = nextBottom - rectBottom(slot.box);
  if (delta <= 0) return;
  slot.box.height += delta;
  for (const pushedId of growth.pushes ?? []) {
    const pushed = currentPage.slots.get(pushedId);
    if (!pushed) continue;
    pushed.box.y += delta;
    // Atomic/block slots have an intrinsic measured size. Moving one must not
    // silently make it shorter than the backend can render; only text slots
    // are elastic after a preceding box grows.
    const pushedDefinition = currentPage.layout.slots.find((candidate) => candidate.id === pushedId);
    if (pushedDefinition?.kind !== 'text') continue;
    pushed.box.height = Math.max(0, pushed.box.height - delta);
    if (pushed.box.height === 0) pushed.state = 'exhausted';
  }
  recordFlowDecision(context, 'SLOT_GROWN', runtime, target);
}
