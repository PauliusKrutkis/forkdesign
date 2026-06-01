import type { ReactNode } from "react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import type { BubbleMode } from "./hooks/use-iterate-fix.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { ShortcutHint } from "./shortcut-hint.tsx";

export function ModeToggleButton({
  mode,
  onToggle,
}: {
  mode: BubbleMode;
  onToggle: () => void;
}) {
  const isCompact = mode === "compact";
  return (
    <Button
      aria-expanded={!isCompact}
      aria-label={isCompact ? "Expand bubble" : "Collapse bubble"}
      className="h-auto shrink-0 px-1.5 py-1 text-xs"
      onClick={onToggle}
      size="sm"
      type="button"
      variant="ghost"
    >
      {isCompact ? "More" : "Less"}
      <ShortcutHint>Tab</ShortcutHint>
    </Button>
  );
}

export function ActionIconButton({
  label,
  keys,
  onClick,
  disabled,
  active,
  destructive,
  children,
}: {
  label: string;
  keys?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <HotkeyTip keys={keys} label={label}>
      <Button
        aria-label={label}
        className={cn(
          "h-9 min-w-0 flex-1 rounded-none text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          active && "text-primary hover:text-primary",
          destructive && "hover:bg-destructive/10 hover:text-destructive"
        )}
        disabled={disabled}
        onClick={onClick}
        size="icon"
        type="button"
        variant="ghost"
      >
        {children}
      </Button>
    </HotkeyTip>
  );
}
