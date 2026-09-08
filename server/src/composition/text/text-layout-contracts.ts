import type { CompositionInlineRun } from '../contracts/model.js';

/** Renderer-neutral line fragment produced by the wrapping calculator. */
export interface WrappedLine {
  text: string;
  inlineRuns?: CompositionInlineRun[];
  naturalWidth: number;
  startWord: number;
  endWord: number;
  x: number;
  width: number;
  lineOffset: number;
}
