---
name: agent-delegation-checkpoints
description: Delegate bounded work to agents with observable checkpoints, partial artifacts, bounded waiting, and verified handoff.
---

# Agent delegation with checkpoints

Use this skill whenever a sub-agent performs research, planning, documentation,
or another task that can outlive one short tool call.

## Before spawning

- Define one bounded objective, the owned output files, excluded files, and the
  evidence required for completion.
- Keep the main agent's immediate critical-path work local; delegate a sidecar
  task that can progress independently.
- For research or long documentation work, create the checkpoint file before
  spawning the agent. Keep it next to the final artifact, for example:
  `docs/research/topic.progress.md`.

## Checkpoint contract

The agent must update the checkpoint before substantive work and after every
source or meaningful work unit. Use a compact, append-only log with:

- `status`: `starting`, `running`, `blocked`, or `completed`;
- `last_update`: an ISO timestamp;
- `plan` and `next_step`;
- `blockers`;
- one timestamped line for each completed unit, including the evidence and
  next step.

For work involving network or slow tools, require a heartbeat at least every
two minutes. A heartbeat must be written to the checkpoint, not only sent as a
chat message. Partial findings belong in the final Markdown artifact as soon
as they are reliable; the checkpoint is for observability, not a replacement
for the deliverable.

## Monitoring and stopping

- Poll the checkpoint while the agent runs; do not rely on repeated blind
  `wait` calls.
- Use bounded waits of roughly 30–60 seconds. Continue useful non-overlapping
  local work between checks.
- If the checkpoint has not changed for three bounded checks, send at most one
  non-urgent status request asking the agent to record a blocker and continue
  or finish with a partial result.
- If it remains silent after that, do not claim completion. Close the agent,
  preserve any partial artifact, record the failure, and take over only after
  the agent is shut down.
- Do not repeatedly prompt a slow agent; prompts without observable progress
  are not a monitoring strategy.

## Handoff verification

An agent's `completed` status is not sufficient. The main agent must verify:

- the final artifact exists at the agreed path;
- the artifact contains the requested evidence and source links when research
  was requested;
- the checkpoint says `completed` and names the artifact;
- no excluded files changed;
- repository validation appropriate to the task passes (`git diff --check`
  at minimum for Markdown-only work).

Close completed agents after verification so they do not consume concurrency.
Report partial or fallback work honestly, including the checkpoint and artifact
paths.

## Scope and safety

The checkpoint protocol does not grant extra write, network, deployment, or
messaging authority. Keep the agent's task and write set narrow, preserve
unrelated changes, and never turn a heartbeat or retry into permission for an
external mutation.
