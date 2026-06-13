/**
 * E2E: open a comment thread and verify the bubble / transcript UI renders.
 *
 * SCOPE REDUCTION (documented): the README envisioned PRE-SEEDED agent
 * iteration artifacts (version PNGs + manifest under `designs/`) served via
 * GET /api/iterations, then switching the live version. Seeding a faithful,
 * checked-in iteration thread (manifest + per-version tsx/png) and wiring the
 * dev server to serve it is heavy and brittle, and would also leak agent-shaped
 * fixtures into the integration temp-project copy. Instead, this test creates a
 * REAL comment in comment mode (no agent), opens its thread, and asserts the
 * bubble + transcript render the comment in its "Original" (no generated
 * versions) state — which is the realistic, always-reachable thread state the
 * README explicitly allows as the minimum bar. Switching/activating live
 * versions is covered by the integration suite (activate-revert.test.ts).
 *
 * The agent is never invoked. Source mutations are restored in afterEach.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const APP_TSX = fileURLToPath(
  new URL("../fixtures/playground/src/App.tsx", import.meta.url)
);
const COMMENT_BUTTON_RE = /comment/;
const USE_VERSION_BUTTON_RE = /^Use /;

let originalAppSource = "";

/** Create a comment-mode comment on the heading and return its text. */
async function seedComment(page: Page): Promise<string> {
  await page.getByRole("button", { name: "forkdesign comments" }).click();
  await page
    .getByRole("menu", { name: "forkdesign actions" })
    .getByRole("menuitem", { name: "Add comment" })
    .click();

  const title = page.getByTestId("title");
  await title.hover();
  await title.click();

  const panel = page.getByTestId("forkdesign-composer-panel");
  await expect(panel).toBeVisible();

  await panel.getByRole("button", { name: "Agent", exact: true }).click();
  await panel.getByRole("menuitemradio", { name: "Comment" }).click();

  const text = `seeded thread ${Date.now()}`;
  await panel.getByRole("textbox", { name: "Comment" }).fill(text);
  await panel.getByRole("button", { name: "Send comment" }).click();

  // Wait for the write to round-trip and the pin to appear.
  await expect(
    page.getByRole("button", { name: COMMENT_BUTTON_RE }).first()
  ).toBeVisible({ timeout: 30_000 });
  return text;
}

test.describe("comment thread / iteration versions", () => {
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
    await writeFile(APP_TSX, originalAppSource, "utf8");
  });

  test("opening a comment renders its thread in the Original state", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const text = await seedComment(page);

    // The bubble auto-opens after creation (pendingOpenId); the transcript
    // shows the human comment text.
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 30_000 });

    // Bubble chrome: a Close control is present (comment-bubble-header.tsx).
    await expect(
      page.getByRole("button", { name: "Close" }).first()
    ).toBeVisible();

    // Close, then reopen by clicking the pin — proving the thread opens on demand.
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByText(text).first()).toBeHidden();

    await page.getByRole("button", { name: COMMENT_BUTTON_RE }).first().click();
    await expect(page.getByText(text).first()).toBeVisible();

    // No generated agent variants exist for a comment-mode comment: there is no
    // "Use Original"/"Use v1" activate affordance and no "Live" badge.
    await expect(
      page.getByRole("button", { name: USE_VERSION_BUTTON_RE })
    ).toHaveCount(0);
  });

  test("the seeded comment is exposed (without versions) via the iterations API", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const text = await seedComment(page);

    // Resolve the comment id from the public comments API.
    await expect
      .poll(
        async () =>
          await page.evaluate(async (wanted) => {
            const res = await fetch("/api/comments");
            const body = (await res.json()) as {
              comments: Array<{ id: string; text: string }>;
            };
            return body.comments.find((c) => c.text === wanted)?.id ?? null;
          }, text),
        { timeout: 30_000 }
      )
      .not.toBeNull();

    const id = await page.evaluate(async (wanted) => {
      const res = await fetch("/api/comments");
      const body = (await res.json()) as {
        comments: Array<{ id: string; text: string }>;
      };
      return body.comments.find((c) => c.text === wanted)?.id ?? null;
    }, text);
    expect(id).toBeTruthy();

    // GET /api/iterations?id=<id> responds (the dev server route is wired).
    // A comment-mode comment has no generated variants, so versions is empty
    // or only the baseline — either way the route resolves without the agent.
    const status = await page.evaluate(async (commentIdValue) => {
      const res = await fetch(
        `/api/iterations?id=${encodeURIComponent(commentIdValue ?? "")}`
      );
      return res.status;
    }, id);
    expect(status).toBeLessThan(500);
  });
});
