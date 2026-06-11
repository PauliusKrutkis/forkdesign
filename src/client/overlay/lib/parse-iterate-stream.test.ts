import { describe, expect, it, vi } from "vitest";
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
  it("reads chunked progress events and stops at the first done event", async () => {
    const progress: string[] = [];
    const progressEvents: object[] = [];
    const done = await readIterateStream(
      streamFromChunks([
        '{"type":"progress","tool":"edit"',
        ',"detail":"src/App.tsx"}\nnot-json\n',
        '{"type":"progress","detail":"Waiting for screenshot"}\n',
        '{"type":"done","ok":true,"v":2,"versions":[1,2]}\n',
        '{"type":"progress","detail":"ignored after done"}\n',
      ]),
      {
        onProgress: (detail) => progress.push(detail),
        onProgressEvent: (event) => progressEvents.push(event),
      }
    );

    expect(progress).toEqual(["edit src/App.tsx", "Waiting for screenshot"]);
    expect(progressEvents).toEqual([
      { type: "progress", tool: "edit", detail: "src/App.tsx" },
      { type: "progress", detail: "Waiting for screenshot" },
    ]);
    expect(done).toEqual({ type: "done", ok: true, v: 2, versions: [1, 2] });
  });

  it("cancels the reader when the abort signal fires", async () => {
    const cancel = vi.fn();
    const abortController = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('{"type":"progress","detail":"Working"}\n')
        );
      },
      cancel,
    });

    const done = await readIterateStream(body, {
      onProgress: () => abortController.abort(),
      signal: abortController.signal,
    });

    expect(done).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("returns null without reading when the signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const done = await readIterateStream(
      streamFromChunks(['{"type":"done","ok":true}\n']),
      {
        onProgress: () => {
          throw new Error("progress should not run");
        },
        signal: abortController.signal,
      }
    );

    expect(done).toBeNull();
  });
});

describe("formatIterateSuccess", () => {
  it("joins available success metadata", () => {
    expect(
      formatIterateSuccess({
        type: "done",
        ok: true,
        versions: [1, 2],
        modelUsed: "composer-2.5-fast",
        durationMs: 1500,
        turnsUsed: 3,
      })
    ).toBe("2 versions · composer-2.5-fast · 2s · 3 turns");
  });

  it("falls back when no metadata is present", () => {
    expect(formatIterateSuccess({ type: "done", ok: true })).toBe("Done");
  });
});

describe("validateIterateDone", () => {
  it("rejects a closed stream without a result", () => {
    expect(validateIterateDone(null)).toEqual({
      ok: false,
      error: "stream closed without a result",
    });
  });

  it("uses done error details when the agent fails", () => {
    expect(validateIterateDone({ type: "done", ok: false, error: "bad" })).toEqual(
      {
        ok: false,
        error: "bad",
      }
    );
  });

  it("rejects no-change success results with a user-facing retry hint", () => {
    expect(
      validateIterateDone({ type: "done", ok: true, changed: false })
    ).toEqual({
      ok: false,
      error: "AI made no changes — try a more specific instruction",
    });
  });

  it("accepts changed and legacy success results", () => {
    expect(
      validateIterateDone({ type: "done", ok: true, changed: true, v: 1 })
    ).toMatchObject({ ok: true, value: { v: 1 } });
    expect(validateIterateDone({ type: "done", ok: true })).toMatchObject({
      ok: true,
      value: { type: "done", ok: true },
    });
  });
});
