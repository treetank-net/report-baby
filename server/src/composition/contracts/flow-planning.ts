import type {
  CompositionBlock,
  CompositionDocument,
  CompositionFlowRoute,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionTemplate,
} from './model.js';
import type {
  CompositionPlan,
  CompositionFlowBarrierBoxCandidate,
  CompositionSlot,
  CompositionTextMetrics,
} from './engine-contracts.js';
import type { TextCompositionPlannerPolicy } from './planner-policy.js';
import type { PageState, FlowCursor } from './layout-state.js';
import type { WrappedLine } from '../text/text-layout.js';

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
  flowBarrierBoxCandidates: CompositionFlowBarrierBoxCandidate[];
  blockGap: number;
  isHeadingBlock: boolean;
  wrapped: WrappedLine[];
  completeWrapped: WrappedLine[];
}
