import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "../../lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = ({
  className,
  sideOffset = 6,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
  ref?: React.RefObject<React.ComponentRef<
    typeof TooltipPrimitive.Content
  > | null>;
}) => (
  <TooltipPrimitive.Portal>
    {/* z above the whole overlay stack (dock 9400 · lightbox 9700) so a
        tooltip never renders behind its trigger. */}
    <TooltipPrimitive.Content
      className={cn(
        "z-[9600] animate-tooltip-in overflow-hidden rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md",
        className
      )}
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </TooltipPrimitive.Portal>
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
