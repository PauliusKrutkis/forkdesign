import { List, MessageSquarePlus, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type OverlayPosition, POSITION_CLASSES } from "../settings.ts";
import { cn } from "../ui/cn.ts";
import { Switch } from "../ui/switch.tsx";
import type { ShellTab } from "./CommentShell";
import { ShortcutHint } from "./ShortcutHint";

/**
 * The redline dock — a single quiet pill in the chosen corner that expands
 * into a focused command menu on click. Replaces the old three-FAB stack
 * (Comments / Add comment / gear) so the overlay's resting footprint is one
 * small element instead of a button cluster competing with the page.
 *
 * Collapsed: a proofreader's-caret mark plus a live comment-count badge.
 * Expanded: Add comment · Comments · Settings, each carrying its hotkey hint,
 * a divider, then the master "Reviewing" toggle (the muted/enabled switch
 * that used to be buried in the settings panel).
 *
 * Muted state (`enabled === false`) dims the pill and collapses the menu to
 * just the toggle + Settings — the actions that make sense when comments are
 * hidden. The `,` hotkey still opens settings globally even with the pill
 * itself hidden via `show === false`.
 */
export interface OverlayDockProps {
  composerActive: boolean;
  enabled: boolean;
  /** Comments anchored on the current page (footer context). */
  onPageCount: number;
  onToggleComposer: () => void;
  onToggleEnabled: () => void;
  onToggleList: () => void;
  onToggleSettings: () => void;
  position: OverlayPosition;
  shell: ShellTab | null;
  /** Master visibility for the pill. Hotkeys keep working when false. */
  show: boolean;
  /** Total comments across the project (drives the resting badge). */
  totalCount: number;
}

export function OverlayDock({
  show,
  position,
  enabled,
  onToggleEnabled,
  composerActive,
  onToggleComposer,
  shell,
  onToggleList,
  onToggleSettings,
  totalCount,
  onPageCount,
}: OverlayDockProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside click (capture, so it beats the bubble's own
  // outside-click handler) and on Escape. Listeners are only attached while
  // the menu is open so we never swallow Escape elsewhere.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (
        rootRef.current &&
        e.target instanceof Node &&
        rootRef.current.contains(e.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Fold the menu shut whenever the shell or composer takes over the screen —
  // those surfaces are the "expanded" destination, so leaving the dock menu
  // hovering behind them is just noise.
  useEffect(() => {
    if (shell || composerActive) {
      setOpen(false);
    }
  }, [shell, composerActive]);

  if (!show) {
    return null;
  }

  const openUp = position.startsWith("bottom");
  const alignEnd = position.endsWith("right");

  const pill = (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="redline comments"
      className={cn(
        "group pointer-events-auto relative inline-flex h-9 items-center gap-2 rounded-full border px-2.5",
        "border-border/70 bg-popover/80 text-popover-foreground backdrop-blur-md",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_16px_-6px_rgba(0,0,0,0.18)]",
        "transition-[transform,border-color,opacity] duration-150",
        "hover:-translate-y-px hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open && "border-foreground/30",
        !enabled && "opacity-60"
      )}
      onClick={() => setOpen((v) => !v)}
      type="button"
    >
      <RedlineMark className="h-4 w-4 text-foreground" />
      {enabled && totalCount > 0 ? (
        <span
          className={cn(
            "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1",
            "bg-primary font-semibold text-[10px] text-primary-foreground tabular-nums leading-none"
          )}
        >
          {totalCount}
        </span>
      ) : null}
    </button>
  );

  const menu = open ? (
    <div
      aria-label="redline actions"
      className={cn(
        "pointer-events-auto w-56 overflow-hidden rounded-xl border border-border/70 p-1",
        "bg-popover/95 text-popover-foreground backdrop-blur-md",
        "animate-dock-in shadow-[0_8px_40px_-12px_rgba(0,0,0,0.35)]"
      )}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      style={
        {
          transformOrigin: `${openUp ? "bottom" : "top"} ${alignEnd ? "right" : "left"}`,
          // Rows rise toward the pill from whichever side the menu sits on.
          ["--dock-row-shift" as string]: openUp ? "6px" : "-6px",
        } as React.CSSProperties
      }
    >
      {enabled ? (
        <>
          <DockRow
            active={composerActive}
            hint="C"
            icon={<MessageSquarePlus className="h-4 w-4" />}
            index={0}
            label={composerActive ? "Cancel" : "Add comment"}
            onSelect={() => {
              onToggleComposer();
              setOpen(false);
            }}
            primary
          />
          <DockRow
            active={shell === "list"}
            badge={totalCount > 0 ? totalCount : undefined}
            hint="L"
            icon={<List className="h-4 w-4" />}
            index={1}
            label="Comments"
            onSelect={() => {
              onToggleList();
              setOpen(false);
            }}
          />
        </>
      ) : null}
      <DockRow
        active={shell === "settings"}
        hint=","
        icon={<Settings className="h-4 w-4" />}
        index={enabled ? 2 : 0}
        label="Settings"
        onSelect={() => {
          onToggleSettings();
          setOpen(false);
        }}
      />

      <div className="my-1 h-px bg-border/70" />

      <label
        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent"
        style={{ animationDelay: `${(enabled ? 3 : 1) * 28}ms` }}
      >
        <span
          className={cn(
            "inline-block h-2 w-2 shrink-0 rounded-full",
            enabled ? "bg-foreground" : "bg-muted-foreground/40"
          )}
        />
        <span className="flex-1">{enabled ? "Reviewing" : "Paused"}</span>
        <Switch
          aria-label="Toggle reviewing"
          checked={enabled}
          onCheckedChange={onToggleEnabled}
        />
      </label>

      <div className="mt-1 flex items-center justify-between px-2.5 pt-1.5 pb-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground lowercase tracking-wide">
          <RedlineMark className="h-3 w-3" />
          redline
        </span>
        {enabled && totalCount > 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {onPageCount} on page
          </span>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed z-[9400] flex flex-col gap-2",
        POSITION_CLASSES[position]
      )}
      data-comment-overlay="true"
      data-redline-dock="true"
      ref={rootRef}
    >
      {openUp ? (
        <>
          {menu}
          {pill}
        </>
      ) : (
        <>
          {pill}
          {menu}
        </>
      )}
    </div>
  );
}

function DockRow({
  index,
  icon,
  label,
  hint,
  badge,
  active = false,
  primary = false,
  onSelect,
}: {
  index: number;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  badge?: number;
  active?: boolean;
  primary?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        "flex w-full animate-dock-row-in items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
        "hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent text-accent-foreground"
      )}
      onClick={onSelect}
      role="menuitem"
      style={{ animationDelay: `${index * 28}ms` }}
      type="button"
    >
      <span
        className={cn(
          "shrink-0",
          primary ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <span className={cn("flex-1", primary && "font-medium")}>{label}</span>
      {badge === undefined ? null : (
        <span className="rounded-full bg-muted px-1.5 font-medium text-[10px] text-muted-foreground tabular-nums leading-[18px]">
          {badge}
        </span>
      )}
      {hint ? <ShortcutHint>{hint}</ShortcutHint> : null}
    </button>
  );
}

/**
 * The redline mark: a proofreader's insertion caret resting on a baseline —
 * the editorial "mark it up here" glyph, scaled to fit the dock.
 */
function RedlineMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
    >
      <path
        d="M2.5 11.75h11"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        d="M5.25 11.75 8 5l2.75 6.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
