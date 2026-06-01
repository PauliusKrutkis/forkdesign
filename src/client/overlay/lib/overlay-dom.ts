/** True when `el` or an ancestor is marked as overlay chrome (clicks should not dismiss). */
export function isOverlayElement(el: Element | null): boolean {
  let cur = el;
  while (cur) {
    if (cur instanceof HTMLElement && cur.dataset.commentOverlay === "true") {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}
