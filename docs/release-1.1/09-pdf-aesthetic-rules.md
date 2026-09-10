# PDF aesthetic rules and planner feedback

Status: implementation baseline for the dynamic editorial templates; full
visual calibration remains a Release 1.1 task.

## Purpose

Legality is necessary but not sufficient for a useful editorial PDF. An
accepted plan must also expose measurable spacing and fragmentation signals so
the evaluator can prefer a calm, readable composition. A PDF consumer should
be able to understand these signals from the plan and normal CLI/MCP output;
an ad-hoc debug script must not be required.

## Rules

1. The first-page intro is a normal flow containing the cover image and lead.
   Both are fit-content blocks. Their measured heights push the main content
   slot. Main content may start on page 1 when the remaining slot is legal;
   otherwise the main flow starts on the next scheduled page.
2. A header title is a semantic heading block, not generic body text. The
   resolved header rule must remain at least the configured
   `pdf.header_bottom_gap` below the measured header content. The first
   non-header content must not touch the rule.
3. Image and quote insertions reserve their measured content box (including a
   caption where present). The initial maximum is only a planning envelope;
   fit-content placement shrinks it to the measured height before surrounding
   text is evaluated.
4. A wrapped image is an obstacle for every intersecting text column. The
   evaluator must report the obstacle box and the before/after gaps instead of
   treating an unexplained blank area as a successful layout.
5. Quote insertions may move only inside an explicitly legal request/template
   window. Candidate movement is useful only when the evaluator scores orphan
   fragments, insertion spacing, and column balance together; authored `y`
   coordinates alone are not a candidate search.
6. A plan can be legal and still receive negative aesthetic points. Current
   score components include orphan fragments, insertion-spacing imbalance, and
   header-spacing deficits. Negative components produce actionable suggestions
   in the composition evaluation.

## Current diagnostic evidence

The Trans.INFO/DSV fixture demonstrated the following causes:

- the article title was supplied as `type: text`, so it correctly used the
  normal header style; a semantic `type: heading` is required for bold output;
- the dynamic chrome rule was derived as `contentBottom - gap`, while the band
  height included only one gap, putting the rule on the content boundary;
- the intro template used `main.start_page: 2` and did not connect the dynamic
  intro blocks to the main slot, so page 1 could not contain main text;
- no movable insertion policy was supplied for the authored quote positions,
  therefore the candidate-search trace was empty and no ±5% quote movement was
  evaluated.

The planner now emits a `header-spacing` score component and optional
`suggestions` with evidence and remedies. Candidate movement still requires an
explicit policy; silently moving a user-authored insertion would violate the
input contract.

## Acceptance criteria

- The first-page plan exposes image, lead, main, header, and footer boxes plus
  their measured gaps.
- A dynamic header title is bold when its input block is a heading, and the
  plan reports a positive rule gap.
- A fit-content image does not leave its maximum-height envelope as a false
  obstacle after measurement.
- Evaluations expose negative aesthetic components and at least one actionable
  suggestion when an orphan, spacing imbalance, or header gap deficit exists.
- The CLI/MCP diagnostic response contains these plan/evaluation fields without
  requiring a user-authored inspection script.
