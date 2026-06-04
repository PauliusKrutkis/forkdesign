# Architecture & folder layout

Guidance for organizing the redline codebase: predictable paths and clear runtime boundaries.

## Runtime boundaries

Redline ships two public entry points (see `package.json` exports):

| Entry | Import | Runtime | Role |
|-------|--------|---------|------|
| Client | `redline` | Browser | React overlay UI |
| Server | `redline/plugin` | Node (Vite dev) | Vite plugins + dev API middleware |

**Critical constraint:** the browser module graph must never import Node builtins, `recast`, or `@babel/*`. The split in `src/index.ts` vs `src/plugin/index.ts` exists for this reason.

## Folder layout

```
src/
├── index.ts                      # client public entry
├── plugin/index.ts               # server public entry
├── client/                       # browser-only (overlay, ui, settings, types)
├── server/                       # node-only (plugins, api, comments, iterations, fix, platform)
├── shared/fix-model.ts           # cross-runtime contract
└── styles.css
```

### Path → meaning

| Path prefix | Meaning |
|-------------|---------|
| `client/` | Browser code only |
| `server/` | Node / Vite plugin code only |
| `shared/` | Cross-runtime contracts only (types/constants; no Node/React) |
| `*/hooks/` | React hooks |
| `*/lib/` | Domain-scoped pure helpers |
| `*/ui/` | Presentational primitives |
| `server/platform/` | Server infra (HTTP, paths, I/O) |
| `server/api/` | HTTP middleware handlers |
| `server/fix/strategies/` | AI fix backends |

### Where things go

| Concept | Location |
|---------|----------|
| Types | Per domain: `client/types.ts`, `server/fix/types.ts`, `shared/fix-model.ts` |
| Server logic | `server/comments/`, `server/iterations/`, `server/fix/` |
| UI | `client/ui/` and `client/overlay/` |
| Tests | Colocated `*.test.ts` next to implementation |

## Conventions

### Naming

- React components: `PascalCase.tsx`
- Hooks: `use*.ts` in `hooks/`
- Pure helpers: `camelCase.ts` in the owning domain's `lib/`
- `client/ui/`: kebab-case (shadcn primitives)
- `client/overlay/`: PascalCase feature components

### File size

Target ~300 lines max per file. Split when a module grows beyond that.

### Public vs internal

- **Public API:** `src/index.ts`, `src/plugin/index.ts` only
- Avoid deep barrel re-export chains inside domains

### Tests

Colocated `*.test.ts` beside source.

## What not to do

- Repo-root junk drawers (`helpers/`, `utils/`, `common/`, top-level `lib/`)
- Expanding `shared/` for same-runtime reuse — pick a domain owner instead
- Generic top-level trees (`models/`, `services/`, `controllers/`)
- Central `tests/` mirror
- Renaming package exports (`redline`, `redline/plugin`)

## Domain map

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
