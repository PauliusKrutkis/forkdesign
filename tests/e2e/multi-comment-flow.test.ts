/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TIER 1 — DETERMINISTIC e2e (real browser + real server, agent STUBBED)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Browser-level coverage of the multi-comment / multi-component / multi-variant
 * UI states that are tedious to verify by hand. The agent is stubbed at the
 * server boundary: the dev server boots with `FORKDESIGN_E2E_STUB=1` (see
 * playwright.config.ts), so `runAgent` short-circuits to a deterministic editor
 * (src/server/agent/strategies/stub.ts) instead of the real Claude/Cursor
 * strategies. The real agent is NEVER called in CI (see tests/e2e/README.md).
 *
 * The stub appends `// forkdesign-stub variant N: …` to the comment's target
 * file, so each agent run produces a real version through the normal pipeline
 * (diff → snapshot vN.tsx → manifest → active=N), and a multi-variant batch
 * produces v1..vN that differ by their marker.
 *
 * Display vs. stored version numbers: the UI labels stored version `v` as
 * `v${v+1}` (formatVersionDisplay), so the first agent variant (stored v1, stub
 * marker "variant 1") is the "Use v2" card; v0 is "Original".
 *
 * Source-mutation cleanup: these specs write markers into the on-disk fixture
 * files. We snapshot every fixture file they touch in beforeAll and restore in
 * afterEach. They run serially (playwright.config forces workers: 1).
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  COMMENT_PIN_RE,
  fetchComments,
  placeComment,
  runAgentOnTarget,
  STUB_MARKER,
  USE_VERSION_RE,
} from "./helpers.ts";

const FIXTURE_FILES = {
  app: fileURLToPath(
    new URL("../fixtures/playground/src/App.tsx", import.meta.url)
  ),
  nav: fileURLToPath(
    new URL(
      "../fixtures/playground/src/components/SiteNav.tsx",
      import.meta.url
    )
  ),
  pricing: fileURLToPath(
    new URL(
      "../fixtures/playground/src/components/Pricing.tsx",
      import.meta.url
    )
  ),
  // Shared component: a clicked <Button> anchors here. We never target it (specs
  // use file-local elements), but restore it too in case an anchor lands here.
  button: fileURLToPath(
    new URL("../fixtures/playground/src/components/Button.tsx", import.meta.url)
  ),
} as const;

const originalSource: Record<keyof typeof FIXTURE_FILES, string> = {
  app: "",
  nav: "",
  pricing: "",
  button: "",
};

test.describe("multi-comment flow", () => {
  test.beforeAll(async () => {
    for (const key of Object.keys(
      FIXTURE_FILES
    ) as (keyof typeof FIXTURE_FILES)[]) {
      originalSource[key] = await readFile(FIXTURE_FILES[key], "utf8");
    }
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

  test.afterEach(async () => {
    // Restore every fixture file the specs may have mutated on disk.
    for (const key of Object.keys(
      FIXTURE_FILES
    ) as (keyof typeof FIXTURE_FILES)[]) {
      await writeFile(FIXTURE_FILES[key], originalSource[key], "utf8");
    }
  });

  test("place comments on three different components and see three distinct pins", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // One comment each on App (<h1>), SiteNav (CTA) and Pricing (pro CTA).
    // Target elements DEFINED in each component's own file (not the shared
    // <Button>, which would anchor every comment to Button.tsx).
    const targets: Array<{
      testId: string;
      file: keyof typeof FIXTURE_FILES;
      text: string;
    }> = [
      { testId: "nav-brand", file: "nav", text: `nav comment ${Date.now()}` },
      { testId: "title", file: "app", text: `title comment ${Date.now()}` },
      {
        testId: "tier-pro-title",
        file: "pricing",
        text: `pricing comment ${Date.now()}`,
      },
    ];

    for (const target of targets) {
      await placeComment(page, target.testId, target.text);
      // Wait until the marker lands in that component's own source file.
      await expect
        .poll(async () => await readFile(FIXTURE_FILES[target.file], "utf8"), {
          timeout: 30_000,
        })
        .toContain("data-comment-anchor=");
      // Dismiss the auto-opened bubble so it can't overlap the next target.
      await page.keyboard.press("Escape");
    }

    // Three distinct pins, one per component.
    await expect(
      page.getByRole("button", { name: COMMENT_PIN_RE })
    ).toHaveCount(3, { timeout: 30_000 });

    // Each comment wrote into the correct file (and only that file).
    const navSource = await readFile(FIXTURE_FILES.nav, "utf8");
    const appSource = await readFile(FIXTURE_FILES.app, "utf8");
    const pricingSource = await readFile(FIXTURE_FILES.pricing, "utf8");
    expect(navSource).toContain("@comment");
    expect(appSource).toContain("@comment");
    expect(pricingSource).toContain("@comment");

    // The public API reports all three distinct comments.
    const comments = await fetchComments(page);
    for (const target of targets) {
      expect(comments.some((c) => c.text === target.text)).toBe(true);
    }
  });

  test("running an agent iteration on one comment updates only that pin's file", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await runAgentOnTarget(page, "tier-pro-title", "make the pro CTA pop");

    // The run completes: a version switcher surfaces ("Use Original" appears once
    // the agent variant is live) and the stub marker lands in Pricing.tsx.
    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => await readFile(FIXTURE_FILES.pricing, "utf8"), {
        timeout: 60_000,
      })
      .toContain(`${STUB_MARKER} variant 1`);

    // Isolation: the agent only touched the commented component's file.
    const appSource = await readFile(FIXTURE_FILES.app, "utf8");
    const navSource = await readFile(FIXTURE_FILES.nav, "utf8");
    expect(appSource).not.toContain(STUB_MARKER);
    expect(navSource).not.toContain(STUB_MARKER);
  });

  test("a multi-variant batch surfaces a version switcher and switching updates the source", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await runAgentOnTarget(page, "tier-pro-title", "try a few pro CTA styles", {
      variantCount: 3,
    });

    // The batch leaves the last variant (stored v3) live and exposes the others
    // as switcher cards. Display labels are stored-v + 1: v1→"Use v2", v2→"Use v3".
    await expect(page.getByRole("button", { name: "Use v2" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("button", { name: "Use v3" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Use Original" })
    ).toBeVisible();

    // Live source reflects the last variant after the batch.
    await expect
      .poll(async () => await readFile(FIXTURE_FILES.pricing, "utf8"), {
        timeout: 60_000,
      })
      .toContain(`${STUB_MARKER} variant 3`);

    // Switch to the first variant (stored v1, labelled "v2") and confirm the
    // live source swaps to that variant's marker.
    await page.getByRole("button", { name: "Use v2" }).click();
    await expect
      .poll(async () => await readFile(FIXTURE_FILES.pricing, "utf8"), {
        timeout: 60_000,
      })
      .toContain(`${STUB_MARKER} variant 1`);
    const pricingSource = await readFile(FIXTURE_FILES.pricing, "utf8");
    expect(pricingSource).not.toContain(`${STUB_MARKER} variant 3`);
  });

  test("cancelling an in-flight agent run returns the overlay to the pre-run state", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // `slow: true` makes the stub wait (abortably) before editing, leaving the
    // run in-flight long enough to hit Stop.
    await runAgentOnTarget(page, "tier-pro-title", "slow style change", {
      slow: true,
    });

    // The bubble shows the in-flight state with a Stop control; cancel it.
    const stop = page.getByRole("button", { name: "Stop agent" });
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await stop.click();

    // The run is abandoned: the stub edit never lands and no version goes live.
    await expect(stop).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Run agent" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: USE_VERSION_RE })
    ).toHaveCount(0);

    // Source is back to the pre-run baseline: the comment marker remains (the
    // comment was created) but the agent's stub edit was reverted.
    const pricingSource = await readFile(FIXTURE_FILES.pricing, "utf8");
    expect(pricingSource).toContain("@comment");
    expect(pricingSource).not.toContain(STUB_MARKER);
  });
});
