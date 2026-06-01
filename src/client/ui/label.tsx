import { Root } from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "./cn.ts";

const labelVariants = cva(
  "font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
);

const Label = ({
  className,
  ref,
  ...props
}: (React.ComponentPropsWithoutRef<typeof Root> &
  VariantProps<typeof labelVariants>) & {
  ref?: React.RefObject<React.ComponentRef<typeof Root> | null>;
}) => <Root className={cn(labelVariants(), className)} ref={ref} {...props} />;
Label.displayName = Root.displayName;

export { Label };
