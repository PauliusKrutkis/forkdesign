import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/button.tsx";
import { cn } from "../ui/cn.ts";
import { MicroThumb } from "./comment-thumb.tsx";
import type {
  IterationsData,
  IterationVersion,
} from "./hooks/use-iterations.ts";
import { HotkeyTip } from "./hotkey-tip.tsx";

function renderActiveVersionThumb(
  showActiveThumb: boolean,
  activeVersion: IterationVersion | undefined,
  onPreviewActive?: (src: string) => void
) {
  if (!(showActiveThumb && activeVersion)) {
    return null;
  }
  if (onPreviewActive) {
    return (
      <button
        aria-label="Show active version screenshot"
        className="rounded-md transition-shadow hover:ring-1 hover:ring-ring"
        onClick={() => onPreviewActive(activeVersion.png)}
        type="button"
      >
        <MicroThumb src={activeVersion.png} />
      </button>
    );
  }
  return <MicroThumb src={activeVersion.png} />;
}

interface CommentVersionPickerProps {
  data: IterationsData;
  disabled?: boolean;
  onActivate: (v: number) => void;
  onPreviewActive?: (src: string) => void;
  /** When true, show the active version screenshot beside the trigger (main comment slot). */
  showActiveThumb?: boolean;
  switching?: boolean;
}

export function CommentVersionPicker({
  data,
  disabled = false,
  showActiveThumb = false,
  onPreviewActive,
  onActivate,
  switching = false,
}: CommentVersionPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const total = data.versions.length;
  const active = data.active;
  const display = active + 1;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sorted = [...data.versions].sort((a, b) => b.v - a.v);
  const activeVersion = data.versions.find((x) => x.v === active);

  if (total <= 1) {
    return null;
  }

  return (
    <div
      className={cn(
        "relative shrink-0",
        showActiveThumb && "flex flex-col items-end gap-1.5"
      )}
      ref={rootRef}
    >
      {renderActiveVersionThumb(
        showActiveThumb,
        activeVersion,
        onPreviewActive
      )}
      <HotkeyTip keys="← →" label="Change version" side="bottom">
        <Button
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            "h-auto gap-1 font-mono text-xs tabular-nums",
            showActiveThumb ? "px-2 py-1" : "px-1.5 py-1",
            switching && "opacity-60"
          )}
          disabled={disabled || switching}
          onClick={() => setOpen((prev) => !prev)}
          size="sm"
          type="button"
          variant={showActiveThumb ? "outline" : "ghost"}
        >
          v{display} of {total}
          <ChevronDown
            aria-hidden
            className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          />
        </Button>
      </HotkeyTip>

      {open ? (
        <div
          className="absolute top-full right-0 z-20 mt-1 min-w-[200px] max-w-[260px] overflow-hidden rounded-md border bg-popover py-1 shadow-md"
          role="menu"
        >
          {sorted.map((version, index) => {
            const isActive = version.v === active;
            return (
              <button
                className={cn(
                  "flex w-full animate-dock-row-in items-center gap-2 px-2 py-1.5 text-left text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                  isActive && "bg-accent/60"
                )}
                disabled={disabled || switching}
                key={version.v}
                onClick={() => {
                  setOpen(false);
                  if (!isActive) {
                    onActivate(version.v);
                  }
                }}
                role="menuitem"
                style={{ animationDelay: `${index * 28}ms` }}
                type="button"
              >
                <MicroThumb src={version.png} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-muted-foreground text-xs tabular-nums">
                    v{version.v + 1}
                    {isActive ? (
                      <span className="ml-1.5 text-foreground">· live</span>
                    ) : null}
                  </span>
                  <span
                    className="mt-0.5 block truncate text-muted-foreground text-xs"
                    title={version.summary}
                  >
                    {version.summary ??
                      (version.v === 0 ? "Baseline" : "AI fix")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
