import { cn } from "../ui/cn.ts";
import { Kbd } from "../ui/kbd.tsx";

export function ShortcutHint({
  children,
  className,
  onPrimary = false,
}: {
  children: React.ReactNode;
  className?: string;
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

export function withCtrl(key: string): string {
  return ctrlKey === "⌘" ? `⌘${key}` : `Ctrl+${key}`;
}

export function withAlt(key: string): string {
  const alt = detectAltKey();
  return alt === "⌥" ? `⌥${key}` : `Alt+${key}`;
}

function detectAltKey(): string {
  if (typeof navigator === "undefined") {
    return "Alt";
  }
  const uaPlatform = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = (uaPlatform ?? navigator.platform ?? "").toLowerCase();
  return platform.includes("mac") ? "⌥" : "Alt";
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
