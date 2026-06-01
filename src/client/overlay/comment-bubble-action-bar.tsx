import {
  CheckCircle2,
  Loader2,
  MessageSquareReply,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CommentData } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { ActionIconButton } from "./comment-bubble-action-buttons.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { withCtrl } from "./shortcut-hint.tsx";

interface CommentBubbleActionBarProps {
  deleteBusy: boolean;
  deleteConfirming: boolean;
  iterating: boolean;
  lead: CommentData;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onIterate: () => Promise<void>;
  onOpenReply: () => void;
  onRequestDelete: () => void;
  onResolve?: (id: string) => void;
}

export function CommentBubbleActionBar({
  lead,
  iterating,
  onOpenReply,
  onResolve,
  onDelete,
  onIterate,
  onRequestDelete,
  deleteConfirming,
  deleteBusy,
  onCancelDelete,
  onConfirmDelete,
}: CommentBubbleActionBarProps) {
  return (
    <div className="relative flex shrink-0 divide-x divide-border border-t">
      <ActionIconButton keys="R" label="Reply" onClick={onOpenReply}>
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
        onClick={onIterate}
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
          onClick={onRequestDelete}
        >
          <Trash2 aria-hidden className="h-4 w-4" />
        </ActionIconButton>
      ) : null}

      {deleteConfirming ? (
        <DeleteConfirmOverlay
          busy={deleteBusy}
          cancelTip={
            <HotkeyTip keys="Esc" label="Cancel">
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={onCancelDelete}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </HotkeyTip>
          }
          confirmTip={
            <HotkeyTip keys="⏎" label="Delete">
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={() => {
                  onConfirmDelete().catch(ignorePromiseRejection);
                }}
                size="sm"
                type="button"
                variant="destructive"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </HotkeyTip>
          }
          layout="overlay"
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </div>
  );
}
