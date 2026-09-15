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

function insertionPlan(metrics) {
  return {
    ...basePlan(),
    spacing: {
      pages: [],
      slots: [],
      textPlacements: [],
      observations: [{
        kind: 'insertion-rhythm',
        page: 1,
        regionId: 'main',
        slotId: 'quote',
        metrics,
        profile: 'normal',
      }],
    },
  };
}

function imagePlan(leftHeight, rightHeight) {
  return {
    ...basePlan(),
    spacing: {
      pages: [],
      slots: [
        { page: 1, slotId: 'main-left', regionId: 'main', flowId: 'main', box: { x: 0, y: 0, width: 50, height: 100 }, occupiedHeight: leftHeight, remainingHeight: 100 - leftHeight, gapBefore: 0, gapAfter: 100 - leftHeight },
        { page: 1, slotId: 'main-right', regionId: 'main', flowId: 'main', box: { x: 50, y: 0, width: 50, height: 100 }, occupiedHeight: rightHeight, remainingHeight: 100 - rightHeight, gapBefore: 0, gapAfter: 100 - rightHeight },
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
  return {
    ...basePlan(),
    slots: [{ id: 'intro', page: 1, regionId: 'intro', flowId: 'intro', box: { x: 0, y: 0, width: 100, height: growthMaxHeight }, growthMaxHeight, state: 'partial' }],
    spacing: {
      pages: [],
      slots: [{ page: 1, slotId: 'intro', regionId: 'intro', flowId: 'intro', box: { x: 0, y: 0, width: 100, height: growthMaxHeight }, occupiedHeight, remainingHeight: growthMaxHeight - occupiedHeight, gapBefore: 0, gapAfter: growthMaxHeight - occupiedHeight }],
      textPlacements: [],
      observations: [],
    },
  };
}

function conflictingInsertionPlan(metrics) {
  return {
    ...basePlan(),
    spacing: {
      pages: [],
      slots: [],
      textPlacements: [],
      observations: [
        { kind: 'insertion-rhythm', page: 1, regionId: 'body', slotId: 'quote-a', metrics, profile: 'normal' },
        { kind: 'insertion-rhythm', page: 1, regionId: 'body', slotId: 'quote-b', metrics, profile: 'normal' },
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
