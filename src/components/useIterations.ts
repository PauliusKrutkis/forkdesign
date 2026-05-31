import { useCallback, useEffect, useState } from "react";

export interface IterationVersion {
  createdAt?: string;
  png: string;
  summary?: string;
  tsx: string;
  v: number;
}

export interface IterationsData {
  active: number;
  file: string;
  id: string;
  versions: IterationVersion[];
}

export interface UseIterationsOptions {
  /** When true, ← / → activate previous/next version while the bubble is open. */
  enableKeyboard?: boolean;
}

export function useIterations(
  commentId: string,
  options: UseIterationsOptions = {}
) {
  const { enableKeyboard = false } = options;
  const [data, setData] = useState<IterationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/iterations?id=${encodeURIComponent(commentId)}`
      );
      if (!res.ok) {
        setData(null);
        return;
      }
      const body = (await res.json()) as IterationsData;
      setData(body);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [commentId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = async () => {
      await reload();
      if (cancelled) {
        return;
      }
    };
    void run();

    if (import.meta.hot) {
      const handler = () => void reload();
      import.meta.hot.on("vite:afterUpdate", handler);
      return () => {
        cancelled = true;
        import.meta.hot?.off("vite:afterUpdate", handler);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const activate = useCallback(
    async (v: number) => {
      if (switching || deleting || data?.active === v) {
        return;
      }
      setSwitching(true);
      try {
        const res = await fetch("/api/iterations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: commentId, v }),
        });
        if (!res.ok) {
          setSwitching(false);
          return;
        }
        setData((prev) => (prev ? { ...prev, active: v } : prev));
      } catch {
        setSwitching(false);
      }
    },
    [commentId, switching, deleting, data?.active]
  );

  const removeVersion = useCallback(
    async (v: number) => {
      if (switching || deleting) {
        return;
      }
      setDeleting(true);
      setDeleteError(null);
      try {
        const res = await fetch("/api/iterations/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: commentId, v }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `request failed (${res.status})`);
        }
        const body = (await res.json()) as { active?: number };
        await reload();
        const nextActive = body.active;
        if (typeof nextActive === "number") {
          setData((prev) => (prev ? { ...prev, active: nextActive } : prev));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to delete version";
        setDeleteError(message);
        throw err;
      } finally {
        setDeleting(false);
      }
    },
    [commentId, switching, deleting, reload]
  );

  useEffect(() => {
    if (switching && data) {
      setSwitching(false);
    }
  }, [data, switching]);

  useEffect(() => {
    if (deleting && data) {
      setDeleting(false);
    }
  }, [data, deleting]);

  useEffect(() => {
    if (!(enableKeyboard && data && data.versions.length > 1)) {
      return;
    }
    const versionIndices = data.versions.map((x) => x.v).sort((a, b) => a - b);
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const activeEl = document.activeElement;
      const inInput =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl instanceof HTMLElement && activeEl.isContentEditable));
      if (inInput) {
        return;
      }
      const pos = versionIndices.indexOf(data.active);
      if (pos < 0) {
        return;
      }
      if (e.key === "ArrowLeft" && pos > 0 && !switching && !deleting) {
        e.preventDefault();
        void activate(versionIndices[pos - 1] ?? data.active);
      } else if (
        e.key === "ArrowRight" &&
        pos < versionIndices.length - 1 &&
        !switching &&
        !deleting
      ) {
        e.preventDefault();
        void activate(versionIndices[pos + 1] ?? data.active);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enableKeyboard, data, switching, deleting, activate]);

  return {
    data,
    loading,
    switching,
    deleting,
    deleteError,
    activate,
    removeVersion,
    reload,
  };
}
