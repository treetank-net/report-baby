import type { CompositionDocument, CompositionGlyphDefinition, CompositionRect } from './model.js';
import type {
  CompositionGlyphSpec,
  CompositionLine,
  CompositionPlan,
  CompositionTextMetrics,
} from './engine.js';
import { compositionStyleName } from './style-name.js';

function plannedLines(plan: CompositionPlan): CompositionLine[] {
  return [...plan.lines, ...(plan.insertionLines ?? [])];
}

function glyphTargetBox(
  target: CompositionGlyphDefinition['target'],
  page: number,
  plan: CompositionPlan,
  lines: CompositionLine[],
): { box: CompositionRect; slotId?: string; flowId?: string } | undefined {
  if (target.kind === 'graphic') {
    const graphic = plan.graphicPlacements.find((placement) => placement.page === page && (placement.graphicId === target.id || placement.id === target.id));
    return graphic ? { box: graphic.box, slotId: graphic.slotId } : undefined;
  }
  const targetLines = lines.filter((line) => line.page === page && line.blockId === target.id);
  if (targetLines.length > 0) {
    const left = Math.min(...targetLines.map((line) => line.box.x));
    const top = Math.min(...targetLines.map((line) => line.box.y));
    const right = Math.max(...targetLines.map((line) => line.box.x + line.box.width));
    const bottom = Math.max(...targetLines.map((line) => line.box.y + line.box.height));
    return { box: { x: left, y: top, width: right - left, height: bottom - top }, slotId: targetLines[0].slotId, flowId: targetLines[0].flowId };
  }
  const placement = plan.blockPlacements.find((candidate) => candidate.page === page && candidate.blockId === target.id);
  return placement ? { box: placement.box, slotId: placement.slotId, flowId: undefined } : undefined;
}

function glyphAnchorX(metrics: CompositionTextMetrics, spec: CompositionGlyphSpec, target: { box: CompositionRect; line?: CompositionLine }): number {
  const offsetX = spec.offsetX ?? 0;
  if (spec.anchor === 'text-start') {
    const anchorX = target.line?.box.x ?? target.box.x;
    return spec.anchorAlignment === 'end'
      ? anchorX - metrics.measureText(spec.text, spec.styleName) - offsetX
      : anchorX + offsetX;
  }
  if (spec.anchor === 'text-end') {
    if (!target.line) return target.box.x + target.box.width + offsetX;
    const textWidth = spec.anchorMeasureStyleName
      ? metrics.measureText(target.line.text, spec.anchorMeasureStyleName)
      : target.line.naturalWidth;
    const anchorX = target.line.box.x + textWidth;
    return spec.anchorAlignment === 'end'
      ? anchorX - metrics.measureText(spec.text, spec.styleName) - offsetX
      : anchorX + offsetX;
  }
  return target.box.x + offsetX;
}

/** Resolves authored and backend-generated decorations against final geometry. */
export function placeGlyphObjects(document: CompositionDocument, metrics: CompositionTextMetrics, plan: CompositionPlan): void {
  plan.glyphPlacements ??= [];
  const lines = plannedLines(plan);
  const generated = Object.values(document.flows).flatMap((flow) => flow.blocks.flatMap((block) => (metrics.glyphs?.(compositionStyleName(block)) ?? []).map((glyph) => ({
    ...glyph,
    id: `${block.id}:${glyph.id}`,
    target: { kind: 'block' as const, id: block.id },
    source: 'generated' as const,
  }))));
  const definitions: Array<CompositionGlyphDefinition & { source: 'generated' | 'authored' }> = [
    ...generated,
    ...(document.glyphs ?? []).map((glyph) => ({ ...glyph, source: 'authored' as const })),
  ];
  for (const definition of definitions) {
    const targetPages = definition.target.kind === 'graphic'
      ? plan.graphicPlacements.filter((placement) => placement.graphicId === definition.target.id || placement.id === definition.target.id).map((placement) => placement.page)
      : [...new Set(lines.filter((line) => line.blockId === definition.target.id).map((line) => line.page))];
    for (const page of targetPages) {
      const target = glyphTargetBox(definition.target, page, plan, lines);
      if (!target) continue;
      const targetLines = lines.filter((line) => line.page === page && line.blockId === definition.target.id).sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
      const targetLine = definition.targetMode === 'first-line' ? targetLines[0] : definition.targetMode === 'last-line' ? targetLines.at(-1) : undefined;
      if (definition.targetMode !== 'box' && !targetLine) continue;
      const glyphWidth = metrics.measureText(definition.text, definition.styleName);
      const baseBox = targetLine?.box ?? target.box;
      let x = glyphAnchorX(metrics, definition, { box: baseBox, line: targetLine });
      if (definition.clampToTarget) x = Math.max(target.box.x, Math.min(x, target.box.x + target.box.width - glyphWidth));
      const baselineOffset = metrics.glyphBaselineOffset?.(definition.styleName) ?? 0;
      const lineInkBounds = metrics.glyphInkBounds?.(definition.text, definition.styleName) ?? metrics.lineInkBounds?.(definition.styleName) ?? {
        top: 0,
        bottom: metrics.lineHeight(definition.styleName),
      };
      const y = baseBox.y + (definition.offsetY ?? 0);
      const glyphBoxY = y + lineInkBounds.top;
      const glyphBoxHeight = Math.max(0, lineInkBounds.bottom - lineInkBounds.top);
      plan.glyphPlacements.push({
        id: `glyph-placement:${definition.id}:${page}`,
        glyphId: definition.id,
        targetType: definition.target.kind,
        targetId: definition.target.id,
        ...(target.flowId === undefined ? {} : { flowId: target.flowId }),
        page,
        ...(target.slotId === undefined ? {} : { slotId: target.slotId }),
        text: definition.text,
        styleName: definition.styleName,
        anchor: definition.anchor,
        ...(definition.anchorAlignment === undefined ? {} : { anchorAlignment: definition.anchorAlignment }),
        ...(definition.anchorMeasureStyleName === undefined ? {} : { anchorMeasureStyleName: definition.anchorMeasureStyleName }),
        source: definition.source,
        // The debug/rendering box follows the actual painted ascender and
        // descender around the baseline. It is intentionally not the full
        // line-height box used by the planner for text flow.
        box: { x, y: glyphBoxY, width: glyphWidth, height: glyphBoxHeight },
        baselineY: y + baselineOffset,
        ...(definition.opacity === undefined ? {} : { opacity: definition.opacity }),
      });
      plan.decisions.push({ code: 'GLYPH_OBJECT_PLACED', glyphId: definition.id, targetId: definition.target.id, page, targetType: definition.target.kind, box: { x, y: glyphBoxY, width: glyphWidth, height: glyphBoxHeight } });
    }
  }
}
