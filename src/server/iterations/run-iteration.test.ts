import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundComment } from "../comments/find-comment.ts";

const { runAgentMock, updateCommentActiveMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  updateCommentActiveMock: vi.fn(async () => undefined),
}));

vi.mock("../agent/index.ts", () => ({
  runAgent: runAgentMock,
}));

vi.mock("../comments/writer.ts", () => ({
  updateCommentActive: updateCommentActiveMock,
}));

vi.mock("../agent/run-log.ts", () => ({
  appendAgentRunLog: vi.fn(async () => undefined),
}));

import { createNdjsonStream, runNewIteration } from "./run-iteration.ts";

function createTestStream(): {
  events: object[];
  req: IncomingMessage;
  res: ServerResponse;
  stream: ReturnType<typeof createNdjsonStream>;
} {
  const events: object[] = [];
  const req = new EventEmitter() as IncomingMessage;
  const res = {
    destroyed: false,
    write(chunk: string) {
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          events.push(JSON.parse(trimmed) as object);
        }
      }
    },
    end() {
      /* noop */
    },
  } as unknown as ServerResponse;
  const stream = createNdjsonStream(req, res);
  const originalEnd = stream.endStream.bind(stream);
  stream.endStream = (final: object) => {
    events.push(final);
    originalEnd(final);
  };
  return { events, req, res, stream };
}

describe("runNewIteration multi-variant", () => {
  let projectRoot: string;
  let sourcePath: string;
  const commentId = "comment-1";
  const baselineSource = `export function Widget() {
  return <div data-comment-anchor="anchor-1">baseline</div>;
}`;

  const found: FoundComment = {
    absolutePath: "",
    relativePath: "src/Widget.tsx",
    siblingIds: [],
    comment: {
      id: commentId,
      anchor: "anchor-1",
      text: "make it blue",
      active: 0,
    },
  };

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "redline-run-iteration-"));
    sourcePath = path.join(projectRoot, "src", "Widget.tsx");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, baselineSource, "utf8");
    found.absolutePath = sourcePath;

    const iterDir = path.join(projectRoot, "designs", "iterations", commentId);
    mkdirSync(iterDir, { recursive: true });
    writeFileSync(path.join(iterDir, "v0.tsx"), baselineSource, "utf8");
    writeFileSync(path.join(iterDir, "v0.png"), "png", "utf8");

    runAgentMock.mockReset();
    updateCommentActiveMock.mockClear();
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("creates multiple independent snapshots and activates the last", async () => {
    let call = 0;
    runAgentMock.mockImplementation(() => {
      call += 1;
      writeFileSync(
        sourcePath,
        `${baselineSource}\n// variant ${call}`,
        "utf8"
      );
      return Promise.resolve({
        ok: true,
        modelUsed: "composer-2.5-fast",
        turnsUsed: 1,
        toolCalls: 1,
        attempts: [],
      });
    });

    const { events, stream } = createTestStream();
    await runNewIteration({
      projectRoot,
      found,
      id: commentId,
      model: "composer-2.5-fast",
      count: 2,
      skills: [],
      stream,
    });

    expect(runAgentMock).toHaveBeenCalledTimes(2);
    expect(
      readFileSync(
        path.join(projectRoot, "designs", "iterations", commentId, "v1.tsx"),
        "utf8"
      )
    ).toContain("// variant 1");
    expect(
      readFileSync(
        path.join(projectRoot, "designs", "iterations", commentId, "v2.tsx"),
        "utf8"
      )
    ).toContain("// variant 2");
    expect(readFileSync(sourcePath, "utf8")).toContain("// variant 2");
    expect(updateCommentActiveMock).toHaveBeenCalledTimes(1);
    expect(updateCommentActiveMock).toHaveBeenCalledWith({
      absolutePath: sourcePath,
      commentId,
      active: 2,
    });

    const done = events.at(-1) as {
      type: string;
      ok: boolean;
      changed?: boolean;
      v?: number;
      versions?: number[];
    };
    expect(done).toMatchObject({
      type: "done",
      ok: true,
      changed: true,
      v: 2,
      versions: [1, 2],
    });
  });

  it("restores baseline before each variant", async () => {
    runAgentMock.mockImplementation(() => {
      const current = readFileSync(sourcePath, "utf8");
      expect(current).toBe(baselineSource);
      writeFileSync(sourcePath, `${baselineSource}\n// edited`, "utf8");
      return Promise.resolve({
        ok: true,
        modelUsed: "composer-2.5-fast",
        turnsUsed: 1,
        toolCalls: 1,
        attempts: [],
      });
    });

    const { stream } = createTestStream();
    await runNewIteration({
      projectRoot,
      found,
      id: commentId,
      model: "composer-2.5-fast",
      count: 2,
      skills: [],
      stream,
    });

    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("returns changed false when every variant makes no diff", async () => {
    runAgentMock.mockResolvedValue({
      ok: true,
      modelUsed: "composer-2.5-fast",
      turnsUsed: 1,
      toolCalls: 0,
      attempts: [],
    });

    const { events, stream } = createTestStream();
    await runNewIteration({
      projectRoot,
      found,
      id: commentId,
      model: "composer-2.5-fast",
      count: 2,
      skills: [],
      stream,
    });

    expect(runAgentMock).toHaveBeenCalledTimes(2);
    expect(
      existsSync(
        path.join(projectRoot, "designs", "iterations", commentId, "v1.tsx")
      )
    ).toBe(false);
    expect(updateCommentActiveMock).not.toHaveBeenCalled();

    const done = events.at(-1) as { ok: boolean; changed?: boolean };
    expect(done).toMatchObject({ ok: true, changed: false });
  });
});
