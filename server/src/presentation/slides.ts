/**
 * Stable presentation facade used by MCP, CLI and existing integrations.
 * Format-specific implementations live next to it so callers do not need to
 * know whether a deck is rendered as SVG, PDF, PNG or PPTX.
 */
export type { Slide, SlideDeck } from './contracts.js';
export { renderSlideSvg } from './svg-renderer.js';
export { validateSlideContent } from './slide-validation.js';
export { titleLayoutDiagnostics } from './slide-layout.js';
export { renderSlidesPdf, renderSlidesPng } from './pdf-renderer.js';
export { renderSlidesPptx } from './pptx-renderer.js';
