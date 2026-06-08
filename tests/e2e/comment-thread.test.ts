/**
 * E2E: open an existing comment thread and browse its agent iteration/version UI.
 *
 * Scenario:
 *   1. Load the fixture playground PRE-SEEDED with a comment that already has
 *      agent iteration results on disk (markers in .tsx + iteration data the dev
 *      server serves via GET /api/iterations?id=...). The agent is NEVER run live
 *      in e2e — these variants are checked-in fixtures.
 *   2. Click the comment's pin (CommentDot) to open its bubble.
 *   3. Assert the transcript renders the seeded turn(s) and a VariantGrid of
 *      version thumbnails (2-up grid), including the "Original" (v0) baseline.
 *   4. Switch the live version by clicking a variant card; assert the active
 *      version moves (the "Live" badge + primary ring follow the clicked card).
 *   5. Exercise the variant thumbnail LOADING STATE and the fullscreen lightbox.
 *
 * NO AGENT: do not POST /api/iterations/new. The fixture provides version data;
 * switching versions hits POST /api/iterations/activate (file write), which the
 * dev server handles without the real Claude agent.
 *
 * Key DOM hooks / behaviors (from src/client/overlay/**):
 *   - Open the thread:   click button[aria-label*="comment"] (CommentDot pin).
 *   - Bubble:            comment-bubble.tsx, header buttons via aria-label
 *                        ("Close", "Resolve"/"Resolved", "Delete comment",
 *                         "Dock panel to edge"/"Float panel", "Move back to anchor").
 *   - Transcript:        comment-transcript.tsx renders turns; long threads
 *                        collapse the middle (COLLAPSE_THRESHOLD=4, tail=2).
 *   - VariantGrid:       comment-variant-group.tsx — grid grid-cols-2 of VariantCards.
 *       * Each non-active, switchable card is a button[aria-label="Use <label>"]
 *         where label is "Original" (v0) or formatVersionDisplay(v).
 *       * Active card shows a "Live" badge (Check icon) + border-primary ring-primary;
 *         it is NOT a button (cardBody rendered bare when !canActivate).
 *       * Expand button: button[aria-label="View screenshot fullscreen"] → lightbox.
 *       * Delete (v>0, non-active): button[aria-label="Delete version"] → inline confirm.
 *   - Thumbnail loading state (VariantThumbnail):
 *       * While the <img> hasn't decoded, a `.redline-shimmer` skeleton overlays it
 *         (absolute inset-0) and the img is opacity-0; on img onLoad (or already
 *         complete) `ready` flips → shimmer removed, img opacity-100.
 *       * A version still being captured (version.screenshotPending) renders
 *         PendingVariantThumbnail instead: a spinner (Loader2) + "Capturing…" text,
 *         and NO expand button.
 *   - Lightbox:          comment-bubble-lightbox.tsx — [aria-label="Version screenshot"],
 *                        close via [aria-label="Close screenshot"] or Escape. Body
 *                        gets data-redline-lightbox="open" (bubble Escape is suppressed
 *                        while the lightbox owns Escape).
 *
 * Switching activation flow (use-iterations.ts):
 *   - clicking a non-active variant → onActivate → POST /api/iterations/activate
 *     { id, v }; `switching` is true meanwhile (other cards show "…" trailing).
 */
import { expect, test } from "@playwright/test";

test.describe("comment thread / iteration versions", () => {
  test.beforeEach(async ({ page }) => {
    // TODO: ensure the pre-seeded fixture comment + iteration variants exist.
    //   The fixture playground (owned by another agent) should ship a .tsx with a
    //   committed {/* @comment ... *\/} marker AND seeded version PNGs/metadata the
    //   dev server returns from GET /api/iterations?id=<commentId>.
    //   If versions are served from a temp/seed dir, set it up here (or have the
    //   playwright webServer point the plugin at the seed fixtures).
    await page.goto("/");
  });

  test.fixme("open a seeded comment and see its variant grid", async ({
    page,
  }) => {
    // TODO: click the seeded comment's CommentDot pin (button[aria-label*="comment"]).
    // TODO: expect the bubble to open and the transcript to show the seeded turn.
    // TODO: expect a VariantGrid (grid-cols-2) with the seeded versions, incl.
    //       the "Original" (v0) card and at least one generated variant.
    // TODO: expect exactly one card marked "Live" (Check badge + primary ring).
  });

  test.fixme("variant thumbnails show loading state then resolve", async ({
    page,
  }) => {
    // TODO: open the seeded comment.
    // TODO: BEFORE images decode, assert each variant card shows the
    //       `.redline-shimmer` skeleton (absolute inset-0) and its <img> is opacity-0.
    //       (May need to throttle the network / serve large PNGs, or assert the
    //        shimmer is present transiently then gone.)
    // TODO: after images load, assert the shimmer is removed and imgs are opacity-100.
    // TODO: if a fixture version is marked screenshotPending, assert it renders the
    //       PendingVariantThumbnail (Loader2 spinner + "Capturing…") and has NO
    //       "View screenshot fullscreen" expand button.
  });

  test.fixme("switching the active version updates Live + ring", async ({
    page,
  }) => {
    // TODO: open the seeded comment; note which card is currently "Live".
    // TODO: click a non-active card's button[aria-label="Use <label>"].
    // TODO: expect a transient switching state (other cards show "…" trailing),
    //       then the clicked card becomes "Live" (Check badge + border-primary ring)
    //       and the previously-live card loses it.
    // TODO: assert POST /api/iterations/activate was issued with the right { id, v }
    //       (route the request via page.route, or assert via GET /api/iterations).
    // NOTE: switching is a real file write but NOT an agent run — allowed in e2e.
  });

  test.fixme("expand a variant opens the screenshot lightbox", async ({
    page,
  }) => {
    // TODO: open the seeded comment; hover a non-pending card to reveal the
    //       button[aria-label="View screenshot fullscreen"] and click it.
    // TODO: expect the lightbox [aria-label="Version screenshot"] visible and
    //       document.body to carry data-redline-lightbox="open".
    // TODO: press Escape (or click [aria-label="Close screenshot"]); expect the
    //       lightbox to close AND the underlying bubble to stay open (Escape is
    //       suppressed for the bubble while the lightbox owns it — comment-overlay.tsx).
  });
});
