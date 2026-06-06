import { useEffect, useRef, useState } from "react";
import { DEFAULT_AGENT_VERSION_COUNT } from "../../shared/agent-version-count.ts";
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
  agentModel: OverlayModel;
  agentVersionCount: number;
  defaultMode: ComposerMode;
  disabled?: boolean;
  initialText: string;
  iterating: boolean;
  onAgentModelChange: (model: OverlayModel) => void;
  onCancel: () => void;
  onSubmit: (payload: TranscriptEditSubmit) => Promise<void>;
}

/**
 * Inline editor for a transcript human turn — reuses the bubble composer bar
 * (mode, model, variant count) so editing a past prompt matches sending a new one.
 */
export function TranscriptEntryComposer({
  initialText,
  defaultMode,
  agentModel,
  agentVersionCount,
  onAgentModelChange,
  iterating,
  disabled,
  onSubmit,
  onCancel,
}: TranscriptEntryComposerProps) {
  const [draft, setDraft] = useState(initialText);
  const [mode, setMode] = useState<ComposerMode>(defaultMode);
  const [versionCount, setVersionCount] = useState(
    agentVersionCount || DEFAULT_AGENT_VERSION_COUNT
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
        model: agentModel,
      });
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CommentComposerBar
      agentModel={agentModel}
      agentVersionCount={versionCount}
      busy={busy}
      error={error}
      iterating={iterating}
      mode={mode}
      onAgentModelChange={onAgentModelChange}
      onAgentVersionCountChange={setVersionCount}
      onChange={setDraft}
      onModeChange={setMode}
      onSubmit={() => {
        submit().catch(ignorePromiseRejection);
      }}
      textareaRef={textareaRef}
      value={draft}
    />
  );
}
