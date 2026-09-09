#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';
import { build } from 'esbuild';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-page-limits-'));
const bundles = {
  adapter: join(temporary, 'composition/report-composition-entrypoint.cjs'),
  primitives: join(temporary, 'rendering/primitives.cjs'),
  template: join(temporary, 'template/contracts.cjs'),
  geometry: join(temporary, 'template/geometry.cjs'),
};
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

const prose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow.';
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a plan fixture or assertion; merge duplicate document builders into shared plan fixtures.
 */
const validEditorialInput = (body) => legacyFixtureToCompositionInput({
  intro: 'Krotki wstep do raportu.',
  sections: [{ heading: 'Dlugoterminowa zmiana na rynku', body }],
  footer: 'Page limit contract',
});

try {
  const { planReportComposition } = await import(bundles.adapter);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);

  const onePageLimit = planReportComposition(
    newPdf('portrait', [geometry.width, geometry.height]),
    compiled,
    geometry,
    validEditorialInput(Array.from({ length: 25 }, () => prose).join(' ')),
    { family: 'DejaVu', maxPages: 1 },
  );
  assert.equal(onePageLimit.plan.pages.length, 1, 'planner must materialize exactly the configured one-page limit');
  assert.equal(onePageLimit.plan.diagnostics.find((item) => item.code === 'MAX_PAGES_EXCEEDED')?.page, 2, 'planner must report the first page beyond maxPages');
  assert.ok(onePageLimit.plan.residualContent.length > 0, 'content beyond the configured limit must remain visible as residual content');
  assert.ok(onePageLimit.plan.lines.some((line) => line.blockId === 'intro'), 'the valid intro fixture must be placed before the page limit is reached');

  const genuinelyTooLong = planReportComposition(
    newPdf('portrait', [geometry.width, geometry.height]),
    compiled,
    geometry,
    validEditorialInput(Array.from({ length: 80 }, () => prose).join(' ')),
    { family: 'DejaVu', maxPages: 4 },
  );
  const exceeded = genuinelyTooLong.plan.diagnostics.find((item) => item.code === 'MAX_PAGES_EXCEEDED');
  assert.equal(genuinelyTooLong.plan.pages.length, 4, 'a genuinely oversized editorial must stop at the configured four-page limit');
  assert.equal(exceeded?.page, 5, 'the oversized editorial must attempt page 5');
  assert.equal(genuinelyTooLong.plan.residualContent[0]?.reason, 'max-pages');
  assert.ok(genuinelyTooLong.plan.lines.some((line) => line.blockId === 'intro'), 'the oversized fixture must still place its correctly identified intro');
  assert.ok(genuinelyTooLong.plan.lines.some((line) => line.blockId === 'section-1-body'), 'the oversized fixture must place real main-flow content before exhausting the limit');

  console.log(JSON.stringify({
    status: 'passed',
    tests: [
      { name: 'configured one-page limit', pages: onePageLimit.plan.pages.length, exceededPage: onePageLimit.plan.diagnostics.find((item) => item.code === 'MAX_PAGES_EXCEEDED')?.page },
      { name: 'genuinely oversized valid editorial', pages: genuinelyTooLong.plan.pages.length, exceededPage: exceeded?.page, residualBlocks: genuinelyTooLong.plan.residualContent.length },
    ],
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
