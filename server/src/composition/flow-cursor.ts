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

/** Advance to the next route slot, wrapping to the next page when necessary. */
/**
 * @planner-target composition/flow-cursor.ts
 * @planner-responsibility Keep the current advanceCursor implementation intact until its target seam is extracted.
 */
export function advanceCursor(
  cursor: FlowCursor,
  routeSlotsForPage: string[],
): void {
  cursor.routeIndex += 1;
  cursor.resumeY = undefined;
  cursor.resumeSlotId = undefined;
  if (cursor.routeIndex >= routeSlotsForPage.length) {
    cursor.routeIndex = 0;
    cursor.page += 1;
    cursor.resumeY = undefined;
  }
}
