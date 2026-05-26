/**
 * Inline keyboard-hint chip. Used next to button labels in the comment UI
 * surfaces (overlay toggle, composer save, bubble actions, version switcher)
 * to expose the existing hotkeys without competing with the actual button
 * text for attention.
 *
 * Use the `ctrlKey` constant exported below for platform-aware glyphs:
 * renders `⌘` on Mac and `Ctrl` elsewhere. Detection runs once at module
 * load — there's no expected platform change mid-session.
 */
export function Kbd({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={`ml-1.5 inline-flex items-center rounded-[3px] border border-[var(--co-line)] bg-[color-mix(in_srgb,var(--co-surface-2)_60%,transparent)] px-[5px] py-[1px] font-[var(--co-font-mono)] text-[9.5px] uppercase tracking-[0.04em] text-[var(--co-ink-3)] ${className}`}
    >
      {children}
    </kbd>
  );
}

/**
 * Platform-aware modifier glyph. `⌘` on macOS, `Ctrl` elsewhere. Computed
 * once at module load so consumers can splice it inline without paying for
 * a navigator probe on every render.
 */
export const ctrlKey: string = detectCtrlKey();

function detectCtrlKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  // Prefer the newer UA-Data API when available; fall back to the legacy
  // (but still widely supported) `navigator.platform` string.
  const uaPlatform = (
    navigator as unknown as { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = (uaPlatform ?? navigator.platform ?? "").toLowerCase();
  return platform.includes("mac") ? "⌘" : "Ctrl";
}
