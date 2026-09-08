import { readBrandTemplateSource, resolveBrandContext, type BrandDiagnostics, type BrandOverrides, type RenderBrandContext } from '../../brand/context.js';
import { readBuiltinTemplateSource } from '../../template/builtins.js';
import type { SlideDeck } from '../slides.js';
import { resolveSlidePlan } from './slide-plan.js';
import { compileTemplateSource, type CompiledTemplate } from '../../template/contracts.js';
import { slideDeckSchema, type Slide, type SlideInput } from '../../contracts/input/schema.js';
import type { BrandSourceDescriptor } from '../../source/contracts.js';

export interface SlideDeckContextOptions {
  brandRoot: string;
  brandSourceRoots?: string[];
  brandSource?: BrandSourceDescriptor;
  contentRoot?: string;
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

function flowBlocks(surface: SlideInput, flowId: string): SlideInput['flows'][string]['blocks'] {
  return surface.flows[flowId]?.blocks ?? [];
}

function firstText(surface: SlideInput, flowId: string, allowed: string[] = ['text', 'heading']): string | undefined {
  const block = flowBlocks(surface, flowId).find((item) => allowed.includes(item.type));
  if (!block || !('text' in block) || block.text === undefined) return undefined;
  return block.text;
}

function slideFromSurface(surface: SlideInput): Slide & { footer?: string } {
  const title = firstText(surface, 'title') ?? firstText(surface, 'main');
  if (!title) throw new Error(`Slide layout '${surface.layout}' requires a title flow with a text or heading block.`);
  const subtitle = firstText(surface, 'subtitle');
  const eyebrow = firstText(surface, 'eyebrow');
  const main = flowBlocks(surface, 'main');
  const base = {
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    ...(eyebrow === undefined ? {} : { eyebrow }),
    ...(surface.notes === undefined ? {} : { notes: surface.notes }),
    ...(surface.brand_ref === undefined ? {} : { brand_ref: surface.brand_ref }),
    ...(surface.template_ref === undefined ? {} : { template_ref: surface.template_ref }),
    ...(surface.surface === undefined ? {} : { surface: surface.surface }),
    ...(surface.direction === undefined ? {} : { direction: surface.direction }),
    ...(surface.overrides === undefined ? {} : { overrides: surface.overrides }),
  };
  if (surface.layout === 'title') return { type: 'title', ...base, ...(eyebrow === undefined ? {} : { eyebrow }), ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  if (surface.layout === 'metrics') {
    const metrics = main.filter((item): item is Extract<typeof item, { type: 'metric' }> => item.type === 'metric').map((item) => ({ label: item.label, value: item.value, ...(item.delta === undefined ? {} : { delta: item.delta }), ...(item.trend === undefined ? {} : { trend: item.trend }), ...(item.note === undefined ? {} : { note: item.note }) }));
    if (metrics.length === 0) throw new Error("Metrics slide requires metric blocks in the 'main' flow.");
    const body = firstText(surface, 'body') ?? main.find((item) => item.type === 'text')?.text;
    const callout = firstText(surface, 'callout');
    return { type: 'metrics', ...base, metrics, ...(body === undefined ? {} : { body }), ...(callout === undefined ? {} : { callout }), ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  }
  if (surface.layout === 'chart') {
    const item = main.find((block): block is Extract<typeof block, { type: 'chart' }> => block.type === 'chart');
    if (!item) throw new Error("Chart slide requires a chart block in the 'main' flow.");
    return { type: 'chart', ...base, chart: { type: item.chart_type, data: item.data, ...(item.prefix === undefined ? {} : { prefix: item.prefix }), ...(item.suffix === undefined ? {} : { suffix: item.suffix }) }, ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  }
  if (surface.layout === 'table') {
    const item = main.find((block): block is Extract<typeof block, { type: 'table' }> => block.type === 'table');
    if (!item) throw new Error("Table slide requires a table block in the 'main' flow.");
    return { type: 'table', ...base, head: item.head, body: item.body, ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  }
  if (surface.layout === 'narrative') {
    const body = main.find((item) => item.type === 'text')?.text;
    if (!body) throw new Error("Narrative slide requires a text block in the 'main' flow.");
    return { type: 'narrative', ...base, body, highlights: main.filter((item): item is Extract<typeof item, { type: 'list-item' }> => item.type === 'list-item').map((item) => item.text), ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  }
  if (surface.layout === 'conclusions') {
    const items = main.filter((item): item is Extract<typeof item, { type: 'list-item' }> => item.type === 'list-item').map((item) => item.text);
    if (items.length === 0) throw new Error("Conclusions slide requires list-item blocks in the 'main' flow.");
    return { type: 'conclusions', ...base, items, ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
  }
  const columns = ['left', 'right'].map((flowId) => {
    const blocks = flowBlocks(surface, flowId);
    const heading = blocks.find((item) => item.type === 'heading');
    const body = blocks.find((item) => item.type === 'text');
    if (!body || body.text === undefined) throw new Error(`Columns slide requires a text block in the '${flowId}' flow.`);
    return { ...(heading && heading.type === 'heading' ? { heading: heading.text } : {}), body: body.text, highlights: blocks.filter((item): item is Extract<typeof item, { type: 'list-item' }> => item.type === 'list-item').map((item) => item.text) };
  });
  return { type: 'columns', ...base, columns, ...(firstText(surface, 'footer') === undefined ? {} : { footer: firstText(surface, 'footer') }) };
}

export async function resolveSlideDeck(data: unknown, options: SlideDeckContextOptions): Promise<ResolvedSlideDeck> {
  const input = slideDeckSchema.parse(data) as { title?: string; brand?: string; brand_ref?: string; template_ref?: string; surface?: string; direction?: import('../../template/direction.js').TextDirection; overrides?: import('../../brand/context.js').BrandOverrides; footer?: string; slides: SlideInput[] };
  const slides = input.slides.map(slideFromSurface);
  const deck = { ...input, slides, slideFooters: slides.map((slide) => slide.footer) } as SlideDeck;
  const deckBrand = deck.brand_ref ?? options.brandRef;
  const requestedDeckTemplate = deck.template_ref ?? options.templateRef;
  const deckSurface = deck.surface ?? options.surface ?? 'pptx-16x9';
  const deckOverrides = mergeOverrides(options.overrides, deck.overrides);
  const context = await resolveBrandContext(options.brandRoot, {
    brandRef: deckBrand,
    templateRef: requestedDeckTemplate,
    surface: deckSurface,
    overrides: deckOverrides,
    brandSourceRoots: options.brandSourceRoots,
    brandSource: options.brandSource,
    contentRoot: options.contentRoot,
  });
  const deckTemplate = requestedDeckTemplate ?? context.composition.templateRef;
  const slideResults = await Promise.all(deck.slides.map(async (slide) => {
    const item = await resolveBrandContext(options.brandRoot, {
      brandRef: slide.brand_ref ?? deckBrand,
      templateRef: slide.template_ref ?? deckTemplate,
      surface: slide.surface ?? deckSurface,
      overrides: mergeOverrides(deckOverrides, slide.overrides),
      brandSourceRoots: options.brandSourceRoots,
      brandSource: options.brandSource,
      contentRoot: options.contentRoot,
    });
    return item;
  }));
  const slideTemplateSources = await Promise.all(deck.slides.map(async (slide, index) => {
    const brandRef = slide.brand_ref ?? deckBrand;
    const templateRef = slide.template_ref ?? deckTemplate ?? slideResults[index].composition.templateRef;
    const source = await readBrandTemplateSource(options.brandRoot, brandRef, templateRef) ?? readBuiltinTemplateSource(templateRef);
    return source ? compileTemplateSource(source.source) : undefined;
  }));
  const slidePlans = deck.slides.map((slide, index) => {
    const item = slideResults[index];
    const overrides = mergeOverrides(deckOverrides, slide.overrides);
    return resolveSlidePlan({
      slide,
      theme: item.theme,
      templateRef: slide.template_ref ?? deckTemplate ?? item.composition.templateRef,
      direction: slide.direction ?? deck.direction ?? item.composition.direction,
      lockupPlacement: overrides?.layout?.lockup_position ?? item.composition.lockupPlacement,
      lockupSpacing: overrides?.layout?.lockup_spacing ?? item.composition.lockupSpacing,
      templateSource: slideTemplateSources[index],
    });
  });
  return {
    deck: {
      ...deck,
      brand: deck.brand ?? context.brandName,
      slideThemes: slideResults.map((item) => item.theme),
      slidePlans,
      slideTemplateSources: slideTemplateSources as Array<CompiledTemplate | undefined>,
    },
    context,
    slideDiagnostics: slideResults.map((item) => item.diagnostics),
  };
}
