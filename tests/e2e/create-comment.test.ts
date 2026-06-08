/**
 * E2E: create a comment end-to-end through the browser.
 *
 * Scenario:
 *   1. Load fixture playground, ensure the overlay is enabled (Reviewing).
 *   2. Activate composer capture mode (dock "Add comment" or the "C" hotkey).
 *   3. Hover a known fixture target element — assert the picker preview / selection
 *      reticle highlights it and the breadcrumb chip shows the element label.
 *   4. Click the target to freeze it; assert the composer panel appears at the
 *      correct placement near the click point (see placement rules below).
 *   5. Type feedback into the composer textarea, switch to "Comment" mode (NOT
 *      Agent mode — the agent must never run in e2e), and submit.
 *   6. Assert the comment is reflected:
 *        - in the UI: a CommentDot pin appears for the new anchor, and the
 *          bubble auto-opens (pendingOpenId flow) showing the typed text;
 *        - on disk: the targeted `.tsx` fixture source gained a
 *          `data-comment-anchor="<uuid>"` attribute and a sibling
 *          `{/* @comment ... text="..." *\/}` marker.
 *
 * NO AGENT: submit in "comment" mode so `runAgent` is false. The composer
 * defaults to "agent" mode (see ComposerPanel useState<ComposerMode>("agent")),
 * so the test MUST switch the mode toggle to "comment" before submitting, or the
 * fixture/dev server must stub POST /api/iterations/* so no real agent runs.
 *
 * Key DOM hooks / behaviors (from src/client/overlay/**):
 *   - Composer panel:    [data-comment-overlay="true"] fixed z-[9300] containing
 *                        "New comment" header + the CommentComposerBar textarea.
 *   - Picker chip:       fixed z-[9310] [data-comment-overlay], header label "target",
 *                        breadcrumb buttons; selection box outline at z-[9300].
 *   - Mode toggle:       comment-composer-bar.tsx — ComposerMode "agent" | "comment".
 *   - Anchor stamping:   ensureAnchor() sets data-comment-anchor on the clicked el
 *                        (client-side) BEFORE submit; the server writer also stamps
 *                        it durably into source (writeCommentToFile).
 *   - Submit endpoint:   POST /api/comments (submit-comment.ts). After the file
 *                        write, Vite HMR fires vite:afterUpdate → overlay refetches
 *                        GET /api/comments → new comment appears → bubble auto-opens.
 *   - New pin:           button[aria-label*="comment"] (CommentDot), fixed z-[9100].
 *
 * Placement correctness (placement.ts placeFloater / ComposerPanel math):
 *   - Composer panel is PANEL_WIDTH=400 wide, anchored to the CLICK POINT
 *     (clickPoint.x - 200), clamped to [12, viewportW - 400 - 12].
 *   - Vertically prefers clickPoint.y + 12; flips above the click when
 *     clickPoint.y + ESTIMATED_PANEL_HEIGHT(220) + 12 > viewportH.
 *   - The bubble + dot share dotRect()/placeFloater(): preferredSide flips to the
 *     opposite side when it wouldn't fit, then clamps along the cross-axis with
 *     padding=12; arrowOffset clamps to arrowSafePadding from corners.
 */
import { expect, test } from "@playwright/test";

test.describe("create comment", () => {
  test.beforeEach(async ({ page }) => {
    // TODO: clear localStorage so overlay settings start at defaults (enabled),
    //       then goto("/"). Ensure Reviewing is on (toggle via dock if needed).
    await page.goto("/");
  });

  test.afterEach(async () => {
    // TODO: revert any source-file mutation the test wrote. Options:
    //   - `git checkout -- tests/fixtures/playground/...` for touched .tsx files, OR
    //   - delete the created comment via DELETE /api/comments/:id, OR
    //   - run against a per-test temp copy of the playground source.
    // The fixture writes to real files on disk, so cleanup is mandatory to keep
    // the suite idempotent.
  });

  test.fixme("activate composer and pick a target element", async ({
    page,
  }) => {
    // TODO: activate composer (dock "Add comment" or press "C").
    // TODO: hover a stable fixture element (e.g. a [data-testid] card in the
    //       playground). Expect the picker chip (z-[9310], "target" label) to show
    //       and the element's selection box outline (z-[9300]) to cover its rect.
    // TODO: optionally exercise breadcrumb navigation: click a parent crumb button
    //       and assert the selection box jumps to the ancestor rect.
  });

  test.fixme(
    "type feedback, submit in comment mode, bubble + dot reflect it",
    async ({ page }) => {
      // TODO: activate composer, click the target to freeze it.
      // TODO: expect composer panel (z-[9300], "New comment" header) visible.
      // TODO: switch the mode toggle from "agent" to "comment" (no agent run).
      // TODO: fill the textarea with e.g. "make this larger".
      // TODO: submit (button or Cmd/Ctrl+Enter via handleCommentBubbleKeydown).
      // TODO: expect inline "saved" state, then composer auto-closes (~600ms).
      // TODO: expect a new CommentDot pin (button[aria-label*="comment"]) to appear.
      // TODO: expect the bubble to auto-open (pendingOpenId) showing the typed text.
    }
  );

  test.fixme("comment is written into source as anchor + marker", async () => {
    // TODO: after submitting, read the targeted fixture .tsx from disk (fs) and
    //       assert it now contains:
    //         - data-comment-anchor="<uuid>" on the clicked element, and
    //         - a sibling {/* @comment id="..." anchor="<uuid>" text="..." *\/} marker
    //       Match the writer format in src/server/comments/writer.ts and the
    //       reader grammar in src/server/comments/reader.ts (@comment id=... anchor=... text=...).
    // ALT: assert via GET /api/comments that a comment with the typed text + anchor
    //      is returned (avoids hard-coding the on-disk marker syntax).
  });

  test.fixme("composer placement clamps near viewport edges", async ({
    page,
  }) => {
    // TODO: viewport-edge placement matrix. For each, activate composer, pick a
    //       target whose click point sits near an edge, and assert the panel stays
    //       fully on-screen per ComposerPanel math (PANEL_WIDTH=400, padding=12,
    //       ESTIMATED_PANEL_HEIGHT=220):
    //   - click near LEFT edge   → panel.left clamped to >= 12.
    //   - click near RIGHT edge  → panel.left clamped to <= viewportW - 400 - 12.
    //   - click near BOTTOM edge → panel flips ABOVE the click (top < clickY).
    //   - click near TOP edge    → panel placed BELOW the click (top = clickY + 12).
    // TODO: also assert the auto-opened bubble/dot stay on-screen: dotRect() clamps
    //       the pin within [12, viewport - size - 12]; placeFloater flips the bubble
    //       to the opposite side when the preferred side doesn't fit (placement.ts).
    // TODO: parametrize by resizing page.setViewportSize to force the edge cases
    //       deterministically rather than relying on a particular fixture layout.
  });
});
