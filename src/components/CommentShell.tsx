import { useEffect, type ReactNode } from "react";
import { Kbd } from "./Kbd";

export type ShellTab = "list" | "settings";

type CommentShellProps = {
  tab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  onClose: () => void;
  /** Shown in the list tab header (e.g. comment count). */
  listSubtitle?: string;
  children: ReactNode;
};

/**
 * Centered modal shell for comment list and settings. Replaces the previous
 * right-side drawers so the overlay does not compete with page layout.
 * Backdrop click and Esc dismiss; `L` / `,` hotkeys are handled upstream.
 */
export function CommentShell({
  tab,
  onTabChange,
  onClose,
  listSubtitle,
  children,
}: CommentShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-comment-overlay="true"
      className="pointer-events-auto fixed inset-0 z-[9240] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-[color-mix(in_srgb,var(--co-ink)_55%,transparent)]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label={tab === "list" ? "Comment list" : "Comment settings"}
        className="relative flex max-h-[85vh] w-full max-w-[460px] flex-col overflow-hidden rounded-[10px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--co-line)] bg-[var(--co-surface-2)] px-4 py-3">
          <div
            role="tablist"
            aria-label="Comment overlay"
            className="flex min-w-0 flex-1 gap-1"
          >
            <ShellTabButton
              active={tab === "list"}
              onClick={() => onTabChange("list")}
              label="Comments"
              hotkey="L"
            />
            <ShellTabButton
              active={tab === "settings"}
              onClick={() => onTabChange("settings")}
              label="Settings"
              hotkey=","
            />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[4px] text-[var(--co-ink-2)] transition-colors hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
          >
            <span aria-hidden className="text-[15px] leading-none">
              ×
            </span>
          </button>
        </header>

        {tab === "list" && listSubtitle ? (
          <p className="m-0 shrink-0 border-b border-[var(--co-line)] px-4 py-2 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
            {listSubtitle}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ShellTabButton({
  active,
  onClick,
  label,
  hotkey,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hotkey: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1.5 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] transition-colors ${
        active
          ? "bg-[var(--co-ink)] text-[var(--co-page)]"
          : "text-[var(--co-ink-3)] hover:bg-[var(--co-surface-3)] hover:text-[var(--co-ink)]"
      }`}
    >
      {label}
      <Kbd
        className={
          active
            ? "!ml-0 !border-[color-mix(in_srgb,var(--co-page)_30%,transparent)] !bg-[color-mix(in_srgb,var(--co-page)_12%,transparent)] !text-[color-mix(in_srgb,var(--co-page)_75%,transparent)]"
            : "!ml-0"
        }
      >
        {hotkey}
      </Kbd>
    </button>
  );
}
