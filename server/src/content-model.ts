export interface NormalizedTextNode {
  type: 'text';
  value: string;
}

export interface NormalizedInlineNode {
  type: 'strong' | 'emphasis' | 'link';
  children: NormalizedContentNode[];
  href?: string;
}

export interface NormalizedHeadingNode {
  type: 'heading';
  depth: number;
  children: NormalizedContentNode[];
}

export interface NormalizedImageNode {
  type: 'image';
  src: string;
  alt?: string;
  title?: string;
  caption?: string;
  width: 'full' | `${number}%`;
  fit: 'contain';
  keepWithCaption: boolean;
}

export interface NormalizedParagraphNode {
  type: 'paragraph';
  children: NormalizedContentNode[];
}

export interface NormalizedListNode {
  type: 'list';
  ordered: boolean;
  items: NormalizedParagraphNode[];
}

export interface NormalizedTableNode {
  type: 'table';
  head: string[];
  body: Array<Array<string | number>>;
  caption?: string;
}

export interface NormalizedChartNode {
  type: 'chart';
  chart: {
    type: 'bar' | 'line' | 'pie';
    title?: string;
    subtitle?: string;
    prefix?: string;
    suffix?: string;
    data: Array<{ label: string; value: number; color?: string }>;
  };
}

export type NormalizedContentNode = NormalizedTextNode | NormalizedInlineNode | NormalizedImageNode | NormalizedHeadingNode | NormalizedParagraphNode | NormalizedListNode | NormalizedTableNode | NormalizedChartNode;

export interface NormalizedContentDocument {
  nodes: NormalizedContentNode[];
  source: 'legacy-limited-markdown' | 'commonmark';
  diagnostics: string[];
}
