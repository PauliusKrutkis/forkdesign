import type { RefObject } from "react";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { ShortcutHint, withCtrl } from "./shortcut-hint.tsx";

export interface InlineCommentEditorProps {
  ariaLabel: string;
  busy: boolean;
  error: string | null;
  minHeightClass?: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  placeholder?: string;
  saveLabel?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
}

export function InlineCommentEditor({
  ariaLabel,
  busy,
  error,
  onCancel,
  onChange,
  onSave,
  textareaRef,
  value,
  minHeightClass = "min-h-[64px]",
  placeholder,
  saveLabel = "Save",
}: InlineCommentEditorProps) {
  return (
    <div className="space-y-2">
      <Textarea
        aria-label={ariaLabel}
        className={`${minHeightClass} resize-none text-sm leading-relaxed`}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            Promise.resolve(onSave()).catch(ignorePromiseRejection);
          }
        }}
        placeholder={placeholder}
        ref={textareaRef}
        value={value}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={onCancel}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          disabled={busy}
          onClick={() => {
            Promise.resolve(onSave()).catch(ignorePromiseRejection);
          }}
          size="sm"
          type="button"
        >
          {busy ? (
            "Saving…"
          ) : (
            <>
              {saveLabel}
              <ShortcutHint onPrimary>{withCtrl("⏎")}</ShortcutHint>
            </>
          )}
        </Button>
      </div>
      {error ? <p className="m-0 text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
