/**
 * Small renderer-free fixtures used by the reviewed ranking corpus.  They
 * exercise the real evaluator/scoring functions with measured plan evidence;
 * no PDF or raster artifact is involved.
 */

function basePlan() {
  return {
    pages: [],
    slots: [],
    placements: [],
    blockPlacements: [],
    tablePlacements: [],
    graphicPlacements: [],
    lines: [],
    insertionLines: [],
    decisions: [],
    diagnostics: [],
    residualContent: [],
    spacing: { pages: [], slots: [], textPlacements: [], observations: [] },
  };
}

function insertionPlan(metrics, blockId = 'quote') {
  const graphicId = `insertion:${blockId}`;
  const box = { x: 40, y: 40, width: 20, height: 10 };
  return {
    ...basePlan(),
    slots: [{ id: blockId, page: 1, regionId: 'main', kind: 'graphic', box, state: 'open' }],
    graphicPlacements: [{
      id: `graphic:${blockId}`,
      graphicId,
      slotId: blockId,
      page: 1,
      shape: 'rectangle',
      wrap: 'around',
      box,
    }],
    spacing: {
      pages: [],
      slots: [],
      textPlacements: [],
      observations: [{
        kind: 'insertion-rhythm',
        page: 1,
        regionId: 'main',
        slotId: blockId,
        blockId,
        graphicId,
        metrics,
        profile: 'normal',
      }],
    },
  };
}

function imagePlan(leftHeight, rightHeight) {
  const leftSlot = { id: 'main-left', page: 1, regionId: 'main', flowId: 'main', routeIndex: 0, kind: 'text', box: { x: 0, y: 0, width: 50, height: 100 }, state: 'partial' };
  const rightSlot = { id: 'main-right', page: 1, regionId: 'main', flowId: 'main', routeIndex: 1, kind: 'text', box: { x: 50, y: 0, width: 50, height: 100 }, state: 'partial' };
  return {
    ...basePlan(),
    slots: [leftSlot, rightSlot],
    lines: [
      { blockId: 'left-content', flowId: 'main', slotId: leftSlot.id, page: 1, text: 'left', box: { x: 0, y: 0, width: 50, height: leftHeight }, routeIndex: 0, naturalWidth: 20, startWord: 0, endWord: 1 },
      { blockId: 'right-content', flowId: 'main', slotId: rightSlot.id, page: 1, text: 'right', box: { x: 50, y: 0, width: 50, height: rightHeight }, routeIndex: 1, naturalWidth: 25, startWord: 0, endWord: 1 },
    ],
    spacing: {
      pages: [],
      slots: [
        { page: 1, slotId: leftSlot.id, regionId: 'main', flowId: 'main', box: leftSlot.box, occupiedHeight: leftHeight, remainingHeight: 100 - leftHeight, gapBefore: 0, gapAfter: 100 - leftHeight },
        { page: 1, slotId: rightSlot.id, regionId: 'main', flowId: 'main', box: rightSlot.box, occupiedHeight: rightHeight, remainingHeight: 100 - rightHeight, gapBefore: 0, gapAfter: 100 - rightHeight },
      ],
      textPlacements: [],
      observations: [],
    },
  };
}

function illegalPlan() {
  return { ...basePlan(), diagnostics: [{ severity: 'error', code: 'FLOW_SLOT_NOT_FOUND', message: 'fixture candidate is illegal' }] };
}

function fitContentPlan(growthMaxHeight, occupiedHeight) {
  const slot = { id: 'intro', page: 1, regionId: 'intro', flowId: 'intro', routeIndex: 0, kind: 'text', box: { x: 0, y: 0, width: 100, height: growthMaxHeight }, growthMaxHeight, state: 'partial' };
  return {
    ...basePlan(),
    slots: [slot],
    lines: [{ blockId: 'intro-content', flowId: 'intro', slotId: slot.id, page: 1, text: 'intro', box: { x: 0, y: 0, width: 100, height: Math.min(occupiedHeight, growthMaxHeight) }, routeIndex: 0, naturalWidth: 20, startWord: 0, endWord: 1 }],
    spacing: {
      pages: [],
      slots: [{ page: 1, slotId: 'intro', regionId: 'intro', flowId: 'intro', box: { x: 0, y: 0, width: 100, height: growthMaxHeight }, occupiedHeight, remainingHeight: growthMaxHeight - occupiedHeight, gapBefore: 0, gapAfter: growthMaxHeight - occupiedHeight }],
      textPlacements: [],
      observations: [],
    },
  };
}

function conflictingInsertionPlan(metrics) {
  const insertion = (blockId) => ({
    id: `graphic:${blockId}`,
    graphicId: `insertion:${blockId}`,
    slotId: blockId,
    page: 1,
    shape: 'rectangle',
    wrap: 'around',
    box: { x: 40, y: blockId === 'quote-a' ? 30 : 60, width: 20, height: 10 },
  });
  const graphicPlacements = [insertion('quote-a'), insertion('quote-b')];
  return {
    ...basePlan(),
    slots: graphicPlacements.map((graphic) => ({ id: graphic.slotId, page: 1, regionId: 'body', kind: 'graphic', box: graphic.box, state: 'open' })),
    graphicPlacements,
    spacing: {
      pages: [],
      slots: [],
      textPlacements: [],
      observations: [
        { kind: 'insertion-rhythm', page: 1, regionId: 'body', slotId: 'quote-a', blockId: 'quote-a', graphicId: 'insertion:quote-a', metrics, profile: 'normal' },
        { kind: 'insertion-rhythm', page: 1, regionId: 'body', slotId: 'quote-b', blockId: 'quote-b', graphicId: 'insertion:quote-b', metrics, profile: 'normal' },
      ],
    },
  };
}

export function rankingFixtureBuilders() {
  return {
    'movable-quote': () => ({
      preferred: insertionPlan({ beforeTextGap: 3, afterTextGap: 9, textGapAsymmetry: 6, regionStartGap: 18, regionEndGap: 22 }),
      balanced: insertionPlan({ beforeTextGap: 6, afterTextGap: 6, textGapAsymmetry: 0, regionStartGap: 20, regionEndGap: 20 }),
      edge: insertionPlan({ beforeTextGap: 0, afterTextGap: 24, textGapAsymmetry: 24, regionStartGap: 0, regionEndGap: 60 }),
    }),
    'movable-image': () => ({
      balanced: imagePlan(80, 80),
      'left-heavy': imagePlan(100, 20),
    }),
    'illegal-attractive': () => ({
      legal: basePlan(),
      'attractive-illegal': illegalPlan(),
    }),
    'tied-insertions': () => ({
      first: basePlan(),
      second: basePlan(),
    }),
    'fit-content-envelope': () => ({
      compact: fitContentPlan(100, 95),
      wasteful: fitContentPlan(100, 20),
    }),
    'conflicting-insertions': () => ({
      balanced: conflictingInsertionPlan({ beforeTextGap: 6, afterTextGap: 6, textGapAsymmetry: 0, regionStartGap: 10, regionEndGap: 10, previousInsertionGap: 6, nextInsertionGap: 6 }),
      conflicting: conflictingInsertionPlan({ beforeTextGap: 1, afterTextGap: 15, textGapAsymmetry: 14, regionStartGap: 1, regionEndGap: 30, previousInsertionGap: 2, nextInsertionGap: 20 }),
    }),
  };
}
