/**
 * Per-comment persistence for a dragged bubble position. A user who nudges a
 * thread out of the way (e.g. so it stops covering the element it's about)
 * expects it to stay put across close/reopen and reloads — until they
 * explicitly re-anchor. Positions are viewport-pixel left/top, so they're
 * clamped back into view on load in case the window has since shrunk.
 *
 * Storage is best-effort: any failure (private mode, quota, disabled storage)
 * degrades silently to "no saved position", i.e. the auto-anchored placement.
 */

const KEY_PREFIX = "redline:bubble-pos:";
/** Keep at least this much of the panel — enough to grab the header — on-screen. */
const MIN_VISIBLE = 120;
/** Never let the header slip above the top edge, or it can't be dragged back. */
const TOP_PADDING = 8;

export interface SavedPosition {
  left: number;
  top: number;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(commentId: string): string {
  return `${KEY_PREFIX}${commentId}`;
}

export function loadBubblePosition(commentId: string): SavedPosition | null {
  if (!commentId) {
    return null;
  }
  const store = storage();
  if (!store) {
    return null;
  }
  try {
    const raw = store.getItem(keyFor(commentId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SavedPosition>;
    if (
      typeof parsed?.left === "number" &&
      typeof parsed?.top === "number" &&
      Number.isFinite(parsed.left) &&
      Number.isFinite(parsed.top)
    ) {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {
    // Corrupt or unreadable — fall through to the anchored default.
  }
  return null;
}

export function saveBubblePosition(
  commentId: string,
  position: SavedPosition
): void {
  if (!commentId) {
    return;
  }
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.setItem(keyFor(commentId), JSON.stringify(position));
  } catch {
    // Quota or disabled storage — a non-persisted drag is acceptable.
  }
}

export function clearBubblePosition(commentId: string): void {
  if (!commentId) {
    return;
  }
  const store = storage();
  if (!store) {
    return;
  }
  try {
    store.removeItem(keyFor(commentId));
  } catch {
    // Nothing to recover from; the in-memory reset already happened.
  }
}

/**
 * Clamp a saved position so a usable slice of the panel stays reachable after a
 * viewport change. Horizontally the panel may hang off either edge as long as
 * `MIN_VISIBLE` px remain; vertically the header is pinned below the top edge.
 */
export function clampPositionIntoView(
  position: SavedPosition,
  viewport: { width: number; height: number },
  panelWidth: number
): SavedPosition {
  const minLeft = MIN_VISIBLE - panelWidth;
  const maxLeft = viewport.width - MIN_VISIBLE;
  const maxTop = viewport.height - MIN_VISIBLE;
  return {
    left: Math.min(maxLeft, Math.max(minLeft, position.left)),
    top: Math.min(maxTop, Math.max(TOP_PADDING, position.top)),
  };
}
