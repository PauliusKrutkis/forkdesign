import { CheckCircle2, GripVertical, Trash2, X } from "lucide-react";
import type { PointerEvent } from "react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { withCtrl } from "./shortcut-hint.tsx";

interface CommentBubbleHeaderProps {
  height: number;
  onClose: () => void;
  onDragStart: (e: PointerEvent<HTMLDivElement>) => void;
  onRequestDelete?: () => void;
  onResolve?: () => void;
  resolved: boolean;
}

export function CommentBubbleHeader({
  height,
  resolved,
  onResolve,
  onRequestDelete,
  onClose,
  onDragStart,
}: CommentBubbleHeaderProps) {
  return (
    <div
      className="relative flex shrink-0 cursor-grab items-center gap-0.5 border-b pr-1 pl-2 active:cursor-grabbing"
      onPointerDown={onDragStart}
      style={{ height }}
    >
      <GripVertical
        aria-hidden
        className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground"
      />
      <div className="flex-1" />
      {onResolve ? (
        <HotkeyTip
          keys={resolved ? undefined : withCtrl("R")}
          label={resolved ? "Resolved" : "Resolve"}
          side="bottom"
        >
          <Button
            aria-label={resolved ? "Resolved" : "Resolve"}
            aria-pressed={resolved}
            className={cn("h-7 w-7 shrink-0", resolved && "text-primary")}
            onClick={onResolve}
            size="icon"
            type="button"
            variant="ghost"
          >
            <CheckCircle2 className="h-4 w-4" />
          </Button>
        </HotkeyTip>
      ) : null}
      {onRequestDelete ? (
        <HotkeyTip keys={withCtrl("⌫")} label="Delete" side="bottom">
          <Button
            aria-label="Delete comment"
            className="h-7 w-7 shrink-0 hover:bg-destructive/10 hover:text-destructive"
            onClick={onRequestDelete}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </HotkeyTip>
      ) : null}
      <HotkeyTip keys="Esc" label="Close" side="bottom">
        <Button
          aria-label="Close"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </HotkeyTip>
    </div>
  );
}
