import { useCallback, useEffect, useRef, useState } from "react";
import type { CommentData } from "../../types.ts";
import { useDeleteConfirm } from "./use-delete-confirm.ts";
import type { BubbleMode } from "./use-iterate-fix.ts";
import type { IterationsData } from "./use-iterations.ts";
import { useTextEditAction } from "./use-text-edit-action.ts";

interface UseBubbleLeadActionsArgs {
  iterations: IterationsData | null;
  lead: CommentData | undefined;
  onDelete?: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onEdit?: (id: string, text: string) => Promise<void>;
  onSubmitReply?: (id: string, text: string, v?: number) => Promise<void>;
  setMode: (mode: BubbleMode | ((prev: BubbleMode) => BubbleMode)) => void;
  skipDeleteConfirmation: boolean;
}

export function useBubbleLeadActions({
  lead,
  iterations,
  onDelete,
  onEdit,
  onSubmitReply,
  setMode,
  skipDeleteConfirmation,
}: UseBubbleLeadActionsArgs) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [revertBaseline, setRevertBaseline] = useState(false);

  const activeVersion = iterations?.active ?? lead?.active ?? 0;
  const showRevertOption =
    activeVersion > 0 && !skipDeleteConfirmation && Boolean(onDelete);

  const performDelete = useCallback(async () => {
    if (!(lead && onDelete)) {
      return;
    }
    await onDelete(lead.id, {
      revertBaseline: showRevertOption ? revertBaseline : false,
    });
  }, [lead, onDelete, revertBaseline, showRevertOption]);

  const { save: runTextSave } = useTextEditAction({
    closeBeforePersist: true,
    emptyMessage: "Comment cannot be empty",
    onSubmit: async (trimmed) => {
      if (!(lead && onEdit)) {
        return;
      }
      await onEdit(lead.id, trimmed);
    },
  });

  const { save: runReplySave } = useTextEditAction({
    closeBeforePersist: true,
    emptyMessage: "Reply cannot be empty",
    onSubmit: async (trimmed) => {
      if (!(lead && onSubmitReply)) {
        return;
      }
      const replyV = iterations?.active ?? lead.active;
      await onSubmitReply(lead.id, trimmed, replyV);
    },
  });

  const {
    confirming: deleteConfirming,
    busy: deleteBusy,
    error: deleteError,
    requestDelete: requestDeleteBase,
    confirmDelete,
    cancelDelete: cancelDeleteConfirm,
  } = useDeleteConfirm({
    skipConfirmation: skipDeleteConfirmation,
    onBeforeConfirm: () => setMode("detailed"),
    onDelete: performDelete,
  });

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

  const resetInlineFlows = useCallback(() => {
    setEditing(false);
    setReplyOpen(false);
    cancelDeleteConfirm();
  }, [cancelDeleteConfirm]);

  const startEditing = useCallback(() => {
    if (!(lead && onEdit)) {
      return;
    }
    setMode("detailed");
    setEditing(true);
    setEditDraft(lead.text);
    setEditError(null);
    setReplyOpen(false);
  }, [lead, onEdit, setMode]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditDraft("");
    setEditError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!(lead && onEdit)) {
      return;
    }
    const draftSnapshot = editDraft;
    await runTextSave({
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
        setEditDraft(draftSnapshot);
        setEditError(message);
      },
    });
  }, [lead, onEdit, editDraft, editBusy, runTextSave]);

  const openReplyComposer = useCallback(() => {
    setMode("detailed");
    setReplyOpen(true);
    setReplyDraft("");
    setReplyError(null);
    setEditing(false);
  }, [setMode]);

  const cancelReply = useCallback(() => {
    setReplyOpen(false);
    setReplyDraft("");
    setReplyError(null);
  }, []);

  const saveReply = useCallback(async () => {
    if (!(lead && onSubmitReply)) {
      return;
    }
    const draftSnapshot = replyDraft;
    await runReplySave({
      draft: replyDraft,
      busy: replyBusy,
      setBusy: setReplyBusy,
      setError: setReplyError,
      onSuccess: () => {
        setReplyOpen(false);
        setReplyDraft("");
      },
      onRevert: (message) => {
        setReplyOpen(true);
        setReplyDraft(draftSnapshot);
        setReplyError(message);
      },
    });
  }, [lead, onSubmitReply, replyDraft, replyBusy, runReplySave]);

  const requestDelete = useCallback(() => {
    if (!(lead && onDelete)) {
      return;
    }
    setRevertBaseline(false);
    requestDeleteBase();
  }, [lead, onDelete, requestDeleteBase]);

  const cancelDeleteWithReset = useCallback(() => {
    setRevertBaseline(false);
    cancelDeleteConfirm();
  }, [cancelDeleteConfirm]);

  return {
    activeVersion,
    cancelDeleteConfirm: cancelDeleteWithReset,
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
  };
}
