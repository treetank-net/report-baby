#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parse } from 'yaml';
import { createDeterministicLorem, loremParagraph } from './lib/deterministic-lorem.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-coarse-template-calibration-'));
const adapterBundle = join(temporary, 'composition/report-composition-entrypoint.cjs');
const primitiveBundle = join(temporary, 'rendering/primitives.cjs');
const templateBundle = join(temporary, 'template/contracts.cjs');
const geometryBundle = join(temporary, 'template/geometry.cjs');

try {
  await build({
    entryPoints: [
      'src/composition/report-composition-entrypoint.ts',
      'src/rendering/primitives.ts',
      'src/template/contracts.ts',
      'src/template/geometry.ts',
    ],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outdir: temporary,
    outExtension: { '.js': '.cjs' },
    loader: { '.wasm': 'binary', '.ttf': 'binary' },
  });

  const [{ planReportComposition, compositionStylesFromRenderConfig }, { newPdf }, { compileTemplateSource }, { pageGeometryFromTemplate }] = await Promise.all([
    import(adapterBundle), import(primitiveBundle), import(templateBundle), import(geometryBundle),
  ]);
  const renderConfig = parse(await readFile(join(root, 'templates/render-config.yml'), 'utf8'));
  const terminalPageTolerance = renderConfig.composition_search.coarse_page_prediction_error_tolerance_pages;
  const geometryTolerance = renderConfig.pdf.composition_geometry_tolerance;
  assert.ok(Number.isFinite(terminalPageTolerance) && terminalPageTolerance >= 0, 'terminal page tolerance must come from render configuration');
  assert.ok(Number.isFinite(geometryTolerance) && geometryTolerance >= 0, 'geometry tolerance must come from render configuration');
  const styles = compositionStylesFromRenderConfig();
  const templateIds = [
    'default-report',
    'editorial-two-column',
    'editorial-three-column',
    'editorial-dynamic-chrome',
    'editorial-intro-cover',
  ];
  const measurements = [];

  for (const templateId of templateIds) {
    const source = parse(await readFile(join(root, `templates/pages/${templateId}/template.yml`), 'utf8'));
    const compiled = compileTemplateSource(source);
    const geometry = pageGeometryFromTemplate(compiled);
    for (const wordCount of [120, 720, 1500]) {
      const lorem = createDeterministicLorem();
      const input = { flows: { main: { blocks: [{ id: 'calibration-body', type: 'text', role: 'body', text: loremParagraph(lorem, wordCount) }] } } };
      const pdf = newPdf('portrait', [geometry.width, geometry.height]);
      const result = planReportComposition(pdf, compiled, geometry, input, {
        family: 'DejaVu',
        maxPages: renderConfig.pdf.composition_max_pages,
        includeTitlePage: false,
        styles,
        policy: { searchBudget: { maxRefinementRounds: 0, maxFullPlanRecalculations: 1 } },
      });
      const seed = result.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
      const comparison = seed?.baselineExactComparison;
      const caseLabel = `${templateId}/${wordCount}-words`;
      assert.equal(result.evaluation.status, 'accepted', `${caseLabel} exact evaluation must accept the fully measured main-flow plan`);
      assert.ok(comparison && Array.isArray(comparison.pages), `${caseLabel} must expose baseline coarse-to-exact calibration`);
      assert.ok(Number.isFinite(comparison.estimatedTerminalPage) && Number.isFinite(comparison.exactMainTerminalPage), `${caseLabel} must report both terminal pages`);
      assert.equal(comparison.pages.reduce((sum, page) => sum + page.exactTextWords, 0), comparison.exactTextWordCount, `${caseLabel} exact page masses must account for all measured main text`);

      const slotMeasurements = comparison.pages.flatMap(({ page, blocks = [] }) => blocks.flatMap((block) => {
        const estimatedSlots = new Map(block.estimatedBySlot.map((slot) => [slot.slotId, slot]));
        return block.exactBySlot.flatMap((exact) => {
          const estimated = estimatedSlots.get(exact.slotId.replace(/^\d+:/u, ''));
          if (!estimated) return [];
          return [{
            page,
            blockId: block.blockId,
            slotId: exact.slotId,
            topDelta: exact.topY - estimated.topY,
            bottomDelta: exact.bottomY - estimated.bottomY,
            occupiedHeightDelta: exact.occupiedHeight - estimated.occupiedHeight,
            leftDelta: exact.leftX - estimated.leftX,
            rightDelta: exact.rightX - estimated.rightX,
          }];
        });
      }));
      assert.ok(slotMeasurements.length > 0, `${caseLabel} must compare at least one estimated and exact slot box`);
      assert.ok(slotMeasurements.every((slot) => Object.values(slot).filter((value) => typeof value === 'number').every(Number.isFinite)), `${caseLabel} geometry drift must contain measured values only`);
      assert.ok(comparison.pages.every(({ estimatedMassUnits, exactTextWords }) => estimatedMassUnits === exactTextWords), `${caseLabel} must predict exact per-page text mass for a plain-text route: ${JSON.stringify(comparison.pages.filter(({ estimatedMassUnits, exactTextWords }) => estimatedMassUnits !== exactTextWords).map(({ page, estimatedMassUnits, exactTextWords }) => ({ page, estimatedMassUnits, exactTextWords })))}`);
      const maxAbsSlotDrift = Math.max(...slotMeasurements.flatMap(({ topDelta, bottomDelta, occupiedHeightDelta, leftDelta, rightDelta }) => [Math.abs(topDelta), Math.abs(bottomDelta), Math.abs(occupiedHeightDelta), Math.abs(leftDelta), Math.abs(rightDelta)]));
      assert.ok(maxAbsSlotDrift <= geometryTolerance, `${caseLabel} estimated and exact slot boundaries must remain within configured geometry tolerance: ${maxAbsSlotDrift} > ${geometryTolerance}`);
      assert.ok(Math.abs(comparison.estimatedTerminalPage - comparison.exactMainTerminalPage) <= terminalPageTolerance,
        `${caseLabel} terminal page drift exceeds configured tolerance: ${JSON.stringify({ estimated: comparison.estimatedTerminalPage, exact: comparison.exactMainTerminalPage, tolerance: terminalPageTolerance })}`);
      measurements.push({
        templateId,
        wordCount,
        estimatedTerminalPage: comparison.estimatedTerminalPage,
        exactMainTerminalPage: comparison.exactMainTerminalPage,
        exactTextWordCount: comparison.exactTextWordCount,
        maxAbsPageMassDelta: Math.max(...comparison.pages.map(({ estimatedMassUnits, exactTextWords }) => Math.abs(exactTextWords - estimatedMassUnits))),
        slotDrift: {
          comparedSlots: slotMeasurements.length,
          maxAbsBoundaryDelta: maxAbsSlotDrift,
        },
      });
    }
  }

  const firstTemplateSource = parse(await readFile(join(root, 'templates/pages/editorial-dynamic-chrome/template.yml'), 'utf8'));
  const firstTemplateCompiled = compileTemplateSource(firstTemplateSource);
  const firstTemplateGeometry = pageGeometryFromTemplate(firstTemplateCompiled);
  const continuationSource = parse(await readFile(join(root, 'templates/pages/default-report/template.yml'), 'utf8'));
  const continuationCompiled = compileTemplateSource(continuationSource);
  const continuationGeometry = pageGeometryFromTemplate(continuationCompiled);
  const transitionLabel = `${firstTemplateCompiled.id}->${continuationCompiled.id}/main`;
  const transitionLorem = createDeterministicLorem();
  const transitionInput = {
    flows: {
      main: { id: 'main', blocks: [{ id: 'calibration-body', type: 'text', role: 'body', text: loremParagraph(transitionLorem, 1500) }] },
    },
  };
  const transitionPdf = newPdf('portrait', [firstTemplateGeometry.width, firstTemplateGeometry.height]);
  const transitionResult = planReportComposition(transitionPdf, firstTemplateCompiled, firstTemplateGeometry, transitionInput, {
    family: 'DejaVu',
    maxPages: renderConfig.pdf.composition_max_pages,
    includeTitlePage: false,
    styles,
    layout: [
      { pages: { count: { min: 1, max: 1 } }, template: firstTemplateCompiled.id },
      { pages: 'remaining', template: continuationCompiled.id },
    ],
    pageTemplateSources: [
      { templateRef: firstTemplateCompiled.id, compiled: firstTemplateCompiled, geometry: firstTemplateGeometry },
      { templateRef: continuationCompiled.id, compiled: continuationCompiled, geometry: continuationGeometry },
    ],
    policy: { searchBudget: { maxRefinementRounds: 0, maxFullPlanRecalculations: 1 } },
  });
  const transitionSeed = transitionResult.plan.decisions.find(({ code }) => code === 'COARSE_GEOMETRY_SEED_SELECTED');
  const transitionComparison = transitionSeed?.baselineExactComparison;
  assert.equal(transitionResult.evaluation.status, 'accepted', `${transitionLabel} exact evaluation must accept all measured content: ${JSON.stringify(transitionResult.evaluation)}`);
  assert.ok(transitionComparison && Array.isArray(transitionComparison.pages), `${transitionLabel} must expose coarse-to-exact calibration`);
  assert.ok(transitionResult.plan.pages.some(({ templateRef }) => templateRef === firstTemplateCompiled.id), `${transitionLabel} must materialize its first-page template`);
  assert.ok(transitionResult.plan.pages.some(({ templateRef }) => templateRef === continuationCompiled.id), `${transitionLabel} must materialize its continuation template`);
  assert.ok(transitionResult.plan.lines.some(({ blockId, page }) => blockId === 'calibration-body' && page > 1), `${transitionLabel} must continue main text after the first page`);
  assert.equal(transitionComparison.pages.reduce((sum, page) => sum + page.exactTextWords, 0), transitionComparison.exactTextWordCount, `${transitionLabel} exact page masses must account for all measured main text`);
  assert.ok(transitionComparison.pages.every(({ estimatedMassUnits, exactTextWords }) => estimatedMassUnits === exactTextWords), `${transitionLabel} must predict exact per-page main text mass`);
  const transitionSlotMeasurements = transitionComparison.pages.flatMap(({ page, blocks = [] }) => blocks.flatMap((block) => {
    const estimatedSlots = new Map(block.estimatedBySlot.map((slot) => [slot.slotId, slot]));
    return block.exactBySlot.flatMap((exact) => {
      const estimated = estimatedSlots.get(exact.slotId.replace(/^\d+:/u, ''));
      if (!estimated) return [];
      return [{ page, slotId: exact.slotId, topDelta: exact.topY - estimated.topY, bottomDelta: exact.bottomY - estimated.bottomY,
        leftDelta: exact.leftX - estimated.leftX, rightDelta: exact.rightX - estimated.rightX }];
    });
  }));
  assert.ok(transitionSlotMeasurements.length > 0, `${transitionLabel} must compare estimated and exact slot boxes`);
  const maxTransitionSlotDrift = Math.max(...transitionSlotMeasurements.flatMap(({ topDelta, bottomDelta, leftDelta, rightDelta }) =>
    [Math.abs(topDelta), Math.abs(bottomDelta), Math.abs(leftDelta), Math.abs(rightDelta)]));
  assert.ok(maxTransitionSlotDrift <= geometryTolerance, `${transitionLabel} estimated and exact slot boundaries must remain within configured geometry tolerance: ${maxTransitionSlotDrift} > ${geometryTolerance}`);
  assert.ok(Math.abs(transitionComparison.estimatedTerminalPage - transitionComparison.exactMainTerminalPage) <= terminalPageTolerance,
    `${transitionLabel} terminal page drift exceeds configured tolerance: ${JSON.stringify({ estimated: transitionComparison.estimatedTerminalPage, exact: transitionComparison.exactMainTerminalPage, tolerance: terminalPageTolerance })}`);
  measurements.push({
    templateId: transitionLabel,
    wordCount: transitionComparison.exactTextWordCount,
    estimatedTerminalPage: transitionComparison.estimatedTerminalPage,
    exactMainTerminalPage: transitionComparison.exactMainTerminalPage,
    exactTextWordCount: transitionComparison.exactTextWordCount,
    maxAbsPageMassDelta: Math.max(...transitionComparison.pages.map(({ estimatedMassUnits, exactTextWords }) => Math.abs(exactTextWords - estimatedMassUnits))),
    slotDrift: { comparedSlots: transitionSlotMeasurements.length, maxAbsBoundaryDelta: maxTransitionSlotDrift },
  });

  console.log(JSON.stringify({ terminalPageTolerance, cases: measurements.map(({ templateId, wordCount, estimatedTerminalPage, exactMainTerminalPage, exactTextWordCount, maxAbsPageMassDelta, slotDrift }) => ({ templateId, wordCount, estimatedTerminalPage, exactMainTerminalPage, exactTextWordCount, maxAbsPageMassDelta, slotDrift })) }, null, 2));
  console.log(`Coarse geometry template calibration passed (${measurements.length} template-density and transition cases).`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
