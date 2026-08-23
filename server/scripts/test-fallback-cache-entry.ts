import assert from 'node:assert/strict';
import { resolveBrandContext } from '../src/brand-context.js';
import { clearPreparedBrandAssetCache, preparedBrandAssetCacheStats, renderReportPdf } from '../src/report-renderer.js';

async function main(): Promise<void> {
  const brandRoot = process.env.REPORT_BABY_BRAND_DIR;
  if (!brandRoot) throw new Error('REPORT_BABY_BRAND_DIR is required');

  const { theme } = await resolveBrandContext(brandRoot, { brandRef: 'brand://flux/primary' });
  clearPreparedBrandAssetCache();
  for (let index = 0; index < 3; index += 1) {
    await renderReportPdf('pages/editorial-two-column', {
      title: `Fallback cache ${index + 1}`,
      sections: [{ heading: 'Body', body: 'A short fallback-cache render.' }],
    }, theme);
  }

  const stats = preparedBrandAssetCacheStats();
  assert.equal(stats.fallbackEntries, 1, 'the raster fallback should produce one cached report-header derivative');
  assert.ok(stats.fallbackHits >= 2, `expected fallback cache hits on subsequent renders, got ${stats.fallbackHits}`);
  console.log(`fallback asset cache: ${stats.fallbackHits} hit(s), ${stats.fallbackEntries} derivative(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
