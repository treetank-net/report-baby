#!/usr/bin/env node

/**
 * @test-decision visual-gate
 * @test-action Keep the legacy PDF/raster editorial regression opt-in; the default composition suite uses test-editorial-plan-contract.mjs instead.
 */
process.env.EDITORIAL_NUMBERED_VISUAL = '1';
await import('./test-editorial-numbered-flow.mjs');
