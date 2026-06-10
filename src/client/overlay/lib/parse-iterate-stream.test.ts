import { describe, expect, it } from "vitest";
import type { IterateProgressEvent } from "./bubble-formatters.ts";
import {
  formatIterateSuccess,
  readIterateStream,
  validateIterateDone,
} from "./parse-iterate-stream.ts";

const encoder = new TextEncoder();

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
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
  it("parses progress events across chunk boundaries and ignores malformed lines", async () => {
    const progress: string[] = [];
    const progressEvents: IterateProgressEvent[] = [];

    const done = await readIterateStream(
      streamFromChunks([
        '{"type":"progress","tool":"Edit","detail":"updating',
        ' button"}\nnot json\n{"type":"done","ok":true,"changed":true,"v":2}\n',
      ]),
      {
        onProgress: (detail) => progress.push(detail),
        onProgressEvent: (event) => progressEvents.push(event),
      }
    );

    expect(progress).toEqual(["Edit updating button"]);
    expect(progressEvents).toEqual([
      { type: "progress", tool: "Edit", detail: "updating button" },
    ]);
    expect(done).toEqual({ type: "done", ok: true, changed: true, v: 2 });
  });

  it("parses a final done event when the stream closes without a trailing newline", async () => {
    const done = await readIterateStream(
      streamFromChunks(['{"type":"done","ok":true,"changed":true,"v":1}']),
      { onProgress: () => undefined }
    );

    expect(done).toEqual({ type: "done", ok: true, changed: true, v: 1 });
  });

  it("cancels the reader and returns null when aborted before reading", async () => {
    const abortController = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    abortController.abort();

    const done = await readIterateStream(stream, {
      onProgress: () => undefined,
      signal: abortController.signal,
    });
    await Promise.resolve();

    expect(done).toBeNull();
    expect(cancelled).toBe(true);
  });
});

describe("formatIterateSuccess", () => {
  it("summarizes version count, model, elapsed time, and turns", () => {
    expect(
      formatIterateSuccess({
        type: "done",
        ok: true,
        changed: true,
        versions: [1, 2],
        modelUsed: "claude",
        durationMs: 2600,
        turnsUsed: 3,
      })
    ).toBe("2 versions · claude · 3s · 3 turns");
  });

  it("falls back when no summary details are present", () => {
    expect(
      formatIterateSuccess({ type: "done", ok: true, changed: true })
    ).toBe("Done");
  });
});

describe("validateIterateDone", () => {
  it("reports a missing final result", () => {
    expect(validateIterateDone(null)).toEqual({
      ok: false,
      error: "stream closed without a result",
    });
  });

  it("surfaces failed done event errors", () => {
    expect(validateIterateDone({ type: "done", ok: false, error: "boom" }))
      .toEqual({
        ok: false,
        error: "boom",
      });
  });

  it("rejects unchanged successful done events", () => {
    expect(validateIterateDone({ type: "done", ok: true, changed: false }))
      .toEqual({
        ok: false,
        error: "AI made no changes — try a more specific instruction",
      });
  });
});
