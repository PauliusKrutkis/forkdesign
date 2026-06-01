import { cn } from "../ui/cn.ts";
import { Kbd } from "../ui/kbd.tsx";

/** Inline shortcut chip for primary actions inside a Button. */
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

const ctrlKey: string = detectCtrlKey();

/**
 * Format a Ctrl/Cmd combo for display (`⌘R` on Mac, `Ctrl+R` elsewhere).
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
