import type { MouseEvent, ReactNode } from "react";
import { Button } from "../ui/button.tsx";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";

export interface DeleteConfirmOverlayProps {
  busy: boolean;
  cancelTip?: ReactNode;
  confirmTip?: ReactNode;
  label?: ReactNode;
  /** Full-width absolute overlay (bubble action bar, reply row). */
  layout?: "overlay" | "inline" | "panel";
  onCancel: (e?: MouseEvent) => void;
  onConfirm: () => Promise<void>;
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
}: DeleteConfirmOverlayProps) {
  if (layout === "panel") {
    return (
      <div className="absolute inset-y-0 right-0 z-10 flex items-center gap-1.5 rounded-r-[inherit] bg-gradient-to-l from-55% from-background to-transparent pr-3 pl-14">
        <span className="mr-0.5 font-medium text-foreground text-xs">
          {label}
        </span>
        <DeleteConfirmButtons
          busy={busy}
          cancelTip={cancelTip}
          confirmTip={confirmTip}
          onCancel={onCancel}
          onConfirm={onConfirm}
          stopPropagation
        />
      </div>
    );
  }

  if (layout === "inline") {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-foreground text-xs">{label}</span>
        <DeleteConfirmButtons
          busy={busy}
          cancelTip={cancelTip}
          confirmTip={confirmTip}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex items-center justify-end gap-1.5 bg-gradient-to-l from-55% from-background to-transparent pr-2 pl-8">
      <span className="mr-0.5 font-medium text-foreground text-xs">
        {label}
      </span>
      <DeleteConfirmButtons
        busy={busy}
        cancelTip={cancelTip}
        confirmTip={confirmTip}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </div>
  );
}
