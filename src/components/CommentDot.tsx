import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import type { RegisteredComment } from "./types";
import { useAnchorRects } from "./useAnchorElement";
import { dotRect } from "./placement";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

export type DotInstanceTarget = { anchor: string; instance: number };

type CommentDotProps = {
  anchor: string;
  comments: RegisteredComment[];
  openTarget: DotInstanceTarget | null;
  onOpen: (target: DotInstanceTarget) => void;
  onHover: (target: DotInstanceTarget | null) => void;
};

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PIN_W = 22;
const PIN_H = 26;

function readViewport() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

type PinState = "recent" | "default" | "resolved";

function pinState(
  comments: RegisteredComment[],
  unresolvedRecent: boolean,
): PinState {
  const allResolved = comments.every((c) => c.resolved);
  if (allResolved) return "resolved";
  if (unresolvedRecent) return "recent";
  return "default";
}

/**
 * Map-pin comment marker anchored to DOM elements.
 */
export function CommentDot({
  anchor,
  comments,
  openTarget,
  onOpen,
  onHover,
}: CommentDotProps) {
  const rects = useAnchorRects(anchor);
  const [viewport, setViewport] = useState(readViewport);

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize);
    };
  }, []);

  const lead = comments[0];
  const unresolvedRecent = useMemo(() => {
    const now = Date.now();
    return comments.some((c) => {
      if (c.resolved) return false;
      const ts = Date.parse(c.date);
      if (Number.isNaN(ts)) return false;
      return now - ts < RECENT_WINDOW_MS;
    });
  }, [comments]);

  if (rects.length === 0 || !lead) return null;

  const state = pinState(comments, unresolvedRecent);
  const count = comments.length;

  return (
    <>
      {rects.map((rect, instance) => {
        const { left, top } = dotRect(
          { right: rect.right, top: rect.top },
          viewport,
        );
        const isOpen =
          openTarget?.anchor === anchor && openTarget.instance === instance;
        return (
          <button
            key={instance}
            type="button"
            aria-label={`${count} comment${count === 1 ? "" : "s"} by ${lead.author}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen({ anchor, instance });
            }}
            onMouseEnter={() => onHover({ anchor, instance })}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover({ anchor, instance })}
            onBlur={() => onHover(null)}
            className={cn(
              "pointer-events-auto fixed z-[9100] m-0 flex items-center justify-center p-0 outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isOpen && "scale-110",
            )}
            style={{
              left: left - PIN_W / 2 + 6,
              top: top - PIN_H + 4,
              width: PIN_W,
              height: PIN_H,
            }}
          >
            <span
              aria-hidden
              className={cn(
                "relative flex h-full w-full items-center justify-center drop-shadow-md",
                state === "recent" && !isOpen && "animate-pin-pulse",
                isOpen && "ring-2 ring-ring ring-offset-2 ring-offset-background rounded-sm",
              )}
            >
              <svg
                viewBox="0 0 24 28"
                width={PIN_W}
                height={PIN_H}
                className="overflow-visible"
                aria-hidden
              >
                <path
                  d="M12 1C7.03 1 3 5.03 3 10c0 5.25 9 16 9 16s9-10.75 9-16c0-4.97-4.03-9-9-9z"
                  className={cn(
                    state === "resolved" && "fill-muted stroke-border stroke-[1.5]",
                    state === "default" && "fill-primary stroke-primary stroke-[0.5]",
                    state === "recent" && "fill-amber-500 stroke-amber-600 stroke-[0.5]",
                  )}
                />
              </svg>
              <MessageSquare
                className={cn(
                  "absolute left-1/2 top-[5px] h-2.5 w-2.5 -translate-x-1/2",
                  state === "resolved"
                    ? "text-muted-foreground"
                    : "text-primary-foreground",
                  state === "recent" && "text-white",
                )}
                strokeWidth={2.5}
              />
            </span>
            {count > 1 ? (
              <Badge
                variant="secondary"
                className="pointer-events-none absolute -right-2 -top-1.5 h-4 min-w-4 justify-center px-1 text-[9px] font-semibold"
              >
                {count}
              </Badge>
            ) : null}
          </button>
        );
      })}
    </>
  );
}
