import type { RenderTheme } from './brand.js';
import type { Slide } from './slides.js';
import { logicalDirection, logicalPlacement, logicalSpacing, physicalAlign, physicalSide, resolveSlideTemplate, templateTitleAlign, type LockupPlacement, type LockupSpacing, type SlideTemplateRef, type TextDirection } from './slide-templates.js';
import { resolvePlan, type CompiledTemplate, type NormalizedFrame } from './template-source.js';

export interface ResolvedBox { x: number; y: number; width: number; height: number }
export interface ResolvedLockupPlan { placement: LockupPlacement; physicalSide: 'left' | 'right'; spacing: LockupSpacing; mark: ResolvedBox; name: ResolvedBox; }
export interface ResolvedSlidePlan {
  schemaVersion: 1;
  templateRef: string;
  slideType: Slide['type'];
  direction: TextDirection;
  titleAlign: 'left' | 'center' | 'right';
  headerTitleY: number;
  headerSubtitleY: number;
  headerLineY: number;
  titleLayout: { eyebrowY: number; titleBaselineY: number; subtitleBaselineY: number };
  titleConstraints: { maxLines: number; overflow?: 'reject' | 'shrink-to-fit' };
  subtitleConstraints: { maxLines: number; overflow?: 'reject' | 'shrink-to-fit' };
  eyebrowConstraints: { maxLines: number; overflow?: 'reject' | 'shrink-to-fit' };
  lockup: ResolvedLockupPlan;
  safeArea: ResolvedBox;
  slotRules: Record<string, { maxLines?: number; overflow?: 'reject' | 'shrink-to-fit' }>;
  slots: { title: ResolvedBox; subtitle: ResolvedBox; eyebrow?: ResolvedBox; image?: ResolvedBox; header: ResolvedBox; content: ResolvedBox; footer: ResolvedBox; [key: string]: ResolvedBox | undefined };
  sourceTemplate?: { id: string; surface: string; archetype?: string };
}

export interface ResolveSlidePlanInput {
  slide: Slide;
  theme: RenderTheme;
  templateRef?: unknown;
  direction?: unknown;
  lockupPlacement?: unknown;
  lockupSpacing?: unknown;
  templateSource?: CompiledTemplate;
}

const WIDTH = 1600;
const HEIGHT = 900;

function toPixels(frame: NormalizedFrame): ResolvedBox {
  return { x: frame.x * WIDTH, y: frame.y * HEIGHT, width: frame.width * WIDTH, height: frame.height * HEIGHT };
}

function baseline(frame: ResolvedBox): number {
  return frame.y + frame.height * 0.55;
}

export function resolveSlidePlan(input: ResolveSlidePlanInput): ResolvedSlidePlan {
  if (input.templateSource && (input.templateSource.kind !== 'slide' || !['slide-16x9', 'pptx-16x9'].includes(input.templateSource.surface))) {
    throw new Error(`Template '${input.templateSource.id}' is not a slide-16x9 template.`);
  }
  if (input.templateSource?.archetype && input.templateSource.archetype !== input.slide.type) {
    throw new Error(`Template '${input.templateSource.id}' is for '${input.templateSource.archetype}' slides, not '${input.slide.type}'.`);
  }
  if (input.templateSource?.archetype === 'metrics' && ['metric-1', 'metric-2', 'metric-3'].some((id) => input.templateSource?.slots[id]?.kind !== 'metric-card')) {
    throw new Error(`Metrics template '${input.templateSource.id}' must define metric-1, metric-2 and metric-3 metric-card slots.`);
  }
  const legacyTemplateRef = input.templateSource && typeof input.templateRef === 'string' && !['slides/standard', 'slides/compact', 'slides/centered-title', 'slides/two-column'].includes(input.templateRef)
    ? 'slides/standard'
    : input.templateRef;
  const template = resolveSlideTemplate(legacyTemplateRef);
  const direction = logicalDirection(input.direction);
  const placement = logicalPlacement(input.lockupPlacement);
  const spacing = logicalSpacing(input.lockupSpacing);
  const templateAlign = input.slide.type === 'title' && !input.templateSource
    ? input.theme.titleAlign === 'center' ? 'center' : 'start'
    : templateTitleAlign(template, input.slide);
  const align = physicalAlign(direction, templateAlign);
  const imageArea = input.theme.headerStyle === 'image-band' ? input.theme.imageTextSafeArea : { x: 0.0625, y: 0, width: 0.875, height: 1 };
  const sourcePlan = input.templateSource ? resolvePlan(input.templateSource, { direction }, { type: input.slide.type }) : undefined;
  const typedSource = Boolean(input.templateSource && input.templateSource.id !== 'slides/standard');
  const sourceTitle = sourcePlan?.slots.title && (input.slide.type !== 'title' || typedSource) ? toPixels(sourcePlan.slots.title) : undefined;
  const sourceSubtitle = sourcePlan?.slots.subtitle && (input.slide.type !== 'title' || typedSource) ? toPixels(sourcePlan.slots.subtitle) : undefined;
  const sourceEyebrow = sourcePlan?.slots.eyebrow && (input.slide.type !== 'title' || typedSource) ? toPixels(sourcePlan.slots.eyebrow) : undefined;
  const sourceSafeArea = sourcePlan?.regions.hero ? toPixels(sourcePlan.regions.hero) : sourceTitle;
  const sourceImage = sourcePlan?.slots.image ? toPixels(sourcePlan.slots.image) : undefined;
  const sourceHeader = sourcePlan?.regions.header ? toPixels(sourcePlan.regions.header) : undefined;
  const sourceContent = sourcePlan?.regions.content ? toPixels(sourcePlan.regions.content) : undefined;
  const sourceFooter = sourcePlan?.regions.footer ? toPixels(sourcePlan.regions.footer) : undefined;
  const title = sourceTitle ?? (input.slide.type === 'title'
    ? { x: imageArea.x * WIDTH, y: imageArea.y * HEIGHT, width: imageArea.width * WIDTH, height: imageArea.height * HEIGHT }
    : { x: 80, y: template.headerTitleY - 70, width: 1440, height: 100 });
  const subtitle = sourceSubtitle ?? (input.slide.type === 'title'
    ? { x: imageArea.x * WIDTH, y: imageArea.y * HEIGHT + 250, width: imageArea.width * WIDTH, height: 150 }
    : { x: 80, y: template.headerSubtitleY - 40, width: 1440, height: 54 });
  const headerLineY = sourceHeader ? sourceHeader.y + sourceHeader.height : template.headerLineY;
  const contentTop = sourceContent?.y ?? headerLineY + 30;
  const content = sourceContent ?? { x: 80, y: contentTop, width: 1440, height: template.contentBottom - contentTop };
  const physical = physicalSide(direction, placement);
  const gap = spacing === 'compact' ? 12 : spacing === 'open' ? 28 : 18;
  const sourceLockup = sourcePlan?.slots.lockup ? toPixels(sourcePlan.slots.lockup) : undefined;
  const sourceLockupName = sourcePlan?.slots['lockup-name'] ? toPixels(sourcePlan.slots['lockup-name']) : undefined;
  const markW = sourceLockup?.width ?? (input.slide.type === 'title' ? 58 : 48);
  const markX = sourceLockup?.x ?? (physical === 'right' ? WIDTH - 80 - markW : 80);
  const markY = sourceLockup?.y ?? (input.slide.type === 'title' ? 56 : 34);
  const nameX = sourceLockupName?.x ?? (physical === 'right' ? markX - gap - 260 : markX + markW + gap);
  const titleLayout = {
    eyebrowY: sourceEyebrow ? baseline(sourceEyebrow) : 250,
    titleBaselineY: sourceTitle ? baseline(sourceTitle) : 390,
    subtitleBaselineY: sourceSubtitle ? baseline(sourceSubtitle) : 570,
  };
  const titleRules = sourcePlan && (input.slide.type !== 'title' || typedSource) ? sourcePlan.slotRules.title : undefined;
  const subtitleRules = sourcePlan && (input.slide.type !== 'title' || typedSource) ? sourcePlan.slotRules.subtitle : undefined;
  return {
    schemaVersion: 1,
    templateRef: input.templateSource?.id ?? template.id,
    slideType: input.slide.type,
    direction,
    titleAlign: align,
    headerTitleY: template.headerTitleY,
    headerSubtitleY: template.headerSubtitleY,
    headerLineY,
    titleLayout,
    titleConstraints: { maxLines: titleRules?.maxLines ?? 2, overflow: titleRules?.overflow },
    subtitleConstraints: { maxLines: subtitleRules?.maxLines ?? 2, overflow: subtitleRules?.overflow },
    eyebrowConstraints: { maxLines: sourcePlan?.slotRules.eyebrow?.maxLines ?? 1, overflow: sourcePlan?.slotRules.eyebrow?.overflow },
    lockup: {
      placement,
      physicalSide: physical,
      spacing,
      mark: { x: markX, y: markY, width: markW, height: sourceLockup?.height ?? 48 },
      name: sourceLockupName ?? { x: nameX, y: markY + 4, width: 260, height: 40 },
    },
    safeArea: sourceSafeArea ?? { x: imageArea.x * WIDTH, y: imageArea.y * HEIGHT, width: imageArea.width * WIDTH, height: imageArea.height * HEIGHT },
    slotRules: sourcePlan?.slotRules ?? {},
    slots: {
      title,
      subtitle,
      ...(sourceEyebrow ? { eyebrow: sourceEyebrow } : {}),
      ...(sourceImage ? { image: sourceImage } : {}),
      ...Object.fromEntries(Object.entries(sourcePlan?.slots ?? {})
        .filter(([id]) => !['title', 'subtitle', 'eyebrow', 'image', 'lockup', 'lockup-name'].includes(id))
        .map(([id, frame]) => [id, toPixels(frame)])),
      header: sourceHeader ?? { x: 80, y: 0, width: 1440, height: headerLineY },
      content,
      footer: sourceFooter ?? { x: 80, y: 842, width: 1440, height: 42 },
    },
    sourceTemplate: input.templateSource ? { id: input.templateSource.id, surface: input.templateSource.surface, archetype: input.templateSource.archetype } : undefined,
  };
}

export function slidePlanSummary(plan: ResolvedSlidePlan): Record<string, unknown> {
  return {
    templateRef: plan.templateRef,
    direction: plan.direction,
    titleAlign: plan.titleAlign,
    titleLayout: plan.titleLayout,
    titleConstraints: plan.titleConstraints,
    subtitleConstraints: plan.subtitleConstraints,
    slotRules: plan.slotRules,
    sourceTemplate: plan.sourceTemplate,
    slotBoxes: {
      ...plan.slots,
      lockup: plan.lockup.mark,
      'lockup-name': plan.lockup.name,
    },
    slots: { lockup: plan.lockup.placement, title: 'title', subtitle: 'subtitle', content: 'content', footer: 'footer' },
    lockup: { spacing: plan.lockup.spacing, physicalSide: plan.lockup.physicalSide },
  };
}
