import {
  CheckCircle2,
  GripVertical,
  Loader2,
  MessageSquareReply,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Textarea } from "../ui/textarea.tsx";
import {
  ActionIconButton,
  ModeToggleButton,
} from "./comment-bubble-action-buttons.tsx";
import { CommentBubbleAttribution } from "./comment-bubble-attribution.tsx";
import { CommentBubbleLightbox } from "./comment-bubble-lightbox.tsx";
import { CommentBubblePointer } from "./comment-bubble-pointer.tsx";
import { CommentBubbleReplyItem } from "./comment-bubble-reply-item.tsx";
import { AdaptiveThumb } from "./comment-thumb.tsx";
import {
  CommentVersionHistory,
  formatVersionDisplay,
  hasMultipleVersions,
  shouldShowVersionHistory,
} from "./comment-version-history.tsx";
import { CommentVersionPicker } from "./comment-version-picker.tsx";
import { type BubbleMode, useIterateFix } from "./hooks/use-iterate-fix.ts";
import { useIterations } from "./hooks/use-iterations.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { formatElapsed, readViewport } from "./lib/bubble-formatters.ts";
import { handleCommentBubbleKeydown } from "./lib/comment-bubble-keydown.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";
import { ShortcutHint, withCtrl } from "./shortcut-hint.tsx";

interface CommentBubbleProps {
  comments: CommentData[];
  fixModel?: OverlayModel;
  onClose: () => void;
  onDelete?: (id: string) => Promise<void>;
  onDeleteReply?: (id: string, replyIndex: number) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onResolve?: (id: string) => void;
  onSubmitReply?: (id: string, text: string, v?: number) => Promise<void>;
  rect: DOMRect;
  skipDeleteConfirmation?: boolean;
}

const BUBBLE_WIDTH_DETAILED = 320;
const BUBBLE_WIDTH_COMPACT = 280;
const BUBBLE_HEADER_HEIGHT = 36;
const VIEWPORT_PADDING = 12;
/** Conservative estimate for first render; updated by ResizeObserver. */
const INITIAL_BUBBLE_HEIGHT = 280;

/**
 * Open comment panel. Anchored to the dot (the visual handle on the element),
 * not to the element itself, so placement stays predictable for large
 * containers. Flips to the opposite side when the preferred side has no room.
 */
export function CommentBubble({
  comments,
  rect,
  fixModel = "composer-2.5-fast",
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
  const commentId = lead?.id ?? "";
  const {
    data: iterations,
    switching: versionSwitching,
    deleting: versionDeleting,
    deleteError: versionDeleteError,
    activate: activateVersion,
    removeVersion: removeIterationVersion,
    reload: reloadIterations,
  } = useIterations(commentId, { enableKeyboard: Boolean(lead) });
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [viewport, setViewport] = useState(() => readViewport());
  /**
   * Bubble surface mode. Opens in `compact` (text + metadata only) so the
   * user can triage the comment without the full action chrome. Expanding to
   * `detailed` reveals the thumbnail, replies, action row, and iterate
   * status. Auto-expands when the user fires "Fix with AI" — they'll want to
   * watch progress stream — but never auto-collapses (jarring).
   */
  const [mode, setMode] = useState<BubbleMode>("compact");
  const {
    iterating,
    iterateError,
    iterateStatus,
    iterateStartedAt,
    iterateNow,
    handleIterate,
  } = useIterateFix({
    lead,
    fixModel,
    reloadIterations,
    setMode,
  });
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

  const startEditing = useCallback(() => {
    if (!(lead && onEdit)) {
      return;
    }
    setMode("detailed");
    setEditing(true);
    setEditDraft(lead.text);
    setEditError(null);
    setReplyOpen(false);
  }, [lead, onEdit]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditDraft("");
    setEditError(null);
  }, []);

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

  const openReplyComposer = useCallback(() => {
    setMode("detailed");
    setReplyOpen(true);
    setReplyDraft("");
    setReplyError(null);
    setEditing(false);
  }, []);

  const cancelReply = useCallback(() => {
    setReplyOpen(false);
    setReplyDraft("");
    setReplyError(null);
  }, []);

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
      const replyV = iterations?.active ?? lead.active;
      await onSubmitReply(lead.id, trimmed, replyV);
      setReplyOpen(false);
      setReplyDraft("");
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setReplyBusy(false);
    }
  };

  const confirmDelete = useCallback(async () => {
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
  }, [lead, onDelete, deleteBusy]);

  const requestDelete = useCallback(() => {
    if (!(lead && onDelete) || deleteBusy) {
      return;
    }
    setDeleteError(null);
    if (skipDeleteConfirmation) {
      confirmDelete().catch(ignorePromiseRejection);
      return;
    }
    setMode("detailed");
    setDeleteConfirming(true);
  }, [lead, onDelete, deleteBusy, skipDeleteConfirmation, confirmDelete]);

  const cancelDeleteConfirm = useCallback(() => {
    setDeleteConfirming(false);
  }, []);

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
  // lightbox first if it's open, then cancels inline flows (reply, edit,
  // delete confirm) before closing the bubble. Cmd/Ctrl+I fires "Fix
  // with AI", Cmd/Ctrl+R fires "Resolve". Skipped when the user is in a
  // text input (e.g., a future inline reply textarea).
  useEffect(() => {
    if (!lead) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      handleCommentBubbleKeydown(e, {
        cancelDeleteConfirm,
        cancelEditing,
        cancelReply,
        confirmDelete,
        deleteConfirming,
        editing,
        handleIterate,
        iterating,
        lead,
        lightboxSrc,
        onClose,
        onDelete,
        onEdit,
        onResolve,
        onSubmitReply,
        openReplyComposer,
        replyOpen,
        requestDelete,
        setLightboxSrc,
        setMode,
        startEditing,
      });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [
    lead,
    lightboxSrc,
    iterating,
    onClose,
    onResolve,
    onDelete,
    onEdit,
    onSubmitReply,
    deleteConfirming,
    replyOpen,
    editing,
    handleIterate,
    startEditing,
    openReplyComposer,
    requestDelete,
    confirmDelete,
    cancelDeleteConfirm,
    cancelReply,
    cancelEditing,
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

  const multiVersion = hasMultipleVersions(iterations, lead.active);

  return (
    <div
      aria-label="Comment"
      className="pointer-events-auto fixed z-[9200] flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg transition-[width] duration-200"
      data-comment-overlay="true"
      onPointerDown={(e) => e.stopPropagation()}
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
        <CommentBubblePointer
          offset={placement.arrowOffset}
          side={placement.side}
        />
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

        <div className="flex-1" />

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
        {/* Comment + aside: with 2+ versions only the version picker (no image);
            otherwise the original screenshot thumbnail. Compact hides aside. */}
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
                    saveEdit().catch(ignorePromiseRejection);
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
                  onClick={() => {
                    saveEdit().catch(ignorePromiseRejection);
                  }}
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
          {mode === "detailed" &&
          !editing &&
          iterations &&
          shouldShowVersionHistory(iterations) ? (
            <CommentVersionPicker
              data={iterations}
              disabled={iterating || versionDeleting}
              onActivate={(v) => {
                activateVersion(v).catch(ignorePromiseRejection);
              }}
              switching={versionSwitching || versionDeleting}
            />
          ) : null}
          {mode === "detailed" &&
          !editing &&
          lead.screenshot &&
          !multiVersion ? (
            <AdaptiveThumb
              onClick={() => setLightboxSrc(lead.screenshot ?? null)}
              src={lead.screenshot}
            />
          ) : null}
        </div>

        {/* Attribution (left) · edit + expand toggle (right) */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <CommentBubbleAttribution author={lead.author} date={lead.date} />
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
                <CommentBubbleAttribution
                  author={extra.author}
                  className="mt-1"
                  date={extra.date}
                />
              </li>
            ))}
          </ul>
        ) : null}

        {mode === "detailed" &&
        iterations &&
        shouldShowVersionHistory(iterations) ? (
          <CommentVersionHistory
            active={iterations.active}
            deleteError={versionDeleteError}
            disabled={iterating || versionDeleting}
            onActivate={(v) => {
              activateVersion(v).catch(ignorePromiseRejection);
            }}
            onDeleteVersion={(v) => removeIterationVersion(v)}
            onThumbClick={(src) => setLightboxSrc(src)}
            renderReply={(reply, i) => (
              <CommentBubbleReplyItem
                commentId={lead.id}
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
            )}
            replies={lead.replies}
            switching={versionSwitching || versionDeleting}
            versions={iterations.versions}
          />
        ) : null}

        {mode === "detailed" &&
        iterations &&
        !shouldShowVersionHistory(iterations) &&
        lead.replies &&
        lead.replies.length > 0 ? (
          <ul className="m-0 mt-3 list-none space-y-2.5 border-t p-0 pt-3">
            {[...lead.replies.entries()].reverse().map(([i, reply]) => (
              <CommentBubbleReplyItem
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
            {iterations && shouldShowVersionHistory(iterations) ? (
              <p className="m-0 text-muted-foreground text-xs">
                Replying on {formatVersionDisplay(iterations.active)}
              </p>
            ) : null}
            <Textarea
              aria-label="Reply"
              className="min-h-[64px] resize-none text-sm leading-relaxed"
              disabled={replyBusy}
              onChange={(e) => setReplyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  saveReply().catch(ignorePromiseRejection);
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
                onClick={() => {
                  saveReply().catch(ignorePromiseRejection);
                }}
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

      {mode === "detailed" && (iterating || iterateStatus) ? (
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
            <div className="absolute inset-0 z-10 flex items-center justify-end gap-1.5 bg-gradient-to-l from-55% from-background to-transparent pr-2 pl-8">
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
                  onClick={() => {
                    confirmDelete().catch(ignorePromiseRejection);
                  }}
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

      {mode === "detailed" && lightboxSrc ? (
        <CommentBubbleLightbox
          onClose={() => setLightboxSrc(null)}
          src={lightboxSrc}
        />
      ) : null}
    </div>
  );
}
