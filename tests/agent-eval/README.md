# Agent Eval (Tier 2 + 3) — STUB

> ⚠️ This whole directory is scaffolding. Every file is a stub with `TODO`s.
> Nothing here runs in the default test command or in CI.

This is the **opt-in, real-agent** layer. Unlike `tests/integration/` and
`tests/e2e/` — where the agent is **always stubbed** (see `tests/README.md`,
"the real agent is NEVER called in CI") — the eval suite invokes the *real*
`runAgent` seam against the real Claude Agent SDK. It is slow, non-deterministic,
and costs tokens, so it is **never a blocking gate**.

## What it answers

The deterministic layers answer *"is the flow wired up correctly?"*. This layer
answers *"did the real agent produce a good edit?"* — across realistic
scenarios: multiple variants, comments on different components, cross-file
edits, vague vs precise instructions.

## Two graders

1. **Invariants** (`harness.ts`) — objective, cheap to check, deterministic
   given a run output:
   - the edited file still parses / typechecks,
   - ONLY the targeted component changed (no collateral edits to other markers),
   - the post-edit screenshot differs from the baseline,
   - the expected number of variants came back,
   - other comments on the page were left untouched.
2. **LLM-as-judge** (`judge.ts`, Tier 3) — subjective quality: feed the
   before/after screenshots + the instruction to a vision model and ask
   "did this satisfy the request? score 1–5 + reason". Tracked as a **trend**,
   never a hard pass/fail gate.

## Gating (how it stays out of CI)

- The eval specs live OUTSIDE both vitest project `include` globs (`src/**` and
  `tests/integration/**`), so `pnpm test` / `pnpm test:integration` never pick
  them up.
- `agent-eval.test.ts` additionally self-skips unless `ANTHROPIC_API_KEY` is set.
- CI runs with NO agent credentials, so an accidental real call fails fast.

## Running (TODO: wire up)

TODO(tier2): add a dedicated runner so this is opt-in and explicit, e.g.
```sh
# TODO: package.json script — NOT added yet (keep it out of default `test`)
pnpm test:agent-eval
```
TODO(tier2): point it at `tests/agent-eval/vitest.config.ts` (own project,
node env, long timeouts, single worker, no retries).
TODO(tier2): document required env: `ANTHROPIC_API_KEY` (+ optional model /
budget caps), and a `--scenario <name>` filter for running one scenario.
TODO(ops): optionally run nightly / pre-release via the existing CI in a
separate non-blocking job; persist `judge` scores as an artifact to chart the
quality trend over time.
```
