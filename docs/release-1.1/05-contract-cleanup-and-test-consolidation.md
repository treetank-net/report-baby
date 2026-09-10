# Release 1.1 — contract cleanup and test cost

Status: scope proposal; call sites must be audited before breaking changes.

## Public contract

Release 1.0 preserves public exports, input aliases, and MCP/CLI behaviour. In
1.1, confirmed legacy remnants may be removed, but only after:

1. collecting every MCP, CLI, `dry_run`, and adapter call site;
2. assigning every export to a domain owner;
3. preparing a migration message or an explicit breaking-change version;
4. adding a test that proves there is no hidden path.

Do not remove a symbol merely because it looks old. First establish that it is
not part of the user contract or the bundle.

## Tests

Further reductions must reduce cost, not coverage. For each assertion, choose
the cheapest sufficient proof:

| Property | Preferred proof |
|---|---|
| page, flow, slot, order, legality, residual | plan/evaluation without PDF |
| selectable text or stream correctness | one small PDF |
| backend image geometry or contrast | one representative artifact |
| PDF/PNG/PPTX parity | a separate artifact test, only when it is the contract |
| the same repeated property | one shared fixture instead of many renders |

Mixed tests should be split into a planning part and a minimal backend proof.
Merging several tests is appropriate when they check the same contract and can
keep separate, readable assertions. Removal is appropriate only when
duplication has been demonstrated.

## Acceptance criteria

- every check is labelled `not-generated`, `retain`, `split`, or `remove`;
- a retained artifact has a named backend reason;
- a plan-only check does not start the renderer or rasterisation;
- shared fixtures do not hide different contracts;
- timing JSONL shows cost before and after migration;
- MCP, CLI, brand, and release gates remain fail-closed;
- the public export and alias audit has a result for every symbol.

## Out of scope

- changing flow or legality semantics only to make a test faster;
- removing an assertion without an equivalent proof;
- removing a complete backend visual test when its property has no cheaper
  equivalent.
