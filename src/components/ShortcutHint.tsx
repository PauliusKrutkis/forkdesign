import { cn } from "../lib/utils";
import { Kbd } from "./ui/kbd";

/**
 * Trailing shortcut chip inside a Button. Reserved for the one primary action
 * per surface (Save, the More/Less toggle); every other button surfaces its
 * shortcut through `HotkeyTip` instead. Renders the shared `Kbd` so the chip
 * matches the tooltip and cheat-sheet styling exactly.
 */
export function ShortcutHint({
  children,
  className,
  onPrimary = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Use on `default` / primary-filled buttons. */
  onPrimary?: boolean;
}) {
  return (
    <Kbd
      className={cn("ml-1.5", className)}
      tone={onPrimary ? "onPrimary" : "default"}
    >
      {children}
    </Kbd>
  );
}

export const ctrlKey: string = detectCtrlKey();

/**
 * Format a Ctrl/Cmd combo for display: `⌘R` on mac, `Ctrl+R` elsewhere. The
 * single place combo strings are built so inline chips and tooltips agree.
 */
export function withCtrl(key: string): string {
  return ctrlKey === "⌘" ? `⌘${key}` : `Ctrl+${key}`;
}

function detectCtrlKey(): string {
  if (typeof navigator === "undefined") {
    return "Ctrl";
  }
  const uaPlatform = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = (uaPlatform ?? navigator.platform ?? "").toLowerCase();
  return platform.includes("mac") ? "⌘" : "Ctrl";
}
