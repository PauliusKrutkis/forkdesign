import { useEffect, useState } from "react";

/**
 * Tracks the live DOMRects of ALL elements carrying
 * `data-comment-anchor="<uuid>"` — there can be more than one when the
 * marker lives in a shared component (e.g., a list-item component
 * rendered N times). Returns rects in document order. Empty array
 * when no instances exist.
 *
 * Re-emits whenever:
 *   - any matching element enters/leaves the DOM (MutationObserver)
 *   - any matching element resizes (per-element ResizeObserver)
 *   - the window scrolls or resizes (passive listeners)
 */
export function useAnchorRects(anchorId: string): DOMRect[] {
  const [rects, setRects] = useState<DOMRect[]>([]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    let elements: HTMLElement[] = [];
    let observers: ResizeObserver[] = [];

    const measure = () => {
      const next = elements.map((el) => el.getBoundingClientRect());
      setRects((prev) => {
        if (
          prev.length === next.length &&
          prev.every((r, i) => {
            const n = next[i];
            return (
              !!n &&
              r.x === n.x &&
              r.y === n.y &&
              r.width === n.width &&
              r.height === n.height
            );
          })
        ) {
          return prev;
        }
        return next;
      });
    };

    const sync = () => {
      observers.forEach((o) => o.disconnect());
      observers = [];
      elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-comment-anchor="${cssEscape(anchorId)}"]`
        )
      );
      if (typeof ResizeObserver !== "undefined") {
        elements.forEach((el) => {
          const ro = new ResizeObserver(() => measure());
          ro.observe(el);
          observers.push(ro);
        });
      }
      measure();
    };

    sync();

    const mutationObserver = new MutationObserver(() => sync());
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-comment-anchor"],
    });

    const onScroll = () => measure();
    const onResize = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      mutationObserver.disconnect();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      observers.forEach((o) => o.disconnect());
    };
  }, [anchorId]);

  return rects;
}

/**
 * Single-instance convenience wrapper. Returns the first matching rect,
 * or null if none. Prefer `useAnchorRects` for any new code so
 * multi-instance anchors render correctly.
 */
export function useAnchorElement(anchorId: string): DOMRect | null {
  const rects = useAnchorRects(anchorId);
  return rects[0] ?? null;
}

/**
 * Minimal CSS.escape fallback. `data-comment-anchor` values are uuids,
 * so this is defensive — we just guard against odd characters in case
 * the seed data drifts.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
