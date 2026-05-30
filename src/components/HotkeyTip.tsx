import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Kbd } from "./ui/kbd";

/**
 * Tooltip carrying a button's label and (optionally) its hotkey chip. The home
 * for shortcuts that can't sit inline — icon buttons (no room for text) and
 * secondary text buttons where an inline chip would crowd the row.
 *
 * Unlike the native `title` attribute it replaces, this shows on keyboard
 * focus too (not just hover) and uses the same `Kbd` chip as the inline hints,
 * so the shortcut looks the same wherever it appears. Pass `keys` omitted for a
 * label-only tip (e.g. an icon button with no shortcut yet).
 *
 * Requires a `TooltipProvider` ancestor — the overlay mounts one at its root.
 */
export function HotkeyTip({
  label,
  keys,
  side = "top",
  children,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="flex items-center gap-2 text-xs">
        <span>{label}</span>
        {keys ? <Kbd>{keys}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
