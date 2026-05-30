# Fix performance & observability — continuation notes

Context from design review session (May 2026).

## Shipped: global model fallback + perf tuning

Fix (`POST /api/iterations/new`) walks the priority list and uses the first available model; infra/auth failures fall through to the next.

| Piece | Detail |
|-------|--------|
| Default chain | `composer-2.5-fast` → `composer-2.5` → `claude-sonnet-4-6` → `default` |
| Selection | First available from priority (Composer ids probed via `agent models`) |
| Settings | Preferred model dropdown (default: `composer-2.5-fast`) |
| Prompt | Direct file open, no Grep/Glob; stop after one Edit; screenshot skipped for explicit class/color feedback |
| Claude tuning | `maxTurns: 8`, tools: Read + Edit only |
| Observability | Server logs per attempt; `done` includes `modelUsed`, `durationMs`; UI shows brief success summary |

Plugin options: `comments({ cursorAgentPath?, fixModelPriority? })`.

## Still out of scope

- Cursor SDK strategy (stub only)
- Non-agent “quick fix” fast path for trivial className edits
- `fixDebug` plugin flag

## Architecture

```
CommentBubble Fix
  → POST /api/iterations/new { id, model }
  → buildFixModelChain(preferred, priority)
  → runFix: walk chain (probe Composer availability)
  → snapshot v{N}.tsx (unchanged)
  → done { modelUsed, durationMs, turnsUsed, toolCalls }
```

## Tests

- `src/fix/models.test.ts`
- `src/fix/fallback.test.ts`
- `src/fix/index.test.ts`
- `src/fix/prompt.test.ts`
- `src/fix/progress/cursor-cli.test.ts`

---

*Last updated: 2026-05-30*
