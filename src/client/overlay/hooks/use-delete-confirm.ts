import { useCallback, useState } from "react";
import { toErrorMessage } from "../lib/errors.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";

export interface UseDeleteConfirmOptions {
  /** Called before showing confirmation (e.g. close other inline editors). */
  onBeforeConfirm?: () => void;
  onDelete: () => Promise<void>;
  skipConfirmation?: boolean;
}

export function useDeleteConfirm({
  onDelete,
  skipConfirmation = false,
  onBeforeConfirm,
}: UseDeleteConfirmOptions) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelDelete = useCallback(() => {
    setConfirming(false);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setConfirming(false);
    } catch (err) {
      setError(toErrorMessage(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }, [busy, onDelete]);

  const requestDelete = useCallback(() => {
    if (busy) {
      return;
    }
    setError(null);
    onBeforeConfirm?.();
    if (skipConfirmation) {
      confirmDelete().catch(ignorePromiseRejection);
      return;
    }
    setConfirming(true);
  }, [busy, skipConfirmation, confirmDelete, onBeforeConfirm]);

  return {
    confirming,
    busy,
    error,
    requestDelete,
    confirmDelete,
    cancelDelete,
    setConfirming,
    setError,
  };
}
