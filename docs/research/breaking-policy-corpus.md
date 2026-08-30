# Breaking-policy corpus

Date: 2026-08-26

This is a prototype corpus for configurable editorial breaking. It renders
each accepted case to PNG and runs an independent pixel-QA pass after the
plan-level assertions.

Run it with:

```text
npm run test:prototype-breaking -- \
  --out /tmp/report-baby-breaking-policy-corpus-v15
```

## Result

```text
status: passed
cases: 124
accepted: 123
rejected: breaking-strict-protected-image
profiles: editorial, balanced, freeform, strict
```

The matrix contains 120 cases:

- four profiles;
- three text lengths: compact, boundary, and long;
- five image variants: plain, ellipse, star, triangle, staircase;
- two break boundaries: heading and paragraph.

The four additional cases cover explicit policy behavior:

| Fixture | Expected behavior |
| --- | --- |
| `breaking-protected-image` | editorial profile accepts a 66.7% protected underfill and records `UNDERFILL_PROTECTED_BREAK` with `keep-section-3` as the cause |
| `breaking-strict-protected-image` | strict profile rejects the same plan and returns the diagnostic in `unsatisfiedCore` |
| `breaking-freeform-single-line` | freeform profile allows the controlled single-line continuation |
| `breaking-editorial-relaxed-single-line` | editorial profile with `widows: 1` records `SINGLE_LINE_CONTINUATION` as a diagnostic |

The default editorial and balanced profiles fail the corpus if a
`SINGLE_LINE_CONTINUATION` appears. The freeform profile intentionally leaves
that decision to the template author.

## Machine checks

For every case the harness checks:

- selected profile is carried into the plan;
- expected underfill and single-line diagnostics are present or absent;
- strict rejection contains the expected unsatisfied core;
- long cases continue to another page;
- accepted plans contain no evaluator violations;
- every image is placed exactly once;
- accepted PNGs are exactly 1600×900;
- independent signed-mask pixel-QA reports no text/image overlap or geometry
  overflow, including leakage outside the declared shape;
- the independent manifest in
  `server/templates/composition-qa-manifest.yml` controls the count, naming
  patterns and expected rejected set.

The corpus is intentionally a prototype: `balanced` currently records
underfill decisions but does not yet perform global backtracking. That is the
next planner capability to implement if the target fill ratio should become a
repair objective rather than a diagnostic.

Artifacts from the latest run:

- [breaking report](/tmp/report-baby-breaking-policy-corpus-v15/breaking-report.json)
- [render report](/tmp/report-baby-breaking-policy-corpus-v15/rendered/report.json)
- [pixel report](/tmp/report-baby-breaking-policy-corpus-v15/pixel-qa/pixel-qa-report.json)
- [protected underfill page 1](/tmp/report-baby-breaking-policy-corpus-v15/rendered/breakingProtectedImage/page-1.png)
- [long text with star page 1](/tmp/report-baby-breaking-policy-corpus-v15/rendered/breaking-editorial-long-star-heading/page-1.png)
- [long text with star page 2](/tmp/report-baby-breaking-policy-corpus-v15/rendered/breaking-editorial-long-star-heading/page-2.png)
