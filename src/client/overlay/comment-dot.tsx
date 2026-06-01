import { Check, Pencil } from "lucide-react";
import { useMemo } from "react";
import type { CommentData } from "../types.ts";
import { cn } from "../ui/cn.ts";
import { useAnchorRects } from "./hooks/use-anchor-element.ts";
import { useViewport } from "./hooks/use-viewport.ts";
import { dotRect } from "./lib/placement.ts";

export interface DotInstanceTarget {
  anchor: string;
  instance: number;
}

interface CommentDotProps {
  anchor: string;
  comments: CommentData[];
  onHover: (target: DotInstanceTarget | null) => void;
  onOpen: (target: DotInstanceTarget) => void;
  openTarget: DotInstanceTarget | null;
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * Pin footprint. A near-circular bubble with one sharp corner (bottom-left)
 * that points back at the anchored element's top-right corner — the
 * recognizable "comment marker" silhouette. Square so the rounded sides stay
 * perfectly circular; the pointing corner is shaped via border-radius.
 */
const PIN_SIZE = 20;

type PinState = "recent" | "default" | "resolved";

function pinState(
  comments: CommentData[],
  unresolvedRecent: boolean
): PinState {
  const allResolved = comments.every((c) => c.resolved);
  if (allResolved) {
    return "resolved";
  }
  if (unresolvedRecent) {
    return "recent";
  }
  return "default";
}

/**
 * Comment marker anchored to DOM elements. Renders as a soft-elevated bubble
 * with a pointed corner aimed at the anchor; carries a pencil glyph (or a
 * check, when the thread is resolved) and an overflow count badge when
 * comments stack on one element.
 */
export function CommentDot({
  anchor,
  comments,
  openTarget,
  onOpen,
  onHover,
}: CommentDotProps) {
  const instances = useAnchorRects(anchor);
  const viewport = useViewport();

  const lead = comments[0];
  const unresolvedRecent = useMemo(() => {
    const now = Date.now();
    return comments.some((c) => {
      if (c.resolved) {
        return false;
      }
      const ts = Date.parse(c.date);
      if (Number.isNaN(ts)) {
        return false;
      }
      return now - ts < RECENT_WINDOW_MS;
    });
  }, [comments]);

  if (instances.length === 0 || !lead) {
    return null;
  }

  const state = pinState(comments, unresolvedRecent);
  const count = comments.length;
  // Three rounded corners + one sharp (bottom-left) → a marker that points
  // down-left at the element's top-right corner where the pin is anchored.
  const pinShape = { borderRadius: "50% 50% 50% 3px" };

  return (
    <>
      {instances.map(({ instance, rect }) => {
        const { left, top } = dotRect(
          { right: rect.right, top: rect.top },
          viewport
        );
        const isOpen =
          openTarget?.anchor === anchor && openTarget.instance === instance;
        return (
          <button
            aria-label={`${count} comment${count === 1 ? "" : "s"} by ${lead.author}`}
            className={cn(
              "pointer-events-auto fixed z-[9100] m-0 p-0 outline-none transition-transform duration-150 ease-out hover:scale-110 focus-visible:scale-110",
              isOpen && "scale-110"
            )}
            key={`${anchor}-${instance}`}
            onBlur={() => onHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              onOpen({ anchor, instance });
            }}
            onFocus={() => onHover({ anchor, instance })}
            onMouseEnter={() => onHover({ anchor, instance })}
            onMouseLeave={() => onHover(null)}
            style={{
              left: left - 3,
              top: top - PIN_SIZE + 5,
              width: PIN_SIZE,
              height: PIN_SIZE,
            }}
            type="button"
          >
            {/* Pulse ring for recent threads — sits behind the bubble so the
                expanding shadow never disturbs the bubble's own elevation. */}
            {state === "recent" && !isOpen ? (
              <span
                aria-hidden
                className="absolute inset-0 animate-pin-pulse"
                style={pinShape}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                "relative flex h-full w-full items-center justify-center font-semibold text-[10px] tabular-nums leading-none tracking-tight shadow-[0_1px_2px_rgba(0,0,0,0.16),0_2px_6px_-1px_rgba(0,0,0,0.22)] ring-1 transition-[box-shadow,outline] duration-150",
                (state === "default" || state === "recent") &&
                  "bg-foreground text-background ring-black/10",
                state === "resolved" &&
                  "bg-background text-muted-foreground ring-border",
                isOpen &&
                  "outline outline-2 outline-foreground outline-offset-2"
              )}
              style={pinShape}
            >
              {state === "resolved" ? (
                <Check className="h-3 w-3" strokeWidth={2.75} />
              ) : (
                <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />
              )}
            </span>
            {count > 1 ? (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-background bg-foreground px-1 font-semibold text-[8px] text-background leading-none shadow-sm"
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
