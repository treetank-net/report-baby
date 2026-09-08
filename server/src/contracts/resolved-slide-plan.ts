import type { Slide } from './input/schema.js';
import type { LockupPlacement, LockupSpacing, TextDirection } from '../template/direction.js';

export interface ResolvedBox { x: number; y: number; width: number; height: number }

export interface ResolvedLockupPlan {
  placement: LockupPlacement;
  physicalSide: 'left' | 'right';
  spacing: LockupSpacing;
  verticalAlign: 'top' | 'middle' | 'bottom';
  mark: ResolvedBox;
  name: ResolvedBox;
}

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
  slotRules: Record<string, { maxLines?: number; overflow?: 'reject' | 'shrink-to-fit'; verticalAlign?: 'top' | 'middle' | 'bottom' }>;
  slots: { title: ResolvedBox; subtitle: ResolvedBox; eyebrow?: ResolvedBox; image?: ResolvedBox; header: ResolvedBox; content: ResolvedBox; footer: ResolvedBox; [key: string]: ResolvedBox | undefined };
  sourceTemplate?: { id: string; surface: string; archetype?: string };
}
