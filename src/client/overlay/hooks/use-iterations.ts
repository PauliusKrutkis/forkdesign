import { useCallback, useEffect, useState } from "react";
import { postJson, readApiError } from "../lib/api.ts";
import { toErrorMessage } from "../lib/errors.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";
import { useViteHmrReload } from "./use-vite-hmr-reload.ts";

export interface IterationVersion {
  createdAt?: string;
  png: string;
  runId?: string;
  screenshotPending?: boolean;
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
  const [preferredActive, setPreferredActive] = useState<number | null>(null);

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
      setData({
        ...body,
        active:
          preferredActive !== null &&
          body.versions.some((version) => version.v === preferredActive)
            ? preferredActive
            : body.active,
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [commentId, preferredActive]);

  // Show the full "Loading versions…" state only for the first fetch of a
  // bubble. Background refreshes — e.g. after switching to an already-generated
  // version (which bumps `preferredActive` and so recreates `reload`) — must
  // stay silent, otherwise the switch looks like the variants are regenerating.
  // biome-ignore lint/correctness/useExhaustiveDependencies: commentId is the trigger, not a referenced value
  useEffect(() => {
    setLoading(true);
  }, [commentId]);

  useEffect(() => {
    reload().catch(ignorePromiseRejection);
  }, [reload]);

  useViteHmrReload(reload);

  const clearPreferredActive = useCallback(() => {
    setPreferredActive(null);
  }, []);

  const activate = useCallback(
    async (v: number) => {
      if (switching || deleting || data?.active === v) {
        return;
      }
      const previousActive = data?.active;
      const previousPreferredActive = preferredActive;
      setPreferredActive(v);
      setSwitching(true);
      setData((prev) => (prev ? { ...prev, active: v } : prev));
      try {
        const res = await postJson("/api/iterations/activate", {
          id: commentId,
          v,
        });
        if (!res.ok) {
          setPreferredActive(previousPreferredActive);
          if (typeof previousActive === "number") {
            setData((prev) =>
              prev ? { ...prev, active: previousActive } : prev
            );
          }
          return;
        }
      } catch {
        setPreferredActive(previousPreferredActive);
        if (typeof previousActive === "number") {
          setData((prev) =>
            prev ? { ...prev, active: previousActive } : prev
          );
        }
      } finally {
        setSwitching(false);
      }
    },
    [commentId, switching, deleting, data?.active, preferredActive]
  );

  const removeVersion = useCallback(
    async (v: number) => {
      if (switching || deleting) {
        return;
      }
      setDeleting(true);
      setDeleteError(null);
      try {
        const res = await postJson("/api/iterations/delete", {
          id: commentId,
          v,
        });
        if (!res.ok) {
          throw new Error(await readApiError(res));
        }
        const body = (await res.json()) as { active?: number };
        if (preferredActive === v) {
          setPreferredActive(null);
        }
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
    [commentId, switching, deleting, reload, preferredActive]
  );

  return {
    data,
    loading,
    switching,
    deleting,
    deleteError,
    preferredActive,
    activate,
    clearPreferredActive,
    removeVersion,
    reload,
  };
}
