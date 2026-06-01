import { useCallback, useEffect, useState } from "react";
import type { OverlayModel } from "../../settings.ts";
import type { CommentData } from "../../types.ts";
import {
  formatProgress,
  type IterateDoneEvent,
  type IterateStreamEvent,
} from "../lib/bubble-formatters.ts";
import { captureAndUploadV } from "../lib/capture-iteration-screenshot.ts";
import { ignorePromiseRejection } from "../lib/ignore-promise-rejection.ts";

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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setIterateError(body.error ?? `request failed (${res.status})`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done: IterateDoneEvent | null = null;

      streamLoop: while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) {
            continue;
          }
          let event: IterateStreamEvent;
          try {
            event = JSON.parse(line) as IterateStreamEvent;
          } catch {
            continue;
          }
          if (event.type === "progress") {
            setIterateStatus(formatProgress(event));
          } else if (event.type === "done") {
            done = event;
            break streamLoop;
          }
        }
      }

      if (!done) {
        setIterateError("stream closed without a result");
        return;
      }
      if (!done.ok) {
        setIterateError(done.error ?? "agent failed");
        return;
      }
      if (done.changed === false) {
        setIterateError("AI made no changes — try a more specific instruction");
        return;
      }
      const parts: string[] = [];
      if (done.modelUsed) {
        parts.push(done.modelUsed);
      }
      if (typeof done.durationMs === "number") {
        parts.push(`${Math.round(done.durationMs / 1000)}s`);
      }
      if (typeof done.turnsUsed === "number") {
        parts.push(`${done.turnsUsed} turns`);
      }
      const successStatus = parts.length > 0 ? parts.join(" · ") : "Done";
      setIterateStatus(successStatus);
      window.setTimeout(() => setIterateStatus(null), 3000);

      Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
      if (done.v !== undefined && done.ok === true && done.changed === true) {
        captureAndUploadV({
          id: lead.id,
          anchor: lead.anchor,
          v: done.v,
          onUploaded: () => {
            Promise.resolve(reloadIterations()).catch(ignorePromiseRejection);
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setIterateError(`network error: ${message}`);
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
