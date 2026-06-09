import { SquareDashedMousePointer, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_AGENT_VERSION_COUNT } from "../../shared/agent-version-count.ts";
import type { OverlayModel } from "../settings.ts";
import { Button } from "../ui/button.tsx";
import {
  CommentComposerBar,
  type ComposerMode,
} from "./comment-composer-bar.tsx";
import { HotkeyTip } from "./hotkey-tip.tsx";
import { cssEscape } from "./lib/css-escape.ts";
import { toErrorMessage } from "./lib/errors.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { isOverlayElement } from "./lib/overlay-dom.ts";
import { captureElementToPng } from "./lib/screenshot.ts";
import { findSourceLoc } from "./lib/source-loc.ts";

export interface ComposerSubmission {
  /** anchor uuid assigned to the targeted element */
  anchor: string;
  /** anchor point (page x/y of the click) for positioning the panel */
  clickPoint: { x: number; y: number };
  /** Agent model when `runAgent` is set; defaults to overlay settings. */
  model?: OverlayModel;
  /** submitted in Agent mode — create the comment, then run the agent on it */
  runAgent?: boolean;
  /**
   * Optional `data:image/png;base64,...` capture of the targeted element's
   * bounding box (Comment mode only). Agent mode omits this; baseline `v0`
   * is captured immediately before the agent run instead.
   */
  screenshotPng?: string;
  /** the element that was clicked to seed the comment */
  target: HTMLElement;
  /** the typed body */
  text: string;
  /** variant count to generate when `runAgent` is set */
  versionCount?: number;
  /** the slug of the nearest data-view ancestor, if any */
  view: string | undefined;
}

/**
 * Outcome of an async submission. The composer panel uses this to drive its
 * inline saving/saved/error UI without the parent having to mount its own
 * status surface.
 */
export type ComposerSubmitResult = { ok: true } | { ok: false; error: string };

interface CommentComposerProps {
  /** when true, the composer mode is active (highlight + capture next click) */
  active: boolean;
  agentModel: OverlayModel;
  onAgentModelChange: (model: OverlayModel) => void;
  /** turn composer mode off */
  onCancel: () => void;
  /**
   * Invoked when the user submits a comment. Returns a Promise so the
   * composer can show inline "saving"/"saved"/"error" states. On a failed
   * submission the textarea content is preserved so the user can retry or
   * pick a different target.
   */
  onSubmit: (entry: ComposerSubmission) => Promise<ComposerSubmitResult>;
}

const PANEL_WIDTH = 400;
const VIEWPORT_PADDING = 12;
const MAX_PICKER_CRUMBS = 5;
const PICKER_CLEAR_DELAY_MS = 750;

interface PickerCandidate {
  el: HTMLElement;
  key: string;
  label: string;
  occurrenceRects: Array<{
    height: number;
    left: number;
    top: number;
    width: number;
  }>;
  rect: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
}

interface PickerState {
  candidates: PickerCandidate[];
  point: { x: number; y: number };
  selectedIndex: number;
}

/**
 * Two-phase capture:
 *   1. While `active` and no target picked: hover highlights any element under
 *      the cursor with a dashed outline; click freezes that element as the
 *      composer target.
 *   2. With a target picked: render a panel near the click point with a
 *      textarea + submit button. Submit calls `onSubmit`; cancel returns to
 *      phase 1.
 */
export function CommentComposer({
  active,
  agentModel,
  onAgentModelChange,
  onCancel,
  onSubmit,
}: CommentComposerProps) {
  const [target, setTarget] = useState<{
    el: HTMLElement;
    clickPoint: { x: number; y: number };
  } | null>(null);
  const [text, setText] = useState("");
  const [picker, setPickerState] = useState<PickerState | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Hold onCancel in a ref so the picker-listener effect below doesn't depend
  // on its identity. The parent passes a fresh inline arrow every render, and
  // while an agent runs the overlay re-renders constantly (1.5s poll + HMR) —
  // listing onCancel in the deps would tear the effect down on each render,
  // and its cleanup calls setPicker(null), wiping the hover highlight.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  const setPicker = useCallback((next: PickerState | null) => {
    pickerRef.current = next;
    setPickerState(next);
  }, []);

  // Hovering a breadcrumb previews that ancestor (and locks the depth to it);
  // clicking one commits it as the target. Both give the mouse a direct path
  // to any level without precise hovering over tiny nested elements.
  const previewIndex = useCallback(
    (index: number) => {
      const state = pickerRef.current;
      if (!state || index < 0 || index >= state.candidates.length) {
        return;
      }
      setPicker({ ...state, selectedIndex: index });
    },
    [setPicker]
  );

  const commitIndex = useCallback(
    (index: number) => {
      const state = pickerRef.current;
      const candidate = state?.candidates[index];
      if (!(state && candidate)) {
        return;
      }
      const el = liveCandidateElement(candidate, state.point);
      if (!el) {
        setPicker(null);
        return;
      }
      setPicker(null);
      setTarget({ el, clickPoint: { ...state.point } });
    },
    [setPicker]
  );

  // Reset state whenever composer mode flips off.
  useEffect(() => {
    if (!active) {
      setTarget(null);
      setText("");
      setPicker(null);
    }
  }, [active, setPicker]);

  // Capture: preview the target stack, suppress real UI clicks, freeze on click.
  useEffect(() => {
    if (!active || target) {
      return;
    }
    if (typeof document === "undefined") {
      return;
    }

    let pickerClearTimer: number | null = null;
    const cancelPickerClear = () => {
      if (pickerClearTimer !== null) {
        window.clearTimeout(pickerClearTimer);
        pickerClearTimer = null;
      }
    };
    const schedulePickerClear = () => {
      if (!pickerRef.current || pickerClearTimer !== null) {
        return;
      }
      pickerClearTimer = window.setTimeout(() => {
        pickerClearTimer = null;
        setPicker(null);
      }, PICKER_CLEAR_DELAY_MS);
    };

    const updatePicker = (x: number, y: number): HTMLElement | null => {
      const elements = pickTargetStack(x, y);
      if (elements.length === 0) {
        schedulePickerClear();
        return null;
      }
      cancelPickerClear();

      // Depth-locked: keep the same ancestor offset (index 0 = deepest hit)
      // as the cursor moves, clamped to the new stack. Locking by depth rather
      // than by element identity means a small mouse jitter no longer snaps the
      // selection back to the deepest child — the user stays N levels up.
      const prev = pickerRef.current;
      const selectedIndex = prev
        ? Math.min(prev.selectedIndex, elements.length - 1)
        : 0;

      const candidates = elements.map(toCandidate);
      const next = { candidates, point: { x, y }, selectedIndex };
      setPicker(next);
      return candidates[selectedIndex]?.el ?? null;
    };

    const onMove = (e: MouseEvent) => {
      // Don't recompute while the cursor is over our own chrome (the picker
      // chip / breadcrumbs) — otherwise reaching for a crumb would shift the
      // selection to whatever page element sits behind the chip.
      if (isOverlayElement(document.elementFromPoint(e.clientX, e.clientY))) {
        return;
      }
      updatePicker(e.clientX, e.clientY);
    };

    // Walk the ancestor chain by a relative step, clamped (no wrap — wrapping
    // a tree is disorienting). Positive = toward ancestors (up the tree).
    const step = (direction: number) => {
      const state = pickerRef.current;
      if (!state || state.candidates.length < 2) {
        return;
      }
      const selectedIndex = Math.min(
        Math.max(state.selectedIndex + direction, 0),
        state.candidates.length - 1
      );
      if (selectedIndex !== state.selectedIndex) {
        setPicker({ ...state, selectedIndex });
      }
    };

    // Jump to the previous / next source-locatable sibling of the currently
    // highlighted element, re-rooting the stack at that sibling. Keyboard-only
    // — lets you sweep across a row of cards without re-aiming the mouse.
    const stepSibling = (direction: number) => {
      const state = pickerRef.current;
      const current = state?.candidates[state.selectedIndex]?.el ?? null;
      if (!(state && current)) {
        return;
      }
      const elements = siblingStack(current, direction);
      if (!elements?.length) {
        return;
      }
      setPicker({
        candidates: elements.map(toCandidate),
        point: state.point,
        selectedIndex: 0,
      });
    };

    // Block navigation/app-level handlers (react-router Link, button onClick,
    // form submits, etc.) for ALL pointer events the browser or framework
    // might use to initiate them. We use `stopImmediatePropagation` so any
    // other capture-phase listener on the same target also gets skipped.
    const swallow = (e: Event): boolean => {
      // Clicks/taps that land on our own chrome (breadcrumb crumbs) must flow
      // through to their React handlers, not be suppressed or treated as a
      // page hit.
      if (isOverlayElement(e.target as Element | null)) {
        return false;
      }
      const targetEl =
        e instanceof MouseEvent
          ? pickHitTarget(e.clientX, e.clientY)
          : (e.target as HTMLElement | null);
      if (!targetEl || isOverlayElement(targetEl)) {
        return false;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    };

    // Freeze the currently highlighted candidate as the composer target.
    // `clickPoint` positions the panel; defaults to the last cursor position
    // (used by the Enter hotkey, which has no event coordinates).
    const commitCurrent = (clickPoint?: { x: number; y: number }): boolean => {
      const state = pickerRef.current;
      const candidate = state?.candidates[state.selectedIndex];
      if (!(state && candidate)) {
        return false;
      }
      const el = liveCandidateElement(candidate, clickPoint ?? state.point);
      if (!el) {
        setPicker(null);
        return false;
      }
      cancelPickerClear();
      setPicker(null);
      setTarget({ el, clickPoint: clickPoint ?? { ...state.point } });
      return true;
    };

    const onClick = (e: MouseEvent) => {
      if (!swallow(e)) {
        return;
      }
      if (!pickerRef.current) {
        updatePicker(e.clientX, e.clientY);
      }
      commitCurrent({ x: e.clientX, y: e.clientY });
    };

    const onMouseDown = (e: MouseEvent) => {
      swallow(e);
    };

    const onPointerDown = (e: PointerEvent) => {
      swallow(e);
    };

    const onWheel = (e: WheelEvent) => {
      const state = pickerRef.current;
      if (!state || state.candidates.length < 2) {
        return;
      }
      // Scrolling up reaches for the parent (outer) element; down dives back
      // toward the child. Suppress page scroll while a target is being picked.
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancelRef.current();
        return;
      }
      // Enter commits the currently highlighted element — lets a keyboard user
      // who walked the tree with the arrows / scroll lock it in without
      // reaching for the mouse.
      if (e.key === "Enter") {
        if (commitCurrent()) {
          e.preventDefault();
        }
        return;
      }
      // ArrowUp / ArrowDown walk parent / child (keep [ ] as aliases);
      // ArrowLeft / ArrowRight sweep across siblings.
      const walk = walkDirection(e.key);
      if (walk !== 0) {
        e.preventDefault();
        step(walk);
        return;
      }
      const sibling = siblingDirection(e.key);
      if (sibling !== 0) {
        e.preventDefault();
        stepSibling(sibling);
      }
    };

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    document.addEventListener("keydown", onKey);

    return () => {
      cancelPickerClear();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("keydown", onKey);
      setPicker(null);
    };
  }, [active, target, setPicker]);

  // Auto-focus textarea once a target is picked.
  useEffect(() => {
    if (target && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [target]);

  if (!active) {
    return null;
  }

  return (
    <>
      {picker ? (
        <PickerPreview
          onCommitIndex={commitIndex}
          onPreviewIndex={previewIndex}
          picker={picker}
        />
      ) : null}
      {target ? (
        <ComposerPanel
          agentModel={agentModel}
          clickPoint={target.clickPoint}
          onAgentModelChange={onAgentModelChange}
          onCancel={() => {
            setTarget(null);
            setText("");
          }}
          onSaved={() => {
            // Defer the reset slightly so the "saved" pill is visible.
            window.setTimeout(() => {
              setTarget(null);
              setText("");
            }, 600);
          }}
          onSubmit={async ({ runAgent, versionCount, model }) => {
            const trimmed = text.trim();
            if (!trimmed) {
              return { ok: false, error: "empty body" };
            }
            const anchor = ensureAnchor(target.el);
            const view =
              target.el.closest("[data-view]")?.getAttribute("data-view") ??
              undefined;
            const screenshotPng = runAgent
              ? undefined
              : await captureElementScreenshot(target.el);
            const result = await onSubmit({
              anchor,
              target: target.el,
              clickPoint: target.clickPoint,
              view,
              text: trimmed,
              runAgent,
              versionCount,
              ...(model ? { model } : {}),
              ...(screenshotPng ? { screenshotPng } : {}),
            });
            return result;
          }}
          onTextChange={setText}
          target={target.el}
          text={text}
          textareaRef={textareaRef}
        />
      ) : null}
    </>
  );
}

/**
 * Four L-shaped corner ticks drawn just outside the selected element's box —
 * a design-tool / camera-reticle selection cue that reads as precise
 * "redlining" rather than a soft glowing rectangle, echoing the sharp-cornered
 * comment pin. The arms overhang the box by 1px so they sit flush on the
 * 1px outline.
 */
function SelectionReticle() {
  const arm = "h-2.5 w-2.5";
  const stroke =
    "1.5px solid color-mix(in oklch, var(--foreground) 85%, transparent)";
  const corners = [
    { id: "tl", top: -1, left: -1, borderTop: stroke, borderLeft: stroke },
    { id: "tr", top: -1, right: -1, borderTop: stroke, borderRight: stroke },
    {
      id: "bl",
      bottom: -1,
      left: -1,
      borderBottom: stroke,
      borderLeft: stroke,
    },
    {
      id: "br",
      bottom: -1,
      right: -1,
      borderBottom: stroke,
      borderRight: stroke,
    },
  ];
  return (
    <>
      {corners.map(({ id, ...style }) => (
        <span
          aria-hidden
          className={`pointer-events-none absolute ${arm}`}
          key={id}
          style={style}
        />
      ))}
    </>
  );
}

function PickerPreview({
  picker,
  onPreviewIndex,
  onCommitIndex,
}: {
  picker: PickerState;
  onPreviewIndex: (index: number) => void;
  onCommitIndex: (index: number) => void;
}) {
  const selected = picker.candidates[picker.selectedIndex];
  if (!selected) {
    return null;
  }

  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight;
  const chipWidth = 340;
  const chipLeft = Math.max(
    VIEWPORT_PADDING,
    Math.min(picker.point.x + 14, viewportW - chipWidth - VIEWPORT_PADDING)
  );
  const chipTop =
    picker.point.y + 96 > viewportH
      ? Math.max(VIEWPORT_PADDING, picker.point.y - 92)
      : picker.point.y + 18;

  // The immediate parent (next index up) gets a faint outline as a "there's a
  // level above you" affordance; the rest of the stack stays hidden so the
  // selected box reads cleanly.
  const parent = picker.candidates[picker.selectedIndex + 1];
  const siblingOccurrenceRects = selected.occurrenceRects.filter(
    (rect) => !sameRect(rect, selected.rect)
  );
  const occurrenceCount = selected.occurrenceRects.length;

  // Breadcrumbs read naturally outermost › … › deepest (left → right), the
  // reverse of the deepest-first candidate stack.
  const visible = visiblePickerCandidates(picker, selected);
  const truncated = visible.length < picker.candidates.length;
  const crumbs = visible
    .map((candidate) => ({
      candidate,
      index: picker.candidates.indexOf(candidate),
    }))
    .reverse();

  return (
    <>
      {parent ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[9299] transition-[left,top,width,height] duration-75"
          data-comment-overlay="true"
          style={{
            left: parent.rect.left,
            top: parent.rect.top,
            width: parent.rect.width,
            height: parent.rect.height,
            outline:
              "1px dashed color-mix(in oklch, var(--ring) 50%, transparent)",
            opacity: 0.55,
          }}
        />
      ) : null}
      {siblingOccurrenceRects.map((rect) => (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[9298] transition-[left,top,width,height] duration-75"
          data-comment-overlay="true"
          key={`${selected.key}:occurrence:${rectKey(rect)}`}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            background: "color-mix(in oklch, var(--ring) 7%, transparent)",
            outline:
              "1px solid color-mix(in oklch, var(--ring) 45%, transparent)",
          }}
        />
      ))}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[9300] transition-[left,top,width,height] duration-75"
        data-comment-overlay="true"
        style={{
          left: selected.rect.left,
          top: selected.rect.top,
          width: selected.rect.width,
          height: selected.rect.height,
          background: "color-mix(in oklch, var(--foreground) 6%, transparent)",
          outline:
            "1px solid color-mix(in oklch, var(--foreground) 35%, transparent)",
        }}
      >
        <SelectionReticle />
      </div>
      <div
        className="pointer-events-auto fixed z-[9310] w-[340px] select-none overflow-hidden rounded-xl border bg-popover/95 text-popover-foreground shadow-[0_18px_40px_-18px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur"
        data-comment-overlay="true"
        data-testid="design-crit-picker-chip"
        style={{ left: chipLeft, top: chipTop }}
      >
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0">
            <div className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.16em]">
              target
            </div>
            <div className="truncate font-mono font-semibold text-[11px] text-foreground">
              {selected.label}
            </div>
          </div>
          <div className="shrink-0 rounded-full border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {occurrenceCount > 1
              ? `${occurrenceCount} matches`
              : `${picker.selectedIndex + 1}/${picker.candidates.length}`}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden px-3 py-2">
          {truncated ? (
            <span className="shrink-0 px-0.5 font-mono text-[10px] text-muted-foreground">
              …›
            </span>
          ) : null}
          {crumbs.map(({ candidate, index }, i) => (
            <span className="flex min-w-0 items-center" key={candidate.key}>
              {i > 0 ? (
                <span className="shrink-0 px-0.5 font-mono text-[10px] text-muted-foreground/60">
                  ›
                </span>
              ) : null}
              <button
                className={
                  index === picker.selectedIndex
                    ? "min-w-0 truncate rounded-md bg-foreground px-1.5 py-1 font-mono text-[10px] text-background"
                    : "min-w-0 truncate rounded-md bg-muted px-1.5 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted-foreground/20 hover:text-foreground"
                }
                onClick={() => onCommitIndex(index)}
                onMouseEnter={() => onPreviewIndex(index)}
                type="button"
              >
                {candidate.label}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-1.5 font-mono text-[9px] text-muted-foreground">
          <span>
            {occurrenceCount > 1
              ? "comment applies to all matches"
              : "↑↓ levels · ←→ siblings"}
          </span>
          <span>↵ or click to pick</span>
        </div>
      </div>
    </>
  );
}

function visiblePickerCandidates(
  picker: PickerState,
  selected: PickerCandidate
): PickerCandidate[] {
  if (picker.candidates.length <= MAX_PICKER_CRUMBS) {
    return picker.candidates;
  }
  if (picker.selectedIndex < MAX_PICKER_CRUMBS) {
    return picker.candidates.slice(0, MAX_PICKER_CRUMBS);
  }
  return [...picker.candidates.slice(0, MAX_PICKER_CRUMBS - 1), selected];
}

type ComposerPanelStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function ComposerPanel({
  target,
  clickPoint,
  text,
  textareaRef,
  agentModel,
  onAgentModelChange,
  onTextChange,
  onCancel,
  onSubmit,
  onSaved,
}: {
  target: HTMLElement;
  clickPoint: { x: number; y: number };
  text: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  agentModel: OverlayModel;
  onAgentModelChange: (model: OverlayModel) => void;
  onTextChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: (opts: {
    runAgent: boolean;
    versionCount: number;
    model: OverlayModel;
  }) => Promise<ComposerSubmitResult>;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ComposerPanelStatus>({ kind: "idle" });
  const [mode, setMode] = useState<ComposerMode>("agent");
  const [versionCount, setVersionCount] = useState(DEFAULT_AGENT_VERSION_COUNT);

  // Anchor the composer panel to the user's click point, not to the target
  // element's bounding box — for page-wide elements whose `bottom` is below
  // the viewport, anchoring to the element would push the panel off-screen.
  // Estimated panel height covers header + composer.
  const viewportW = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 768 : window.innerHeight;
  const ESTIMATED_PANEL_HEIGHT = 220;
  const desiredLeft = clickPoint.x - PANEL_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(desiredLeft, viewportW - PANEL_WIDTH - VIEWPORT_PADDING)
  );
  // Prefer placing below the click point; if the click is near the viewport
  // bottom and the panel would clip, flip above.
  const desiredTop = clickPoint.y + 12;
  const top =
    desiredTop + ESTIMATED_PANEL_HEIGHT + VIEWPORT_PADDING > viewportH
      ? Math.max(VIEWPORT_PADDING, clickPoint.y - ESTIMATED_PANEL_HEIGHT - 12)
      : desiredTop;

  const submitting = status.kind === "saving";

  // Escape cancels the panel. Registered on the document because the global
  // overlay keydown ignores keys while a text input is focused, and the
  // composer textarea holds focus here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const submit = async () => {
    if (submitting || status.kind === "saved" || !text.trim()) {
      return;
    }
    setStatus({ kind: "saving" });
    let result: ComposerSubmitResult;
    try {
      result = await onSubmit({
        runAgent: mode === "agent",
        versionCount,
        model: agentModel,
      });
    } catch (err) {
      setStatus({ kind: "error", message: toErrorMessage(err) });
      return;
    }
    if (result.ok) {
      setStatus({ kind: "saved" });
      onSaved();
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  };

  return (
    <div
      className="pointer-events-auto fixed z-[9300] flex flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
      data-comment-overlay="true"
      data-testid="design-crit-composer-panel"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left, top, width: PANEL_WIDTH }}
    >
      {/* Header — orients the user: what they're doing (left), which element
          the note is anchored to (middle), and a way out (right). */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b pr-1 pl-3.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <SquareDashedMousePointer
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          />
          <span className="font-medium text-foreground text-xs">
            New comment
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <span
            className="max-w-[150px] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground leading-none"
            title={describeElement(target)}
          >
            {describeElement(target)}
          </span>
          <HotkeyTip keys="Esc" label="Cancel">
            <Button
              aria-label="Cancel"
              className="h-7 w-7 shrink-0"
              disabled={submitting}
              onClick={onCancel}
              size="icon"
              type="button"
              variant="ghost"
            >
              <X className="h-4 w-4" />
            </Button>
          </HotkeyTip>
        </div>
      </div>

      <CommentComposerBar
        agentModel={agentModel}
        agentVersionCount={versionCount}
        busy={submitting}
        error={status.kind === "error" ? status.message : null}
        iterating={false}
        mode={mode}
        onAgentModelChange={onAgentModelChange}
        onAgentVersionCountChange={setVersionCount}
        onChange={onTextChange}
        onModeChange={setMode}
        onSubmit={() => {
          submit().catch(ignorePromiseRejection);
        }}
        textareaRef={textareaRef}
        value={text}
      />
    </div>
  );
}

function describeElement(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) {
    return aria;
  }
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    return `${tag} #${el.id}`;
  }
  const testId = el.getAttribute("data-testid");
  if (testId) {
    return `${tag} · ${testId}`;
  }
  return tag;
}

/** Maps a key to an ancestor-walk step: +1 toward parent, -1 toward child, 0 otherwise. */
function walkDirection(key: string): number {
  if (key === "ArrowUp" || key === "[") {
    return 1;
  }
  if (key === "ArrowDown" || key === "]") {
    return -1;
  }
  return 0;
}

/** Maps a key to a sibling step: +1 next, -1 previous, 0 otherwise. */
function siblingDirection(key: string): number {
  if (key === "ArrowRight") {
    return 1;
  }
  if (key === "ArrowLeft") {
    return -1;
  }
  return 0;
}

/** Source-locatable elements from `start` up through its ancestors (deepest first). */
function ancestorStack(start: Element): HTMLElement[] {
  const picked: HTMLElement[] = [];
  const add = (node: Element | null) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const sourceEl = findSourceLoc(node)?.element;
    if (
      !sourceEl ||
      isOverlayElement(sourceEl) ||
      sourceEl === document.body ||
      sourceEl === document.documentElement ||
      picked.includes(sourceEl)
    ) {
      return;
    }
    picked.push(sourceEl);
  };
  let cur: Element | null = start;
  while (cur) {
    add(cur);
    cur = cur.parentElement;
  }
  return picked;
}

/** Returns source-locatable elements from the topmost hit up through ancestors. */
function pickTargetStack(x: number, y: number): HTMLElement[] {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!isOverlayElement(node)) {
      return ancestorStack(node);
    }
  }
  return [];
}

/**
 * The source-locatable siblings of `el` reachable by stepping `direction`
 * (+1 next / -1 previous), returned as a fresh ancestor stack rooted at the
 * chosen sibling. Only DOM siblings that are *themselves* a source node count
 * (wrappers that resolve to an ancestor are skipped), and the step clamps at
 * the ends. Returns null when there's nowhere to go.
 */
function siblingStack(
  el: HTMLElement,
  direction: number
): HTMLElement[] | null {
  const parent = el.parentElement;
  if (!parent) {
    return null;
  }
  const sibs: HTMLElement[] = [];
  for (const child of Array.from(parent.children)) {
    if (
      child instanceof HTMLElement &&
      !isOverlayElement(child) &&
      findSourceLoc(child)?.element === child
    ) {
      sibs.push(child);
    }
  }
  const i = sibs.indexOf(el);
  if (i < 0 || sibs.length < 2) {
    return null;
  }
  const next = sibs[Math.min(Math.max(i + direction, 0), sibs.length - 1)];
  return next === el ? null : ancestorStack(next);
}

/** Snapshot an element's geometry + label into a picker candidate. */
function toCandidate(el: HTMLElement): PickerCandidate {
  const rect = el.getBoundingClientRect();
  const label = describeElement(el);
  return {
    el,
    key: `${label}:${el.getAttribute("data-source-loc") ?? ""}:${rect.left}:${rect.top}:${rect.width}:${rect.height}`,
    label,
    occurrenceRects: findSourceOccurrenceRects(el),
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
  };
}

function liveCandidateElement(
  candidate: PickerCandidate,
  point: { x: number; y: number }
): HTMLElement | null {
  if (candidate.el.isConnected) {
    return candidate.el;
  }

  const sourceLoc = candidate.el.getAttribute("data-source-loc");
  if (!sourceLoc) {
    return null;
  }
  const matches = document.querySelectorAll<HTMLElement>(
    `[data-source-loc="${cssEscape(sourceLoc)}"]`
  );
  const liveMatches = Array.from(matches).filter(
    (match) => !isOverlayElement(match)
  );
  return (
    liveMatches.find((match) => {
      const rect = match.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    }) ??
    liveMatches[0] ??
    null
  );
}

function findSourceOccurrenceRects(
  el: HTMLElement
): PickerCandidate["occurrenceRects"] {
  const sourceLoc = el.getAttribute("data-source-loc");
  if (!sourceLoc) {
    return [rectSnapshot(el.getBoundingClientRect())];
  }
  const matches = document.querySelectorAll<HTMLElement>(
    `[data-source-loc="${cssEscape(sourceLoc)}"]`
  );
  return Array.from(matches)
    .filter((match) => !isOverlayElement(match))
    .map((match) => rectSnapshot(match.getBoundingClientRect()))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function rectSnapshot(rect: DOMRect): PickerCandidate["rect"] {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameRect(a: PickerCandidate["rect"], b: PickerCandidate["rect"]) {
  return (
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.height === b.height
  );
}

function rectKey(rect: PickerCandidate["rect"]): string {
  return `${rect.left}:${rect.top}:${rect.width}:${rect.height}`;
}

/** Returns the topmost raw DOM hit so capture mode can suppress app clicks. */
function pickHitTarget(x: number, y: number): HTMLElement | null {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (isOverlayElement(node)) {
      continue;
    }
    return node;
  }
  return null;
}

function ensureAnchor(el: HTMLElement): string {
  const existing = el.getAttribute("data-comment-anchor");
  if (existing) {
    return existing;
  }
  const uuid = randomUuid();
  el.setAttribute("data-comment-anchor", uuid);
  return uuid;
}

async function captureElementScreenshot(
  el: HTMLElement
): Promise<string | undefined> {
  return (
    (await captureElementToPng(
      el,
      "[CommentComposer] screenshot capture failed; submitting without it"
    )) ?? undefined
  );
}

function randomUuid(): string {
  return crypto.randomUUID();
}
