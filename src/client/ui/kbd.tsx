import { cn } from "./cn.ts";

/**
 * Keyboard shortcut chip — shared styling for inline hints, tooltips, and settings.
 */
export function Kbd({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "onPrimary";
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border px-1 font-mono font-normal text-[10px] leading-none",
        tone === "onPrimary"
          ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground/90"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}
