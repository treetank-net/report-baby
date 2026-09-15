import { createHash } from 'node:crypto';
import type { CompositionInput, DocumentLayoutInput, PlacementRequests } from '../../contracts/input/schema.js';
import type { CompositionEvaluation, CompositionPlan } from '../contracts/engine-contracts.js';

export interface CompositionDraftCandidate {
  signature: string;
  plan: CompositionPlan;
  evaluation: CompositionEvaluation;
}

export interface CompositionDraft {
  id: string;
  revision: number;
  sourceFingerprint: string;
  input: CompositionInput;
  layout?: DocumentLayoutInput;
  insertionRequests?: PlacementRequests;
  candidates: CompositionDraftCandidate[];
  selectedSignature?: string;
  acceptedPlan?: CompositionPlan;
}

export interface CompositionDraftSources {
  brandFingerprint: string;
  templateFingerprint: string;
  renderConfigFingerprint: string;
}

function sourceFingerprint(input: CompositionInput, layout: DocumentLayoutInput | undefined, insertionRequests: PlacementRequests | undefined, sources: CompositionDraftSources): string {
  return createHash('sha256').update(JSON.stringify({ input, layout, insertionRequests, sources })).digest('hex');
}

function requireRevision(draft: CompositionDraft, expectedRevision: number): void {
  if (draft.revision !== expectedRevision) throw new Error(`Draft '${draft.id}' revision ${draft.revision} is newer than expected revision ${expectedRevision}.`);
}

/** Create a portable, renderer-independent draft from one planning pass. */
export function createCompositionDraft(
  id: string,
  input: CompositionInput,
  sources: CompositionDraftSources,
  result: { candidates: CompositionDraftCandidate[]; layout?: DocumentLayoutInput; insertionRequests?: PlacementRequests },
): CompositionDraft {
  return {
    id,
    revision: 1,
    sourceFingerprint: sourceFingerprint(input, result.layout, result.insertionRequests, sources),
    input,
    ...(result.layout === undefined ? {} : { layout: result.layout }),
    ...(result.insertionRequests === undefined ? {} : { insertionRequests: result.insertionRequests }),
    candidates: result.candidates.map((candidate) => ({ ...candidate, plan: structuredClone(candidate.plan), evaluation: structuredClone(candidate.evaluation) })),
  };
}

/** Apply semantic edits and invalidate all derived candidate/selection state. */
export function updateCompositionDraft(
  draft: CompositionDraft,
  expectedRevision: number,
  changes: { input?: CompositionInput; layout?: DocumentLayoutInput; insertionRequests?: PlacementRequests },
  sources: CompositionDraftSources,
): CompositionDraft {
  requireRevision(draft, expectedRevision);
  const input = changes.input ?? draft.input;
  const layout = changes.layout === undefined ? draft.layout : changes.layout;
  const insertionRequests = changes.insertionRequests === undefined ? draft.insertionRequests : changes.insertionRequests;
  return {
    ...draft,
    revision: draft.revision + 1,
    sourceFingerprint: sourceFingerprint(input, layout, insertionRequests, sources),
    input,
    ...(layout === undefined ? {} : { layout }),
    ...(insertionRequests === undefined ? {} : { insertionRequests }),
    candidates: [],
    selectedSignature: undefined,
    acceptedPlan: undefined,
  };
}

/** Freeze one previously evaluated accepted candidate for rendering. */
export function selectCompositionDraftCandidate(draft: CompositionDraft, expectedRevision: number, signature: string): CompositionDraft {
  requireRevision(draft, expectedRevision);
  const candidate = draft.candidates.find((item) => item.signature === signature);
  if (!candidate) throw new Error(`Draft '${draft.id}' has no candidate '${signature}'.`);
  if (candidate.evaluation.status === 'rejected' || candidate.evaluation.hardViolations.length > 0) throw new Error(`Draft '${draft.id}' cannot select rejected candidate '${signature}'.`);
  return { ...draft, selectedSignature: signature, acceptedPlan: structuredClone(candidate.plan) };
}

/** Ensure a render cannot silently use a stale or unselected plan. */
export function assertCompositionDraftRenderable(draft: CompositionDraft, sources: CompositionDraftSources): CompositionPlan {
  if (!draft.acceptedPlan || !draft.selectedSignature) throw new Error(`Draft '${draft.id}' has no selected accepted candidate.`);
  const fingerprint = sourceFingerprint(draft.input, draft.layout, draft.insertionRequests, sources);
  if (fingerprint !== draft.sourceFingerprint) throw new Error(`Draft '${draft.id}' is stale because its input, layout, brand, template or render configuration changed.`);
  return structuredClone(draft.acceptedPlan);
}
