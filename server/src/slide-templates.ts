import type { Slide } from './slides.js';
import { readBuiltinSlideTemplate, type BuiltinSlideTemplateDocument } from './builtin-template-loader.js';

export type SlideTemplateRef = string;
export type TextDirection = 'ltr' | 'rtl';
export type LogicalAlign = 'start' | 'center' | 'end';
export type PhysicalAlign = 'left' | 'center' | 'right';
export type LockupPlacement = 'top-start' | 'top-end';
export type LockupSpacing = 'compact' | 'normal' | 'open';

export interface SlideTemplateDefinition extends Omit<BuiltinSlideTemplateDocument, 'id'> {
  id: SlideTemplateRef;
}

export function resolveSlideTemplate(value: unknown): SlideTemplateDefinition {
  const id = value === undefined ? 'slides/standard' : value;
  if (typeof id !== 'string') throw new Error(`Unsupported slide template '${String(id)}'.`);
  const template = readBuiltinSlideTemplate(id);
  if (!template) throw new Error(`Unsupported slide template '${id}'. Expected a built-in template from the templates directory or a brand-owned template.`);
  return { ...template, id };
}

export function physicalAlign(direction: TextDirection, align: LogicalAlign): PhysicalAlign {
  if (align === 'center') return 'center';
  if (align === 'start') return direction === 'rtl' ? 'right' : 'left';
  return direction === 'rtl' ? 'left' : 'right';
}

export function physicalSide(direction: TextDirection, placement: LockupPlacement): 'left' | 'right' {
  const end = placement === 'top-end';
  return (direction === 'rtl' ? !end : end) ? 'right' : 'left';
}

export function logicalDirection(value: unknown, fallback: TextDirection = 'ltr'): TextDirection {
  if (value === undefined) return fallback;
  if (value !== 'ltr' && value !== 'rtl') throw new Error(`Unsupported text direction '${String(value)}'. Expected ltr or rtl.`);
  return value;
}

export function logicalPlacement(value: unknown, fallback: LockupPlacement = 'top-start'): LockupPlacement {
  if (value === undefined) return fallback;
  if (value !== 'top-start' && value !== 'top-end') throw new Error(`Unsupported lockup position '${String(value)}'. Expected top-start or top-end.`);
  return value;
}

export function logicalSpacing(value: unknown, fallback: LockupSpacing = 'normal'): LockupSpacing {
  if (value === undefined) return fallback;
  if (value !== 'compact' && value !== 'normal' && value !== 'open') throw new Error(`Unsupported lockup spacing '${String(value)}'. Expected compact, normal or open.`);
  return value;
}

export function templateTitleAlign(template: SlideTemplateDefinition, slide: Slide): LogicalAlign {
  return slide.type === 'title' && template.id === 'slides/centered-title' ? 'center' : template.titleAlign;
}
