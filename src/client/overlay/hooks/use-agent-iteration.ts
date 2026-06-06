import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { runAgentIterationRequest } from "../lib/agent-iteration-request.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";

export function useAgentIteration(args: {
  lead: CommentData | undefined;
  agentModel: OverlayModel;
  agentVersionCount: number;
  reloadIterations: () => void | Promise<void>;
  /** Pin loading — survives bubble close until the run finishes. */
  onAgentWorkingChange?: (
    anchor: string | null,
    run?: { count: number; model: OverlayModel; startedAt: number },
    cancel?: () => void
  ) => void;
}) {
  const {
    lead,
    agentModel,
    agentVersionCount,
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
      agentModel?: OverlayModel;
      agentVersionCount?: number;
    }) => {
      if (!lead || iterating) {
        return;
      }
      const runModel = overrides?.agentModel ?? agentModel;
      const runCount = overrides?.agentVersionCount ?? agentVersionCount;
      const abortController = new AbortController();
      abortRef.current = abortController;

      const startedAt = Date.now();
      setIterating(true);
      onAgentWorkingChange?.(
        lead.anchor,
        {
          count: runCount,
          model: runModel,
          startedAt,
        },
        () => abortController.abort()
      );
      setIterateError(null);
      setIterateStatus(null);
      setIterateStartedAt(startedAt);
      setIterateNow(startedAt);

      const outcome = await runAgentIterationRequest({
        lead,
        agentModel: runModel,
        agentVersionCount: runCount,
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
      agentModel,
      agentVersionCount,
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
