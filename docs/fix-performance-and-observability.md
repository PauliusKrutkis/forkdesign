# Fix performance & observability — continuation notes

Context from design review session (May 2026). Use this to pick up logging, speed work, or Phase 3 (Cursor SDK).

## What shipped: AI Fix Strategy Layer

Fix (`POST /api/iterations/new`) now routes by model via `src/fix/`:

| Model setting | Strategy | Auth |
|---------------|----------|------|
| `default`, `claude-sonnet-4-6`, `claude-opus-4-7` | `ClaudeStrategy` (`src/fix/strategies/claude.ts`) | Claude Code login / `ANTHROPIC_API_KEY` |
| `composer-2.5` | `CursorCliStrategy` (`src/fix/strategies/cursor-cli.ts`) | `agent login` or `CURSOR_API_KEY` |
| (future) | `CursorSdkStrategy` stub — not routed yet | `CURSOR_API_KEY` |

- Settings → AI model is wired: `CommentBubble` sends `{ id, model }`.
- Plugin option: `comments({ cursorAgentPath?: string })`.
- Post-processing unchanged: before/after diff, `v{N}.tsx` snapshot, `active` update in `plugin.ts`.
- Deprecated shim: `src/iterate-with-agent.ts` re-exports `runFix`.

## Problem: simple fixes feel slow (60s+)

Example: “make text red” taking over a minute.

**Expected range (documented in code):** 20–90s for agentic Fix (`CommentBubble` comment ~L259).

### Where time goes

1. **Agent run (~80–95%)** — Read → think → (Grep/Glob?) → Edit → optional extra turns. Each LLM round trip = 10–30+ s.
2. **Snapshot (~fast)** — read file, write `designs/iterations/<id>/vN.tsx`, set `active`.
3. **Screenshot (async, after spinner)** — `captureAndUploadV` waits for HMR (up to 5s); does not block Fix completion.

### Likely causes for “simple” comments

- Multi-turn agent loop (`maxTurns: 30`, tools: Read/Edit/Glob/Grep).
- Prompt encourages full workflow (“read file, locate anchor, apply changes”) — no fast path for one className change.
- Screenshot on comment → prompt asks agent to **Read image** (extra vision tool call).
- Composer CLI = subprocess + full agent loop vs in-process Claude SDK.
- Agent may Grep/Glob before editing even when file + anchor are in the prompt.

## Current observability (gaps)

### UI (`CommentBubble`)

- Elapsed timer while iterating.
- Status line: `formatProgress()` → e.g. `Read src/...`, `Edit ...`, `thinking`, `dispatching`, `writing v2.tsx`.
- **`turnsUsed` / `toolCalls` returned in `done` event but not shown on success.**

### Server (Vite terminal)

- `[vite-plugin-comments] dispatching fix (${model}) for ...`
- Claude only: `[claude-agent] ${eventType}` per SDK event — **no timestamps, no durations**.
- Cursor CLI: **no stdout event logging**; stderr only on failure.

### How to diagnose today (no code changes)

1. Watch bubble status during Fix — long `thinking` = model latency; Read→Grep→Glob = wandering.
2. Watch Vite terminal — count `[claude-agent] assistant` lines (Claude).
3. DevTools → Network → `iterations/new` → last NDJSON line: `turnsUsed`, `toolCalls`, `changed`.
4. Compare Claude vs Composer on same comment.
5. Retry without screenshot on comment (if vision read is extra cost).

## Recommended next work

### A. Observability pass (low risk, high value)

- [ ] Phase timestamps in `handleIterationsNew`: agent start/end, snapshot start/end, total `durationMs` on `done`.
- [ ] Timed per-event logs in strategies: `[fix/claude] +12.3s Read src/Foo.tsx`.
- [ ] Cursor CLI: log parsed `stream-json` events (or tool starts) to server console.
- [ ] UI: show `turnsUsed` / `toolCalls` (and maybe total duration) briefly after success or on error.
- [ ] Optional: `comments({ fixDebug?: boolean })` to gate verbose logs.

**Key files:** `src/plugin.ts`, `src/fix/strategies/claude.ts`, `src/fix/strategies/cursor-cli.ts`, `src/components/CommentBubble.tsx`.

### B. Speed / prompt tuning (behavior change)

- [ ] Tighten `buildIteratePrompt()` in `src/fix/prompt.ts`:
  - File path already known — skip Grep/Glob unless anchor not found.
  - “Prefer a single Edit; stop immediately after one successful edit.”
  - Skip screenshot read when feedback is explicit (e.g. className/color).
- [ ] Lower `maxTurns` for Fix (e.g. 5–8 instead of 30) in `claude.ts`.
- [ ] Cursor CLI: consider flags / mode if available for shorter runs.

### C. Fast path (larger feature)

- [ ] Non-agent path for trivial Tailwind/className edits (parse comment + anchor, patch className directly).
- [ ] Or: “Quick fix” vs “Agent fix” in bubble UI.

### D. Phase 3 — Cursor SDK

- [ ] Implement `CursorSdkStrategy` with `@cursor/sdk`, local runtime, `composer-2.5`.
- [ ] Route via new model id or `comments({ composerBackend: 'cli' | 'sdk' })`.
- [ ] Note: SDK requires `CURSOR_API_KEY`; no `agent login` reuse.

## Architecture reference

```
CommentBubble Fix
  → POST /api/iterations/new { id, model }
  → handleIterationsNew (plugin.ts)
      → runFix (src/fix/index.ts)
          → resolveFixStrategy(model)
      → snapshot v{N}.tsx (unchanged)
  → captureAndUploadV (client, async)
```

## Tests already added

- `src/fix/prompt.test.ts`
- `src/fix/index.test.ts`
- `src/fix/progress/cursor-cli.test.ts`

## Open questions

- Which model was used when slowness was observed (Claude vs Composer)?
- Typical `turnsUsed` / `toolCalls` from Network `done` event?
- Do slow comments usually have screenshots attached?
- Is slowness mostly “thinking” or extra tool calls?

---

*Last updated: 2026-05-30*
