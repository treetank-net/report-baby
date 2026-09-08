/** Renderer-neutral line fragment produced by the wrapping calculator. */
export interface WrappedLine {
  text: string;
  naturalWidth: number;
  startWord: number;
  endWord: number;
  x: number;
  width: number;
  lineOffset: number;
}
