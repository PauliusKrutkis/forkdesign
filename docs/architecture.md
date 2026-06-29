# Architecture & folder layout

Guidance for organizing the forkdesign codebase: predictable paths and clear runtime boundaries.

## Runtime boundaries

ForkDesign ships two public entry points (see `package.json` exports):

| Entry | Import | Runtime | Role |
|-------|--------|---------|------|
| Client | `forkdesign` | Browser | React overlay UI |
| Server | `forkdesign/plugin` | Node (Vite dev) | Vite plugins + dev API middleware |

**Critical constraint:** the browser module graph must never import Node builtins, `recast`, or `@babel/*`. The split in `src/index.ts` vs `src/plugin/index.ts` exists for this reason.

## Folder layout

```
src/
├── index.ts                      # client public entry
├── plugin/index.ts               # server public entry
├── client/                       # browser-only (overlay, ui, settings, types)
├── server/                       # node-only (plugins, api, comments, iterations, agent, platform)
├── shared/agent-model.ts         # cross-runtime contract
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
| `server/agent/strategies/` | AI agent backends |

### Where things go

| Concept | Location |
|---------|----------|
| Types | Per domain: `client/types.ts`, `server/agent/types.ts`, `shared/agent-model.ts` |
| Server logic | `server/comments/`, `server/iterations/`, `server/agent/` |
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
- Renaming package exports (`forkdesign`, `forkdesign/plugin`)

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
    Agent[agent/]
  end

  subgraph shared [shared/]
    AgentModel[agent-model.ts]
  end

  Overlay -->|fetch| API
  API --> Comments
  API --> Iterations
  API --> Agent
  Overlay --> AgentModel
  Agent --> AgentModel
  Plugins --> API
```

## Agent iteration workspace (Stage 2)

During a multi-variant agent run, edits happen in an isolated **agent workspace** under `.forkdesign/workspaces/<runId>/` — either a git worktree (when the host project is a git repo) or a temp copy with a `node_modules` symlink. The workspace is seeded from a pre-run snapshot of the live source tree so uncommitted markers and edits are preserved.

The variant loop never writes agent output to the live Vite tree. Snapshots land in `designs/iterations/<id>/` as before; live source changes only via:

- `POST /api/iterations/activate` (user preview or screenshot capture)
- successful batch finish (honors `visibleActive` from mid-run picks)
- cancel → restore pre-run baseline

This decoupling allows honest **Live** mid-run version switching: the user can preview any finished variant while the agent generates the next one in the workspace.
