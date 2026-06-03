import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FIX_VERSION_COUNT } from "../../shared/fix-version-count.ts";
import {
  loadSettings,
  type OverlaySettings,
  saveSettings,
} from "../settings.ts";
import type { CommentData } from "../types.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { CommentBubble } from "./comment-bubble.tsx";
import {
  CommentComposer,
  type ComposerSubmission,
  type ComposerSubmitResult,
} from "./comment-composer.tsx";
import type { DotInstanceTarget } from "./comment-dot.tsx";
import { CommentDot } from "./comment-dot.tsx";
import { CommentManagementPanel } from "./comment-management-panel.tsx";
import { CommentSettingsPanel } from "./comment-settings-panel.tsx";
import { CommentShell, type ShellTab } from "./comment-shell.tsx";
import {
  findAnchorInstanceRect,
  useAnchorRects,
} from "./hooks/use-anchor-element.ts";
import { useViewport } from "./hooks/use-viewport.ts";
import { useViteHmrReload } from "./hooks/use-vite-hmr-reload.ts";
import { deleteComment, patchComment } from "./lib/api.ts";
import { currentAppRoute, getCommentAuthor } from "./lib/comment-author.ts";
import {
  appendReply,
  removeComment,
  removeReply,
  toggleCommentResolved,
  updateCommentText,
  updateReply,
} from "./lib/comment-mutations.ts";
import { ignorePromiseRejection } from "./lib/ignore-promise-rejection.ts";
import { isOverlayElement } from "./lib/overlay-dom.ts";
import { handleOverlayGlobalKeydown } from "./lib/overlay-global-keydown.ts";
import { dotRect, placeFloater } from "./lib/placement.ts";
import { submitComment } from "./lib/submit-comment.ts";
import { OverlayDock } from "./overlay-dock.tsx";

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
  /**
   * Set when a comment is created in Agent mode: once its bubble auto-opens
   * (via `pendingOpenId`), the bubble runs the agent once with `count`
   * variants. Cleared as soon as the bubble fires the run.
   */
  const [pendingFix, setPendingFix] = useState<{
    id: string;
    count: number;
  } | null>(null);
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
  const reloadComments = useCallback(async () => {
    try {
      const res = await fetch("/api/comments");
      if (!res.ok) {
        setComments([]);
        return;
      }
      const body = (await res.json()) as { comments?: CommentData[] };
      setComments(body.comments ?? []);
    } catch {
      setComments([]);
    }
  }, []);

  useEffect(() => {
    reloadComments().catch(ignorePromiseRejection);
  }, [reloadComments]);

  useViteHmrReload(reloadComments);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      handleOverlayGlobalKeydown(e, {
        composerActive,
        enabled: settings.enabled,
        openTarget,
        setComposerActive,
        toggleShell,
      });
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
    for (const el of nodes) {
      const v = el.getAttribute("data-comment-anchor");
      if (v) {
        next.add(v);
      }
    }
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
      const target = e.target instanceof Element ? e.target : null;
      if (isOverlayElement(target)) {
        return;
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
      const result = await submitComment(entry);
      if (!result.ok) {
        return result.result;
      }
      if (result.id) {
        setPendingOpenId(result.id);
        if (entry.runAgent) {
          setPendingFix({
            id: result.id,
            count: entry.versionCount ?? DEFAULT_FIX_VERSION_COUNT,
          });
        }
      }
      window.setTimeout(() => {
        setComposerActive(false);
      }, 650);
      return { ok: true };
    },
    []
  );

  const handleEdit = useCallback(async (id: string, text: string) => {
    let snapshot: CommentData[] = [];
    setComments((prev) => {
      snapshot = prev;
      return updateCommentText(prev, id, text);
    });
    try {
      await patchComment(id, { text });
    } catch (err) {
      setComments(snapshot);
      throw err;
    }
  }, []);

  const handleSubmitReply = useCallback(
    async (id: string, text: string, v?: number) => {
      const author = getCommentAuthor();
      const optimisticReply = {
        text,
        author,
        date: new Date().toISOString(),
        ...(v === undefined ? {} : { v }),
      };
      let snapshot: CommentData[] = [];
      setComments((prev) => {
        snapshot = prev;
        return appendReply(prev, id, optimisticReply);
      });
      try {
        await patchComment(id, {
          reply: {
            text,
            author,
            ...(v === undefined ? {} : { v }),
          },
        });
      } catch (err) {
        setComments(snapshot);
        throw err;
      }
    },
    []
  );

  const handleEditReply = useCallback(
    async (id: string, replyIndex: number, text: string) => {
      let snapshot: CommentData[] = [];
      setComments((prev) => {
        snapshot = prev;
        return updateReply(prev, id, replyIndex, text);
      });
      try {
        await patchComment(id, { editReply: { index: replyIndex, text } });
      } catch (err) {
        setComments(snapshot);
        throw err;
      }
    },
    []
  );

  const handleDeleteReply = useCallback(
    async (id: string, replyIndex: number) => {
      let snapshot: CommentData[] = [];
      setComments((prev) => {
        snapshot = prev;
        return removeReply(prev, id, replyIndex);
      });
      try {
        await patchComment(id, { deleteReply: { index: replyIndex } });
      } catch (err) {
        setComments(snapshot);
        throw err;
      }
    },
    []
  );

  const handleResolve = useCallback(async (id: string) => {
    let snapshot: CommentData[] = [];
    let nextResolved = false;
    setComments((prev) => {
      snapshot = prev;
      const current = prev.find((c) => c.id === id);
      nextResolved = !(current?.resolved ?? false);
      return toggleCommentResolved(prev, id, nextResolved);
    });
    try {
      await patchComment(id, { resolved: nextResolved });
    } catch (err) {
      setComments(snapshot);
      throw err;
    }
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

      const currentRoute = currentAppRoute() ?? "";

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
    async (id: string, options?: { revertBaseline?: boolean }) => {
      let snapshot: CommentData[] = [];
      setComments((prev) => {
        snapshot = prev;
        return removeComment(prev, id);
      });
      setOpenTarget((prev) => {
        if (!prev) {
          return prev;
        }
        const stillThere = snapshot.some(
          (c) => c.id !== id && c.anchor === prev.anchor
        );
        return stillThere ? prev : null;
      });
      try {
        await deleteComment(id, options);
      } catch (err) {
        setComments(snapshot);
        throw err;
      }
    },
    []
  );

  const visibleAnchors = useMemo(() => {
    if (!settings.hideResolved) {
      return anchors;
    }
    return anchors.filter((anchor) => {
      const group = grouped.get(anchor) ?? [];
      return !group.every((c) => c.resolved);
    });
  }, [anchors, grouped, settings.hideResolved]);

  useEffect(() => {
    if (!(settings.hideResolved && openTarget)) {
      return;
    }
    const group = grouped.get(openTarget.anchor) ?? [];
    if (group.length > 0 && group.every((c) => c.resolved)) {
      setOpenTarget(null);
    }
  }, [settings.hideResolved, openTarget, grouped]);

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-0 z-[9000]"
        data-comment-overlay="true"
        data-redline-overlay-root="true"
      >
        {settings.enabled
          ? visibleAnchors.map((anchor) => (
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
            autoFix={pendingFix}
            comments={grouped.get(openTarget.anchor) ?? []}
            fixModel={settings.model}
            onAutoFixStarted={() => setPendingFix(null)}
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
                hideResolved={settings.hideResolved}
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
  const instances = useAnchorRects(target.anchor);
  const rect = findAnchorInstanceRect(instances, target.instance);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: PREVIEW_WIDTH, height: 72 });
  const viewport = useViewport();

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

function OpenBubble({
  target,
  comments,
  fixModel,
  skipDeleteConfirmation,
  autoFix,
  onAutoFixStarted,
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
  autoFix: { id: string; count: number } | null;
  onAutoFixStarted: () => void;
  onClose: () => void;
  onResolve: (id: string) => void | Promise<void>;
  onDelete: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onSubmitReply: (id: string, text: string, v?: number) => Promise<void>;
  onEditReply: (id: string, replyIndex: number, text: string) => Promise<void>;
  onDeleteReply: (id: string, replyIndex: number) => Promise<void>;
}) {
  const instances = useAnchorRects(target.anchor);
  const rect = findAnchorInstanceRect(instances, target.instance);
  if (!rect) {
    // Anchor not in DOM — future: render a "removed in v<n>" floater.
    return null;
  }
  // Only auto-run the agent when the pending fix matches the open comment.
  const lead = comments[0];
  const autoFixCount =
    autoFix && lead?.id === autoFix.id ? autoFix.count : null;
  return (
    <CommentBubble
      autoFixCount={autoFixCount}
      comments={comments}
      fixModel={fixModel}
      onAutoFixStarted={onAutoFixStarted}
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

export type { OverlaySettings } from "../settings.ts";
export type {
  CommentData,
  CommentProps,
  CommentReply,
  RegisteredComment,
} from "../types.ts";
