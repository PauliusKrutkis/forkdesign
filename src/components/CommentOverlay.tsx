import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommentData } from "./types";
import { CommentDot } from "./CommentDot";
import { CommentBubble } from "./CommentBubble";
import {
  CommentComposer,
  type ComposerSubmission,
  type ComposerSubmitResult,
} from "./CommentComposer";
import { CommentManagementPanel } from "./CommentManagementPanel";
import { CommentSettingsPanel } from "./CommentSettingsPanel";
import { Kbd } from "./Kbd";
import { useAnchorRects } from "./useAnchorElement";
import type { DotInstanceTarget } from "./CommentDot";
import { findSourceLoc } from "./sourceLoc";
import { dotRect, placeFloater } from "./placement";
import {
  loadSettings,
  saveSettings,
  POSITION_CLASSES,
  type OverlaySettings,
} from "./settings";

/**
 * Top-level comment overlay. Mounted once globally in App.tsx, guarded by
 * `import.meta.env.DEV` so production builds tree-shake the whole module.
 *
 * Responsibilities:
 *   - Bulk-fetch parsed `{/* @comment ... *\/}` markers across all allowed
 *     `.tsx` files in `src/` via `GET /api/comments`. The Vite plugin reads
 *     them straight off disk, so this is the single source of truth.
 *   - Re-fetch on Vite HMR `vite:afterUpdate` events so a fresh write lands
 *     in the overlay within one HMR cycle.
 *   - Group comments by anchor uuid; render one CommentDot per group.
 *   - Track which group (if any) is open and render its CommentBubble.
 *   - Provide a floating "Comment" toggle that activates the composer.
 *
 * No local mock state: comments live on disk; HMR is the round-trip
 * mechanism. The composer POSTs and waits for the file write to flow back
 * through the next /api/comments fetch.
 */
export function CommentOverlay() {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [openTarget, setOpenTarget] = useState<DotInstanceTarget | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<DotInstanceTarget | null>(
    null,
  );
  const [composerActive, setComposerActive] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * User-visible overlay settings: enabled flag, toggle corner, theme,
   * author override, AI model. Persisted to localStorage; loaded once on
   * mount, then mirrored back on every change.
   */
  const [settings, setSettings] = useState<OverlaySettings>(() =>
    loadSettings(),
  );
  /**
   * Anchors currently present in the DOM. Recomputed whenever the comments
   * list changes (a freshly-written comment may bring new
   * `data-comment-anchor` attributes). Drives the on-page vs orphaned split
   * in the management panel.
   */
  const [inDomAnchors, setInDomAnchors] = useState<Set<string>>(() => new Set());
  /**
   * After a successful composer submit, the new comment lands in source via
   * HMR. We capture its id here so once the next /api/comments fetch returns
   * with the new comment included, we auto-open its bubble — saves the user
   * a mouse trip to click the newly-appeared dot.
   */
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);

  // Bulk-fetch comments across ALL allowed .tsx files in src/, then re-fetch
  // on every Vite HMR update so a freshly-written marker shows up without a
  // full reload. Bulk mode means comments anchored in shared components
  // (e.g., PrototypeCard) appear regardless of which page is currently shown.
  // Dots only render for anchors whose elements are in the current DOM, so
  // the visual result is naturally page-scoped.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/comments");
        if (!res.ok) {
          if (!cancelled) setComments([]);
          return;
        }
        const body = (await res.json()) as { comments?: CommentData[] };
        if (!cancelled) setComments(body.comments ?? []);
      } catch {
        if (!cancelled) setComments([]);
      }
    };
    void load();

    // import.meta.hot exists in Vite dev; production builds tree-shake the
    // overlay entirely so this branch isn't reachable in prod.
    if (import.meta.hot) {
      const handler = () => void load();
      import.meta.hot.on("vite:afterUpdate", handler);
      return () => {
        cancelled = true;
        import.meta.hot?.off("vite:afterUpdate", handler);
      };
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // After a successful submit, watch for the new comment to appear in the
  // refetched list, then auto-open its bubble. Clears the pending id once
  // satisfied. If the comment never appears (e.g., parse error), the id
  // remains pending harmlessly — it'll resolve on the next user-triggered
  // refetch or get cleared on unmount.
  useEffect(() => {
    if (!pendingOpenId) return;
    const c = comments.find((x) => x.id === pendingOpenId);
    if (c) {
      setOpenTarget({ anchor: c.anchor, instance: 0 });
      setPendingOpenId(null);
    }
  }, [comments, pendingOpenId]);

  // Global hotkeys: `C` toggles composer mode, `L` toggles the management
  // list, `,` toggles settings — all only when not in an input. `C`/`L`
  // additionally skip when a bubble is open. `Esc` is handled per-surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isInTextInput(document.activeElement)) return;
      if (e.key === ",") {
        // Settings is the one hotkey that works even when comments are
        // disabled — it's the only way back in.
        e.preventDefault();
        setSettingsOpen((v) => !v);
        return;
      }
      // Everything below this point is muted when the system is off.
      if (!settings.enabled) return;
      if (e.key === "c" || e.key === "C") {
        if (composerActive || openTarget) return;
        e.preventDefault();
        setComposerActive(true);
        return;
      }
      if (e.key === "l" || e.key === "L") {
        if (composerActive || openTarget) return;
        e.preventDefault();
        setManagementOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composerActive, openTarget, settings.enabled]);

  // Persist settings on change and apply the side-effects that the rest of
  // the overlay reads via globals (author) or className gating (theme).
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Mirror the author override into the global the composer sniffs. Empty
  // string clears the override so the composer falls back to its default.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { __COMMENT_AUTHOR__?: string };
    if (settings.author.trim()) {
      w.__COMMENT_AUTHOR__ = settings.author.trim();
    } else {
      delete w.__COMMENT_AUTHOR__;
    }
  }, [settings.author]);

  // When the system is muted we also close any UI that might still be open
  // — otherwise the user could toggle off mid-edit and leave a ghost
  // composer floating with no way to dismiss it (Esc still works, but this
  // is friendlier).
  useEffect(() => {
    if (settings.enabled) return;
    setComposerActive(false);
    setManagementOpen(false);
    setOpenTarget(null);
    setHoveredTarget(null);
  }, [settings.enabled]);

  /** Resolve theme=auto by reading the OS preference. */
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const darkActive =
    settings.theme === "dark" ||
    (settings.theme === "auto" && systemDark);

  const updateSettings = useCallback((patch: Partial<OverlaySettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  // Recompute the set of in-DOM anchor uuids whenever the comments list
  // changes. A MutationObserver would be more reactive but the bulk list is
  // already keyed off HMR, so this scoped scan matches the existing model.
  useEffect(() => {
    if (typeof document === "undefined") {
      setInDomAnchors(new Set());
      return;
    }
    const nodes = document.querySelectorAll("[data-comment-anchor]");
    const next = new Set<string>();
    nodes.forEach((el) => {
      const v = el.getAttribute("data-comment-anchor");
      if (v) next.add(v);
    });
    setInDomAnchors(next);
  }, [comments]);

  // Group by anchor.
  const grouped = useMemo(() => {
    const map = new Map<string, CommentData[]>();
    for (const c of comments) {
      const list = map.get(c.anchor) ?? [];
      list.push(c);
      map.set(c.anchor, list);
    }
    // Sort each anchor's list newest-first for predictable lead comment.
    for (const list of map.values()) {
      list.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    }
    return map;
  }, [comments]);

  const anchors = useMemo(() => [...grouped.keys()], [grouped]);

  // Close the open bubble on outside-click or Escape.
  useEffect(() => {
    if (!openTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenTarget(null);
    };
    const onClick = (e: MouseEvent) => {
      let cur: Element | null =
        e.target instanceof Element ? e.target : null;
      while (cur) {
        if (
          cur instanceof HTMLElement &&
          cur.dataset.commentOverlay === "true"
        ) {
          return;
        }
        cur = cur.parentElement;
      }
      setOpenTarget(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [openTarget]);

  const handleSubmit = useCallback(
    async (entry: ComposerSubmission): Promise<ComposerSubmitResult> => {
      const src = findSourceLoc(entry.target);
      if (!src) {
        return {
          ok: false,
          error:
            "couldn't locate this element in source. Try a different element.",
        };
      }
      // Path validation is delegated to the plugin's POST handler so the
      // policy lives in one place. Anything under src/*.tsx except the
      // overlay's own infrastructure (src/components/comments/, src/dev/) is
      // accepted there.

      const existingAnchor =
        entry.target.getAttribute("data-comment-anchor") ?? undefined;

      // Sniff author from a global the host app might set. Fall back to a
      // deterministic dev placeholder so the comment file shape stays stable
      // when no override is provided.
      const author =
        (typeof window !== "undefined" &&
          (window as unknown as { __COMMENT_AUTHOR__?: unknown })
            .__COMMENT_AUTHOR__) ||
        "dev@local";

      try {
        const res = await fetch("/api/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            file: src.file,
            line: src.line,
            column: src.column,
            text: entry.text,
            author: String(author),
            ...(existingAnchor ? { existingAnchor } : {}),
            ...(entry.screenshotPng ? { screenshotPng: entry.screenshotPng } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return {
            ok: false,
            error: body.error ?? `request failed (${res.status})`,
          };
        }
        // Capture the new comment's id from the response so we can auto-open
        // its bubble as soon as the next /api/comments fetch returns. The
        // server's POST response shape: { id, anchor, view, date, file }.
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
        };
        if (body.id) setPendingOpenId(body.id);
        // Success: Vite HMR will fire `vite:afterUpdate` once it picks up the
        // file write, the load() effect re-runs, and the new dot appears.
        // Close the composer after the panel finishes its "Saved" pulse.
        window.setTimeout(() => {
          setComposerActive(false);
        }, 650);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network error: ${message}` };
      }
    },
    [],
  );

  const handleReply = useCallback((id: string) => {
    console.info("[CommentOverlay] reply (stub)", id);
  }, []);

  const handleResolve = useCallback((id: string) => {
    // Resolve toggling lives on disk in a future task; for now this is a
    // no-op stub so the bubble UI stays clickable.
    console.info("[CommentOverlay] resolve (stub)", id);
  }, []);

  const handleJump = useCallback(
    (target: { anchor: string; instance: number }) => {
      setOpenTarget(target);
      setManagementOpen(false);
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    // Optimistic: the row will disappear on the next HMR-triggered refetch.
    // Errors propagate to the panel row so the user gets inline feedback
    // instead of a swallowed failure.
    const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `request failed (${res.status})`);
    }
    // If the open bubble was anchored on the deleted comment's anchor, close
    // it. The HMR refetch will reconcile the rest.
    setOpenTarget((prev) => {
      if (!prev) return prev;
      const stillThere = comments.some(
        (c) => c.id !== id && c.anchor === prev.anchor,
      );
      return stillThere ? prev : null;
    });
  }, [comments]);

  return (
    <div
      data-comment-overlay="true"
      className={`pointer-events-none fixed inset-0 z-[9000] ${
        darkActive ? "comment-overlay--dark" : ""
      }`}
      aria-live="polite"
    >
      {settings.enabled
        ? anchors.map((anchor) => (
            <CommentDot
              key={anchor}
              anchor={anchor}
              comments={grouped.get(anchor) ?? []}
              openTarget={openTarget}
              onOpen={(target) =>
                setOpenTarget((prev) =>
                  prev &&
                  prev.anchor === target.anchor &&
                  prev.instance === target.instance
                    ? null
                    : target,
                )
              }
              onHover={setHoveredTarget}
            />
          ))
        : null}

      {/* Hover preview — only when nothing is open, to avoid double layers. */}
      {settings.enabled &&
      hoveredTarget &&
      (!openTarget ||
        hoveredTarget.anchor !== openTarget.anchor ||
        hoveredTarget.instance !== openTarget.instance) ? (
        <HoverPreview
          target={hoveredTarget}
          comments={grouped.get(hoveredTarget.anchor) ?? []}
        />
      ) : null}

      {/* Open bubble. */}
      {settings.enabled && openTarget ? (
        <OpenBubble
          target={openTarget}
          comments={grouped.get(openTarget.anchor) ?? []}
          onClose={() => setOpenTarget(null)}
          onReply={handleReply}
          onResolve={handleResolve}
        />
      ) : null}

      {/* Composer mode is suppressed when comments are off. */}
      {settings.enabled ? (
        <CommentComposer
          active={composerActive}
          onCancel={() => setComposerActive(false)}
          onSubmit={handleSubmit}
        />
      ) : null}

      <OverlayToggle
        enabled={settings.enabled}
        position={settings.position}
        active={composerActive}
        onToggle={() => setComposerActive((v) => !v)}
        listOpen={managementOpen}
        onToggleList={() => setManagementOpen((v) => !v)}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
      />

      {settings.enabled && managementOpen ? (
        <CommentManagementPanel
          comments={comments}
          inDomAnchors={inDomAnchors}
          onJump={handleJump}
          onDelete={handleDelete}
          onClose={() => setManagementOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <CommentSettingsPanel
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

const PREVIEW_WIDTH = 240;

function HoverPreview({
  target,
  comments,
}: {
  target: DotInstanceTarget;
  comments: CommentData[];
}) {
  const rects = useAnchorRects(target.anchor);
  const rect = rects[target.instance] ?? null;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: PREVIEW_WIDTH, height: 72 });
  const [viewport, setViewport] = useState(() => readViewport());

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize);
    };
  }, []);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ width: e.contentRect.width, height: e.contentRect.height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const lead = comments[0];

  const position = useMemo(() => {
    if (!rect) return null;
    // Anchor to the dot's clamped rect (same source of truth as the dot
    // itself), so the preview visually sits next to the handle the user is
    // hovering even when the dot has been pulled inward to stay on-screen.
    return placeFloater({
      anchor: dotRect({ right: rect.right, top: rect.top }, viewport),
      size: { width: PREVIEW_WIDTH, height: size.height },
      preferredSide: "right",
      viewport,
      padding: 12,
      gap: 8,
      arrowSafePadding: 12,
    });
  }, [rect, size.height, viewport]);

  if (!rect || !lead || !position) return null;

  return (
    <div
      ref={previewRef}
      data-comment-overlay="true"
      className="pointer-events-none fixed z-[9150] rounded-[6px] border border-[var(--co-line-strong)] bg-[var(--co-surface)] p-2 shadow"
      style={{ left: position.left, top: position.top, width: PREVIEW_WIDTH }}
      role="tooltip"
    >
      <p className="m-0 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
        {lead.author}
      </p>
      <p className="m-0 mt-1 truncate text-[12px] leading-[1.4] text-[var(--co-ink)]">
        {lead.text}
      </p>
      {comments.length > 1 ? (
        <p className="m-0 mt-1 font-[var(--co-font-mono)] text-[10px] uppercase tracking-[0.06em] text-[var(--co-ink-3)]">
          +{comments.length - 1} more
        </p>
      ) : null}
    </div>
  );
}

function readViewport() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Hotkeys should never fire while the user is typing into a textarea,
 * input, or contenteditable. Centralised here so all keymap surfaces use
 * the same definition.
 */
export function isInTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function OpenBubble({
  target,
  comments,
  onClose,
  onReply,
  onResolve,
}: {
  target: DotInstanceTarget;
  comments: CommentData[];
  onClose: () => void;
  onReply: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const rects = useAnchorRects(target.anchor);
  const rect = rects[target.instance] ?? null;
  if (!rect) {
    // Anchor not in DOM — future: render a "removed in v<n>" floater.
    return null;
  }
  return (
    <CommentBubble
      comments={comments}
      rect={rect}
      onClose={onClose}
      onReply={onReply}
      onResolve={onResolve}
    />
  );
}

function OverlayToggle({
  enabled,
  position,
  active,
  onToggle,
  listOpen,
  onToggleList,
  settingsOpen,
  onToggleSettings,
}: {
  enabled: boolean;
  position: OverlaySettings["position"];
  active: boolean;
  onToggle: () => void;
  listOpen: boolean;
  onToggleList: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  const positionClass = POSITION_CLASSES[position];
  return (
    <div
      data-comment-overlay="true"
      className={`pointer-events-none fixed z-[9400] flex flex-col gap-2 ${positionClass}`}
    >
      {/*
        When the system is muted we collapse the stack to a single small
        gear so the user retains a way back into settings. Everything else
        is hidden.
      */}
      {enabled ? (
        <>
          <button
            type="button"
            onClick={onToggleList}
            aria-pressed={listOpen}
            aria-label="Toggle comment list"
            className={`pointer-events-auto inline-flex items-center gap-2 rounded-[var(--co-radius-pill)] px-4 py-2 font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.08em] shadow-lg transition-colors ${
              listOpen
                ? "bg-[var(--co-sev-info)] text-[var(--co-page)]"
                : "bg-[var(--co-surface)] text-[var(--co-ink)] hover:bg-[var(--co-surface-2)]"
            }`}
          >
            <span
              aria-hidden
              className={`block h-2 w-2 rounded-full ${
                listOpen ? "bg-[var(--co-page)]" : "bg-[var(--co-ink-3)]"
              }`}
            />
            List
            <Kbd>L</Kbd>
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={active}
            className={`pointer-events-auto inline-flex items-center gap-2 rounded-[var(--co-radius-pill)] px-4 py-2 font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.08em] shadow-lg transition-colors ${
              active
                ? "bg-[var(--co-sev-info)] text-[var(--co-page)]"
                : "bg-[var(--co-ink)] text-[var(--co-page)] hover:bg-[var(--co-ink-2)]"
            }`}
          >
            <span
              aria-hidden
              className={`block h-2 w-2 rounded-full ${
                active ? "bg-[var(--co-page)]" : "bg-[var(--co-sev-info)]"
              }`}
            />
            {active ? "Cancel" : "Comment"}
            {active ? null : <Kbd>C</Kbd>}
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={onToggleSettings}
        aria-pressed={settingsOpen}
        aria-label="Toggle comment settings"
        title={enabled ? "Settings" : "Comments hidden — open settings"}
        className={`pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-[var(--co-radius-pill)] shadow-lg transition-colors ${
          settingsOpen
            ? "bg-[var(--co-sev-info)] text-[var(--co-page)]"
            : enabled
              ? "bg-[var(--co-surface)] text-[var(--co-ink-2)] hover:bg-[var(--co-surface-2)]"
              : "bg-[var(--co-ink)] text-[var(--co-page)] hover:bg-[var(--co-ink-2)]"
        }`}
      >
        <span aria-hidden className="text-[14px] leading-none">
          •••
        </span>
      </button>
    </div>
  );
}
