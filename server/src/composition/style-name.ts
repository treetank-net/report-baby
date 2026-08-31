import type { CompositionBlock } from './model.js';

/**
 * The planner and every backend must resolve a block to the same typography
 * style. In particular, a heading block in the header flow is still a
 * heading; the flow role only controls routing, not the glyph metrics.
 */
export function compositionStyleName(block: CompositionBlock): string {
  if (block.kind === 'list-item') return 'list-item';
  if (block.role === 'title') return 'title';
  if (block.role === 'subtitle') return 'subtitle';
  if (block.role === 'eyebrow') return 'eyebrow';
  if (block.role === 'heading' || block.kind === 'heading') return 'heading';
  if (block.role === 'header') return 'header';
  if (block.role === 'intro') return 'intro';
  if (block.role === 'quote') return 'quote';
  if (block.role === 'sidebar') return 'sidebar';
  if (block.role === 'footer') return 'footer';
  return 'body';
}
