# Release 1.2 — editable composition drafts

Status: discovery input. This task is deliberately outside the Release 1.1
acceptance gate.

## Motivation

Documents with many insertions may need several planning and editorial passes
before rendering. A user should be able to inspect a complete plan, adjust
content or placement constraints, compare candidates and render the accepted
plan without reconstructing the entire request or unknowingly making a second
set of composition decisions.

Release 1.1 supplies the prerequisite: plan-only output with complete legality,
quality, geometry, insertion-capability and candidate-selection evidence. It
remains a stateless planning operation. Release 1.2 may give that result a
durable editable identity.

## Proposed workflow

```text
create draft from input + layout + brand
  -> normalize and validate input
  -> generate and evaluate complete candidates
  -> retain the selected candidate and alternatives
  -> return draft revision and diagnostics

edit draft content or declared preferences
  -> increment revision
  -> invalidate affected planning results
  -> re-plan and expose the changed evidence

select an accepted candidate
  -> freeze its exact plan and source/configuration versions

render accepted draft
  -> paint the frozen accepted plan
  -> do not silently re-plan during rendering
```

Possible public operations are:

- `create_report_draft`;
- `update_report_draft`;
- `replan_report_draft`;
- `select_report_draft_candidate`;
- `render_report_draft`.

Names are not fixed until the MCP and CLI persistence contract is designed.

## Draft contents

A composition draft would need:

- a stable draft identifier and monotonically increasing revision;
- normalized semantic document input;
- the resolved document layout declaration;
- brand, template and render-configuration identities or hashes;
- insertion content, hard constraints and soft placement preferences;
- complete generated candidates or reproducible candidate identities;
- the selected candidate and its evaluation;
- diagnostics, suggestions and outstanding residual content; and
- the accepted frozen plan, when one has been selected for rendering.

The draft stores no PDF as its source of truth. Rendering remains a projection
of the accepted composition plan.

## CLI and MCP portability

The design must work for both a long-running MCP server and an ephemeral CLI.
An MCP-only in-memory session is therefore insufficient. Candidate approaches
to evaluate are:

1. a versioned portable draft JSON document returned by MCP and accepted by
   the CLI;
2. a repository- or user-selected draft file managed by the CLI; or
3. an optional persistent MCP store using the same serialized contract.

All approaches require optimistic revision checks so that an edit cannot
silently overwrite a newer draft. The accepted plan must be rejected as stale
when its content, layout, brand, template or relevant render configuration has
changed.

## Editing boundary

Edits change semantic content or declared constraints and preferences. They do
not patch derived line boxes or occupied placement geometry directly. A user
may choose another generated candidate or add an explicit placement request;
the planner remains responsible for producing a complete legal plan.

The initial edit vocabulary should stay small:

- add, remove, replace or reorder blocks in a named flow;
- change whether optional insertion content is required;
- select or prefer an insertion slot capability;
- constrain an insertion to a page or page range;
- change the document layout; and
- select one of the existing evaluated candidates.

## Entry conditions

Implementation starts only after Release 1.1 provides:

- one canonical public document layout contract;
- stable normalized insertion requests and reusable slot capabilities;
- bounded deterministic candidate identities;
- self-contained plan legality and quality evidence;
- equivalent plan-only behavior across MCP and CLI; and
- rendering that consumes an accepted plan without inventing content.

## Open decisions

- portable draft document versus server-managed storage;
- retention and cleanup policy for server-managed drafts;
- whether candidate plans are stored in full or regenerated from stable
  signatures;
- artifact and asset references when a draft moves between machines;
- authorization boundaries for reading and updating persisted drafts; and
- compatibility rules when templates or render configuration change.
