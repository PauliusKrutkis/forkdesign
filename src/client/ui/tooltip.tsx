import {
  Content,
  Portal,
  Provider,
  Root,
  Trigger,
} from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "./cn.ts";

const TooltipProvider = Provider;

const Tooltip = Root;
const TooltipTrigger = Trigger;

const TooltipContent = ({
  className,
  sideOffset = 6,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.RefObject<React.ComponentRef<typeof Content> | null>;
}) => (
  <Portal>
    {/* z above the whole overlay stack (dock 9400 · lightbox 9700) so a
        tooltip never renders behind its trigger. data-comment-overlay so the
        scoped preflight + theme tokens reach this portaled-to-<body> content. */}
    <Content
      className={cn(
        "z-[9600] animate-tooltip-in overflow-hidden rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md",
        className
      )}
      data-comment-overlay="true"
      ref={ref}
      sideOffset={sideOffset}
      {...props}
    />
  </Portal>
);
TooltipContent.displayName = Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
