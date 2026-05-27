import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { effectiveBackgroundColor } from "./screenshot";
import type { RegisteredComment } from "./types";
import { CommentVersionSwitcher } from "./CommentVersionSwitcher";
import { Kbd, ctrlKey } from "./Kbd";
import { dotRect, placeFloater, type FloaterSide } from "./placement";

type CommentBubbleProps = {
  comments: RegisteredComment[];
  rect: DOMRect;
  onClose: () => void;
  onResolve?: (id: string) => void;
  onReply?: (id: string) => void;
};

/** NDJSON event shapes streamed from `POST /api/iterations/new`. */
type IterateProgressEvent = {
  type: "progress";
  /** Where in the pipeline the event was emitted from. */
  stage?: "agent" | "snapshot";
  /** Tool name when the agent invoked one (Read/Edit/Glob/Grep). */
  tool?: string;
  /** Short detail (file path, command, or status string). */
  detail?: string;
};
type IterateDoneEvent =
  | {
      type: "done";
      ok: true;
      id?: string;
      changed?: boolean;
      v?: number;
      tsx?: string;
      png?: string;
      turnsUsed?: number;
      toolCalls?: number;
    }
  | { type: "done"; ok: false; error?: string };
type IterateStreamEvent = IterateProgressEvent | IterateDoneEvent;

const BUBBLE_WIDTH_DETAILED = 320;
const BUBBLE_WIDTH_COMPACT = 280;
const BUBBLE_HEADER_HEIGHT = 36;
const VIEWPORT_PADDING = 12;
/** Conservative estimate for first render; updated by ResizeObserver. */
const INITIAL_BUBBLE_HEIGHT = 280;

type BubbleMode = "compact" | "detailed";

/**
 * Open comment panel. Anchored to the dot (the visual handle on the element),
 * not to the element itself, so placement stays predictable for large
 * containers. Flips to the opposite side when the preferred side has no room.
 */
export function CommentBubble({
  comments,
  rect,
  onClose,
  onResolve,
  onReply,
}: CommentBubbleProps) {
  const lead = comments[0];
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(INITIAL_BUBBLE_HEIGHT);
  /**
   * Once the user grabs the drag handle, the bubble switches to manual
   * positioning. Resets when the bubble unmounts (i.e. when it closes), so
   * each open starts in auto-placement mode. Pointer is hidden in manual
   * mode — it would no longer point at the anchor.
   */
  const [userPosition, setUserPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [viewport, setViewport] = useState(() => readViewport());
  /**
   * Bubble surface mode. Opens in `compact` (text + metadata only) so the
   * user can triage the comment without the full action chrome. Expanding to
   * `detailed` reveals the thumbnail, replies, action row, and iterate
   * status. Auto-expands when the user fires "Fix with AI" — they'll want to
   * watch progress stream — but never auto-collapses (jarring).
   */
  const [mode, setMode] = useState<BubbleMode>("compact");
  const [iterating, setIterating] = useState(false);
  const [iterateError, setIterateError] = useState<string | null>(null);
  /** Most recent progress detail line shown below the action row. */
  const [iterateStatus, setIterateStatus] = useState<string | null>(null);
  /** Run start timestamp (ms) — drives the live elapsed-time counter. */
  const [iterateStartedAt, setIterateStartedAt] = useState<number | null>(null);
  /** Re-renders the elapsed counter once per second while iterating. */
  const [iterateNow, setIterateNow] = useState<number>(() => Date.now());

  // 1Hz tick while iterating so the elapsed counter updates without
  // requiring an external state push for every second.
  useEffect(() => {
    if (!iterating) return;
    const t = window.setInterval(() => setIterateNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [iterating]);

  // Fires the Claude Agent SDK server-side via POST /api/iterations/new.
  // The agent reads the file, locates the anchored element, applies the
  // change, and the server snapshots the post-edit source as the next
  // version. Round-trip is typically 20-90s; the response is NDJSON
  // streamed event-by-event and we surface the latest event as a status line
  // below the action row. HMR fires once the source is rewritten and the
  // switcher refetches to surface the new version.
  const handleIterate = async () => {
    if (!lead || iterating) return;
    // Auto-expand to detailed before kicking off the run so the iterate
    // status row + version switcher have room to surface progress.
    setMode("detailed");
    setIterating(true);
    setIterateError(null);
    setIterateStatus(null);
    setIterateStartedAt(Date.now());
    setIterateNow(Date.now());
    try {
      const res = await fetch("/api/iterations/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lead.id }),
      });
      if (!res.ok || !res.body) {
        // Validation errors (400/404) still come back as plain JSON.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setIterateError(body.error ?? `request failed (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done: IterateDoneEvent | null = null;

      // Stream loop: read chunks, split on newlines, parse each line as
      // JSON, dispatch on `type`. We tolerate empty lines and malformed
      // lines (skip), but a missing `done` event at stream-close is treated
      // as an error so the UI never gets stuck spinning.
      streamLoop: while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          let event: IterateStreamEvent;
          try {
            event = JSON.parse(line) as IterateStreamEvent;
          } catch {
            continue;
          }
          if (event.type === "progress") {
            setIterateStatus(formatProgress(event));
          } else if (event.type === "done") {
            done = event;
            // Drain any remaining buffered bytes in case the server
            // flushed trailing data, then exit.
            break streamLoop;
          }
        }
      }

      if (!done) {
        setIterateError("stream closed without a result");
        return;
      }
      if (!done.ok) {
        setIterateError(done.error ?? "agent failed");
        return;
      }
      if (done.changed === false) {
        setIterateError(
          "AI made no changes — try a more specific instruction",
        );
        return;
      }
      // Success: clear the status line. The version switcher refetches off
      // HMR once the source file is rewritten.
      setIterateStatus(null);

      // Best-effort post-edit screenshot capture. The agent just rewrote the
      // source file, so HMR is about to fire and the DOM will re-render with
      // the new design. We hook the first `vite:afterUpdate` event, wait one
      // animation frame for React to settle, then re-capture the anchored
      // element and POST it to the screenshot endpoint to replace the
      // placeholder v0 copy. Failures here are silent — the placeholder PNG
      // on disk is good enough to fall back to.
      if (done.v !== undefined && done.ok === true && done.changed === true) {
        captureAndUploadV({
          id: lead.id,
          anchor: lead.anchor,
          v: done.v,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIterateError(`network error: ${message}`);
    } finally {
      setIterating(false);
      setIterateStartedAt(null);
    }
  };

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setBubbleHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Hotkeys local to the open bubble — registered only while this component
  // is mounted, so they don't fire when no bubble is open. Esc closes the
  // lightbox first if it's open, else the bubble. Cmd/Ctrl+I fires "Fix
  // with AI", Cmd/Ctrl+R fires "Resolve". Skipped when the user is in a
  // text input (e.g., a future inline reply textarea).
  useEffect(() => {
    if (!lead) return;
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active instanceof HTMLElement && active.isContentEditable));
      if (e.key === "Escape") {
        if (lightboxOpen) {
          setLightboxOpen(false);
          e.preventDefault();
          return;
        }
        onClose();
        e.preventDefault();
        return;
      }
      if (inInput) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (!iterating) void handleIterate();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        onResolve?.(lead.id);
      } else if (e.key === "Tab") {
        // Tab toggles compact/detailed when no modifiers are pressed.
        // Without this guard a stray Tab while the bubble is focused would
        // both shift the page focus AND toggle the mode.
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        setMode((prev) => (prev === "compact" ? "detailed" : "compact"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, lightboxOpen, iterating, onClose, onResolve, handleIterate]);

  const maxBubbleHeight = viewport.height - 2 * VIEWPORT_PADDING;
  const bubbleWidth =
    mode === "compact" ? BUBBLE_WIDTH_COMPACT : BUBBLE_WIDTH_DETAILED;

  // Always anchor the bubble to the dot's position via flip + shift. The pin
  // is 14px regardless of the underlying element's size, so placeFloater can
  // always find a valid placement near it — no center-on-large fallback.
  const placement = useMemo(
    () =>
      placeFloater({
        anchor: dotRect({ right: rect.right, top: rect.top }, viewport),
        size: {
          width: bubbleWidth,
          height: Math.min(bubbleHeight, maxBubbleHeight),
        },
        preferredSide: "bottom",
        viewport,
        padding: VIEWPORT_PADDING,
        gap: 10,
        arrowSafePadding: 18,
      }),
    [rect, bubbleHeight, bubbleWidth, maxBubbleHeight, viewport],
  );

  if (!lead) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Comment"
      data-comment-overlay="true"
      className="pointer-events-auto fixed z-[9200] flex flex-col overflow-hidden rounded-[8px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] shadow-lg transition-[width] duration-200"
      style={{
        left: userPosition?.left ?? placement.left,
        top: userPosition?.top ?? placement.top,
        width: bubbleWidth,
        maxHeight: maxBubbleHeight,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {userPosition === null ? (
        <Pointer side={placement.side} offset={placement.arrowOffset} />
      ) : null}

      {/* Header bar — dedicated drag handle. Three regions: grip glyph (left),
          version switcher (center), close button (right). The whole bar is
          the drag area; buttons inside opt out via the closest('button')
          guard in the pointerdown handler. */}
      <div
        className="relative flex shrink-0 cursor-grab items-center border-b border-[var(--co-line)] bg-[var(--co-surface-2)] active:cursor-grabbing"
        style={{ height: BUBBLE_HEADER_HEIGHT }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) return;
          e.preventDefault();
          const startX = e.clientX;
          const startY = e.clientY;
          const baseLeft = userPosition?.left ?? placement.left;
          const baseTop = userPosition?.top ?? placement.top;
          const onMove = (ev: PointerEvent) => {
            setUserPosition({
              left: baseLeft + ev.clientX - startX,
              top: baseTop + ev.clientY - startY,
            });
          };
          const onUp = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
          };
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
        }}
      >
        {/* Grip glyph: 2×3 dot grid. Standard "drag handle" affordance —
            reads as a dedicated grab area independent of any button. */}
        <span
          aria-hidden
          className="pointer-events-none flex shrink-0 flex-col gap-[2px] pl-3 pr-1"
        >
          <span className="flex gap-[2px]">
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
          </span>
          <span className="flex gap-[2px]">
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
          </span>
          <span className="flex gap-[2px]">
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
            <span className="block h-[2px] w-[2px] rounded-full bg-[color-mix(in_srgb,var(--co-ink)_40%,transparent)]" />
          </span>
        </span>

        {/* Version switcher centered in the bar. */}
        <div className="flex flex-1 items-center justify-center">
          <CommentVersionSwitcher commentId={lead.id} />
        </div>

        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="mr-2 grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[var(--co-ink-2)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
        >
          <span aria-hidden className="text-[15px] leading-none">
            ×
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-3">
        <p
          className={`m-0 whitespace-pre-wrap text-[13px] leading-[1.5] text-[var(--co-ink)] ${
            mode === "compact" ? "line-clamp-3" : ""
          }`}
        >
          {lead.text}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5 font-[var(--co-font-mono)] text-[10.5px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
            <span className="truncate">{lead.author}</span>
            <span className="tabular-nums text-[var(--co-ink-4)]">
              {formatDate(lead.date)}
            </span>
          </div>
          {/* Adaptive thumbnail — detailed only. Compact hides the screenshot
              entirely; the user can access it after expanding. */}
          {mode === "detailed" && lead.screenshot ? (
            <AdaptiveThumb
              src={lead.screenshot}
              onClick={() => setLightboxOpen(true)}
            />
          ) : null}
          {/* Mode toggle chevron. Sits on the right of the metadata row in
              both modes so the affordance is in a consistent spot. In
              detailed mode it lives next to the thumbnail (if any) — both
              are on the right, stacked horizontally. */}
          <ModeToggleButton
            mode={mode}
            onToggle={() =>
              setMode((prev) => (prev === "compact" ? "detailed" : "compact"))
            }
          />
        </div>

        {mode === "detailed" && comments.length > 1 ? (
          <ul className="m-0 mt-3 list-none space-y-2 border-t border-[var(--co-line)] p-0 pt-2">
            {comments.slice(1).map((extra) => (
              <li key={extra.id}>
                <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--co-ink-2)]">
                  {extra.text}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
                  <span className="truncate">{extra.author}</span>
                  <span className="tabular-nums">{formatDate(extra.date)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {mode === "detailed" && lead.replies && lead.replies.length > 0 ? (
          <ul className="m-0 mt-3 list-none space-y-2 border-t border-[var(--co-line)] p-0 pt-2">
            {lead.replies.map((reply, i) => (
              <li key={`${reply.author}-${reply.date}-${i}`}>
                <p className="m-0 text-[12.5px] leading-[1.5] text-[var(--co-ink-2)]">
                  {reply.text}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]">
                  <span className="truncate">{reply.author}</span>
                  <span className="tabular-nums">{formatDate(reply.date)}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {mode === "detailed" && iterating ? (
        <div
          role="status"
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 border-t border-[var(--co-line)] bg-[var(--co-surface-3)] px-4 py-1.5 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em] text-[var(--co-ink-3)]"
        >
          {iterateStartedAt !== null ? (
            <span className="tabular-nums">
              {formatElapsed(iterateNow - iterateStartedAt)}
            </span>
          ) : null}
          <span aria-hidden className="text-[var(--co-ink-4)]">
            ·
          </span>
          <span className="min-w-0 flex-1 truncate">
            {iterateStatus ?? "Working..."}
          </span>
        </div>
      ) : null}

      {mode === "detailed" && iterateError ? (
        <div
          role="alert"
          className="shrink-0 border-t border-[var(--co-line)] bg-[color-mix(in_srgb,var(--co-sev-warning)_10%,transparent)] px-4 py-1.5 text-[11px] leading-[1.4] text-[var(--co-sev-warning)]"
        >
          {iterateError}
        </div>
      ) : null}

      {mode === "detailed" ? (
        <div className="flex shrink-0 items-stretch border-t border-[var(--co-line)]">
          <ActionButton onClick={() => onReply?.(lead.id)}>Reply</ActionButton>
          <span aria-hidden className="w-px bg-[var(--co-line)]" />
          <ActionButton onClick={() => onResolve?.(lead.id)}>
            {lead.resolved ? "Resolved" : "Resolve"}
            {lead.resolved ? null : (
              <Kbd>
                {ctrlKey}
                {ctrlKey === "⌘" ? "" : "+"}R
              </Kbd>
            )}
          </ActionButton>
          <span aria-hidden className="w-px bg-[var(--co-line)]" />
          <ActionButton onClick={handleIterate} disabled={iterating}>
            {iterating ? "Running AI..." : "Fix with AI"}
            {iterating ? null : (
              <Kbd>
                {ctrlKey}
                {ctrlKey === "⌘" ? "" : "+"}I
              </Kbd>
            )}
          </ActionButton>
        </div>
      ) : null}

      {mode === "detailed" && lightboxOpen && lead.screenshot ? (
        <Lightbox
          src={lead.screenshot}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Click-to-enlarge view for the comment's screenshot. Fixed full-viewport
 * backdrop above the bubble (z-9500 > bubble z-9200). Closes on click of the
 * backdrop or Escape. Image is `object-contain`-capped at 80vw/80vh so it
 * respects its natural aspect ratio.
 */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-comment-overlay="true"
      role="dialog"
      aria-label="Comment screenshot"
      className="fixed inset-0 z-[9500] flex items-center justify-center bg-[color-mix(in_srgb,var(--co-ink)_80%,transparent)] p-8"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-h-[80vh] max-w-[80vw] rounded-[4px] border border-white/10 object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        aria-label="Close screenshot"
        onClick={onClose}
        className="absolute right-6 top-6 grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_srgb,var(--co-surface)_90%,transparent)] text-[var(--co-ink-2)] shadow-lg transition-colors hover:bg-[var(--co-surface)] hover:text-[var(--co-ink)]"
      >
        <span aria-hidden className="text-[18px] leading-none">
          ×
        </span>
      </button>
    </div>
  );
}

/**
 * Small triangle that points from the bubble back at the anchor. Rendered as
 * a rotated square that's half-clipped by the bubble's `overflow-hidden`, so
 * the visible silhouette is a 6×6 triangle. Borders pick the two outer edges
 * for the chosen side.
 */
function Pointer({ side, offset }: { side: FloaterSide; offset: number }) {
  // Each side: { position style, visible-edge border classes }
  if (side === "bottom") {
    return (
      <span
        aria-hidden
        className="absolute -top-[7px] block h-3 w-3 rotate-45 border-l border-t border-[var(--co-line-strong)] bg-[var(--co-surface)]"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "top") {
    return (
      <span
        aria-hidden
        className="absolute -bottom-[7px] block h-3 w-3 rotate-45 border-b border-r border-[var(--co-line-strong)] bg-[var(--co-surface)]"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "right") {
    return (
      <span
        aria-hidden
        className="absolute -left-[7px] block h-3 w-3 rotate-45 border-b border-l border-[var(--co-line-strong)] bg-[var(--co-surface)]"
        style={{ top: offset - 6 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="absolute -right-[7px] block h-3 w-3 rotate-45 border-r border-t border-[var(--co-line-strong)] bg-[var(--co-surface)]"
      style={{ top: offset - 6 }}
    />
  );
}

function readViewport() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Expand/collapse chevron for the bubble's mode toggle. Lives at the right
 * edge of the metadata row in both compact and detailed mode so the user
 * has a consistent affordance. The icon flips (⌄ → ⌃) based on the current
 * mode. Includes a Tab kbd hint inline — Tab is the global toggle hotkey
 * when no input is focused.
 */
function ModeToggleButton({
  mode,
  onToggle,
}: {
  mode: BubbleMode;
  onToggle: () => void;
}) {
  const isCompact = mode === "compact";
  return (
    <button
      type="button"
      aria-label={isCompact ? "Expand bubble" : "Collapse bubble"}
      aria-expanded={!isCompact}
      onClick={onToggle}
      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[var(--co-ink-3)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
    >
      <span className="font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.04em]">
        Details
      </span>
      <span aria-hidden className="text-[11px] leading-none">
        {isCompact ? "⌄" : "⌃"}
      </span>
      <Kbd className="ml-0">Tab</Kbd>
    </button>
  );
}

/**
 * Adaptive screenshot thumbnail. Reads the source image's natural
 * dimensions on load and picks a container size based on aspect ratio so
 * neither very wide (heading) nor very tall (sidebar) screenshots get
 * cropped or letterboxed awkwardly.
 *
 * - tiny  (natural < 40px either axis): 24×24 icon
 * - wide  (aspect > 1.3): 80px wide, height clamped 24-48px
 * - tall  (aspect < 0.7): 36px wide, height 60-80px
 * - square (0.7..1.3): 36×36 (legacy behaviour)
 *
 * `object-contain` + `bg-surface-3` letterboxing ensures the actual image is
 * always fully visible; we never crop. Falls back to 36×36 while the image
 * hasn't loaded yet so layout doesn't jump twice.
 */
function AdaptiveThumb({
  src,
  onClick,
}: {
  src: string;
  onClick: () => void;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const dims = useMemo(() => computeThumbDims(natural), [natural]);

  return (
    <button
      type="button"
      aria-label="Show full screenshot"
      onClick={onClick}
      className="block shrink-0 overflow-hidden rounded-[4px] border border-[var(--co-line)] bg-[var(--co-surface-3)] transition-shadow hover:ring-1 hover:ring-[var(--co-line-strong)]"
      style={{ width: dims.width, height: dims.height }}
    >
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
      />
    </button>
  );
}

/**
 * Pick a thumbnail container size from the image's natural dimensions. See
 * AdaptiveThumb for the rule rationale. Returns the legacy 36×36 default
 * pre-load so the row doesn't reflow more than once.
 */
function computeThumbDims(
  natural: { w: number; h: number } | null,
): { width: number; height: number } {
  if (!natural) return { width: 36, height: 36 };
  const { w, h } = natural;
  // Tiny: anything genuinely icon-sized at source. Render as a 24px icon —
  // upscaling beyond that just blurs the source.
  if (w < 40 || h < 40) return { width: 24, height: 24 };
  const aspect = w / h;
  if (aspect > 1.3) {
    // Wide: cap width at 80, derive height (clamped 24-48).
    const width = 80;
    const height = Math.max(24, Math.min(48, Math.round(width / aspect)));
    return { width, height };
  }
  if (aspect < 0.7) {
    // Tall: fix width at 36, derive height (clamped 60-80).
    const width = 36;
    const height = Math.max(60, Math.min(80, Math.round(width / aspect)));
    return { width, height };
  }
  // Square-ish: legacy 36×36.
  return { width: 36, height: 36 };
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 px-2 py-2 text-[11.5px] font-medium text-[var(--co-ink-2)] transition-colors hover:enabled:bg-[var(--co-surface-3)] hover:enabled:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:text-[var(--co-ink-4)]"
    >
      {children}
    </button>
  );
}

/**
 * Best-effort post-edit screenshot capture. After the iteration endpoint
 * succeeds, HMR will fire (Vite picks up the rewritten source file) and the
 * DOM re-renders with the new design. We register a ONE-SHOT listener on
 * `vite:afterUpdate`, wait one rAF for React to commit, locate the anchored
 * element, rasterise it with `html-to-image`, and POST it to the screenshot
 * endpoint to replace the placeholder copy.
 *
 * 5-second timeout: if HMR doesn't fire (file change didn't trigger it, build
 * mode, etc.) we give up. Anchor missing after edit, capture exception, or
 * network failure all degrade silently to a console.warn — the placeholder
 * PNG written server-side is good enough to fall back to.
 */
function captureAndUploadV(args: {
  id: string;
  anchor: string;
  v: number;
}): void {
  const { id, anchor, v } = args;
  if (!import.meta.hot) return;
  const hot = import.meta.hot;

  let done = false;
  let timeoutId: number | undefined;
  const cleanup = () => {
    if (done) return;
    done = true;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    hot.off("vite:afterUpdate", handler);
  };

  const handler = () => {
    if (done) return;
    // One rAF for React to commit the new tree before we measure.
    window.requestAnimationFrame(() => {
      void run();
    });
  };

  const run = async (): Promise<void> => {
    cleanup();
    const el = document.querySelector(
      `[data-comment-anchor="${cssEscape(anchor)}"]`,
    );
    if (!(el instanceof HTMLElement)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[CommentBubble] post-iterate capture: anchor ${anchor} not found in DOM; keeping placeholder v${v}.png`,
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
        // Mirror the composer: paint the effective page background so
        // transparent elements (most) don't capture as see-through.
        backgroundColor: effectiveBackgroundColor(el),
        // Match the composer: drop overlay chrome (bubble, dots, highlight)
        // from the capture so the screenshot reflects only the user-facing
        // design, not our own UI.
        filter: (node) => {
          if (node instanceof HTMLElement) {
            if (node.dataset.commentOverlay === "true") return false;
          }
          return true;
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CommentBubble] post-iterate screenshot capture failed; keeping placeholder",
        err,
      );
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CommentBubble] post-iterate capture produced no PNG; keeping placeholder",
      );
      return;
    }
    try {
      const res = await fetch("/api/iterations/screenshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, v, screenshotPng: dataUrl }),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[CommentBubble] /api/iterations/screenshot returned ${res.status}; keeping placeholder`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CommentBubble] post-iterate screenshot upload failed; keeping placeholder",
        err,
      );
    }
  };

  hot.on("vite:afterUpdate", handler);
  timeoutId = window.setTimeout(() => {
    if (done) return;
    cleanup();
    // eslint-disable-next-line no-console
    console.warn(
      `[CommentBubble] post-iterate capture: HMR did not fire within 5s; keeping placeholder v${v}.png`,
    );
  }, 5000);
}

/** CSS.escape polyfill-safe wrapper for `data-comment-anchor` selectors. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Format an NDJSON progress event into a short user-readable status string.
 * Examples: "Read src/pages/Foo.tsx", "Edit src/Bar.tsx:42", "thinking",
 * "writing v2.tsx". Falls back to "Working..." when the event carries no
 * useful detail (e.g. an `assistant` turn with no tool call).
 */
function formatProgress(event: IterateProgressEvent): string {
  const { tool, detail } = event;
  if (tool && detail) return `${tool} ${detail}`;
  if (tool) return tool;
  if (detail) return detail;
  return "Working...";
}

/** "0:23" / "1:04" style elapsed-time formatter. */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
