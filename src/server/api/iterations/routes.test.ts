import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCommentToFile } from "../../comments/writer.ts";
import {
  createJsonRequest,
  createMockResponse,
} from "../../platform/http-test-helpers.ts";
import {
  finishIterationRun,
  startIterationRun,
} from "../../iterations/runs.ts";
import {
  handleIterationsActivate,
  handleIterationsDelete,
  handleIterationsNew,
} from "./routes.ts";

const model = "composer-2.5-fast" as const;

async function createProjectWithComment(): Promise<{
  id: string;
  projectRoot: string;
}> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "iterations-routes-"));
  const relativeFile = "src/Page.tsx";
  const absoluteFile = path.join(projectRoot, relativeFile);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(
    absoluteFile,
    `export function Page() {
  return (
    <main>
      <button>Save</button>
    </main>
  );
}
`,
    "utf8"
  );
  const comment = await writeCommentToFile({
    absolutePath: absoluteFile,
    line: 4,
    column: 7,
    text: "make it better",
    author: "dev@local",
  });
  await mkdir(
    path.join(projectRoot, "public", "designs", "iterations", comment.id),
    { recursive: true }
  );
  return { id: comment.id, projectRoot };
}

describe("iteration route active-run guards", () => {
  let projectRoot: string | undefined;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = undefined;
    }
  });

  it("rejects activation while an iteration is running", async () => {
    const id = "comment-activate";
    const abortController = startIterationRun({
      anchor: "anchor-1",
      commentId: id,
      count: 1,
      model,
      startedAt: Date.now(),
    });
    try {
      const mock = createMockResponse();
      const req = createJsonRequest({ id, v: 1 });

      await handleIterationsActivate(req, mock.res, "/tmp/project", []);

      expect(mock.getStatus()).toBe(409);
      expect(mock.getJson()).toEqual({
        error: "cannot activate versions while iteration is running",
      });
    } finally {
      finishIterationRun(id, abortController);
    }
  });

  it("rejects version deletion while an iteration is running", async () => {
    const id = "comment-delete";
    const abortController = startIterationRun({
      anchor: "anchor-1",
      commentId: id,
      count: 1,
      model,
      startedAt: Date.now(),
    });
    try {
      const mock = createMockResponse();
      const req = createJsonRequest({ id, v: 1 });

      await handleIterationsDelete(req, mock.res, "/tmp/project", []);

      expect(mock.getStatus()).toBe(409);
      expect(mock.getJson()).toEqual({
        error: "cannot delete versions while iteration is running",
      });
    } finally {
      finishIterationRun(id, abortController);
    }
  });

  it("rejects a second iteration for the same comment", async () => {
    const seeded = await createProjectWithComment();
    projectRoot = seeded.projectRoot;
    const abortController = startIterationRun({
      anchor: "anchor-1",
      commentId: seeded.id,
      count: 1,
      model,
      startedAt: Date.now(),
    });
    try {
      const mock = createMockResponse();
      const req = createJsonRequest({ id: seeded.id });

      await handleIterationsNew(req, mock.res, projectRoot, []);

      expect(mock.getStatus()).toBe(409);
      expect(mock.getJson()).toEqual({ error: "iteration already running" });
    } finally {
      finishIterationRun(seeded.id, abortController);
    }
  });
});
