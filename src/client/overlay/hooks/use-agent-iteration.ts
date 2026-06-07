import { useCallback, useEffect, useRef, useState } from "react";
import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import {
  cancelAgentIterationRequest,
  runAgentIterationRequest,
} from "../lib/agent-iteration-request.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";

export function useAgentIteration(args: {
  clearPreferredActive?: () => void;
  getPreferredActive?: () => number | null;
  lead: CommentData | undefined;
  agentModel: OverlayModel;
  agentVersionCount: number;
  /** Anchored instance index; threaded to screenshot capture. Defaults to 0. */
  instance?: number;
  reloadIterations: () => void | Promise<void>;
  /** Pin loading — survives bubble close until the run finishes. */
  onAgentWorkingChange?: (
    anchor: string | null,
    run?: {
      commentId: string;
      count: number;
      model: OverlayModel;
      startedAt: number;
    },
    cancel?: () => void
  ) => void;
}) {
  const {
    lead,
    agentModel,
    agentVersionCount,
    instance = 0,
    reloadIterations,
    onAgentWorkingChange,
    clearPreferredActive,
    getPreferredActive,
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
    if (lead?.id) {
      cancelAgentIterationRequest(lead.id).catch(ignorePromiseRejection);
    }
    abortRef.current?.abort();
  }, [lead?.id]);

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
      clearPreferredActive?.();

      const startedAt = Date.now();
      setIterating(true);
      onAgentWorkingChange?.(
        lead.anchor,
        {
          commentId: lead.id,
          count: runCount,
          model: runModel,
          startedAt,
        },
        () => {
          cancelAgentIterationRequest(lead.id).catch(ignorePromiseRejection);
          abortController.abort();
        }
      );
      setIterateError(null);
      setIterateStatus(null);
      setIterateStartedAt(startedAt);
      setIterateNow(startedAt);

      const outcome = await runAgentIterationRequest({
        lead,
        agentModel: runModel,
        agentVersionCount: runCount,
        instance,
        signal: abortController.signal,
        reloadIterations,
        setIterateError,
        setIterateStatus,
        getPreferredActive,
      });

      if (abortRef.current === abortController) {
        abortRef.current = null;
      }
      setIterating(false);
      setIterateStartedAt(null);
      onAgentWorkingChange?.(lead.anchor);
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
      instance,
      reloadIterations,
      onAgentWorkingChange,
      clearPreferredActive,
      getPreferredActive,
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
