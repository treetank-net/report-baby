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
import {
  declaredBlockSlotsForFlow,
  declaredGraphicSlots,
  declaredLockupSlotsForFlow,
  declaredMainTextSlots,
  declaredTextSlotsForFlow,
  expandGrowthTargets,
  normalizedBox,
  slotFrame,
} from './page-template-slots.js';

export interface PageTemplateCompositionOptions {
  maxPages: number;
  mainFlowId?: string;
  auxiliaryTextWidths?: Record<string, number>;
  includeTitlePage?: boolean;
  includeHeaderFlow?: boolean;
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
function layout(id: string, geometry: PageGeometry, slots: CompositionSlotTemplate[]): CompositionLayoutTemplate {
  return { id, width: geometry.width, height: geometry.height, slots };
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
  firstTextSlots: CompositionSlotTemplate[],
  firstBlockSlots: CompositionSlotTemplate[],
  continuationTextSlots: CompositionSlotTemplate[],
  continuationBlockSlots: CompositionSlotTemplate[],
  firstSlots: CompositionSlotTemplate[],
  continuationSlots: CompositionSlotTemplate[],
  mainSlotIds: string[],
  continuationSourceIds: string[],
  firstLayoutId: string,
  continuationLayoutId: string,
  continuation: 'allowed' | 'forbidden',
  priority?: number,
): CompositionFlowRoute {
  const firstSlotIds = orderedMainSlotIds(mainSlotIds, firstTextSlots, firstBlockSlots, firstSlots);
  const continuationSlotIds = orderedMainSlotIds(continuationSourceIds, continuationTextSlots, continuationBlockSlots, continuationSlots);
  if (leadSlot) firstSlotIds.unshift(leadSlot.id);
  return {
    slots: firstSlotIds,
    layouts: [firstLayoutId, continuationLayoutId],
    slotsByLayout: { [continuationLayoutId]: continuationSlotIds },
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
 * adapter only gives it named slots and a first-page/continuation-page route.
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
  const firstLayoutId = `${compiled.id}:first`;
  const continuationLayoutId = `${compiled.id}:continuation`;
  const titleLayoutId = `${compiled.id}:title`;
  const continuationGeometry = geometry.continuation ?? geometry;
  const firstContentBottom = geometry.bands.footer?.top ?? geometry.continuationBottom ?? geometry.content.bottom;
  const continuationContentBottom = continuationGeometry.bands.footer?.top ?? continuationGeometry.continuationBottom ?? continuationGeometry.content.bottom;
  const firstContinuationTop = geometry.continuationTop ?? geometry.segments.reduce((top, segment) => Math.min(top, segment.top), geometry.content.top);
  const continuationTop = continuationGeometry.continuationTop ?? continuationGeometry.segments.reduce((top, segment) => Math.min(top, segment.top), continuationGeometry.content.top);
  const leadBlockId = geometry.flow.lead;
  const lead = leadBlockId ? geometry.blockFrames[leadBlockId] : undefined;
  const mainSourceIds = [...new Set([...mainFlow.slots, ...(mainFlow.continuationSlots ?? [])])];
  const specialRoles = new Set(['intro', 'quote', 'sidebar', 'header', 'footer', 'title']);
  const restrictSpecialRoles = leadBlockId !== undefined || mainSourceIds.some((slotId) => specialRoles.has(compiled.slots[slotId]?.role ?? ''));
  const firstContentTop = lead?.bottom ?? firstContinuationTop;
  const contentSlot = mainFlow.slots.includes('content') || mainFlow.continuationSlots?.includes('content')
    ? compiled.slots.content
    : undefined;
  const contentFrame = contentSlot ? normalizedBox(slotFrame(contentSlot, false), geometry) : undefined;
  const continuationContentFrame = contentSlot ? normalizedBox(slotFrame(contentSlot, true), continuationGeometry) : undefined;
  const contentBlockKinds: CompositionBlockKind[] = (contentSlot?.allowedBlockKinds ?? []) as CompositionBlockKind[];
  const firstSegments = segmentSlots('first', clipSegmentsToFrame(clipSegments(geometry.segments, firstContentTop, firstContentBottom), contentFrame ?? box(geometry.content)), contentBlockKinds, restrictSpecialRoles, mainFlowId);
  const continuationSegments = segmentSlots('continuation', clipSegmentsToFrame(clipSegments(continuationGeometry.segments, continuationTop, continuationContentBottom), continuationContentFrame ?? box(continuationGeometry.content)), contentBlockKinds, restrictSpecialRoles, mainFlowId);
  const firstMainSlotIds = mainFlow.slots;
  const continuationSourceIds = mainFlow.continuationSlots ?? mainFlow.slots;
  const declaredBlockSlots = declaredBlockSlotsForFlow(compiled, mainFlowId, geometry, firstMainSlotIds);
  const continuationBlockSlots = declaredBlockSlotsForFlow(compiled, mainFlowId, continuationGeometry, continuationSourceIds, true);
  const declaredTextSlots = declaredMainTextSlots(compiled, mainFlowId, geometry, firstMainSlotIds, firstSegments);
  const continuationTextSlots = declaredMainTextSlots(compiled, mainFlowId, continuationGeometry, continuationSourceIds, continuationSegments, true);
  const firstGraphicSlots = declaredGraphicSlots(compiled, geometry);
  const continuationGraphicSlots = declaredGraphicSlots(compiled, continuationGeometry, true);
  const continuationFlowSegments = continuationSegments;
  const leadGrowth = leadBlockId ? geometry.blockGrowth?.[leadBlockId] : undefined;
  const leadSlot: CompositionSlotTemplate | undefined = lead && leadBlockId
    ? {
      id: `block:${leadBlockId}`,
      regionId: leadBlockId,
      kind: 'text',
      box: box(lead),
      allowedBlockIds: [leadBlockId],
      ...(leadGrowth ? {
        grow: {
          axis: leadGrowth.axis,
          maxHeight: leadGrowth.maxHeight,
          pushes: (leadGrowth.pushes ?? []).flatMap((target) => target === 'narrative' ? firstSegments.map((slot) => slot.id) : [target]),
        },
      } : {}),
    }
    : undefined;
  const auxiliary: Array<{ flowId: string; first: CompositionSlotTemplate[]; continuation: CompositionSlotTemplate[] }> = [];
  const auxiliaryFlowIds = new Set(Object.keys(compiled.flows));
  if (options.includeHeaderFlow) auxiliaryFlowIds.add('header');
  for (const flowId of auxiliaryFlowIds) {
    if (flowId === mainFlowId) continue;
    if (flowId === 'title') continue;
    const declaredFirst = expandGrowthTargets([...declaredLockupSlotsForFlow(compiled, flowId, geometry), ...declaredTextSlotsForFlow(compiled, flowId, geometry)], firstSegments);
    const declaredContinuation = expandGrowthTargets([...declaredLockupSlotsForFlow(compiled, flowId, continuationGeometry, true), ...declaredTextSlotsForFlow(compiled, flowId, continuationGeometry, true)], continuationFlowSegments);
    const declaredFirstBlocks = expandGrowthTargets(declaredBlockSlotsForFlow(compiled, flowId, geometry), firstSegments);
    const declaredContinuationBlocks = expandGrowthTargets(declaredBlockSlotsForFlow(compiled, flowId, continuationGeometry, undefined, true), continuationFlowSegments);
    const declaredFirstAll = [...declaredFirst, ...declaredFirstBlocks];
    const declaredContinuationAll = [...declaredContinuation, ...declaredContinuationBlocks];
    const firstFrame = auxiliaryFrame(flowId, compiled, geometry);
    const continuationFrame = auxiliaryFrame(flowId, compiled, continuationGeometry);
    if (!firstFrame && !continuationFrame && declaredFirstAll.length === 0 && declaredContinuationAll.length === 0) {
      throw new Error(`Template flow '${flowId}' needs a named page band or block frame before it can be adapted.`);
    }
    const textWidth = options.auxiliaryTextWidths?.[flowId];
    // A single legacy auxiliary slot historically meant "use the whole
    // named band". Preserve that behavior; multiple declared slots opt into
    // independently positioned boxes (for example header period + title).
    const useDeclaredFirst = declaredFirstAll.length > 1 || declaredFirstAll.some((slot) => slot.kind === 'block' || (slot.allowedRoles?.length ?? 0) > 0);
    const useDeclaredContinuation = declaredContinuationAll.length > 1 || declaredContinuationAll.some((slot) => slot.kind === 'block' || (slot.allowedRoles?.length ?? 0) > 0);
    const first = useDeclaredFirst || !firstFrame
      ? declaredFirstAll
      : firstFrame ? [auxiliarySlot(flowId, firstFrame, textWidth)] : [];
    const continuation = useDeclaredContinuation || !continuationFrame
      ? declaredContinuationAll
      : continuationFrame ? [auxiliarySlot(flowId, continuationFrame, textWidth)] : [];
    auxiliary.push({
      flowId,
      first,
      continuation,
    });
  }
  const firstTitleSlots = declaredTextSlotsForFlow(compiled, 'title', geometry);
  const continuationTitleSlots = declaredTextSlotsForFlow(compiled, 'title', continuationGeometry, true);
  const firstLayout = layout(firstLayoutId, geometry, [...(leadSlot ? [leadSlot] : []), ...firstTitleSlots, ...declaredTextSlots, ...declaredBlockSlots, ...firstSegments, ...firstGraphicSlots, ...auxiliary.flatMap((item) => item.first)]);
  const continuationLayout = layout(continuationLayoutId, continuationGeometry, [...continuationTitleSlots, ...continuationTextSlots, ...continuationBlockSlots, ...continuationFlowSegments, ...continuationGraphicSlots, ...auxiliary.flatMap((item) => item.continuation)]);
  const titleLayout = options.includeTitlePage
    ? titleLayoutFor(compiled, geometry, titleLayoutId)
    : undefined;
  const routes: Record<string, CompositionFlowRoute> = {
    [mainFlowId]: routeForMain(
      leadSlot,
      declaredTextSlots,
      declaredBlockSlots,
      continuationTextSlots,
      continuationBlockSlots,
      firstSegments,
      continuationFlowSegments,
      firstMainSlotIds,
      continuationSourceIds,
      firstLayoutId,
      continuationLayoutId,
      mainFlow.continuation,
      mainFlow.priority,
    ),
  };
  if (!titleLayout && firstTitleSlots.length > 0) {
    routes.title = {
      slots: firstTitleSlots.map((slot) => slot.id),
      layouts: [firstLayoutId],
      slotsByLayout: { [firstLayoutId]: firstTitleSlots.map((slot) => slot.id) },
      continuation: 'forbidden',
      ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
    };
  }
  if (titleLayout) {
    routes[mainFlowId] = {
      ...routes[mainFlowId],
      startPage: 2,
      layouts: [titleLayoutId, firstLayoutId, continuationLayoutId],
      slotsByLayout: { [titleLayoutId]: [], ...(routes[mainFlowId].slotsByLayout ?? {}) },
    };
    routes.title = {
      slots: ['title-page-content'],
      layouts: [titleLayoutId, firstLayoutId, continuationLayoutId],
      slotsByLayout: { [titleLayoutId]: ['title-page-content'], [firstLayoutId]: [], [continuationLayoutId]: [] },
      continuation: 'forbidden',
      ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
    };
  }
  for (const item of auxiliary) {
    if (item.flowId === 'title' && !titleLayout && firstTitleSlots.length > 0) continue;
    if (item.flowId === 'title' && !titleLayout) {
      if (item.first.length === 0) throw new Error(`Template flow '${item.flowId}' needs a first-page frame.`);
      routes.title = {
        slots: item.first.map((slot) => slot.id),
        layouts: [firstLayoutId],
      slotsByLayout: { [firstLayoutId]: item.first.map((slot) => slot.id) },
      continuation: 'forbidden',
        ...(compiled.flows.title?.priority === undefined ? {} : { priority: compiled.flows.title.priority }),
      };
      continue;
    }
    routes[item.flowId] = {
      slots: item.first.map((slot) => slot.id),
      layouts: [firstLayoutId, continuationLayoutId],
      slotsByLayout: { [firstLayoutId]: item.first.map((slot) => slot.id), [continuationLayoutId]: item.continuation.map((slot) => slot.id) },
      continuation: compiled.flows[item.flowId]?.continuation ?? 'forbidden',
      ...(compiled.flows[item.flowId]?.priority === undefined ? {} : { priority: compiled.flows[item.flowId]?.priority }),
      ...(compiled.flows[item.flowId]?.insertionSlots === undefined ? {} : { insertionSlots: [...(compiled.flows[item.flowId]?.insertionSlots ?? [])] }),
      ...(compiled.flows[item.flowId]?.repeat === undefined ? {} : { repeat: compiled.flows[item.flowId].repeat }),
      ...(compiled.flows[item.flowId]?.startPage === undefined ? {} : { startPage: compiled.flows[item.flowId].startPage }),
    };
    if (item.flowId === 'header') {
      routes[item.flowId].repeat = 'each-page';
      if (titleLayout || item.first.length === 0) routes[item.flowId].startPage = 2;
    }
    if (titleLayout) {
      routes[item.flowId].layouts = [titleLayoutId, firstLayoutId, continuationLayoutId];
      routes[item.flowId].slotsByLayout = {
        [titleLayoutId]: item.flowId === 'footer' ? ['title-page-footer'] : [],
        [firstLayoutId]: item.first.map((slot) => slot.id),
        [continuationLayoutId]: item.continuation.map((slot) => slot.id),
      };
    }
  }
  return {
    layouts: [...(titleLayout ? [titleLayout] : []), firstLayout, continuationLayout],
    routes,
    maxPages: options.maxPages,
    ...(compiled.composition?.headingKeepWithNextLines === undefined ? {} : { headingKeepWithNextLines: compiled.composition.headingKeepWithNextLines }),
  };
}
