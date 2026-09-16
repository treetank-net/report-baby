/**
 * Stable insertion-layout facade. Proposal generation, measurement and
 * materialization are separate modules, while existing composition imports
 * continue to use this path.
 */
export {
  insertionBlocksForFlow,
  insertionSlotAcceptsBlock,
  insertionProposalsFromPlan,
  nextInsertionBoundary,
  nextInsertionProposal,
  seedInsertionProposalCandidates,
  seedInsertionProposals,
} from './insertion-planning.js';
export {
  placeInsertionLayer,
  reserveInsertionObstacles,
} from './insertion-placement.js';
export {
  measureInsertionText,
  measureInsertionContent,
  insertionContentHeight,
  insertionContentIsComplete,
} from './insertion-measurement.js';
export type { InsertionTextMeasurement, InsertionContentMeasurement } from './insertion-measurement.js';
