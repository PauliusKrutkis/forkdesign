import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { postJson, readApiError } from "./api.ts";
import { captureAndUploadVersionNow } from "./capture-iteration-screenshot.ts";
import { isAbortError, toErrorMessage } from "./errors.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

export type AgentIterationOutcome = "ok" | "cancelled" | "failed";

export async function cancelAgentIterationRequest(id: string): Promise<void> {
  await postJson("/api/iterations/cancel", { id });
}

export async function runAgentIterationRequest(args: {
  lead: CommentData;
  agentModel: OverlayModel;
  agentVersionCount: number;
  instance?: number;
  signal: AbortSignal;
  reloadIterations: () => void | Promise<void>;
  setIterateError: (message: string | null) => void;
  setIterateStatus: (message: string | null) => void;
}): Promise<AgentIterationOutcome> {
  const {
    lead,
    agentModel,
    agentVersionCount,
    instance = 0,
    signal,
    reloadIterations,
    setIterateError,
    setIterateStatus,
  } = args;

  try {
    if (!lead.screenshot) {
      const uploaded = await captureAndUploadVersionNow({
        id: lead.id,
        anchor: lead.anchor,
        instance,
        v: 0,
      });
      if (uploaded) {
        await Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
      }
    }

    const res = await postJson(
      "/api/iterations/new",
      {
        id: lead.id,
        model: agentModel,
        count: agentVersionCount,
      },
      { signal }
    );
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
    return "ok";
  } catch (err) {
    if (isAbortError(err)) {
      return "cancelled";
    }
    setIterateError(`network error: ${toErrorMessage(err)}`);
    return "failed";
  }
}
