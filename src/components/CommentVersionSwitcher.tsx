import { useCallback, useEffect, useState } from "react";
import { Kbd } from "./Kbd";

type CommentVersionSwitcherProps = {
  /** Comment uuid; used as the iterations directory key on the server. */
  commentId: string;
};

type IterationVersion = {
  v: number;
  tsx: string;
  png: string;
};

type IterationsResponse = {
  id: string;
  file: string;
  active: number;
  versions: IterationVersion[];
};

/**
 * `< vN of M >` chevrons that flip through a view's iteration history.
 *
 * Reads the iterations metadata for a comment from
 * `GET /api/iterations?id=<commentId>` and updates the active version via
 * `POST /api/iterations/activate`. After activation the server rewrites the
 * source file, which fires Vite HMR. We re-fetch on every `vite:afterUpdate`
 * tick to stay in sync — the same pattern `CommentOverlay` uses.
 *
 * Falls back to nothing-rendered when there's only a single version (or none),
 * keeping the bubble header clean for the common case.
 */
export function CommentVersionSwitcher({
  commentId,
}: CommentVersionSwitcherProps) {
  const [data, setData] = useState<IterationsResponse | null>(null);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/iterations?id=${encodeURIComponent(commentId)}`,
      );
      if (!res.ok) {
        setData(null);
        return;
      }
      const body = (await res.json()) as IterationsResponse;
      setData(body);
    } catch {
      setData(null);
    }
  }, [commentId]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await load();
      if (cancelled) return;
    };
    void run();

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
  }, [load]);

  const activate = useCallback(
    async (v: number) => {
      if (switching) return;
      setSwitching(true);
      try {
        const res = await fetch("/api/iterations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: commentId, v }),
        });
        if (!res.ok) {
          // Reset switching state; HMR won't fire on a failed activation.
          setSwitching(false);
          return;
        }
        // Optimistically update local state. The next HMR cycle will re-fetch
        // and confirm, then drop the switching flag.
        setData((prev) => (prev ? { ...prev, active: v } : prev));
      } catch {
        setSwitching(false);
      }
    },
    [commentId, switching],
  );

  // Clear the switching flag whenever a fresh payload arrives.
  useEffect(() => {
    if (switching && data) setSwitching(false);
  }, [data, switching]);

  // Keyboard shortcuts: ← / → switch versions whenever the switcher is
  // mounted (i.e., whenever an open bubble is showing). Skipped if the user
  // is typing in an input. Safe to be global because the switcher only
  // mounts inside an open bubble.
  useEffect(() => {
    if (!data || data.versions.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      const inInput =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active instanceof HTMLElement && active.isContentEditable));
      if (inInput) return;
      if (e.key === "ArrowLeft" && data.active > 0 && !switching) {
        e.preventDefault();
        void activate(data.active - 1);
      } else if (
        e.key === "ArrowRight" &&
        data.active < data.versions.length - 1 &&
        !switching
      ) {
        e.preventDefault();
        void activate(data.active + 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data, switching, activate]);

  if (!data) return null;
  const total = data.versions.length;
  if (total <= 0) return null;

  const active = data.active;
  const display = active + 1; // 1-indexed for the user

  // Single version: just a static badge — no chevrons to click.
  if (total === 1) {
    return (
      <span className="inline-flex h-7 items-center px-2 font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink-3)] tabular-nums">
        v{display}
      </span>
    );
  }

  const canPrev = !switching && active > 0;
  const canNext = !switching && active < total - 1;
  const dimmed = switching ? "opacity-60" : "";

  return (
    <div
      className={`inline-flex items-center gap-1.5 font-[var(--co-font-mono)] text-[11px] uppercase tracking-[0.06em] text-[var(--co-ink-2)] ${dimmed}`}
    >
      <button
        type="button"
        onClick={() => void activate(active - 1)}
        disabled={!canPrev}
        aria-label="Previous version"
        title="Previous version (←)"
        className="grid h-7 w-7 place-items-center rounded-[4px] border border-[var(--co-line)] bg-[var(--co-surface)] text-[var(--co-ink-2)] transition-colors hover:enabled:bg-[var(--co-surface-3)] hover:enabled:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:text-[var(--co-ink-4)]"
      >
        <Chevron direction="left" />
      </button>
      <Kbd className="!ml-0 !text-[var(--co-ink-4)]">←</Kbd>
      <span className="min-w-[64px] px-1 text-center tabular-nums">
        v{display} of {total}
      </span>
      <Kbd className="!ml-0 !text-[var(--co-ink-4)]">→</Kbd>
      <button
        type="button"
        onClick={() => void activate(active + 1)}
        disabled={!canNext}
        aria-label="Next version"
        title="Next version (→)"
        className="grid h-7 w-7 place-items-center rounded-[4px] border border-[var(--co-line)] bg-[var(--co-surface)] text-[var(--co-ink-2)] transition-colors hover:enabled:bg-[var(--co-surface-3)] hover:enabled:text-[var(--co-ink)] disabled:cursor-not-allowed disabled:text-[var(--co-ink-4)]"
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {direction === "left" ? (
        <polyline points="10,3.5 5,8 10,12.5" />
      ) : (
        <polyline points="6,3.5 11,8 6,12.5" />
      )}
    </svg>
  );
}
