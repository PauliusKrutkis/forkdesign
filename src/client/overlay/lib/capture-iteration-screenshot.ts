import { toPng } from "html-to-image";
import { cssEscape } from "./css-escape.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import { isOverlayElement } from "./overlay-dom.ts";
import { effectiveBackgroundColor } from "./screenshot.ts";

async function captureElementPng(anchor: string): Promise<string | null> {
  const el = document.querySelector(
    `[data-comment-anchor="${cssEscape(anchor)}"]`
  );
  if (!(el instanceof HTMLElement)) {
    return null;
  }
  try {
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
    console.warn("[CommentBubble] screenshot capture failed", err);
  }
  return null;
}

async function uploadVersionPng(
  id: string,
  v: number,
  screenshotPng: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/iterations/screenshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, v, screenshotPng }),
    });
    if (!res.ok) {
      console.warn(
        `[CommentBubble] /api/iterations/screenshot returned ${res.status} for v${v}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.warn(
      `[CommentBubble] screenshot upload failed for v${v}; keeping placeholder`,
      err
    );
    return false;
  }
}

/**
 * Capture the anchored element now and POST PNG for iteration version `v`.
 * Used for baseline (`v0`) before agent work.
 */
export async function captureAndUploadVersionNow(args: {
  id: string;
  anchor: string;
  v: number;
}): Promise<boolean> {
  const dataUrl = await captureElementPng(args.anchor);
  if (!dataUrl) {
    console.warn(
      `[CommentBubble] baseline capture: anchor ${args.anchor} not found or empty; skipping v${args.v}.png`
    );
    return false;
  }
  return uploadVersionPng(args.id, args.v, dataUrl);
}

/**
 * After source changes (HMR), capture the element and upload PNG for version `v`.
 * Fix variants (v &gt; 0) use this so thumbnails match the applied design.
 */
export function captureAndUploadVersionAfterHmr(args: {
  id: string;
  anchor: string;
  v: number;
}): Promise<boolean> {
  const { id, anchor, v } = args;

  const captureNow = async (): Promise<boolean> => {
    const dataUrl = await captureElementPng(anchor);
    if (!dataUrl) {
      console.warn(
        `[CommentBubble] post-fix capture: anchor ${anchor} not found; keeping placeholder v${v}.png`
      );
      return false;
    }
    return uploadVersionPng(id, v, dataUrl);
  };

  if (!import.meta.hot) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        captureNow()
          .then(resolve)
          .catch(() => resolve(false));
      }, 400);
    });
  }

  const hot = import.meta.hot;
  return new Promise((resolve) => {
    let done = false;
    let timeoutId: number | undefined;
    let debounceId: number | undefined;
    let fallbackId: number | undefined;

    const finish = (ok: boolean) => {
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
      resolve(ok);
    };

    const run = () => {
      captureNow()
        .then(finish)
        .catch(() => finish(false));
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
          window.requestAnimationFrame(run);
        });
      }, 150);
    };

    const handler = () => {
      if (!done) {
        scheduleCapture();
      }
    };

    hot.on("vite:afterUpdate", handler);
    fallbackId = window.setTimeout(scheduleCapture, 400);
    timeoutId = window.setTimeout(() => {
      console.warn(
        `[CommentBubble] post-fix capture: HMR did not fire within 5s; keeping placeholder v${v}.png`
      );
      finish(false);
    }, 5000);
  });
}

async function activateIterationVersion(
  id: string,
  v: number
): Promise<boolean> {
  try {
    const res = await fetch("/api/iterations/activate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, v }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Replace v0-placeholder PNGs for each fix variant with a capture of that
 * version on the page. Baseline (v0) is never touched here.
 */
export async function captureFixVariantScreenshots(args: {
  id: string;
  anchor: string;
  versions: number[];
  activeV: number;
}): Promise<void> {
  const fixVersions = args.versions.filter((v) => v > 0);
  if (fixVersions.length === 0) {
    return;
  }

  const others = fixVersions.filter((v) => v !== args.activeV);

  await captureAndUploadVersionAfterHmr({
    id: args.id,
    anchor: args.anchor,
    v: args.activeV,
  });

  for (const v of others.toSorted((a, b) => a - b)) {
    if (!(await activateIterationVersion(args.id, v))) {
      console.warn(
        `[CommentBubble] failed to activate v${v} for screenshot capture`
      );
      continue;
    }
    await captureAndUploadVersionAfterHmr({
      id: args.id,
      anchor: args.anchor,
      v,
    });
  }

  if (others.length > 0) {
    await activateIterationVersion(args.id, args.activeV);
  }
}

/** Fire-and-forget variant captures after a successful fix run. */
export function scheduleFixVariantScreenshots(
  args: Parameters<typeof captureFixVariantScreenshots>[0] & {
    onDone?: () => void;
  }
): void {
  const { onDone, ...captureArgs } = args;
  captureFixVariantScreenshots(captureArgs)
    .then(() => onDone?.())
    .catch(ignorePromiseRejection);
}
