/**
 * Shared screenshot capture helper for the comment overlay.
 *
 * `html-to-image` rasterises the target element and its subtree but does NOT
 * paint anything behind it. When the target's own `background-color` is
 * transparent (most elements), the resulting PNG has transparent regions
 * where the page background should be — looks broken when displayed against
 * a different backdrop.
 *
 * Fix: walk up the DOM to find the nearest opaque-backgrounded ancestor and
 * pass that color as `backgroundColor` to `toPng`. The canvas fills with
 * that color before painting the element, so the resulting PNG reads as
 * "the element on its page background" rather than "the element on
 * transparency".
 */

/**
 * Find the closest ancestor (including `el` itself) with a non-transparent
 * `background-color`. Falls back to the body's background, then to white.
 * Doesn't try to handle `background-image` (gradients, images) — those
 * remain a non-goal; for backdrop-rich elements the captured screenshot
 * will be slightly off and the lightbox will show that.
 */
export function effectiveBackgroundColor(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    const bg = window.getComputedStyle(cur).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
    cur = cur.parentElement;
  }
  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  if (bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent") {
    return bodyBg;
  }
  return "#ffffff";
}
