import { useEffect, useRef, useState } from "react";
import { DEFAULT_FIX_VERSION_COUNT } from "../../shared/fix-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import {
  CommentComposerBar,
  type ComposerMode,
} from "./comment-composer-bar.tsx";
import { toErrorMessage } from "./lib/errors.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";

export interface TranscriptEditSubmit {
  model: OverlayModel;
  runAgent: boolean;
  text: string;
  versionCount: number;
}

interface TranscriptEntryComposerProps {
  defaultMode: ComposerMode;
  disabled?: boolean;
  fixModel: OverlayModel;
  fixVersionCount: number;
  initialText: string;
  iterating: boolean;
  onCancel: () => void;
  onFixModelChange: (model: OverlayModel) => void;
  onSubmit: (payload: TranscriptEditSubmit) => Promise<void>;
}

/**
 * Inline editor for a transcript human turn — reuses the bubble composer bar
 * (mode, model, variant count) so editing a past prompt matches sending a new one.
 */
export function TranscriptEntryComposer({
  initialText,
  defaultMode,
  fixModel,
  fixVersionCount,
  onFixModelChange,
  iterating,
  disabled,
  onSubmit,
  onCancel,
}: TranscriptEntryComposerProps) {
  const [draft, setDraft] = useState(initialText);
  const [mode, setMode] = useState<ComposerMode>(defaultMode);
  const [versionCount, setVersionCount] = useState(
    fixVersionCount || DEFAULT_FIX_VERSION_COUNT
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !iterating) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, iterating, onCancel]);

  const submit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || busy || iterating || disabled) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        text: trimmed,
        runAgent: mode === "agent",
        versionCount,
        model: fixModel,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CommentComposerBar
      busy={busy}
      error={error}
      fixModel={fixModel}
      fixVersionCount={versionCount}
      iterating={iterating}
      mode={mode}
      onChange={setDraft}
      onFixModelChange={onFixModelChange}
      onFixVersionCountChange={setVersionCount}
      onModeChange={setMode}
      onSubmit={() => {
        submit().catch(ignorePromiseRejection);
      }}
      textareaRef={textareaRef}
      value={draft}
    />
  );
}
