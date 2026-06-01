import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import { Button } from "../ui/button.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";

export interface DeleteConfirmOverlayProps {
  activeVersion?: number;
  busy: boolean;
  cancelTip?: ReactNode;
  confirmTip?: ReactNode;
  label?: ReactNode;
  /** Full-width absolute overlay (bubble action bar, reply row). */
  layout?: "overlay" | "inline" | "panel";
  onCancel: (e?: MouseEvent) => void;
  onConfirm: () => Promise<void>;
  onRevertBaselineChange?: (value: boolean) => void;
  revertBaseline?: boolean;
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
    <label className="flex cursor-pointer items-start gap-2 text-left text-xs">
      <input
        checked={revertBaseline}
        className="mt-0.5 shrink-0"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onRevertBaselineChange(e.target.checked);
        }}
        type="checkbox"
      />
      <span className="min-w-0">
        <span className="font-medium text-foreground">
          Revert source to baseline (v0)
        </span>
        {activeVersion > 0 ? (
          <span className="mt-0.5 block text-muted-foreground">
            Current version is v{activeVersion}. Uncheck to keep those changes.
          </span>
        ) : null}
      </span>
    </label>
  );
}

function DeleteConfirmButtons({
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
    <Button
      className="h-7 px-2 text-xs"
      disabled={busy}
      onClick={wrapClick(onCancel)}
      size="sm"
      type="button"
      variant="ghost"
    >
      Cancel
    </Button>
  );

  const confirmButton = (
    <Button
      className="h-7 px-2 text-xs"
      disabled={busy}
      onClick={wrapClick(() => {
        onConfirm().catch(ignorePromiseRejection);
      })}
      size="sm"
      type="button"
      variant="destructive"
    >
      {busy ? "Deleting…" : "Delete"}
    </Button>
  );

  return (
    <>
      {cancelTip ?? cancelButton}
      {confirmTip ?? confirmButton}
    </>
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
}: DeleteConfirmOverlayProps) {
  const revertOption =
    showRevertOption && onRevertBaselineChange ? (
      <RevertBaselineOption
        activeVersion={activeVersion}
        onRevertBaselineChange={onRevertBaselineChange}
        revertBaseline={revertBaseline}
      />
    ) : null;

  if (layout === "panel") {
    return (
      <div className="absolute inset-y-0 right-0 z-10 flex min-w-[min(100%,18rem)] items-center gap-2 rounded-r-[inherit] bg-gradient-to-l from-55% from-background to-transparent py-2 pr-3 pl-14">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="font-medium text-foreground text-xs">{label}</span>
          {revertOption}
          <div className="flex flex-wrap items-center gap-1.5">
            <DeleteConfirmButtons
              busy={busy}
              cancelTip={cancelTip}
              confirmTip={confirmTip}
              onCancel={onCancel}
              onConfirm={onConfirm}
              stopPropagation
            />
          </div>
        </div>
      </div>
    );
  }

  if (layout === "inline") {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <span className="text-foreground text-xs">{label}</span>
        {revertOption}
        <div className="flex flex-wrap items-center gap-1.5">
          <DeleteConfirmButtons
            busy={busy}
            cancelTip={cancelTip}
            confirmTip={confirmTip}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex min-w-[min(100%,20rem)] items-center justify-end gap-2 bg-gradient-to-l from-55% from-background to-transparent py-2 pr-2 pl-8">
      <div className="flex min-w-0 flex-col items-end gap-2">
        <span className="mr-0.5 font-medium text-foreground text-xs">
          {label}
        </span>
        {revertOption ? (
          <div className="max-w-[14rem]">{revertOption}</div>
        ) : null}
        <div className="flex items-center gap-1.5">
          <DeleteConfirmButtons
            busy={busy}
            cancelTip={cancelTip}
            confirmTip={confirmTip}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        </div>
      </div>
    </div>
  );
}
