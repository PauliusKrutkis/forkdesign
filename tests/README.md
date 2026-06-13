# Tests

`forkdesign` is tested in three layers, ordered from fastest/most-isolated to
slowest/most-integrated.

## 1. Unit — `src/**/*.test.ts` (existing)

Co-located with the modules they cover (e.g.
`src/server/comments/writer.test.ts`). Fast, in-process, no disk fixtures
beyond temp files. Run under the `happy-dom` environment configured in
`vitest.config.ts`.

```sh
pnpm test
```

## 2. Integration — `tests/integration/`

Server-flow round-trips against a **real on-disk temp project**. Each test
copies the `tests/fixtures/playground` tree into an OS temp dir via
`createTempProject` (`tests/helpers/temp-project.ts`), then drives the actual
server modules — comment writer/reader (`src/server/comments/*`), iteration
runner (`src/server/iterations/run-iteration.ts`), version activation
(`src/server/iterations/activate-version.ts`) — and asserts on the resulting
source and on the snapshot tree under `designs/`.

The Claude Agent SDK is **always stubbed** here via
`createStubAgent` (`tests/helpers/stub-agent.ts`): runs are deterministic,
offline, and produce canned source-backed variants. Tests clean up their temp
dirs in `afterEach`.

```sh
pnpm test:integration
```

> Note: these are Node-side tests (real `node:fs`), distinct from the
> `happy-dom` unit layer.

## 3. E2E — `tests/e2e/`

Playwright browser smoke tests for the in-page comment overlay: load the dev
plugin against a fixture app, open the overlay, place a comment, trigger an
iteration, and verify the UI reflects the new variant. Heaviest layer; run on
demand / in a dedicated CI job.

```sh
pnpm test:e2e
```

## Hard rule: the real agent is NEVER called in CI

No layer may invoke `@anthropic-ai/claude-agent-sdk` or the Cursor CLI for real.
Integration tests stub `runAgent` (or the SDK `query` seam); e2e tests stub the
agent at the server boundary the same way. CI must run with no agent
credentials available so an accidental real call fails fast rather than hitting
the network or spending tokens.

> Script names above (`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`)
> are placeholders wired up by the agent that owns `package.json`.
