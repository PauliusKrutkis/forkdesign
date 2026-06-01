import { useCallback, useEffect, useState } from "react";
import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import { readApiError } from "../lib/api.ts";
import { captureAndUploadV } from "../lib/capture-iteration-screenshot.ts";
import { toErrorMessage } from "../lib/errors.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "../lib/parse-iterate-stream.ts";

export type BubbleMode = "compact" | "detailed";

export function useIterateFix(args: {
  lead: CommentData | undefined;
  fixModel: OverlayModel;
  reloadIterations: () => void | Promise<void>;
  setMode: (mode: BubbleMode | ((prev: BubbleMode) => BubbleMode)) => void;
}) {
  const { lead, fixModel, reloadIterations, setMode } = args;
  const [iterating, setIterating] = useState(false);
  const [iterateError, setIterateError] = useState<string | null>(null);
  const [iterateStatus, setIterateStatus] = useState<string | null>(null);
  const [iterateStartedAt, setIterateStartedAt] = useState<number | null>(null);
  const [iterateNow, setIterateNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!iterating) {
      return;
    }
    const t = window.setInterval(() => setIterateNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [iterating]);

  const handleIterate = useCallback(async () => {
    if (!lead || iterating) {
      return;
    }
    setMode("detailed");
    setIterating(true);
    setIterateError(null);
    setIterateStatus(null);
    setIterateStartedAt(Date.now());
    setIterateNow(Date.now());
    try {
      const res = await fetch("/api/iterations/new", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lead.id, model: fixModel }),
      });
      if (!(res.ok && res.body)) {
        setIterateError(await readApiError(res));
        return;
      }

      const done = await readIterateStream(res.body, {
        onProgress: setIterateStatus,
      });
      const validated = validateIterateDone(done);
      if (!validated.ok) {
        setIterateError(validated.error);
        return;
      }

      setIterateStatus(formatIterateSuccess(validated.value));
      window.setTimeout(() => setIterateStatus(null), 3000);

      Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
      if (validated.value.v !== undefined && validated.value.changed === true) {
        captureAndUploadV({
          id: lead.id,
          anchor: lead.anchor,
          v: validated.value.v,
          onUploaded: () => {
            Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
          },
        });
      }
    } catch (err) {
      setIterateError(`network error: ${toErrorMessage(err)}`);
    } finally {
      setIterating(false);
      setIterateStartedAt(null);
    }
  }, [lead, iterating, fixModel, reloadIterations, setMode]);

  return {
    iterating,
    iterateError,
    iterateStatus,
    iterateStartedAt,
    iterateNow,
    handleIterate,
  };
}
