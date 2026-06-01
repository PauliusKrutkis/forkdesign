import { useEffect, useRef, useState } from "react";
import type { CommentReply } from "../types.ts";
import { Button } from "../ui/button.tsx";
import {
  CommentBubbleAttribution,
  ReplyVersionBadge,
} from "./comment-bubble-attribution.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";
import { useTextEditAction } from "./hooks/use-text-edit-action.ts";
import { InlineCommentEditor } from "./inline-comment-editor.tsx";

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
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { save: saveEditAction } = useTextEditAction({
    emptyMessage: "Reply cannot be empty",
    onSubmit: async (trimmed) => {
      if (!onEdit) {
        return;
      }
      await onEdit(commentId, replyIndex, trimmed);
    },
  });

  const {
    confirming: deleteConfirming,
    busy: deleteBusy,
    error: deleteError,
    requestDelete,
    confirmDelete,
    cancelDelete: cancelDeleteConfirm,
  } = useDeleteConfirm({
    skipConfirmation: skipDeleteConfirmation,
    onBeforeConfirm: () => {
      onInteraction?.();
      setEditing(false);
    },
    onDelete: async () => {
      if (!onDelete) {
        return;
      }
      await onDelete(commentId, replyIndex);
    },
  });

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
    cancelDeleteConfirm();
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditDraft("");
    setEditError(null);
  };

  const saveEdit = () =>
    saveEditAction({
      draft: editDraft,
      busy: editBusy,
      setBusy: setEditBusy,
      setError: setEditError,
      onSuccess: () => {
        setEditing(false);
        setEditDraft("");
      },
    });

  const handleRequestDelete = () => {
    if (!onDelete) {
      return;
    }
    requestDelete();
  };

  return (
    <li>
      {editing ? (
        <InlineCommentEditor
          ariaLabel="Edit reply"
          busy={editBusy}
          error={editError}
          onCancel={cancelEditing}
          onChange={setEditDraft}
          onSave={saveEdit}
          textareaRef={editTextareaRef}
          value={editDraft}
        />
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
                onClick={handleRequestDelete}
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
          <DeleteConfirmOverlay
            busy={deleteBusy}
            layout="overlay"
            onCancel={cancelDeleteConfirm}
            onConfirm={confirmDelete}
          />
        ) : null}
      </div>

      {deleteError ? (
        <p className="m-0 mt-1 text-destructive text-xs">{deleteError}</p>
      ) : null}
    </li>
  );
}
