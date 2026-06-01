import {
  formatProgress,
  type IterateDoneEvent,
  type IterateStreamEvent,
} from "./bubble-formatters.ts";

export interface ParseIterateStreamCallbacks {
  onProgress: (detail: string) => void;
}

export async function readIterateStream(
  body: ReadableStream<Uint8Array>,
  callbacks: ParseIterateStreamCallbacks
): Promise<IterateDoneEvent | null> {
  const reader = body.getReader();
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
        callbacks.onProgress(formatProgress(event));
      } else if (event.type === "done") {
        done = event;
        break streamLoop;
      }
    }
  }

  return done;
}

export function formatIterateSuccess(
  done: Extract<IterateDoneEvent, { ok: true }>
): string {
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
  return parts.length > 0 ? parts.join(" · ") : "Done";
}

export function validateIterateDone(
  done: IterateDoneEvent | null
):
  | { ok: true; value: Extract<IterateDoneEvent, { ok: true }> }
  | { ok: false; error: string } {
  if (!done) {
    return { ok: false, error: "stream closed without a result" };
  }
  if (!done.ok) {
    return { ok: false, error: done.error ?? "agent failed" };
  }
  if (done.changed === false) {
    return {
      ok: false,
      error: "AI made no changes — try a more specific instruction",
    };
  }
  return { ok: true, value: done };
}
