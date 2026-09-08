import type { ResolvedBox } from './resolved-slide-plan.js';

export type ReportPlanRole = 'header' | 'footer' | 'intro' | 'flow' | 'section' | 'table' | 'highlights' | 'kpis' | 'charts';

export interface ResolvedReportBlock {
  id: string;
  role: ReportPlanRole;
  box: ResolvedBox;
  column?: number;
  parentId?: string;
  /** A logical grouping that contains allocations but is not itself paintable. */
  container?: boolean;
}

export interface ResolvedReportPagePlan {
  page: number;
  width: number;
  height: number;
  continuation: boolean;
  blocks: ResolvedReportBlock[];
}

export interface ResolvedReportPlan {
  schemaVersion: 1;
  templateRef: string;
  pages: ResolvedReportPagePlan[];
}
