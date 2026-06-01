import { useCallback } from "react";
import { toErrorMessage } from "../lib/errors.ts";

export interface UseTextEditActionOptions {
  emptyMessage: string;
  onSubmit: (trimmed: string) => Promise<void>;
}

export function useTextEditAction({
  onSubmit,
  emptyMessage,
}: UseTextEditActionOptions) {
  const save = useCallback(
    async (args: {
      draft: string;
      busy: boolean;
      setBusy: (busy: boolean) => void;
      setError: (error: string | null) => void;
      onSuccess: () => void;
    }) => {
      const { draft, busy, setBusy, setError, onSuccess } = args;
      if (busy) {
        return;
      }
      const trimmed = draft.trim();
      if (!trimmed) {
        setError(emptyMessage);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await onSubmit(trimmed);
        onSuccess();
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [emptyMessage, onSubmit]
  );

  return { save };
}
