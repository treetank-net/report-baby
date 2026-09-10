# Candidate after Release 1.1 — full chrome visual calibration

Status: candidate; not an approved Release 1.1 task.

## Rationale

Release 1.0 provides dynamic-chrome mechanics, and Release 1.1 is intended to
complete automatic lockup and fallback removal. Only then can appearance be
calibrated across the full set of brands and templates without mixing mechanism
changes with visual assessment.

## Potential scope

- calibrating padding, gaps, and fit-content heights for header, lockup, and
  footer;
- comparing several title lengths, brand names, and lockup descriptions;
- evaluating empty, single-line, and multi-line chrome;
- stable acceptance thresholds for the plan, PDF, and representative raster;
- updating baselines only after manual acceptance of changes.

## Entry conditions

- the template schedule and ordinary slots have replaced `continuation_*`;
- the lockup is materialised from the brand profile;
- the legacy renderer fallback has a per-template decision or has been removed;
- paint-order and test-cost changes are not introduced into the same baseline at
  the same time.

## Out of scope for this candidate

- changing flow routing;
- a global geometry solver;
- redefining `continuation`;
- adding new content types.
