/**
 * E2E SMOKE: the redline overlay mounts in dev and its dock toggles work.
 *
 * Drives a real Chromium against the fixture playground Vite dev server (see
 * playwright.config.ts `webServer` + tests/fixtures/playground/). NO agent is
 * ever invoked here — this only exercises the overlay chrome.
 *
 * DOM hooks (from src/client/overlay/**):
 *   - Overlay root:        [data-redline-overlay-root="true"]
 *   - Dock container:      [data-redline-dock="true"]
 *   - Dock pill button:    button[aria-label="redline comments"] (aria-haspopup="menu")
 *   - Dock menu:           [role="menu"][aria-label="redline actions"]
 *   - Menu items:          role=menuitem "Add comment" | "Comments" | "Settings"
 *   - Review toggle:       #redline-review-toggle (a Switch)
 */
import { expect, test } from "@playwright/test";

test.describe("overlay smoke", () => {
  test.beforeEach(async ({ page }) => {
    // Start from default (enabled) overlay settings on every run.
    await page.addInitScript(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* storage unavailable */
      }
    });
    await page.goto("/");
  });

  test("redline dock pill mounts in dev", async ({ page }) => {
    await expect(
      page.locator('[data-redline-overlay-root="true"]')
    ).toBeAttached();
    await expect(page.locator('[data-redline-dock="true"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "redline comments" })
    ).toBeVisible();
  });

  test("dock menu opens and lists actions", async ({ page }) => {
    await page.getByRole("button", { name: "redline comments" }).click();

    const menu = page.getByRole("menu", { name: "redline actions" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Add comment" })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Comments" })
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Settings" })
    ).toBeVisible();

    // Reviewing switch is present and on by default.
    const toggle = page.locator("#redline-review-toggle");
    await expect(toggle).toBeAttached();
    await expect(toggle).toBeChecked();

    // Clicking outside (useDismissOnOutside) closes the menu.
    await page.mouse.click(5, 5);
    await expect(menu).toBeHidden();
  });

  test("toggling Paused hides comment affordances, restoring them on Reviewing", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "redline comments" }).click();
    const toggle = page.locator("#redline-review-toggle");
    await expect(toggle).toBeChecked();

    // Flip to Paused. The toggle lives inside the menu (which stops pointer
    // propagation), so the menu stays open and re-renders to just "Settings".
    await toggle.click();
    await expect(toggle).not.toBeChecked();

    const menu = page.getByRole("menu", { name: "redline actions" });
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Add comment" })
    ).toHaveCount(0);
    await expect(
      menu.getByRole("menuitem", { name: "Settings" })
    ).toBeVisible();

    // Flip back to Reviewing; "Add comment" returns to the (still-open) menu.
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(
      menu.getByRole("menuitem", { name: "Add comment" })
    ).toBeVisible();
  });

  test("composer toggles via the dock and via the 'C' hotkey", async ({
    page,
  }) => {
    // Activate via the dock menu.
    await page.getByRole("button", { name: "redline comments" }).click();
    await page
      .getByRole("menu", { name: "redline actions" })
      .getByRole("menuitem", { name: "Add comment" })
      .click();

    // Hovering an element draws the picker chip ("target" label, z-[9310]).
    await page.getByTestId("title").hover();
    const pickerChip = page.locator('[data-comment-overlay="true"]', {
      hasText: "target",
    });
    await expect(pickerChip.first()).toBeVisible();

    // Escape exits composer capture mode (picker chip disappears).
    await page.keyboard.press("Escape");
    await expect(pickerChip).toHaveCount(0);

    // The "C" hotkey re-activates composer mode (no text input focused).
    await page.locator("body").click();
    await page.keyboard.press("c");
    await page.getByTestId("title").hover();
    await expect(
      page
        .locator('[data-comment-overlay="true"]', { hasText: "target" })
        .first()
    ).toBeVisible();
  });
});
