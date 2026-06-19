import { dotRect, type FloaterPosition, placeFloater } from "./placement.ts";

/**
 * Geometry shared by the comment bubble and the new-comment composer so the
 * composer can morph into the bubble *in place*: both panels are the same
 * width and land at the same coordinates, anchored to the same dot. Without
 * this the composer sat at the click point while the bubble appeared at the
 * anchor — two boxes in two places, which read as the comment and the form
 * swapping at different moments rather than one panel changing its contents.
 */
export const BUBBLE_WIDTH = 384;
export const INITIAL_BUBBLE_HEIGHT = 320;
const VIEWPORT_PADDING = 12;

/**
 * Place a floating panel against `rect` (an anchored element's box). Defaults
 * the height to the bubble's initial height so a composer placed before the
 * bubble exists lands exactly where the bubble will — no jump on hand-off.
 */
export function placeBubblePanel(
  rect: { right: number; top: number },
  viewport: { width: number; height: number },
  height: number = INITIAL_BUBBLE_HEIGHT
): FloaterPosition {
  return placeFloater({
    anchor: dotRect({ right: rect.right, top: rect.top }, viewport),
    size: { width: BUBBLE_WIDTH, height },
    preferredSide: "bottom",
    viewport,
    padding: VIEWPORT_PADDING,
    gap: 10,
    arrowSafePadding: 18,
  });
}
