import { Check, Loader2, Pencil } from "lucide-react";
import { type ReactNode, useMemo } from "react";
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
  /** True while an agent iteration run is in flight for this anchor. */
  agentWorking?: boolean;
  anchor: string;
  comments: CommentData[];
  /**
   * Hide the pin for the currently-open instance. Set while that thread is
   * docked to an edge so the pin doesn't poke out beside the drawer.
   */
  hideOpenInstance?: boolean;
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

const PIN_SHAPE = { borderRadius: "50% 50% 50% 3px" } as const;

function pinPulseRing(
  agentWorking: boolean,
  state: PinState,
  isOpen: boolean
): ReactNode {
  if (agentWorking) {
    return (
      <span
        aria-hidden
        className="absolute inset-0 animate-pin-agent-ping"
        style={PIN_SHAPE}
      />
    );
  }
  if (state === "recent" && !isOpen) {
    return (
      <span
        aria-hidden
        className="absolute inset-0 animate-pin-pulse"
        style={PIN_SHAPE}
      />
    );
  }
  return null;
}

function pinBubbleClasses(
  agentWorking: boolean,
  state: PinState,
  isOpen: boolean
): string {
  return cn(
    "relative flex h-full w-full items-center justify-center font-semibold text-[10px] tabular-nums leading-none tracking-tight shadow-[0_1px_2px_rgba(0,0,0,0.16),0_2px_6px_-1px_rgba(0,0,0,0.22)] ring-1 transition-[background-color,box-shadow,outline,color] duration-150",
    agentWorking &&
      "bg-[var(--agent)] text-white ring-[color-mix(in_oklch,var(--agent)_40%,transparent)]",
    !agentWorking &&
      (state === "default" || state === "recent") &&
      "bg-foreground text-background ring-black/10",
    !agentWorking &&
      state === "resolved" &&
      "bg-background text-muted-foreground ring-border",
    isOpen &&
      !agentWorking &&
      "outline outline-2 outline-foreground outline-offset-2",
    isOpen &&
      agentWorking &&
      "outline outline-2 outline-[var(--agent)] outline-offset-2"
  );
}

function pinGlyph(agentWorking: boolean, state: PinState): ReactNode {
  if (agentWorking) {
    return (
      <Loader2 aria-hidden className="h-3 w-3 animate-spin" strokeWidth={2.5} />
    );
  }
  if (state === "resolved") {
    return <Check className="h-3 w-3" strokeWidth={2.75} />;
  }
  return <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />;
}

function PinInstanceButton({
  anchor,
  instance,
  agentWorking,
  author,
  count,
  isOpen,
  left,
  top,
  state,
  onHover,
  onOpen,
}: {
  anchor: string;
  instance: number;
  agentWorking: boolean;
  author: string;
  count: number;
  isOpen: boolean;
  left: number;
  state: PinState;
  top: number;
  onHover: (target: DotInstanceTarget | null) => void;
  onOpen: (target: DotInstanceTarget) => void;
}) {
  const target = { anchor, instance };
  const pinLabel = agentWorking
    ? `Agent working on ${count} comment${count === 1 ? "" : "s"} by ${author}`
    : `${count} comment${count === 1 ? "" : "s"} by ${author}`;

  return (
    <button
      aria-busy={agentWorking}
      aria-label={pinLabel}
      className={cn(
        "pointer-events-auto fixed z-[9100] m-0 p-0 outline-none transition-transform duration-150 ease-out hover:scale-110 focus-visible:scale-110",
        isOpen && "scale-110"
      )}
      key={`${anchor}-${instance}`}
      onBlur={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(target);
      }}
      onFocus={() => onHover(target)}
      onMouseEnter={() => onHover(target)}
      onMouseLeave={() => onHover(null)}
      style={{
        left: left - 3,
        top: top - PIN_SIZE + 5,
        width: PIN_SIZE,
        height: PIN_SIZE,
      }}
      type="button"
    >
      {pinPulseRing(agentWorking, state, isOpen)}
      <span
        aria-hidden
        className={pinBubbleClasses(agentWorking, state, isOpen)}
        style={PIN_SHAPE}
      >
        {pinGlyph(agentWorking, state)}
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
}

/**
 * Comment marker anchored to DOM elements. Renders as a soft-elevated bubble
 * with a pointed corner aimed at the anchor; carries a pencil glyph (or a
 * check, when the thread is resolved) and an overflow count badge when
 * comments stack on one element.
 */
export function CommentDot({
  anchor,
  agentWorking = false,
  comments,
  hideOpenInstance = false,
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
  const primaryInstance =
    openTarget?.anchor === anchor
      ? (instances.find((item) => item.instance === openTarget.instance) ??
        instances[0])
      : instances[0];

  if (!primaryInstance) {
    return null;
  }

  const { left, top } = dotRect(
    { right: primaryInstance.rect.right, top: primaryInstance.rect.top },
    viewport
  );
  const isOpen =
    openTarget?.anchor === anchor &&
    openTarget.instance === primaryInstance.instance;
  if (hideOpenInstance && isOpen) {
    return null;
  }

  return (
    <PinInstanceButton
      agentWorking={agentWorking}
      anchor={anchor}
      author={lead.author}
      count={count}
      instance={primaryInstance.instance}
      isOpen={isOpen}
      left={left}
      onHover={onHover}
      onOpen={onOpen}
      state={state}
      top={top}
    />
  );
}
