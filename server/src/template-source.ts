import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'yaml';

export type TemplateKind = 'slide' | 'page';
export type TemplateSlotKind = 'text' | 'image' | 'lockup' | 'metric-card';
export type TemplateOverflow = 'reject' | 'shrink-to-fit';

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
  region?: string;
  role?: string;
  maxLines?: number;
  overflow?: TemplateOverflow;
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
  constraints: {
    insideCanvas: boolean;
    noOverlap: boolean;
  };
}

export interface ResolvedTemplatePlan {
  templateRef: string;
  direction: 'ltr' | 'rtl';
  regions: Record<string, NormalizedFrame>;
  slots: Record<string, NormalizedFrame>;
  slotRules: Record<string, { maxLines?: number; overflow?: TemplateOverflow }>;
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

function frameAt(value: unknown, path: string): NormalizedFrame {
  if (!isRecord(value)) fail(path, 'must contain a frame object.');
  const frame = isRecord(value.frame) ? value.frame : value;
  const result = {
    x: numberAt(frame.x, `${path}.x`),
    y: numberAt(frame.y, `${path}.y`),
    width: numberAt(frame.width, `${path}.width`),
    height: numberAt(frame.height, `${path}.height`),
  };
  if (result.width <= 0 || result.height <= 0) fail(path, 'width and height must be greater than zero.');
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
    const slotKind = slot.type === 'text' || slot.type === 'image' || slot.type === 'lockup' || slot.type === 'metric-card' ? slot.type : fail(`slots.${slotId}.type`, "must be 'text', 'image', 'lockup' or 'metric-card'.");
    const region = slot.region === undefined ? undefined : stringAt(slot.region, `slots.${slotId}.region`);
    if (region && !regions[region]) fail(`slots.${slotId}.region`, `references unknown region '${region}'.`);
    const frame = slot.frame !== undefined
      ? frameAt(slot.frame, `slots.${slotId}.frame`)
      : region
        ? regions[region]
        : fail(`slots.${slotId}`, 'needs a frame or a region.');
    const overflow = slot.overflow === undefined || slot.overflow === 'reject' || slot.overflow === 'shrink-to-fit'
      ? slot.overflow
      : fail(`slots.${slotId}.overflow`, "must be 'reject' or 'shrink-to-fit'.");
    slots[slotId] = {
      id: slotId,
      kind: slotKind,
      frame,
      region,
      role: slot.role === undefined ? undefined : stringAt(slot.role, `slots.${slotId}.role`),
      maxLines: optionalPositiveInteger(slot.max_lines, `slots.${slotId}.max_lines`),
      overflow,
    };
  }
  if (Object.keys(slots).length === 0) fail('slots', 'must contain at least one named slot.');
  const archetype = source.archetype === undefined ? undefined : source.archetype === 'title' || source.archetype === 'metrics' || source.archetype === 'chart' || source.archetype === 'table' || source.archetype === 'narrative' || source.archetype === 'conclusions' || source.archetype === 'columns'
    ? source.archetype
    : fail('archetype', "must be one of 'title', 'metrics', 'chart', 'table', 'narrative', 'conclusions' or 'columns'.");
  if (archetype === 'metrics') {
    for (const slotId of ['metric-1', 'metric-2', 'metric-3']) {
      if (slots[slotId]?.kind !== 'metric-card') fail(`slots.${slotId}`, "metrics templates need three metric-card slots named metric-1, metric-2 and metric-3.");
    }
  }

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
    constraints: {
      insideCanvas: true,
      noOverlap: constraints.no_overlap === true,
    },
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
    slotRules: Object.fromEntries(Object.entries(compiledTemplate.slots).map(([id, slot]) => [id, { maxLines: slot.maxLines, overflow: slot.overflow }])),
    constraints: compiledTemplate.constraints,
  };
}

export async function readTemplateSource(filePath: string): Promise<unknown> {
  if (!existsSync(filePath)) return undefined;
  const raw = await readFile(filePath, 'utf8');
  return extname(filePath).toLowerCase() === '.json' ? JSON.parse(raw) : parse(raw);
}
