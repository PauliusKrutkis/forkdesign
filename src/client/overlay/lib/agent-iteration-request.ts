import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { readApiError } from "./api.ts";
import {
  captureAndUploadVersionAfterHmr,
  captureAndUploadVersionNow,
} from "./capture-iteration-screenshot.ts";
import { isAbortError, toErrorMessage } from "./errors.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

export type AgentIterationOutcome = "ok" | "cancelled" | "failed";

export async function cancelAgentIterationRequest(id: string): Promise<void> {
  await fetch("/api/iterations/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

async function activateIterationVersion(
  id: string,
  v: number
): Promise<boolean> {
  const res = await fetch("/api/iterations/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, v }),
  });
  return res.ok;
}

async function restorePreferredActiveVersion(args: {
  currentVersion: number | undefined;
  getPreferredActive?: () => number | null;
  id: string;
  reloadIterations: () => void | Promise<void>;
}): Promise<void> {
  const preferredActive = args.getPreferredActive?.();
  if (
    preferredActive === null ||
    preferredActive === undefined ||
    preferredActive === args.currentVersion
  ) {
    return;
  }

  if (await activateIterationVersion(args.id, preferredActive)) {
    await Promise.resolve(args.reloadIterations()).catch(
      ignorePromiseRejection
    );
  }
}

export async function runAgentIterationRequest(args: {
  getPreferredActive?: () => number | null;
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
    getPreferredActive,
  } = args;

  try {
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
          const reload = () =>
            Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
          reload();
          if (event.capture) {
            captureAndUploadVersionAfterHmr({
              id: lead.id,
              anchor: lead.anchor,
              v: event.version,
            })
              .then(async () => {
                await restorePreferredActiveVersion({
                  id: lead.id,
                  currentVersion: event.version,
                  getPreferredActive,
                  reloadIterations,
                });
                reload();
              })
              .catch(ignorePromiseRejection);
          }
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
    await restorePreferredActiveVersion({
      id: lead.id,
      currentVersion: validated.value.v,
      getPreferredActive,
      reloadIterations,
    });
    return "ok";
  } catch (err) {
    if (isAbortError(err)) {
      return "cancelled";
    }
    setIterateError(`network error: ${toErrorMessage(err)}`);
    return "failed";
  }
}
