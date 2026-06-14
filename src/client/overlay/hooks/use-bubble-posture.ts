import type { PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clampPositionIntoView,
  clearBubblePosition,
  loadBubblePosition,
  saveBubblePosition,
} from "../lib/bubble-position-store.ts";
import { dotRect } from "../lib/placement.ts";

/** Docked (edge-snapped) posture sizing. */
const DOCK_DEFAULT_WIDTH = 440;
const DOCK_MIN_WIDTH = 360;
const DOCK_MAX_WIDTH = 720;
const DOCK_DEFAULT_HEIGHT = 340;
const DOCK_MIN_HEIGHT = 220;
const DOCK_MAX_HEIGHT = 680;
/** Slack kept between a docked panel and the viewport edges (matches bubble). */
const VIEWPORT_PADDING = 12;
/** How close (px) the pointer must get to a viewport edge to arm drag-to-dock. */
const DOCK_EDGE_THRESHOLD = 64;

type DockSide = "left" | "right" | "top" | "bottom";
type PeekSource = "pointer" | "key" | null;

interface Box {
  height: number;
  left: number;
  top: number;
  width: number;
}

/** Edge-snapped box for a given dock side. Left/right are full-height vertical
 *  drawers; top/bottom are full-width horizontal bars. */
function dockedBox(
  side: DockSide,
  viewport: { width: number; height: number },
  dockW: number,
  dockH: number
): Box {
  const fullHeight = viewport.height - 2 * VIEWPORT_PADDING;
  const fullWidth = viewport.width - 2 * VIEWPORT_PADDING;
  switch (side) {
    case "left":
      return {
        left: 0,
        top: VIEWPORT_PADDING,
        width: dockW,
        height: fullHeight,
      };
    case "right":
      return {
        left: viewport.width - dockW,
        top: VIEWPORT_PADDING,
        width: dockW,
        height: fullHeight,
      };
    case "top":
      return {
        left: VIEWPORT_PADDING,
        top: 0,
        width: fullWidth,
        height: dockH,
      };
    default:
      return {
        left: VIEWPORT_PADDING,
        top: viewport.height - dockH,
        width: fullWidth,
        height: dockH,
      };
  }
}

/** Flatten the corners on the docked (screen) edge so the drawer reads as
 *  fused to that edge. */
function dockedRadiusFor(side: DockSide): string {
  switch (side) {
    case "left":
      return "0 var(--fd-radius) var(--fd-radius) 0";
    case "right":
      return "var(--fd-radius) 0 0 var(--fd-radius)";
    case "top":
      return "0 0 var(--fd-radius) var(--fd-radius)";
    default:
      return "var(--fd-radius) var(--fd-radius) 0 0";
  }
}

/** The viewport edge the pointer is hovering for drag-to-dock, or null when it
 *  is out in open canvas. Corners resolve to whichever edge is closest. */
function nearestEdge(
  x: number,
  y: number,
  viewport: { width: number; height: number }
): DockSide | null {
  const distances: [DockSide, number][] = [
    ["left", x],
    ["right", viewport.width - x],
    ["top", y],
    ["bottom", viewport.height - y],
  ];
  let best: DockSide | null = null;
  let bestDist = DOCK_EDGE_THRESHOLD;
  for (const [side, dist] of distances) {
    if (dist < bestDist) {
      bestDist = dist;
      best = side;
    }
  }
  return best;
}

interface PostureArgs {
  /** Persistence key for a dragged position — the comment id. */
  commentId: string;
  floatHeight: number;
  floatWidth: number;
  maxFloatHeight: number;
  /** Auto-placement used while floating and un-dragged. */
  placement: { left: number; top: number };
  /** Anchored element rect — drives the dot/leader geometry. */
  rect: { right: number; top: number };
  viewport: { width: number; height: number };
}

export interface BubblePosture {
  /** Box for the current posture, positioned with left/top in both cases. */
  box: Box;
  /** Edge-snapped drawer posture. */
  docked: boolean;
  /** Inline border-radius override flattening the docked (screen) edge. */
  dockedRadius: string | undefined;
  dockSide: DockSide | null;
  /** Anchor-dot center, for the leader line endpoint. */
  dotCx: number;
  dotCy: number;
  /** True mid drag/resize gesture — suppress the position transition. */
  dragging: boolean;
  /** True when the panel sits away from its auto-anchor (dragged or docked) —
   *  i.e. there's a placement worth offering a re-anchor reset for. */
  hasCustomPlacement: boolean;
  /** The pointer arrow is invalid (detached or faded); hide it. */
  hidePointer: boolean;
  /** Faded so the design shows through. */
  peeking: boolean;
  /** While drag-to-dock is armed, the box the panel will snap to on release. */
  previewBox: Box | null;
  reanchor: () => void;
  /** Canvas-spanning leader — only while actively relating panel↔design. */
  showLeader: boolean;
  startDrag: (e: PointerEvent<HTMLDivElement>) => void;
  startPeek: () => void;
  startResize: (e: PointerEvent<HTMLDivElement>) => void;
  toggleDock: () => void;
}

/**
 * Posture of the open comment panel — float (auto-anchored or free-dragged),
 * docked (edge-snapped, resizable drawer), and peek (faded to reveal the
 * design). Each is reachable without the others fighting: peek owns occlusion
 * by touching only our own opacity, so float/dock placement is pure
 * preference. The leader line keeps the spatial anchor while actively
 * comparing the panel to the design.
 *
 * Hotkeys (⌘/Ctrl combos, so they coexist with the always-focused composer):
 *   hold ⌘/Ctrl+E to peek · ⌘/Ctrl+D to toggle dock.
 */
export function useBubblePosture({
  commentId,
  rect,
  viewport,
  placement,
  floatWidth,
  floatHeight,
  maxFloatHeight,
}: PostureArgs): BubblePosture {
  // Restore a previously dragged position (persisted per comment), clamped back
  // into view in case the viewport shrank since. It stays put across
  // close/reopen and reloads until the user docks or re-anchors.
  const [userPosition, setUserPosition] = useState<{
    left: number;
    top: number;
  } | null>(() => {
    const saved = loadBubblePosition(commentId);
    return saved ? clampPositionIntoView(saved, viewport, floatWidth) : null;
  });
  const [dockSide, setDockSide] = useState<DockSide | null>(null);
  const [dockWidth, setDockWidth] = useState(DOCK_DEFAULT_WIDTH);
  const [dockHeight, setDockHeight] = useState(DOCK_DEFAULT_HEIGHT);
  // The edge a drag-to-dock gesture is currently armed to snap to, if any.
  const [dockPreview, setDockPreview] = useState<DockSide | null>(null);
  const [peeking, setPeeking] = useState(false);
  // Suppresses the position transition during an active drag/resize gesture.
  const [dragging, setDragging] = useState(false);

  // Tracks what started the current peek so the right release ends it (a
  // pointer-held peek ends on pointerup; a key-held peek on keyup).
  const peekSource = useRef<PeekSource>(null);
  // Latest geometry for the (once-bound) hotkey listener, avoiding stale reads.
  const geomRef = useRef({ dotCx: 0, viewportWidth: viewport.width });
  // Latest comment id for the once-bound hotkey listener (stable per mount).
  const commentIdRef = useRef(commentId);
  commentIdRef.current = commentId;

  // Release ends a peek: pointerup for a held button, keyup for a held hotkey,
  // and window blur as a hard reset for either.
  useEffect(() => {
    if (!peeking) {
      return;
    }
    const endPointer = () => {
      if (peekSource.current === "pointer") {
        peekSource.current = null;
        setPeeking(false);
      }
    };
    const hardEnd = () => {
      peekSource.current = null;
      setPeeking(false);
    };
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    window.addEventListener("blur", hardEnd);
    return () => {
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
      window.removeEventListener("blur", hardEnd);
    };
  }, [peeking]);

  // Hotkeys — bound once; reads live geometry via geomRef.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "e") {
        e.preventDefault();
        peekSource.current = "key";
        setPeeking(true);
      } else if (key === "d") {
        e.preventDefault();
        setUserPosition(null);
        clearBubblePosition(commentIdRef.current);
        setDragging(false);
        setDockSide((prev) => {
          if (prev) {
            return null;
          }
          const { dotCx, viewportWidth } = geomRef.current;
          return dotCx > viewportWidth / 2 ? "left" : "right";
        });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        peekSource.current === "key" &&
        (key === "e" || key === "meta" || key === "control")
      ) {
        peekSource.current = null;
        setPeeking(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const docked = dockSide !== null;
  const detached = docked || userPosition !== null;
  const hasCustomPlacement = detached;
  const hidePointer = detached || peeking;
  // The canvas-spanning line is the only real occluder, so it shows only while
  // you're actively relating the panel to the design: dragging or peeking.
  const showLeader = peeking || dragging;

  const dot = dotRect({ right: rect.right, top: rect.top }, viewport);
  const dotCx = (dot.left + dot.right) / 2;
  const dotCy = (dot.top + dot.bottom) / 2;
  geomRef.current = { dotCx, viewportWidth: viewport.width };

  const dockW = Math.min(dockWidth, viewport.width - 2 * VIEWPORT_PADDING);
  const dockH = Math.min(dockHeight, viewport.height - 2 * VIEWPORT_PADDING);
  const box: Box = dockSide
    ? dockedBox(dockSide, viewport, dockW, dockH)
    : {
        left: userPosition?.left ?? placement.left,
        top: userPosition?.top ?? placement.top,
        width: floatWidth,
        height: Math.min(floatHeight, maxFloatHeight),
      };

  const dockedRadius = dockSide ? dockedRadiusFor(dockSide) : undefined;
  const previewBox = dockPreview
    ? dockedBox(dockPreview, viewport, dockW, dockH)
    : null;

  // Auto-pick: dock to the edge *away* from the anchor so the panel clears the
  // element it is about; toggling again returns to auto-anchored float. This is
  // the one-tap default — drag-to-dock (below) lets you override the side.
  const toggleDock = () => {
    setUserPosition(null);
    clearBubblePosition(commentId);
    setDragging(false);
    setDockSide((prev) => {
      if (prev) {
        return null;
      }
      return dotCx > viewport.width / 2 ? "left" : "right";
    });
  };

  const reanchor = useCallback(() => {
    peekSource.current = null;
    setPeeking(false);
    setDragging(false);
    setDockSide(null);
    setDockPreview(null);
    setUserPosition(null);
    clearBubblePosition(commentId);
  }, [commentId]);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    // Buttons keep their clicks. A docked panel detaches to float at its current
    // spot so the same gesture can fling it to any other edge.
    if ((e.target as Element).closest("button")) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    // Anchor the drag to the panel's current on-screen position, docked or not,
    // so detaching a docked drawer doesn't jump.
    const baseLeft = box.left;
    const baseTop = box.top;
    setDragging(true);
    let moved = false;
    const onMove = (ev: globalThis.PointerEvent) => {
      moved = true;
      // First movement detaches a docked panel to float; a pure click leaves it.
      setDockSide(null);
      setUserPosition({
        left: baseLeft + ev.clientX - startX,
        top: baseTop + ev.clientY - startY,
      });
      setDockPreview(nearestEdge(ev.clientX, ev.clientY, viewport));
    };
    const onUp = (ev: globalThis.PointerEvent) => {
      setDragging(false);
      setDockPreview(null);
      // Only a real drag can snap to an edge — a plain click leaves posture as is.
      const edge = moved ? nearestEdge(ev.clientX, ev.clientY, viewport) : null;
      if (edge) {
        // Snap docked to the edge the pointer was released against; the free
        // position no longer applies, so drop the persisted one too.
        setDockSide(edge);
        setUserPosition(null);
        clearBubblePosition(commentId);
      } else if (moved) {
        // Resting in open canvas — persist this spot so reopening the thread
        // keeps it here until the user docks or re-anchors.
        const resting = {
          left: baseLeft + ev.clientX - startX,
          top: baseTop + ev.clientY - startY,
        };
        setUserPosition(resting);
        saveBubblePosition(commentId, resting);
      }
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    const horizontal = dockSide === "left" || dockSide === "right";
    const maxW = Math.min(DOCK_MAX_WIDTH, viewport.width - 120);
    const maxH = Math.min(DOCK_MAX_HEIGHT, viewport.height - 120);
    const onMove = (ev: globalThis.PointerEvent) => {
      if (horizontal) {
        const raw =
          dockSide === "right" ? viewport.width - ev.clientX : ev.clientX;
        setDockWidth(Math.max(DOCK_MIN_WIDTH, Math.min(maxW, raw)));
      } else {
        const raw =
          dockSide === "bottom" ? viewport.height - ev.clientY : ev.clientY;
        setDockHeight(Math.max(DOCK_MIN_HEIGHT, Math.min(maxH, raw)));
      }
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return {
    docked,
    dockSide,
    peeking,
    dragging,
    hidePointer,
    showLeader,
    box,
    dockedRadius,
    hasCustomPlacement,
    previewBox,
    dotCx,
    dotCy,
    reanchor,
    startDrag,
    startResize,
    startPeek: () => {
      peekSource.current = "pointer";
      setPeeking(true);
    },
    toggleDock,
  };
}
