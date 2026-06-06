import type { CSSProperties, PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_AGENT_VERSION_COUNT } from "../../shared/agent-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import type { CommentData } from "../types.ts";
import { cn } from "../ui/cn.ts";
import { CommentBubbleHeader } from "./comment-bubble-header.tsx";
import { CommentBubbleLightbox } from "./comment-bubble-lightbox.tsx";
import { CommentBubblePointer } from "./comment-bubble-pointer.tsx";
import {
  CommentComposerBar,
  type ComposerMode,
} from "./comment-composer-bar.tsx";
import { CommentTranscript } from "./comment-transcript.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useAgentIteration } from "./hooks/use-agent-iteration.ts";
import { useBubbleLeadActions } from "./hooks/use-bubble-lead-actions.ts";
import { useBubblePosture } from "./hooks/use-bubble-posture.ts";
import { useIterations } from "./hooks/use-iterations.ts";
import { useViewport } from "./hooks/use-viewport.ts";
import { handleCommentBubbleKeydown } from "./lib/comment-bubble-keydown.ts";
import { toErrorMessage } from "./lib/errors.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";
import type { TranscriptEditSubmit } from "./transcript-entry-composer.tsx";

interface CommentBubbleProps {
  agentModel?: OverlayModel;
  agentRun?: {
    cancel?: () => void;
    count: number;
    model: OverlayModel;
    startedAt: number;
  } | null;
  /** True when this thread already has an agent run in flight outside this mount. */
  agentWorking?: boolean;
  /**
   * When set, the bubble runs the agent once on mount with this many variants.
   * Used by "create comment in Agent mode" so the agent run kicks off as the bubble
   * auto-opens. `null`/undefined = no auto-run.
   */
  autoAgentCount?: number | null;
  comments: CommentData[];
  initialActiveVersion?: number;
  onActiveVersionChange?: (id: string, active: number) => void;
  onAgentModelChange: (model: OverlayModel) => void;
  /** Drives pin loading while the agent iterates (cleared when the run ends). */
  onAgentWorkingChange?: (
    anchor: string | null,
    run?: { count: number; model: OverlayModel; startedAt: number },
    cancel?: () => void
  ) => void;
  onAutoAgentStarted?: () => void;
  onClose: () => void;
  onDelete?: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  /** Reports docked posture so the overlay can hide this thread's pin. */
  onDockedChange?: (docked: boolean) => void;
  onEdit?: (id: string, text: string) => Promise<void>;
  onEditReply?: (id: string, replyIndex: number, text: string) => Promise<void>;
  onResolve?: (id: string) => void;
  onSubmitReply?: (id: string, text: string, v?: number) => Promise<void>;
  reanchorRequest: number;
  rect: DOMRect;
  skipDeleteConfirmation?: boolean;
}

const BUBBLE_WIDTH = 384;
const BUBBLE_HEADER_HEIGHT = 34;
const VIEWPORT_PADDING = 12;
/** Conservative estimate for first render; updated by ResizeObserver. */
const INITIAL_BUBBLE_HEIGHT = 320;
/** Smooth dock/undock/peek; suppressed mid-gesture via the `dragging` flag. */
const PANEL_TRANSITION =
  "left 0.3s cubic-bezier(0.65,0,0.1,1), top 0.3s cubic-bezier(0.65,0,0.1,1), width 0.3s cubic-bezier(0.65,0,0.1,1), height 0.3s cubic-bezier(0.65,0,0.1,1), opacity 0.18s ease, border-radius 0.3s";

interface Box {
  height: number;
  left: number;
  top: number;
  width: number;
}

function panelStyle(args: {
  box: Box;
  docked: boolean;
  dockedRadius: string | undefined;
  dragging: boolean;
  maxFloatHeight: number;
  peeking: boolean;
}): CSSProperties {
  return {
    left: args.box.left,
    top: args.box.top,
    width: args.box.width,
    height: args.docked ? args.box.height : undefined,
    maxHeight: args.docked ? undefined : args.maxFloatHeight,
    // Peek fades the panel so the design shows through — opacity only, the
    // host page is never touched.
    opacity: args.peeking ? 0.16 : 1,
    borderRadius: args.dockedRadius,
    transition: args.dragging ? "none" : PANEL_TRANSITION,
  };
}

function visibleIterationState(args: {
  agentRun?: { cancel?: () => void; startedAt: number } | null;
  agentWorking: boolean;
  iterating: boolean;
  iterateStartedAt: number | null;
  iterateStatus: string | null;
}) {
  if (!(args.agentWorking && !args.iterating)) {
    return {
      cancelable: args.iterating || Boolean(args.agentRun?.cancel),
      iterating: args.iterating,
      startedAt: args.iterateStartedAt,
      status: args.iterateStatus,
    };
  }

  return {
    cancelable: Boolean(args.agentRun?.cancel),
    iterating: true,
    startedAt: args.agentRun?.startedAt ?? null,
    status: "Agent working…",
  };
}

/**
 * Open comment panel, rendered as a conversation: the transcript on top
 * (comment + agent variant groups + replies) and a persistent composer below.
 * Anchored to the dot, flipping to the opposite side when the preferred side
 * has no room.
 */
export function CommentBubble({
  agentRun = null,
  agentWorking = false,
  comments,
  rect,
  agentModel = "composer-2.5-fast",
  onAgentModelChange,
  skipDeleteConfirmation = false,
  autoAgentCount = null,
  initialActiveVersion,
  onActiveVersionChange,
  onAutoAgentStarted,
  onAgentWorkingChange,
  onClose,
  onDockedChange,
  onResolve,
  onDelete,
  onEdit,
  onSubmitReply,
  onEditReply,
  reanchorRequest,
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
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ComposerMode>("agent");
  const [agentVersionCount, setAgentVersionCount] = useState(
    autoAgentCount ?? agentRun?.count ?? DEFAULT_AGENT_VERSION_COUNT
  );
  const [replyBusy, setReplyBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editingEntryKey, setEditingEntryKey] = useState<string | null>(null);
  const viewport = useViewport();

  const activeVersion =
    iterations?.active ?? initialActiveVersion ?? lead?.active ?? 0;
  const hasAgentHistory = (iterations?.versions ?? []).some((v) => v.v > 0);

  useEffect(() => {
    if (!lead) {
      return;
    }
    onActiveVersionChange?.(lead.id, activeVersion);
  }, [lead, activeVersion, onActiveVersionChange]);

  const {
    iterating,
    iterateError,
    iterateStatus,
    iterateStartedAt,
    iterateNow,
    handleIterate,
    handleCancelIterate,
  } = useAgentIteration({
    lead,
    agentModel,
    agentVersionCount,
    reloadIterations,
    onAgentWorkingChange,
  });
  const iterationState = visibleIterationState({
    agentRun,
    agentWorking,
    iterating,
    iterateStartedAt,
    iterateStatus,
  });
  const cancelIterate = iterationState.cancelable
    ? (agentRun?.cancel ?? handleCancelIterate)
    : undefined;

  // The original stream reader may belong to a bubble that was closed. While
  // this remounted bubble shows an in-flight run, poll the persisted manifest
  // so completed variants replace loaders as soon as they hit disk.
  useEffect(() => {
    if (!iterationState.iterating) {
      return;
    }
    const interval = window.setInterval(() => {
      Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [iterationState.iterating, reloadIterations]);

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
  // opens. agentVersionCount is already seeded from autoAgentCount, so handleIterate
  // picks up the right count.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoAgentCount == null || autoFiredRef.current || !lead) {
      return;
    }
    autoFiredRef.current = true;
    onAutoAgentStarted?.();
    handleIterate().catch(ignorePromiseRejection);
  }, [autoAgentCount, lead, onAutoAgentStarted, handleIterate]);

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
      if (!trimmed || iterationState.iterating || replyBusy) {
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
        setAgentVersionCount(payload.versionCount);
        onAgentModelChange(payload.model);
        await handleIterate({
          agentVersionCount: payload.versionCount,
          agentModel: payload.model,
        });
      }
    },
    [iterationState.iterating, replyBusy, handleIterate, onAgentModelChange]
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || iterationState.iterating || replyBusy) {
      return;
    }
    setComposerError(null);

    if (mode === "comment") {
      setReplyBusy(true);
      setDraft("");
      try {
        await onSubmitReply?.(lead?.id ?? "", text, activeVersion);
      } catch (err) {
        setDraft((current) => (current ? current : draft));
        setComposerError(toErrorMessage(err));
      } finally {
        setReplyBusy(false);
      }
      return;
    }

    // Agent: record the instruction as a versioned reply (the agent reads it as
    // steering) and then iterate. The reply is persisted before iterating, so
    // the agent prompt picks it up.
    setDraft("");
    try {
      if (onSubmitReply && lead) {
        await onSubmitReply(lead.id, text, activeVersion);
      }
    } catch (err) {
      setDraft((current) => (current ? current : draft));
      setComposerError(toErrorMessage(err));
      return;
    }
    await handleIterate();
  }, [
    draft,
    iterationState.iterating,
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

  // Float / dock / peek posture, the leader-line geometry, and the drag,
  // resize, dock, and peek gestures. Kept in a hook so this component stays
  // focused on the conversation itself.
  const posture = useBubblePosture({
    rect,
    viewport,
    placement,
    floatWidth: BUBBLE_WIDTH,
    floatHeight: bubbleHeight,
    maxFloatHeight: maxBubbleHeight,
  });
  const { reanchor } = posture;

  const lastReanchorRequest = useRef(reanchorRequest);
  useEffect(() => {
    if (lastReanchorRequest.current === reanchorRequest) {
      return;
    }
    lastReanchorRequest.current = reanchorRequest;
    reanchor();
  }, [reanchorRequest, reanchor]);

  // Tell the overlay whether this thread is docked, so it can hide the pin.
  // Reset to false when the bubble closes.
  useEffect(() => {
    onDockedChange?.(posture.docked);
    return () => onDockedChange?.(false);
  }, [posture.docked, onDockedChange]);

  if (!lead) {
    return null;
  }

  const {
    docked,
    dockSide,
    hidePointer,
    showLeader,
    peeking,
    dragging,
    box,
    dockedRadius,
    dotCx,
    dotCy,
    startDrag,
    startResize,
    startPeek,
    toggleDock,
  } = posture;

  return (
    <>
      <AnchorLink
        box={box}
        dotCx={dotCx}
        dotCy={dotCy}
        showLeader={showLeader}
      />

      <div
        aria-label="Comment"
        className="pointer-events-auto fixed z-[9200] flex animate-redline-bubble-in flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
        data-comment-overlay="true"
        onPointerDown={(e) => e.stopPropagation()}
        ref={containerRef}
        role="dialog"
        style={panelStyle({
          box,
          docked,
          dockedRadius,
          dragging,
          maxFloatHeight: maxBubbleHeight,
          peeking,
        })}
      >
        {hidePointer ? null : (
          <CommentBubblePointer
            offset={placement.arrowOffset}
            side={placement.side}
          />
        )}

        <ResizeGrip onResize={startResize} side={dockSide} />

        <CommentBubbleHeader
          docked={docked}
          height={BUBBLE_HEADER_HEIGHT}
          onClose={onClose}
          onDragStart={startDrag}
          onPeekStart={startPeek}
          onRequestDelete={onDelete ? requestDelete : undefined}
          onResolve={onResolve ? () => onResolve(lead.id) : undefined}
          onToggleDock={toggleDock}
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
          agentModel={agentModel}
          agentVersionCount={agentVersionCount}
          editingEntryKey={editingEntryKey}
          hasAgentHistory={hasAgentHistory}
          iterateNow={iterateNow}
          iterateStartedAt={iterationState.startedAt}
          iterateStatus={iterationState.status}
          iterating={iterationState.iterating}
          iterations={iterations}
          iterationsLoading={iterationsLoading}
          lead={lead}
          onActivateVersion={activateVersion}
          onAgentModelChange={onAgentModelChange}
          onEditComment={
            onEdit
              ? (payload) =>
                  persistTranscriptEdit(payload, (text) =>
                    onEdit(lead.id, text)
                  )
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
            agentModel={agentModel}
            agentVersionCount={agentVersionCount}
            busy={replyBusy}
            error={composerError ?? iterateError}
            iterating={iterationState.iterating}
            mode={mode}
            onAgentModelChange={onAgentModelChange}
            onAgentVersionCountChange={setAgentVersionCount}
            onCancelIterate={cancelIterate}
            onChange={setDraft}
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
    </>
  );
}

/**
 * Anchor cue drawn over the canvas. The leader line spans the canvas, so it
 * only shows while actively relating panel↔design (drag/peek) to avoid clutter.
 */
function AnchorLink({
  showLeader,
  box,
  dotCx,
  dotCy,
}: {
  showLeader: boolean;
  box: Box;
  dotCx: number;
  dotCy: number;
}) {
  return showLeader ? (
    <LeaderLine box={box} dotCx={dotCx} dotCy={dotCy} />
  ) : null;
}

/** Drag handle on the docked panel's inner edge to resize the drawer. */
function ResizeGrip({
  side,
  onResize,
}: {
  side: "left" | "right" | null;
  onResize: (e: PointerEvent<HTMLDivElement>) => void;
}) {
  if (!side) {
    return null;
  }
  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-y-0 z-20 w-2 cursor-col-resize",
        side === "right" ? "left-0" : "right-0"
      )}
      onPointerDown={onResize}
    >
      <div className="absolute inset-y-[42%] left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-border" />
    </div>
  );
}

/** Full-viewport overlay drawing the dashed link from the panel to its dot. */
function LeaderLine({
  box,
  dotCx,
  dotCy,
}: {
  box: Box;
  dotCx: number;
  dotCy: number;
}) {
  const toLeftEdge = dotCx < box.left + box.width / 2;
  const edgeX = toLeftEdge ? box.left : box.left + box.width;
  const edgeY = Math.max(
    box.top + 16,
    Math.min(dotCy, box.top + box.height - 16)
  );
  const midX = (dotCx + edgeX) / 2;
  return (
    <svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9180] h-full w-full"
      role="img"
    >
      <title>Connector to the anchored element</title>
      <path
        className="redline-leader-line"
        d={`M${dotCx},${dotCy} C${midX},${dotCy} ${midX},${edgeY} ${edgeX},${edgeY}`}
      />
      <circle className="redline-leader-dot" cx={dotCx} cy={dotCy} r={3.5} />
    </svg>
  );
}
