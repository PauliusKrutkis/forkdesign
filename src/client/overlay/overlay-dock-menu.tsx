import { List, MessageSquarePlus, Settings } from "lucide-react";
import { cn } from "../ui/cn.ts";
import { Switch } from "../ui/switch.tsx";
import type { ShellTab } from "./comment-shell.tsx";
import { ShortcutHint } from "./shortcut-hint.tsx";

interface DockRowProps {
  active?: boolean;
  badge?: number;
  hint?: string;
  icon: React.ReactNode;
  index: number;
  label: string;
  onSelect: () => void;
  primary?: boolean;
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
}: DockRowProps) {
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

function DesignCritMark({ className }: { className?: string }) {
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

export interface OverlayDockMenuProps {
  alignEnd: boolean;
  composerActive: boolean;
  enabled: boolean;
  onClose: () => void;
  onPageCount: number;
  onToggleComposer: () => void;
  onToggleEnabled: () => void;
  onToggleList: () => void;
  onToggleSettings: () => void;
  openUp: boolean;
  shell: ShellTab | null;
  totalCount: number;
}

export function OverlayDockMenu({
  openUp,
  alignEnd,
  enabled,
  composerActive,
  onToggleComposer,
  shell,
  onToggleList,
  onToggleSettings,
  onToggleEnabled,
  totalCount,
  onPageCount,
  onClose,
}: OverlayDockMenuProps) {
  return (
    <div
      aria-label="design-crit actions"
      className={cn(
        "pointer-events-auto w-56 overflow-hidden rounded-xl border border-border/70 p-1",
        "bg-popover/95 text-popover-foreground backdrop-blur-md",
        "animate-dock-in shadow-[0_8px_40px_-12px_rgba(0,0,0,0.35)]"
      )}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
      style={
        {
          transformOrigin: `${openUp ? "bottom" : "top"} ${alignEnd ? "right" : "left"}`,
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
              onClose();
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
              onClose();
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
          onClose();
        }}
      />

      <div className="my-1 h-px bg-border/70" />

      <label
        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-accent"
        htmlFor="review-toggle"
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
          checked={enabled}
          id="review-toggle"
          onCheckedChange={onToggleEnabled}
        />
      </label>

      <div className="mt-1 flex items-center justify-between px-2.5 pt-1.5 pb-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground lowercase tracking-wide">
          <DesignCritMark className="h-3 w-3" />
          design-crit
        </span>
        {enabled && totalCount > 0 ? (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
            {onPageCount} on page
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function OverlayDockPill({
  enabled,
  open,
  onToggle,
  totalCount,
}: {
  enabled: boolean;
  open: boolean;
  onToggle: () => void;
  totalCount: number;
}) {
  return (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label="design-crit comments"
      className={cn(
        "group pointer-events-auto relative inline-flex h-9 items-center gap-2 rounded-full border px-2.5",
        "border-border/70 bg-popover/80 text-popover-foreground backdrop-blur-md",
        "shadow-[0_1px_2px_rgba(0,0,0,0.06),0_4px_16px_-6px_rgba(0,0,0,0.18)]",
        "transition-[transform,border-color,opacity] duration-150",
        "hover:-translate-y-px hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open && "border-foreground/30",
        !enabled && "opacity-60"
      )}
      onClick={onToggle}
      type="button"
    >
      <DesignCritMark className="h-4 w-4 text-foreground" />
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
}
