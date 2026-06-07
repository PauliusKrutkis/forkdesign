import {
  CheckCircle2,
  Eye,
  GripVertical,
  LocateFixed,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  X,
} from "lucide-react";
import type { PointerEvent } from "react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { withCtrl } from "./shortcut-hint.tsx";

interface CommentBubbleHeaderProps {
  /** Whether the panel has been moved off its anchor (dragged or docked). */
  canReanchor: boolean;
  docked: boolean;
  height: number;
  onClose: () => void;
  onDragStart: (e: PointerEvent<HTMLDivElement>) => void;
  /** Press-and-hold: fade the panel so the design shows through underneath. */
  onPeekStart: () => void;
  /** Snap the panel back to its anchor, clearing any saved/dragged position. */
  onReanchor: () => void;
  onRequestDelete?: () => void;
  onResolve?: () => void;
  onToggleDock: () => void;
  resolved: boolean;
}

export function CommentBubbleHeader({
  canReanchor,
  docked,
  height,
  resolved,
  onResolve,
  onRequestDelete,
  onClose,
  onDragStart,
  onPeekStart,
  onReanchor,
  onToggleDock,
}: CommentBubbleHeaderProps) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center gap-0.5 border-b pr-1 pl-2",
        // The whole header is the drag handle. Dragging a docked panel detaches
        // it to float so it can be flung to a different edge (drag-to-dock).
        "cursor-grab active:cursor-grabbing"
      )}
      onPointerDown={onDragStart}
      style={{ height }}
    >
      <GripVertical
        aria-hidden
        className="pointer-events-none h-4 w-4 shrink-0 text-muted-foreground"
      />
      <div className="flex-1" />
      {canReanchor ? (
        <HotkeyTip label="Move back to anchor" side="bottom">
          <Button
            aria-label="Move back to anchor"
            className="h-7 w-7 shrink-0"
            onClick={onReanchor}
            size="icon"
            type="button"
            variant="ghost"
          >
            <LocateFixed className="h-4 w-4" />
          </Button>
        </HotkeyTip>
      ) : null}
      <HotkeyTip
        keys={withCtrl("E")}
        label="Hold to peek through"
        side="bottom"
      >
        <Button
          aria-label="Hold to peek through"
          className="h-7 w-7 shrink-0"
          // Momentary: fade while held, restore on release (even off-button).
          onPointerDown={(e) => {
            e.stopPropagation();
            onPeekStart();
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Eye className="h-4 w-4" />
        </Button>
      </HotkeyTip>
      <HotkeyTip
        keys={withCtrl("D")}
        label={docked ? "Float" : "Dock to edge"}
        side="bottom"
      >
        <Button
          aria-label={docked ? "Float panel" : "Dock panel to edge"}
          aria-pressed={docked}
          className={cn("h-7 w-7 shrink-0", docked && "text-primary")}
          onClick={onToggleDock}
          size="icon"
          type="button"
          variant="ghost"
        >
          {docked ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      </HotkeyTip>
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
