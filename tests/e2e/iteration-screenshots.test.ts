/**
 * SCAFFOLDING — screenshot visibility/accuracy + mid-run switching e2e (PR #30).
 *
 * These are the tests the lock-based fix actually needs but that unit/route
 * tests can't provide: they assert what RENDERS and what's VISIBLE over time,
 * against a real page, while the agent is mid-run.
 *
 * Prerequisites (not done yet — see the referenced scaffolding):
 *   - Dev server booted with `FORKDESIGN_E2E_SCRIPTED=1` so the gated, visibly-
 *     distinct scripted agent runs (src/server/agent/strategies/scripted.ts).
 *     playwright.config.ts currently sets only FORKDESIGN_E2E_STUB=1 — add a
 *     second project (or env) for the scripted suite.
 *   - Gate control plane implemented (src/server/api/iterations/e2e-control.ts).
 *   - Helpers implemented (tests/e2e/helpers.ts: runGatedAgentOnTarget,
 *     awaitVariantInProgress, advanceAgentVariant).
 *   - RepeatedCard fixture wired into App (done).
 *
 * All cases are `test.fixme` until the harness above lands. Remove `.fixme`
 * one at a time as each piece is implemented.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  COMMENT_PIN_RE,
  // advanceAgentVariant,
  // awaitVariantInProgress,
  // runGatedAgentOnTarget,
} from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_TSX = path.resolve(HERE, "../fixtures/playground/src/App.tsx");
const REPEATED_CARD_TSX = path.resolve(
  HERE,
  "../fixtures/playground/src/components/RepeatedCard.tsx"
);

let originalApp = "";
let originalCard = "";

test.beforeAll(async () => {
  originalApp = await readFile(APP_TSX, "utf8");
  originalCard = await readFile(REPEATED_CARD_TSX, "utf8");
});

test.afterEach(async () => {
  // Revert source mutations (markers + scripted edits) so specs stay idempotent.
  await writeFile(APP_TSX, originalApp, "utf8");
  await writeFile(REPEATED_CARD_TSX, originalCard, "utf8");
  // TODO: also POST /api/iterations/__e2e__/reset to clear gates, and clean up
  // the comment's designs/iterations/<id>/ directory between specs.
});

test.describe("iteration screenshots + mid-run switching", () => {
  // biome-ignore lint/suspicious/noSkippedTests: scaffolding — un-fixme once the scripted-agent harness lands
  test.fixme("captures each variant's screenshot as it completes (not only at run end)", async ({
    page,
  }) => {
    await page.goto("/");
    // TODO:
    // 1. runGatedAgentOnTarget(page, "repeated-card-design", "restyle", { variantCount: 3 }).
    // 2. Resolve the comment id (fetchComments / pin aria-label).
    // 3. Loop n = 1..3:
    //    a. awaitVariantInProgress(page, id, n)         → variant n generating
    //    b. assert that variant's thumbnail shows the "Capturing…" spinner
    //       (comment-variant-group.tsx PendingVariantThumbnail).
    //    c. advanceAgentVariant(page, id)               → variant n completes
    //    d. assert BEFORE the whole run finishes that vN's thumbnail leaves
    //       the spinner and loads a real PNG: the <img> for vN has
    //       naturalWidth > 0 and src contains `v${n}.png`. THIS is the bug:
    //       today captures only land after the entire run.
    // 4. After the last advance, assert the run completed (Stop agent gone,
    //    "Use Original" + per-version buttons visible).
    expect(COMMENT_PIN_RE).toBeTruthy(); // placeholder so import is used
  });

  // biome-ignore lint/suspicious/noSkippedTests: scaffolding — un-fixme once the scripted-agent harness lands
  test.fixme("switching to a finished version mid-run renders that version (instance-accurate)", async ({
    page,
  }) => {
    await page.goto("/");
    // TODO:
    // 1. Comment on the MIDDLE RepeatedCard instance (index 1 — "Beta") and
    //    runGatedAgentOnTarget(..., { variantCount: 4 }).
    // 2. Advance variants 1 and 2 so they finish (screenshots captured).
    // 3. awaitVariantInProgress(page, id, 3) — hold variant 3 in progress.
    // 4. While variant 3 is gated, click "Use v1" in the switcher.
    //    - With the lock fix: the switch is accepted (no 409) and applies at
    //      the next safe boundary, NOT instantly mid-variant.
    // 5. advanceAgentVariant for v3 (and v4) to reach the boundary.
    // 6. Assert the live page's anchored element shows variant 1's distinct
    //    content (data-fd-variant="v1" / "Design variant 1") AND that it is
    //    the Beta instance that changed — query the index-1 repeated-card and
    //    check it, not index 0.
    // 7. Assert the run still completed cleanly and v3/v4 were not corrupted
    //    (their snapshots contain the expected variant markers).
    expect(page).toBeTruthy();
  });

  // biome-ignore lint/suspicious/noSkippedTests: scaffolding — un-fixme once the scripted-agent harness lands
  test.fixme("thumbnail PNG matches the version's rendered design (accuracy)", async ({
    page,
  }) => {
    await page.goto("/");
    // TODO:
    // 1. Run a 2-variant gated run; advance both to completion.
    // 2. For each version vN: activate it, assert the live anchored element
    //    shows variant N's sentinel, then assert the thumbnail <img> for vN
    //    is non-blank (naturalWidth/Height > 0) and distinct from v0's.
    // 3. Optionally compare the captured instance's label ("Beta") is present
    //    in the active render to prove the right copy was captured.
    // Pixel-diffing is intentionally avoided (flaky); assert structure +
    // distinctness instead.
    expect(page).toBeTruthy();
  });
});
