/**
 * E2E SMOKE: overlay mounts & toggles.
 *
 * Scenario:
 *   1. Load the fixture playground app in dev (Vite dev server with the redline
 *      plugin injected; the overlay only mounts under `import.meta.env.DEV`).
 *   2. Assert the redline floating dock pill mounts.
 *   3. Open the dock menu and toggle the overlay enabled/paused state, asserting
 *      the comment dots / composer affordances appear and disappear accordingly.
 *
 * This is the most basic structural check that the dev plugin wired the overlay
 * into the page at all. It does NOT create comments and NEVER invokes the agent.
 *
 * Key DOM hooks (from src/client/overlay/**):
 *   - Overlay root:        [data-redline-overlay-root="true"]  (also [data-comment-overlay="true"])
 *   - Dock container:      [data-redline-dock="true"]
 *   - Dock pill button:    button[aria-label="redline comments"]  (aria-haspopup="menu")
 *   - Dock menu:           [role="menu"][aria-label="redline actions"]
 *   - "Add comment" item:  role=menuitem, name "Add comment" (or "Cancel" when active)
 *   - "Comments" list item: role=menuitem, name "Comments"
 *   - "Settings" item:     role=menuitem, name "Settings"
 *   - Reviewing/Paused toggle: input#redline-review-toggle (a Switch)
 *   - Comment markers/pins: button[aria-label*="comment"] (CommentDot), fixed z-[9100]
 */
import { expect, test } from "@playwright/test";

test.describe("overlay smoke", () => {
  test.beforeEach(async ({ page }) => {
    // TODO: navigate to baseURL ("/" of the fixture playground). The playwright
    // config (owned by another agent) provides webServer + baseURL, so a bare
    // `await page.goto("/")` should land on the fixture app with redline active.
    await page.goto("/");
  });

  test.fixme("redline dock pill mounts in dev", async ({ page }) => {
    // TODO: expect the overlay root [data-redline-overlay-root="true"] to be attached.
    // TODO: expect the dock [data-redline-dock="true"] visible.
    // TODO: expect button[aria-label="redline comments"] to be visible.
    // NOTE: dock is suppressed when settings.showFloatingControls is false or a
    //       thread is docked — fixture should boot with defaults (controls shown).
  });

  test.fixme("dock menu opens and lists actions", async ({ page }) => {
    // TODO: click the dock pill (aria-label="redline comments").
    // TODO: expect [role="menu"][aria-label="redline actions"] visible.
    // TODO: expect menuitems: "Add comment", "Comments", "Settings".
    // TODO: expect the Reviewing/Paused switch input#redline-review-toggle present and checked.
    // TODO: click outside (useDismissOnOutside) and expect the menu to close.
  });

  test.fixme("toggling Paused tears down comment affordances", async ({
    page,
  }) => {
    // TODO: open the dock menu, flip input#redline-review-toggle to Paused.
    // TODO: expect comment dots (button[aria-label*="comment"], the CommentDot pins)
    //       to no longer render, and the composer/Add comment menuitem to be hidden
    //       (only "Settings" remains when disabled — see OverlayDockMenu).
    // TODO: flip back to Reviewing; expect the dots/composer affordances to return.
    // NOTE: state persists to localStorage via saveSettings — clear storage in
    //       beforeEach or reset the toggle at test end so tests don't leak state.
  });

  test.fixme("composer toggles via dock and via the 'C' hotkey", async ({
    page,
  }) => {
    // TODO: open dock menu, click "Add comment"; expect composer capture mode active
    //       (menuitem label flips to "Cancel"; hovering an element draws the
    //       selection reticle / picker chip [data-comment-overlay] near the cursor).
    // TODO: press Escape (or click "Cancel") to exit composer mode.
    // TODO: press the "C" hotkey on the page body and expect composer mode to toggle
    //       on (handleOverlayGlobalKeydown wires C → setComposerActive). Ensure no
    //       text input is focused, since the global keydown ignores hotkeys then.
  });
});
