/**
 * @test-decision merge-shared-assertions
 * @test-action Keep the shared failure formatter; merge duplicate assertion messages only when error semantics remain unchanged.
 */
export function fail(message) {
  throw new Error(message);
}
