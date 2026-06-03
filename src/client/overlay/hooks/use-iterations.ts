import { useCallback, useEffect, useState } from "react";
import { readApiError } from "../lib/api.ts";
import { toErrorMessage } from "../lib/errors.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";
import { useViteHmrReload } from "./use-vite-hmr-reload.ts";

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

export function useIterations(commentId: string) {
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
    setLoading(true);
    reload().catch(ignorePromiseRejection);
  }, [reload]);

  useViteHmrReload(reload);

  const activate = useCallback(
    async (v: number) => {
      if (switching || deleting || data?.active === v) {
        return;
      }
      const previousActive = data?.active;
      setSwitching(true);
      setData((prev) => (prev ? { ...prev, active: v } : prev));
      try {
        const res = await fetch("/api/iterations/activate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: commentId, v }),
        });
        if (!res.ok) {
          if (typeof previousActive === "number") {
            setData((prev) =>
              prev ? { ...prev, active: previousActive } : prev
            );
          }
          return;
        }
      } catch {
        if (typeof previousActive === "number") {
          setData((prev) =>
            prev ? { ...prev, active: previousActive } : prev
          );
        }
      } finally {
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
          throw new Error(await readApiError(res));
        }
        const body = (await res.json()) as { active?: number };
        await reload();
        const nextActive = body.active;
        if (typeof nextActive === "number") {
          setData((prev) => (prev ? { ...prev, active: nextActive } : prev));
        }
      } catch (err) {
        setDeleteError(toErrorMessage(err, "Failed to delete version"));
        throw err;
      } finally {
        setDeleting(false);
      }
    },
    [commentId, switching, deleting, reload]
  );

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
