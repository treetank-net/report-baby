import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'yaml';

export type TemplateKind = 'slide' | 'page';
export type TemplateSlotKind = 'text' | 'image' | 'lockup' | 'graphic' | 'metric-card' | 'chart' | 'table';
export type TemplateOverflow = 'reject' | 'shrink-to-fit';
export type TemplateFlowContinuation = 'allowed' | 'forbidden';
export type TemplateVerticalAlign = 'top' | 'middle' | 'bottom';
export type TemplateLengthUnit = 'percent' | 'px' | 'mm';

export interface TemplateLength {
  value: number;
  unit: TemplateLengthUnit;
}

export interface NormalizedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompiledTemplateSlot {
  id: string;
  kind: TemplateSlotKind;
  frame: NormalizedFrame;
  continuationFrame?: NormalizedFrame;
  region?: string;
  role?: string;
  allowedBlockIds?: string[];
  allowedBlockKinds?: string[];
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: TemplateVerticalAlign;
  fitContent?: boolean;
  gap?: TemplateLength;
  maxLines?: number;
  overflow?: TemplateOverflow;
  grow?: PageBlockGrowth;
}

export interface CompiledTemplateFlow {
  id: string;
  slots: string[];
  continuationSlots?: string[];
  insertionSlots?: string[];
  continuation: TemplateFlowContinuation;
  /** Higher values reserve geometry before lower-priority flows. */
  priority?: number;
  repeat?: 'each-page';
  startPage?: number;
}

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageFlow {
  align: 'justify' | 'left';
  hyphenate: boolean;
  lead?: string;
}

export interface PageBlockGrowth {
  axis: 'y';
  maxHeight: number;
  auto?: boolean;
  pushes?: string[];
}

export interface PageFlowObstacle {
  id: string;
  frame: NormalizedFrame;
}

export interface PageGeometry {
  width: number;
  height: number;
  margins: PageMargins;
  columns: {
    count: number;
    gutter: number;
    widths: number[];
  };
  reservedBands: Record<string, NormalizedFrame>;
  flowObstacles: PageFlowObstacle[];
  blockFrames: Record<string, NormalizedFrame>;
  blockGrowth: Record<string, PageBlockGrowth>;
  flow: PageFlow;
  continuation?: PageGeometry;
}

export interface CompiledTemplateComposition {
  headingKeepWithNextLines?: number;
}

export type TemplateArchetype = 'title' | 'metrics' | 'chart' | 'table' | 'narrative' | 'conclusions' | 'columns';

export interface CompiledTemplate {
  schemaVersion: 1;
  id: string;
  kind: TemplateKind;
  surface: string;
  archetype?: TemplateArchetype;
  canvas: { width: 1; height: 1; direction: 'ltr' | 'rtl' };
  regions: Record<string, NormalizedFrame>;
  slots: Record<string, CompiledTemplateSlot>;
  flows: Record<string, CompiledTemplateFlow>;
  constraints: {
    insideCanvas: boolean;
    noOverlap: boolean;
  };
  composition?: CompiledTemplateComposition;
  page?: PageGeometry;
  pageTitle?: boolean;
}

export interface ResolvedTemplatePlan {
  templateRef: string;
  direction: 'ltr' | 'rtl';
  regions: Record<string, NormalizedFrame>;
  slots: Record<string, NormalizedFrame>;
  slotRules: Record<string, { maxLines?: number; overflow?: TemplateOverflow; verticalAlign?: TemplateVerticalAlign }>;
  flows: Record<string, CompiledTemplateFlow>;
  constraints: CompiledTemplate['constraints'];
}

interface RecordValue {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Template ${path}: ${message}`);
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number.');
  return value;
}

function frameAt(value: unknown, path: string, allowZeroHeight = false): NormalizedFrame {
  if (!isRecord(value)) fail(path, 'must contain a frame object.');
  const frame = isRecord(value.frame) ? value.frame : value;
  const result = {
    x: numberAt(frame.x, `${path}.x`),
    y: numberAt(frame.y, `${path}.y`),
    width: numberAt(frame.width, `${path}.width`),
    height: numberAt(frame.height, `${path}.height`),
  };
  if (result.width <= 0 || result.height < 0 || (!allowZeroHeight && result.height === 0)) fail(path, allowZeroHeight ? 'width must be greater than zero and height must not be negative.' : 'width and height must be greater than zero.');
  if (result.x < 0 || result.y < 0 || result.x + result.width > 1 || result.y + result.height > 1) {
    fail(path, 'must stay inside the normalized canvas (0..1).');
  }
  return result;
}

function entriesAt(value: unknown, path: string): Array<[string, RecordValue]> {
  if (value === undefined) return [];
  if (!isRecord(value)) fail(path, 'must be an object.');
  return Object.entries(value).map(([id, item]) => {
    if (!isRecord(item)) fail(`${path}.${id}`, 'must be an object.');
    return [id, item];
  });
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(path, 'must be a non-empty string.');
  return value;
}

function optionalPositiveInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) fail(path, 'must be a positive integer.');
  return value;
}

function optionalNonNegativeInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(path, 'must be a non-negative integer.');
  return value;
}

function optionalPriority(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(path, 'must be a non-negative integer.');
  }
  return value;
}

function positiveNumberAt(value: unknown, path: string): number {
  const result = numberAt(value, path);
  if (result <= 0) fail(path, 'must be greater than zero.');
  return result;
}

function nonNegativeNumberAt(value: unknown, path: string): number {
  const result = numberAt(value, path);
  if (result < 0) fail(path, 'must not be negative.');
  return result;
}

function lengthAt(value: unknown, path: string): TemplateLength | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) fail(path, 'must be a non-negative number or a length with %, px or mm.');
    return { value, unit: 'percent' };
  }
  if (typeof value !== 'string') fail(path, 'must be a number or a length with %, px or mm.');
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(%|px|mm)$/);
  if (!match) fail(path, 'must use a number with %, px or mm.');
  return { value: Number(match[1]), unit: match[2] === '%' ? 'percent' : match[2] as 'px' | 'mm' };
}

function blockGrowthAt(value: unknown, path: string, frame: NormalizedFrame): PageBlockGrowth | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(path, 'must be an object.');
  if (value.axis !== undefined && value.axis !== 'y') fail(`${path}.axis`, "must be 'y'.");
  const auto = value.max_height === undefined;
  const maxHeight = auto ? 1 - frame.y : positiveNumberAt(value.max_height, `${path}.max_height`);
  if (maxHeight < frame.height) fail(`${path}.max_height`, 'must not be smaller than the block height.');
  if (frame.y + maxHeight > 1) fail(`${path}.max_height`, 'must keep the growing block inside the normalized canvas.');
  const pushes = value.pushes === undefined ? undefined : value.pushes;
  if (pushes !== undefined && (!Array.isArray(pushes) || pushes.some((item) => typeof item !== 'string' || item.length === 0))) {
    fail(`${path}.pushes`, 'must contain non-empty block names.');
  }
  return { axis: 'y', maxHeight, ...(auto ? { auto: true } : {}), ...(pushes === undefined ? {} : { pushes: [...pushes] }) };
}

function templateFlowsAt(value: unknown, path: string, slots: Record<string, CompiledTemplateSlot>): Record<string, CompiledTemplateFlow> {
  if (value === undefined) return {};
  if (!isRecord(value)) fail(path, 'must be an object.');
  return Object.fromEntries(Object.entries(value).map(([id, raw]) => {
    if (!isRecord(raw)) fail(`${path}.${id}`, 'must be an object.');
    const rawSlots = raw.slots;
    if (!Array.isArray(rawSlots) || rawSlots.length === 0 || rawSlots.some((slot) => typeof slot !== 'string' || slot.length === 0)) {
      fail(`${path}.${id}.slots`, 'must contain one or more named slots.');
    }
    for (const slot of rawSlots) {
      if (!slots[slot]) fail(`${path}.${id}.slots`, `references unknown slot '${slot}'.`);
    }
    const rawContinuationSlots = raw.continuation_slots;
    if (rawContinuationSlots !== undefined && (!Array.isArray(rawContinuationSlots) || rawContinuationSlots.length === 0 || rawContinuationSlots.some((slot) => typeof slot !== 'string' || slot.length === 0))) {
      fail(`${path}.${id}.continuation_slots`, 'must contain one or more named slots when provided.');
    }
    for (const slot of rawContinuationSlots ?? []) {
      if (!slots[slot]) fail(`${path}.${id}.continuation_slots`, `references unknown slot '${slot}'.`);
    }
    const rawInsertionSlots = raw.insertion_slots;
    if (rawInsertionSlots !== undefined && (!Array.isArray(rawInsertionSlots) || rawInsertionSlots.length === 0 || rawInsertionSlots.some((slot) => typeof slot !== 'string' || slot.length === 0))) {
      fail(`${path}.${id}.insertion_slots`, 'must contain one or more named slots when provided.');
    }
    if (id === 'main' && rawInsertionSlots !== undefined) {
      fail(`${path}.${id}.insertion_slots`, "the main flow cannot declare insertion slots; use a separate insertion flow.");
    }
    for (const slot of rawInsertionSlots ?? []) {
      if (!slots[slot]) fail(`${path}.${id}.insertion_slots`, `references unknown slot '${slot}'.`);
      if (!rawSlots.includes(slot)) fail(`${path}.${id}.insertion_slots`, `slot '${slot}' must also be listed in slots.`);
      if (slots[slot]?.kind === 'graphic' || slots[slot]?.kind === 'lockup') fail(`${path}.${id}.insertion_slots`, `slot '${slot}' must be a content slot, not '${slots[slot]?.kind}'.`);
    }
    const continuation = raw.continuation === undefined || raw.continuation === 'allowed' ? 'allowed' : raw.continuation === 'forbidden' ? 'forbidden' : fail(`${path}.${id}.continuation`, "must be 'allowed' or 'forbidden'.");
    const priority = optionalPriority(raw.priority, `${path}.${id}.priority`);
    const repeat = raw.repeat === undefined ? undefined : raw.repeat === 'each-page' ? raw.repeat : fail(`${path}.${id}.repeat`, "must be 'each-page'.");
    const startPage = optionalPositiveInteger(raw.start_page, `${path}.${id}.start_page`);
    return [id, { id, slots: [...rawSlots], ...(rawContinuationSlots === undefined ? {} : { continuationSlots: [...rawContinuationSlots] }), ...(rawInsertionSlots === undefined ? {} : { insertionSlots: [...rawInsertionSlots] }), continuation, ...(priority === undefined ? {} : { priority }), ...(repeat === undefined ? {} : { repeat }), ...(startPage === undefined ? {} : { startPage }) }];
  }));
}

function pageMarginsAt(value: unknown, path: string): PageMargins {
  if (!isRecord(value)) fail(path, 'must contain top, right, bottom and left margins.');
  return {
    top: nonNegativeNumberAt(value.top, `${path}.top`),
    right: nonNegativeNumberAt(value.right, `${path}.right`),
    bottom: nonNegativeNumberAt(value.bottom, `${path}.bottom`),
    left: nonNegativeNumberAt(value.left, `${path}.left`),
  };
}

function pageGeometryAt(value: unknown, path: string): PageGeometry {
  if (!isRecord(value)) fail(path, 'must contain page geometry.');
  const width = positiveNumberAt(value.width, `${path}.width`);
  const height = positiveNumberAt(value.height, `${path}.height`);
  const margins = pageMarginsAt(value.margins, `${path}.margins`);
  const columns = isRecord(value.columns) ? value.columns : {};
  const count = optionalPositiveInteger(columns.count, `${path}.columns.count`) ?? 1;
  const gutter = nonNegativeNumberAt(columns.gutter ?? 0, `${path}.columns.gutter`);
  const availableWidth = width - margins.left - margins.right;
  const availableHeight = height - margins.top - margins.bottom;
  if (availableWidth <= 0 || availableHeight <= 0) fail(path, 'margins must leave a positive content area.');
  if (count > 1 && gutter * (count - 1) >= availableWidth) fail(`${path}.columns.gutter`, 'leaves no positive width for the columns.');
  const rawWidths = columns.widths;
  let widths: number[];
  if (rawWidths === undefined) {
    const equalWidth = (availableWidth - gutter * (count - 1)) / count;
    widths = Array.from({ length: count }, () => equalWidth);
  } else {
    if (!Array.isArray(rawWidths) || rawWidths.length !== count) fail(`${path}.columns.widths`, `must contain exactly ${count} widths.`);
    widths = rawWidths.map((item, index) => positiveNumberAt(item, `${path}.columns.widths.${index}`));
    const total = widths.reduce((sum, item) => sum + item, 0) + gutter * (count - 1);
    if (Math.abs(total - availableWidth) > 0.001) fail(`${path}.columns.widths`, `must add up to the ${availableWidth} unit content width including gutters.`);
  }
  const frameDictionary = (raw: unknown, field: string): Record<string, NormalizedFrame> => {
    const result: Record<string, NormalizedFrame> = {};
    for (const [id, item] of entriesAt(raw, `${path}.${field}`)) result[id] = frameAt(item, `${path}.${field}.${id}`);
    return result;
  };
  const flowObstacles = value.flow_obstacles === undefined
    ? []
    : !Array.isArray(value.flow_obstacles)
      ? fail(`${path}.flow_obstacles`, 'must be an array.')
      : value.flow_obstacles.map((item, index) => {
        if (!isRecord(item)) fail(`${path}.flow_obstacles.${index}`, 'must be an object.');
        const id = stringAt(item.id, `${path}.flow_obstacles.${index}.id`);
        return { id, frame: frameAt(item.frame ?? item, `${path}.flow_obstacles.${index}`) };
      });
  const blockFrames = frameDictionary(value.blocks, 'blocks');
  const blockGrowth: Record<string, PageBlockGrowth> = {};
  for (const [id, item] of entriesAt(value.blocks, `${path}.blocks`)) {
    const frame = blockFrames[id];
    const growth = blockGrowthAt(item.grow, `${path}.blocks.${id}.grow`, frame);
    if (growth) blockGrowth[id] = growth;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const align = flow.align === undefined || flow.align === 'left' ? 'left' : flow.align === 'justify' ? 'justify' : fail(`${path}.flow.align`, "must be 'justify' or 'left'.");
  if (flow.hyphenate !== undefined && typeof flow.hyphenate !== 'boolean') fail(`${path}.flow.hyphenate`, 'must be boolean.');
  const lead = flow.lead === undefined ? undefined : stringAt(flow.lead, `${path}.flow.lead`);
  if (lead !== undefined && !blockFrames[lead]) fail(`${path}.flow.lead`, `references unknown block '${lead}'.`);
  for (const [id, growth] of Object.entries(blockGrowth)) {
    for (const target of growth.pushes ?? []) {
      if (!blockFrames[target]) fail(`${path}.blocks.${id}.grow.pushes`, `references unknown block '${target}'.`);
    }
  }
  const continuation = value.continuation === undefined
    ? undefined
    : pageGeometryAt(value.continuation, `${path}.continuation`);
  return {
    width,
    height,
    margins,
    columns: { count, gutter, widths },
    reservedBands: frameDictionary(value.reserved_bands, 'reserved_bands'),
    flowObstacles,
    blockFrames,
    blockGrowth,
    flow: { align, hyphenate: flow.hyphenate === true, ...(lead === undefined ? {} : { lead }) },
    ...(continuation === undefined ? {} : { continuation }),
  };
}

function overlaps(a: NormalizedFrame, b: NormalizedFrame): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function compileTemplateSource(source: unknown): CompiledTemplate {
  if (!isRecord(source)) fail('source', 'must be an object.');
  if (source.schema_version !== 1) fail('schema_version', 'must be 1.');
  const id = stringAt(source.id, 'id');
  const kind = source.kind === 'slide' || source.kind === 'page' ? source.kind : fail('kind', "must be 'slide' or 'page'.");
  const surface = stringAt(source.surface, 'surface');
  const canvas = isRecord(source.canvas) ? source.canvas : {};
  const direction = canvas.direction === undefined || canvas.direction === 'ltr' ? 'ltr' : canvas.direction === 'rtl' ? 'rtl' : fail('canvas.direction', "must be 'ltr' or 'rtl'.");
  const regions: Record<string, NormalizedFrame> = {};
  for (const [regionId, region] of entriesAt(source.regions, 'regions')) regions[regionId] = frameAt(region, `regions.${regionId}`);

  const slots: Record<string, CompiledTemplateSlot> = {};
  for (const [slotId, slot] of entriesAt(source.slots, 'slots')) {
    const slotKind = slot.type === 'text' || slot.type === 'image' || slot.type === 'lockup' || slot.type === 'graphic' || slot.type === 'metric-card' || slot.type === 'chart' || slot.type === 'table' ? slot.type : fail(`slots.${slotId}.type`, "must be 'text', 'image', 'lockup', 'graphic', 'metric-card', 'chart' or 'table'.");
    const region = slot.region === undefined ? undefined : stringAt(slot.region, `slots.${slotId}.region`);
    if (region && !regions[region]) fail(`slots.${slotId}.region`, `references unknown region '${region}'.`);
    const allowedBlockIds = slot.allowed_block_ids === undefined ? undefined : slot.allowed_block_ids;
    if (allowedBlockIds !== undefined && (!Array.isArray(allowedBlockIds) || allowedBlockIds.some((item) => typeof item !== 'string' || item.length === 0))) {
      fail(`slots.${slotId}.allowed_block_ids`, 'must contain non-empty block ids.');
    }
    const allowedBlockKinds = slot.allowed_block_kinds === undefined ? undefined : slot.allowed_block_kinds;
    if (allowedBlockKinds !== undefined && (!Array.isArray(allowedBlockKinds) || allowedBlockKinds.some((item) => typeof item !== 'string' || item.length === 0))) {
      fail(`slots.${slotId}.allowed_block_kinds`, 'must contain non-empty block kinds.');
    }
    const fitContent = slot.fit_content === undefined || typeof slot.fit_content === 'boolean'
      ? slot.fit_content
      : fail(`slots.${slotId}.fit_content`, 'must be boolean.');
    const frame = slot.frame !== undefined
      ? frameAt(slot.frame, `slots.${slotId}.frame`, fitContent === true)
      : region
        ? regions[region]
        : fail(`slots.${slotId}`, 'needs a frame or a region.');
    const continuationFrame = slot.continuation_frame === undefined
      ? undefined
      : frameAt(slot.continuation_frame, `slots.${slotId}.continuation_frame`, fitContent === true);
    const overflow = slot.overflow === undefined || slot.overflow === 'reject' || slot.overflow === 'shrink-to-fit'
      ? slot.overflow
      : fail(`slots.${slotId}.overflow`, "must be 'reject' or 'shrink-to-fit'.");
    const verticalAlign = slot.vertical_align === undefined || slot.vertical_align === 'top' || slot.vertical_align === 'middle' || slot.vertical_align === 'bottom'
      ? slot.vertical_align
      : fail(`slots.${slotId}.vertical_align`, "must be 'top', 'middle' or 'bottom'.");
    const gap = slotKind === 'lockup' ? lengthAt(slot.gap, `slots.${slotId}.gap`) : undefined;
    const grow = blockGrowthAt(slot.grow, `slots.${slotId}.grow`, frame);
    slots[slotId] = {
      id: slotId,
      kind: slotKind,
      frame,
      ...(continuationFrame === undefined ? {} : { continuationFrame }),
      region,
      role: slot.role === undefined ? undefined : stringAt(slot.role, `slots.${slotId}.role`),
      ...(allowedBlockIds === undefined ? {} : { allowedBlockIds: [...allowedBlockIds] }),
      ...(allowedBlockKinds === undefined ? {} : { allowedBlockKinds: [...allowedBlockKinds] }),
      textAlign: slot.align === undefined || slot.align === 'left' || slot.align === 'center' || slot.align === 'right'
        ? slot.align
        : fail(`slots.${slotId}.align`, "must be 'left', 'center' or 'right'."),
      ...(verticalAlign === undefined ? {} : { verticalAlign }),
      ...(fitContent === undefined ? {} : { fitContent }),
      ...(gap === undefined ? {} : { gap }),
      maxLines: optionalPositiveInteger(slot.max_lines, `slots.${slotId}.max_lines`),
      overflow,
      ...(grow === undefined ? {} : { grow }),
    };
  }
  if (Object.keys(slots).length === 0) fail('slots', 'must contain at least one named slot.');
  for (const [slotId, slot] of Object.entries(slots)) {
    for (const pushedId of slot.grow?.pushes ?? []) {
      if (!slots[pushedId] || pushedId === slotId) fail(`slots.${slotId}.grow.pushes`, `references unknown or self slot '${pushedId}'.`);
    }
  }
  const flows = templateFlowsAt(source.flows, 'flows', slots);
  const archetype = source.archetype === undefined ? undefined : source.archetype === 'title' || source.archetype === 'metrics' || source.archetype === 'chart' || source.archetype === 'table' || source.archetype === 'narrative' || source.archetype === 'conclusions' || source.archetype === 'columns'
    ? source.archetype
    : fail('archetype', "must be one of 'title', 'metrics', 'chart', 'table', 'narrative', 'conclusions' or 'columns'.");
  if (archetype === 'metrics') {
    for (const slotId of ['metric-1', 'metric-2', 'metric-3']) {
      if (slots[slotId]?.kind !== 'metric-card') fail(`slots.${slotId}`, "metrics templates need three metric-card slots named metric-1, metric-2 and metric-3.");
    }
  }
  const page = source.page === undefined ? undefined : pageGeometryAt(source.page, 'page');
  if (kind === 'page' && !page) fail('page', 'is required for kind page templates.');
  if (kind === 'slide' && page) fail('page', 'is only allowed for kind page templates.');
  if (source.title_page !== undefined && typeof source.title_page !== 'boolean') fail('title_page', 'must be boolean.');
  const composition = source.composition === undefined ? undefined : !isRecord(source.composition)
    ? fail('composition', 'must be an object.')
    : (() => {
      const headingKeepWithNextLines = optionalNonNegativeInteger(source.composition.heading_keep_with_next_lines, 'composition.heading_keep_with_next_lines');
      return headingKeepWithNextLines === undefined ? undefined : { headingKeepWithNextLines };
    })();

  const constraints = isRecord(source.constraints) ? source.constraints : {};
  if (constraints.inside_canvas !== undefined && typeof constraints.inside_canvas !== 'boolean') fail('constraints.inside_canvas', 'must be boolean.');
  if (constraints.inside_canvas !== undefined && constraints.inside_canvas !== true) fail('constraints.inside_canvas', 'the first template slice only supports true.');
  if (constraints.no_overlap !== undefined && typeof constraints.no_overlap !== 'boolean') fail('constraints.no_overlap', 'must be boolean.');
  if (constraints.no_overlap === true) {
    const slotEntries = Object.entries(slots);
    for (let index = 0; index < slotEntries.length; index += 1) {
      for (let other = index + 1; other < slotEntries.length; other += 1) {
        const [firstId, first] = slotEntries[index];
        const [secondId, second] = slotEntries[other];
        if (overlaps(first.frame, second.frame)) fail(`slots.${firstId}`, `overlaps slots.${secondId}; no_overlap is enabled.`);
      }
    }
  }
  return {
    schemaVersion: 1,
    id,
    kind,
    surface,
    archetype,
    canvas: { width: 1, height: 1, direction },
    regions,
    slots,
    flows,
    constraints: {
      insideCanvas: true,
      noOverlap: constraints.no_overlap === true,
    },
    ...(composition === undefined ? {} : { composition }),
    page,
    ...(source.title_page === true ? { pageTitle: true } : {}),
  };
}

function mirror(frame: NormalizedFrame, direction: 'ltr' | 'rtl'): NormalizedFrame {
  return direction === 'rtl' ? { ...frame, x: 1 - frame.x - frame.width } : frame;
}

export function resolvePlan(
  compiledTemplate: CompiledTemplate,
  profile: { direction?: 'ltr' | 'rtl' } = {},
  _data: { type?: string } = {},
): ResolvedTemplatePlan {
  const direction = profile.direction ?? compiledTemplate.canvas.direction;
  return {
    templateRef: compiledTemplate.id,
    direction,
    regions: Object.fromEntries(Object.entries(compiledTemplate.regions).map(([id, frame]) => [id, mirror(frame, direction)])),
    slots: Object.fromEntries(Object.entries(compiledTemplate.slots).map(([id, slot]) => [id, mirror(slot.frame, direction)])),
    slotRules: Object.fromEntries(Object.entries(compiledTemplate.slots).map(([id, slot]) => [id, { maxLines: slot.maxLines, overflow: slot.overflow, verticalAlign: slot.verticalAlign }])),
    flows: compiledTemplate.flows,
    constraints: compiledTemplate.constraints,
  };
}

export async function readTemplateSource(filePath: string): Promise<unknown> {
  if (!existsSync(filePath)) return undefined;
  const raw = await readFile(filePath, 'utf8');
  return extname(filePath).toLowerCase() === '.json' ? JSON.parse(raw) : parse(raw);
}
