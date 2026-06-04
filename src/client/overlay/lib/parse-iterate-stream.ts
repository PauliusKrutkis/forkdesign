import {
  formatProgress,
  type IterateDoneEvent,
  type IterateStreamEvent,
} from "./bubble-formatters.ts";

export interface ParseIterateStreamCallbacks {
  onProgress: (detail: string) => void;
  signal?: AbortSignal;
}

function parseIterateLine(
  line: string,
  onProgress: ParseIterateStreamCallbacks["onProgress"]
): IterateDoneEvent | "continue" {
  if (!line) {
    return "continue";
  }
  let event: IterateStreamEvent;
  try {
    event = JSON.parse(line) as IterateStreamEvent;
  } catch {
    return "continue";
  }
  if (event.type === "progress") {
    onProgress(formatProgress(event));
    return "continue";
  }
  if (event.type === "done") {
    return event;
  }
  return "continue";
}

function drainBufferLines(
  buffer: string,
  onProgress: ParseIterateStreamCallbacks["onProgress"]
): { buffer: string; done: IterateDoneEvent | null } {
  let rest = buffer;
  let nl = rest.indexOf("\n");
  while (nl >= 0) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    nl = rest.indexOf("\n");
    const parsed = parseIterateLine(line, onProgress);
    if (parsed !== "continue") {
      return { buffer: rest, done: parsed };
    }
  }
  return { buffer: rest, done: null };
}

export async function readIterateStream(
  body: ReadableStream<Uint8Array>,
  callbacks: ParseIterateStreamCallbacks
): Promise<IterateDoneEvent | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: IterateDoneEvent | null = null;
  const { signal, onProgress } = callbacks;

  const onAbort = () => {
    reader.cancel().catch(() => {
      /* stream already closed */
    });
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return null;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (!signal?.aborted) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const drained = drainBufferLines(buffer, onProgress);
      buffer = drained.buffer;
      if (drained.done) {
        done = drained.done;
        break;
      }
    }
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }

  return done;
}

export function formatIterateSuccess(
  done: Extract<IterateDoneEvent, { ok: true }>
): string {
  const parts: string[] = [];
  if (done.versions && done.versions.length > 1) {
    parts.push(`${done.versions.length} versions`);
  }
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
