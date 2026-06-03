import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.tsx";
import { CommentBubbleAttribution } from "./comment-bubble-attribution.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { useDeleteConfirm } from "./hooks/use-delete-confirm.ts";
import { useTextEditAction } from "./hooks/use-text-edit-action.ts";
import { InlineCommentEditor } from "./inline-comment-editor.tsx";

const NAME_SEPARATOR = /[.\-_\s]+/;

/** Initials for the entry avatar, derived from an author identifier/email. */
function initials(author: string): string {
  const name = author.split("@")[0] ?? author;
  const parts = name.split(NAME_SEPARATOR).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function HumanAvatar({ author }: { author: string }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full bg-primary font-medium text-[10px] text-primary-foreground"
      title={author}
    >
      {initials(author)}
    </span>
  );
}

interface TranscriptHumanEntryProps {
  ariaLabel: string;
  author: string;
  /** Optional badge shown in the meta row (e.g. `Re: v2` for replies). */
  badge?: ReactNode;
  date: string;
  /** Empty-state message for the inline editor when the draft is blank. */
  emptyMessage: string;
  onDelete?: () => Promise<void>;
  onEdit?: (text: string) => Promise<void>;
  onInteraction?: () => void;
  skipDeleteConfirmation: boolean;
  text: string;
}

/**
 * One human turn in the transcript — the original comment or a reply. Renders
 * as an avatar + content row; edit/delete surface on hover. Editing and
 * delete-confirm reuse the same hooks as the rest of the overlay.
 */
export function TranscriptHumanEntry({
  text,
  author,
  date,
  badge,
  emptyMessage,
  ariaLabel,
  onEdit,
  onDelete,
  onInteraction,
  skipDeleteConfirmation,
}: TranscriptHumanEntryProps) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { save: saveEditAction } = useTextEditAction({
    closeBeforePersist: true,
    emptyMessage,
    onSubmit: async (trimmed) => {
      await onEdit?.(trimmed);
    },
  });

  const {
    confirming: deleteConfirming,
    busy: deleteBusy,
    error: deleteError,
    requestDelete,
    confirmDelete,
    cancelDelete,
  } = useDeleteConfirm({
    skipConfirmation: skipDeleteConfirmation,
    onBeforeConfirm: () => {
      onInteraction?.();
      setEditing(false);
    },
    onDelete: async () => {
      await onDelete?.();
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
    setEditDraft(text);
    setEditError(null);
    cancelDelete();
  };

  const saveEdit = () => {
    const snapshot = editDraft;
    saveEditAction({
      draft: editDraft,
      busy: editBusy,
      setBusy: setEditBusy,
      setError: setEditError,
      onSuccess: () => {
        setEditing(false);
        setEditDraft("");
      },
      onRevert: (message) => {
        setEditing(true);
        setEditDraft(snapshot);
        setEditError(message);
      },
    });
  };

  return (
    <div className="group/entry flex gap-2.5">
      <HumanAvatar author={author} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <InlineCommentEditor
            ariaLabel={ariaLabel}
            busy={editBusy}
            error={editError}
            onCancel={() => {
              setEditing(false);
              setEditDraft("");
              setEditError(null);
            }}
            onChange={setEditDraft}
            onSave={saveEdit}
            textareaRef={editTextareaRef}
            value={editDraft}
          />
        ) : (
          <>
            <p className="m-0 whitespace-pre-wrap text-foreground text-sm leading-relaxed">
              {text}
            </p>
            <div className="relative mt-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {badge}
                <CommentBubbleAttribution author={author} date={date} />
              </div>
              {(onEdit || onDelete) && !deleteConfirming ? (
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/entry:opacity-100">
                  {onEdit ? (
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
                  {onDelete ? (
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
                <DeleteConfirmOverlay
                  busy={deleteBusy}
                  layout="overlay"
                  onCancel={cancelDelete}
                  onConfirm={confirmDelete}
                />
              ) : null}
            </div>
            {deleteError ? (
              <p className="m-0 mt-1 text-destructive text-xs">{deleteError}</p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
