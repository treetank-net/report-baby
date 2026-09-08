import { normalizeMarkdown, normalizeStructuredContent, normalizedText } from '../markdown-normalizer.js';
import type { NormalizedContentNode, NormalizedImageNode } from '../content-model.js';
import type { CompositionInput } from '../contract/schema.js';
import type { CompositionAsset, CompositionBlock, CompositionDocument, CompositionFlow, CompositionGraphic } from './model.js';

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current blockId implementation intact until its target seam is extracted.
 */
function blockId(value: string | undefined, flowId: string, index: number): string {
  return value ?? `${flowId}-block-${index + 1}`;
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current imageAssetId implementation intact until its target seam is extracted.
 */
function imageAssetId(id: string): string {
  return `${id}:asset-1`;
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current contentNodes implementation intact until its target seam is extracted.
 */
function contentNodes(input: { text?: string; content?: unknown[] }): { nodes: NormalizedContentNode[]; text: string; diagnostics: string[] } {
  const normalized = Array.isArray(input.content) ? normalizeStructuredContent(input.content) : normalizeMarkdown(input.text ?? '');
  return { nodes: normalized.nodes, text: normalizedText(normalized), diagnostics: normalized.diagnostics };
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current imageNodes implementation intact until its target seam is extracted.
 */
function imageNodes(nodes: NormalizedContentNode[]): NormalizedImageNode[] {
  return nodes.flatMap((node) => {
    if (node.type === 'image') return [node];
    if (node.type === 'list') return node.items.flatMap((item) => imageNodes(item.children));
    if ('children' in node) return imageNodes(node.children);
    return [];
  });
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current plainText implementation intact until its target seam is extracted.
 */
function plainText(nodes: NormalizedContentNode[]): string {
  return normalizedText({ nodes, source: 'commonmark', diagnostics: [] });
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current textBlock implementation intact until its target seam is extracted.
 */
function textBlock(id: string, role: CompositionBlock['role'], text: string, content?: NormalizedContentNode[], diagnostics?: string[]): CompositionBlock {
  return {
    id,
    kind: 'paragraph',
    role,
    text,
    ...(content === undefined ? {} : { content }),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current imageBlock implementation intact until its target seam is extracted.
 */
function imageBlock(id: string, role: CompositionBlock['role'], image: NormalizedImageNode, assetId: string): CompositionBlock {
  return {
    id,
    kind: 'image',
    role,
    content: [image],
    image: {
      assetId,
      width: image.width,
      fit: image.fit,
      wrap: image.wrap,
      ...(image.caption === undefined ? {} : { caption: image.caption }),
      keepWithCaption: image.keepWithCaption,
    },
    atomic: true,
  };
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current inlineParts implementation intact until its target seam is extracted.
 */
function inlineParts(nodes: NormalizedContentNode[]): Array<{ kind: 'text'; nodes: NormalizedContentNode[] } | { kind: 'image'; image: NormalizedImageNode }> {
  const parts: Array<{ kind: 'text'; nodes: NormalizedContentNode[] } | { kind: 'image'; image: NormalizedImageNode }> = [];
  let textNodes: NormalizedContentNode[] = [];
  /**
   * @planner-target composition/input.ts
   * @planner-responsibility Keep the current flush implementation intact until its target seam is extracted.
   */
  const flush = (): void => {
    if (textNodes.length > 0) parts.push({ kind: 'text', nodes: textNodes });
    textNodes = [];
  };
  for (const node of nodes) {
    if (node.type === 'image') {
      flush();
      parts.push({ kind: 'image', image: node });
    } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') {
      for (const part of inlineParts(node.children)) {
        if (part.kind === 'image') {
          flush();
          parts.push(part);
        } else {
          textNodes.push({ ...node, children: part.nodes });
        }
      }
    } else {
      textNodes.push(node);
    }
  }
  flush();
  return parts;
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current contentBlocks implementation intact until its target seam is extracted.
 */
function contentBlocks(id: string, role: CompositionBlock['role'], normalized: ReturnType<typeof contentNodes>): CompositionBlock[] {
  const blocks: CompositionBlock[] = [];
  let imageIndex = 0;
  let textIndex = 0;
  /**
   * @planner-target composition/input.ts
   * @planner-responsibility Keep the current addText implementation intact until its target seam is extracted.
   */
  const addText = (nodes: NormalizedContentNode[]): void => {
    const text = plainText(nodes);
    if (!text.trim()) return;
    textIndex += 1;
    blocks.push(textBlock(textIndex === 1 ? id : `${id}:part-${textIndex}`, role, text, nodes));
  };
  /**
   * @planner-target composition/input.ts
   * @planner-responsibility Keep the current addParts implementation intact until its target seam is extracted.
   */
  const addParts = (parts: ReturnType<typeof inlineParts>): void => {
    for (const part of parts) {
      if (part.kind === 'text') addText(part.nodes);
      else {
        imageIndex += 1;
        const assetId = imageIndex === 1 ? imageAssetId(id) : `${id}:asset-${imageIndex}`;
        blocks.push(imageBlock(`${id}:image-${imageIndex}`, role, part.image, assetId));
      }
    }
  };
  for (const node of normalized.nodes) {
    if (node.type === 'image') {
      imageIndex += 1;
      const assetId = imageIndex === 1 ? imageAssetId(id) : `${id}:asset-${imageIndex}`;
      blocks.push(imageBlock(`${id}:image-${imageIndex}`, role, node, assetId));
    } else if (node.type === 'paragraph') addParts(inlineParts(node.children));
    else if (node.type === 'list') for (const item of node.items) addParts(inlineParts(item.children));
    else addParts(inlineParts([node]));
  }
  if (normalized.diagnostics.length > 0 && blocks.length > 0) blocks[0] = { ...blocks[0], diagnostics: normalized.diagnostics };
  return blocks;
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current convertBlock implementation intact until its target seam is extracted.
 */
function convertBlock(flowId: string, input: CompositionInput['flows'][string]['blocks'][number], index: number): CompositionBlock[] {
  const id = blockId(input.id, flowId, index);
  const role = input.role ?? (input.type === 'heading' ? 'heading' : input.type === 'image' ? 'body' : input.type === 'table' ? 'table' : input.type === 'chart' ? 'chart' : input.type === 'metric' ? 'metric' : 'body');
  const common = {
    id,
    role,
    ...(input.atomic === undefined ? {} : { atomic: input.atomic }),
    ...(input.keep_with_next_lines === undefined ? {} : { keepWithNextLines: input.keep_with_next_lines }),
  };
  if (input.type === 'text') {
    const normalized = contentNodes({ text: input.text, content: input.content });
    return imageNodes(normalized.nodes).length > 0
      ? contentBlocks(id, role, normalized)
      : [{ ...common, kind: 'paragraph', text: normalized.text, content: normalized.nodes, ...(normalized.diagnostics.length ? { diagnostics: normalized.diagnostics } : {}) }];
  }
  if (input.type === 'heading') return [{ ...common, kind: 'heading', text: input.text, ...(input.level === undefined ? {} : { level: input.level }) }];
  if (input.type === 'list-item') return [{ ...common, kind: 'list-item', text: input.text }];
  if (input.type === 'image') {
    const assetId = input.asset_id ?? imageAssetId(id);
    return [{ ...common, kind: 'image', image: { assetId, width: input.width as CompositionAsset['width'], fit: input.fit, wrap: input.wrap, ...(input.caption === undefined ? {} : { caption: input.caption }), keepWithCaption: input.keep_with_caption }, atomic: input.atomic ?? true }];
  }
  if (input.type === 'table') return [{ ...common, kind: 'table', table: { head: input.head, body: input.body, ...(input.caption === undefined ? {} : { caption: input.caption }) } }];
  if (input.type === 'metric') return [{ ...common, kind: 'metric', metric: { label: input.label, value: input.value, ...(input.delta === undefined ? {} : { delta: input.delta }), ...(input.trend === undefined ? {} : { trend: input.trend }), ...(input.note === undefined ? {} : { note: input.note }) }, atomic: input.atomic ?? true }];
  const chart = { type: input.chart_type, title: input.title, subtitle: input.subtitle, prefix: input.prefix, suffix: input.suffix, data: input.data };
  return [{ ...common, kind: 'chart', chart, atomic: input.atomic ?? true }];
}

/**
 * @planner-target composition/input.ts
 * @planner-responsibility Keep the current compositionDocumentFromInput implementation intact until its target seam is extracted.
 */
export function compositionDocumentFromInput(input: CompositionInput): CompositionDocument {
  const flows: Record<string, CompositionFlow> = {};
  for (const [flowId, flow] of Object.entries(input.flows)) {
    flows[flowId] = {
      id: flowId,
      blocks: flow.blocks.flatMap((block, index) => convertBlock(flowId, block, index)),
      continuation: flow.continuation,
    };
  }
  const assets: CompositionAsset[] = (input.assets ?? []).map((asset) => ({
    id: asset.id,
    source: asset.source,
    ...(asset.alt === undefined ? {} : { alt: asset.alt }),
    ...(asset.caption === undefined ? {} : { caption: asset.caption }),
    width: asset.width as CompositionAsset['width'],
    fit: asset.fit,
    keepWithCaption: asset.keep_with_caption,
  }));
  for (const [flowId, flow] of Object.entries(input.flows)) {
    flow.blocks.forEach((block, index) => {
      if (block.type !== 'image' || !block.src) return;
      const id = blockId(block.id, flowId, index);
      const assetId = block.asset_id ?? imageAssetId(id);
      if (assets.some((asset) => asset.id === assetId)) return;
      assets.push({ id: assetId, source: block.src, ...(block.alt === undefined ? {} : { alt: block.alt }), ...(block.caption === undefined ? {} : { caption: block.caption }), width: block.width as CompositionAsset['width'], fit: block.fit, keepWithCaption: block.keep_with_caption });
    });
  }
  for (const flow of Object.values(flows)) {
    for (const block of flow.blocks) {
      const image = block.image;
      if (!image || assets.some((asset) => asset.id === image.assetId)) continue;
      const source = input.assets?.find((asset) => asset.id === image.assetId)?.source;
      if (source) assets.push({ id: image.assetId, source, width: image.width as CompositionAsset['width'], fit: image.fit, keepWithCaption: image.keepWithCaption });
      else if (block.content?.[0]?.type === 'image') {
        const sourceNode = block.content[0];
        assets.push({ id: image.assetId, source: sourceNode.src, ...(sourceNode.alt === undefined ? {} : { alt: sourceNode.alt }), ...(sourceNode.caption === undefined ? {} : { caption: sourceNode.caption }), width: sourceNode.width as CompositionAsset['width'], fit: sourceNode.fit, keepWithCaption: sourceNode.keepWithCaption });
      }
    }
  }
  const graphics: CompositionGraphic[] = (input.graphics ?? []).map((graphic) => ({
    id: graphic.id,
    ...(graphic.asset_id === undefined ? {} : { assetId: graphic.asset_id }),
    slotId: graphic.slot_id,
    ...(graphic.size === undefined ? {} : { size: { width: graphic.size.width, height: graphic.size.height } }),
    shape: graphic.shape,
    ...(graphic.wrap === undefined ? {} : { wrap: graphic.wrap }),
    ...(graphic.page === undefined ? {} : { page: graphic.page }),
    ...(graphic.points === undefined ? {} : { points: graphic.points.map((point) => ({ x: point.x, y: point.y })) }),
    ...(graphic.vertex_count === undefined ? {} : { vertexCount: graphic.vertex_count }),
    ...(graphic.inner_ratio === undefined ? {} : { innerRatio: graphic.inner_ratio }),
    ...(graphic.alt === undefined ? {} : { alt: graphic.alt }),
  }));
  return {
    flows,
    ...(assets.length > 0 ? { assets } : {}),
    ...(graphics.length > 0 ? { graphics } : {}),
    ...(input.glyphs && input.glyphs.length > 0 ? {
      glyphs: input.glyphs.map((glyph) => ({
        id: glyph.id,
        target: glyph.target,
        text: glyph.text,
        styleName: glyph.style,
        anchor: glyph.anchor,
        ...(glyph.anchor_alignment === undefined ? {} : { anchorAlignment: glyph.anchor_alignment }),
        targetMode: glyph.target_mode,
        ...(glyph.anchor_measure_style === undefined ? {} : { anchorMeasureStyleName: glyph.anchor_measure_style }),
        ...(glyph.offset_x === undefined ? {} : { offsetX: glyph.offset_x }),
        ...(glyph.offset_y === undefined ? {} : { offsetY: glyph.offset_y }),
        ...(glyph.clamp_to_target === undefined ? {} : { clampToTarget: glyph.clamp_to_target }),
        ...(glyph.opacity === undefined ? {} : { opacity: glyph.opacity }),
      })),
    } : {}),
    diagnostics: Object.values(flows).flatMap((flow) => flow.blocks.flatMap((block) => block.diagnostics ?? [])),
  };
}
