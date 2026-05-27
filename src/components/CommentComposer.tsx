import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Kbd, ctrlKey } from "./Kbd";
import { PROMPT_SHORTCUTS } from "./promptTemplates";
import { effectiveBackgroundColor } from "./screenshot";

export type ComposerSubmission = {
  /** anchor uuid assigned to the targeted element */
  anchor: string;
  /** the element that was clicked to seed the comment */
  target: HTMLElement;
  /** anchor point (page x/y of the click) for positioning the panel */
  clickPoint: { x: number; y: number };
  /** the slug of the nearest data-view ancestor, if any */
  view: string | undefined;
  /** the typed body */
  text: string;
  /**
   * Optional `data:image/png;base64,...` capture of the targeted element's
   * bounding box. Undefined when the client-side capture failed (cross-origin
   * image, font load race, etc.) — the server will save the comment without
   * a screenshot rather than fail the request.
   */
  screenshotPng?: string;
};

/**
 * Outcome of an async submission. The composer panel uses this to drive its
 * inline saving/saved/error UI without the parent having to mount its own
 * status surface.
 */
export type ComposerSubmitResult =
  | { ok: true }
  | { ok: false; error: string };

type CommentComposerProps = {
  /** when true, the composer mode is active (highlight + capture next click) */
  active: boolean;
  /** turn composer mode off */
  onCancel: () => void;
  /**
   * Invoked when the user submits a comment. Returns a Promise so the
   * composer can show inline "saving"/"saved"/"error" states. On a failed
   * submission the textarea content is preserved so the user can retry or
   * pick a different target.
   */
  onSubmit: (entry: ComposerSubmission) => Promise<ComposerSubmitResult>;
};

const PANEL_WIDTH = 320;
const VIEWPORT_PADDING = 12;

/**
 * Two-phase capture:
 *   1. While `active` and no target picked: hover highlights any element under
 *      the cursor with a dashed outline; click freezes that element as the
 *      composer target.
 *   2. With a target picked: render a panel near the click point with a
 *      textarea + submit button. Submit calls `onSubmit` (mock for now);
 *      cancel returns to phase 1.
 */
export function CommentComposer({
  active,
  onCancel,
  onSubmit,
}: CommentComposerProps) {
  const [target, setTarget] = useState<{
    el: HTMLElement;
    clickPoint: { x: number; y: number };
  } | null>(null);
  const [text, setText] = useState("");
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset state whenever composer mode flips off.
  useEffect(() => {
    if (!active) {
      setTarget(null);
      setText("");
    }
  }, [active]);

  // Capture: highlight hovered element, suppress click on real UI, freeze on click.
  useEffect(() => {
    if (!active || target) return;
    if (typeof document === "undefined") return;

    const isOverlayChrome = (el: Element | null): boolean => {
      let cur: Element | null = el;
      while (cur) {
        if (
          cur instanceof HTMLElement &&
          cur.dataset.commentOverlay === "true"
        ) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };

    const highlight = (el: HTMLElement | null) => {
      const node = highlightRef.current;
      if (!node) return;
      if (!el) {
        node.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      node.style.display = "block";
      node.style.left = `${r.left}px`;
      node.style.top = `${r.top}px`;
      node.style.width = `${r.width}px`;
      node.style.height = `${r.height}px`;
    };

    const onMove = (e: MouseEvent) => {
      const el = pickTarget(e.clientX, e.clientY);
      if (el && !isOverlayChrome(el)) {
        highlight(el);
      } else {
        highlight(null);
      }
    };

    // Block navigation/app-level handlers (react-router Link, button onClick,
    // form submits, etc.) for ALL pointer events the browser or framework
    // might use to initiate them. We use `stopImmediatePropagation` so any
    // other capture-phase listener on the same target also gets skipped.
    const swallow = (e: Event): boolean => {
      const target =
        e instanceof MouseEvent
          ? pickTarget(e.clientX, e.clientY)
          : (e.target as HTMLElement | null);
      if (!target || isOverlayChrome(target)) return false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    };

    const onClick = (e: MouseEvent) => {
      if (!swallow(e)) return;
      const el = pickTarget(e.clientX, e.clientY);
      if (!el) return;
      highlight(null);
      setTarget({ el, clickPoint: { x: e.clientX, y: e.clientY } });
    };

    const onMouseDown = (e: MouseEvent) => {
      swallow(e);
    };

    const onPointerDown = (e: PointerEvent) => {
      swallow(e);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      highlight(null);
    };
  }, [active, target, onCancel]);

  // Auto-focus textarea once a target is picked.
  useEffect(() => {
    if (target && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [target]);

  if (!active) return null;

  return (
    <>
      {/* hover highlight; absolute over the page using viewport coordinates */}
      <div
        ref={highlightRef}
        data-comment-overlay="true"
        aria-hidden
        className="pointer-events-none fixed z-[9300] hidden outline-dashed outline-2 outline-offset-2 outline-[var(--co-sev-info)]"
        style={{ display: "none" }}
      />
      {target ? (
        <ComposerPanel
          target={target.el}
          clickPoint={target.clickPoint}
          text={text}
          textareaRef={textareaRef}
          onTextChange={setText}
          onCancel={() => {
            setTarget(null);
            setText("");
          }}
          onSubmit={async () => {
            const trimmed = text.trim();
            if (!trimmed) return { ok: false, error: "empty body" };
            const anchor = ensureAnchor(target.el);
            const view =
              target.el.closest("[data-view]")?.getAttribute("data-view") ??
              undefined;
            const screenshotPng = await captureElementScreenshot(target.el);
            const result = await onSubmit({
              anchor,
              target: target.el,
              clickPoint: target.clickPoint,
              view,
              text: trimmed,
              ...(screenshotPng ? { screenshotPng } : {}),
            });
            return result;
          }}
          onSaved={() => {
            // Defer the reset slightly so the "saved" pill is visible.
            window.setTimeout(() => {
              setTarget(null);
              setText("");
            }, 600);
          }}
        />
      ) : null}
    </>
  );
}

type ComposerPanelStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function ComposerPanel({
  target,
  clickPoint,
  text,
  textareaRef,
  onTextChange,
  onCancel,
  onSubmit,
  onSaved,
}: {
  target: HTMLElement;
  clickPoint: { x: number; y: number };
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => Promise<ComposerSubmitResult>;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ComposerPanelStatus>({ kind: "idle" });
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Anchor the composer panel to the user's click point, not to the target
  // element's bounding box — for page-wide elements whose `bottom` is below
  // the viewport, anchoring to the element would push the panel off-screen.
  // Estimated panel height covers header + textarea + action row.
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
  const ESTIMATED_PANEL_HEIGHT = 180;
  const desiredLeft = clickPoint.x - PANEL_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(desiredLeft, viewportW - PANEL_WIDTH - VIEWPORT_PADDING),
  );
  // Prefer placing below the click point; if the click is near the viewport
  // bottom and the panel would clip, flip above.
  const desiredTop = clickPoint.y + 12;
  const top =
    desiredTop + ESTIMATED_PANEL_HEIGHT + VIEWPORT_PADDING > viewportH
      ? Math.max(VIEWPORT_PADDING, clickPoint.y - ESTIMATED_PANEL_HEIGHT - 12)
      : desiredTop;

  const submitting = status.kind === "saving";
  const saved = status.kind === "saved";

  const submit = async () => {
    if (submitting || saved) return;
    if (!text.trim()) return;
    setStatus({ kind: "saving" });
    let result: ComposerSubmitResult;
    try {
      result = await onSubmit();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
      return;
    }
    if (result.ok) {
      setStatus({ kind: "saved" });
      onSaved();
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  };

  return (
    <div
      data-comment-overlay="true"
      className="pointer-events-auto fixed z-[9300] overflow-hidden rounded-[8px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] shadow-lg"
      style={{ left, top, width: PANEL_WIDTH }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="border-b border-[var(--co-line)] bg-[var(--co-surface-2)] px-4 py-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
        New comment
      </div>
      <div className="px-4 py-3">
        <div className="mb-2">
          <button
            type="button"
            disabled={submitting || saved}
            aria-expanded={templatesOpen}
            onClick={() => setTemplatesOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden className="text-[10px] leading-none">
              {templatesOpen ? "⌃" : "⌄"}
            </span>
            Templates
          </button>
          {templatesOpen ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PROMPT_SHORTCUTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={submitting || saved}
                  onClick={() => {
                    onTextChange(prompt);
                    textareaRef.current?.focus();
                  }}
                  className="inline-flex items-center rounded-[var(--co-radius-pill)] border border-[var(--co-line)] bg-[var(--co-surface-3)] px-2.5 py-1 text-[11px] font-medium text-[var(--co-ink-2)] transition-colors hover:border-[var(--co-line-strong)] hover:bg-[var(--co-surface-2)] hover:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {prompt}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder="Leave a note for the next agent…"
          rows={3}
          disabled={submitting || saved}
          className="block w-full resize-y rounded-[4px] border border-[var(--co-line)] bg-[var(--co-surface)] px-2.5 py-2 text-[13px] leading-[1.5] text-[var(--co-ink)] outline-none placeholder:text-[var(--co-ink-4)] focus:border-[var(--co-line-strong)] disabled:cursor-not-allowed disabled:bg-[var(--co-surface-2)]"
          style={{ minHeight: 64 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {status.kind === "error" ? (
          <p
            role="alert"
            className="m-0 mt-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-sev-critical)]"
          >
            {status.message}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--co-line)] bg-[var(--co-surface-2)] px-3 py-2">
        <span className="font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
          {`<${target.tagName.toLowerCase()}>`}
        </span>
        <div className="flex items-center gap-2">
          {saved ? (
            <span className="font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-sev-info)]">
              Saved
            </span>
          ) : null}
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="rounded-[4px] px-2.5 py-1.5 text-[12px] font-medium text-[var(--co-ink-2)] hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:text-[var(--co-ink-4)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void submit();
            }}
            disabled={!text.trim() || submitting || saved}
            className="rounded-[4px] bg-[var(--co-ink)] px-3 py-1.5 text-[12px] font-medium tracking-[0.01em] text-[var(--co-page)] disabled:cursor-not-allowed disabled:bg-[var(--co-ink-4)]"
          >
            {submitting ? "Saving…" : saved ? "Saved" : "Save"}
            {!submitting && !saved ? (
              <Kbd className="!text-[color-mix(in_srgb,var(--co-page)_70%,transparent)] !border-[color-mix(in_srgb,var(--co-page)_30%,transparent)] !bg-[color-mix(in_srgb,var(--co-page)_10%,transparent)]">
                {ctrlKey}
                {ctrlKey === "⌘" ? "" : "+"}⏎
              </Kbd>
            ) : null}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Returns the topmost element under the cursor that isn't part of overlay chrome. */
function pickTarget(x: number, y: number): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) continue;
    if (isOverlayNode(node)) continue;
    return node;
  }
  return null;
}

function isOverlayNode(el: HTMLElement): boolean {
  let cur: HTMLElement | null = el;
  while (cur) {
    if (cur.dataset.commentOverlay === "true") return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Ensures the targeted element carries a `data-comment-anchor` attribute,
 * minting one if needed. In real flow (W4 write path) the Vite plugin will
 * persist this attribute back into source; for now we just stamp the DOM
 * so the dot has something to anchor to during this session.
 */
function ensureAnchor(el: HTMLElement): string {
  const existing = el.getAttribute("data-comment-anchor");
  if (existing) return existing;
  const uuid = randomUuid();
  el.setAttribute("data-comment-anchor", uuid);
  return uuid;
}

/**
 * Render `el`'s bounding box subtree to a PNG data URL using html-to-image.
 *
 * Failure modes we tolerate (return undefined):
 *   - cross-origin <img> / <canvas> taints (CORS errors during foreignObject
 *     rasterisation)
 *   - fonts not yet ready (the rendered text falls back to the system font;
 *     not great, but still a screenshot — we don't actively guard against it)
 *   - browser quirks where foreignObject rendering throws
 *
 * The comment must succeed even when the screenshot doesn't, so we swallow
 * errors and log them rather than propagate.
 */
async function captureElementScreenshot(
  el: HTMLElement,
): Promise<string | undefined> {
  try {
    const pixelRatio =
      (typeof window !== "undefined" && window.devicePixelRatio) || 2;
    const dataUrl = await toPng(el, {
      pixelRatio,
      // Paint the effective page background behind the target before
      // rasterising — transparent elements (most of them) would otherwise
      // capture as see-through and look broken when shown elsewhere.
      backgroundColor: effectiveBackgroundColor(el),
      // Drop the overlay's own chrome from the capture in case it overlaps
      // the target (the highlight + dot live on data-comment-overlay nodes).
      filter: (node) => {
        if (node instanceof HTMLElement) {
          if (node.dataset.commentOverlay === "true") return false;
        }
        return true;
      },
      cacheBust: true,
    });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      return undefined;
    }
    return dataUrl;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[CommentComposer] screenshot capture failed; submitting without it",
      err,
    );
    return undefined;
  }
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — good enough for dev seeds.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
