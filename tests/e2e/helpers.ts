/**
 * Shared composer-drive helpers for the e2e specs.
 *
 * They factor the repetitive "activate → pick element → freeze → type → submit"
 * sequence (in both comment and agent mode) so specs read as scenarios rather
 * than click sequences. Selectors mirror the overlay's real aria-labels /
 * test-ids — keep them in sync with `src/client/overlay/*`.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A CommentDot pin's accessible name, e.g. "1 comment by dev@local" or
 * "Agent working on 1 comment by …". The leading count + "by" distinguishes it
 * from the dock pill ("forkdesign comments").
 */
export const COMMENT_PIN_RE = /\d+ comments? by /i;
/** Variant switcher buttons are labelled "Use v2", "Use Original", etc. */
export const USE_VERSION_RE = /^Use /;
/** Substring the stub agent writes into the edited source (see strategies/stub.ts). */
export const STUB_MARKER = "forkdesign-stub";
/** Instruction token that switches the stub into slow/abortable mode. */
const STUB_SLOW_TOKEN = "[[slow]]";

const PANEL_TESTID = "forkdesign-composer-panel";

/** Open the dock menu and enter "Add comment" capture mode. */
export async function activateAddComment(page: Page): Promise<void> {
  await page.getByRole("button", { name: "forkdesign comments" }).click();
  await page
    .getByRole("menu", { name: "forkdesign actions" })
    .getByRole("menuitem", { name: "Add comment" })
    .click();
}

/**
 * Activate capture mode, freeze the element with the given test id as the
 * comment target, and return the composer panel locator (defaults to Agent
 * mode — flip it with the helpers below).
 */
export async function openComposerOnTarget(
  page: Page,
  testId: string
): Promise<Locator> {
  await activateAddComment(page);
  const target = page.getByTestId(testId);
  await target.hover();
  await target.click();
  const panel = page.getByTestId(PANEL_TESTID);
  await expect(panel).toBeVisible();
  return panel;
}

/** Flip the composer panel from the default Agent mode to Comment mode. */
async function selectComposerMode(
  panel: Locator,
  mode: "Agent" | "Comment"
): Promise<void> {
  await panel.getByRole("button", { name: "Agent", exact: true }).click();
  await panel.getByRole("menuitemradio", { name: mode }).click();
}

/**
 * Place a plain comment (no agent run) on the given target and submit it.
 * Returns the comment text that was typed.
 */
export async function placeComment(
  page: Page,
  testId: string,
  text: string
): Promise<string> {
  const panel = await openComposerOnTarget(page, testId);
  await selectComposerMode(panel, "Comment");
  await expect(
    panel.getByRole("button", { name: "Send comment" })
  ).toBeVisible();
  await panel.getByRole("textbox", { name: "Comment" }).fill(text);
  await panel.getByRole("button", { name: "Send comment" }).click();
  return text;
}

/**
 * Start an agent run on the given target. Defaults to Agent mode, optionally
 * steps the variant count up to `variantCount` (1..5), types the instruction,
 * and clicks "Run agent". Assumes the dev server runs the deterministic stub
 * agent (`FORKDESIGN_E2E_STUB=1`).
 */
export async function runAgentOnTarget(
  page: Page,
  testId: string,
  instruction: string,
  options: { variantCount?: number; slow?: boolean } = {}
): Promise<void> {
  const panel = await openComposerOnTarget(page, testId);
  const textarea = panel.getByRole("textbox", {
    name: "Instruction for the agent",
  });
  const text = options.slow ? `${instruction} ${STUB_SLOW_TOKEN}` : instruction;
  await textarea.fill(text);

  const variantCount = options.variantCount ?? 1;
  // Default count is 1; Alt+ArrowUp steps it up one option at a time.
  for (let n = 1; n < variantCount; n += 1) {
    await textarea.press("Alt+ArrowUp");
  }

  await panel.getByRole("button", { name: "Run agent" }).click();
}

/** Fetch the comments the server currently knows about. */
export async function fetchComments(
  page: Page
): Promise<Array<{ id: string; text: string; anchor: string }>> {
  return await page.evaluate(async () => {
    const res = await fetch("/api/comments");
    const body = (await res.json()) as {
      comments: Array<{ id: string; text: string; anchor: string }>;
    };
    return body.comments;
  });
}
