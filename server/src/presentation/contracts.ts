import type { RenderTheme } from '../core/model/render-theme.js';
import type { ResolvedSlidePlan } from '../core/model/resolved-slide-plan.js';
import type { Slide } from '../contracts/input/schema.js';
import type { TextDirection } from '../template/direction.js';
import type { BrandOverrides } from '../brand/contracts.js';
import type { CompiledTemplate } from '../template/contracts.js';

/** Public input plus resolved per-slide rendering state shared by all formats. */
export interface SlideDeck {
  title?: string;
  brand?: string;
  brand_ref?: string;
  template_ref?: string;
  surface?: string;
  direction?: TextDirection;
  overrides?: BrandOverrides;
  footer?: string;
  slides: Slide[];
  slideThemes?: Array<RenderTheme | undefined>;
  slidePlans?: Array<ResolvedSlidePlan | undefined>;
  slideTemplateSources?: Array<CompiledTemplate | undefined>;
  slideFooters?: Array<string | undefined>;
}

export type { Slide } from '../contracts/input/schema.js';
