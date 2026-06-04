import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCommentToFile } from "../comments/writer.ts";
import { resolveCommentIterationContext } from "./context.ts";

describe("resolveCommentIterationContext", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      const { rm } = await import("node:fs/promises");
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns 404 when comment id is missing", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-ctx-"));
    const result = await resolveCommentIterationContext(
      projectRoot,
      "missing-id",
      []
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      message: "comment id not found: missing-id",
    });
  });

  it("returns 404 when iterations dir is missing", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-ctx-"));
    const relativeFile = "src/pages/Widget.tsx";
    const absoluteFile = path.join(projectRoot, relativeFile);
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(
      absoluteFile,
      `export function P() {
  return <button>Save</button>;
}
`,
      "utf8"
    );
    const created = await writeCommentToFile({
      absolutePath: absoluteFile,
      line: 2,
      column: 10,
      text: "hello",
      author: "dev@local",
    });

    const result = await resolveCommentIterationContext(
      projectRoot,
      created.id,
      []
    );
    expect(result).toEqual({
      ok: false,
      status: 404,
      message: `iterations dir not found: ${created.id}`,
    });
  });

  it("resolves comment and iteration roots", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-ctx-"));
    const relativeFile = "src/pages/Widget.tsx";
    const absoluteFile = path.join(projectRoot, relativeFile);
    await mkdir(path.dirname(absoluteFile), { recursive: true });
    await writeFile(
      absoluteFile,
      `export function P() {
  return <button>Save</button>;
}
`,
      "utf8"
    );
    const created = await writeCommentToFile({
      absolutePath: absoluteFile,
      line: 2,
      column: 10,
      text: "hello",
      author: "dev@local",
    });

    const iterDir = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      created.id
    );
    await mkdir(iterDir, { recursive: true });
    await writeFile(path.join(iterDir, "v0.tsx"), "baseline", "utf8");
    await writeFile(path.join(iterDir, "v0.png"), "png", "utf8");

    const result = await resolveCommentIterationContext(
      projectRoot,
      created.id,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.found.relativePath).toBe(relativeFile);
    expect(result.iterationRoots).toEqual([iterDir]);
    expect(result.iterDir).toBe(iterDir);
  });
});
