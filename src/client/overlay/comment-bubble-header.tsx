import { GripVertical, X } from "lucide-react";
import type { PointerEvent } from "react";
import { Button } from "../ui/button.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";

interface CommentBubbleHeaderProps {
  bubbleHeaderHeight: number;
  onClose: () => void;
  onDragStart: (e: PointerEvent<HTMLDivElement>) => void;
}

export function CommentBubbleHeader({
  bubbleHeaderHeight,
  onClose,
  onDragStart,
}: CommentBubbleHeaderProps) {
  return (
    <div
      className="relative flex shrink-0 cursor-grab items-center border-b active:cursor-grabbing"
      onPointerDown={onDragStart}
      style={{ height: bubbleHeaderHeight }}
    >
      <GripVertical
        aria-hidden
        className="pointer-events-none ml-2 h-4 w-4 shrink-0 text-muted-foreground"
      />
      <div className="flex-1" />
      <HotkeyTip keys="Esc" label="Close" side="bottom">
        <Button
          aria-label="Close"
          className="mr-1 h-7 w-7 shrink-0"
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
