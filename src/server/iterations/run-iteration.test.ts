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

const ACTIVE_2_RE = /\bactive=2\b/;

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

function agentTargetPath(projectRoot: string, file: string): string {
  return path.join(projectRoot, file);
}

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
  return (
    <div data-comment-anchor="anchor-1">
      baseline
      {/* @comment id="comment-1" anchor="anchor-1" text="make it blue" author="dev@local" date="2026-01-01T00:00:00.000Z" active=0 */}
    </div>
  );
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
    projectRoot = mkdtempSync(path.join(tmpdir(), "forkdesign-run-iteration-"));
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
    const sourceAppliedEvents: object[] = [];
    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot, file }) => {
      call += 1;
      const target = agentTargetPath(workspaceRoot, file);
      writeFileSync(
        target,
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
      hooks: {
        onSourceApplied: (event) => {
          sourceAppliedEvents.push(event);
        },
      },
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
    const finalSource = readFileSync(sourcePath, "utf8");
    expect(finalSource).toMatch(ACTIVE_2_RE);
    expect(updateCommentActiveMock).not.toHaveBeenCalled();
    expect(sourceAppliedEvents).toEqual([
      {
        absolutePath: sourcePath,
        active: 2,
        file: "src/Widget.tsx",
        id: commentId,
      },
    ]);

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

  it("restores baseline before each variant in the agent workspace", async () => {
    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot, file }) => {
      const target = agentTargetPath(workspaceRoot, file);
      const current = readFileSync(target, "utf8");
      expect(current).toBe(baselineSource);
      writeFileSync(target, `${baselineSource}\n// edited`, "utf8");
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
    expect(readFileSync(sourcePath, "utf8")).toMatch(ACTIVE_2_RE);
  });

  it("does not mutate live source during the variant loop", async () => {
    let call = 0;
    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot, file }) => {
      call += 1;
      expect(readFileSync(sourcePath, "utf8")).toBe(baselineSource);
      writeFileSync(
        agentTargetPath(workspaceRoot, file),
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
    expect(readFileSync(sourcePath, "utf8")).toMatch(ACTIVE_2_RE);
  });

  it("does not block the next variant on client screenshot upload", async () => {
    let call = 0;
    const screenshotRequested: number[] = [];

    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot, file }) => {
      call += 1;
      writeFileSync(
        agentTargetPath(workspaceRoot, file),
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

    const { stream } = createTestStream();
    const runPromise = runNewIteration({
      projectRoot,
      found,
      id: commentId,
      model: "composer-2.5-fast",
      count: 2,
      hooks: {
        onVariantScreenshotRequested: (event) => {
          screenshotRequested.push(event.version);
        },
      },
      skills: [],
      stream,
    });

    await runPromise;

    expect(screenshotRequested).toEqual([]);
    expect(runAgentMock).toHaveBeenCalledTimes(2);
  });

  it("restores the live source tree when cancelled after the agent edited the workspace", async () => {
    const cardPath = path.join(projectRoot, "src", "Card.tsx");
    const baselineCard = "export const Card = () => <div>old</div>;\n";
    writeFileSync(cardPath, baselineCard, "utf8");

    const { stream } = createTestStream();
    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot, file }) => {
      writeFileSync(
        agentTargetPath(workspaceRoot, file),
        `${baselineSource}\n// cancelled edit`,
        "utf8"
      );
      writeFileSync(
        path.join(workspaceRoot, "src", "Card.tsx"),
        "export const Card = () => <div>new</div>;\n"
      );
      stream.abortController.abort();
      return Promise.resolve({
        ok: true,
        modelUsed: "composer-2.5-fast",
        turnsUsed: 1,
        toolCalls: 1,
        attempts: [],
      });
    });

    await runNewIteration({
      projectRoot,
      found,
      id: commentId,
      model: "composer-2.5-fast",
      count: 1,
      skills: [],
      stream,
    });

    expect(readFileSync(sourcePath, "utf8")).toBe(baselineSource);
    expect(readFileSync(cardPath, "utf8")).toBe(baselineCard);
    expect(
      existsSync(
        path.join(projectRoot, "designs", "iterations", commentId, "v1.tsx")
      )
    ).toBe(false);
  });

  it("captures cross-file edits (reused component) as aux snapshots", async () => {
    const iterDir = path.join(projectRoot, "designs", "iterations", commentId);
    const cardPath = path.join(projectRoot, "src", "Card.tsx");
    const widgetWithMarker = `export function Widget() {
  return (
    <div>
      <Card data-comment-anchor="anchor-1" />
      {/* @comment id="comment-1" anchor="anchor-1" text="make it blue" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
    </div>
  );
}
`;
    writeFileSync(sourcePath, widgetWithMarker, "utf8");
    writeFileSync(
      cardPath,
      "export const Card = () => <div>old</div>;\n",
      "utf8"
    );

    runAgentMock.mockImplementation(({ projectRoot: workspaceRoot }) => {
      writeFileSync(
        path.join(workspaceRoot, "src", "Card.tsx"),
        "export const Card = () => <div>new</div>;\n",
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
      count: 1,
      skills: [],
      stream,
    });

    const auxV1 = JSON.parse(
      readFileSync(path.join(iterDir, "v1.files.json"), "utf8")
    ) as Record<string, string>;
    expect(auxV1["src/Card.tsx"]).toContain("new");

    const auxV0 = JSON.parse(
      readFileSync(path.join(iterDir, "v0.files.json"), "utf8")
    ) as Record<string, string>;
    expect(auxV0["src/Card.tsx"]).toContain("old");

    expect(readFileSync(cardPath, "utf8")).toContain("new");

    const done = events.at(-1) as { ok: boolean; changed?: boolean };
    expect(done).toMatchObject({ ok: true, changed: true });
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
