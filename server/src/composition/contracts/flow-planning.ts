import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from '../model.js';
import type {
  CompositionPlan,
  CompositionSlot,
  CompositionTextMetrics,
} from '../engine.js';
import type { TextCompositionPlannerPolicy } from '../planner-policy.js';
import type { PageState } from '../page-management.js';
import type { FlowCursor } from '../flow-cursor.js';
import type { flowBarrierBoxCandidatesForSlot } from '../flow-barriers.js';
import type { wrapBlock } from '../text/text-measurement.js';

/** Immutable inputs shared by every operation in one flow-planning run. */
export interface FlowPlanningContext {
  document: CompositionDocument;
  metrics: CompositionTextMetrics;
  template: CompositionTemplate;
  policy: TextCompositionPlannerPolicy;
  flowId: string;
  route: CompositionFlowRoute;
  pages: PageState[];
  plan: CompositionPlan;
  startPage: number;
  blocks: CompositionBlock[];
  geometryTolerance: number;
}

/** Mutable cursor and small amount of flow-local placement state. */
export interface FlowRuntime {
  cursor: FlowCursor;
  lastLegalSlotId?: string;
}

/** A route slot selected for the current block. */
export interface SelectedFlowSlot {
  definition: CompositionSlotTemplate;
  routeIndex: number;
}

/** All page and slot state needed to place one current block. */
export interface FlowTarget {
  currentPage: PageState;
  availableRouteSlots: string[];
  block: CompositionBlock;
  selectedSlot: SelectedFlowSlot;
  definition: CompositionSlotTemplate;
}

/** Prepared geometry and wrapping inputs for one text-placement attempt. */
export interface PreparedTextPlacement {
  leading: number;
  slot: CompositionSlot;
  initialBox: CompositionRect;
  startLineOffset: number;
  pageGraphics: CompositionPlan['graphicPlacements'];
  flowBarrierBoxCandidates: ReturnType<typeof flowBarrierBoxCandidatesForSlot>;
  blockGap: number;
  isHeadingBlock: boolean;
  wrapped: ReturnType<typeof wrapBlock>;
  completeWrapped: ReturnType<typeof wrapBlock>;
}
