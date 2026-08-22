import { readBrandTemplateSource, resolveBrandContext, type BrandDiagnostics, type BrandOverrides, type RenderBrandContext } from './brand.js';
import { readBuiltinTemplateSource } from './builtin-template-loader.js';
import type { SlideDeck } from './slides.js';
import { resolveSlidePlan } from './slide-plan.js';
import { compileTemplateSource, type CompiledTemplate } from './template-source.js';
import { slideDeckSchema } from './contract/schema.js';

export interface SlideDeckContextOptions {
  brandRoot: string;
  brandSourceRoots?: string[];
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

export async function resolveSlideDeck(data: SlideDeck, options: SlideDeckContextOptions): Promise<ResolvedSlideDeck> {
  data = slideDeckSchema.parse(data) as SlideDeck;
  const deckBrand = data.brand_ref ?? options.brandRef;
  const requestedDeckTemplate = data.template_ref ?? options.templateRef;
  const deckSurface = data.surface ?? options.surface ?? 'pptx-16x9';
  const deckOverrides = mergeOverrides(options.overrides, data.overrides);
  const context = await resolveBrandContext(options.brandRoot, {
    brandRef: deckBrand,
    templateRef: requestedDeckTemplate,
    surface: deckSurface,
    overrides: deckOverrides,
    brandSourceRoots: options.brandSourceRoots,
  });
  const deckTemplate = requestedDeckTemplate ?? context.composition.templateRef;
  const slideResults = await Promise.all(data.slides.map(async (slide) => {
    const item = await resolveBrandContext(options.brandRoot, {
      brandRef: slide.brand_ref ?? deckBrand,
      templateRef: slide.template_ref ?? deckTemplate,
      surface: slide.surface ?? deckSurface,
      overrides: mergeOverrides(deckOverrides, slide.overrides),
      brandSourceRoots: options.brandSourceRoots,
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
