/**
 * Refresh-behavior e2e (PR #30 follow-ups).
 *
 * Agent-driven source writes (creating a comment in Agent mode; applying the
 * winner when a run finishes) must land as in-place React Fast Refresh updates,
 * NOT full page reloads. A full reload wipes the overlay's own React root — the
 * open bubble, the in-flight run UI — which is exactly the "disruptive refresh"
 * these specs guard against.
 *
 * How we tell the difference: a full reload re-executes the document, so it
 * fires a fresh `load` event AND wipes any property we set on `window`. React
 * Fast Refresh does neither. A window sentinel + a load counter therefore
 * distinguish "updated in place" from "reloaded" with no timing guesswork.
 *
 * Runs against the GATED scripted agent (dev server booted with
 * `FORKDESIGN_E2E_SCRIPTED=1`; see playwright.scripted.config.ts), reusing the
 * same RepeatedCard fixture + source-revert cleanup as
 * iteration-screenshots.test.ts.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  advanceAgentVariant,
  awaitVariantInProgress,
  fetchComments,
  placeComment,
  resetScriptedGates,
  runGatedAgentOnTarget,
} from "./helpers.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYGROUND = path.resolve(HERE, "../fixtures/playground");
const APP_TSX = path.join(PLAYGROUND, "src/App.tsx");
const REPEATED_CARD_TSX = path.join(
  PLAYGROUND,
  "src/components/RepeatedCard.tsx"
);
const ITER_ROOT = path.join(PLAYGROUND, "designs/iterations");

const SENTINEL_KEY = "__forkdesignNoReload__";

/** Mirrors the overlay's sessionStorage key for the create open/run intent. */
const PENDING_SUBMIT_KEY = "redline:pending-submit-comment";

let originalApp = "";
let originalCard = "";

/** Poll the server until the comment with `text` is persisted, returning its id. */
async function commentIdByText(page: Page, text: string): Promise<string> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const comments = await fetchComments(page);
    const found = comments.find((c) => c.text === text);
    if (found) {
      return found.id;
    }
    await page.waitForTimeout(125);
  }
  throw new Error(`comment "${text}" was never persisted`);
}

/** The middle ("Beta") instance of the repeated card — the comment target. */
function middleCard(page: Page): Locator {
  return page.getByTestId("repeated-card").nth(1);
}

/**
 * Mark the live document and start counting load events, then return an
 * asserter that fails if a full reload happened in between: the window mark is
 * wiped and a new `load` fires only on a real navigation, never on Fast Refresh.
 */
async function watchForReload(page: Page): Promise<() => Promise<void>> {
  let loadCount = 0;
  page.on("load", () => {
    loadCount += 1;
  });
  await page.evaluate((key) => {
    (window as unknown as Record<string, boolean>)[key] = true;
  }, SENTINEL_KEY);

  return async () => {
    const survived = await page.evaluate(
      (key) => (window as unknown as Record<string, boolean>)[key] === true,
      SENTINEL_KEY
    );
    expect(survived, "overlay was wiped by a full page reload").toBe(true);
    expect(loadCount, "page fired a full-reload load event").toBe(0);
  };
}

test.describe("refresh behavior — agent source writes stay in-place", () => {
  test.beforeAll(async () => {
    originalApp = await readFile(APP_TSX, "utf8");
    originalCard = await readFile(REPEATED_CARD_TSX, "utf8");
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto("/");
    // Confirm the fixture is at its clean baseline before acting — the previous
    // spec's source revert triggers HMR, and racing it would corrupt the next
    // comment's source write.
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design baseline",
      { timeout: 30_000 }
    );
  });

  test.afterEach(async ({ page }) => {
    await resetScriptedGates(page).catch(() => {
      /* server may be gone */
    });
    await page.goto("about:blank").catch(() => {
      /* page may be closing */
    });
    // Let any trailing server-side source write land before reverting, so the
    // revert is authoritative (mirrors iteration-screenshots.test.ts).
    await page.waitForTimeout(800);
    await writeFile(APP_TSX, originalApp, "utf8");
    await writeFile(REPEATED_CARD_TSX, originalCard, "utf8");
    await rm(ITER_ROOT, { recursive: true, force: true });
  });

  test("creating a comment in Agent mode opens its bubble without a full reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const assertNoReload = await watchForReload(page);

    // Agent mode is the composer default. This writes the comment marker into
    // source (RepeatedCard.tsx) and starts the gated run; the new comment's
    // bubble should auto-open in place rather than the page reloading.
    await runGatedAgentOnTarget(page, middleCard(page), "restyle");

    await expect(
      page.getByRole("button", { name: "Stop agent" })
    ).toBeVisible();
    // The reload (if any) happens on the comment-creation source write, which
    // has already landed by the time the run is in flight.
    await assertNoReload();
  });

  test("finishing an agent run updates the live preview without a full reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const assertNoReload = await watchForReload(page);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle");
    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);

    // The run applies the winning variant to live source; the preview should
    // update in place (scripted agent rewrites the sentinel text)...
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 60_000 }
    );
    // ...and the run should be finished, back to the version switcher.
    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });

    await assertNoReload();
  });

  // Locks in the cross-reload safety net: on host projects that answer the
  // comment's source write with a FULL page reload (not Fast Refresh), React
  // state is wiped, so the open/run intent is persisted to sessionStorage and
  // restored on the next mount. We can't force a real full reload in this
  // Fast-Refresh-friendly fixture, so we inject the persisted intent and reload
  // to exercise the exact restore path the overlay runs after such a reload.
  test("a full reload mid-create still restores the bubble + agent run from storage", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // A plain comment lands in source (no run yet); capture its stable id.
    const text = await placeComment(page, "cta", "restore across reload");
    const id = await commentIdByText(page, text);

    // Stand in for the wiped React state: seed the same intent the overlay
    // persists at submit, then reload so the fresh mount must restore it.
    await page.evaluate(
      ({ key, value }) => window.sessionStorage.setItem(key, value),
      {
        key: PENDING_SUBMIT_KEY,
        value: JSON.stringify({
          id,
          agent: { count: 1, model: "composer-2.5-fast" },
        }),
      }
    );
    await page.reload();

    // With no further user action, the remounted overlay reopens the comment's
    // bubble AND fires the agent run — "Stop agent" proves both happened.
    await expect(page.getByRole("button", { name: "Stop agent" })).toBeVisible({
      timeout: 30_000,
    });

    // The one-shot intent is consumed, so a later mount can't replay it.
    await expect
      .poll(
        () =>
          page.evaluate(
            (key) => window.sessionStorage.getItem(key),
            PENDING_SUBMIT_KEY
          ),
        { timeout: 10_000 }
      )
      .toBeNull();
  });
});
