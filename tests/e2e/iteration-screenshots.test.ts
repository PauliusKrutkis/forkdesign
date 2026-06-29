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
 * copies v0.png as each variant's placeholder. A real per-variant capture is
 * deferred until the user switches to that version (or the run applies it as
 * the live winner), at which point the bytes differ from v0.png.
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

  test("captures a variant screenshot when the user switches to it mid-run", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);

    // v1 stays on the v0-copy placeholder until the user previews it.
    const v0MidRun = await variantPng(id, 0);
    const v1MidRun = await variantPng(id, 1);
    expect(v0MidRun.equals(v1MidRun)).toBe(true);

    await page.getByRole("button", { name: "Use v2" }).click();
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 30_000 }
    );
    await waitForRealCapture(id, 1);

    await advanceAgentVariant(page, id);
    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });
  });

  test("a mid-run switch applies live immediately and stays through the rest of the run", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);

    const liveCard = page.getByTestId("repeated-card-design").first();
    await page.getByRole("button", { name: "Use v2" }).click();
    await expect(liveCard).toHaveText("Design variant 1", { timeout: 30_000 });
    await expect(page.getByText("Live", { exact: true })).toBeVisible();

    await advanceAgentVariant(page, id);
    await expect(liveCard).toHaveText("Design variant 1", { timeout: 30_000 });
  });

  test("run finish honors a mid-run live pick over the newest variant", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const id = await runGatedAgentOnTarget(page, middleCard(page), "restyle", {
      variantCount: 2,
    });

    await awaitVariantInProgress(page, id, 1);
    await advanceAgentVariant(page, id);
    await awaitVariantInProgress(page, id, 2);
    await page.getByRole("button", { name: "Use v2" }).click();
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 30_000 }
    );

    await advanceAgentVariant(page, id);
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 60_000 }
    );
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

    // The run finish applies the newest variant — capture lands without switching.
    const v0 = await variantPng(id, 0);
    const v2 = await waitForRealCapture(id, 2);

    // Preview v1 to capture its thumbnail too.
    await page.getByRole("button", { name: "Use v2" }).click();
    await expect(page.getByTestId("repeated-card-design").first()).toHaveText(
      "Design variant 1",
      { timeout: 30_000 }
    );
    const v1 = await waitForRealCapture(id, 1);

    expect(v0.equals(v1)).toBe(false);
    expect(v0.equals(v2)).toBe(false);
    expect(v1.equals(v2)).toBe(false);
  });
});
