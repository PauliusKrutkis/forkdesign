import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadSettings,
  type OverlaySettings,
  saveSettings,
} from "../settings.ts";
import type { CommentData } from "../types.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { CommentBubble } from "./CommentBubble";
import {
  CommentComposer,
  type ComposerSubmission,
  type ComposerSubmitResult,
} from "./CommentComposer";
import type { DotInstanceTarget } from "./CommentDot";
import { CommentDot } from "./CommentDot";
import { CommentManagementPanel } from "./CommentManagementPanel";
import { CommentSettingsPanel } from "./CommentSettingsPanel";
import { CommentShell, type ShellTab } from "./CommentShell";
import { useAnchorRects } from "./hooks/useAnchorElement.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";
import { findSourceLoc } from "./lib/sourceLoc.ts";
import { OverlayDock } from "./OverlayDock";

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
export interface CommentOverlayProps {
  /**
   * Resolve a source file to an app route for legacy comments without a stored
   * `route` attribute.
   */
  fileToRoute?: (file: string, ctx: { view?: string | null }) => string | null;
  /** React Router `navigate`, or any in-app navigation fn. Falls back to full page load. */
  navigate?: (to: string) => void;
}

export function CommentOverlay({
  navigate: navigateProp,
  fileToRoute,
}: CommentOverlayProps = {}) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [openTarget, setOpenTarget] = useState<DotInstanceTarget | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<DotInstanceTarget | null>(
    null
  );
  const [composerActive, setComposerActive] = useState(false);
  const [shell, setShell] = useState<ShellTab | null>(null);
  /**
   * User-visible overlay settings: enabled flag, toggle corner, author
   * override, AI model. Persisted to localStorage; loaded once on
   * mount, then mirrored back on every change.
   */
  const [settings, setSettings] = useState<OverlaySettings>(() =>
    loadSettings()
  );
  /**
   * Anchors currently present in the DOM. Recomputed whenever the comments
   * list changes (a freshly-written comment may bring new
   * `data-comment-anchor` attributes). Drives the on-page vs orphaned split
   * in the management panel.
   */
  const [inDomAnchors, setInDomAnchors] = useState<Set<string>>(
    () => new Set()
  );
  /**
   * After a successful composer submit, the new comment lands in source via
   * HMR. We capture its id here so once the next /api/comments fetch returns
   * with the new comment included, we auto-open its bubble — saves the user
   * a mouse trip to click the newly-appeared dot.
   */
  const [pendingOpenId, setPendingOpenId] = useState<string | null>(null);
  /** After navigation, open the bubble once the anchor appears in the DOM. */
  const [pendingOpen, setPendingOpen] = useState<{
    anchor: string;
    view?: string | null;
  } | null>(null);

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
          if (!cancelled) {
            setComments([]);
          }
          return;
        }
        const body = (await res.json()) as { comments?: CommentData[] };
        if (!cancelled) {
          setComments(body.comments ?? []);
        }
      } catch {
        if (!cancelled) {
          setComments([]);
        }
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
    if (!pendingOpenId) {
      return;
    }
    const c = comments.find((x) => x.id === pendingOpenId);
    if (c) {
      setOpenTarget({ anchor: c.anchor, instance: 0 });
      setPendingOpenId(null);
    }
  }, [comments, pendingOpenId]);

  useEffect(() => {
    if (!pendingOpen) {
      return;
    }
    if (!inDomAnchors.has(pendingOpen.anchor)) {
      return;
    }
    setOpenTarget({ anchor: pendingOpen.anchor, instance: 0 });
    if (pendingOpen.view) {
      scrollToDataView(pendingOpen.view);
    }
    setPendingOpen(null);
    setShell(null);
  }, [pendingOpen, inDomAnchors]);

  const toggleShell = useCallback((tab: ShellTab) => {
    setShell((prev) => (prev === tab ? null : tab));
  }, []);

  // Global hotkeys: `C` composer, `L` list shell, `,` settings shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      if (isInTextInput(document.activeElement)) {
        return;
      }
      if (e.key === ",") {
        e.preventDefault();
        toggleShell("settings");
        return;
      }
      if (!settings.enabled) {
        return;
      }
      if (e.key === "c" || e.key === "C") {
        if (openTarget) {
          return;
        }
        if (composerActive) {
          e.preventDefault();
          setComposerActive(false);
          return;
        }
        e.preventDefault();
        setComposerActive(true);
        return;
      }
      if (e.key === "l" || e.key === "L") {
        if (composerActive || openTarget) {
          return;
        }
        e.preventDefault();
        toggleShell("list");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [composerActive, openTarget, settings.enabled, toggleShell]);

  // Persist settings on change and apply the side-effects that the rest of
  // the overlay reads author via globals when configured.
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Mirror the author override into the global the composer sniffs. Empty
  // string clears the override so the composer falls back to its default.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const w = window as unknown as { __COMMENT_AUTHOR__?: string };
    if (settings.author.trim()) {
      w.__COMMENT_AUTHOR__ = settings.author.trim();
    } else {
      w.__COMMENT_AUTHOR__ = undefined;
    }
  }, [settings.author]);

  // When the system is muted, tear down comment UI that would float with no
  // way to reach it — but keep the settings shell open if the user just
  // toggled comments off from there (otherwise the panel vanishes mid-edit).
  useEffect(() => {
    if (settings.enabled) {
      return;
    }
    setComposerActive(false);
    setShell((prev) => (prev === "settings" ? prev : null));
    setOpenTarget(null);
    setHoveredTarget(null);
    setPendingOpen(null);
  }, [settings.enabled]);

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
      if (v) {
        next.add(v);
      }
    });
    setInDomAnchors(next);
  }, []);

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
    if (!openTarget) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Screenshot lightbox handles its own Escape; don't close the bubble.
        if (document.body.dataset.redlineLightbox === "open") {
          return;
        }
        setOpenTarget(null);
      }
    };
    const onClick = (e: MouseEvent) => {
      let cur: Element | null = e.target instanceof Element ? e.target : null;
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
      // overlay's own infrastructure (e.g. src/dev/) is
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

      const route =
        typeof window === "undefined"
          ? undefined
          : window.location.pathname +
            window.location.search +
            window.location.hash;

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
            ...(entry.screenshotPng
              ? { screenshotPng: entry.screenshotPng }
              : {}),
            ...(route ? { route } : {}),
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
        if (body.id) {
          setPendingOpenId(body.id);
        }
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
    []
  );

  const handleEdit = useCallback(async (id: string, text: string) => {
    const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `request failed (${res.status})`);
    }
  }, []);

  const handleSubmitReply = useCallback(
    async (id: string, text: string, v?: number) => {
      const author =
        settings.author.trim() ||
        (typeof window !== "undefined" &&
          (window as unknown as { __COMMENT_AUTHOR__?: unknown })
            .__COMMENT_AUTHOR__ &&
          String(
            (window as unknown as { __COMMENT_AUTHOR__?: unknown })
              .__COMMENT_AUTHOR__
          )) ||
        "dev@local";
      const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reply: {
            text,
            author: String(author),
            ...(v === undefined ? {} : { v }),
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
    },
    [settings.author]
  );

  const handleEditReply = useCallback(
    async (id: string, replyIndex: number, text: string) => {
      const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ editReply: { index: replyIndex, text } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
    },
    []
  );

  const handleDeleteReply = useCallback(
    async (id: string, replyIndex: number) => {
      const res = await fetch(`/api/comments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deleteReply: { index: replyIndex } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
    },
    []
  );

  const handleResolve = useCallback((id: string) => {
    // Resolve toggling lives on disk in a future task; for now this is a
    // no-op stub so the bubble UI stays clickable.
    console.info("[CommentOverlay] resolve (stub)", id);
  }, []);

  const navigateTo = useCallback(
    (to: string) => {
      if (navigateProp) {
        navigateProp(to);
      } else if (typeof window !== "undefined") {
        window.location.assign(to);
      }
    },
    [navigateProp]
  );

  const resolveCommentRoute = useCallback(
    (comment: CommentData & { file?: string }) => {
      if (comment.route) {
        return comment.route;
      }
      const file = comment.file;
      if (!(file && fileToRoute)) {
        return null;
      }
      return fileToRoute(file, { view: comment.view });
    },
    [fileToRoute]
  );

  const handleJump = useCallback(
    (target: { anchor: string; instance: number }) => {
      const c = comments.find((x) => x.anchor === target.anchor);
      if (c?.view) {
        scrollToDataView(c.view);
      }
      setOpenTarget(target);
      setShell(null);
    },
    [comments]
  );

  const handleGoToPage = useCallback(
    (comment: CommentData & { file?: string }) => {
      const route = resolveCommentRoute(comment);
      if (!route) {
        return;
      }

      const currentRoute =
        typeof window === "undefined"
          ? ""
          : window.location.pathname +
            window.location.search +
            window.location.hash;

      setShell(null);
      setPendingOpen({
        anchor: comment.anchor,
        view: comment.view,
      });

      if (route === currentRoute) {
        if (inDomAnchors.has(comment.anchor)) {
          handleJump({ anchor: comment.anchor, instance: 0 });
          setPendingOpen(null);
        } else if (comment.view) {
          scrollToDataView(comment.view);
        }
        return;
      }

      navigateTo(route);
    },
    [resolveCommentRoute, inDomAnchors, handleJump, navigateTo]
  );

  const handleDelete = useCallback(
    async (id: string) => {
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
        if (!prev) {
          return prev;
        }
        const stillThere = comments.some(
          (c) => c.id !== id && c.anchor === prev.anchor
        );
        return stillThere ? prev : null;
      });
    },
    [comments]
  );

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-0 z-[9000]"
        data-comment-overlay="true"
        data-redline-overlay-root="true"
      >
        {settings.enabled
          ? anchors.map((anchor) => (
              <CommentDot
                anchor={anchor}
                comments={grouped.get(anchor) ?? []}
                key={anchor}
                onHover={setHoveredTarget}
                onOpen={(target) =>
                  setOpenTarget((prev) =>
                    prev &&
                    prev.anchor === target.anchor &&
                    prev.instance === target.instance
                      ? null
                      : target
                  )
                }
                openTarget={openTarget}
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
            comments={grouped.get(hoveredTarget.anchor) ?? []}
            target={hoveredTarget}
          />
        ) : null}

        {/* Open bubble. */}
        {settings.enabled && openTarget ? (
          <OpenBubble
            comments={grouped.get(openTarget.anchor) ?? []}
            fixModel={settings.model}
            onClose={() => setOpenTarget(null)}
            onDelete={handleDelete}
            onDeleteReply={handleDeleteReply}
            onEdit={handleEdit}
            onEditReply={handleEditReply}
            onResolve={handleResolve}
            onSubmitReply={handleSubmitReply}
            skipDeleteConfirmation={settings.skipDeleteConfirmation}
            target={openTarget}
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

        <OverlayDock
          composerActive={composerActive}
          enabled={settings.enabled}
          onPageCount={
            comments.filter((c) => inDomAnchors.has(c.anchor)).length
          }
          onToggleComposer={() => setComposerActive((v) => !v)}
          onToggleEnabled={() => updateSettings({ enabled: !settings.enabled })}
          onToggleList={() => toggleShell("list")}
          onToggleSettings={() => toggleShell("settings")}
          position={settings.position}
          shell={shell}
          show={settings.showFloatingControls}
          totalCount={comments.length}
        />

        {shell ? (
          <CommentShell
            listSubtitle={
              shell === "list"
                ? (() => {
                    const onPage = comments.filter((c) =>
                      inDomAnchors.has(c.anchor)
                    ).length;
                    return `${comments.length} total · ${onPage} on this page`;
                  })()
                : undefined
            }
            onClose={() => setShell(null)}
            onTabChange={setShell}
            tab={shell}
          >
            {shell === "list" ? (
              <CommentManagementPanel
                comments={comments}
                fileToRoute={fileToRoute}
                inDomAnchors={inDomAnchors}
                onDelete={handleDelete}
                onGoToPage={handleGoToPage}
                onJump={handleJump}
              />
            ) : (
              <CommentSettingsPanel
                onChange={updateSettings}
                settings={settings}
              />
            )}
          </CommentShell>
        ) : null}
      </div>
    </TooltipProvider>
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
    if (!el) {
      return;
    }
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
    if (!rect) {
      return null;
    }
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

  if (!(rect && lead && position)) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed z-[9150] rounded-md border bg-popover p-2.5 text-popover-foreground shadow-md"
      data-comment-overlay="true"
      ref={previewRef}
      role="tooltip"
      style={{ left: position.left, top: position.top, width: PREVIEW_WIDTH }}
    >
      <p className="m-0 truncate text-muted-foreground text-xs">
        {lead.author}
      </p>
      <p className="m-0 mt-1 truncate text-sm">{lead.text}</p>
      {comments.length > 1 ? (
        <p className="m-0 mt-1 text-muted-foreground text-xs">
          +{comments.length - 1} more
        </p>
      ) : null}
    </div>
  );
}

function readViewport() {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Hotkeys should never fire while the user is typing into a textarea,
 * input, or contenteditable. Centralised here so all keymap surfaces use
 * the same definition.
 */
function isInTextInput(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    return true;
  }
  return false;
}

function OpenBubble({
  target,
  comments,
  fixModel,
  skipDeleteConfirmation,
  onClose,
  onResolve,
  onDelete,
  onEdit,
  onSubmitReply,
  onEditReply,
  onDeleteReply,
}: {
  target: DotInstanceTarget;
  comments: CommentData[];
  fixModel: OverlaySettings["model"];
  skipDeleteConfirmation: boolean;
  onClose: () => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onSubmitReply: (id: string, text: string, v?: number) => Promise<void>;
  onEditReply: (id: string, replyIndex: number, text: string) => Promise<void>;
  onDeleteReply: (id: string, replyIndex: number) => Promise<void>;
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
      fixModel={fixModel}
      onClose={onClose}
      onDelete={onDelete}
      onDeleteReply={onDeleteReply}
      onEdit={onEdit}
      onEditReply={onEditReply}
      onResolve={onResolve}
      onSubmitReply={onSubmitReply}
      rect={rect}
      skipDeleteConfirmation={skipDeleteConfirmation}
    />
  );
}

function scrollToDataView(view: string) {
  if (typeof document === "undefined") {
    return;
  }
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(view)
      : view.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  document
    .querySelector(`[data-view="${escaped}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
