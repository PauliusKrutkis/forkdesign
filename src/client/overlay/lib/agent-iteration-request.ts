import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { readApiError } from "./api.ts";
import {
  anchorRenderSignature,
  captureAndUploadVersionNow,
  scheduleAgentVariantScreenshots,
} from "./capture-iteration-screenshot.ts";
import { isAbortError, toErrorMessage } from "./errors.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

export type AgentIterationOutcome = "ok" | "cancelled" | "failed";

export async function runAgentIterationRequest(args: {
  lead: CommentData;
  agentModel: OverlayModel;
  agentVersionCount: number;
  signal: AbortSignal;
  reloadIterations: () => void | Promise<void>;
  setIterateError: (message: string | null) => void;
  setIterateStatus: (message: string | null) => void;
}): Promise<AgentIterationOutcome> {
  const {
    lead,
    agentModel,
    agentVersionCount,
    signal,
    reloadIterations,
    setIterateError,
    setIterateStatus,
  } = args;

  try {
    const preAgentSignature = anchorRenderSignature(lead.anchor);

    // Agent runs change the page; capture baseline (v0) only while the DOM
    // still reflects the pre-agent state. Comment-only creates already POST v0.
    if (!lead.screenshot) {
      const uploaded = await captureAndUploadVersionNow({
        id: lead.id,
        anchor: lead.anchor,
        v: 0,
      });
      if (uploaded) {
        await Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
      }
    }

    const res = await fetch("/api/iterations/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: lead.id,
        model: agentModel,
        count: agentVersionCount,
      }),
      signal,
    });
    if (signal.aborted) {
      return "cancelled";
    }
    if (!(res.ok && res.body)) {
      setIterateError(await readApiError(res));
      return "failed";
    }

    const done = await readIterateStream(res.body, {
      onProgress: setIterateStatus,
      onProgressEvent: (event) => {
        if (event.stage === "snapshot" && typeof event.version === "number") {
          Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
        }
      },
      signal,
    });
    if (signal.aborted) {
      return "cancelled";
    }

    const validated = validateIterateDone(done);
    if (!validated.ok) {
      setIterateError(validated.error);
      return "failed";
    }

    setIterateStatus(formatIterateSuccess(validated.value));
    window.setTimeout(() => setIterateStatus(null), 3000);

    await Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);

    const agentVersions =
      validated.value.versions?.filter((v) => v > 0) ??
      (validated.value.v !== undefined && validated.value.v > 0
        ? [validated.value.v]
        : []);
    const activeV = validated.value.v ?? agentVersions.at(-1) ?? 0;
    if (agentVersions.length > 0) {
      scheduleAgentVariantScreenshots({
        id: lead.id,
        anchor: lead.anchor,
        versions: agentVersions,
        activeV,
        initialPreviousSignature: preAgentSignature,
        onDone: () => {
          Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
        },
      });
    }
    return "ok";
  } catch (err) {
    if (isAbortError(err)) {
      return "cancelled";
    }
    setIterateError(`network error: ${toErrorMessage(err)}`);
    return "failed";
  }
}
