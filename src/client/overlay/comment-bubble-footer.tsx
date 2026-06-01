import type { CommentData } from "../types.ts";
import { CommentBubbleActionBar } from "./comment-bubble-action-bar.tsx";
import { CommentBubbleLightbox } from "./comment-bubble-lightbox.tsx";
import type { BubbleMode } from "./hooks/use-iterate-fix.ts";
import { formatElapsed } from "./lib/bubble-formatters.ts";

interface CommentBubbleFooterProps {
  activeVersion?: number;
  deleteBusy: boolean;
  deleteConfirming: boolean;
  deleteError: string | null;
  fixVersionCount: number;
  handleIterate: () => Promise<void>;
  iterateError: string | null;
  iterateNow: number;
  iterateStartedAt: number | null;
  iterateStatus: string | null;
  iterating: boolean;
  lead: CommentData;
  lightboxSrc: string | null;
  mode: BubbleMode;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onFixVersionCountChange: (count: number) => void;
  onOpenReply: () => void;
  onRequestDelete: () => void;
  onResolve?: (id: string) => void;
  onRevertBaselineChange?: (value: boolean) => void;
  onSetLightboxSrc: (src: string | null) => void;
  revertBaseline?: boolean;
  showRevertOption?: boolean;
}

export function CommentBubbleFooter({
  mode,
  iterating,
  iterateStatus,
  iterateStartedAt,
  iterateNow,
  iterateError,
  lead,
  fixVersionCount,
  onFixVersionCountChange,
  onOpenReply,
  onResolve,
  onDelete,
  handleIterate,
  onRequestDelete,
  deleteConfirming,
  deleteBusy,
  onCancelDelete,
  onConfirmDelete,
  deleteError,
  lightboxSrc,
  onSetLightboxSrc,
  activeVersion,
  revertBaseline,
  onRevertBaselineChange,
  showRevertOption,
}: CommentBubbleFooterProps) {
  if (mode !== "detailed") {
    return null;
  }

  return (
    <>
      {iterating || iterateStatus ? (
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

      {iterateError ? (
        <div
          className="shrink-0 border-t bg-amber-500/10 px-4 py-1.5 text-amber-700 text-xs"
          role="alert"
        >
          {iterateError}
        </div>
      ) : null}

      <CommentBubbleActionBar
        activeVersion={activeVersion}
        deleteBusy={deleteBusy}
        deleteConfirming={deleteConfirming}
        fixVersionCount={fixVersionCount}
        iterating={iterating}
        lead={lead}
        onCancelDelete={onCancelDelete}
        onConfirmDelete={onConfirmDelete}
        onDelete={onDelete}
        onFixVersionCountChange={onFixVersionCountChange}
        onIterate={handleIterate}
        onOpenReply={onOpenReply}
        onRequestDelete={onRequestDelete}
        onResolve={onResolve}
        onRevertBaselineChange={onRevertBaselineChange}
        revertBaseline={revertBaseline}
        showRevertOption={showRevertOption}
      />

      {deleteError ? (
        <div
          className="shrink-0 border-t bg-destructive/10 px-4 py-1.5 text-destructive text-xs"
          role="alert"
        >
          {deleteError}
        </div>
      ) : null}

      {lightboxSrc ? (
        <CommentBubbleLightbox
          onClose={() => onSetLightboxSrc(null)}
          src={lightboxSrc}
        />
      ) : null}
    </>
  );
}

export function createBubbleDragHandler(args: {
  placement: { left: number; top: number };
  setUserPosition: (pos: { left: number; top: number }) => void;
  userPosition: { left: number; top: number } | null;
}): (e: React.PointerEvent<HTMLDivElement>) => void {
  return (e) => {
    if ((e.target as Element).closest("button")) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseLeft = args.userPosition?.left ?? args.placement.left;
    const baseTop = args.userPosition?.top ?? args.placement.top;
    const onMove = (ev: PointerEvent) => {
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
