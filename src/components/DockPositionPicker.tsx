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
  POSITIONS.map((p) => [p.id, p.label]),
) as Record<OverlayPosition, string>;

type Props = {
  value: OverlayPosition;
  onChange: (v: OverlayPosition) => void;
};

/**
 * Schematic page preview for choosing which corner anchors the dock pill.
 * Four corner targets show a miniature dock; the active corner is emphasized.
 */
export function DockPositionPicker({ value, onChange }: Props) {
  return (
    <div>
      <fieldset className="m-0 overflow-hidden rounded-lg border border-border bg-muted/15 p-0 shadow-sm">
        <legend className="sr-only">Dock position</legend>
        <div className="flex h-7 items-center gap-1.5 border-b border-border/80 bg-background/90 px-2.5">
          <span
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
            aria-hidden
          />
          <span
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
            aria-hidden
          />
          <span
            className="h-2 w-2 rounded-full bg-muted-foreground/20"
            aria-hidden
          />
          <span className="ml-1 truncate font-mono text-[9px] tracking-wide text-muted-foreground/70">
            your page
          </span>
        </div>

        <div className="relative aspect-[5/4] min-h-[132px] bg-gradient-to-b from-background via-background to-muted/25">
          <div
            className="pointer-events-none absolute inset-3 rounded-sm border border-dashed border-border/50"
            aria-hidden
          />

          {POSITIONS.map((pos) => {
            const active = value === pos.id;
            const inputId = `dock-position-${pos.id}`;
            return (
              <label
                key={pos.id}
                htmlFor={inputId}
                className={cn(
                  "absolute flex cursor-pointer rounded-md p-1.5 transition-[opacity,transform] duration-100",
                  "hover:scale-105 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  pos.place,
                  active ? "opacity-100" : "opacity-45 hover:opacity-75",
                )}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="dock-position"
                  value={pos.id}
                  checked={active}
                  onChange={() => onChange(pos.id)}
                  className="sr-only"
                />
                <DockPillPreview active={active} />
              </label>
            );
          })}
        </div>
      </fieldset>

      <p className="m-0 mt-2 text-center text-xs text-muted-foreground">
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
          : "border-border/70 bg-popover/80 text-muted-foreground",
      )}
    >
      <RedlineMark className="h-2.5 w-2.5 shrink-0" />
    </span>
  );
}

function RedlineMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.5 11.75h11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.25 11.75 8 5l2.75 6.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
