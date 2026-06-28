import { postJson } from "./api.ts";
import { cssEscape } from "./css-escape.ts";
import { captureElementToPng } from "./screenshot.ts";

const FALLBACK_CAPTURE_DELAY_MS = 900;
const RENDER_UPDATE_TIMEOUT_MS = 5000;
const RENDER_POLL_MS = 50;
const SETTLE_FRAME_LIMIT = 8;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => resolve())
  );
}

/**
 * Resolve the DOM element for `anchor` at the given `instance` index. A single
 * source element can render many times (a `.map()` list, a shared component),
 * so all copies carry the same `data-comment-anchor`. We capture the instance
 * the comment is actually anchored to — `querySelector` would always grab the
 * first copy, which may be off-screen (→ blank PNG) or a different render than
 * the one the user commented on (→ wrong thumbnail). Falls back to the first
 * match when the requested index is gone (DOM order shifted).
 */
function anchorElement(anchor: string, instance = 0): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(
    `[data-comment-anchor="${cssEscape(anchor)}"]`
  );
  const el = matches[instance] ?? matches[0] ?? null;
  return el instanceof HTMLElement ? el : null;
}

export function anchorRenderSignature(
  anchor: string,
  instance = 0
): string | null {
  const el = anchorElement(anchor, instance);
  if (!el) {
    return null;
  }
  const rect = el.getBoundingClientRect();
  return JSON.stringify({
    anchor: el.getAttribute("data-comment-anchor"),
    childElementCount: el.childElementCount,
    className: el.getAttribute("class"),
    tagName: el.tagName,
    textSample: el.textContent?.slice(0, 80) ?? "",
    textLength: el.textContent?.length ?? 0,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  });
}

async function waitForStableRender(
  anchor: string,
  instance = 0
): Promise<void> {
  let previous = anchorRenderSignature(anchor, instance);

  for (let i = 0; i < SETTLE_FRAME_LIMIT; i += 1) {
    await nextFrame();
    const current = anchorRenderSignature(anchor, instance);
    if (current && current === previous) {
      await nextFrame();
      return;
    }
    previous = current;
  }
}

async function waitForVersionRender(args: {
  anchor: string;
  instance?: number;
  previousSignature?: string | null;
}): Promise<void> {
  const instance = args.instance ?? 0;
  const hot = import.meta.hot;
  const hasHotEvents =
    typeof hot?.on === "function" && typeof hot.off === "function";
  let hmrSeen = false;
  const onHmr = () => {
    hmrSeen = true;
  };

  if (hasHotEvents) {
    hot.on("vite:afterUpdate", onHmr);
  }

  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < RENDER_UPDATE_TIMEOUT_MS) {
      await nextFrame();
      const currentSignature = anchorRenderSignature(args.anchor, instance);
      if (
        args.previousSignature &&
        currentSignature &&
        currentSignature !== args.previousSignature
      ) {
        break;
      }
      if (!args.previousSignature && hmrSeen) {
        break;
      }
      if (
        !args.previousSignature &&
        Date.now() - startedAt >= FALLBACK_CAPTURE_DELAY_MS
      ) {
        break;
      }
      await delay(RENDER_POLL_MS);
    }
  } finally {
    if (hasHotEvents) {
      hot.off("vite:afterUpdate", onHmr);
    }
  }

  await waitForStableRender(args.anchor, instance);
}

function captureElementPng(
  anchor: string,
  instance = 0
): Promise<string | null> {
  const el = anchorElement(anchor, instance);
  if (!el) {
    return Promise.resolve(null);
  }
  return captureElementToPng(el, "[CommentBubble] screenshot capture failed");
}

async function uploadVersionPng(
  id: string,
  v: number,
  screenshotPng: string
): Promise<boolean> {
  try {
    const res = await postJson("/api/iterations/screenshot", {
      id,
      v,
      screenshotPng,
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
  instance?: number;
  v: number;
}): Promise<boolean> {
  const dataUrl = await captureElementPng(args.anchor, args.instance ?? 0);
  if (!dataUrl) {
    console.warn(
      `[CommentBubble] baseline capture: anchor ${args.anchor} not found or empty; skipping v${args.v}.png`
    );
    return false;
  }
  return uploadVersionPng(args.id, args.v, dataUrl);
}

/**
 * After source changes (HMR), capture the element PNG for version `v` without uploading.
 */
export async function captureVersionPngAfterHmr(args: {
  anchor: string;
  instance?: number;
  previousSignature?: string | null;
}): Promise<string | null> {
  const instance = args.instance ?? 0;
  await waitForVersionRender({
    anchor: args.anchor,
    instance,
    previousSignature: args.previousSignature,
  });
  return captureElementPng(args.anchor, instance);
}

/**
 * After source changes (HMR), capture the element and upload PNG for version `v`.
 * Agent variants (v &gt; 0) use this so thumbnails match the applied design.
 */
export function captureAndUploadVersionAfterHmr(args: {
  id: string;
  anchor: string;
  instance?: number;
  previousSignature?: string | null;
  v: number;
}): Promise<boolean> {
  const { id, anchor, previousSignature, v } = args;
  const instance = args.instance ?? 0;

  const captureNow = async (): Promise<boolean> => {
    const dataUrl = await captureVersionPngAfterHmr({
      anchor,
      instance,
      previousSignature,
    });
    if (!dataUrl) {
      console.warn(
        `[CommentBubble] post-agent capture: anchor ${anchor} not found; keeping placeholder v${v}.png`
      );
      return false;
    }
    return uploadVersionPng(id, v, dataUrl);
  };

  if (!import.meta.hot) {
    return captureNow().catch(() => false);
  }

  return captureNow().catch(() => false);
}

/**
 * Capture and upload a thumbnail for agent variant `v` when that version is
 * already live on the page (user switched, or the run applied it). Does not
 * rewrite source — avoids the flash-and-revert of forCapture activates.
 */
export async function capturePendingVersionScreenshot(args: {
  id: string;
  anchor: string;
  instance?: number;
  previousSignature?: string | null;
  v: number;
}): Promise<boolean> {
  if (args.v <= 0) {
    return false;
  }
  return captureAndUploadVersionAfterHmr(args);
}
