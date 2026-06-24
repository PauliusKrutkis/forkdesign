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
    // Confirm the fixture is at its clean baseline before acting — the previous
    // spec's source revert triggers HMR, and racing it would corrupt the next
    // comment's source write.
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design baseline",
      { timeout: 30_000 }
    );
  });

  test.afterEach(async ({ page }) => {
    // Cancel the run and clear gates so nothing is left parked...
    await resetScriptedGates(page).catch(() => {
      /* server may be gone */
    });
    // ...then unmount the overlay so it issues no new capture/activate calls...
    await page.goto("about:blank").catch(() => {
      /* page may be closing */
    });
    // ...and let any in-flight server-side source write (a trailing post-run
    // capture activate) land BEFORE we revert, so the revert is authoritative.
    // Without this the late write resurrects the last variant into the next
    // spec's source. No observable signal to await, so a short settle.
    await page.waitForTimeout(800);
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

    // Default with no manual pick: the run lands on the newest variant.
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 3",
      { timeout: 30_000 }
    );
  });

  test("no version reads as Live while the agent is running", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    // v1 done; hold v2 in progress.
    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);

    // The run is still going and the live source is back at baseline for v2's
    // generation — so the picker must NOT claim any version is "Live" (the old
    // bug showed a stale "vN Live" while the original was on screen).
    await expect(
      page.getByRole("button", { name: "Stop agent" })
    ).toBeVisible();
    await expect(page.getByText("Live", { exact: true })).toHaveCount(0);

    // Finish; now a version is genuinely live again.
    await advanceAgentVariant(page, id);
    await expect(page.getByText("Live", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
  });

  test("a mid-run switch is queued (not applied live) and applied when the run finishes", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    // Finish v1, then hold v2 in progress (source reset to baseline for v2).
    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);

    const liveCard = page.getByTestId("repeated-card-design").first();
    // During v2 generation the live page is the baseline, not v1.
    await expect(liveCard).toHaveText("Design baseline", { timeout: 30_000 });

    // Pick the finished v1 (stored v1 → "Use v2") mid-run. Pre-fix this either
    // 409'd or briefly applied then reverted. Now it's QUEUED: shown as such,
    // and the live page is NOT changed while the agent still owns the source.
    await page.getByRole("button", { name: "Use v2" }).click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await expect(liveCard).toHaveText("Design baseline");

    // Once the run finishes the queued pick is applied — lands on v1, not the
    // newest (v2).
    await advanceAgentVariant(page, id);
    await expect(liveCard).toHaveText("Design variant 1", { timeout: 30_000 });
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
