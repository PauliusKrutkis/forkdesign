import { useCallback } from "react";
import { toErrorMessage } from "../lib/errors.ts";

export interface UseTextEditActionOptions {
  closeBeforePersist?: boolean;
  emptyMessage: string;
  onSubmit: (trimmed: string) => Promise<void>;
}

export function useTextEditAction({
  onSubmit,
  emptyMessage,
  closeBeforePersist = false,
}: UseTextEditActionOptions) {
  const save = useCallback(
    async (args: {
      draft: string;
      busy: boolean;
      setBusy: (busy: boolean) => void;
      setError: (error: string | null) => void;
      onSuccess: () => void;
      onRevert?: (message: string) => void;
    }) => {
      const { draft, busy, setBusy, setError, onSuccess, onRevert } = args;
      if (busy) {
        return;
      }
      const trimmed = draft.trim();
      if (!trimmed) {
        setError(emptyMessage);
        return;
      }
      setError(null);

      if (closeBeforePersist) {
        onSuccess();
        try {
          await onSubmit(trimmed);
        } catch (err) {
          const message = toErrorMessage(err);
          if (onRevert) {
            onRevert(message);
          } else {
            setError(message);
          }
        }
        return;
      }

      setBusy(true);
      try {
        await onSubmit(trimmed);
        onSuccess();
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [closeBeforePersist, emptyMessage, onSubmit]
  );

  return { save };
}
