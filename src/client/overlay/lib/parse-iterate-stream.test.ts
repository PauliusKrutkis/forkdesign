import { describe, expect, it, vi } from "vitest";
import type { IterateProgressEvent } from "./bubble-formatters.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

function streamFromChunks(
  chunks: readonly string[]
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("readIterateStream", () => {
  it("returns a done event and reports progress from a single NDJSON chunk", async () => {
    const onProgress = vi.fn();
    const progressEvents: IterateProgressEvent[] = [];
    const stream = streamFromChunks([
      '{"type":"progress","tool":"Edit","detail":"src/Card.tsx"}\n{"type":"done","ok":true,"changed":true,"v":1}\n',
    ]);

    const done = await readIterateStream(stream, {
      onProgress,
      onProgressEvent: (event) => {
        progressEvents.push(event);
      },
    });

    expect(done).toEqual({
      type: "done",
      ok: true,
      changed: true,
      v: 1,
    });
    expect(onProgress).toHaveBeenCalledWith("Edit src/Card.tsx");
    expect(progressEvents).toEqual([
      {
        type: "progress",
        tool: "Edit",
        detail: "src/Card.tsx",
      },
    ]);
  });

  it("parses events split across stream chunks", async () => {
    const onProgress = vi.fn();
    const stream = streamFromChunks([
      '{"type":"progress","detail":"Thinking"}\n{"type":"done",',
      '"ok":true,"changed":true,"versions":[0,1,2]}\n',
    ]);

    const done = await readIterateStream(stream, { onProgress });

    expect(done).toEqual({
      type: "done",
      ok: true,
      changed: true,
      versions: [0, 1, 2],
    });
    expect(onProgress).toHaveBeenCalledWith("Thinking");
  });

  it("returns null without reporting progress when aborted before reading", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const onProgress = vi.fn();
    const stream = streamFromChunks([
      '{"type":"progress","detail":"Should not appear"}\n{"type":"done","ok":true}\n',
    ]);

    const done = await readIterateStream(stream, {
      onProgress,
      signal: abortController.signal,
    });

    expect(done).toBeNull();
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("validateIterateDone", () => {
  it("rejects a closed stream without a done result", () => {
    expect(validateIterateDone(null)).toEqual({
      ok: false,
      error: "stream closed without a result",
    });
  });

  it("passes through failed done errors", () => {
    expect(
      validateIterateDone({ type: "done", ok: false, error: "boom" })
    ).toEqual({
      ok: false,
      error: "boom",
    });
  });

  it("treats successful no-change responses as user-facing failures", () => {
    const result = validateIterateDone({
      type: "done",
      ok: true,
      changed: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("AI made no changes");
    }
  });
});

describe("formatIterateSuccess", () => {
  it("summarizes version count, model, duration, and turns", () => {
    const summary = formatIterateSuccess({
      type: "done",
      ok: true,
      changed: true,
      versions: [0, 1, 2],
      modelUsed: "composer-2.5-fast",
      durationMs: 2400,
      turnsUsed: 4,
    });

    expect(summary).toContain("3 versions");
    expect(summary).toContain("composer-2.5-fast");
    expect(summary).toContain("2s");
    expect(summary).toContain("4 turns");
  });
});
