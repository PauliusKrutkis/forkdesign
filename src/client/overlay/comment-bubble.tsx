import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIX_VERSION_COUNT } from "../../shared/fix-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { CommentBubbleBody } from "./comment-bubble-body.tsx";
import {
  CommentBubbleFooter,
  createBubbleDragHandler,
} from "./comment-bubble-footer.tsx";
import { CommentBubbleHeader } from "./comment-bubble-header.tsx";
import { CommentBubblePointer } from "./comment-bubble-pointer.tsx";
import { hasMultipleVersions } from "./comment-version-history.tsx";
import { useBubbleLeadActions } from "./hooks/use-bubble-lead-actions.ts";
import { type BubbleMode, useIterateFix } from "./hooks/use-iterate-fix.ts";
import { useIterations } from "./hooks/use-iterations.ts";
import { useViewport } from "./hooks/use-viewport.ts";
import { handleCommentBubbleKeydown } from "./lib/comment-bubble-keydown.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";

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
  const viewport = useViewport();
  /**
   * Bubble surface mode. Opens in `compact` (text + metadata only) so the
   * user can triage the comment without the full action chrome. Expanding to
   * `detailed` reveals the thumbnail, replies, action row, and iterate
   * status. Auto-expands when the user fires "Fix with AI" — they'll want to
   * watch progress stream — but never auto-collapses (jarring).
   */
  const [mode, setMode] = useState<BubbleMode>("compact");
  const [fixVersionCount, setFixVersionCount] = useState(
    DEFAULT_FIX_VERSION_COUNT
  );
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
    fixVersionCount,
    reloadIterations,
    setMode,
  });
  const leadActions = useBubbleLeadActions({
    lead,
    iterations,
    onDelete,
    onEdit,
    onSubmitReply,
    setMode,
    skipDeleteConfirmation,
  });
  const {
    activeVersion,
    cancelDeleteConfirm,
    cancelEditing,
    cancelReply,
    confirmDelete,
    deleteBusy,
    deleteConfirming,
    deleteError,
    editBusy,
    editDraft,
    editError,
    editTextareaRef,
    editing,
    openReplyComposer,
    replyBusy,
    replyDraft,
    replyError,
    replyOpen,
    replyTextareaRef,
    requestDelete,
    resetInlineFlows,
    revertBaseline,
    saveEdit,
    saveReply,
    setEditDraft,
    setReplyDraft,
    setRevertBaseline,
    showRevertOption,
    startEditing,
  } = leadActions;

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

      <CommentBubbleHeader
        bubbleHeaderHeight={BUBBLE_HEADER_HEIGHT}
        onClose={onClose}
        onDragStart={createBubbleDragHandler({
          placement,
          setUserPosition,
          userPosition,
        })}
      />

      <CommentBubbleBody
        cancelEditing={cancelEditing}
        cancelReply={cancelReply}
        comments={comments}
        editBusy={editBusy}
        editDraft={editDraft}
        editError={editError}
        editing={editing}
        editTextareaRef={editTextareaRef}
        iterating={iterating}
        iterations={iterations}
        lead={lead}
        mode={mode}
        multiVersion={multiVersion}
        onActivateVersion={activateVersion}
        onDeleteReply={onDeleteReply}
        onEdit={onEdit}
        onEditDraftChange={setEditDraft}
        onEditReply={onEditReply}
        onRemoveVersion={removeIterationVersion}
        onReplyDraftChange={setReplyDraft}
        onResetInlineFlows={resetInlineFlows}
        onSaveEdit={saveEdit}
        onSaveReply={saveReply}
        onSetLightboxSrc={setLightboxSrc}
        onStartEditing={startEditing}
        onToggleMode={() =>
          setMode((prev) => (prev === "compact" ? "detailed" : "compact"))
        }
        replyBusy={replyBusy}
        replyDraft={replyDraft}
        replyError={replyError}
        replyOpen={replyOpen}
        replyTextareaRef={replyTextareaRef}
        skipDeleteConfirmation={skipDeleteConfirmation}
        versionDeleteError={versionDeleteError}
        versionDeleting={versionDeleting}
        versionSwitching={versionSwitching}
      />

      <CommentBubbleFooter
        activeVersion={activeVersion}
        deleteBusy={deleteBusy}
        deleteConfirming={deleteConfirming}
        deleteError={deleteError}
        fixVersionCount={fixVersionCount}
        handleIterate={handleIterate}
        iterateError={iterateError}
        iterateNow={iterateNow}
        iterateStartedAt={iterateStartedAt}
        iterateStatus={iterateStatus}
        iterating={iterating}
        lead={lead}
        lightboxSrc={lightboxSrc}
        mode={mode}
        onCancelDelete={cancelDeleteConfirm}
        onConfirmDelete={confirmDelete}
        onDelete={onDelete}
        onFixVersionCountChange={setFixVersionCount}
        onOpenReply={openReplyComposer}
        onRequestDelete={requestDelete}
        onResolve={onResolve}
        onRevertBaselineChange={setRevertBaseline}
        onSetLightboxSrc={setLightboxSrc}
        revertBaseline={revertBaseline}
        showRevertOption={showRevertOption}
      />
    </div>
  );
}
