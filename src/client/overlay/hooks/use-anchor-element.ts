import { useEffect, useState } from "react";
import { cssEscape } from "../lib/css-escape.ts";

export interface AnchorInstanceRect {
  instance: number;
  rect: DOMRect;
}

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
export function useAnchorRects(anchorId: string): AnchorInstanceRect[] {
  const [instances, setInstances] = useState<AnchorInstanceRect[]>([]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    let elements: HTMLElement[] = [];
    let observers: ResizeObserver[] = [];

    const measure = () => {
      const next = elements.map((el, instance) => ({
        instance,
        rect: el.getBoundingClientRect(),
      }));
      setInstances((prev) => {
        if (
          prev.length === next.length &&
          prev.every((item, i) => {
            const n = next[i];
            return (
              !!n &&
              item.instance === n.instance &&
              item.rect.x === n.rect.x &&
              item.rect.y === n.rect.y &&
              item.rect.width === n.rect.width &&
              item.rect.height === n.rect.height
            );
          })
        ) {
          return prev;
        }
        return next;
      });
    };

    const sync = () => {
      for (const o of observers) {
        o.disconnect();
      }
      observers = [];
      elements = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-comment-anchor="${cssEscape(anchorId)}"]`
        )
      );
      if (typeof ResizeObserver !== "undefined") {
        for (const el of elements) {
          const ro = new ResizeObserver(() => measure());
          ro.observe(el);
          observers.push(ro);
        }
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
      for (const o of observers) {
        o.disconnect();
      }
    };
  }, [anchorId]);

  return instances;
}

export function findAnchorInstanceRect(
  instances: AnchorInstanceRect[],
  instance: number
): DOMRect | null {
  return instances.find((item) => item.instance === instance)?.rect ?? null;
}
