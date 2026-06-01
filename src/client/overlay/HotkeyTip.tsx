import type { ReactNode } from "react";
import { Kbd } from "../ui/kbd.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.tsx";

/** Tooltip with optional hotkey chip; requires a TooltipProvider ancestor. */
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
      <TooltipContent className="flex items-center gap-2 text-xs" side={side}>
        <span>{label}</span>
        {keys ? <Kbd>{keys}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
