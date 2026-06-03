import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DEFAULT_FIX_VERSION_COUNT,
  MAX_FIX_VERSION_COUNT,
} from "../../shared/fix-version-count.ts";
import { cn } from "../ui/cn.ts";
import { Textarea } from "../ui/textarea.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { withCtrl } from "./shortcut-hint.tsx";

/**
 * Composer mode. `agent` is the default verb: the message is recorded as a
 * versioned reply and the agent iterates on it. `comment` records the message
 * as a plain reply (or, for a new comment, just saves it) without running the
 * agent.
 */
export type ComposerMode = "agent" | "comment";

const FIX_VARIANT_OPTIONS = Array.from(
  { length: MAX_FIX_VERSION_COUNT },
  (_, i) => i + DEFAULT_FIX_VERSION_COUNT
);

const TEXTAREA_MAX_HEIGHT = 168;

interface CommentComposerBarProps {
  /** A plain reply / comment is saving. */
  busy: boolean;
  error?: string | null;
  fixVersionCount: number;
  /** A fix run is streaming. */
  iterating: boolean;
  mode: ComposerMode;
  onChange: (value: string) => void;
  onFixVersionCountChange: (count: number) => void;
  onModeChange: (mode: ComposerMode) => void;
  onSubmit: () => void | Promise<void>;
  /** Placeholder override; defaults adapt to the mode. */
  placeholder?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
}

/** Dismiss a popover on any pointer-down outside it (capture phase so it
 *  fires even though the bubble root stops propagation on its own children). */
function useMenuDismiss(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, close, ref]);
}

interface SelectOption<T extends string | number> {
  icon?: ReactNode;
  label: string;
  value: T;
}

/** Compact inline dropdown used for the mode and variant-count controls. */
function ComposerSelect<T extends string | number>({
  value,
  options,
  onChange,
  trigger,
  tipLabel,
  tipKeys,
  disabled,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  trigger: ReactNode;
  tipLabel: string;
  tipKeys?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useMenuDismiss(ref, open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <HotkeyTip keys={tipKeys} label={tipLabel}>
        <button
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground",
            open && "bg-muted text-foreground",
            disabled && "cursor-not-allowed opacity-50"
          )}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          type="button"
        >
          {trigger}
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
        </button>
      </HotkeyTip>
      {open ? (
        <div
          className="absolute bottom-full left-0 z-10 mb-1.5 min-w-[8.5rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          role="menu"
        >
          {options.map((opt) => (
            <button
              aria-checked={opt.value === value}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              key={String(opt.value)}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              role="menuitemradio"
              type="button"
            >
              {opt.icon}
              <span className="flex-1">{opt.label}</span>
              {opt.value === value ? (
                <Check aria-hidden className="h-3.5 w-3.5" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const MODE_ICON: Record<ComposerMode, ReactNode> = {
  agent: <Sparkles aria-hidden className="h-3.5 w-3.5" />,
  comment: <MessageSquare aria-hidden className="h-3.5 w-3.5" />,
};

const MODE_LABEL: Record<ComposerMode, string> = {
  agent: "Agent",
  comment: "Comment",
};

/**
 * Persistent composer pinned to the bottom of the bubble (and reused by the
 * new-comment panel). Controls live inside the writing surface and stay
 * minimal: a mode dropdown, a variant-count dropdown (agent only), and a single
 * send arrow. Sends on Cmd/Ctrl+Enter; ⌘/ toggles mode; ⌘. cycles the count.
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
  placeholder,
}: CommentComposerBarProps) {
  const isAgent = mode === "agent";
  const submitDisabled = !value.trim() || iterating || busy;
  const working = iterating || busy;

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

  const cycleCount = () => {
    const idx = FIX_VARIANT_OPTIONS.indexOf(fixVersionCount);
    const next =
      FIX_VARIANT_OPTIONS[(idx + 1) % FIX_VARIANT_OPTIONS.length] ??
      DEFAULT_FIX_VERSION_COUNT;
    onFixVersionCountChange(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      onModeChange(isAgent ? "comment" : "agent");
      return;
    }
    if (e.key === "." && isAgent) {
      e.preventDefault();
      cycleCount();
    }
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
          aria-label={isAgent ? "Instruction for the agent" : "Comment"}
          className="max-h-[168px] min-h-[40px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-none focus-visible:ring-0"
          disabled={iterating}
          onChange={(e) => {
            onChange(e.target.value);
            const ta = e.target;
            ta.style.height = "auto";
            ta.style.height = `${Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder={
            placeholder ??
            (isAgent ? "Tell the agent what to change…" : "Leave a comment…")
          }
          ref={textareaRef}
          rows={1}
          value={value}
        />
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
          <ComposerSelect
            disabled={iterating}
            onChange={onModeChange}
            options={[
              { value: "agent", label: "Agent", icon: MODE_ICON.agent },
              { value: "comment", label: "Comment", icon: MODE_ICON.comment },
            ]}
            tipKeys={withCtrl("/")}
            tipLabel="Switch mode"
            trigger={
              <span className="inline-flex items-center gap-1.5 font-medium">
                {MODE_ICON[mode]}
                {MODE_LABEL[mode]}
              </span>
            }
            value={mode}
          />
          {isAgent ? (
            <ComposerSelect
              disabled={iterating}
              onChange={onFixVersionCountChange}
              options={FIX_VARIANT_OPTIONS.map((n) => ({
                value: n,
                label: `${n} variants`,
              }))}
              tipKeys={withCtrl(".")}
              tipLabel="Variants to generate"
              trigger={
                <span className="font-mono tabular-nums">
                  {fixVersionCount}
                </span>
              }
              value={fixVersionCount}
            />
          ) : null}
          <div className="flex-1" />
          <HotkeyTip
            keys={withCtrl("⏎")}
            label={isAgent ? "Run agent" : "Send"}
          >
            <button
              aria-label={isAgent ? "Run agent" : "Send comment"}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                submitDisabled
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              disabled={submitDisabled}
              onClick={submit}
              type="button"
            >
              {working ? (
                <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp aria-hidden className="h-4 w-4" />
              )}
            </button>
          </HotkeyTip>
        </div>
      </div>
    </div>
  );
}
