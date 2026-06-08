import { isOverlayElement } from "./overlay-dom.ts";

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

export async function captureElementToPng(
  el: HTMLElement,
  warningPrefix: string
): Promise<string | null> {
  try {
    const { toPng } = await import("html-to-image");
    const pixelRatio =
      (typeof window !== "undefined" && window.devicePixelRatio) || 2;
    const dataUrl = await toPng(el, {
      pixelRatio,
      cacheBust: true,
      backgroundColor: effectiveBackgroundColor(el),
      filter: (node) =>
        !isOverlayElement(node instanceof Element ? node : null),
    });
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/png")) {
      return dataUrl;
    }
  } catch (err) {
    console.warn(warningPrefix, err);
  }
  return null;
}
