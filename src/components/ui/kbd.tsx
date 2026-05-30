import { cn } from "../../lib/utils";

/**
 * A single keyboard-shortcut chip. The one place hotkey keys are styled, so a
 * shortcut reads identically whether it sits inline inside a button
 * (`ShortcutHint`), in a hover/focus tooltip (`HotkeyTip`), or in the settings
 * cheat sheet. Keeping the chip identical across those homes is what makes the
 * mixed inline/tooltip strategy feel deliberate rather than scattered.
 *
 * `tone`:
 *   - `default`  — muted chip for ghost/secondary surfaces and tooltips.
 *   - `onPrimary` — translucent chip legible on a filled primary button.
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
