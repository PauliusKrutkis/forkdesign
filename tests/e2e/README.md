# Browser E2E tests (Playwright)

These tests drive a **real browser** against a **real Vite dev server** running
the fixture playground with the `forkdesign` plugin enabled. They cover only the
interactions that cannot be exercised headless: real DOM pointer events, the
element picker, comment-pin / bubble placement geometry, the overlay chrome, and
the iteration/version thumbnail UI.

Everything that is pure logic (placement math, parsing/writing `@comment`
markers, transcript building, mutations) is already covered by the unit tests
colocated under `src/**` (e.g. `lib/placement.test.ts`,
`src/server/comments/*.test.ts`). Do not duplicate that here.

## Hard rule: the REAL agent is NEVER invoked

The real Claude/Cursor strategies must not run in e2e — but the iteration UI
(progress streaming, the version switcher, cancellation) is still exercised
through a **deterministic stub**. Concretely:

- The dev server boots with `FORKDESIGN_E2E_STUB=1` (set in
  `playwright.config.ts`'s `webServer.env`). `runAgent` reads this at the top and
  short-circuits to `src/server/agent/strategies/stub.ts`, which makes a small,
  deterministic edit to the comment's target file instead of calling a real
  strategy (and skips the Cursor-CLI probe, which has no binary in CI).
- Agent-mode flows (`POST /api/iterations/new`) ARE allowed in e2e **because** of
  the stub. The stub appends `// forkdesign-stub variant N: …`, so the normal
  pipeline produces real versions; a multi-variant batch yields v1..vN.
- Slow/cancellable runs: an instruction containing `[[slow]]` makes the stub wait
  (abortably) before editing — used by the cancellation spec.
- Comment-only flows still use **"comment" mode** (flip the mode toggle), and
  `comment-thread.test.ts` reads **pre-seeded fixtures** via
  `GET /api/iterations?id=...`.
- Activating a different version (`POST /api/iterations/activate`) is a plain
  file write, not an agent run.

Locally, `reuseExistingServer` is on: stop any stale playground dev server before
running so the suite boots a fresh one with `FORKDESIGN_E2E_STUB=1`.

The shared composer-drive steps live in `helpers.ts`
(`placeComment`, `runAgentOnTarget`, …) so specs read as scenarios.

## Files

| File | Scenario |
| --- | --- |
| `overlay-smoke.test.ts` | Overlay/dock mounts in dev and toggles enabled/paused; composer toggles. |
| `create-comment.test.ts` | Activate composer → pick element → place panel → type → submit (comment mode) → assert dot/bubble + source marker; viewport-edge placement matrix. |
| `comment-thread.test.ts` | Open a pre-seeded comment → browse variant grid → thumbnail loading state → switch live version → lightbox. |
| `multi-comment-flow.test.ts` | Multi-component pins; a stubbed agent run isolated to one file; a multi-variant batch + version switching; cancelling an in-flight run. Uses the stub agent. |

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
- Dock: `[data-dock="true"]`; pill `button[aria-label="forkdesign comments"]`;
  menu `[role="menu"][aria-label="forkdesign actions"]` with menuitems "Add comment",
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
  decodes; `PendingVariantThumbnail` ("New version ready") for
  `screenshotPending` versions.
- Lightbox: `[aria-label="Version screenshot"]`, close via
  `[aria-label="Close screenshot"]`; `document.body[data-lightbox="open"]`.

## Running

```bash
pnpm test:e2e
```

The runner is configured in the repo-root `playwright.config.ts` (serial,
single Chromium project, `globalSetup` builds `dist/styles.css`, `webServer`
boots the playground Vite dev server with `FORKDESIGN_E2E_STUB=1`). Override the
port/origin with `E2E_PORT` / `E2E_BASE_URL` if 5179 is taken.
