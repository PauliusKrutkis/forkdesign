# Architecture & folder layout

Guidance for organizing the redline codebase: predictable paths, clear runtime boundaries, and scanability for humans and AI agents.

## Runtime boundaries

Redline ships two public entry points (see `package.json` exports):

| Entry | Import | Runtime | Role |
|-------|--------|---------|------|
| Client | `redline` | Browser | React overlay UI |
| Server | `redline/plugin` | Node (Vite dev) | Vite plugins + dev API middleware |

**Critical constraint:** the browser module graph must never import Node builtins, `recast`, or `@babel/*`. The split in `src/index.ts` vs `src/plugin/index.ts` exists for this reason. Folder layout should make the boundary obvious at a glance.

## Current layout

Migration complete (2026-05-31). Public entries unchanged; internals follow the target structure below.

```
src/
├── index.ts                      # client public entry
├── plugin/index.ts               # server public entry
├── client/                       # browser-only (overlay, ui, settings, types)
├── server/                       # node-only (plugins, api, comments, iterations, fix, platform)
├── shared/fix-model.ts           # cross-runtime contract
└── styles.css
```

## Previous layout (pre-migration problems)

```
src/
├── index.ts, plugin/index.ts     # public entries
├── plugin.ts                     # ~1950 lines — monolith
├── babel-comment-reader.ts       # root sprawl
├── babel-comment-writer.ts
├── source-loc-plugin.ts
├── iterations-manifest.ts
├── components/                   # UI + hooks + utils + types (flat)
├── fix/                          # ✓ well-structured domain module
└── lib/utils.ts
```

| Issue | Impact |
|-------|--------|
| `plugin.ts` monolith | Hard to scan; mixes HTTP handlers, parsing, path safety, I/O |
| Flat `components/` | UI, hooks, geometry, settings, types share one directory |
| `plugin.ts` vs `plugin/index.ts` | Confusing: real code at root, entry in subfolder |
| Root-level server files | No grouping by domain |
| `components/settings.ts` → `fix/models.ts` | Client imports server-side fix module (boundary leak) |
| `lib/utils.ts` at repo root | UI-only `cn()` helper looks like a global junk drawer |

**Reference:** `src/server/fix/` follows the original `src/fix/` template — types, config, strategies, colocated tests, single public surface via `fix/index.ts`.

## Design principle: domain modules, not generic buckets

Avoid a top-level tree like `models/`, `services/`, `tests/` for the whole repo. At ~80 files, generic folders hide intent (“Is `iterations-manifest` a model or a service?”).

**Rule:** folder name = bounded context / feature. Inside each domain, use predictable subfolders by kind (`hooks/`, `lib/`, `ui/`, `strategies/`, etc.).

### Avoiding junk drawers (`helpers/`, `shared/`, `lib/`)

Top-level `helpers/`, `utils/`, `common/`, or a repo-wide `lib/` become catch-alls — anything that doesn’t fit ends up there and the name stops meaning anything.

**Do not create repo-root buckets for miscellaneous code.** Helpers live *inside* the domain that owns them.

| Location | Allowed contents | Not allowed |
|----------|------------------|-------------|
| `*/lib/` (inside a domain, e.g. `client/overlay/lib/`) | Pure functions used only within that domain | Cross-domain dumping ground |
| `server/platform/` | Server-only cross-cutting infra: HTTP helpers, path safety, atomic I/O | Feature or domain logic |
| `shared/` | Types/constants imported by **both** client and server, with **no** Node or React deps | “Used in two places on the same runtime”, business logic, growing file count |
| `client/ui/cn.ts` | Tailwind/className merge for UI primitives | General client utilities |

**Admission test** — before adding a file, ask:

1. Used only inside one feature? → that feature’s folder (or `feature/lib/`).
2. Server-only HTTP/path/I/O plumbing? → `server/platform/`.
3. Truly cross-runtime type or constant (client **and** server)? → `shared/` (expect very few files).
4. Used by two domains on the **same** runtime? → pick an **owner** domain; consumers import from there — do **not** add to `shared/`.

If `shared/` grows beyond a handful of contract files, something is wrong — revisit ownership instead of expanding the folder.

## Target structure

```text
src/
├── index.ts                      # client public entry
├── plugin/
│   └── index.ts                  # server public entry
│
├── client/                       # browser-only
│   ├── overlay/                  # comment overlay feature
│   │   ├── *.tsx                 # CommentOverlay, CommentBubble, …
│   │   ├── hooks/
│   │   │   ├── useAnchorElement.ts
│   │   │   └── useIterations.ts
│   │   └── lib/                  # overlay-specific non-React helpers
│   │       ├── placement.ts
│   │       ├── sourceLoc.ts
│   │       └── screenshot.ts
│   ├── settings.ts
│   ├── types.ts
│   └── ui/                       # shadcn-style primitives
│       └── cn.ts                 # className merge (clsx + tailwind-merge)
│
├── server/                       # node-only
│   ├── plugins/
│   │   ├── comments.ts           # thin `comments()` factory
│   │   └── source-loc.ts
│   ├── api/
│   │   ├── comments/
│   │   │   ├── routes.ts
│   │   │   └── parse-body.ts
│   │   └── iterations/
│   │       ├── routes.ts
│   │       └── parse-body.ts
│   ├── comments/                 # AST read/write
│   │   ├── reader.ts
│   │   ├── writer.ts
│   │   └── find-comment.ts
│   ├── iterations/
│   │   └── manifest.ts
│   ├── fix/                      # existing module (move here)
│   └── platform/                 # server cross-cutting infra (not feature logic)
│       ├── path-safety.ts
│       ├── http.ts
│       └── atomic-write.ts
│
├── shared/                       # cross-runtime contracts only (strict gate — see above)
│   └── fix-model.ts              # FixModel type + VALID_FIX_MODELS
│
└── styles.css
```

### Path → meaning

| Path prefix | Meaning |
|-------------|---------|
| `client/` | Browser code only |
| `server/` | Node / Vite plugin code only |
| `shared/` | Cross-runtime contracts only (types/constants; no Node/React; tiny) |
| `*/hooks/` | React hooks |
| `*/lib/` | Domain-scoped pure helpers (no components; not repo-wide) |
| `*/ui/` | Presentational primitives |
| `server/platform/` | Server infra shared across API/plugins (HTTP, paths, I/O) |
| `server/api/` | HTTP middleware handlers |
| `server/fix/strategies/` | AI fix backends |

### Where “models / services / tests” go

| Concept | Location |
|---------|----------|
| Models (types) | Per domain: `client/types.ts`, `server/fix/types.ts`, `shared/fix-model.ts` |
| Services | Server domain modules: `server/comments/`, `server/iterations/`, `server/fix/` |
| UI | `client/ui/` and `client/overlay/*.tsx` |
| Tests | Colocated `*.test.ts` next to implementation (same as `fix/` today) |

## Migration plan (completed)

Delivered incrementally in seven PRs. Public exports (`redline`, `redline/plugin`) stayed stable throughout.

| Phase | Status | Outcome |
|-------|--------|---------|
| 1 — `shared/fix-model.ts` | Done | Client settings import cross-runtime contract, not `server/fix/` |
| 2 — Group server files | Done | `server/comments/`, `server/iterations/`, `server/fix/`, `server/plugins/` |
| 3 — `server/platform/` | Done | HTTP, path safety, atomic I/O extracted from monolith |
| 4 — Comments API | Done | `server/api/comments/` + `server/comments/find-comment.ts` |
| 5 — Iterations API + thin plugin | Done | `server/api/iterations/`, `server/plugins/comments.ts`; root `plugin.ts` removed |
| 6 — Client restructure | Done | `client/overlay/`, `client/ui/cn.ts`, `client/settings.ts`, `client/types.ts` |
| 7 — Tooling & docs | Done | `knip.jsonc`, `tailwind.content.js`, README, this doc |

### Original phase notes (reference)

Extract from `plugin.ts` into:

- `server/api/comments/` — GET/POST/PATCH/DELETE handlers
- `server/api/iterations/` — list, activate, new, screenshot
- `server/platform/` — `readJsonBody`, `sendError`, atomic writes, path safety
- `server/comments/find-comment.ts` — `findCommentById`, `collectAllowedTsxFiles`

Leave `server/plugins/comments.ts` as thin wiring (~100 lines).

### Phase 2 — Group root-level server files

| From | To |
|------|-----|
| `babel-comment-reader.ts` | `server/comments/reader.ts` |
| `babel-comment-writer.ts` | `server/comments/writer.ts` |
| `iterations-manifest.ts` | `server/iterations/manifest.ts` |
| `source-loc-plugin.ts` | `server/plugins/source-loc.ts` |

### Phase 3 — Restructure client

Move `components/*` → `client/overlay/` (+ `hooks/`, `lib/` subfolders). Move `lib/utils.ts` → `client/ui/cn.ts`. Update `src/index.ts` re-exports only.

### Phase 4 — Fix boundary leaks

Move `FixModel` and `VALID_FIX_MODELS` to `shared/fix-model.ts`. Client `settings.ts` imports from `shared/`, not `server/fix/`.

### Phase 5 — Document & enforce

- Keep this doc updated as phases land
- Optional: `tsconfig` path aliases (`@client/*`, `@server/*`, `@shared/*`) — not added; relative imports used instead

## Migration plan (archive — phase detail)

## Conventions

### Naming

- React components: `PascalCase.tsx`
- Hooks: `use*.ts` in `hooks/`
- Pure helpers: `camelCase.ts` in the owning domain’s `lib/` (never repo-root `helpers/` or `utils/`)
- `client/ui/`: kebab-case filenames (shadcn primitives, e.g. `button.tsx`)
- `client/overlay/`: PascalCase for feature components (e.g. `CommentBubble.tsx`)

### File size

Target ~300 lines max per file. Current outliers: `plugin.ts`, `babel-comment-writer.ts`.

### Public vs internal

- **Public API:** `src/index.ts`, `src/plugin/index.ts` only
- Domain folders may use a local `index.ts` for internal grouping; avoid deep barrel re-export chains

### Tests

One convention: colocated `*.test.ts` beside source (matches `fix/` and most of the repo).

## What not to do

- **Repo-root junk drawers** (`helpers/`, `utils/`, `common/`, top-level `lib/`) — put code in the owning domain instead
- **Expanding `shared/`** for same-runtime reuse — pick a domain owner and import from there
- **Pure type-based top-level tree** (`models/`, `services/`, `controllers/`) — wrong fit for a library this size
- **Central `tests/` mirror** — doubles maintenance; harder to discover impl + spec together
- **Rename package exports** — keep `redline` and `redline/plugin`
- **Over-nest** — stay at 2–3 directory levels inside a domain

## Domain map (logical)

```mermaid
flowchart TB
  subgraph client [client/]
    Overlay[overlay/]
    UI[ui/]
  end

  subgraph server [server/]
    Plugins[plugins/]
    API[api/]
    Comments[comments/]
    Iterations[iterations/]
    Fix[fix/]
  end

  subgraph shared [shared/]
    FixModel[fix-model.ts]
  end

  Overlay -->|fetch| API
  API --> Comments
  API --> Iterations
  API --> Fix
  Overlay --> FixModel
  Fix --> FixModel
  Plugins --> API
```

## Related docs

- [Fix performance & observability](./fix-performance-and-observability.md) — fix pipeline behavior and tests

---

*Last updated: 2026-05-31 (migration complete)*
