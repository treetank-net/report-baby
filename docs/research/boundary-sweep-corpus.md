# Exact line-capacity boundary sweep

Date: 2026-08-26

Run:

```text
npm run test:prototype-boundary -- \
  --out /tmp/report-baby-boundary-sweep-v5
```

Result:

```text
status: passed
cases: 16
profiles: editorial, balanced, freeform, strict
states: under, exact, over, push
```

Each profile receives the same fixed-width text. The middle column contains
exactly 32, 33, 34 or 35 filler lines before a heading-plus-two-body-line keep
cluster.

| State | Middle filler | Editorial/balanced/freeform | Strict |
| --- | ---: | --- | --- |
| under | 32 | cluster stays in middle | stays in middle |
| exact | 33 | cluster stays in middle | stays in middle |
| over | 34 | cluster stays in middle | stays in middle |
| push | 35 | cluster moves to secondary | rejects at 89.8% vs 90% target |

The important invariant is that the keep cluster is never split. The planner
either leaves the heading and first two body lines together, moves the whole
cluster to the next fragmentainer, or returns a rejection with
`UNDERFILL_PROTECTED_BREAK`.

The pixel gate is run with mutation explicitly skipped because these fixtures
contain no images; image-bearing corpora retain the mandatory mutation gate.

Artifacts:

- [boundary report](/tmp/report-baby-boundary-sweep-v5/boundary-report.json)
- [pixel report](/tmp/report-baby-boundary-sweep-v5/pixel-qa/pixel-qa-report.json)
