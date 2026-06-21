import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_AGENT_VERSION_COUNT } from "../../shared/agent-version-count.ts";
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
import { cancelAgentIterationRequest } from "./lib/agent-iteration-request.ts";
import { deleteComment, patchComment } from "./lib/api.ts";
import { currentAppRoute, getCommentAuthor } from "./lib/comment-author.ts";
import {
  appendReply,
  removeComment,
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

interface OverlayAgentRun {
  anchor: string;
  cancel?: () => void;
  commentId?: string;
  count: number;
  model: OverlaySettings["model"];
  startedAt: number;
  status?: string;
}

/** After-navigation intent: open this anchor's bubble once it lands in the DOM. */
type PendingOpen = { anchor: string; view?: string | null };

/**
 * When "go to page" has no in-app `navigate` and falls back to a full page
 * load, React state is wiped on reload. Stash the pending-open intent in
 * sessionStorage so the freshly-mounted overlay can pick it up and open the
 * bubble on the destination page.
 */
const PENDING_OPEN_STORAGE_KEY = "redline:pending-open-comment";

/** Read + clear the persisted pending-open intent (one-shot, survives one reload). */
function readPersistedPendingOpen(): PendingOpen | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(PENDING_OPEN_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    window.sessionStorage.removeItem(PENDING_OPEN_STORAGE_KEY);
    const parsed = JSON.parse(raw) as PendingOpen;
    if (parsed && typeof parsed.anchor === "string") {
      return parsed;
    }
  } catch {
    // Malformed/unavailable storage: nothing to restore.
  }
  return null;
}

function persistPendingOpen(pending: PendingOpen): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      PENDING_OPEN_STORAGE_KEY,
      JSON.stringify(pending)
    );
  } catch {
    // Storage unavailable (private mode/quota): degrade to no auto-open.
  }
}

interface ActiveIterationRunResponse {
  runs?: Array<{
    anchor: string;
    commentId: string;
    count: number;
    model: OverlaySettings["model"];
    startedAt: number;
    status?: string;
  }>;
}

export function CommentOverlay({
  navigate: navigateProp,
  fileToRoute,
}: CommentOverlayProps = {}) {
  const [comments, setComments] = useState<CommentData[]>([]);
  const [openTarget, setOpenTarget] = useState<DotInstanceTarget | null>(null);
  const [reanchorRequest, setReanchorRequest] = useState(0);
  const [hoveredTarget, setHoveredTarget] = useState<DotInstanceTarget | null>(
    null
  );
  const [composerActive, setComposerActive] = useState(false);
  // True for the brief cross-fade after a new comment saves: its bubble has
  // opened beneath the composer, which now fades out in place. See the
  // pendingOpenId effect.
  const [composerExiting, setComposerExiting] = useState(false);
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
  const [pendingAgentRun, setPendingAgentRun] = useState<{
    id: string;
    count: number;
    model: OverlaySettings["model"];
  } | null>(null);
  /** In-flight agent run metadata. Kept above the bubble so close/reopen preserves UI state. */
  const [agentRunsByAnchor, setAgentRunsByAnchor] = useState<
    Map<string, OverlayAgentRun>
  >(() => new Map());
  const [activeVersionByComment, setActiveVersionByComment] = useState<
    Map<string, number>
  >(() => new Map());
  /** True while the open thread is docked — its pin is hidden (ring stands in). */
  const [dockedOpen, setDockedOpen] = useState(false);
  /**
   * After navigation, open the bubble once the anchor appears in the DOM.
   * Initialized from sessionStorage so a full-page-reload navigation (no
   * in-app `navigate`) still opens the comment on the destination page.
   */
  const [pendingOpen, setPendingOpen] = useState<PendingOpen | null>(() =>
    readPersistedPendingOpen()
  );

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

  const cancelServerAgentRun = useCallback(async (commentId: string) => {
    await cancelAgentIterationRequest(commentId);
    setAgentRunsByAnchor((prev) => {
      const next = new Map(prev);
      for (const [anchor, run] of next) {
        if (run.commentId === commentId) {
          next.delete(anchor);
        }
      }
      return next;
    });
  }, []);

  const reloadAgentRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/iterations/runs");
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as ActiveIterationRunResponse;
      const serverRuns = body.runs ?? [];
      setAgentRunsByAnchor((prev) => {
        const next = new Map<string, OverlayAgentRun>();
        const serverAnchors = new Set<string>();
        for (const run of serverRuns) {
          serverAnchors.add(run.anchor);
          next.set(run.anchor, {
            ...run,
            cancel: () => {
              cancelServerAgentRun(run.commentId).catch(ignorePromiseRejection);
            },
          });
        }
        for (const [anchor, run] of prev) {
          const startedRecently = Date.now() - run.startedAt < 3000;
          if (!(serverAnchors.has(anchor) || run.commentId)) {
            next.set(anchor, run);
          } else if (!serverAnchors.has(anchor) && startedRecently) {
            next.set(anchor, run);
          }
        }
        return next;
      });
    } catch {
      // Keep the last-known run state on transient dev-server fetch failures.
    }
  }, [cancelServerAgentRun]);

  useEffect(() => {
    reloadComments().catch(ignorePromiseRejection);
    reloadAgentRuns().catch(ignorePromiseRejection);
  }, [reloadComments, reloadAgentRuns]);

  useViteHmrReload(reloadComments);
  useViteHmrReload(reloadAgentRuns);

  useEffect(() => {
    if (agentRunsByAnchor.size === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      reloadAgentRuns().catch(ignorePromiseRejection);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [agentRunsByAnchor.size, reloadAgentRuns]);

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
      // Open the bubble (it mounts beneath the composer, entrance suppressed)
      // and start the cross-fade: the composer fades out on top of it, then a
      // dedicated effect (keyed on composerExiting) tears it down. One panel
      // appears to swap its contents in place, instead of the form vanishing
      // while the comment animates in somewhere else.
      setOpenTarget({ anchor: c.anchor, instance: 0 });
      setComposerExiting(true);
      setPendingOpenId(null);
    }
  }, [comments, pendingOpenId]);

  // Tear the composer down once the cross-fade completes. Keyed only on
  // `composerExiting` so the constant `comments` churn during an agent run
  // can't cancel the timeout mid-fade and leave the composer mounted on top of
  // the bubble (two stacked panels, duplicate controls).
  useEffect(() => {
    if (!composerExiting) {
      return;
    }
    const t = window.setTimeout(() => {
      setComposerActive(false);
      setComposerExiting(false);
    }, 170);
    return () => window.clearTimeout(t);
  }, [composerExiting]);

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

  const syncInDomAnchors = useCallback(() => {
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
    setInDomAnchors((prev) => (setsEqual(prev, next) ? prev : next));
  }, []);

  // Keep the list's on-page rows aligned with the live DOM. This makes rows
  // opened from the `L` hotkey jump straight into their comment bubble after
  // HMR writes, route changes, or delayed renders.
  useEffect(() => {
    syncInDomAnchors();
  }, [syncInDomAnchors]);

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }
    syncInDomAnchors();
    const mutationObserver = new MutationObserver(syncInDomAnchors);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-comment-anchor"],
    });
    return () => mutationObserver.disconnect();
  }, [syncInDomAnchors]);

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
        if (document.body.dataset.lightbox === "open") {
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
          setPendingAgentRun({
            id: result.id,
            count: entry.versionCount ?? DEFAULT_AGENT_VERSION_COUNT,
            model: entry.model ?? settings.model,
          });
        }
        // The composer closes the instant this comment's bubble opens — see the
        // pendingOpenId effect above. Keeping both on one event removes the gap
        // between the comment appearing and the form going away.
      } else {
        // No id to follow to an open bubble; close the composer directly.
        setComposerActive(false);
      }
      return { ok: true };
    },
    [settings.model]
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

  const handleOpenDot = useCallback(
    (target: DotInstanceTarget) => {
      if (
        openTarget &&
        openTarget.anchor === target.anchor &&
        openTarget.instance === target.instance
      ) {
        setReanchorRequest((current) => current + 1);
        return;
      }
      setOpenTarget(target);
    },
    [openTarget]
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

      // Without an in-app navigate, navigateTo does a full page reload that
      // wipes `pendingOpen`. Stash it so the remounted overlay can restore it.
      if (!navigateProp) {
        persistPendingOpen({ anchor: comment.anchor, view: comment.view });
      }
      navigateTo(route);
    },
    [resolveCommentRoute, inDomAnchors, handleJump, navigateTo, navigateProp]
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
        data-overlay-root="true"
      >
        {settings.enabled
          ? visibleAnchors.map((anchor) => (
              <CommentDot
                agentWorking={agentRunsByAnchor.has(anchor)}
                anchor={anchor}
                comments={grouped.get(anchor) ?? []}
                hideOpenInstance={dockedOpen}
                key={anchor}
                onHover={setHoveredTarget}
                onOpen={handleOpenDot}
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
            activeVersionByComment={activeVersionByComment}
            agentModel={settings.model}
            agentRun={agentRunsByAnchor.get(openTarget.anchor) ?? null}
            autoAgent={pendingAgentRun}
            comments={grouped.get(openTarget.anchor) ?? []}
            onActiveVersionChange={(id, active) => {
              setActiveVersionByComment((prev) => {
                if (prev.get(id) === active) {
                  return prev;
                }
                const next = new Map(prev);
                next.set(id, active);
                return next;
              });
            }}
            onAgentModelChange={(model) => updateSettings({ model })}
            onAgentWorkingChange={(anchor, run, cancel) => {
              setAgentRunsByAnchor((prev) => {
                if (!anchor) {
                  return new Map();
                }
                const next = new Map(prev);
                if (run) {
                  next.set(anchor, { anchor, ...run, cancel });
                } else {
                  next.delete(anchor);
                }
                return next;
              });
              reloadAgentRuns().catch(ignorePromiseRejection);
            }}
            onAutoAgentStarted={() => setPendingAgentRun(null)}
            onClose={() => setOpenTarget(null)}
            onDelete={handleDelete}
            onDockedChange={setDockedOpen}
            onEdit={handleEdit}
            onEditReply={handleEditReply}
            onResolve={handleResolve}
            onSubmitReply={handleSubmitReply}
            reanchorRequest={reanchorRequest}
            skipDeleteConfirmation={settings.skipDeleteConfirmation}
            suppressEntrance={composerExiting}
            target={openTarget}
          />
        ) : null}

        {/* Composer mode is suppressed when comments are off. */}
        {settings.enabled ? (
          <CommentComposer
            active={composerActive}
            agentModel={settings.model}
            exiting={composerExiting}
            onAgentModelChange={(model) => updateSettings({ model })}
            onCancel={() => setComposerActive(false)}
            onSubmit={handleSubmit}
          />
        ) : null}

        <OverlayDock
          // Drop the launcher below an open bubble: a floating bubble can land
          // over the dock's corner, and the always-on-top pill would otherwise
          // intercept clicks on the bubble's own controls (e.g. "Stop agent").
          // The launcher stays rendered/clickable wherever the bubble doesn't
          // cover it.
          belowBubble={Boolean(openTarget)}
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
          show={settings.showFloatingControls && !dockedOpen}
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
                agentRunsByAnchor={agentRunsByAnchor}
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

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const item of a) {
    if (!b.has(item)) {
      return false;
    }
  }
  return true;
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
  activeVersionByComment,
  agentRun,
  target,
  comments,
  agentModel,
  onAgentModelChange,
  skipDeleteConfirmation,
  autoAgent,
  onActiveVersionChange,
  onAgentWorkingChange,
  onAutoAgentStarted,
  onClose,
  onDockedChange,
  onResolve,
  onDelete,
  onEdit,
  onSubmitReply,
  onEditReply,
  reanchorRequest,
  suppressEntrance,
}: {
  activeVersionByComment: Map<string, number>;
  agentRun: OverlayAgentRun | null;
  target: DotInstanceTarget;
  comments: CommentData[];
  agentModel: OverlaySettings["model"];
  onAgentModelChange: (model: OverlaySettings["model"]) => void;
  skipDeleteConfirmation: boolean;
  autoAgent: {
    id: string;
    count: number;
    model: OverlaySettings["model"];
  } | null;
  onActiveVersionChange: (id: string, active: number) => void;
  onAgentWorkingChange: (
    anchor: string | null,
    run?: {
      commentId: string;
      count: number;
      model: OverlaySettings["model"];
      startedAt: number;
    },
    cancel?: () => void
  ) => void;
  onAutoAgentStarted: () => void;
  onClose: () => void;
  onDockedChange: (docked: boolean) => void;
  onResolve: (id: string) => void | Promise<void>;
  onDelete: (
    id: string,
    options?: { revertBaseline?: boolean }
  ) => Promise<void>;
  onEdit: (id: string, text: string) => Promise<void>;
  onSubmitReply: (id: string, text: string, v?: number) => Promise<void>;
  onEditReply: (id: string, replyIndex: number, text: string) => Promise<void>;
  reanchorRequest: number;
  suppressEntrance: boolean;
}) {
  const instances = useAnchorRects(target.anchor);
  const rect = findAnchorInstanceRect(instances, target.instance);
  if (!rect) {
    // Anchor not in DOM — future: render a "removed in v<n>" floater.
    return null;
  }
  // Only auto-run the agent when the pending agent run matches the open comment.
  const lead = comments[0];
  const pendingAutoAgent =
    autoAgent && lead?.id === autoAgent.id ? autoAgent : null;
  return (
    <CommentBubble
      agentModel={pendingAutoAgent?.model ?? agentRun?.model ?? agentModel}
      agentRun={agentRun}
      agentWorking={Boolean(agentRun)}
      autoAgentCount={pendingAutoAgent?.count ?? null}
      comments={comments}
      initialActiveVersion={
        lead ? activeVersionByComment.get(lead.id) : undefined
      }
      instance={target.instance}
      onActiveVersionChange={onActiveVersionChange}
      onAgentModelChange={onAgentModelChange}
      onAgentWorkingChange={onAgentWorkingChange}
      onAutoAgentStarted={onAutoAgentStarted}
      onClose={onClose}
      onDelete={onDelete}
      onDockedChange={onDockedChange}
      onEdit={onEdit}
      onEditReply={onEditReply}
      onResolve={onResolve}
      onSubmitReply={onSubmitReply}
      reanchorRequest={reanchorRequest}
      rect={rect}
      skipDeleteConfirmation={skipDeleteConfirmation}
      suppressEntrance={suppressEntrance}
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
