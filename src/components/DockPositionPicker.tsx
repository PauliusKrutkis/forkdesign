import { cn } from "../lib/utils";
import type { OverlayPosition } from "./settings";

const POSITIONS: {
  id: OverlayPosition;
  label: string;
  place: string;
}[] = [
  { id: "top-left", label: "Top left", place: "top-2 left-2" },
  { id: "top-right", label: "Top right", place: "top-2 right-2" },
  { id: "bottom-left", label: "Bottom left", place: "bottom-2 left-2" },
  { id: "bottom-right", label: "Bottom right", place: "bottom-2 right-2" },
];

const LABEL_BY_POSITION = Object.fromEntries(
  POSITIONS.map((p) => [p.id, p.label])
) as Record<OverlayPosition, string>;

interface Props {
  onChange: (v: OverlayPosition) => void;
  value: OverlayPosition;
}

/**
 * Schematic page preview for choosing which corner anchors the dock pill.
 * Four corner targets show a miniature dock; the active corner is emphasized.
 */
export function DockPositionPicker({ value, onChange }: Props) {
  return (
    <div>
      <fieldset className="m-0 overflow-hidden rounded-lg border border-border bg-muted/15 p-0 shadow-sm">
        <legend className="sr-only">Dock position</legend>
        <div className="flex h-7 items-center gap-1.5 border-border/80 border-b bg-background/90 px-2.5">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
          />
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
          />
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
          />
          <span className="ml-1 truncate font-mono text-[9px] text-muted-foreground/70 tracking-wide">
            your page
          </span>
        </div>

        <div className="relative aspect-[5/4] min-h-[132px] bg-gradient-to-b from-background via-background to-muted/25">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-3 rounded-sm border border-border/50 border-dashed"
          />

          {POSITIONS.map((pos) => {
            const active = value === pos.id;
            const inputId = `dock-position-${pos.id}`;
            return (
              <label
                className={cn(
                  "absolute flex cursor-pointer rounded-md p-1.5 transition-[opacity,transform] duration-100",
                  "hover:scale-105 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  pos.place,
                  active ? "opacity-100" : "opacity-45 hover:opacity-75"
                )}
                htmlFor={inputId}
                key={pos.id}
              >
                <input
                  checked={active}
                  className="sr-only"
                  id={inputId}
                  name="dock-position"
                  onChange={() => onChange(pos.id)}
                  type="radio"
                  value={pos.id}
                />
                <DockPillPreview active={active} />
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="m-0 mt-2 text-center text-muted-foreground text-xs">
        Dock in{" "}
        <span className="font-medium text-foreground">
          {LABEL_BY_POSITION[value].toLowerCase()}
        </span>
      </p>
    </div>
  );
}

function DockPillPreview({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 shadow-sm",
        active
          ? "border-foreground/35 bg-popover text-foreground ring-2 ring-ring/40 ring-offset-1 ring-offset-background"
          : "border-border/70 bg-popover/80 text-muted-foreground"
      )}
    >
      <RedlineMark className="h-2.5 w-2.5 shrink-0" />
    </span>
  );
}

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
