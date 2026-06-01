import { toPng } from "html-to-image";
import { cssEscape } from "./css-escape.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import { isOverlayElement } from "./overlay-dom.ts";
import { effectiveBackgroundColor } from "./screenshot.ts";

/** Post-edit screenshot capture after HMR settles; failures degrade silently. */
export function captureAndUploadV(args: {
  id: string;
  anchor: string;
  v: number;
  onUploaded?: () => void;
}): void {
  const { id, anchor, v, onUploaded } = args;
  if (!import.meta.hot) {
    return;
  }
  const hot = import.meta.hot;

  let done = false;
  let timeoutId: number | undefined;
  let debounceId: number | undefined;
  let fallbackId: number | undefined;

  const cleanup = () => {
    if (done) {
      return;
    }
    done = true;
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    if (debounceId !== undefined) {
      window.clearTimeout(debounceId);
    }
    if (fallbackId !== undefined) {
      window.clearTimeout(fallbackId);
    }
    hot.off("vite:afterUpdate", handler);
  };

  const scheduleCapture = () => {
    if (done) {
      return;
    }
    if (debounceId !== undefined) {
      window.clearTimeout(debounceId);
    }
    debounceId = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          run().catch(ignorePromiseRejection);
        });
      });
    }, 150);
  };

  const handler = () => {
    if (done) {
      return;
    }
    scheduleCapture();
  };

  const run = async (): Promise<void> => {
    cleanup();
    const el = document.querySelector(
      `[data-comment-anchor="${cssEscape(anchor)}"]`
    );
    if (!(el instanceof HTMLElement)) {
      console.warn(
        `[CommentBubble] post-iterate capture: anchor ${anchor} not found in DOM; keeping placeholder v${v}.png`
      );
      return;
    }
    let dataUrl: string;
    try {
      const pixelRatio =
        (typeof window !== "undefined" && window.devicePixelRatio) || 2;
      dataUrl = await toPng(el, {
        pixelRatio,
        cacheBust: true,
        backgroundColor: effectiveBackgroundColor(el),
        filter: (node) =>
          !isOverlayElement(node instanceof Element ? node : null),
      });
    } catch (err) {
      console.warn(
        "[CommentBubble] post-iterate screenshot capture failed; keeping placeholder",
        err
      );
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      console.warn(
        "[CommentBubble] post-iterate capture produced no PNG; keeping placeholder"
      );
      return;
    }
    try {
      const res = await fetch("/api/iterations/screenshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, v, screenshotPng: dataUrl }),
      });
      if (res.ok) {
        onUploaded?.();
      } else {
        console.warn(
          `[CommentBubble] /api/iterations/screenshot returned ${res.status}; keeping placeholder`
        );
      }
    } catch (err) {
      console.warn(
        "[CommentBubble] post-iterate screenshot upload failed; keeping placeholder",
        err
      );
    }
  };

  hot.on("vite:afterUpdate", handler);
  fallbackId = window.setTimeout(() => {
    if (done) {
      return;
    }
    scheduleCapture();
  }, 400);
  timeoutId = window.setTimeout(() => {
    if (done) {
      return;
    }
    cleanup();
    console.warn(
      `[CommentBubble] post-iterate capture: HMR did not fire within 5s; keeping placeholder v${v}.png`
    );
  }, 5000);
}
