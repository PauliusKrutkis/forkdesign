import { Loader2 } from "lucide-react";
import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import { cn } from "../ui/cn.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { ShortcutHint, withCtrl } from "./shortcut-hint.tsx";

export interface DeleteConfirmOverlayProps {
  activeVersion?: number;
  busy: boolean;
  cancelTip?: ReactNode;
  confirmTip?: ReactNode;
  label?: ReactNode;
  /** Full-width card (bubble thread delete, reply row). */
  layout?: "overlay" | "inline" | "panel" | "compact";
  onCancel: (e?: MouseEvent) => void;
  onConfirm: () => Promise<void>;
  onRevertBaselineChange?: (value: boolean) => void;
  revertBaseline?: boolean;
  /** Show Enter / Esc hints (thread delete in the bubble). */
  showKeyboardHints?: boolean;
  showRevertOption?: boolean;
}

function RevertBaselineOption({
  activeVersion = 0,
  revertBaseline,
  onRevertBaselineChange,
}: {
  activeVersion?: number;
  revertBaseline: boolean;
  onRevertBaselineChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border/80 bg-background/60 px-2.5 py-2 text-left">
      <input
        checked={revertBaseline}
        className="mt-0.5 size-3.5 shrink-0 rounded border-border accent-destructive"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onRevertBaselineChange(e.target.checked);
        }}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground text-xs leading-snug">
          Revert source to baseline (v0)
        </span>
        {activeVersion > 0 ? (
          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground leading-snug">
            Live version is v{activeVersion}. Uncheck to keep those changes.
          </span>
        ) : null}
      </span>
    </label>
  );
}

function DeleteConfirmActions({
  busy,
  onCancel,
  onConfirm,
  cancelTip,
  confirmTip,
  stopPropagation,
}: Pick<
  DeleteConfirmOverlayProps,
  "busy" | "onCancel" | "onConfirm" | "cancelTip" | "confirmTip"
> & { stopPropagation?: boolean }) {
  const wrapClick = (handler: (e?: MouseEvent) => void) => (e: MouseEvent) => {
    if (stopPropagation) {
      e.stopPropagation();
    }
    handler(e);
  };

  const cancelButton = (
    <button
      className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy}
      onClick={wrapClick(onCancel)}
      type="button"
    >
      Cancel
    </button>
  );

  const confirmButton = (
    <button
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 font-medium font-mono text-[11px] text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy}
      onClick={wrapClick(() => {
        onConfirm().catch(ignorePromiseRejection);
      })}
      type="button"
    >
      {busy ? (
        <>
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          Deleting…
        </>
      ) : (
        "Delete"
      )}
    </button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1">
      {cancelTip ?? cancelButton}
      {confirmTip ?? confirmButton}
    </div>
  );
}

function DeleteConfirmLabel({ label }: { label: ReactNode }) {
  return (
    <p className="m-0 font-medium font-mono text-[11px] text-foreground leading-snug tracking-tight">
      {label}
    </p>
  );
}

function DeleteKeyboardHints() {
  return (
    <p className="m-0 font-mono text-[10px] text-muted-foreground">
      <ShortcutHint className="ml-0">{withCtrl("⌫")}</ShortcutHint> confirm ·
      Esc cancel
    </p>
  );
}

function DeleteConfirmCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/20 bg-destructive/[0.04] p-2.5",
        className
      )}
    >
      {children}
    </div>
  );
}

export function DeleteConfirmOverlay({
  busy,
  label = "Delete?",
  onCancel,
  onConfirm,
  layout = "overlay",
  cancelTip,
  confirmTip,
  activeVersion,
  revertBaseline = false,
  onRevertBaselineChange,
  showRevertOption = false,
  showKeyboardHints = false,
}: DeleteConfirmOverlayProps) {
  const revertOption =
    showRevertOption && onRevertBaselineChange ? (
      <RevertBaselineOption
        activeVersion={activeVersion}
        onRevertBaselineChange={onRevertBaselineChange}
        revertBaseline={revertBaseline}
      />
    ) : null;

  const actions = (
    <DeleteConfirmActions
      busy={busy}
      cancelTip={cancelTip}
      confirmTip={confirmTip}
      onCancel={onCancel}
      onConfirm={onConfirm}
      stopPropagation={layout === "panel"}
    />
  );

  if (layout === "panel") {
    return (
      <div className="pointer-events-auto absolute inset-y-0 right-0 z-10 flex items-center py-2 pr-3 pl-10">
        <DeleteConfirmCard className="w-full max-w-[17.5rem] bg-background/95 shadow-sm backdrop-blur-sm">
          <div className="flex flex-col gap-2">
            <DeleteConfirmLabel label={label} />
            {revertOption}
            <div className="flex flex-wrap items-center justify-end gap-1">
              {actions}
            </div>
          </div>
        </DeleteConfirmCard>
      </div>
    );
  }

  if (layout === "compact") {
    return <div className="flex flex-col items-center gap-2">{actions}</div>;
  }

  if (layout === "inline") {
    return (
      <DeleteConfirmCard className="w-full">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <DeleteConfirmLabel label={label} />
            {actions}
          </div>
          {revertOption}
          {showKeyboardHints ? <DeleteKeyboardHints /> : null}
        </div>
      </DeleteConfirmCard>
    );
  }

  return (
    <DeleteConfirmCard className="w-full">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <DeleteConfirmLabel label={label} />
          {actions}
        </div>
        {revertOption}
      </div>
    </DeleteConfirmCard>
  );
}
