/**
 * Floating-element placement against an anchor rect.
 *
 * Rules:
 *   1. Try `preferredSide`. If the floater wouldn't fit on that side of the
 *      anchor within viewport bounds, flip to the opposite side.
 *   2. Shift the floater along the cross-axis (perpendicular to the chosen
 *      side) so it stays inside the viewport with `padding` slack.
 *   3. Return an `arrowOffset` along the floater's anchor-facing edge that
 *      tracks the anchor's center, clamped to `arrowSafePadding` from the
 *      corners so the pointer never collides with the rounded corner radius.
 *
 * No dependencies; keep it pure so it's trivially testable.
 */

export type FloaterSide = "top" | "bottom" | "left" | "right";

export interface FloaterPosition {
  arrowOffset: number;
  left: number;
  side: FloaterSide;
  top: number;
}

interface Rect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface PlaceArgs {
  anchor: Rect;
  arrowSafePadding?: number;
  gap?: number;
  padding?: number;
  preferredSide: FloaterSide;
  size: { width: number; height: number };
  viewport: { width: number; height: number };
}

const OPPOSITE: Record<FloaterSide, FloaterSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

export function placeFloater({
  anchor,
  size,
  preferredSide,
  viewport,
  padding = 12,
  gap = 8,
  arrowSafePadding = 14,
}: PlaceArgs): FloaterPosition {
  const anchorCenterX = (anchor.left + anchor.right) / 2;
  const anchorCenterY = (anchor.top + anchor.bottom) / 2;

  const fits: Record<FloaterSide, boolean> = {
    top: anchor.top - gap - size.height >= padding,
    bottom: anchor.bottom + gap + size.height <= viewport.height - padding,
    left: anchor.left - gap - size.width >= padding,
    right: anchor.right + gap + size.width <= viewport.width - padding,
  };

  let side: FloaterSide = preferredSide;
  if (!fits[preferredSide]) {
    side = fits[OPPOSITE[preferredSide]]
      ? OPPOSITE[preferredSide]
      : preferredSide;
  }

  let left: number;
  let top: number;
  if (side === "bottom") {
    top = anchor.bottom + gap;
    left = anchorCenterX - size.width / 2;
  } else if (side === "top") {
    top = anchor.top - gap - size.height;
    left = anchorCenterX - size.width / 2;
  } else if (side === "right") {
    left = anchor.right + gap;
    top = anchorCenterY - size.height / 2;
  } else {
    left = anchor.left - gap - size.width;
    top = anchorCenterY - size.height / 2;
  }

  // Shift along the cross-axis to fit the viewport.
  if (side === "top" || side === "bottom") {
    left = clamp(left, padding, viewport.width - size.width - padding);
  } else {
    top = clamp(top, padding, viewport.height - size.height - padding);
  }

  const arrowOffset =
    side === "top" || side === "bottom"
      ? clamp(
          anchorCenterX - left,
          arrowSafePadding,
          size.width - arrowSafePadding
        )
      : clamp(
          anchorCenterY - top,
          arrowSafePadding,
          size.height - arrowSafePadding
        );

  return { left, top, side, arrowOffset };
}

function clamp(v: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, v));
}

/**
 * Where the comment dot lives for a given anchored element. The dot floats
 * over the element's top-right corner — half outside, half inside — *except*
 * when that would place it outside the viewport, in which case it clamps to
 * stay fully visible with a small inset.
 *
 * Both the dot itself and any floater pointing at it (bubble, hover preview)
 * compute their geometry from this rect so they never disagree.
 */
export function dotRect(
  anchor: { right: number; top: number },
  viewport: { width: number; height: number },
  options: { size?: number; nudge?: number; viewportPadding?: number } = {}
): { left: number; top: number; right: number; bottom: number } {
  const size = options.size ?? 14;
  const nudge = options.nudge ?? 7;
  // Padding accounts for the dot's own footprint AND the count-badge that
  // overflows ~8px past the dot's top-right when comments stack.
  const pad = options.viewportPadding ?? 12;
  const idealLeft = anchor.right - nudge;
  const idealTop = anchor.top - nudge;
  const left = clamp(idealLeft, pad, viewport.width - size - pad);
  const top = clamp(idealTop, pad, viewport.height - size - pad);
  return { left, top, right: left + size, bottom: top + size };
}
