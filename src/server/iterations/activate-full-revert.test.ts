import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FoundComment } from "../comments/find-comment.ts";
import { readCommentsFromSource } from "../comments/reader.ts";
import { applyIterationVersionToSource } from "./activate-version.ts";

const marker = (id: string, anchor: string, extra = "") =>
  `{/* @comment id="${id}" anchor="${anchor}" text="punch it up" author="dev@local" date="2026-01-01T00:00:00.000Z"${extra} */}`;

describe("applyIterationVersionToSource — full design revert", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("reverts agent edits made OUTSIDE the anchored element when switching to v0", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-fullrevert-"));
    const sourcePath = path.join(projectRoot, "src", "Page.tsx");
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    const original = `export function Page() {
  return (
    <main className="p-4">
      <button data-comment-anchor="anchor-a">Original</button>
      ${marker("comment-a", "anchor-a")}
    </main>
  );
}
`;
    // The agent's v2 changed BOTH the button AND the surrounding <main> wrapper.
    const v2 = `export function Page() {
  return (
    <main className="p-99 bg-red-500">
      <button data-comment-anchor="anchor-a">Variant 2</button>
      ${marker("comment-a", "anchor-a", " active=2")}
    </main>
  );
}
`;
    await writeFile(sourcePath, v2, "utf8");
    await writeFile(path.join(iterDir, "v0.tsx"), original, "utf8");
    await writeFile(path.join(iterDir, "v2.tsx"), v2, "utf8");

    const found: FoundComment = {
      absolutePath: sourcePath,
      relativePath: "src/Page.tsx",
      siblingIds: [],
      comment: { id: "comment-a", anchor: "anchor-a", text: "punch it up" },
    };

    const result = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      0,
      projectRoot
    );
    expect(result.ok).toBe(true);

    const output = await readFile(sourcePath, "utf8");
    expect(output).toContain("Original");
    expect(output).not.toContain("Variant 2");
    // The surrounding wrapper reverts too — this is the fix.
    expect(output).toContain("p-4");
    expect(output).not.toContain("p-99");

    const { comments } = readCommentsFromSource(output);
    expect(comments.find((c) => c.id === "comment-a")?.active).toBe(0);
  });

  it("leaves sibling comments untouched while reverting the target's full design", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-fullrevert-sib-"));
    const sourcePath = path.join(projectRoot, "src", "Page.tsx");
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    // Snapshot (v0) of comment-a's design, taken when comment-b was still in
    // its OWN baseline state ("B baseline").
    const v0 = `export function Page() {
  return (
    <main className="p-4">
      <button data-comment-anchor="anchor-a">A original</button>
      ${marker("comment-a", "anchor-a")}
      <span data-comment-anchor="anchor-b">B baseline</span>
      ${marker("comment-b", "anchor-b")}
    </main>
  );
}
`;
    // Live source: comment-a is at v2 (changed wrapper + element) AND comment-b
    // has since been switched to its own variant ("B variant").
    const live = `export function Page() {
  return (
    <main className="p-99 bg-red-500">
      <button data-comment-anchor="anchor-a">A variant 2</button>
      ${marker("comment-a", "anchor-a", " active=2")}
      <span data-comment-anchor="anchor-b">B variant</span>
      ${marker("comment-b", "anchor-b", " active=1")}
    </main>
  );
}
`;
    await writeFile(sourcePath, live, "utf8");
    await writeFile(path.join(iterDir, "v0.tsx"), v0, "utf8");
    await writeFile(path.join(iterDir, "v2.tsx"), live, "utf8");

    const found: FoundComment = {
      absolutePath: sourcePath,
      relativePath: "src/Page.tsx",
      siblingIds: ["comment-b"],
      comment: { id: "comment-a", anchor: "anchor-a", text: "punch it up" },
    };

    const result = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      0,
      projectRoot
    );
    expect(result.ok).toBe(true);

    const output = await readFile(sourcePath, "utf8");
    // comment-a's whole design reverted (element + wrapper):
    expect(output).toContain("A original");
    expect(output).toContain("p-4");
    expect(output).not.toContain("p-99");
    // comment-b is left exactly as it currently renders — NOT reverted to the
    // snapshot's "B baseline".
    expect(output).toContain("B variant");
    expect(output).not.toContain("B baseline");

    const { comments, warnings } = readCommentsFromSource(output);
    expect(warnings).toEqual([]);
    expect(comments.find((c) => c.id === "comment-a")?.active).toBe(0);
    expect(comments.find((c) => c.id === "comment-b")?.active).toBe(1);
  });
});
