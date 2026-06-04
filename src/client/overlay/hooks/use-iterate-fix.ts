import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";
import { runIterateFixRequest } from "../lib/iterate-fix-request.ts";

export function useIterateFix(args: {
  lead: CommentData | undefined;
  fixModel: OverlayModel;
  fixVersionCount: number;
  reloadIterations: () => void | Promise<void>;
  /** Pin loading — survives bubble close until the run finishes. */
  onAgentWorkingChange?: (anchor: string | null) => void;
}) {
  const {
    lead,
    fixModel,
    fixVersionCount,
    reloadIterations,
    onAgentWorkingChange,
  } = args;
  const [iterating, setIterating] = useState(false);
  const [iterateError, setIterateError] = useState<string | null>(null);
  const [iterateStatus, setIterateStatus] = useState<string | null>(null);
  const [iterateStartedAt, setIterateStartedAt] = useState<number | null>(null);
  const [iterateNow, setIterateNow] = useState<number>(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!iterating) {
      return;
    }
    const t = window.setInterval(() => setIterateNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [iterating]);

  const handleCancelIterate = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleIterate = useCallback(
    async (overrides?: {
      fixModel?: OverlayModel;
      fixVersionCount?: number;
    }) => {
      if (!lead || iterating) {
        return;
      }
      const runModel = overrides?.fixModel ?? fixModel;
      const runCount = overrides?.fixVersionCount ?? fixVersionCount;
      const abortController = new AbortController();
      abortRef.current = abortController;

      setIterating(true);
      onAgentWorkingChange?.(lead.anchor);
      setIterateError(null);
      setIterateStatus(null);
      setIterateStartedAt(Date.now());
      setIterateNow(Date.now());

      const outcome = await runIterateFixRequest({
        lead,
        fixModel: runModel,
        fixVersionCount: runCount,
        signal: abortController.signal,
        reloadIterations,
        setIterateError,
        setIterateStatus,
      });

      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
      setIterating(false);
      setIterateStartedAt(null);
      onAgentWorkingChange?.(null);
      if (outcome === "cancelled") {
        setIterateStatus(null);
        Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
      }
    },
    [
      lead,
      iterating,
      fixModel,
      fixVersionCount,
      reloadIterations,
      onAgentWorkingChange,
    ]
  );

  return {
    iterating,
    iterateError,
    iterateStatus,
    iterateStartedAt,
    iterateNow,
    handleIterate,
    handleCancelIterate,
  };
}
