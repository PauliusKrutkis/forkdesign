import { toPng } from "html-to-image";
import { SquareDashedMousePointer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_FIX_VERSION_COUNT } from "../../shared/fix-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import { Button } from "../ui/button.tsx";
import {
  CommentComposerBar,
  type ComposerMode,
} from "./comment-composer-bar.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { toErrorMessage } from "./lib/errors.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { isOverlayElement } from "./lib/overlay-dom.ts";
import { effectiveBackgroundColor } from "./lib/screenshot.ts";

export interface ComposerSubmission {
  /** anchor uuid assigned to the targeted element */
  anchor: string;
  /** anchor point (page x/y of the click) for positioning the panel */
  clickPoint: { x: number; y: number };
  /** Fix model when `runAgent` is set; defaults to overlay settings. */
  model?: OverlayModel;
  /** submitted in Agent mode — create the comment, then run the agent on it */
  runAgent?: boolean;
  /**
   * Optional `data:image/png;base64,...` capture of the targeted element's
   * bounding box (Comment mode only). Agent mode omits this; baseline `v0`
   * is captured immediately before the agent run instead.
   */
  screenshotPng?: string;
  /** the element that was clicked to seed the comment */
  target: HTMLElement;
  /** the typed body */
  text: string;
  /** variant count to generate when `runAgent` is set */
  versionCount?: number;
  /** the slug of the nearest data-view ancestor, if any */
  view: string | undefined;
}

/**
 * Outcome of an async submission. The composer panel uses this to drive its
 * inline saving/saved/error UI without the parent having to mount its own
 * status surface.
 */
export type ComposerSubmitResult = { ok: true } | { ok: false; error: string };

interface CommentComposerProps {
  /** when true, the composer mode is active (highlight + capture next click) */
  active: boolean;
  fixModel: OverlayModel;
  /** turn composer mode off */
  onCancel: () => void;
  onFixModelChange: (model: OverlayModel) => void;
  /**
   * Invoked when the user submits a comment. Returns a Promise so the
   * composer can show inline "saving"/"saved"/"error" states. On a failed
   * submission the textarea content is preserved so the user can retry or
   * pick a different target.
   */
  onSubmit: (entry: ComposerSubmission) => Promise<ComposerSubmitResult>;
}

const PANEL_WIDTH = 400;
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
  fixModel,
  onFixModelChange,
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
    if (!active || target) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }

    const highlight = (el: HTMLElement | null) => {
      const node = highlightRef.current;
      if (!node) {
        return;
      }
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
      if (el && !isOverlayElement(el)) {
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
      if (!target || isOverlayElement(target)) {
        return false;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    };

    const onClick = (e: MouseEvent) => {
      if (!swallow(e)) {
        return;
      }
      const el = pickTarget(e.clientX, e.clientY);
      if (!el) {
        return;
      }
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
      if (e.key === "Escape") {
        onCancel();
      }
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

  if (!active) {
    return null;
  }

  return (
    <>
      {/* hover highlight; absolute over the page using viewport coordinates */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[9300] hidden outline-dashed outline-2 outline-ring outline-offset-2"
        data-comment-overlay="true"
        ref={highlightRef}
        style={{ display: "none" }}
      />
      {target ? (
        <ComposerPanel
          clickPoint={target.clickPoint}
          fixModel={fixModel}
          onCancel={() => {
            setTarget(null);
            setText("");
          }}
          onFixModelChange={onFixModelChange}
          onSaved={() => {
            // Defer the reset slightly so the "saved" pill is visible.
            window.setTimeout(() => {
              setTarget(null);
              setText("");
            }, 600);
          }}
          onSubmit={async ({ runAgent, versionCount, model }) => {
            const trimmed = text.trim();
            if (!trimmed) {
              return { ok: false, error: "empty body" };
            }
            const anchor = ensureAnchor(target.el);
            const view =
              target.el.closest("[data-view]")?.getAttribute("data-view") ??
              undefined;
            const screenshotPng = runAgent
              ? undefined
              : await captureElementScreenshot(target.el);
            const result = await onSubmit({
              anchor,
              target: target.el,
              clickPoint: target.clickPoint,
              view,
              text: trimmed,
              runAgent,
              versionCount,
              ...(model ? { model } : {}),
              ...(screenshotPng ? { screenshotPng } : {}),
            });
            return result;
          }}
          onTextChange={setText}
          target={target.el}
          text={text}
          textareaRef={textareaRef}
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
  fixModel,
  onFixModelChange,
  onTextChange,
  onCancel,
  onSubmit,
  onSaved,
}: {
  target: HTMLElement;
  clickPoint: { x: number; y: number };
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fixModel: OverlayModel;
  onFixModelChange: (model: OverlayModel) => void;
  onTextChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: (opts: {
    runAgent: boolean;
    versionCount: number;
    model: OverlayModel;
  }) => Promise<ComposerSubmitResult>;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ComposerPanelStatus>({ kind: "idle" });
  const [mode, setMode] = useState<ComposerMode>("agent");
  const [versionCount, setVersionCount] = useState(DEFAULT_FIX_VERSION_COUNT);

  // Anchor the composer panel to the user's click point, not to the target
  // element's bounding box — for page-wide elements whose `bottom` is below
  // the viewport, anchoring to the element would push the panel off-screen.
  // Estimated panel height covers header + composer.
  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight;
  const ESTIMATED_PANEL_HEIGHT = 220;
  const desiredLeft = clickPoint.x - PANEL_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(desiredLeft, viewportW - PANEL_WIDTH - VIEWPORT_PADDING)
  );
  // Prefer placing below the click point; if the click is near the viewport
  // bottom and the panel would clip, flip above.
  const desiredTop = clickPoint.y + 12;
  const top =
    desiredTop + ESTIMATED_PANEL_HEIGHT + VIEWPORT_PADDING > viewportH
      ? Math.max(VIEWPORT_PADDING, clickPoint.y - ESTIMATED_PANEL_HEIGHT - 12)
      : desiredTop;

  const submitting = status.kind === "saving";

  // Escape cancels the panel. Registered on the document because the global
  // overlay keydown ignores keys while a text input is focused, and the
  // composer textarea holds focus here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (submitting || status.kind === "saved" || !text.trim()) {
      return;
    }
    setStatus({ kind: "saving" });
    let result: ComposerSubmitResult;
    try {
      result = await onSubmit({
        runAgent: mode === "agent",
        versionCount,
        model: fixModel,
      });
    } catch (err) {
      setStatus({ kind: "error", message: toErrorMessage(err) });
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
      className="pointer-events-auto fixed z-[9300] flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      data-comment-overlay="true"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, top, width: PANEL_WIDTH }}
    >
      {/* Header — orients the user: what they're doing (left), which element
          the note is anchored to (middle), and a way out (right). */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b pr-1 pl-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <SquareDashedMousePointer
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
          <span className="font-medium text-foreground text-xs">
            New comment
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="max-w-[150px] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground leading-none"
            title={describeElement(target)}
          >
            {describeElement(target)}
          </span>
          <HotkeyTip keys="Esc" label="Cancel">
            <Button
              aria-label="Cancel"
              className="h-7 w-7 shrink-0"
              disabled={submitting}
              onClick={onCancel}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </HotkeyTip>
        </div>
      </div>

      <CommentComposerBar
        busy={submitting}
        error={status.kind === "error" ? status.message : null}
        fixModel={fixModel}
        fixVersionCount={versionCount}
        iterating={false}
        mode={mode}
        onChange={onTextChange}
        onFixModelChange={onFixModelChange}
        onFixVersionCountChange={setVersionCount}
        onModeChange={setMode}
        onSubmit={() => {
          submit().catch(ignorePromiseRejection);
        }}
        textareaRef={textareaRef}
        value={text}
      />
    </div>
  );
}

function describeElement(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) {
    return aria;
  }
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    return `${tag} #${el.id}`;
  }
  const testId = el.getAttribute("data-testid");
  if (testId) {
    return `${tag} · ${testId}`;
  }
  return tag;
}

/** Returns the topmost element under the cursor that isn't part of overlay chrome. */
function pickTarget(x: number, y: number): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (isOverlayElement(node)) {
      continue;
    }
    return node;
  }
  return null;
}

/**
 * Ensures the targeted element carries a `data-comment-anchor` attribute,
 * minting one if needed. In real flow (W4 write path) the Vite plugin will
 * persist this attribute back into source; for now we just stamp the DOM
 * so the dot has something to anchor to during this session.
 */
function ensureAnchor(el: HTMLElement): string {
  const existing = el.getAttribute("data-comment-anchor");
  if (existing) {
    return existing;
  }
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
  el: HTMLElement
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
      filter: (node) =>
        !isOverlayElement(node instanceof Element ? node : null),
      cacheBust: true,
    });
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      return;
    }
    return dataUrl;
  } catch (err) {
    console.warn(
      "[CommentComposer] screenshot capture failed; submitting without it",
      err
    );
    return;
  }
}

function randomUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes — good enough for dev seeds.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r % 4) + 8;
    return v.toString(16);
  });
}
