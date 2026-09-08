import type { CompositionLayoutTemplate } from '../model.js';
import type { CompositionSlot } from '../engine.js';

/** Mutable page state shared by page, flow and placement operations. */
export interface PageState {
  page: number;
  layout: CompositionLayoutTemplate;
  slots: Map<string, CompositionSlot>;
}

/** Mutable position of a flow while it traverses route slots and pages. */
export interface FlowCursor {
  blockIndex: number;
  startWord: number;
  startRow: number;
  page: number;
  routeIndex: number;
  resumeY?: number;
  resumeSlotId?: string;
}
