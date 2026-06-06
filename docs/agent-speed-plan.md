# Fix-speed optimization plan

Goal: make the "Fix with AI" flow feel faster without giving up the robustness
it has today. This doc captures the diagnosis, a measurement step that is now
wired up, and a phased plan so we change things in the right order.

## TL;DR

The fix task is tiny ("change one className on the element with this anchor"),
but it currently runs as a **full agentic loop**: an agent CLI is spawned, it
`Read`s the file, then `Edit`s it, across up to 8 turns. Most of the wall-clock
is process startup + serial Read→Edit round-trips, not the model thinking.

The biggest win is a **single-shot edit strategy** that reuses the file we
*already* read server-side, sends one direct model call, and applies the edit in
code — with the existing agent loop kept as a fallback. But we **measure first**
(logging is now in place) so we know whether we're shaving 4s→1s or 1.5s→1s.

## How a fix runs today

Client `Fix` button → `POST /api/iterations/new` → `runNewIteration`
(`src/server/iterations/run-iteration.ts`) → `runFix`
(`src/server/fix/index.ts`) → a strategy:

- `claudeStrategy` (`src/server/fix/strategies/claude.ts`) — Claude Agent SDK
  `query()` with `maxTurns: 8`, `allowedTools: ["Read", "Edit"]`.
- `cursorCliStrategy` (`src/server/fix/strategies/cursor-cli.ts`) — Cursor CLI
  `agent` subprocess (Composer models).

Default model chain (`src/server/fix/models.ts`):
`composer-2.5-fast → composer-2.5 → claude-sonnet-4-6 → default`.

### Where the latency comes from

1. **Agent/subprocess spin-up** — every fix launches an agent CLI and loads its
   system prompt + project context.
2. **Serial Read→Edit** — turn 1 the agent `Read`s the file, turn 2 it `Edit`s.
   The second turn cannot start until the first returns.
3. **Re-reading a file we already have** — `runNewIteration` already reads the
   source for the before/after diff (`beforeSource`), then the agent reads it
   *again* through its own tool. That round-trip is pure waste.
4. **No prompt caching** — iterating on the same comment (v1 → v2 → v3) re-sends
   the same file context cold each time.

## Phase 0 — Instrument & measure (DONE)

Each fix run now appends one JSON line to:

```
<projectRoot>/designs/logs/fix-runs.jsonl
```

(`projectRoot` is the **host** app being edited, not this package. Consumers who
don't want it in git should add `designs/logs/` to their `.gitignore`.)

Module: `src/server/fix/run-log.ts` (`appendFixRunLog`). Written from
`runNewIteration` at every terminal point via the local `recordRun` helper.
Logging is best-effort — it never throws and never blocks the fix.

Each record (`FixRunLogEntry`):

| field | meaning |
| --- | --- |
| `ts` | ISO timestamp when the run finished |
| `comment` | comment id |
| `file` / `anchor` | target file + element anchor |
| `textLength` | length of the feedback text (prompt-size proxy) |
| `screenshotIncluded` | whether the screenshot was offered to the model |
| `modelRequested` | model the client asked for |
| `modelChain` | resolved fallback chain that was eligible |
| `modelUsed` | model that actually produced the result |
| `modelsTried` | models attempted before giving up (failure path) |
| `attempts` | `[{ model, ms, ok }]` — per-model timing in the chain |
| `ok` / `changed` | succeeded? / did it actually change the source? |
| `durationMs` | total wall-clock from dispatch to terminal state |
| `turnsUsed` / `toolCalls` | agent turns / Read+Edit calls of the winner |
| `error` | message on the failure path |
| `stage` | `before-read \| agent \| after-read \| version \| persist \| done` |

### How to read it back

Run several fixes, then inspect. The key questions:

- What's the median `durationMs`, and what's the spread?
- `attempts` — is time lost to **fallback** (first model fails, second runs)?
  Each failed attempt's `ms` is dead time the user waits through.
- `turnsUsed` / `toolCalls` — are we routinely doing more than Read+Edit (2)?
  Higher means the agent is exploring/re-reading.
- Does `durationMs` correlate with `textLength` or `screenshotIncluded`
  (vision reads are slower)?

```bash
# quick look: model used, duration, turns, tools, changed
cat designs/logs/fix-runs.jsonl | jq -c '{ms:.durationMs, model:.modelUsed, turns:.turnsUsed, tools:.toolCalls, changed, attempts}'

# median-ish: sorted durations
cat designs/logs/fix-runs.jsonl | jq '.durationMs' | sort -n
```

**Decision gate:** if median `durationMs` is already low (~1–1.5s) and `turnsUsed`
is ~2, the agent path is fine and we stop here. If it's several seconds and/or
attempts show fallback churn, proceed to Phase 1.

## Phase 1 — Single-shot edit strategy (biggest win)

Add a third strategy alongside `claude` and `cursor-cli`, e.g.
`single-shot`/`directEditStrategy`:

1. Server reads the file (already done — pass `beforeSource` into the strategy
   instead of letting the agent re-read).
2. **One** direct Messages API call: system prompt + the file (or the relevant
   region around the anchor) + the feedback → ask for a structured edit
   (a search/replace block, or the new element snippet).
3. Apply the edit deterministically in code; reuse the existing before/after
   diff + snapshot path.
4. **Fallback:** if the model's edit doesn't apply cleanly (anchor moved, no
   match, ambiguous), fall through to the current agent loop. This is what keeps
   us safe — the slow-but-robust path stays as a backstop.

Expected effect: collapses subprocess startup + serial Read→Edit (~3 turns) into
a single model round-trip.

Notes / risks:
- Put it first in the chain only after it proves reliable; until then, run it
  behind a config flag and compare its `durationMs` / success rate in the same
  log.
- For large files, send only the region around the anchor to keep the prompt
  small (the anchor already pinpoints the element).

## Phase 2 — Prompt caching

Cache the stable parts (system prompt + file context) so repeated fixes on the
same comment/file reuse them. Helps most during iteration (v1 → v2 → v3).
Works with either architecture; pairs naturally with Phase 1's single call.

## Phase 3 — Smaller wins

- **Lower `maxTurns`** on the agent fallback (currently 8). The prompt already
  says "after one successful Edit, stop." Bounds the worst case.
- **Perceived speed** — confirm the client surfaces the streamed NDJSON progress
  ("reading… editing…") well; it makes the same wall-clock feel faster.

## Sequencing

1. Phase 0 (done) → collect data over a handful of real fixes.
2. Read `fix-runs.jsonl`, confirm where the time goes.
3. If warranted, build Phase 1 behind a flag, compare in the log, then promote.
4. Layer Phase 2, then Phase 3 cleanups.
