import { useEffect, useMemo, useState } from "react";
import type { RegisteredComment } from "./types";
import { useAnchorRects } from "./useAnchorElement";
import { dotRect } from "./placement";

export type DotInstanceTarget = { anchor: string; instance: number };

type CommentDotProps = {
  anchor: string;
  comments: RegisteredComment[];
  openTarget: DotInstanceTarget | null;
  onOpen: (target: DotInstanceTarget) => void;
  onHover: (target: DotInstanceTarget | null) => void;
};

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function readViewport() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * At-rest dot rendered over an anchored element. Stacks with a count
 * badge when multiple comments share the same anchor.
 *
 * Position is computed from the live DOMRect of the anchor; the dot
 * follows scroll, resize, and DOM mutations.
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

  const fill = unresolvedRecent
    ? "bg-[var(--co-sev-warning)]"
    : "bg-[var(--co-sev-info)]";
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
            className="pointer-events-auto fixed z-[9100] m-0 flex h-[14px] w-[14px] -translate-y-0 items-center justify-center rounded-full p-0 outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--co-sev-info)] focus-visible:ring-offset-1"
            style={{ left, top }}
          >
            <span
              className={`block h-[14px] w-[14px] rounded-full ring-2 ring-white shadow-[0_1px_3px_rgba(20,17,14,0.18)] ${fill} ${
                isOpen ? "comment-dot-pulse" : ""
              }`}
              aria-hidden
            />
            {count > 1 ? (
              <span
                aria-hidden
                className="pointer-events-none absolute -right-2 -top-2 inline-flex min-w-[14px] items-center justify-center rounded-[var(--co-radius-pill)] bg-[var(--co-ink)] px-1 font-[var(--co-font-mono)] text-[9px] font-medium leading-none text-[var(--co-page)]"
                style={{ paddingTop: 2, paddingBottom: 2 }}
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
