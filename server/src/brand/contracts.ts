import type { LockupPlacement, LockupSpacing, SlideTemplateRef, TextDirection } from '../template/direction.js';

/** Request-level theme overrides accepted by MCP and CLI render operations. */
export interface BrandOverrides {
  fit?: {
    strategy?: 'none' | 'shrink-to-fit';
    min_body_pt?: number;
    min_heading_pt?: number;
  };
  layout?: {
    density?: 'comfortable' | 'compact';
    lockup_position?: LockupPlacement;
    lockup_spacing?: LockupSpacing;
  };
  typography?: {
    body?: { scale?: number; family?: string; role?: string };
    heading?: { scale?: number; family?: string; role?: string };
    heading_role?: string;
  };
  emphasis?: { role?: string };
}

export interface RenderComposition {
  templateRef: SlideTemplateRef;
  direction: TextDirection;
  lockupPlacement: LockupPlacement;
  lockupSpacing: LockupSpacing;
}
