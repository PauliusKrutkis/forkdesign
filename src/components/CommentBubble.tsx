import { toPng } from "html-to-image";
import {
  CheckCircle2,
  GripVertical,
  Loader2,
  MessageSquareReply,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/utils";
import { CommentVersionSwitcher } from "./CommentVersionSwitcher";
import { HotkeyTip } from "./HotkeyTip";
import { dotRect, type FloaterSide, placeFloater } from "./placement";
import { ShortcutHint, withCtrl } from "./ShortcutHint";
import { effectiveBackgroundColor } from "./screenshot";
import type { OverlayModel } from "./settings";
import type { CommentReply, RegisteredComment } from "./types";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface CommentBubbleProps {
  comments: RegisteredComment[];
  fixModel?: OverlayModel;
  onClose: () => void;
  onDelete?: (id: string) => Promise<void>;
  onDeleteReply?: (id: string, replyIndex: number) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onResolve?: (id: string) => void;
  onSubmitReply?: (id: string, text: string) => Promise<void>;
  rect: DOMRect;
  skipDeleteConfirmation?: boolean;
}

/** NDJSON event shapes streamed from `POST /api/iterations/new`. */
interface IterateProgressEvent {
  /** Short detail (file path, command, or status string). */
  detail?: string;
  /** Where in the pipeline the event was emitted from. */
  stage?: "agent" | "snapshot";
  /** Tool name when the agent invoked one (Read/Edit/Glob/Grep). */
  tool?: string;
  type: "progress";
}
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
  fixModel = "default",
  skipDeleteConfirmation = false,
  onClose,
  onResolve,
  onDelete,
  onEdit,
  onSubmitReply,
  onEditReply,
  onDeleteReply,
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
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 1Hz tick while iterating so the elapsed counter updates without
  // requiring an external state push for every second.
  useEffect(() => {
    if (!iterating) {
      return;
    }
    const t = window.setInterval(() => setIterateNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [iterating]);

  useEffect(() => {
    if (editing) {
      editTextareaRef.current?.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (replyOpen) {
      replyTextareaRef.current?.focus();
    }
  }, [replyOpen]);

  const startEditing = () => {
    if (!(lead && onEdit)) {
      return;
    }
    setMode("detailed");
    setEditing(true);
    setEditDraft(lead.text);
    setEditError(null);
    setReplyOpen(false);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditDraft("");
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!(lead && onEdit) || editBusy) {
      return;
    }
    const trimmed = editDraft.trim();
    if (!trimmed) {
      setEditError("Comment cannot be empty");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await onEdit(lead.id, trimmed);
      setEditing(false);
      setEditDraft("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditBusy(false);
    }
  };

  const openReplyComposer = () => {
    setMode("detailed");
    setReplyOpen(true);
    setReplyDraft("");
    setReplyError(null);
    setEditing(false);
  };

  const cancelReply = () => {
    setReplyOpen(false);
    setReplyDraft("");
    setReplyError(null);
  };

  const saveReply = async () => {
    if (!(lead && onSubmitReply) || replyBusy) {
      return;
    }
    const trimmed = replyDraft.trim();
    if (!trimmed) {
      setReplyError("Reply cannot be empty");
      return;
    }
    setReplyBusy(true);
    setReplyError(null);
    try {
      await onSubmitReply(lead.id, trimmed);
      setReplyOpen(false);
      setReplyDraft("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplyBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!(lead && onDelete) || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDelete(lead.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
      setDeleteConfirming(false);
    }
  };

  const requestDelete = () => {
    if (!(lead && onDelete) || deleteBusy) {
      return;
    }
    setDeleteError(null);
    if (skipDeleteConfirmation) {
      void confirmDelete();
      return;
    }
    setMode("detailed");
    setDeleteConfirming(true);
  };

  const cancelDeleteConfirm = () => {
    setDeleteConfirming(false);
  };

  // Fires the selected fix strategy server-side via POST /api/iterations/new.
  // The agent reads the file, locates the anchored element, applies the
  // change, and the server snapshots the post-edit source as the next
  // version. Round-trip is typically 20-90s; the response is NDJSON
  // streamed event-by-event and we surface the latest event as a status line
  // below the action row. HMR fires once the source is rewritten and the
  // switcher refetches to surface the new version.
  const handleIterate = async () => {
    if (!lead || iterating) {
      return;
    }
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
        body: JSON.stringify({ id: lead.id, model: fixModel }),
      });
      if (!(res.ok && res.body)) {
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
        if (streamDone) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) {
            continue;
          }
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
        setIterateError("AI made no changes — try a more specific instruction");
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
    if (!el) {
      return;
    }
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
    if (!lead) {
      return;
    }
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
        if (deleteConfirming) {
          cancelDeleteConfirm();
          e.preventDefault();
          return;
        }
        onClose();
        e.preventDefault();
        return;
      }
      if (inInput) {
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey);
      const key = e.key.toLowerCase();
      if (deleteConfirming) {
        if (plain && key === "enter") {
          e.preventDefault();
          void confirmDelete();
          return;
        }
        if (mod && e.key === "Backspace") {
          e.preventDefault();
          void confirmDelete();
          return;
        }
      }
      if (mod && key === "i") {
        e.preventDefault();
        if (!iterating) {
          void handleIterate();
        }
      } else if (mod && key === "r") {
        e.preventDefault();
        onResolve?.(lead.id);
      } else if (mod && e.key === "Backspace") {
        // Destructive, so it takes a modifier — opens the inline confirm
        // (or deletes outright when confirmation is skipped).
        if (onDelete) {
          e.preventDefault();
          requestDelete();
        }
      } else if (plain && key === "e") {
        if (onEdit) {
          e.preventDefault();
          startEditing();
        }
      } else if (plain && key === "r") {
        if (onSubmitReply) {
          e.preventDefault();
          openReplyComposer();
        }
      } else if (e.key === "Tab") {
        // Tab toggles compact/detailed when no modifiers are pressed.
        // Without this guard a stray Tab while the bubble is focused would
        // both shift the page focus AND toggle the mode.
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
          return;
        }
        e.preventDefault();
        setMode((prev) => (prev === "compact" ? "detailed" : "compact"));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    lead,
    lightboxOpen,
    iterating,
    onClose,
    onResolve,
    onDelete,
    onEdit,
    onSubmitReply,
    deleteConfirming,
    handleIterate,
    startEditing,
    openReplyComposer,
    requestDelete,
    confirmDelete,
    cancelDeleteConfirm,
  ]);

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
    [rect, bubbleHeight, bubbleWidth, maxBubbleHeight, viewport]
  );

  if (!lead) {
    return null;
  }

  return (
    <div
      aria-label="Comment"
      className="pointer-events-auto fixed z-[9200] flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg transition-[width] duration-200"
      data-comment-overlay="true"
      onClick={(e) => e.stopPropagation()}
      ref={containerRef}
      role="dialog"
      style={{
        left: userPosition?.left ?? placement.left,
        top: userPosition?.top ?? placement.top,
        width: bubbleWidth,
        maxHeight: maxBubbleHeight,
      }}
    >
      {userPosition === null ? (
        <Pointer offset={placement.arrowOffset} side={placement.side} />
      ) : null}

      {/* Header bar — dedicated drag handle. Three regions: grip glyph (left),
          version switcher (center), close button (right). The whole bar is
          the drag area; buttons inside opt out via the closest('button')
          guard in the pointerdown handler. */}
      <div
        className="relative flex shrink-0 cursor-grab items-center border-b active:cursor-grabbing"
        onPointerDown={(e) => {
          if ((e.target as Element).closest("button")) {
            return;
          }
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
        style={{ height: BUBBLE_HEADER_HEIGHT }}
      >
        <GripVertical
          aria-hidden
          className="pointer-events-none ml-2 h-4 w-4 shrink-0 text-muted-foreground"
        />

        {/* Version switcher centered in the bar. */}
        <div className="flex flex-1 items-center justify-center">
          <CommentVersionSwitcher commentId={lead.id} />
        </div>

        <HotkeyTip keys="Esc" label="Close" side="bottom">
          <Button
            aria-label="Close"
            className="mr-1 h-7 w-7 shrink-0"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </HotkeyTip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-3">
        {/* Comment + screenshot as a media object: in detailed mode the text
            wraps beside the thumbnail; compact hides the thumbnail entirely. */}
        <div className="flex items-start gap-3">
          {editing ? (
            <div className="min-w-0 flex-1 space-y-2">
              <Textarea
                aria-label="Edit comment"
                className="min-h-[72px] resize-none text-sm leading-relaxed"
                disabled={editBusy}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void saveEdit();
                  }
                }}
                ref={editTextareaRef}
                value={editDraft}
              />
              <div className="flex items-center justify-end gap-1.5">
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={editBusy}
                  onClick={cancelEditing}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={editBusy}
                  onClick={() => void saveEdit()}
                  size="sm"
                  type="button"
                >
                  {editBusy ? (
                    "Saving…"
                  ) : (
                    <>
                      Save
                      <ShortcutHint onPrimary>{withCtrl("⏎")}</ShortcutHint>
                    </>
                  )}
                </Button>
              </div>
              {editError ? (
                <p className="m-0 text-destructive text-xs">{editError}</p>
              ) : null}
            </div>
          ) : (
            <p
              className={cn(
                "m-0 min-w-0 flex-1 whitespace-pre-wrap text-foreground text-sm leading-relaxed",
                mode === "compact" && "line-clamp-3"
              )}
            >
              {lead.text}
            </p>
          )}
          {mode === "detailed" && lead.screenshot && !editing ? (
            <AdaptiveThumb
              onClick={() => setLightboxOpen(true)}
              src={lead.screenshot}
            />
          ) : null}
        </div>

        {/* Attribution (left) · edit + expand toggle (right) */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <Attribution author={lead.author} date={lead.date} />
          <div className="flex shrink-0 items-center gap-0.5">
            {onEdit && !editing ? (
              <HotkeyTip keys="E" label="Edit">
                <Button
                  className="h-auto px-1.5 py-1 text-xs"
                  onClick={startEditing}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Edit
                </Button>
              </HotkeyTip>
            ) : null}
            <ModeToggleButton
              mode={mode}
              onToggle={() =>
                setMode((prev) => (prev === "compact" ? "detailed" : "compact"))
              }
            />
          </div>
        </div>

        {mode === "detailed" && comments.length > 1 ? (
          <ul className="m-0 mt-3 list-none space-y-2.5 border-t p-0 pt-3">
            {comments.slice(1).map((extra) => (
              <li key={extra.id}>
                <p className="m-0 text-muted-foreground text-sm leading-snug">
                  {extra.text}
                </p>
                <Attribution
                  author={extra.author}
                  className="mt-1"
                  date={extra.date}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {mode === "detailed" && lead.replies && lead.replies.length > 0 ? (
          <ul className="m-0 mt-3 list-none space-y-2.5 border-t p-0 pt-3">
            {lead.replies.map((reply, i) => (
              <ReplyItem
                commentId={lead.id}
                key={`${reply.author}-${reply.date}-${i}`}
                onDelete={onDeleteReply}
                onEdit={onEditReply}
                onInteraction={() => {
                  setEditing(false);
                  setReplyOpen(false);
                  setDeleteConfirming(false);
                }}
                reply={reply}
                replyIndex={i}
                skipDeleteConfirmation={skipDeleteConfirmation}
              />
            ))}
          </ul>
        ) : null}

        {mode === "detailed" && replyOpen ? (
          <div className="mt-3 space-y-2 border-t pt-3">
            <Textarea
              aria-label="Reply"
              className="min-h-[64px] resize-none text-sm leading-relaxed"
              disabled={replyBusy}
              onChange={(e) => setReplyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void saveReply();
                }
              }}
              placeholder="Write a reply…"
              ref={replyTextareaRef}
              value={replyDraft}
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                className="h-7 px-2 text-xs"
                disabled={replyBusy}
                onClick={cancelReply}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button
                className="h-7 px-2 text-xs"
                disabled={replyBusy}
                onClick={() => void saveReply()}
                size="sm"
                type="button"
              >
                {replyBusy ? (
                  "Saving…"
                ) : (
                  <>
                    Save reply
                    <ShortcutHint onPrimary>{withCtrl("⏎")}</ShortcutHint>
                  </>
                )}
              </Button>
            </div>
            {replyError ? (
              <p className="m-0 text-destructive text-xs">{replyError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "detailed" && iterating ? (
        <div
          aria-live="polite"
          className="flex shrink-0 items-center gap-2 border-t bg-muted/50 px-4 py-1.5 text-muted-foreground text-xs"
          role="status"
        >
          {iterateStartedAt === null ? null : (
            <span className="tabular-nums">
              {formatElapsed(iterateNow - iterateStartedAt)}
            </span>
          )}
          <span aria-hidden>·</span>
          <span className="min-w-0 flex-1 truncate">
            {iterateStatus ?? "Working..."}
          </span>
        </div>
      ) : null}

      {mode === "detailed" && iterateError ? (
        <div
          className="shrink-0 border-t bg-amber-500/10 px-4 py-1.5 text-amber-700 text-xs"
          role="alert"
        >
          {iterateError}
        </div>
      ) : null}

      {mode === "detailed" ? (
        <div className="relative flex shrink-0 divide-x divide-border border-t">
          <ActionIconButton keys="R" label="Reply" onClick={openReplyComposer}>
            <MessageSquareReply aria-hidden className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            active={lead.resolved}
            keys={lead.resolved ? undefined : withCtrl("R")}
            label={lead.resolved ? "Resolved" : "Resolve"}
            onClick={() => onResolve?.(lead.id)}
          >
            <CheckCircle2 aria-hidden className="h-4 w-4" />
          </ActionIconButton>
          <ActionIconButton
            disabled={iterating}
            keys={withCtrl("I")}
            label="Fix"
            onClick={handleIterate}
          >
            {iterating ? (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles aria-hidden className="h-4 w-4" />
            )}
          </ActionIconButton>
          {onDelete ? (
            <ActionIconButton
              destructive
              disabled={deleteBusy}
              keys={withCtrl("⌫")}
              label="Delete"
              onClick={requestDelete}
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </ActionIconButton>
          ) : null}

          {deleteConfirming ? (
            <div
              className="absolute inset-0 z-10 flex items-center justify-end gap-1.5 bg-gradient-to-l from-55% from-background to-transparent pr-2 pl-8"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="mr-0.5 font-medium text-foreground text-xs">
                Delete?
              </span>
              <HotkeyTip keys="Esc" label="Cancel">
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={deleteBusy}
                  onClick={cancelDeleteConfirm}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </HotkeyTip>
              <HotkeyTip keys="⏎" label="Delete">
                <Button
                  className="h-7 px-2 text-xs"
                  disabled={deleteBusy}
                  onClick={() => void confirmDelete()}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </Button>
              </HotkeyTip>
            </div>
          ) : null}
        </div>
      ) : null}

      {deleteError ? (
        <div
          className="shrink-0 border-t bg-destructive/10 px-4 py-1.5 text-destructive text-xs"
          role="alert"
        >
          {deleteError}
        </div>
      ) : null}

      {mode === "detailed" && lightboxOpen && lead.screenshot ? (
        <Lightbox
          onClose={() => setLightboxOpen(false)}
          src={lead.screenshot}
        />
      ) : null}
    </div>
  );
}

/**
 * Click-to-enlarge view for the comment's screenshot. Portaled to the overlay
 * root (not `document.body`) so it shares the host overlay's stacking context
 * and can sit above the dock (9400). Styles come from `redline-lightbox-*`
 * in styles.css so z-index doesn't depend on host Tailwind scanning. Closes
 * on backdrop click or Escape.
 */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(
      document.querySelector<HTMLElement>("[data-redline-overlay-root]") ??
        document.body
    );
  }, []);

  useEffect(() => {
    document.body.dataset.redlineLightbox = "open";
    return () => {
      delete document.body.dataset.redlineLightbox;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined" || !portalRoot) {
    return null;
  }

  return createPortal(
    <div
      aria-label="Comment screenshot"
      className="redline-lightbox-backdrop"
      data-comment-overlay="true"
      onClick={onClose}
      role="dialog"
    >
      <img
        alt=""
        className="redline-lightbox-image"
        onClick={(e) => e.stopPropagation()}
        src={src}
      />
      <Button
        aria-label="Close screenshot"
        className="absolute top-6 right-6"
        onClick={onClose}
        size="icon"
        type="button"
        variant="secondary"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>,
    portalRoot
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
        className="absolute -top-[7px] block h-3 w-3 rotate-45 border-border border-t border-l bg-background"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "top") {
    return (
      <span
        aria-hidden
        className="absolute -bottom-[7px] block h-3 w-3 rotate-45 border-border border-r border-b bg-background"
        style={{ left: offset - 6 }}
      />
    );
  }
  if (side === "right") {
    return (
      <span
        aria-hidden
        className="absolute -left-[7px] block h-3 w-3 rotate-45 border-border border-b border-l bg-background"
        style={{ top: offset - 6 }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="absolute -right-[7px] block h-3 w-3 rotate-45 border-border border-t border-r bg-background"
      style={{ top: offset - 6 }}
    />
  );
}

function readViewport() {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * One-line attribution: `author · date`. Used for the lead comment and every
 * extra/reply so the metadata reads identically everywhere. The author
 * truncates; the dot and date never shrink so the timestamp stays legible.
 */
function Attribution({
  author,
  date,
  className,
}: {
  author: string;
  date: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs",
        className
      )}
    >
      <span className="truncate">{author}</span>
      <span aria-hidden className="text-muted-foreground/40">
        ·
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums">
        {formatDate(date)}
      </span>
    </div>
  );
}

function ReplyItem({
  reply,
  replyIndex,
  commentId,
  skipDeleteConfirmation,
  onEdit,
  onDelete,
  onInteraction,
}: {
  reply: CommentReply;
  replyIndex: number;
  commentId: string;
  skipDeleteConfirmation: boolean;
  onEdit?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onDelete?: (id: string, replyIndex: number) => Promise<void>;
  onInteraction?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      editTextareaRef.current?.focus();
    }
  }, [editing]);

  const startEditing = () => {
    if (!onEdit) {
      return;
    }
    onInteraction?.();
    setEditing(true);
    setEditDraft(reply.text);
    setEditError(null);
    setDeleteConfirming(false);
    setDeleteError(null);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditDraft("");
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!onEdit || editBusy) {
      return;
    }
    const trimmed = editDraft.trim();
    if (!trimmed) {
      setEditError("Reply cannot be empty");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      await onEdit(commentId, replyIndex, trimmed);
      setEditing(false);
      setEditDraft("");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!onDelete || deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDelete(commentId, replyIndex);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
      setDeleteConfirming(false);
    }
  };

  const requestDelete = () => {
    if (!onDelete || deleteBusy) {
      return;
    }
    onInteraction?.();
    setDeleteError(null);
    setEditing(false);
    if (skipDeleteConfirmation) {
      void confirmDelete();
      return;
    }
    setDeleteConfirming(true);
  };

  const cancelDeleteConfirm = () => {
    setDeleteConfirming(false);
  };

  return (
    <li>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Edit reply"
            className="min-h-[64px] resize-none text-sm leading-relaxed"
            disabled={editBusy}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void saveEdit();
              }
            }}
            ref={editTextareaRef}
            value={editDraft}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              className="h-7 px-2 text-xs"
              disabled={editBusy}
              onClick={cancelEditing}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              disabled={editBusy}
              onClick={() => void saveEdit()}
              size="sm"
              type="button"
            >
              {editBusy ? (
                "Saving…"
              ) : (
                <>
                  Save
                  <ShortcutHint onPrimary>{withCtrl("⏎")}</ShortcutHint>
                </>
              )}
            </Button>
          </div>
          {editError ? (
            <p className="m-0 text-destructive text-xs">{editError}</p>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-muted-foreground text-sm leading-snug">
          {reply.text}
        </p>
      )}

      <div className="relative mt-1 flex items-center justify-between gap-2">
        {editing ? (
          <span />
        ) : (
          <Attribution author={reply.author} date={reply.date} />
        )}
        {!editing && (onEdit || onDelete) ? (
          <div className="flex shrink-0 items-center gap-0.5">
            {onEdit && !deleteConfirming ? (
              <Button
                className="h-auto px-1.5 py-1 text-xs"
                onClick={startEditing}
                size="sm"
                type="button"
                variant="ghost"
              >
                Edit
              </Button>
            ) : null}
            {onDelete && !deleteConfirming ? (
              <Button
                className="h-auto px-1.5 py-1 text-xs hover:bg-destructive/10 hover:text-destructive"
                disabled={deleteBusy}
                onClick={requestDelete}
                size="sm"
                type="button"
                variant="ghost"
              >
                Delete
              </Button>
            ) : null}
          </div>
        ) : null}

        {deleteConfirming ? (
          <div
            className="absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 bg-gradient-to-l from-55% from-background to-transparent pl-8"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="mr-0.5 font-medium text-foreground text-xs">
              Delete?
            </span>
            <Button
              className="h-7 px-2 text-xs"
              disabled={deleteBusy}
              onClick={cancelDeleteConfirm}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              disabled={deleteBusy}
              onClick={() => void confirmDelete()}
              size="sm"
              type="button"
              variant="destructive"
            >
              {deleteBusy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        ) : null}
      </div>

      {deleteError ? (
        <p className="m-0 mt-1 text-destructive text-xs">{deleteError}</p>
      ) : null}
    </li>
  );
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
    <Button
      aria-expanded={!isCompact}
      aria-label={isCompact ? "Expand bubble" : "Collapse bubble"}
      className="h-auto shrink-0 px-1.5 py-1 text-xs"
      onClick={onToggle}
      size="sm"
      type="button"
      variant="ghost"
    >
      {isCompact ? "More" : "Less"}
      <ShortcutHint>Tab</ShortcutHint>
    </Button>
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
function AdaptiveThumb({ src, onClick }: { src: string; onClick: () => void }) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const dims = useMemo(() => computeThumbDims(natural), [natural]);

  return (
    <button
      aria-label="Show full screenshot"
      className="block shrink-0 overflow-hidden rounded-md border bg-muted transition-shadow hover:ring-1 hover:ring-ring"
      onClick={onClick}
      style={{ width: dims.width, height: dims.height }}
      type="button"
    >
      <img
        alt=""
        className="h-full w-full object-contain"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
        src={src}
      />
    </button>
  );
}

/**
 * Pick a thumbnail container size from the image's natural dimensions. See
 * AdaptiveThumb for the rule rationale. Returns the legacy 36×36 default
 * pre-load so the row doesn't reflow more than once.
 */
function computeThumbDims(natural: { w: number; h: number } | null): {
  width: number;
  height: number;
} {
  if (!natural) {
    return { width: 36, height: 36 };
  }
  const { w, h } = natural;
  // Tiny: anything genuinely icon-sized at source. Render as a 24px icon —
  // upscaling beyond that just blurs the source.
  if (w < 40 || h < 40) {
    return { width: 24, height: 24 };
  }
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

function ActionIconButton({
  label,
  keys,
  onClick,
  disabled,
  active,
  destructive,
  children,
}: {
  label: string;
  /** Hotkey shown in the tooltip; omit for a label-only tip. */
  keys?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <HotkeyTip keys={keys} label={label}>
      <Button
        aria-label={label}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-none text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          active && "text-primary hover:text-primary",
          destructive && "hover:bg-destructive/10 hover:text-destructive"
        )}
        disabled={disabled}
        onClick={onClick}
        size="icon"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </HotkeyTip>
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
  if (!import.meta.hot) {
    return;
  }
  const hot = import.meta.hot;

  let done = false;
  let timeoutId: number | undefined;
  const cleanup = () => {
    if (done) {
      return;
    }
    done = true;
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
    hot.off("vite:afterUpdate", handler);
  };

  const handler = () => {
    if (done) {
      return;
    }
    // One rAF for React to commit the new tree before we measure.
    window.requestAnimationFrame(() => {
      void run();
    });
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
        // Mirror the composer: paint the effective page background so
        // transparent elements (most) don't capture as see-through.
        backgroundColor: effectiveBackgroundColor(el),
        // Match the composer: drop overlay chrome (bubble, dots, highlight)
        // from the capture so the screenshot reflects only the user-facing
        // design, not our own UI.
        filter: (node) => {
          if (
            node instanceof HTMLElement &&
            node.dataset.commentOverlay === "true"
          ) {
            return false;
          }
          return true;
        },
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
      if (!res.ok) {
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
  if (tool && detail) {
    return `${tool} ${detail}`;
  }
  if (tool) {
    return tool;
  }
  if (detail) {
    return detail;
  }
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
  if (Number.isNaN(ts)) {
    return iso;
  }
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
