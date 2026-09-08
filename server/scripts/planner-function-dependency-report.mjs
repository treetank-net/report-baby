#!/usr/bin/env node

/**
 * Build the planner function ownership/dependency inventory.
 *
 * This is deliberately a source-level report. It does not move code or alter
 * runtime imports; the @planner-target comments are an executable catalogue
 * for the later module extraction step.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const serverRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const repoRoot = path.resolve(serverRoot, '..');
const sourceRoot = path.join(serverRoot, 'src');

const scannedRelativeFiles = [
  'composition/text-planner.ts',
  'composition/flow-planner.ts',
  'composition/flow-occupancy.ts',
  'composition/flow-text-decision.ts',
  'composition/flow-planning-types.ts',
  'composition/flow-cursor.ts',
  'composition/slot-growth.ts',
  'composition/planner-policy.ts',
  'composition/route-slots.ts',
  'composition/text-measurement.ts',
  'composition/page-management.ts',
  'composition/text-placement.ts',
  'composition/structured-block-placement.ts',
  'composition/insertion-planning.ts',
  'composition/graphic-planning.ts',
  'composition/evaluator.ts',
  'composition/evaluation-support.ts',
  'composition/evaluation-scoring.ts',
  'composition/evaluation-content.ts',
  'composition/evaluation-legality.ts',
  'composition/document-layout.ts',
  'composition/text-planner-candidates.ts',
  'composition/engine.ts',
  'composition/planning-records.ts',
];

const scannedFiles = scannedRelativeFiles.map((relative) => path.join(sourceRoot, relative));

const targetByFunction = new Map([
  // text-planner.ts: page and document ownership
  ['text-planner.ts::diagnostic', 'composition/planning-records.ts'],
  ['text-planner.ts::addResidual', 'composition/planning-records.ts'],
  ['text-planner.ts::addTableResidual', 'composition/planning-records.ts'],
  // text-measurement.ts is now a scanned source module, not a projected seam.
  ['text-measurement.ts::styleFor', 'composition/text-measurement.ts'],
  ['text-measurement.ts::lineHeight', 'composition/text-measurement.ts'],
  ['text-measurement.ts::textPadding', 'composition/text-measurement.ts'],
  ['text-measurement.ts::wrapBlock', 'composition/text-measurement.ts'],
  ['text-measurement.ts::wordsForBlock', 'composition/text-measurement.ts'],
  // page-management.ts owns page materialization and geometry.
  ['page-management.ts::layoutById', 'composition/page-management.ts'],
  ['page-management.ts::routeLayout', 'composition/page-management.ts'],
  ['page-management.ts::routeSlots', 'composition/page-management.ts'],
  ['page-management.ts::slotId', 'composition/page-management.ts'],
  ['page-management.ts::newPage', 'composition/page-management.ts'],
  ['page-management.ts::ensurePage', 'composition/page-management.ts'],
  ['page-management.ts::rectBottom', 'composition/page-management.ts'],
  ['page-management.ts::rectsOverlap', 'composition/page-management.ts'],
  ['page-management.ts::validateGrowthPolicies', 'composition/page-management.ts'],
  // text-placement.ts owns both flow and insertion line materialization.
  ['text-placement.ts::linePlacementGeometry', 'composition/text-placement.ts'],
  ['text-placement.ts::alignedLineX', 'composition/text-placement.ts'],
  ['text-placement.ts::appendPlacedLines', 'composition/text-placement.ts'],
  ['text-placement.ts::markLinePlacementOccupancy', 'composition/text-placement.ts'],
  ['text-placement.ts::placeLines', 'composition/text-placement.ts'],
  // text-planner.ts: insertion and graphics seams
  ['text-planner.ts::fitInsertionProposal', 'composition/insertion-planning.ts'],
  ['text-planner.ts::insertionProposalsFromPlan', 'composition/insertion-planning.ts'],
  ['text-planner.ts::seedInsertionProposals', 'composition/insertion-planning.ts'],
  ['text-planner.ts::reserveInsertionObstacles', 'composition/insertion-planning.ts'],
  ['text-planner.ts::placeInsertionLayer', 'composition/insertion-planning.ts'],
  ['text-planner.ts::graphicBox', 'composition/graphic-planning.ts'],
  ['text-planner.ts::seedGraphicProposals', 'composition/graphic-planning.ts'],
  ['text-planner.ts::absoluteGraphicPoints', 'composition/graphic-planning.ts'],
  ['text-planner.ts::placeGraphicsForPage', 'composition/graphic-planning.ts'],
  ['text-planner.ts::materializeGraphicPages', 'composition/graphic-planning.ts'],
  // text-planner.ts: document orchestration
  ['text-planner.ts::createPlan', 'composition/document-layout.ts'],
  ['text-planner.ts::normalizePlanReadingOrder', 'composition/document-layout.ts'],
  ['text-planner.ts::validateMovableInsertionBounds', 'composition/document-layout.ts'],
  ['text-planner.ts::validateMovableGraphicBounds', 'composition/document-layout.ts'],
  ['text-planner.ts::flattenPages', 'composition/document-layout.ts'],
  ['text-planner.ts::planDocumentOnce', 'composition/document-layout.ts'],
  ['text-planner.ts::createTextCompositionPlanner', 'composition/text-planner.ts'],
  ['text-planner.ts::planCandidates', 'composition/text-planner.ts'],
  ['text-planner.ts::planRefinedCandidates', 'composition/text-planner.ts'],

  // insertion-planning.ts owns proposal generation, obstacle reservation, and
  // materialization of non-main flow text.
  ['insertion-planning.ts::fitInsertionProposal', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::measureInsertionText', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::insertionSlotCandidates', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::insertionProposalsFromPlan', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::seedInsertionProposals', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::reserveInsertionObstacle', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::collapseUnassignedInsertionSlots', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::reserveInsertionObstacles', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::resolveInsertionBlockTarget', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::measureInsertionBlock', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::fitInsertionSlotContent', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::synchronizeInsertionObstacle', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::placeInsertionBlock', 'composition/insertion-planning.ts'],
  ['insertion-planning.ts::placeInsertionLayer', 'composition/insertion-planning.ts'],

  // graphic-planning.ts owns graphic geometry, validation, proposals, and
  // materialization of graphic obstacles/placements.
  ['graphic-planning.ts::graphicBox', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::graphicDefinitionForPage', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::graphicShapeValidationError', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::graphicBoxFitsSlot', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::createGraphicPlacement', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::placeGraphicForPage', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::placeGraphicsForPage', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::seedGraphicProposals', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::absoluteGraphicPoints', 'composition/graphic-planning.ts'],
  ['graphic-planning.ts::materializeGraphicPages', 'composition/graphic-planning.ts'],

  // document-layout.ts owns plan lifecycle and document-flow orchestration.
  ['document-layout.ts::validateMovableBounds', 'composition/document-layout.ts'],
  ['document-layout.ts::validateMovableInsertionBounds', 'composition/document-layout.ts'],
  ['document-layout.ts::validateMovableGraphicBounds', 'composition/document-layout.ts'],
  ['document-layout.ts::createPlan', 'composition/document-layout.ts'],
  ['document-layout.ts::normalizePlanReadingOrder', 'composition/document-layout.ts'],
  ['document-layout.ts::flattenPages', 'composition/document-layout.ts'],
  ['document-layout.ts::planHasErrors', 'composition/document-layout.ts'],
  ['document-layout.ts::movableInsertionFramesForPlan', 'composition/document-layout.ts'],
  ['document-layout.ts::movableGraphicFramesForPlan', 'composition/document-layout.ts'],
  ['document-layout.ts::validateQuoteFlowContracts', 'composition/document-layout.ts'],
  ['document-layout.ts::preparePlanForLayout', 'composition/document-layout.ts'],
  ['document-layout.ts::reserveDocumentObstacles', 'composition/document-layout.ts'],
  ['document-layout.ts::placeDocumentInsertions', 'composition/document-layout.ts'],
  ['document-layout.ts::planRepeatedFlow', 'composition/document-layout.ts'],
  ['document-layout.ts::planOrdinaryFlow', 'composition/document-layout.ts'],
  ['document-layout.ts::planDocumentFlow', 'composition/document-layout.ts'],
  ['document-layout.ts::planDocumentFlows', 'composition/document-layout.ts'],
  ['document-layout.ts::finalizeDocumentPlan', 'composition/document-layout.ts'],
  ['document-layout.ts::planDocumentOnce', 'composition/document-layout.ts'],

  // flow-planner.ts: occupancy and page growth
  ['flow-planner.ts::flowLineCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::blockPlacementCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::tablePlacementCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::reservedSlotCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::slotCollidesWithPlacedBlock', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::flowingTextBottom', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::wrappedImageIds', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::flowingLineBottom', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::flowingBlockBottom', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::flowingTableBottom', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::horizontalOverlap', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::occupiedBottomInOverlappingSlots', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::occupiedSlotMap', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::overlappingItemBottom', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::previousBlockInOverlappingSlots', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::previousBlockInSlot', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::overlappingPlacementCandidates', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::blockFromLastPlacement', 'composition/flow-occupancy.ts'],
  ['flow-planner.ts::contentStartBottom', 'composition/flow-occupancy.ts'],
  // flow-occupancy.ts is now a scanned source module after the first seam extraction.
  ['flow-occupancy.ts::flowLineCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::blockPlacementCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::tablePlacementCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::reservedSlotCollidesWithSlot', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::slotCollidesWithPlacedBlock', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::flowingTextBottom', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::wrappedImageIds', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::flowingLineBottom', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::flowingBlockBottom', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::flowingTableBottom', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::horizontalOverlap', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::occupiedBottomInOverlappingSlots', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::occupiedSlotMap', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::overlappingItemBottom', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::previousBlockInSlot', 'composition/flow-occupancy.ts'],
  ['flow-occupancy.ts::contentStartBottom', 'composition/flow-occupancy.ts'],
  ['slot-growth.ts::growSlot', 'composition/slot-growth.ts'],
  // flow-planner.ts: text decisions and placement state
  ['flow-planner.ts::prepareTextPlacement', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::headingExceedsAvailableLines', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::evaluateListItemKeepTogether', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::evaluateHeadingClusterObstacle', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::keepClusterExceedsAvailableLines', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::keepClusterCanBeRelaxed', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::selectTextLinesForPlacement', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::completeEmptyTextBlock', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::advanceTextBlockWhenNoLinesFit', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::growTextSlotForInitialPlacement', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::pushHeadingWhenWholeHeadingDoesNotFit', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::recordListItemSplitDecision', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::pushListItemWhenMinimumFragmentWouldBeBroken', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::handleHeadingClusterObstacleBeforeTextPlacement', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::pushKeepClusterWhenItCannotFit', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::recordRelaxedKeepCluster', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::advanceTextBlockWhenNoCapacity', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::resolveTextLineSelectionFailure', 'composition/flow-text-decision.ts'],
  ['flow-planner.ts::commitSelectedTextLines', 'composition/flow-planner.ts'],
  ['flow-planner.ts::advanceFlowAfterTextPlacement', 'composition/flow-planner.ts'],
  // flow-planner.ts: routing/orchestration stays together for this extraction
  ['flow-planner.ts::advanceCursor', 'composition/flow-planner.ts'],
  ['flow-planner.ts::createFlowPlanningContext', 'composition/flow-planner.ts'],
  ['flow-planner.ts::createFlowRuntime', 'composition/flow-planner.ts'],
  ['flow-planner.ts::recordFlowResidual', 'composition/flow-planner.ts'],
  ['flow-planner.ts::flowReachedTerminalPage', 'composition/flow-planner.ts'],
  ['flow-planner.ts::ensureCurrentFlowPage', 'composition/page-management.ts'],
  ['flow-planner.ts::resolveUnavailableFlowSlot', 'composition/flow-planner.ts'],
  ['flow-planner.ts::resolveFlowTarget', 'composition/flow-planner.ts'],
  ['flow-planner.ts::handleNonTextFlowPlacement', 'composition/flow-planner.ts'],
  ['flow-planner.ts::planTextBlockAttempt', 'composition/flow-planner.ts'],
  ['flow-planner.ts::planFlow', 'composition/flow-planner.ts'],

  // flow-text-decision.ts owns wrapping, keep rules, and text-capacity decisions.
  ['flow-text-decision.ts::headingExceedsAvailableLines', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::evaluateListItemKeepTogether', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::headingClusterProbes', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::evaluateHeadingClusterObstacle', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::keepClusterExceedsAvailableLines', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::keepClusterCanBeRelaxed', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::textPlacementStartLineOffset', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::textPlacementObstacles', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::textPlacementBlockGap', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::wrapTextPlacement', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::compressHeadingGapIfNeeded', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::prepareTextPlacement', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::selectTextLinesForPlacement', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::advanceTextBlockWhenNoLinesFit', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::growTextSlotForInitialPlacement', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::pushHeadingWhenWholeHeadingDoesNotFit', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::recordListItemSplitDecision', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::pushListItemWhenMinimumFragmentWouldBeBroken', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::handleHeadingClusterObstacleBeforeTextPlacement', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::pushKeepClusterWhenItCannotFit', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::recordRelaxedKeepCluster', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::advanceTextBlockWhenNoCapacity', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::textPlacementCapacity', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::nextBlockKeepProbe', 'composition/flow-text-decision.ts'],
  ['flow-text-decision.ts::applyTextPlacementDecisionRules', 'composition/flow-text-decision.ts'],

  // Shared flow state and cursor operations are neutral support modules.
  ['flow-planning-types.ts::FlowPlanningContext', 'composition/flow-planning-types.ts'],
  ['flow-planning-types.ts::FlowRuntime', 'composition/flow-planning-types.ts'],
  ['flow-planning-types.ts::SelectedFlowSlot', 'composition/flow-planning-types.ts'],
  ['flow-planning-types.ts::FlowTarget', 'composition/flow-planning-types.ts'],
  ['flow-planning-types.ts::PreparedTextPlacement', 'composition/flow-planning-types.ts'],
  ['flow-cursor.ts::advanceCursor', 'composition/flow-cursor.ts'],
  ['planner-policy.ts::TextCompositionPlannerPolicy', 'composition/planner-policy.ts'],

  // structured-block-placement.ts has one public dispatcher and two private seams.
  ['structured-block-placement.ts::rectBottom', 'composition/page-management.ts'],
  ['structured-block-placement.ts::diagnostic', 'composition/planning-records.ts'],
  ['structured-block-placement.ts::placeAtomicBlock', 'composition/structured-block-placement.ts'],
  ['structured-block-placement.ts::placeTableFragment', 'composition/structured-block-placement.ts'],
  ['structured-block-placement.ts::placeStructuredBlock', 'composition/structured-block-placement.ts'],

  // candidate generation and engine remain cohesive modules for now.
  ['text-planner-candidates.ts::insertionKey', 'composition/insertion-order.ts'],
  ['engine.ts::compareCompositionEvaluations', 'composition/engine.ts'],
  ['engine.ts::renderComposition', 'composition/engine.ts'],
  ['engine.ts::createCompositionEngine', 'composition/engine.ts'],
]);

const responsibilityByFunction = new Map([
  ['planDocumentOnce', 'Coordinate one complete document-layout run from preflight through finalization.'],
  ['prepareTextPlacement', 'Build the read-only inputs for one text-placement attempt.'],
  ['selectTextLinesForPlacement', 'Choose the lines that fit the current slot and keep rules.'],
  ['commitSelectedTextLines', 'Materialize selected lines and update the flow cursor.'],
  ['advanceFlowAfterTextPlacement', 'Decide whether the flow continues on this page or moves forward.'],
  ['handleNonTextFlowPlacement', 'Dispatch non-text block placement after collision and asset checks.'],
  ['resolveFlowTarget', 'Resolve the legal slot and page target for the next flow block.'],
  ['placeInsertionLayer', 'Validate, measure, and materialize planned insertion blocks on a page.'],
  ['reserveInsertionObstacles', 'Reserve insertion rectangles that must obstruct flowing content.'],
  ['placeGraphicsForPage', 'Materialize graphic proposals for one page and register their obstacles.'],
  ['growSlot', 'Apply one legal slot-growth operation and move affected slots.'],
  ['placeStructuredBlock', 'Dispatch one structured block to its atomic or table placement routine.'],
  ['createTextCompositionPlanner', 'Expose candidate planning while retaining the existing planner contract.'],
  ['createCompositionEngine', 'Evaluate candidates, refine legal alternatives, and select the winning plan.'],
]);

function parseArgs(argv) {
  const annotate = argv.includes('--annotate');
  const reportIndex = argv.indexOf('--write-report');
  const reportPath = reportIndex >= 0 && argv[reportIndex + 1]
    ? path.resolve(process.cwd(), argv[reportIndex + 1])
    : path.join(repoRoot, 'docs/release-1.0/planner-function-dependency-inventory.md');
  return { annotate, reportPath };
}

function sourceRelative(file) {
  return path.relative(sourceRoot, file).split(path.sep).join('/');
}

function sourceBase(file) {
  return path.basename(file);
}

function targetFor(file, name) {
  return targetByFunction.get(`${sourceBase(file)}::${name}`) ?? `composition/${sourceBase(file)}`;
}

function responsibilityFor(name) {
  return responsibilityByFunction.get(name)
    ?? `Keep the current ${name} implementation intact until its target seam is extracted.`;
}

function functionName(node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name && (ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name))) return node.name.text;
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node);
}

function collectFunctions(sourceFile) {
  const functions = [];
  function visit(node) {
    let name = functionName(node);
    if (!name && isFunctionLike(node) && node.parent && ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
      name = node.parent.name.text;
    }
    if (name && isFunctionLike(node)) functions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return functions;
}

function leadingPlannerComment(sourceFile, node) {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [];
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const text = sourceFile.text.slice(ranges[index].pos, ranges[index].end);
    if (text.includes('@planner-target')) return text;
  }
  return undefined;
}

function commentMetadata(comment, fallbackTarget, fallbackResponsibility) {
  const target = comment?.match(/@planner-target\s+([^\s*]+)/u)?.[1] ?? fallbackTarget;
  const responsibility = comment?.match(/@planner-responsibility\s+([^\n*]+)/u)?.[1]?.trim() ?? fallbackResponsibility;
  return { target, responsibility };
}

function lineStart(sourceFile, position) {
  return sourceFile.getPositionOfLineAndCharacter(sourceFile.getLineAndCharacterOfPosition(position).line, 0);
}

function indentAt(sourceFile, position) {
  const start = lineStart(sourceFile, position);
  return sourceFile.text.slice(start, position).match(/^\s*/u)?.[0] ?? '';
}

function annotationFor(sourceFile, node) {
  const name = functionName(node);
  if (!name) return undefined;
  const target = targetFor(sourceFile.fileName, name);
  const responsibility = responsibilityFor(name);
  const indent = indentAt(sourceFile, node.getStart());
  return {
    position: lineStart(sourceFile, node.getStart()),
    text: `${indent}/**\n${indent} * @planner-target ${target}\n${indent} * @planner-responsibility ${responsibility}\n${indent} */\n`,
  };
}

function annotateSources() {
  for (const file of scannedFiles) {
    const sourceFile = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const insertions = collectFunctions(sourceFile)
      .filter((node) => !leadingPlannerComment(sourceFile, node))
      .map((node) => annotationFor(sourceFile, node))
      .filter(Boolean)
      .sort((left, right) => right.position - left.position);
    if (insertions.length === 0) continue;
    let text = sourceFile.text;
    for (const insertion of insertions) text = `${text.slice(0, insertion.position)}${insertion.text}${text.slice(insertion.position)}`;
    fs.writeFileSync(file, text);
  }
}

function resolveModule(file, moduleSpecifier) {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  let candidate = path.resolve(path.dirname(file), moduleSpecifier);
  if (candidate.endsWith('.js')) candidate = candidate.slice(0, -3) + '.ts';
  if (!path.extname(candidate)) candidate += '.ts';
  if (fs.existsSync(candidate)) return path.resolve(candidate);
  const index = path.join(candidate, 'index.ts');
  return fs.existsSync(index) ? path.resolve(index) : undefined;
}

function importBindings(sourceFile) {
  const bindings = new Map();
  sourceFile.forEachChild((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return;
    const module = node.moduleSpecifier.text;
    const resolved = resolveModule(sourceFile.fileName, module);
    const clause = node.importClause;
    if (!clause) return;
    if (clause.name) bindings.set(clause.name.text, { module, resolved, importedName: 'default' });
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, { module, resolved, importedName: '*' });
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const local = element.name.text;
        const importedName = element.propertyName?.text ?? element.name.text;
        bindings.set(local, { module, resolved, importedName });
      }
    }
  });
  return bindings;
}

const ignoredMemberCalls = new Set([
  'at', 'concat', 'entries', 'every', 'filter', 'flat', 'flatMap', 'forEach',
  'get', 'has', 'includes', 'join', 'map', 'push', 'reduce', 'slice', 'some',
  'sort', 'values', 'startsWith', 'trim', 'split', 'find', 'findIndex',
]);

function rootIdentifier(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) current = current.expression;
  return ts.isIdentifier(current) ? current.text : undefined;
}

function nodeName(node, imports, localFunctions) {
  if (ts.isIdentifier(node)) return node.text;
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const root = rootIdentifier(node);
  if (!root || ignoredMemberCalls.has(node.name.text)) return undefined;
  if (imports.has(root) || localFunctions.has(root)) return `${root}.${node.name.text}`;
  if (['Math', 'Number', 'Object', 'String', 'Array', 'JSON', 'Date', 'Set', 'Map', 'Promise'].includes(root)) return undefined;
  return `${root}.${node.name.text}`;
}

function dependenciesFor(node, sourceFile, localFunctions, allFunctions, imports) {
  const names = new Set();
  if (!node.body) return [];
  function visit(child) {
    if (ts.isCallExpression(child)) {
      const called = nodeName(child.expression, imports, localFunctions);
      if (called) names.add(called);
    }
    if (ts.isIdentifier(child) && imports.has(child.text)) names.add(child.text);
    ts.forEachChild(child, visit);
  }
  visit(node.body);
  names.delete(functionName(node));
  const dependencies = [];
  for (const name of names) {
    if (localFunctions.has(name)) {
      const target = allFunctions.get(localFunctions.get(name))?.target;
      dependencies.push({ name, kind: 'local', target: target ?? sourceRelative(sourceFile.fileName) });
      continue;
    }
    const binding = imports.get(name.split('.')[0]);
    if (binding) {
      dependencies.push({
        name,
        kind: 'import',
        module: binding.module,
        resolved: binding.resolved ? sourceRelative(binding.resolved) : undefined,
        importedName: binding.importedName,
      });
      continue;
    }
    dependencies.push({ name, kind: 'external' });
  }
  return dependencies.sort((left, right) => left.name.localeCompare(right.name));
}

function signatureFor(checker, node) {
  const signature = checker.getSignatureFromDeclaration(node);
  if (!signature) return { parameters: [], returnType: 'unknown' };
  const parameters = signature.parameters.map((parameter) => ({
    name: parameter.name,
    type: checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, node)),
  }));
  return { parameters, returnType: checker.typeToString(signature.getReturnType()) };
}

function normalizedBody(node) {
  if (!node.body) return '';
  return node.body.getText()
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function buildInventory() {
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    allowJs: false,
  };
  const program = ts.createProgram(scannedFiles, options);
  const checker = program.getTypeChecker();
  const records = [];
  const byFileAndName = new Map();
  for (const file of scannedFiles) {
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) continue;
    for (const node of collectFunctions(sourceFile)) {
      const name = functionName(node);
      if (!name) continue;
      const lineStartValue = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const lineEndValue = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
      const plannerComment = leadingPlannerComment(sourceFile, node);
      const metadata = commentMetadata(plannerComment, targetFor(file, name), responsibilityFor(name));
      const record = {
        file: sourceRelative(file),
        fileBase: sourceBase(file),
        name,
        lineStart: lineStartValue,
        lineEnd: lineEndValue,
        target: metadata.target,
        responsibility: metadata.responsibility,
        hasPlannerComment: Boolean(plannerComment),
        signature: signatureFor(checker, node),
        bodyFingerprint: normalizedBody(node),
        node,
        sourceFile,
        imports: importBindings(sourceFile),
      };
      records.push(record);
      byFileAndName.set(`${file}::${name}`, record);
    }
  }
  const recordsByFile = new Map();
  for (const record of records) {
    if (!recordsByFile.has(record.sourceFile.fileName)) recordsByFile.set(record.sourceFile.fileName, []);
    recordsByFile.get(record.sourceFile.fileName).push(record);
  }
  for (const record of records) {
    const localFunctions = new Map((recordsByFile.get(record.sourceFile.fileName) ?? []).map((item) => [item.name, `${record.sourceFile.fileName}::${item.name}`]));
    record.dependencies = dependenciesFor(record.node, record.sourceFile, localFunctions, byFileAndName, record.imports);
    record.finalDependencies = new Set();
    for (const dependency of record.dependencies) {
      if (dependency.kind === 'local') {
        if (dependency.target && dependency.target !== record.target) record.finalDependencies.add(dependency.target);
      } else if (dependency.kind === 'import') {
        const imported = dependency.resolved ? byFileAndName.get(`${path.join(sourceRoot, dependency.resolved)}::${dependency.importedName}`) : undefined;
        const target = imported?.target ?? (dependency.resolved ? `composition/${dependency.resolved.replace(/^composition\//u, '')}` : `external:${dependency.module}`);
        if (target !== record.target) record.finalDependencies.add(target);
      }
    }
  }
  return records;
}

function inline(text) {
  return text.replace(/\s+/gu, ' ').replace(/\|/gu, '\\|').trim();
}

function parameterSummary(parameters) {
  if (parameters.length === 0) return '—';
  return parameters.map((parameter) => `\`${parameter.name}: ${inline(parameter.type)}\``).join(', ');
}

function dependencySummary(record) {
  if (!record.dependencies?.length) return '—';
  return record.dependencies.map((dependency) => {
    if (dependency.kind === 'local') return `\`${dependency.name}\` (local → ${dependency.target})`;
    if (dependency.kind === 'import') return `\`${dependency.name}\` (${dependency.module})`;
    return `\`${dependency.name}\` (external/state)`;
  }).join('<br>');
}

function aggregateTargets(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.target)) groups.set(record.target, { functions: [], dependencies: new Set() });
    const group = groups.get(record.target);
    group.functions.push(`${record.name} (${record.file}:${record.lineStart})`);
    for (const dependency of record.finalDependencies) group.dependencies.add(dependency);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function unionLineCount(records) {
  const intervalsByFile = new Map();
  for (const record of records) {
    if (!intervalsByFile.has(record.sourceFile.fileName)) intervalsByFile.set(record.sourceFile.fileName, []);
    intervalsByFile.get(record.sourceFile.fileName).push([record.lineStart, record.lineEnd]);
  }
  let total = 0;
  for (const intervals of intervalsByFile.values()) {
    intervals.sort(([left], [right]) => left - right);
    let currentStart;
    let currentEnd;
    for (const [start, end] of intervals) {
      if (currentStart === undefined) {
        currentStart = start;
        currentEnd = end;
      } else if (start <= currentEnd + 1) {
        currentEnd = Math.max(currentEnd, end);
      } else {
        total += currentEnd - currentStart + 1;
        currentStart = start;
        currentEnd = end;
      }
    }
    if (currentStart !== undefined) total += currentEnd - currentStart + 1;
  }
  return total;
}

function targetProjections(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.target)) groups.set(record.target, []);
    groups.get(record.target).push(record);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([target, group]) => {
    const assignedLines = group.reduce((total, record) => total + record.lineEnd - record.lineStart + 1, 0);
    const nonOverlappingLines = unionLineCount(group);
    const existingPath = path.join(sourceRoot, target);
    const existingFileLines = fs.existsSync(existingPath)
      ? fs.readFileSync(existingPath, 'utf8').split('\n').length - 1
      : undefined;
    return { target, functionCount: group.length, assignedLines, nonOverlappingLines, existingFileLines, overlapLines: assignedLines - nonOverlappingLines };
  });
}

function duplicateGroups(records) {
  const groups = new Map();
  for (const record of records) {
    if (record.bodyFingerprint.length < 20) continue;
    if (!groups.has(record.bodyFingerprint)) groups.set(record.bodyFingerprint, []);
    groups.get(record.bodyFingerprint).push(record);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .sort((left, right) => right[0].bodyFingerprint.length - left[0].bodyFingerprint.length);
}

function renderReport(records) {
  const targets = aggregateTargets(records);
  const projections = targetProjections(records);
  const sourceFiles = [...new Set(records.map((record) => record.file))].sort();
  const unresolved = records.flatMap((record) => record.dependencies
    .filter((dependency) => dependency.kind === 'external')
    .map((dependency) => `${record.file}:${record.lineStart} ${record.name} → ${dependency.name}`));
  const defaults = records.filter((record) => record.target === `composition/${record.fileBase}`);
  const missingComments = records.filter((record) => !record.hasPlannerComment);
  const lines = [
    '# Planner function and dependency inventory',
    '',
    'Generated by `server/scripts/planner-function-dependency-report.mjs`.',
    '',
    'This is an extraction catalogue, not a runtime refactor. `@planner-target` names the intended destination seam; current imports and behavior remain unchanged.',
    '',
    '## Scope',
    '',
    `Scanned ${records.length} named functions in ${sourceFiles.length} source files: ${sourceFiles.map((file) => `\`${file}\``).join(', ')}.`,
    '',
    'The signatures come from the TypeScript checker. Direct dependencies include called local functions, imported bindings, and unresolved external/state expressions. “Final dependencies” translates those calls to intended target files so import fan-out is visible before moving code.',
    '',
    '## Target-module summary',
    '',
    '| Intended target file | Functions | Final dependencies |',
    '| --- | --- | --- |',
    ...targets.map(([target, group]) => `| \`${target}\` | ${group.functions.length} | ${group.dependencies.size ? [...group.dependencies].sort().map((dependency) => `\`${dependency}\``).join('<br>') : '—'} |`),
    '',
    '## Projected target-file size',
    '',
    'This is a function-only lower-bound projection. “Assigned LOC” sums each function range; “non-overlapping LOC” unions ranges within a target and therefore avoids counting nested functions twice. Imports, interfaces, shared types, module comments, and blank lines are not projected.',
    '',
    '| Intended target file | Functions | Assigned LOC | Non-overlapping LOC | Existing file LOC |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...projections.map((projection) => `| \`${projection.target}\` | ${projection.functionCount} | ${projection.assignedLines} | ${projection.nonOverlappingLines} | ${projection.existingFileLines ?? 'new'} |`),
    '',
    'A non-zero overlap is expected when a function contains nested named functions. It is a measurement warning, not extra code that must be copied twice.',
    '',
    '## Function inventory',
    '',
    '| Current function | Current lines | Size | Intended target | Inputs | Output | Direct dependencies |',
    '| --- | ---: | ---: | --- | --- | --- | --- |',
    ...records.sort((left, right) => left.file.localeCompare(right.file) || left.lineStart - right.lineStart).map((record) => {
      const linesValue = `${record.lineStart}–${record.lineEnd}`;
      const size = record.lineEnd - record.lineStart + 1;
      return `| \`${record.name}\`<br>${record.file} | ${linesValue} | ${size} | \`${record.target}\`<br>${inline(record.responsibility)} | ${parameterSummary(record.signature.parameters)} | \`${inline(record.signature.returnType)}\` | ${dependencySummary(record)} |`;
    }),
    '',
    '## Relocation review queue',
    '',
    'Functions above 80 source lines are reviewed first when assigning ownership. They may move to their target module intact; size is only a navigation signal, not a reason to split a function.',
    '',
    '| Function | Size | Intended target | Direct dependency count |',
    '| --- | ---: | --- | ---: |',
    ...records.filter((record) => record.lineEnd - record.lineStart + 1 > 80)
      .sort((left, right) => (right.lineEnd - right.lineStart) - (left.lineEnd - left.lineStart))
      .map((record) => `| \`${record.name}\`<br>${record.file} | ${record.lineEnd - record.lineStart + 1} | \`${record.target}\` | ${record.dependencies.length} |`),
    '',
    '## Possible duplicate implementations',
    '',
    'These groups have exactly the same normalized function body. They are candidates for consolidation after ownership is established; matching text alone is not proof that the contexts are interchangeable.',
    '',
    '| Group | Functions and intended targets |',
    '| --- | --- |',
    ...(duplicateGroups(records).length
      ? duplicateGroups(records).map((group, index) => `| ${index + 1} (${group[0].bodyFingerprint.length} normalized body characters) | ${group.map((record) => `\`${record.name}\` (${record.file} → ${record.target})`).join('<br>')} |`)
      : ['| — | No exact normalized-body duplicates found. |']),
    '',
    '## Dependency notes',
    '',
    'The target table is the intended import shape after relocation. A target with many unrelated dependencies is a signal to review ownership and possible shared helpers; it is not an instruction to split functions automatically. Dependencies shown as `external/state` are calls or member expressions that the inventory cannot assign to another scanned function; they need a deliberate ownership decision during the move.',
    '',
    `- Functions still defaulted to their current file: ${defaults.length}. These are intentionally left in place until a target seam is agreed.`,
    `- Functions without an @planner-target comment: ${missingComments.length}. Run the inventory with --annotate to add missing comments.`,
    `- External/state dependency expressions: ${unresolved.length}.`,
    `- Functions above 80 lines in the relocation review queue: ${records.filter((record) => record.lineEnd - record.lineStart + 1 > 80).length}.`,
    `- Possible exact normalized-body duplicate groups: ${duplicateGroups(records).length}.`,
  ];
  if (unresolved.length) {
    lines.push('', 'Examples:', '', ...unresolved.slice(0, 30).map((item) => `- \`${item}\``));
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const { annotate, reportPath } = parseArgs(process.argv.slice(2));
  if (annotate) annotateSources();
  const records = buildInventory();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, renderReport(records));
  console.log(`Planner inventory: ${records.length} functions → ${reportPath}`);
}

main();
