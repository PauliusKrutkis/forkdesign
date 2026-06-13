import { describe, expect, it, vi } from "vitest";
import type { IterateStreamEvent } from "./bubble-formatters.ts";
import { readIterateStream } from "./parse-iterate-stream.ts";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

const line = (event: IterateStreamEvent) => `${JSON.stringify(event)}\n`;

describe("readIterateStream", () => {
  it("returns a final done event that arrives without a trailing newline", async () => {
    const onProgress = vi.fn();
    const stream = streamOf([
      line({ type: "progress", detail: "working" }),
      // EOF without a closing "\n" — this was previously dropped.
      JSON.stringify({ type: "done", ok: true, v: 1 }),
    ]);

    const done = await readIterateStream(stream, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(done).toEqual({ type: "done", ok: true, v: 1 });
  });

  it("returns a done event split across chunk boundaries", async () => {
    const onProgress = vi.fn();
    const payload = JSON.stringify({ type: "done", ok: true, v: 2 });
    const stream = streamOf([payload.slice(0, 10), `${payload.slice(10)}\n`]);

    const done = await readIterateStream(stream, { onProgress });

    expect(done).toEqual({ type: "done", ok: true, v: 2 });
  });

  it("returns null when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const stream = streamOf([line({ type: "done", ok: true, v: 1 })]);

    const done = await readIterateStream(stream, {
      onProgress: vi.fn(),
      signal: controller.signal,
    });

    expect(done).toBeNull();
  });

  it("ignores malformed NDJSON lines without losing the final result", async () => {
    const stream = streamOf([
      "{not json}\n",
      line({ type: "done", ok: false, error: "boom" }),
    ]);

    const done = await readIterateStream(stream, { onProgress: vi.fn() });

    expect(done).toEqual({ type: "done", ok: false, error: "boom" });
  });
});
