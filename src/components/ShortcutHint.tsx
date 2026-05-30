import { cn } from "../lib/utils";

/** Muted trailing shortcut inside a Button. */
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
    <span
      className={cn(
        "ml-1.5 border-l pl-1.5 font-mono text-[10px] font-normal leading-none",
        onPrimary
          ? "border-primary-foreground/25 opacity-60"
          : "border-border text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const ctrlKey: string = detectCtrlKey();

function detectCtrlKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  const uaPlatform = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = (uaPlatform ?? navigator.platform ?? "").toLowerCase();
  return platform.includes("mac") ? "⌘" : "Ctrl";
}
