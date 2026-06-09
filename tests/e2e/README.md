# Browser E2E tests (Playwright)

These tests drive a **real browser** against a **real Vite dev server** running
the fixture playground with the `design-crit` plugin enabled. They cover only the
interactions that cannot be exercised headless: real DOM pointer events, the
element picker, comment-pin / bubble placement geometry, the overlay chrome, and
the iteration/version thumbnail UI.

Everything that is pure logic (placement math, parsing/writing `@comment`
markers, transcript building, mutations) is already covered by the unit tests
colocated under `src/**` (e.g. `lib/placement.test.ts`,
`src/server/comments/*.test.ts`). Do not duplicate that here.

## Hard rule: the real agent is NEVER invoked

The Claude agent must not run in e2e. Concretely:

- Never `POST /api/iterations/new` (the live-iterate stream).
- Create comments in **"comment" mode**, not "agent" mode (the composer defaults
  to "agent", so tests must flip the mode toggle, or stub `/api/iterations/*`).
- Iteration/version results in `comment-thread.test.ts` are **pre-seeded
  fixtures** on disk, served by the dev server via `GET /api/iterations?id=...`.
- Activating a different version (`POST /api/iterations/activate`) is a plain
  file write, not an agent run, and is allowed.

## Files

| File | Scenario |
| --- | --- |
| `overlay-smoke.test.ts` | Overlay/dock mounts in dev and toggles enabled/paused; composer toggles. |
| `create-comment.test.ts` | Activate composer → pick element → place panel → type → submit (comment mode) → assert dot/bubble + source marker; viewport-edge placement matrix. |
| `comment-thread.test.ts` | Open a pre-seeded comment → browse variant grid → thumbnail loading state → switch live version → lightbox. |

All tests are currently `test.fixme(...)` skeletons with detailed TODOs; they are
structurally valid but unimplemented.

## Source-mutation cleanup

Submitting a comment writes `data-comment-anchor` + a `{/* @comment ... *\/}`
marker into the fixture `.tsx` on disk, and activating a version rewrites source
too. Tests MUST leave the playground pristine — e.g. `git checkout` the touched
fixture files in `afterEach`, delete created comments via
`DELETE /api/comments/:id`, or run each test against a per-test temp copy of the
playground source. Otherwise the suite is not idempotent.

## Real DOM hooks used by the tests

(Pulled from `src/client/overlay/**`; keep these in sync if the overlay changes.)

- Overlay root: `[data-overlay-root="true"]` (all overlay chrome also
  carries `[data-comment-overlay="true"]`, used by `isOverlayElement`).
- Dock: `[data-dock="true"]`; pill `button[aria-label="design-crit comments"]`;
  menu `[role="menu"][aria-label="design-crit actions"]` with menuitems "Add comment",
  "Comments", "Settings"; review switch `input#review-toggle`.
- Comment pin (CommentDot): `button[aria-label*="comment"]`, fixed `z-[9100]`.
- Composer panel: fixed `z-[9300]`, "New comment" header; picker chip `z-[9310]`.
- Bubble header buttons by `aria-label`: "Close", "Resolve"/"Resolved",
  "Delete comment", "Dock panel to edge"/"Float panel", "Move back to anchor".
- VariantCard: activate `button[aria-label="Use <label>"]` ("Original" for v0),
  expand `button[aria-label="View screenshot fullscreen"]`, delete
  `button[aria-label="Delete version"]`; active card shows a "Live" badge +
  `border-primary ring-primary`.
- Thumbnail loading: `.shimmer` skeleton overlay while the `<img>`
  decodes; `PendingVariantThumbnail` (spinner + "Capturing…") for
  `screenshotPending` versions.
- Lightbox: `[aria-label="Version screenshot"]`, close via
  `[aria-label="Close screenshot"]`; `document.body[data-lightbox="open"]`.

## TODO — `playwright.config.ts` (NOT in this directory; owned by another agent)

This directory intentionally contains **no** `playwright.config.ts`. The config
and the `package.json` test scripts are owned by the **config/CI agent**. That
config must define at least:

- **`webServer`**: command that boots the fixture Vite playground
  (`tests/fixtures/playground/`, created by another agent) in **dev** with the
  design-crit plugin active (the overlay only mounts under `import.meta.env.DEV`).
  Set `reuseExistingServer: !process.env.CI`, a `url`/`port` matching `baseURL`,
  and a generous `timeout` for cold Vite starts.
- **`use.baseURL`**: the dev server origin (e.g. `http://localhost:<port>`), so
  tests can `page.goto("/")`.
- **`testDir`**: this `tests/e2e` directory (and a `*.test.ts` / `*.spec.ts`
  `testMatch`).
- **`use.headless`**: `true` in CI (`!!process.env.CI`); headed locally is fine.
- **`retries`**: `> 0` on CI (e.g. `2`), `0` locally.
- **`use.trace`**: `"on-first-retry"` (or `"retain-on-failure"`) plus
  screenshot/video `"on-failure"` for debuggable CI artifacts.
- A single Chromium project is sufficient; add Firefox/WebKit only if needed.
- `forbidOnly: !!process.env.CI` to keep stray `test.only` out of CI.

`@playwright/test` is not yet installed; the config/CI agent adds the dependency
and the `test:e2e` script.
