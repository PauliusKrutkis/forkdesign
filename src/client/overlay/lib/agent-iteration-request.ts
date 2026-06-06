import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { readApiError } from "./api.ts";
import {
  captureAndUploadVersionNow,
  scheduleFixVariantScreenshots,
} from "./capture-iteration-screenshot.ts";
import { isAbortError, toErrorMessage } from "./errors.ts";
import { ignorePromiseRejection } from "./ignore-promise-rejection.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

export type IterateFixOutcome = "ok" | "cancelled" | "failed";

export async function runIterateFixRequest(args: {
  lead: CommentData;
  fixModel: OverlayModel;
  fixVersionCount: number;
  signal: AbortSignal;
  reloadIterations: () => void | Promise<void>;
  setIterateError: (message: string | null) => void;
  setIterateStatus: (message: string | null) => void;
}): Promise<IterateFixOutcome> {
  const {
    lead,
    fixModel,
    fixVersionCount,
    signal,
    reloadIterations,
    setIterateError,
    setIterateStatus,
  } = args;

  try {
    // Agent runs change the page; capture baseline (v0) only while the DOM
    // still reflects the pre-fix state. Comment-only creates already POST v0.
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
        model: fixModel,
        count: fixVersionCount,
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

    const fixVersions =
      validated.value.versions?.filter((v) => v > 0) ??
      (validated.value.v !== undefined && validated.value.v > 0
        ? [validated.value.v]
        : []);
    const activeV = validated.value.v ?? fixVersions.at(-1) ?? 0;
    if (fixVersions.length > 0) {
      scheduleFixVariantScreenshots({
        id: lead.id,
        anchor: lead.anchor,
        versions: fixVersions,
        activeV,
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
