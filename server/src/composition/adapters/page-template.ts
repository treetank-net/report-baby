import type { PageGeometry, PageSegment } from '../../template/geometry.js';
import type { CompiledTemplate } from '../../template/contracts.js';
import type {
  CompositionFlowRoute,
  CompositionLayoutTemplate,
  CompositionRect,
  CompositionSlotTemplate,
  CompositionBlockRole,
  CompositionBlockKind,
  CompositionTemplate,
} from '../contracts/model.js';
import type { PageTemplateScheduleInput } from '../../contracts/input/schema.js';
import { normalizePageTemplateSchedule, type PageTemplateScheduleEntryInput, type PageTemplateScheduleVariant } from './page-template-schedule.js';
import {
  declaredBlockSlotsForFlow,
  declaredGraphicSlots,
  declaredLockupSlotsForFlow,
  declaredMainTextSlots,
  declaredTextSlotsForFlow,
  expandGrowthTargets,
  normalizedBox,
} from './page-template-slots.js';

export interface PageTemplateCompositionOptions {
  maxPages: number;
  mainFlowId?: string;
  auxiliaryTextWidths?: Record<string, number>;
  includeTitlePage?: boolean;
  includeHeaderFlow?: boolean;
  /** Configured breathing room after a static header before ordinary content. */
  headerBottomGap?: number;
}

export interface PageTemplateSource {
  templateRef: string;
  compiled: CompiledTemplate;
  geometry: PageGeometry;
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current box implementation intact until its target seam is extracted.
 */
function box(segment: PageSegment): CompositionRect {
  return {
    x: segment.x,
    y: segment.top,
    width: segment.width,
    height: segment.bottom - segment.top,
  };
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current clipSegments implementation intact until its target seam is extracted.
 */
function clipSegments(segments: PageSegment[], top: number, bottom: number): PageSegment[] {
  return segments
    .map((segment) => ({ ...segment, top: Math.max(segment.top, top), bottom: Math.min(segment.bottom, bottom) }))
    .filter((segment) => segment.bottom > segment.top);
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current clipSegmentsToFrame implementation intact until its target seam is extracted.
 */
function clipSegmentsToFrame(segments: PageSegment[], frame: CompositionRect): PageSegment[] {
  return segments
    .map((segment) => {
      const right = Math.min(segment.x + segment.width, frame.x + frame.width);
      const bottom = Math.min(segment.bottom, frame.y + frame.height);
      return {
        x: Math.max(segment.x, frame.x),
        top: Math.max(segment.top, frame.y),
        width: right - Math.max(segment.x, frame.x),
        bottom,
      };
    })
    .filter((segment) => segment.width > 0 && segment.bottom > segment.top);
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current segmentSlots implementation intact until its target seam is extracted.
 */
function segmentSlots(prefix: string, segments: PageSegment[], allowedBlockKinds: CompositionBlockKind[] = [], restrictSpecialRoles = false, flowId?: string): CompositionSlotTemplate[] {
  return segments.map((segment, index) => ({
    id: `${prefix}:segment-${index + 1}`,
    regionId: 'content',
    ...(flowId === undefined ? {} : { flowId }),
    kind: 'text',
    box: box(segment),
    ...(restrictSpecialRoles ? {
      // Ordinary column flow accepts narrative text and headings. Special
      // boxes (intro, quote, sidebar, chrome) must be declared explicitly by
      // a template that names such boxes; plain narrative templates keep
      // their historical ability to flow every supported block here.
      allowedRoles: ['body', 'heading', 'metric', 'chart', 'table'] as CompositionBlockRole[],
    } : {}),
    ...(allowedBlockKinds.length > 0 ? { allowedBlockKinds } : {}),
  }));
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current layout implementation intact until its target seam is extracted.
 */
function layout(
  id: string,
  geometry: PageGeometry,
  slots: CompositionSlotTemplate[],
  firstPageNumber = 1,
  firstPageContentTop?: number,
  firstPageContentSlotIds: string[] = [],
): CompositionLayoutTemplate {
  return {
    id,
    templateRef: id,
    firstPageNumber,
    ...(firstPageContentTop === undefined ? {} : { firstPageContentTop }),
    ...(firstPageContentSlotIds.length === 0 ? {} : { firstPageContentSlotIds: [...firstPageContentSlotIds] }),
    width: geometry.width,
    height: geometry.height,
    slots,
  };
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current auxiliaryFrame implementation intact until its target seam is extracted.
 */
function auxiliaryFrame(flowId: string, compiled: CompiledTemplate, geometry: PageGeometry): PageSegment | undefined {
  if (flowId === 'header' && geometry.bands.header) {
    const band = geometry.bands.header;
    return {
      x: geometry.margins.left,
      top: Math.max(band.top, geometry.margins.top),
      width: geometry.width - geometry.margins.left - geometry.margins.right,
      bottom: band.bottom,
    };
  }
  // A header is a page chrome band, not an ordinary content slot.  If a
  // layout does not declare that band, the header flow is intentionally
  // absent on that layout (for example on a title/first page).
  if (flowId === 'header') return undefined;
  const declaredSlots = compiled.flows[flowId]?.slots ?? [];
  if (declaredSlots.length === 1) {
    const declaredSlot = compiled.slots[declaredSlots[0]];
    if (declaredSlot) {
      return {
        x: declaredSlot.frame.x * geometry.width,
        top: declaredSlot.frame.y * geometry.height,
        width: declaredSlot.frame.width * geometry.width,
        bottom: (declaredSlot.frame.y + declaredSlot.frame.height) * geometry.height,
      };
    }
  }
  if (geometry.bands[flowId]) return geometry.bands[flowId];
  if (geometry.blockFrames[flowId]) return geometry.blockFrames[flowId];
  if (declaredSlots.length !== 1) return undefined;
  return geometry.bands[declaredSlots[0]] ?? geometry.blockFrames[declaredSlots[0]];
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current auxiliarySlot implementation intact until its target seam is extracted.
 */
function auxiliarySlot(flowId: string, frame: PageSegment, textWidth?: number): CompositionSlotTemplate {
  return {
    id: `flow:${flowId}`,
    regionId: flowId,
    kind: 'text',
    box: { ...box(frame), ...(textWidth === undefined ? {} : { width: Math.min(frame.width, textWidth) }) },
  };
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current orderedMainSlotIds implementation intact until its target seam is extracted.
 */
function orderedMainSlotIds(
  sourceSlotIds: string[],
  textSlots: CompositionSlotTemplate[],
  blockSlots: CompositionSlotTemplate[],
  segments: CompositionSlotTemplate[],
): string[] {
  const byId = new Map([...textSlots, ...blockSlots].map((slot) => [slot.id, slot]));
  return sourceSlotIds.flatMap((sourceId) => sourceId === 'content'
    ? segments
    : byId.has(sourceId) ? [byId.get(sourceId)!] : []).map((slot) => slot.id);
}

/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current routeForMain implementation intact until its target seam is extracted.
 */
function routeForMain(
  leadSlot: CompositionSlotTemplate | undefined,
  textSlots: CompositionSlotTemplate[],
  blockSlots: CompositionSlotTemplate[],
  flowSegments: CompositionSlotTemplate[],
  sourceSlotIds: string[],
  layoutId: string,
  continuation: 'allowed' | 'forbidden',
  priority?: number,
): CompositionFlowRoute {
  const slotIds = orderedMainSlotIds(sourceSlotIds, textSlots, blockSlots, flowSegments);
  if (leadSlot) slotIds.unshift(leadSlot.id);
  return {
    slots: slotIds,
    slotsByLayout: { [layoutId]: slotIds },
    continuation,
    ...(priority === undefined ? {} : { priority }),
  };
}

function titleLayoutFor(
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  titleLayoutId: string,
): CompositionLayoutTemplate {
  const titleContent = compiled.slots['title-page-content'];
  const titleFooter = compiled.slots['title-page-footer'];
  if (!titleContent || !titleFooter) {
    throw new Error(`Template '${compiled.id}' must define 'title-page-content' and 'title-page-footer' slots when a title flow is present.`);
  }
  return layout(titleLayoutId, geometry, [
    {
      id: 'title-page-content',
      regionId: titleContent.region ?? 'title',
      flowId: 'title',
      kind: 'text',
      box: normalizedBox(titleContent.frame, geometry),
    },
    {
      id: 'title-page-footer',
      regionId: titleFooter.region ?? 'footer',
      flowId: 'footer',
      kind: 'text',
      box: normalizedBox(titleFooter.frame, geometry),
    },
  ]);
}

/**
 * Turn the existing page geometry into the renderer-neutral composition
 * template. Geometry remains owned by the compiled YAML template; this
 * adapter only gives it named slots and a page-template selection range.
 *
 * A leading page block is deliberately an ordinary text slot. Its role
 * restriction prevents the next block from consuming leftover leading space.
 * Quote insertions are represented by their own named flow instead of this
 * main-flow lead mechanism.
 */
/**
 * @planner-target composition/adapters/page-template.ts
 * @planner-responsibility Keep the current compositionTemplateFromPageGeometry implementation intact until its target seam is extracted.
 */
export function compositionTemplateFromPageGeometry(
  compiled: CompiledTemplate,
  geometry: PageGeometry,
  options: PageTemplateCompositionOptions,
): CompositionTemplate {
  if (!Number.isInteger(options.maxPages) || options.maxPages < 1) {
    throw new Error('Composition template adapter requires a positive integer maxPages value.');
  }
  const mainFlowId = options.mainFlowId ?? 'main';
  const mainFlow = compiled.flows[mainFlowId];
  if (!mainFlow) throw new Error(`Template '${compiled.id}' has no '${mainFlowId}' flow.`);
  const layoutId = compiled.id;
  const titleLayoutId = `${compiled.id}:title`;
  const contentBottom = geometry.bands.footer?.top ?? geometry.content.bottom;
  const segmentTop = geometry.segments.reduce((top, segment) => Math.min(top, segment.top), geometry.content.top);
  const staticHeaderBottom = (compiled.flows.header?.slots ?? [])
    .map((slotId) => compiled.slots[slotId])
    .filter((slot): slot is NonNullable<typeof slot> => slot !== undefined && slot.fitContent !== true)
    .reduce((bottom, slot) => Math.max(bottom, (slot.frame.y + slot.frame.height) * geometry.height), segmentTop);
  const contentTop = Math.max(segmentTop, staticHeaderBottom + (options.headerBottomGap ?? 0));
  const leadBlockId = geometry.flow.lead;
  const lead = leadBlockId ? geometry.blockFrames[leadBlockId] : undefined;
  const mainSourceIds = [...new Set(mainFlow.slots)];
  const specialRoles = new Set(['intro', 'quote', 'sidebar', 'header', 'footer', 'title']);
  const restrictSpecialRoles = leadBlockId !== undefined || mainSourceIds.some((slotId) => specialRoles.has(compiled.slots[slotId]?.role ?? ''));
  // Keep ordinary segment geometry at the template content boundary.  The
  // first materialised page reserves any leading/static main blocks below;
  // later pages keep the full band because those blocks are first-page-only
  // content in the generated layout.
  const flowTop = contentTop;
  const contentSlot = mainFlow.slots.includes('content') ? compiled.slots.content : undefined;
  const contentFrame = contentSlot ? normalizedBox(contentSlot.frame, geometry) : undefined;
  const contentBlockKinds: CompositionBlockKind[] = (contentSlot?.allowedBlockKinds ?? []) as CompositionBlockKind[];
  const segments = segmentSlots('content', clipSegmentsToFrame(clipSegments(geometry.segments, flowTop, contentBottom), contentFrame ?? box(geometry.content)), contentBlockKinds, restrictSpecialRoles, mainFlowId);
  const declaredBlockSlots = declaredBlockSlotsForFlow(compiled, mainFlowId, geometry, mainSourceIds);
  const declaredTextSlots = declaredMainTextSlots(compiled, mainFlowId, geometry, mainSourceIds, segments);
  const graphicSlots = declaredGraphicSlots(compiled, geometry);
  const leadGrowth = leadBlockId ? geometry.blockGrowth?.[leadBlockId] : undefined;
  const leadSlot: CompositionSlotTemplate | undefined = lead && leadBlockId
    ? {
      id: `block:${leadBlockId}`,
      regionId: leadBlockId,
      kind: 'text',
      box: box(lead),
      allowedBlockIds: [leadBlockId],
      firstPageOnly: true,
      ...(leadGrowth ? {
        grow: {
          axis: leadGrowth.axis,
          maxHeight: leadGrowth.maxHeight,
          pushes: (leadGrowth.pushes ?? []).flatMap((target) => target === 'narrative' ? segments.map((slot) => slot.id) : [target]),
        },
      } : {}),
    }
    : undefined;
  const auxiliary: Array<{ flowId: string; slots: CompositionSlotTemplate[] }> = [];
  const auxiliaryFlowIds = new Set(Object.keys(compiled.flows));
  if (options.includeHeaderFlow) auxiliaryFlowIds.add('header');
  for (const flowId of auxiliaryFlowIds) {
    if (flowId === mainFlowId) continue;
    if (flowId === 'title') continue;
    const declaredSlots = [
      ...declaredLockupSlotsForFlow(compiled, flowId, geometry),
      ...declaredTextSlotsForFlow(compiled, flowId, geometry),
      ...declaredBlockSlotsForFlow(compiled, flowId, geometry),
    ];
    const declaredById = new Map(declaredSlots.map((slot) => [slot.id, slot]));
    // Keep the authored flow-slot order.  Mixing text and atomic slots is
    // legal (for example, an intro image followed by its lead); grouping by
    // slot kind would silently reverse that lifecycle and advance the flow to
    // the next page before the following slot can be used.
    const declaredAll = expandGrowthTargets(
      (compiled.flows[flowId]?.slots ?? []).flatMap((slotId) => {
        const slot = declaredById.get(slotId);
        return slot ? [slot] : [];
      }),
      segments,
    );
    const firstFrame = auxiliaryFrame(flowId, compiled, geometry);
    if (!firstFrame && declaredAll.length === 0) {
      throw new Error(`Template flow '${flowId}' needs a named page band or block frame before it can be adapted.`);
    }
    const textWidth = options.auxiliaryTextWidths?.[flowId];
    // A single legacy auxiliary slot historically meant "use the whole
    // named band". Preserve that behavior; multiple declared slots opt into
    // independently positioned boxes (for example header period + title).
    const useDeclared = declaredAll.length > 1 || declaredAll.some((slot) => slot.kind === 'block' || (slot.allowedRoles?.length ?? 0) > 0);
    const slots = useDeclared || !firstFrame ? declaredAll : [auxiliarySlot(flowId, firstFrame, textWidth)];
    auxiliary.push({ flowId, slots });
  }
  const titleSlots = declaredTextSlotsForFlow(compiled, 'title', geometry);
  const allSlots = [...(leadSlot ? [leadSlot] : []), ...titleSlots, ...declaredTextSlots, ...declaredBlockSlots, ...segments, ...graphicSlots, ...auxiliary.flatMap((item) => item.slots)];
  const uniqueSlots = [...new Map(allSlots.map((slot) => [slot.id, slot])).values()];
  const firstPageContentTop = Math.max(
    contentTop,
    ...segments.map((segment) => segment.box.y),
    lead?.bottom ?? contentTop,
    ...mainSourceIds
      .filter((sourceId) => sourceId !== 'content')
      .map((sourceId) => compiled.slots[sourceId])
      .filter((source): source is NonNullable<typeof source> => source !== undefined)
      .map((source) => {
        const frame = normalizedBox(source.frame, geometry);
        return frame.y + frame.height;
      }),
  );
  const baseLayout = layout(layoutId, geometry, uniqueSlots, 1, firstPageContentTop, segments.map((segment) => segment.id));
  const titleLayout = options.includeTitlePage
    ? titleLayoutFor(compiled, geometry, titleLayoutId)
    : undefined;
  const schedule = titleLayout
    ? [{ from: 1, to: 1, templateRef: compiled.id, layoutId: titleLayoutId }, { from: 2, templateRef: compiled.id, layoutId }]
    : [{ from: 1, templateRef: compiled.id, layoutId }];
  const routes: Record<string, CompositionFlowRoute> = {
    [mainFlowId]: {
      ...routeForMain(
        leadSlot,
        declaredTextSlots,
        declaredBlockSlots,
        segments,
        mainSourceIds,
        layoutId,
        mainFlow.continuation,
        mainFlow.priority,
      ),
      ...(mainFlow.startPage === undefined ? {} : { startPage: mainFlow.startPage }),
    },
  };
  if (!titleLayout && titleSlots.length > 0) {
    routes.title = {
      slots: titleSlots.map((slot) => slot.id),
      slotsByLayout: { [layoutId]: titleSlots.map((slot) => slot.id) },
      continuation: 'forbidden',
      ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
    };
  }
  if (titleLayout) {
    routes[mainFlowId] = {
      ...routes[mainFlowId],
      startPage: 2,
      slotsByLayout: { [titleLayoutId]: [], [layoutId]: routes[mainFlowId].slots },
    };
    routes.title = {
      slots: ['title-page-content'],
      slotsByLayout: { [titleLayoutId]: ['title-page-content'], [layoutId]: [] },
      continuation: 'forbidden',
      ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
    };
  }
  for (const item of auxiliary) {
    if (item.flowId === 'title' && !titleLayout && titleSlots.length > 0) continue;
    if (item.flowId === 'title' && !titleLayout) {
      if (item.slots.length === 0) throw new Error(`Template flow '${item.flowId}' needs a page frame.`);
      routes.title = {
        slots: item.slots.map((slot) => slot.id),
        slotsByLayout: { [layoutId]: item.slots.map((slot) => slot.id) },
        continuation: 'forbidden',
        ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
      };
      continue;
    }
    routes[item.flowId] = {
      slots: item.slots.map((slot) => slot.id),
      slotsByLayout: { [layoutId]: item.slots.map((slot) => slot.id) },
      continuation: compiled.flows[item.flowId]?.continuation ?? 'forbidden',
      ...(compiled.flows[item.flowId]?.priority === undefined ? {} : { priority: compiled.flows[item.flowId]?.priority }),
      ...(compiled.flows[item.flowId]?.insertionSlots === undefined ? {} : { insertionSlots: [...(compiled.flows[item.flowId]?.insertionSlots ?? [])] }),
      ...(compiled.flows[item.flowId]?.repeat === undefined ? {} : { repeat: compiled.flows[item.flowId].repeat }),
      ...(compiled.flows[item.flowId]?.startPage === undefined ? {} : { startPage: compiled.flows[item.flowId].startPage }),
    };
    if (item.flowId === 'header') {
      routes[item.flowId].repeat = 'each-page';
      if (titleLayout || item.slots.length === 0) routes[item.flowId].startPage = 2;
    }
    if (titleLayout) {
      routes[item.flowId].slotsByLayout = {
        [titleLayoutId]: item.flowId === 'footer' ? ['title-page-footer'] : [],
        [layoutId]: item.slots.map((slot) => slot.id),
      };
    }
  }
  return {
    layouts: [...(titleLayout ? [titleLayout] : []), baseLayout],
    routes,
    maxPages: options.maxPages,
    pageTemplateSchedule: schedule,
    ...(compiled.composition?.headingKeepWithNextLines === undefined ? {} : { headingKeepWithNextLines: compiled.composition.headingKeepWithNextLines }),
  };
}

/**
 * Combine ordinary layouts from several compiled page templates under one
 * renderer-neutral composition pass.  Page state resolves the schedule; flow
 * planning only sees the named slots exposed by the selected layout.
 */
export function compositionTemplateFromPageTemplateSchedule(
  sources: PageTemplateSource[],
  schedule: PageTemplateScheduleInput | PageTemplateScheduleVariant,
  options: PageTemplateCompositionOptions,
): CompositionTemplate {
  if (sources.length === 0) throw new Error('A page-template schedule needs at least one compiled template.');
  const normalized = !Array.isArray(schedule)
    ? [schedule]
    : normalizePageTemplateSchedule(schedule.map((entry): PageTemplateScheduleEntryInput => ({
      pages: {
        ...(entry.pages.from === undefined ? {} : { from: entry.pages.from }),
        ...(entry.pages.to === undefined ? {} : { to: entry.pages.to }),
        ...(entry.pages.count === undefined ? {} : { count: entry.pages.count }),
      },
      templateRef: entry.template_ref,
    })));
  if (normalized.length !== 1) throw new Error('A ranged page-template schedule must be expanded into one candidate before composition planning.');
  const variant = normalized[0];
  const sourceByRef = new Map(sources.map((source) => [source.templateRef, source]));
  const layouts: CompositionLayoutTemplate[] = [];
  const routes: Record<string, CompositionFlowRoute> = {};
  const layoutByRef = new Map<string, string>();
  for (const source of sources) {
    const isTitleSource = options.includeTitlePage === true && variant.entries[0]?.templateRef === source.templateRef && source.compiled.pageTitle;
    const adapted = compositionTemplateFromPageGeometry(source.compiled, source.geometry, {
      ...options,
      includeTitlePage: Boolean(isTitleSource),
    });
    const ordinary = adapted.layouts.find((layout) => layout.id === source.compiled.id);
    if (!ordinary) throw new Error(`Template '${source.templateRef}' did not produce an ordinary page layout.`);
    const firstPageNumber = variant.entries.find((entry) => entry.templateRef === source.templateRef)?.from ?? 1;
    layouts.push(...adapted.layouts.map((layout) => ({ ...layout, templateRef: source.templateRef, firstPageNumber: layout.id.endsWith(':title') ? 1 : firstPageNumber })));
    layoutByRef.set(source.templateRef, isTitleSource && adapted.layouts.some((layout) => layout.id === `${source.compiled.id}:title`) ? `${source.compiled.id}:title` : ordinary.id);
    for (const [flowId, route] of Object.entries(adapted.routes)) {
      const existing = routes[flowId];
      const routeSlots = route.slotsByLayout?.[ordinary.id] ?? route.slots;
      if (!existing) {
        routes[flowId] = { ...route, slots: routeSlots, slotsByLayout: {} };
      }
      const destination = routes[flowId];
      if (!destination) continue;
      destination.slotsByLayout = { ...(destination.slotsByLayout ?? {}), [ordinary.id]: routeSlots };
      const titleId = `${source.compiled.id}:title`;
      if (route.slotsByLayout?.[titleId]) destination.slotsByLayout[titleId] = route.slotsByLayout[titleId];
    }
  }
  const pageTemplateSchedule = variant.entries.map((entry) => {
    const source = sourceByRef.get(entry.templateRef);
    if (!source) throw new Error(`Page-template schedule references unknown template '${entry.templateRef}'.`);
    const layoutId = entry.from === 1 ? layoutByRef.get(entry.templateRef) ?? source.templateRef : source.templateRef;
    return { from: entry.from, ...(entry.to === undefined ? {} : { to: entry.to }), templateRef: entry.templateRef, layoutId };
  });
  return {
    layouts,
    routes,
    maxPages: Math.min(options.maxPages, variant.maxPages ?? options.maxPages),
    pageTemplateSchedule,
    ...(options.includeTitlePage ? { } : {}),
  };
}
