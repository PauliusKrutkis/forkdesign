import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { dotRect } from "../lib/placement.ts";

/** Docked (edge-snapped) posture sizing. */
const DOCK_DEFAULT_WIDTH = 440;
const DOCK_MIN_WIDTH = 360;
const DOCK_MAX_WIDTH = 720;
/** Slack kept between a docked panel and the viewport edges (matches bubble). */
const VIEWPORT_PADDING = 12;

type DockSide = "left" | "right";
type PeekSource = "pointer" | "key" | null;

interface Box {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface PostureArgs {
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
  /** The pointer arrow is invalid (detached or faded); hide it. */
  hidePointer: boolean;
  /** Faded so the design shows through. */
  peeking: boolean;
  /** Canvas-spanning leader — only while actively relating panel↔design. */
  showLeader: boolean;
  /** Localized element ring — cheap, shown whenever detached or peeking. */
  showRing: boolean;
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
 * preference. The element ring + leader line keep the spatial anchor while
 * detached, so dragging never loses "which element."
 *
 * Hotkeys (⌘/Ctrl combos, so they coexist with the always-focused composer):
 *   hold ⌘/Ctrl+E to peek · ⌘/Ctrl+D to toggle dock.
 */
export function useBubblePosture({
  rect,
  viewport,
  placement,
  floatWidth,
  floatHeight,
  maxFloatHeight,
}: PostureArgs): BubblePosture {
  const [userPosition, setUserPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [dockSide, setDockSide] = useState<DockSide | null>(null);
  const [dockWidth, setDockWidth] = useState(DOCK_DEFAULT_WIDTH);
  const [peeking, setPeeking] = useState(false);
  // Suppresses the position transition during an active drag/resize gesture.
  const [dragging, setDragging] = useState(false);

  // Tracks what started the current peek so the right release ends it (a
  // pointer-held peek ends on pointerup; a key-held peek on keyup).
  const peekSource = useRef<PeekSource>(null);
  // Latest geometry for the (once-bound) hotkey listener, avoiding stale reads.
  const geomRef = useRef({ dotCx: 0, viewportWidth: viewport.width });

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
  const hidePointer = detached || peeking;
  const showRing = detached || peeking;
  // The canvas-spanning line is the only real occluder, so it shows only while
  // you're actively relating the panel to the design: dragging or peeking.
  const showLeader = peeking || dragging;

  const dot = dotRect({ right: rect.right, top: rect.top }, viewport);
  const dotCx = (dot.left + dot.right) / 2;
  const dotCy = (dot.top + dot.bottom) / 2;
  geomRef.current = { dotCx, viewportWidth: viewport.width };

  const dockW = Math.min(dockWidth, viewport.width - 2 * VIEWPORT_PADDING);
  const box: Box = docked
    ? {
        left: dockSide === "right" ? viewport.width - dockW : 0,
        top: VIEWPORT_PADDING,
        width: dockW,
        height: viewport.height - 2 * VIEWPORT_PADDING,
      }
    : {
        left: userPosition?.left ?? placement.left,
        top: userPosition?.top ?? placement.top,
        width: floatWidth,
        height: Math.min(floatHeight, maxFloatHeight),
      };

  let dockedRadius: string | undefined;
  if (docked) {
    dockedRadius =
      dockSide === "right"
        ? "var(--radius) 0 0 var(--radius)"
        : "0 var(--radius) var(--radius) 0";
  }

  // Dock to the edge *away* from the anchor so the panel clears the element it
  // is about; undock returns to auto-anchored float.
  const toggleDock = () => {
    setUserPosition(null);
    setDragging(false);
    setDockSide((prev) => {
      if (prev) {
        return null;
      }
      return dotCx > viewport.width / 2 ? "left" : "right";
    });
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    // Docked panels are edge-snapped (resize only); buttons keep their clicks.
    if (docked || (e.target as Element).closest("button")) {
      return;
    }
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const baseLeft = userPosition?.left ?? placement.left;
    const baseTop = userPosition?.top ?? placement.top;
    setDragging(true);
    const onMove = (ev: globalThis.PointerEvent) => {
      setUserPosition({
        left: baseLeft + ev.clientX - startX,
        top: baseTop + ev.clientY - startY,
      });
    };
    const onUp = () => {
      setDragging(false);
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
    const maxW = Math.min(DOCK_MAX_WIDTH, viewport.width - 120);
    const onMove = (ev: globalThis.PointerEvent) => {
      const raw =
        dockSide === "right" ? viewport.width - ev.clientX : ev.clientX;
      setDockWidth(Math.max(DOCK_MIN_WIDTH, Math.min(maxW, raw)));
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
    showRing,
    showLeader,
    box,
    dockedRadius,
    dotCx,
    dotCy,
    startDrag,
    startResize,
    startPeek: () => {
      peekSource.current = "pointer";
      setPeeking(true);
    },
    toggleDock,
  };
}
