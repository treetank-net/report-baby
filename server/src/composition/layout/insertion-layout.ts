/**
 * Stable insertion-layout facade. Proposal generation, measurement and
 * materialization are separate modules, while existing composition imports
 * continue to use this path.
 */
export {
  insertionProposalsFromPlan,
  nextInsertionBoundary,
  nextInsertionProposal,
  seedInsertionProposals,
} from './insertion-planning.js';
export {
  placeInsertionLayer,
  reserveInsertionObstacles,
} from './insertion-placement.js';
export { measureInsertionText } from './insertion-measurement.js';
export type { InsertionTextMeasurement } from './insertion-measurement.js';
