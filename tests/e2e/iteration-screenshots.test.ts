/**
 * Screenshot visibility/accuracy + mid-run switching e2e (PR #30).
 *
 * Runs against the GATED scripted agent (dev server booted with
 * `FORKDESIGN_E2E_SCRIPTED=1` — see playwright.scripted.config.ts). Unlike the
 * plain stub, the scripted agent makes a VISIBLE per-variant edit and blocks
 * each variant at a barrier the test releases, so these specs can assert what
 * renders and what's visible *while the agent is mid-run* — the timing/DOM/
 * visual behaviour that unit/route tests can't see.
 *
 * Capture accuracy is asserted on the PNG BYTES on disk: on persist the server
 * copies v0.png as each variant's placeholder, so a version whose vN.png still
 * equals v0.png was NEVER really captured. A real per-variant capture makes the
 * bytes differ — that's the precise regression guard (the old stub rendered
 * every variant identically, so captures were indistinguishable).
 *
 * Targets the MIDDLE instance of the repeated RepeatedCard (index 1, "Beta").
 *
 * Display vs stored versions: the UI labels stored `v` as `v${v+1}`, so stored
 * v1 → "Use v2", v2 → "Use v3"; v0 → "Use Original".
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  advanceAgentVariant,
  awaitVariantInProgress,
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

let originalApp = "";
let originalCard = "";

/** The middle ("Beta") instance of the repeated card — the comment target. */
function middleCard(page: Page): Locator {
  return page.getByTestId("repeated-card").nth(1);
}

function variantPng(id: string, storedV: number): Promise<Buffer> {
  return readFile(path.join(ITER_ROOT, id, `v${storedV}.png`));
}

/**
 * Poll until stored version `v`'s PNG differs from v0's — i.e. a real capture
 * has replaced the v0-copy placeholder. Returns the captured bytes.
 */
async function waitForRealCapture(
  id: string,
  storedV: number
): Promise<Buffer> {
  await expect
    .poll(
      async () => {
        try {
          const [base, variant] = await Promise.all([
            variantPng(id, 0),
            variantPng(id, storedV),
          ]);
          return base.equals(variant) ? "placeholder" : "captured";
        } catch {
          return "missing";
        }
      },
      {
        timeout: 30_000,
        message: `v${storedV}.png never captured (still placeholder)`,
      }
    )
    .toBe("captured");
  return variantPng(id, storedV);
}

test.describe("iteration screenshots + mid-run switching", () => {
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
  });

  test.afterEach(async ({ page }) => {
    // Unblock any variant still parked at a gate so the run can unwind...
    await resetScriptedGates(page).catch(() => {
      /* server may be gone */
    });
    // ...then unmount the overlay before touching source, so its trailing
    // capture/activate calls don't race the revert (which would 404 once the
    // @comment marker is gone).
    await page.goto("about:blank").catch(() => {
      /* page may be closing */
    });
    await writeFile(APP_TSX, originalApp, "utf8");
    await writeFile(REPEATED_CARD_TSX, originalCard, "utf8");
    await rm(ITER_ROOT, { recursive: true, force: true });
  });

  test("captures each variant's real screenshot as it completes, not only at run end", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 3,
    });

    // Variant 1: let it generate, then wait until variant 2 starts — which only
    // happens after v1 is fully persisted AND its screenshot upload resolved.
    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);

    // The run is still going (parked at variant 2's gate)...
    await expect(
      page.getByRole("button", { name: "Stop agent" })
    ).toBeVisible();
    // ...yet v1 already has a REAL capture (its PNG differs from the v0-copy
    // placeholder). Pre-fix, captures only landed after the whole run ended.
    await waitForRealCapture(id, 1);

    // Drain the rest of the batch.
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 3);
    await advanceAgentVariant(page, id);

    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });
  });

  test("switching to a finished version mid-run lands at the boundary (no 409)", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 3,
    });

    // Finish variants 1 and 2.
    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);
    await advanceAgentVariant(page, id);

    // Hold the last variant in progress — the agent owns the source lock now.
    await awaitVariantInProgress(page, id, 3);

    // Switch to the first variant (stored v1 → "Use v2") WHILE v3 generates.
    // Pre-fix this returned 409 and the click silently reverted; now it's
    // accepted and applies at the next safe boundary.
    await page.getByRole("button", { name: "Use v2" }).click();

    // Release v3 so the run reaches the boundary and the queued switch applies.
    await advanceAgentVariant(page, id);

    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });

    // The live page settled on the chosen version (v1), not the last-generated
    // one — every RepeatedCard instance shares the source, so any renders it.
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 30_000 }
    );

    // v3 still generated cleanly (it exists as a switch card → "Use v4").
    await expect(page.getByRole("button", { name: "Use v4" })).toBeVisible();
  });

  test("each version's thumbnail captures a visually distinct render", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);
    await advanceAgentVariant(page, id);

    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });

    // Each variant's real capture differs from the v0 placeholder...
    const v0 = await variantPng(id, 0);
    const v1 = await waitForRealCapture(id, 1);
    const v2 = await waitForRealCapture(id, 2);

    // ...and the two variants differ from each other (distinct renders, not the
    // old "every variant looks identical" stub behaviour).
    expect(v0.equals(v1)).toBe(false);
    expect(v0.equals(v2)).toBe(false);
    expect(v1.equals(v2)).toBe(false);
  });
});
