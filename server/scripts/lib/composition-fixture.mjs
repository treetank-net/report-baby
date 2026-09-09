import { legacyFixtureToCompositionInput } from './legacy-fixture-to-composition-input.mjs';

/**
 * Keeps fixture migration at the test boundary while allowing tests to target
 * the same normalized document that the planner receives in production.
 *
 * The production planner must not know about historical fixture fields. Tests
 * may still author their cases in the old, readable fixture notation, but the
 * conversion is deliberately hidden behind this test-only seam.
 */
/**
 * @test-decision plan-fixture-or-assertion
 * @test-action Keep as a renderer-neutral composition adapter/fixture; merge equivalent legacy and composition setup at this shared seam.
 */
export function fixtureDocument(normalizeCompositionInput, fixture = {}) {
  return normalizeCompositionInput(legacyFixtureToCompositionInput(fixture));
}
