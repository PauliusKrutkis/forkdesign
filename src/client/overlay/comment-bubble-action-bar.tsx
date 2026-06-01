import {
  CheckCircle2,
  Loader2,
  MessageSquareReply,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_FIX_VERSION_COUNT,
  MAX_FIX_VERSION_COUNT,
} from "../../shared/fix-version-count.ts";
import type { CommentData } from "../types.ts";
import { Button } from "../ui/button.tsx";
import { ActionIconButton } from "./comment-bubble-action-buttons.tsx";
import { DeleteConfirmOverlay } from "./delete-confirm-overlay.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { withCtrl } from "./shortcut-hint.tsx";

const FIX_VARIANT_OPTIONS = Array.from(
  { length: MAX_FIX_VERSION_COUNT },
  (_, i) => i + DEFAULT_FIX_VERSION_COUNT
);

function FixVariantCountSelect({
  count,
  disabled,
  onChange,
}: {
  count: number;
  disabled: boolean;
  onChange: (count: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center border-border border-r px-2">
      <label className="sr-only" htmlFor="fix-variant-count">
        Fix variants to generate
      </label>
      <select
        className="h-7 w-11 rounded-md border border-input bg-background px-1 text-center text-foreground text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id="fix-variant-count"
        onChange={(e) => {
          onChange(Number.parseInt(e.target.value, 10));
        }}
        title="Independent variants to generate from the current version"
        value={count}
      >
        {FIX_VARIANT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CommentBubbleActionBarProps {
  activeVersion?: number;
  deleteBusy: boolean;
  deleteConfirming: boolean;
  fixVersionCount: number;
  iterating: boolean;
  lead: CommentData;
  onCancelDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onFixVersionCountChange: (count: number) => void;
  onIterate: () => Promise<void>;
  onOpenReply: () => void;
  onRequestDelete: () => void;
  onResolve?: (id: string) => void;
  onRevertBaselineChange?: (value: boolean) => void;
  revertBaseline?: boolean;
  showRevertOption?: boolean;
}

export function CommentBubbleActionBar({
  lead,
  iterating,
  fixVersionCount,
  onFixVersionCountChange,
  onOpenReply,
  onResolve,
  onDelete,
  onIterate,
  onRequestDelete,
  deleteConfirming,
  deleteBusy,
  onCancelDelete,
  onConfirmDelete,
  activeVersion,
  revertBaseline,
  onRevertBaselineChange,
  showRevertOption,
}: CommentBubbleActionBarProps) {
  const fixLabel =
    fixVersionCount > 1 ? `Fix (${fixVersionCount} variants)` : "Fix";

  return (
    <div className="relative flex shrink-0 divide-x divide-border border-t">
      <ActionIconButton keys="R" label="Reply" onClick={onOpenReply}>
        <MessageSquareReply aria-hidden className="h-4 w-4" />
      </ActionIconButton>
      <ActionIconButton
        active={lead.resolved}
        keys={lead.resolved ? undefined : withCtrl("R")}
        label={lead.resolved ? "Resolved" : "Resolve"}
        onClick={() => onResolve?.(lead.id)}
      >
        <CheckCircle2 aria-hidden className="h-4 w-4" />
      </ActionIconButton>
      <FixVariantCountSelect
        count={fixVersionCount}
        disabled={iterating}
        onChange={onFixVersionCountChange}
      />
      <ActionIconButton
        disabled={iterating}
        keys={withCtrl("I")}
        label={fixLabel}
        onClick={onIterate}
      >
        {iterating ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles aria-hidden className="h-4 w-4" />
        )}
      </ActionIconButton>
      {onDelete ? (
        <ActionIconButton
          destructive
          disabled={deleteBusy}
          keys={withCtrl("⌫")}
          label="Delete"
          onClick={onRequestDelete}
        >
          <Trash2 aria-hidden className="h-4 w-4" />
        </ActionIconButton>
      ) : null}

      {deleteConfirming ? (
        <DeleteConfirmOverlay
          activeVersion={activeVersion}
          busy={deleteBusy}
          cancelTip={
            <HotkeyTip keys="Esc" label="Cancel">
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={onCancelDelete}
                size="sm"
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
            </HotkeyTip>
          }
          confirmTip={
            <HotkeyTip keys="⏎" label="Delete">
              <Button
                className="h-7 px-2 text-xs"
                disabled={deleteBusy}
                onClick={() => {
                  onConfirmDelete().catch(ignorePromiseRejection);
                }}
                size="sm"
                type="button"
                variant="destructive"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </HotkeyTip>
          }
          layout="overlay"
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
          onRevertBaselineChange={onRevertBaselineChange}
          revertBaseline={revertBaseline}
          showRevertOption={showRevertOption}
        />
      ) : null}
    </div>
  );
}
