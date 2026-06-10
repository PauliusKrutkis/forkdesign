/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TIER 1 — DETERMINISTIC e2e (real browser + real server, agent STUBBED)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Browser-level coverage of the multi-comment / multi-component / multi-variant
 * UI states that are tedious to verify by hand. The agent is stubbed at the
 * server boundary (same hard rule as the rest of the suite — see
 * tests/README.md: the real agent is NEVER called in CI).
 *
 * Source-mutation cleanup: like create-comment.test.ts, these specs write
 * markers into the on-disk fixture files. Snapshot every fixture file they
 * touch in beforeAll and restore in afterEach. Run serially (playwright.config
 * already forces workers: 1).
 *
 * PREREQUISITES (block every test below):
 * TODO(tier1): mount <SiteNav> and <Pricing> in
 *   tests/fixtures/playground/src/App.tsx (keep existing title/card/cta).
 * TODO(e2e-stub): the e2e layer needs a way to stub `runAgent` for the dev
 *   server that playwright.config boots. Decide the seam and document it:
 *     option A — an env flag (e.g. DESIGN_CRIT_E2E_STUB=1) read in
 *       src/server/agent/index.ts that swaps in a deterministic variant writer;
 *     option B — a dev-only stub strategy registered in resolveAgentStrategy.
 *   Wire the chosen flag into playwright.config webServer.command.
 * TODO(e2e-helpers): factor the composer-drive steps (activate → pick element →
 *   freeze → type → submit, in agent vs comment mode) into a helper module so
 *   these specs read as scenarios, not click sequences.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// biome-ignore-all lint/suspicious/noSkippedTests: scaffolding — these fixme specs are intentionally pending until the Tier 1 fixture + e2e stub seam land
import { test } from "@playwright/test";

test.describe("multi-comment flow", () => {
  test.fixme("place comments on three different components and see three distinct pins", async () => {
    // TODO: comment App.title, SiteNav.cta, Pricing.pro-cta; assert 3 pins,
    // each bubble shows its own text, and each writes a marker into the
    // correct source file (App.tsx vs components/SiteNav.tsx vs Pricing.tsx).
  });

  test.fixme("running an agent iteration on one comment updates only that pin's variant", async () => {
    // TODO: in agent mode, submit on the Pricing comment; assert progress
    // streams, the variant overlay shows the new version for THAT pin only,
    // and the other two pins are visually unchanged.
  });

  test.fixme("a multi-variant batch surfaces a version switcher and switching updates the preview", async () => {
    // TODO: stub a count>1 batch; assert the bubble exposes v1..vN, switching
    // versions swaps the rendered preview + screenshot, and activating one
    // persists active=N to source (poll the file / /api/comments).
  });

  test.fixme("cancelling an in-flight agent run returns the overlay to the pre-run state", async () => {
    // TODO: start a run with a stub that delays, hit cancel; assert the pin
    // returns to its prior version, no stale "running" status sticks, and the
    // source file is unchanged (mirrors the Tier 1 integration cancellation
    // test, but at the UI layer).
  });
});
