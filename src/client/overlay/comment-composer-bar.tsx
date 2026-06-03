import { Loader2, MessageSquareReply, Send, Sparkles } from "lucide-react";
import { useEffect } from "react";
import {
  DEFAULT_FIX_VERSION_COUNT,
  MAX_FIX_VERSION_COUNT,
} from "../../shared/fix-version-count.ts";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { Kbd } from "../ui/kbd.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { withCtrl } from "./shortcut-hint.tsx";

/**
 * Composer mode. `fix` is the default verb: the message is recorded as a
 * versioned reply and the agent iterates on it. `comment` records the message
 * as a plain reply without invoking the agent (a note for a teammate).
 */
export type ComposerMode = "fix" | "comment";

const FIX_VARIANT_OPTIONS = Array.from(
  { length: MAX_FIX_VERSION_COUNT },
  (_, i) => i + DEFAULT_FIX_VERSION_COUNT
);

const TEXTAREA_MAX_HEIGHT = 168;

interface CommentComposerBarProps {
  /** A plain reply is saving (comment mode). */
  busy: boolean;
  error?: string | null;
  fixVersionCount: number;
  /** A fix run is streaming — disable submit and spin the Fix glyph. */
  iterating: boolean;
  mode: ComposerMode;
  onChange: (value: string) => void;
  onFixVersionCountChange: (count: number) => void;
  onModeChange: (mode: ComposerMode) => void;
  onSubmit: () => void | Promise<void>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
}

function ModePill({
  mode,
  onModeChange,
  disabled,
}: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  disabled: boolean;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a two-option segmented toggle, not a form fieldset
    <div
      aria-label="Send mode"
      className="flex shrink-0 items-center gap-0.5 rounded-md border bg-muted p-0.5"
      role="group"
    >
      <ModePillOption
        active={mode === "fix"}
        disabled={disabled}
        label="Fix"
        onClick={() => onModeChange("fix")}
      >
        <Sparkles aria-hidden className="h-3.5 w-3.5" />
        Fix
      </ModePillOption>
      <ModePillOption
        active={mode === "comment"}
        disabled={disabled}
        label="Comment"
        onClick={() => onModeChange("comment")}
      >
        <MessageSquareReply aria-hidden className="h-3.5 w-3.5" />
        Comment
      </ModePillOption>
    </div>
  );
}

function ModePillOption({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2 font-medium text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50"
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function VariantCountSelect({
  count,
  disabled,
  onChange,
}: {
  count: number;
  disabled: boolean;
  onChange: (count: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <label className="sr-only" htmlFor="fix-variant-count">
        Fix variants to generate
      </label>
      <select
        className="h-7 rounded-md border border-input bg-background px-1.5 text-center text-foreground text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id="fix-variant-count"
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        title="Independent variants to generate from the current version"
        value={count}
      >
        {FIX_VARIANT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="hidden sm:inline">variants</span>
    </div>
  );
}

/**
 * Persistent composer pinned to the bottom of the bubble. Auto-grows with its
 * content, sends on Cmd/Ctrl+Enter, and exposes the Fix/Comment mode pill that
 * decides whether the agent runs. The whole box reads as one writing surface —
 * the textarea is borderless and the tools row sits flush beneath it.
 */
export function CommentComposerBar({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  fixVersionCount,
  onFixVersionCountChange,
  iterating,
  busy,
  error,
  textareaRef,
}: CommentComposerBarProps) {
  const isFix = mode === "fix";
  const submitDisabled = !value.trim() || iterating || busy;

  // Auto-grow with content up to a cap, then scroll — so the composer reads as
  // one surface rather than a fixed box you type into.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) {
      return;
    }
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [textareaRef]);

  const submit = () => {
    if (submitDisabled) {
      return;
    }
    Promise.resolve(onSubmit()).catch(ignorePromiseRejection);
  };

  return (
    <div className="shrink-0 border-t bg-background p-2">
      {error ? (
        <p className="m-0 mb-1.5 px-1 text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring">
        <Textarea
          aria-label={isFix ? "Instruction for the agent" : "Reply"}
          className="max-h-[168px] min-h-[40px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-none focus-visible:ring-0"
          disabled={iterating}
          onChange={(e) => {
            onChange(e.target.value);
            const ta = e.target;
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            isFix
              ? "Tell the agent what to change…"
              : "Leave a note for a teammate…"
          }
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <ModePill
            disabled={iterating}
            mode={mode}
            onModeChange={onModeChange}
          />
          {isFix ? (
            <VariantCountSelect
              count={fixVersionCount}
              disabled={iterating}
              onChange={onFixVersionCountChange}
            />
          ) : null}
          <div className="flex-1" />
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <Kbd>{withCtrl("⏎")}</Kbd>
          </span>
          <Button
            disabled={submitDisabled}
            onClick={submit}
            size="sm"
            type="button"
          >
            {isFix ? (
              <>
                {iterating ? (
                  <Loader2 aria-hidden className="animate-spin" />
                ) : (
                  <Sparkles aria-hidden />
                )}
                {iterating ? "Fixing…" : "Fix"}
              </>
            ) : (
              <>
                <Send aria-hidden />
                Comment
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
