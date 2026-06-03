import { useCallback, useState } from "react";
import type { CommentData } from "../../types.ts";
import { useDeleteConfirm } from "./use-delete-confirm.ts";

interface UseBubbleLeadActionsArgs {
  /** Active iteration version — gates the "revert to baseline" delete option. */
  activeVersion: number;
  lead: CommentData | undefined;
  onDelete?: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  skipDeleteConfirmation: boolean;
}

/**
 * Thread-level delete for the open comment. Editing and replies now live on the
 * individual transcript entries / the composer, so this hook is just the
 * delete-confirm flow plus the "revert source to baseline" option offered when
 * a non-baseline version is live.
 */
export function useBubbleLeadActions({
  lead,
  activeVersion,
  onDelete,
  skipDeleteConfirmation,
}: UseBubbleLeadActionsArgs) {
  const [revertBaseline, setRevertBaseline] = useState(false);

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

  const {
    confirming: deleteConfirming,
    busy: deleteBusy,
    error: deleteError,
    requestDelete: requestDeleteBase,
    confirmDelete,
    cancelDelete: cancelDeleteBase,
  } = useDeleteConfirm({
    skipConfirmation: skipDeleteConfirmation,
    onDelete: performDelete,
  });

  const requestDelete = useCallback(() => {
    if (!(lead && onDelete)) {
      return;
    }
    setRevertBaseline(false);
    requestDeleteBase();
  }, [lead, onDelete, requestDeleteBase]);

  const cancelDeleteConfirm = useCallback(() => {
    setRevertBaseline(false);
    cancelDeleteBase();
  }, [cancelDeleteBase]);

  return {
    deleteConfirming,
    deleteBusy,
    deleteError,
    requestDelete,
    confirmDelete,
    cancelDeleteConfirm,
    revertBaseline,
    setRevertBaseline,
    showRevertOption,
  };
}
