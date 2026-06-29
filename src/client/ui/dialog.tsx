import {
  Close,
  Content,
  Overlay,
  Portal,
  Root,
  Title,
  Trigger,
} from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "./cn.ts";

const Dialog = Root;
const DialogTrigger = Trigger;
const DialogPortal = Portal;
const DialogClose = Close;

const DialogOverlay = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Overlay> & {
  ref?: React.RefObject<React.ComponentRef<typeof Overlay> | null>;
}) => (
  <Overlay
    className={cn("fixed inset-0 z-[9240] bg-black/50", className)}
    data-comment-overlay="true"
    ref={ref}
    {...props}
  />
);
DialogOverlay.displayName = Overlay.displayName;

const DialogContent = ({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Content> & {
  ref?: React.RefObject<React.ComponentRef<typeof Content> | null>;
}) => (
  <DialogPortal>
    <DialogOverlay />
    <Content
      className={cn(
        "fixed top-[50%] left-[50%] z-[9241] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-0 shadow-lg sm:rounded-lg",
        className
      )}
      data-comment-overlay="true"
      ref={ref}
      {...props}
    >
      {children}
      <Close className="absolute top-4 right-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-70 ring-offset-background transition-[opacity,background-color,color] hover:bg-accent hover:text-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </Close>
    </Content>
  </DialogPortal>
);
DialogContent.displayName = Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogTitle = ({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof Title> & {
  ref?: React.RefObject<React.ComponentRef<typeof Title> | null>;
}) => (
  <Title
    className={cn(
      "font-semibold text-lg leading-none tracking-tight",
      className
    )}
    ref={ref}
    {...props}
  />
);
DialogTitle.displayName = Title.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
