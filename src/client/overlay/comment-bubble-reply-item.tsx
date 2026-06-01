import { useEffect, useRef, useState } from "react";
import type { CommentReply } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {
  CommentBubbleAttribution,
  ReplyVersionBadge,
} from "./comment-bubble-attribution.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { ShortcutHint, withCtrl } from "./shortcut-hint.tsx";

export function CommentBubbleReplyItem({
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
      confirmDelete().catch(ignorePromiseRejection);
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
        <p className="m-0 text-muted-foreground text-sm leading-snug">
          {reply.text}
        </p>
      )}

      <div className="relative mt-1 flex items-center justify-between gap-2">
        {editing ? (
          <span />
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <ReplyVersionBadge v={reply.v} />
            <CommentBubbleAttribution author={reply.author} date={reply.date} />
          </div>
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
          <div className="absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 bg-gradient-to-l from-55% from-background to-transparent pl-8">
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
              onClick={() => {
                confirmDelete().catch(ignorePromiseRejection);
              }}
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
