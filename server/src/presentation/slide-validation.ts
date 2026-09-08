import { SLIDE_NOTES_MAX_CHARS, type Slide } from '../contracts/input/schema.js';
import { RENDER_CONFIG } from './slide-layout.js';

/** Validate format limits before any renderer allocates a page. */
export function validateSlideContent(slide: Slide): void {
  if (slide.notes !== undefined && slide.notes.length > SLIDE_NOTES_MAX_CHARS) {
    throw new Error(`Slide '${slide.title}' has ${slide.notes.length} characters of notes; at most ${SLIDE_NOTES_MAX_CHARS} are supported.`);
  }
  if (slide.type === 'table') {
    if (slide.body.length > 10) throw new Error(`Table slide '${slide.title}' has ${slide.body.length} rows; the renderer supports at most 10 without pagination.`);
    if ([...slide.head, ...slide.body.flat()].some((cell) => String(cell).length > RENDER_CONFIG.legacy.table_cell_max_chars)) throw new Error(`Table slide '${slide.title}' contains a cell longer than the supported ${RENDER_CONFIG.legacy.table_cell_max_chars}-character width.`);
  }
  if (slide.type === 'conclusions' && slide.items.length > 7) throw new Error(`Conclusions slide '${slide.title}' has more than 7 items; use another slide or a dedicated template.`);
  if (slide.type === 'narrative' && (slide.highlights?.length ?? 0) > 4) throw new Error(`Narrative slide '${slide.title}' has more than 4 highlights; use another slide or a dedicated template.`);
  if (slide.type === 'columns' && (slide.columns.length !== 2 || slide.columns.some((column) => !column.body || (column.highlights?.length ?? 0) > 3))) {
    throw new Error(`Two-column slide '${slide.title}' needs exactly two columns with at most three highlights per column.`);
  }
}
