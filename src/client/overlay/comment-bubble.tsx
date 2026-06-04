import type { PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIX_VERSION_COUNT } from "../../shared/fix-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { CommentBubbleHeader } from "./comment-bubble-header.tsx";
import { CommentBubbleLightbox } from "./comment-bubble-lightbox.tsx";
import { CommentBubblePointer } from "./comment-bubble-pointer.tsx";
import {
  CommentComposerBar,
  type ComposerMode,
} from "./comment-composer-bar.tsx";
import { CommentTranscript } from "./comment-transcript.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useBubbleLeadActions } from "./hooks/use-bubble-lead-actions.ts";
import { useIterateFix } from "./hooks/use-iterate-fix.ts";
import { useIterations } from "./hooks/use-iterations.ts";
import { useViewport } from "./hooks/use-viewport.ts";
import { handleCommentBubbleKeydown } from "./lib/comment-bubble-keydown.ts";
import { toErrorMessage } from "./lib/errors.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";
import type { TranscriptEditSubmit } from "./transcript-entry-composer.tsx";

interface CommentBubbleProps {
  /**
   * When set, the bubble runs the agent once on mount with this many variants.
   * Used by "create comment in Agent mode" so the fix kicks off as the bubble
   * auto-opens. `null`/undefined = no auto-run.
   */
  autoFixCount?: number | null;
  comments: CommentData[];
  fixModel?: OverlayModel;
  /** Drives pin loading while the agent iterates (cleared when the run ends). */
  onAgentWorkingChange?: (anchor: string | null) => void;
  onAutoFixStarted?: () => void;
  onClose: () => void;
  onDelete?: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onFixModelChange: (model: OverlayModel) => void;
  onResolve?: (id: string) => void;
  onSubmitReply?: (id: string, text: string, v?: number) => Promise<void>;
  rect: DOMRect;
  skipDeleteConfirmation?: boolean;
}

const BUBBLE_WIDTH = 384;
const BUBBLE_HEADER_HEIGHT = 34;
const VIEWPORT_PADDING = 12;
/** Conservative estimate for first render; updated by ResizeObserver. */
const INITIAL_BUBBLE_HEIGHT = 320;

/**
 * Open comment panel, rendered as a conversation: the transcript on top
 * (comment + agent variant groups + replies) and a persistent composer below.
 * Anchored to the dot, flipping to the opposite side when the preferred side
 * has no room.
 */
export function CommentBubble({
  comments,
  rect,
  fixModel = "composer-2.5-fast",
  onFixModelChange,
  skipDeleteConfirmation = false,
  autoFixCount = null,
  onAutoFixStarted,
  onAgentWorkingChange,
  onClose,
  onResolve,
  onDelete,
  onEdit,
  onSubmitReply,
  onEditReply,
}: CommentBubbleProps) {
  const lead = comments[0];
  const commentId = lead?.id ?? "";
  const {
    data: iterations,
    loading: iterationsLoading,
    switching: versionSwitching,
    deleting: versionDeleting,
    deleteError: versionDeleteError,
    activate: activateVersion,
    removeVersion: removeIterationVersion,
    reload: reloadIterations,
  } = useIterations(commentId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [bubbleHeight, setBubbleHeight] = useState(INITIAL_BUBBLE_HEIGHT);
  /**
   * Once the user grabs the drag handle, the bubble switches to manual
   * positioning (pointer hidden — it would no longer point at the anchor).
   * Resets on unmount, so each open starts in auto-placement mode.
   */
  const [userPosition, setUserPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("agent");
  const [fixVersionCount, setFixVersionCount] = useState(
    autoFixCount ?? DEFAULT_FIX_VERSION_COUNT
  );
  const [replyBusy, setReplyBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingEntryKey, setEditingEntryKey] = useState<string | null>(null);
  const viewport = useViewport();

  const activeVersion = iterations?.active ?? lead?.active ?? 0;
  const hasAgentHistory = (iterations?.versions ?? []).some((v) => v.v > 0);

  const {
    iterating,
    iterateError,
    iterateStatus,
    iterateStartedAt,
    iterateNow,
    handleIterate,
    handleCancelIterate,
  } = useIterateFix({
    lead,
    fixModel,
    fixVersionCount,
    reloadIterations,
    onAgentWorkingChange,
  });

  const {
    deleteConfirming,
    deleteBusy,
    deleteError,
    requestDelete,
    confirmDelete,
    cancelDeleteConfirm,
    revertBaseline,
    setRevertBaseline,
    showRevertOption,
  } = useBubbleLeadActions({
    lead,
    activeVersion,
    onDelete,
    skipDeleteConfirmation,
  });

  // Focus the composer on open so Cmd/Ctrl+Enter works immediately.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // "Create comment in Agent mode" auto-runs the agent once as the bubble
  // opens. fixVersionCount is already seeded from autoFixCount, so handleIterate
  // picks up the right count.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFixCount == null || autoFiredRef.current || !lead) {
      return;
    }
    autoFiredRef.current = true;
    onAutoFixStarted?.();
    handleIterate().catch(ignorePromiseRejection);
  }, [autoFixCount, lead, onAutoFixStarted, handleIterate]);

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

  const persistTranscriptEdit = useCallback(
    async (
      payload: TranscriptEditSubmit,
      persist: (text: string) => Promise<void>
    ) => {
      const trimmed = payload.text.trim();
      if (!trimmed || iterating || replyBusy) {
        return;
      }
      setComposerError(null);
      setReplyBusy(true);
      try {
        await persist(trimmed);
      } catch (err) {
        setComposerError(toErrorMessage(err));
        throw err;
      } finally {
        setReplyBusy(false);
      }
      if (payload.runAgent) {
        setFixVersionCount(payload.versionCount);
        onFixModelChange(payload.model);
        await handleIterate({
          fixVersionCount: payload.versionCount,
          fixModel: payload.model,
        });
      }
    },
    [iterating, replyBusy, handleIterate, onFixModelChange]
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || iterating || replyBusy) {
      return;
    }
    setComposerError(null);

    if (mode === "comment") {
      setReplyBusy(true);
      try {
        await onSubmitReply?.(lead?.id ?? "", text, activeVersion);
        setDraft("");
      } catch (err) {
        setComposerError(toErrorMessage(err));
      } finally {
        setReplyBusy(false);
      }
      return;
    }

    // Fix: record the instruction as a versioned reply (the agent reads it as
    // steering) and then iterate. The reply is persisted before iterating, so
    // the fix prompt picks it up.
    try {
      if (onSubmitReply && lead) {
        await onSubmitReply(lead.id, text, activeVersion);
      }
      setDraft("");
    } catch (err) {
      setComposerError(toErrorMessage(err));
      return;
    }
    await handleIterate();
  }, [
    draft,
    iterating,
    replyBusy,
    mode,
    onSubmitReply,
    lead,
    activeVersion,
    handleIterate,
  ]);

  // Bubble-local hotkeys — Escape + Cmd/Ctrl combos only (see keydown lib).
  useEffect(() => {
    if (!lead) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      handleCommentBubbleKeydown(e, {
        cancelDeleteConfirm,
        cancelInlineEdit: () => setEditingEntryKey(null),
        editingEntryKey,
        confirmDelete,
        deleteConfirming,
        lead,
        lightboxSrc,
        onClose,
        onDelete,
        onResolve,
        requestDelete,
        setLightboxSrc,
      });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [
    lead,
    lightboxSrc,
    onClose,
    onResolve,
    onDelete,
    deleteConfirming,
    confirmDelete,
    cancelDeleteConfirm,
    requestDelete,
    editingEntryKey,
  ]);

  const maxBubbleHeight = viewport.height - 2 * VIEWPORT_PADDING;

  const placement = useMemo(
    () =>
      placeFloater({
        anchor: dotRect({ right: rect.right, top: rect.top }, viewport),
        size: {
          width: BUBBLE_WIDTH,
          height: Math.min(bubbleHeight, maxBubbleHeight),
        },
        preferredSide: "bottom",
        viewport,
        padding: VIEWPORT_PADDING,
        gap: 10,
        arrowSafePadding: 18,
      }),
    [rect, bubbleHeight, maxBubbleHeight, viewport]
  );

  if (!lead) {
    return null;
  }

  return (
    <div
      aria-label="Comment"
      className="pointer-events-auto fixed z-[9200] flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      data-comment-overlay="true"
      onPointerDown={(e) => e.stopPropagation()}
      ref={containerRef}
      role="dialog"
      style={{
        left: userPosition?.left ?? placement.left,
        top: userPosition?.top ?? placement.top,
        width: BUBBLE_WIDTH,
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
        height={BUBBLE_HEADER_HEIGHT}
        onClose={onClose}
        onDragStart={createBubbleDragHandler({
          placement,
          setUserPosition,
          userPosition,
        })}
        onRequestDelete={onDelete ? requestDelete : undefined}
        onResolve={onResolve ? () => onResolve(lead.id) : undefined}
        resolved={Boolean(lead.resolved)}
      />

      {deleteConfirming ? (
        <div className="shrink-0 border-b px-2 py-2">
          <DeleteConfirmOverlay
            activeVersion={activeVersion}
            busy={deleteBusy}
            label="Delete this thread?"
            layout="inline"
            onCancel={cancelDeleteConfirm}
            onConfirm={confirmDelete}
            onRevertBaselineChange={setRevertBaseline}
            revertBaseline={revertBaseline}
            showKeyboardHints
            showRevertOption={showRevertOption}
          />
          {deleteError ? (
            <p
              className="m-0 mt-1.5 px-0.5 text-destructive text-xs"
              role="alert"
            >
              {deleteError}
            </p>
          ) : null}
        </div>
      ) : null}

      <CommentTranscript
        activeVersion={activeVersion}
        editingEntryKey={editingEntryKey}
        fixModel={fixModel}
        fixVersionCount={fixVersionCount}
        hasAgentHistory={hasAgentHistory}
        iterateNow={iterateNow}
        iterateStartedAt={iterateStartedAt}
        iterateStatus={iterateStatus}
        iterating={iterating}
        iterations={iterations}
        iterationsLoading={iterationsLoading}
        lead={lead}
        onActivateVersion={activateVersion}
        onEditComment={
          onEdit
            ? (payload) =>
                persistTranscriptEdit(payload, (text) => onEdit(lead.id, text))
            : undefined
        }
        onEditingEntryKeyChange={setEditingEntryKey}
        onEditReply={
          onEditReply
            ? (id, replyIndex, payload) =>
                persistTranscriptEdit(payload, (text) =>
                  onEditReply(id, replyIndex, text)
                )
            : undefined
        }
        onFixModelChange={onFixModelChange}
        onRemoveVersion={removeIterationVersion}
        onResetInlineFlows={() => {
          setEditingEntryKey(null);
          cancelDeleteConfirm();
        }}
        onThumbClick={setLightboxSrc}
        versionDeleteError={versionDeleteError}
        versionDeleting={versionDeleting}
        versionSwitching={versionSwitching}
      />

      {editingEntryKey === null ? (
        <CommentComposerBar
          busy={replyBusy}
          error={composerError ?? iterateError}
          fixModel={fixModel}
          fixVersionCount={fixVersionCount}
          iterating={iterating}
          mode={mode}
          onCancelIterate={handleCancelIterate}
          onChange={setDraft}
          onFixModelChange={onFixModelChange}
          onFixVersionCountChange={setFixVersionCount}
          onModeChange={setMode}
          onSubmit={() => {
            submit().catch(ignorePromiseRejection);
          }}
          replyVersion={hasAgentHistory ? activeVersion : undefined}
          textareaRef={textareaRef}
          value={draft}
        />
      ) : null}

      {lightboxSrc ? (
        <CommentBubbleLightbox
          onClose={() => setLightboxSrc(null)}
          src={lightboxSrc}
        />
      ) : null}
    </div>
  );
}

function createBubbleDragHandler(args: {
  placement: { left: number; top: number };
  setUserPosition: (pos: { left: number; top: number }) => void;
  userPosition: { left: number; top: number } | null;
}): (e: PointerEvent<HTMLDivElement>) => void {
  return (e) => {
    if ((e.target as Element).closest("button")) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseLeft = args.userPosition?.left ?? args.placement.left;
    const baseTop = args.userPosition?.top ?? args.placement.top;
    const onMove = (ev: globalThis.PointerEvent) => {
      args.setUserPosition({
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
  };
}
