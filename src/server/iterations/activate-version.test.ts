import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FoundComment } from "../comments/find-comment.ts";
import { readCommentsFromSource } from "../comments/reader.ts";
import { applyIterationVersionToSource } from "./activate-version.ts";

describe("applyIterationVersionToSource", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("switches only the selected anchor and preserves other comments in the file", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-activate-"));
    const sourcePath = path.join(projectRoot, "src", "Page.tsx");
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    const currentSource = `export function Page() {
  return (
    <main>
      <button data-comment-anchor="anchor-a">Use baseline</button>
      {/* @comment id="comment-a" anchor="anchor-a" text="make it stronger" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
      <section data-comment-anchor="anchor-b">Keep the live card</section>
      {/* @comment id="comment-b" anchor="anchor-b" text="other component" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
    </main>
  );
}
`;
    const snapshotSource = `export function Page() {
  return (
    <main>
      <button data-comment-anchor="anchor-a">Use bold version</button>
      <section>Old snapshot card</section>
    </main>
  );
}
`;
    await writeFile(sourcePath, currentSource, "utf8");
    await writeFile(path.join(iterDir, "v1.tsx"), snapshotSource, "utf8");

    const found: FoundComment = {
      absolutePath: sourcePath,
      relativePath: "src/Page.tsx",
      siblingIds: ["comment-b"],
      comment: {
        id: "comment-a",
        anchor: "anchor-a",
        text: "make it stronger",
      },
    };

    const result = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      1
    );

    expect(result).toEqual({ ok: true });
    const output = await readFile(sourcePath, "utf8");
    expect(output).toContain("Use bold version");
    expect(output).toContain("Keep the live card");
    expect(output).not.toContain("Old snapshot card");

    const { comments, warnings } = readCommentsFromSource(output);
    expect(warnings).toEqual([]);
    expect(comments.map((comment) => comment.id).sort()).toEqual([
      "comment-a",
      "comment-b",
    ]);
    expect(comments.find((comment) => comment.id === "comment-a")?.active).toBe(
      1
    );
    expect(
      comments.find((comment) => comment.id === "comment-b")?.active
    ).toBeUndefined();
  });

  it("switches the repeated instance next to the comment marker when anchors are duplicated", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "redline-activate-"));
    const sourcePath = path.join(projectRoot, "src", "Page.tsx");
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    const currentSource = `export function Page() {
  return (
    <main>
      <button data-comment-anchor="shared-anchor">First live copy</button>
      <button data-comment-anchor="shared-anchor">Second baseline copy</button>
      {/* @comment id="comment-a" anchor="shared-anchor" text="make only this copy bold" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
    </main>
  );
}
`;
    const snapshotSource = `export function Page() {
  return (
    <main>
      <button data-comment-anchor="shared-anchor">First snapshot copy</button>
      <button data-comment-anchor="shared-anchor">Second variant copy</button>
      {/* @comment id="comment-a" anchor="shared-anchor" text="make only this copy bold" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
    </main>
  );
}
`;
    await writeFile(sourcePath, currentSource, "utf8");
    await writeFile(path.join(iterDir, "v1.tsx"), snapshotSource, "utf8");

    const found: FoundComment = {
      absolutePath: sourcePath,
      relativePath: "src/Page.tsx",
      siblingIds: [],
      comment: {
        id: "comment-a",
        anchor: "shared-anchor",
        text: "make only this copy bold",
      },
    };

    const result = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      1
    );

    expect(result).toEqual({ ok: true });
    const output = await readFile(sourcePath, "utf8");
    expect(output).toContain("First live copy");
    expect(output).not.toContain("First snapshot copy");
    expect(output).toContain("Second variant copy");
    expect(output).not.toContain("Second baseline copy");

    const { comments, warnings } = readCommentsFromSource(output);
    expect(warnings).toEqual([]);
    expect(comments.find((comment) => comment.id === "comment-a")?.active).toBe(
      1
    );
  });
});
