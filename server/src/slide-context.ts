import { readBrandTemplateSource, resolveBrandContext, type BrandDiagnostics, type BrandOverrides, type RenderBrandContext } from './brand.js';
import { readBuiltinTemplateSource } from './builtin-template-loader.js';
import { SLIDE_NOTES_MAX_CHARS, type SlideDeck } from './slides.js';
import { resolveSlidePlan } from './slide-plan.js';
import { logicalDirection } from './slide-templates.js';
import { compileTemplateSource, type CompiledTemplate } from './template-source.js';

export interface SlideDeckContextOptions {
  brandRoot: string;
  brandRef?: string;
  templateRef?: string;
  surface?: string;
  overrides?: BrandOverrides;
}

function mergeOverrides(...values: Array<BrandOverrides | undefined>): BrandOverrides | undefined {
  const result: BrandOverrides = {};
  for (const value of values) {
    if (!value) continue;
    if (value.fit) result.fit = { ...result.fit, ...value.fit };
    if (value.layout) result.layout = { ...result.layout, ...value.layout };
    if (value.typography) result.typography = {
      ...result.typography,
      ...value.typography,
      body: { ...result.typography?.body, ...value.typography.body },
      heading: { ...result.typography?.heading, ...value.typography.heading },
    };
    if (value.emphasis) result.emphasis = { ...result.emphasis, ...value.emphasis };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export interface ResolvedSlideDeck {
  deck: SlideDeck;
  context: RenderBrandContext;
  slideDiagnostics: BrandDiagnostics[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${label} must be a string.`);
}

function validateOverrides(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if (value.fit !== undefined) {
    if (!isRecord(value.fit)) throw new Error(`${label}.fit must be an object.`);
    if (value.fit.strategy !== undefined && value.fit.strategy !== 'none' && value.fit.strategy !== 'shrink-to-fit') throw new Error(`${label}.fit.strategy is unsupported.`);
    for (const key of ['min_body_pt', 'min_heading_pt']) if (value.fit[key] !== undefined && (typeof value.fit[key] !== 'number' || !Number.isFinite(value.fit[key]) || value.fit[key] <= 0)) throw new Error(`${label}.fit.${key} must be a positive number.`);
  }
  if (value.layout !== undefined && (!isRecord(value.layout)
    || (value.layout.density !== undefined && value.layout.density !== 'comfortable' && value.layout.density !== 'compact')
    || (value.layout.lockup_position !== undefined && value.layout.lockup_position !== 'top-start' && value.layout.lockup_position !== 'top-end')
    || (value.layout.lockup_spacing !== undefined && value.layout.lockup_spacing !== 'compact' && value.layout.lockup_spacing !== 'normal' && value.layout.lockup_spacing !== 'open'))) throw new Error(`${label}.layout is invalid.`);
  if (value.emphasis !== undefined && (!isRecord(value.emphasis) || (value.emphasis.role !== undefined && typeof value.emphasis.role !== 'string'))) throw new Error(`${label}.emphasis is invalid.`);
  if (value.typography !== undefined) {
    if (!isRecord(value.typography)) throw new Error(`${label}.typography must be an object.`);
    optionalString(value.typography.heading_role, `${label}.typography.heading_role`);
    for (const role of ['body', 'heading']) {
      const item = value.typography[role];
      if (item === undefined) continue;
      if (!isRecord(item)) throw new Error(`${label}.typography.${role} must be an object.`);
      optionalString(item.family, `${label}.typography.${role}.family`);
      optionalString(item.role, `${label}.typography.${role}.role`);
      if (item.scale !== undefined && (typeof item.scale !== 'number' || !Number.isFinite(item.scale) || item.scale <= 0)) throw new Error(`${label}.typography.${role}.scale must be a positive number.`);
    }
  }
}

function validateSlide(slide: unknown, index: number): void {
  const label = `Slide ${index + 1}`;
  if (!isRecord(slide) || typeof slide.title !== 'string' || typeof slide.type !== 'string') throw new Error(`${label} must contain a title and type.`);
  for (const key of ['subtitle', 'notes', 'brand_ref', 'template_ref', 'surface', 'direction']) optionalString(slide[key], `${label}.${key}`);
  if (typeof slide.notes === 'string' && slide.notes.length > SLIDE_NOTES_MAX_CHARS) throw new Error(`${label}.notes must be at most ${SLIDE_NOTES_MAX_CHARS} characters.`);
  if (slide.direction !== undefined) logicalDirection(slide.direction);
  validateOverrides(slide.overrides, `${label}.overrides`);
  if (slide.type === 'title') optionalString(slide.eyebrow, `${label}.eyebrow`);
  else if (slide.type === 'metrics') {
    if (!Array.isArray(slide.metrics) || slide.metrics.length < 1 || slide.metrics.length > 6) throw new Error(`${label}.metrics must contain 1–6 cards.`);
    for (const card of slide.metrics) {
      if (!isRecord(card) || typeof card.label !== 'string' || (typeof card.value !== 'string' && typeof card.value !== 'number')) throw new Error(`${label}.metrics contains an invalid card.`);
      optionalString(card.delta, `${label}.metrics.delta`); optionalString(card.note, `${label}.metrics.note`);
      if (card.trend !== undefined && !['up', 'down', 'flat'].includes(String(card.trend))) throw new Error(`${label}.metrics.trend is invalid.`);
    }
    optionalString(slide.body, `${label}.body`); optionalString(slide.callout, `${label}.callout`);
  } else if (slide.type === 'chart') {
    if (!isRecord(slide.chart) || !['bar', 'line', 'pie'].includes(String(slide.chart.type)) || !Array.isArray(slide.chart.data) || slide.chart.data.length < 1) throw new Error(`${label}.chart is invalid.`);
    for (const datum of slide.chart.data) if (!isRecord(datum) || typeof datum.label !== 'string' || typeof datum.value !== 'number' || !Number.isFinite(datum.value)) throw new Error(`${label}.chart.data contains an invalid datum.`);
  } else if (slide.type === 'table') {
    if (!Array.isArray(slide.head) || slide.head.length < 1 || slide.head.some((cell) => typeof cell !== 'string') || !Array.isArray(slide.body)) throw new Error(`${label}.table is invalid.`);
    if (slide.body.some((row) => !Array.isArray(row) || row.some((cell) => typeof cell !== 'string' && typeof cell !== 'number'))) throw new Error(`${label}.table contains an invalid row.`);
  } else if (slide.type === 'narrative') {
    if (typeof slide.body !== 'string' || (slide.highlights !== undefined && (!Array.isArray(slide.highlights) || slide.highlights.length > 4 || slide.highlights.some((item) => typeof item !== 'string')))) throw new Error(`${label}.narrative is invalid.`);
  } else if (slide.type === 'conclusions') {
    if (!Array.isArray(slide.items) || slide.items.length < 1 || slide.items.length > 7 || slide.items.some((item) => typeof item !== 'string')) throw new Error(`${label}.conclusions is invalid.`);
  } else if (slide.type === 'columns') {
    if (!Array.isArray(slide.columns) || slide.columns.length !== 2) throw new Error(`${label}.columns must contain exactly two columns.`);
    for (const column of slide.columns) {
      if (!isRecord(column) || typeof column.body !== 'string' || (column.heading !== undefined && typeof column.heading !== 'string') || (column.highlights !== undefined && (!Array.isArray(column.highlights) || column.highlights.length > 3 || column.highlights.some((item) => typeof item !== 'string')))) throw new Error(`${label}.columns contains an invalid column.`);
    }
  } else throw new Error(`${label} has unsupported type '${slide.type}'.`);
}

export function validateSlideDeck(data: unknown): asserts data is SlideDeck {
  if (!isRecord(data) || !Array.isArray(data.slides) || data.slides.length === 0) {
    throw new Error('Slide deck must contain a non-empty slides array.');
  }
  for (const key of ['title', 'brand', 'brand_ref', 'template_ref', 'surface', 'footer', 'direction']) optionalString(data[key], `Deck.${key}`);
  if (data.direction !== undefined) logicalDirection(data.direction);
  validateOverrides(data.overrides, 'Deck.overrides');
  data.slides.forEach(validateSlide);
}

export async function resolveSlideDeck(data: SlideDeck, options: SlideDeckContextOptions): Promise<ResolvedSlideDeck> {
  validateSlideDeck(data);
  const deckBrand = data.brand_ref ?? options.brandRef;
  const requestedDeckTemplate = data.template_ref ?? options.templateRef;
  const deckSurface = data.surface ?? options.surface ?? 'pptx-16x9';
  const deckOverrides = mergeOverrides(options.overrides, data.overrides);
  const context = await resolveBrandContext(options.brandRoot, {
    brandRef: deckBrand,
    templateRef: requestedDeckTemplate,
    surface: deckSurface,
    overrides: deckOverrides,
  });
  const deckTemplate = requestedDeckTemplate ?? context.composition.templateRef;
  const slideResults = await Promise.all(data.slides.map(async (slide) => {
    const item = await resolveBrandContext(options.brandRoot, {
      brandRef: slide.brand_ref ?? deckBrand,
      templateRef: slide.template_ref ?? deckTemplate,
      surface: slide.surface ?? deckSurface,
      overrides: mergeOverrides(deckOverrides, slide.overrides),
    });
    return item;
  }));
  const slideTemplateSources = await Promise.all(data.slides.map(async (slide, index) => {
    const brandRef = slide.brand_ref ?? deckBrand;
    const templateRef = slide.template_ref ?? deckTemplate ?? slideResults[index].composition.templateRef;
    const source = await readBrandTemplateSource(options.brandRoot, brandRef, templateRef) ?? readBuiltinTemplateSource(templateRef);
    return source ? compileTemplateSource(source.source) : undefined;
  }));
  const slidePlans = data.slides.map((slide, index) => {
    const item = slideResults[index];
    const overrides = mergeOverrides(deckOverrides, slide.overrides);
    return resolveSlidePlan({
      slide,
      theme: item.theme,
      templateRef: slide.template_ref ?? deckTemplate ?? item.composition.templateRef,
      direction: slide.direction ?? data.direction ?? item.composition.direction,
      lockupPlacement: overrides?.layout?.lockup_position ?? item.composition.lockupPlacement,
      lockupSpacing: overrides?.layout?.lockup_spacing ?? item.composition.lockupSpacing,
      templateSource: slideTemplateSources[index],
    });
  });
  return {
    deck: {
      ...data,
      brand: data.brand ?? context.brandName,
      slideThemes: slideResults.map((item) => item.theme),
      slidePlans,
      slideTemplateSources: slideTemplateSources as Array<CompiledTemplate | undefined>,
    },
    context,
    slideDiagnostics: slideResults.map((item) => item.diagnostics),
  };
}
