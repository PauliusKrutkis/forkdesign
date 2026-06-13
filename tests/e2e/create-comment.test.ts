/**
 * E2E: create a comment end-to-end through a real browser, in COMMENT mode
 * (the agent is never invoked — the composer defaults to "agent", so the test
 * flips the mode toggle to "comment" before submitting).
 *
 * Flow: activate composer → pick a fixture element → freeze it → flip to
 * comment mode → type → submit → assert (a) a CommentDot pin appears and the
 * bubble auto-opens with the typed text, and (b) the source .tsx on disk gained
 * a `data-comment-anchor` attribute and an `@comment ... text="..."` marker.
 *
 * Source-mutation cleanup: the submit writes into
 * `tests/fixtures/playground/src/App.tsx` on disk. We snapshot the original
 * bytes in `beforeAll` and restore them in `afterEach` so the tree stays clean.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const APP_TSX = fileURLToPath(
  new URL("../fixtures/playground/src/App.tsx", import.meta.url)
);
const COMMENT_BUTTON_RE = /comment/;

let originalAppSource = "";

test.describe("create comment", () => {
  test.beforeAll(async () => {
    originalAppSource = await readFile(APP_TSX, "utf8");
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
    // Restore the fixture source the submit mutated on disk.
    await writeFile(APP_TSX, originalAppSource, "utf8");
  });

  test("activate composer and pick a target element", async ({ page }) => {
    await page.getByRole("button", { name: "forkdesign comments" }).click();
    await page
      .getByRole("menu", { name: "forkdesign actions" })
      .getByRole("menuitem", { name: "Add comment" })
      .click();

    // Hover a stable fixture target; the picker chip surfaces its label.
    await page.getByTestId("card").hover();
    const pickerChip = page.getByTestId("forkdesign-picker-chip");
    await expect(pickerChip).toBeVisible();
    await expect(pickerChip).toContainText("card");
  });

  test("type feedback, submit in comment mode, and assert pin + bubble + source marker", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Activate composer + freeze the heading as the target.
    await page.getByRole("button", { name: "forkdesign comments" }).click();
    await page
      .getByRole("menu", { name: "forkdesign actions" })
      .getByRole("menuitem", { name: "Add comment" })
      .click();

    const title = page.getByTestId("title");
    await title.hover();
    await title.click();

    // The composer panel ("New comment") appears anchored near the click.
    const panel = page.getByTestId("forkdesign-composer-panel");
    await expect(panel).toBeVisible();

    // Flip the mode toggle from "Agent" to "Comment" so no agent runs. The mode
    // control is a button (aria-haspopup="menu") showing the current mode label.
    // `exact` avoids matching the "Run agent" submit button.
    await panel.getByRole("button", { name: "Agent", exact: true }).click();
    await panel.getByRole("menuitemradio", { name: "Comment" }).click();
    // The submit button is now the comment send action.
    await expect(
      panel.getByRole("button", { name: "Send comment" })
    ).toBeVisible();

    const commentText = `e2e comment ${Date.now()}`;
    const textarea = panel.getByRole("textbox", { name: "Comment" });
    await textarea.fill(commentText);

    // Submit (no agent run).
    await panel.getByRole("button", { name: "Send comment" }).click();

    // A CommentDot pin appears for the new anchor and the bubble auto-opens
    // (pendingOpenId) showing the typed text — after Vite HMR refetches.
    await expect(
      page.getByRole("button", { name: COMMENT_BUTTON_RE }).first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(commentText).first()).toBeVisible({
      timeout: 30_000,
    });

    // The source .tsx on disk gained the anchor attribute + @comment marker.
    await expect
      .poll(async () => await readFile(APP_TSX, "utf8"), { timeout: 30_000 })
      .toContain("data-comment-anchor=");
    const updated = await readFile(APP_TSX, "utf8");
    expect(updated).toContain("@comment");
    expect(updated).toContain(`text="${commentText}"`);

    // Cross-check via the public API too (avoids depending solely on marker syntax).
    const apiComments = await page.evaluate(async () => {
      const res = await fetch("/api/comments");
      return (await res.json()) as {
        comments: Array<{ text: string; anchor: string }>;
      };
    });
    expect(apiComments.comments.some((c) => c.text === commentText)).toBe(true);
  });

  test("composer placement clamps near the right viewport edge", async ({
    page,
  }) => {
    // Force a deterministic edge case: a narrow viewport so the heading's right
    // portion sits near the right edge. ComposerPanel anchors to the click point
    // (clickPoint.x - 200) and clamps left to <= viewportW - 400 - 12.
    const viewportW = 760;
    await page.setViewportSize({ width: viewportW, height: 600 });
    await page.getByRole("button", { name: "forkdesign comments" }).click();
    await page
      .getByRole("menu", { name: "forkdesign actions" })
      .getByRole("menuitem", { name: "Add comment" })
      .click();

    // Click the heading at its right edge, putting the click point near the
    // viewport's right edge so the panel must clamp.
    const title = page.getByTestId("title");
    await title.hover();
    const titleBox = await title.boundingBox();
    expect(titleBox).not.toBeNull();
    if (titleBox) {
      const clickX = Math.min(viewportW - 8, titleBox.x + titleBox.width - 4);
      const clickY = titleBox.y + titleBox.height / 2;
      await page.mouse.move(clickX, clickY);
      await page.mouse.click(clickX, clickY);
    }

    const panel = page.getByTestId("forkdesign-composer-panel");
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // The invariant under test: the panel never overflows the viewport — its
      // left stays non-negative and its right edge stays within the viewport
      // width (ComposerPanel clamps left into [12, viewportW - 400 - 12]).
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportW + 1);
    }
  });
});
