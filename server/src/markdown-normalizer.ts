import { toString } from 'mdast-util-to-string';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { NormalizedContentDocument, NormalizedContentNode, NormalizedImageNode } from './content-model.js';

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
  depth?: number;
  ordered?: boolean | null;
  spread?: boolean;
}

const parser = unified().use(remarkParse);

function text(value: string): NormalizedContentNode {
  return { type: 'text', value };
}

function image(node: MarkdownNode): NormalizedImageNode {
  const title = typeof node.title === 'string' && node.title.length > 0 ? node.title : undefined;
  return {
    type: 'image',
    src: node.url ?? '',
    alt: typeof node.alt === 'string' && node.alt.length > 0 ? node.alt : undefined,
    title,
    caption: title,
    width: 'full',
    fit: 'contain',
    keepWithCaption: true,
  };
}

function inline(node: MarkdownNode, diagnostics: string[]): NormalizedContentNode[] {
  if (node.type === 'text') return [text(node.value ?? '')];
  if (node.type === 'image') return [image(node)];
  if (node.type === 'strong' || node.type === 'emphasis') return [{ type: node.type, children: (node.children ?? []).flatMap((child) => inline(child, diagnostics)) }];
  if (node.type === 'link') return [{ type: 'link', href: node.url, children: (node.children ?? []).flatMap((child) => inline(child, diagnostics)) }];
  if (node.type === 'break') return [text('\n')];
  if (node.type === 'inlineCode' || node.type === 'code') return [text(node.value ?? '')];
  if (node.type === 'html') {
    diagnostics.push(`Unsupported raw HTML was omitted from Markdown content: ${toString(node)}`);
    return [];
  }
  diagnostics.push(`Unsupported Markdown inline node '${node.type}' was omitted.`);
  return [];
}

function block(node: MarkdownNode, diagnostics: string[]): NormalizedContentNode[] {
  if (node.type === 'paragraph') return [{ type: 'paragraph', children: (node.children ?? []).flatMap((child) => inline(child, diagnostics)) }];
  if (node.type === 'heading') return [{ type: 'heading', depth: node.depth ?? 1, children: (node.children ?? []).flatMap((child) => inline(child, diagnostics)) }];
  if (node.type === 'list') {
    return [{
      type: 'list',
      ordered: Boolean(node.ordered),
      items: (node.children ?? []).map((item) => ({ type: 'paragraph', children: (item.children ?? []).flatMap((child) => block(child, diagnostics).flatMap((nested) => nested.type === 'paragraph' ? nested.children : [nested])) })),
    }];
  }
  if (node.type === 'blockquote') return (node.children ?? []).flatMap((child) => block(child, diagnostics));
  if (node.type === 'thematicBreak') {
    diagnostics.push('Unsupported Markdown thematic break was omitted.');
    return [];
  }
  if (node.type === 'code') {
    diagnostics.push('Markdown code blocks are not supported by the normalized report model.');
    return [];
  }
  if (node.type === 'html') {
    diagnostics.push(`Unsupported raw HTML was omitted from Markdown content: ${toString(node)}`);
    return [];
  }
  diagnostics.push(`Unsupported Markdown block node '${node.type}' was omitted.`);
  return [];
}

export function normalizeMarkdown(markdown: string): NormalizedContentDocument {
  const tree = parser.parse(markdown) as unknown as MarkdownNode;
  const diagnostics: string[] = [];
  return { nodes: (tree.children ?? []).flatMap((node) => block(node, diagnostics)), source: 'commonmark', diagnostics };
}

function structuredNode(node: any, diagnostics: string[]): NormalizedContentNode | undefined {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
    diagnostics.push('Structured content contains an invalid node.');
    return undefined;
  }
  if (node.type === 'text') return { type: 'text', value: typeof node.text === 'string' ? node.text : '' };
  if (node.type === 'image') return {
    type: 'image',
    src: String(node.src ?? ''),
    alt: typeof node.alt === 'string' ? node.alt : undefined,
    title: typeof node.title === 'string' ? node.title : undefined,
    caption: typeof node.caption === 'string' ? node.caption : typeof node.title === 'string' ? node.title : undefined,
    width: node.width === 'full' || typeof node.width !== 'string' ? 'full' : node.width,
    fit: 'contain',
    keepWithCaption: node.keep_with_caption !== false,
  };
  if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') {
    const children = Array.isArray(node.content) ? node.content.map((child: unknown) => structuredNode(child, diagnostics)).filter(Boolean) as NormalizedContentNode[] : [];
    return { type: node.type, children, href: typeof node.href === 'string' ? node.href : undefined };
  }
  if (node.type === 'paragraph') {
    const children = Array.isArray(node.content) ? node.content.map((child: unknown) => structuredNode(child, diagnostics)).filter(Boolean) as NormalizedContentNode[] : [];
    return { type: 'paragraph', children };
  }
  if (node.type === 'list') {
    const items = Array.isArray(node.items) ? node.items.map((item: any) => ({ type: 'paragraph' as const, children: Array.isArray(item?.content) ? item.content.map((child: unknown) => structuredNode(child, diagnostics)).filter(Boolean) as NormalizedContentNode[] : [] })) : [];
    return { type: 'list', ordered: node.ordered === true, items };
  }
  diagnostics.push(`Unsupported structured content node '${node.type}' was omitted.`);
  return undefined;
}

export function normalizeStructuredContent(content: unknown[]): NormalizedContentDocument {
  const diagnostics: string[] = [];
  return { nodes: content.map((node) => structuredNode(node, diagnostics)).filter(Boolean) as NormalizedContentNode[], source: 'commonmark', diagnostics };
}

export function normalizedText(document: NormalizedContentDocument): string {
  const flatten = (node: NormalizedContentNode): string => {
    if (node.type === 'text') return node.value;
    if (node.type === 'image') return '';
    if (node.type === 'table') return [...node.head, ...node.body.flat()].join(' ');
    if (node.type === 'chart') return [node.chart.title, node.chart.subtitle].filter(Boolean).join(' ');
    if (node.type === 'list') return node.items.map(flatten).join('\n');
    return node.children.map(flatten).join('');
  };
  return document.nodes.map(flatten).filter(Boolean).join('\n');
}
