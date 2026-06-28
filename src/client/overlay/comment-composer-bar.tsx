import {
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  Sparkles,
  Square,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DEFAULT_AGENT_VERSION_COUNT,
  MAX_AGENT_VERSION_COUNT,
} from "../../shared/agent-version-count.ts";
import { OVERLAY_MODEL_OPTIONS, type OverlayModel } from "../settings.ts";
import { cn } from "../ui/cn.ts";
import { Textarea } from "../ui/textarea.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { formatReplyVersionContext } from "./lib/version-format.ts";
import { withAlt, withCtrl } from "./shortcut-hint.tsx";

/**
 * Composer mode. `agent` is the default verb: the message is recorded as a
 * versioned reply and the agent iterates on it. `comment` records the message
 * as a plain reply (or, for a new comment, just saves it) without running the
 * agent.
 */
export type ComposerMode = "agent" | "comment";

const AGENT_VARIANT_OPTIONS = Array.from(
  { length: MAX_AGENT_VERSION_COUNT },
  (_, i) => i + DEFAULT_AGENT_VERSION_COUNT
);

const TEXTAREA_MAX_HEIGHT = 168;

interface CommentComposerBarProps {
  agentModel: OverlayModel;
  agentVersionCount: number;
  busy: boolean;
  error?: string | null;
  iterating: boolean;
  mode: ComposerMode;
  onAgentModelChange: (model: OverlayModel) => void;
  onAgentVersionCountChange: (count: number) => void;
  onCancelIterate?: () => void;
  onChange: (value: string) => void;
  onModeChange: (mode: ComposerMode) => void;
  onSubmit: () => void | Promise<void>;
  placeholder?: string;
  replyVersion?: number;
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

function ComposerTextarea({
  isAgent,
  iterating,
  onChange,
  onKeyDown,
  placeholder,
  replyVersionLabel,
  textareaRef,
  value,
}: {
  isAgent: boolean;
  iterating: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  replyVersionLabel: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
}) {
  return (
    <div className="relative">
      {replyVersionLabel ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-2.5 right-3 select-none font-mono text-[10px] text-muted-foreground/55 tabular-nums"
          title={`Replying on ${replyVersionLabel}`}
        >
          on {replyVersionLabel}
        </span>
      ) : null}
      <Textarea
        aria-describedby={
          replyVersionLabel ? "composer-reply-version" : undefined
        }
        aria-label={isAgent ? "Instruction for the agent" : "Comment"}
        className={cn(
          "max-h-[168px] min-h-[40px] resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed shadow-none focus-visible:ring-0",
          replyVersionLabel && "pr-[4.75rem]"
        )}
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
      {replyVersionLabel ? (
        <span className="sr-only" id="composer-reply-version">
          Replying on {replyVersionLabel}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Persistent composer pinned to the bottom of the bubble (and reused by the
 * new-comment panel). Controls live inside the writing surface and stay
 * minimal: mode, model, and variant-count dropdowns (agent only), plus send.
 * Sends on Cmd/Ctrl+Enter; ⌘/ toggles mode; ⌥↑/↓ steps variant count.
 */
export function CommentComposerBar({
  value,
  onChange,
  onSubmit,
  mode,
  onModeChange,
  agentModel,
  onAgentModelChange,
  agentVersionCount,
  onAgentVersionCountChange,
  iterating,
  onCancelIterate,
  busy,
  error,
  textareaRef,
  placeholder,
  replyVersion,
}: CommentComposerBarProps) {
  const isAgent = mode === "agent";
  const submitDisabled = !value.trim() || iterating || busy;
  const replyVersionLabel =
    replyVersion === undefined ? null : formatReplyVersionContext(replyVersion);

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

  const stepVersionCount = (delta: number) => {
    const idx = AGENT_VARIANT_OPTIONS.indexOf(agentVersionCount);
    const baseIdx = idx >= 0 ? idx : 0;
    const nextIdx = Math.max(
      0,
      Math.min(AGENT_VARIANT_OPTIONS.length - 1, baseIdx + delta)
    );
    onAgentVersionCountChange(
      AGENT_VARIANT_OPTIONS[nextIdx] ?? DEFAULT_AGENT_VERSION_COUNT
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      isAgent &&
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown")
    ) {
      e.preventDefault();
      stepVersionCount(e.key === "ArrowUp" ? 1 : -1);
      return;
    }

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
        <ComposerTextarea
          isAgent={isAgent}
          iterating={iterating}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          replyVersionLabel={replyVersionLabel}
          textareaRef={textareaRef}
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
            <>
              <ComposerSelect
                disabled={iterating}
                onChange={onAgentModelChange}
                options={OVERLAY_MODEL_OPTIONS.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                tipLabel="Agent model"
                trigger={
                  <span className="max-w-[5.5rem] truncate font-mono text-[11px]">
                    {OVERLAY_MODEL_OPTIONS.find((o) => o.value === agentModel)
                      ?.shortLabel ?? agentModel}
                  </span>
                }
                value={agentModel}
              />
              <ComposerSelect
                disabled={iterating}
                onChange={onAgentVersionCountChange}
                options={AGENT_VARIANT_OPTIONS.map((n) => ({
                  value: n,
                  label: `${n} variants`,
                }))}
                tipKeys={`${withAlt("↑")} ${withAlt("↓")}`}
                tipLabel="Variants to generate"
                trigger={
                  <span className="font-mono tabular-nums">
                    {agentVersionCount}
                  </span>
                }
                value={agentVersionCount}
              />
            </>
          ) : null}
          <div className="flex-1" />
          {iterating && onCancelIterate ? (
            <HotkeyTip label="Stop agent">
              <button
                aria-label="Stop agent"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground transition-colors hover:bg-muted/80"
                onClick={onCancelIterate}
                type="button"
              >
                <Square aria-hidden className="h-3.5 w-3.5 fill-current" />
              </button>
            </HotkeyTip>
          ) : (
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
                {busy ? (
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp aria-hidden className="h-4 w-4" />
                )}
              </button>
            </HotkeyTip>
          )}
        </div>
      </div>
    </div>
  );
}
