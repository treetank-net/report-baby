#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { runProcess } from './lib/process.mjs';
import { legacyFixtureToCompositionInput } from './lib/legacy-fixture-to-composition-input.mjs';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'report-baby-composition-page-limits-'));
const bundles = {
  shadow: join(temporary, 'shadow.cjs'),
  primitives: join(temporary, 'primitives.cjs'),
  template: join(temporary, 'template.cjs'),
  geometry: join(temporary, 'geometry.cjs'),
};

function build(entry, output, extra = []) {
  const result = runProcess('npx', ['esbuild', entry, '--bundle', '--platform=node', '--target=node18', '--format=cjs', ...extra, `--outfile=${output}`], { cwd: root, timeout: 30_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

build('src/composition/report-shadow.ts', bundles.shadow);
build('src/render-primitives.ts', bundles.primitives, ['--loader:.wasm=binary', '--loader:.ttf=binary']);
build('src/template-contract.ts', bundles.template);
build('src/page-geometry.ts', bundles.geometry);

const prose = 'Transport drogowy w Europie Srodkowej przechodzi glebokie zmiany strukturalne. Rosnace koszty paliwa oraz nowe regulacje dotyczace czasu pracy kierowcow zmieniaja rachunek ekonomiczny. Firmy spedycyjne reaguja konsolidacja floty i inwestycjami w cyfrowe platformy wymiany ladunkow.';
const validEditorialInput = (body) => legacyFixtureToCompositionInput({
  intro: 'Krotki wstep do raportu.',
  sections: [{ heading: 'Dlugoterminowa zmiana na rynku', body }],
  footer: 'Page limit contract',
});

try {
  const { planReportCompositionShadow } = await import(bundles.shadow);
  const { newPdf } = await import(bundles.primitives);
  const { compileTemplateSource } = await import(bundles.template);
  const { pageGeometryFromTemplate } = await import(bundles.geometry);
  const source = parse(await readFile(join(root, 'templates/pages/editorial-two-column/template.yml'), 'utf8'));
  const compiled = compileTemplateSource(source);
  const geometry = pageGeometryFromTemplate(compiled);

  const onePageLimit = planReportCompositionShadow(
    newPdf('portrait', [geometry.width, geometry.height]),
    compiled,
    geometry,
    validEditorialInput(Array.from({ length: 100 }, () => prose).join(' ')),
    { family: 'DejaVu', maxPages: 1 },
  );
  assert.equal(onePageLimit.plan.pages.length, 1, 'planner must materialize exactly the configured one-page limit');
  assert.equal(onePageLimit.plan.diagnostics.find((item) => item.code === 'MAX_PAGES_EXCEEDED')?.page, 2, 'planner must report the first page beyond maxPages');
  assert.ok(onePageLimit.plan.residualContent.length > 0, 'content beyond the configured limit must remain visible as residual content');
  assert.ok(onePageLimit.plan.lines.some((line) => line.blockId === 'intro'), 'the valid intro fixture must be placed before the page limit is reached');

  const genuinelyTooLong = planReportCompositionShadow(
    newPdf('portrait', [geometry.width, geometry.height]),
    compiled,
    geometry,
    validEditorialInput(Array.from({ length: 400 }, () => prose).join(' ')),
    { family: 'DejaVu', maxPages: 12 },
  );
  const exceeded = genuinelyTooLong.plan.diagnostics.find((item) => item.code === 'MAX_PAGES_EXCEEDED');
  assert.equal(genuinelyTooLong.plan.pages.length, 12, 'a genuinely oversized editorial must stop at the configured twelve-page limit');
  assert.equal(exceeded?.page, 13, 'the oversized editorial must attempt page 13');
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
