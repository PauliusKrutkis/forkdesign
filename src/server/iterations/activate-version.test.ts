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
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-activate-"));
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
      1,
      projectRoot
    );

    expect(result.ok).toBe(true);
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
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-activate-"));
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
      1,
      projectRoot
    );

    expect(result.ok).toBe(true);
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

  it("restores and reverts cross-file (reused-component) edits when switching", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "forkdesign-activate-"));
    const sourcePath = path.join(projectRoot, "src", "Page.tsx");
    const cardPath = path.join(projectRoot, "src", "Card.tsx");
    const iterDir = path.join(
      projectRoot,
      "designs",
      "iterations",
      "comment-a"
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(iterDir, { recursive: true });

    // The comment is on a reused <Card>; the agent restyled Card's OWN file,
    // so the comment file is identical across versions and the real change
    // lives in the auxiliary snapshot.
    const pageSource = `export function Page() {
  return (
    <main>
      <Card data-comment-anchor="anchor-a" />
      {/* @comment id="comment-a" anchor="anchor-a" text="punch it up" author="dev@local" date="2026-01-01T00:00:00.000Z" */}
    </main>
  );
}
`;
    const baselineCard = "export const Card = () => <div>BASELINE</div>;\n";
    const variantCard = "export const Card = () => <div>VARIANT</div>;\n";

    await writeFile(sourcePath, pageSource, "utf8");
    await writeFile(cardPath, variantCard, "utf8");
    await writeFile(path.join(iterDir, "v0.tsx"), pageSource, "utf8");
    await writeFile(path.join(iterDir, "v1.tsx"), pageSource, "utf8");
    await writeFile(
      path.join(iterDir, "v0.files.json"),
      JSON.stringify({ "src/Card.tsx": baselineCard }),
      "utf8"
    );
    await writeFile(
      path.join(iterDir, "v1.files.json"),
      JSON.stringify({ "src/Card.tsx": variantCard }),
      "utf8"
    );

    const found: FoundComment = {
      absolutePath: sourcePath,
      relativePath: "src/Page.tsx",
      siblingIds: [],
      comment: {
        id: "comment-a",
        anchor: "anchor-a",
        text: "punch it up",
      },
    };

    const toV1 = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      1,
      projectRoot
    );
    expect(toV1.ok).toBe(true);
    if (toV1.ok) {
      expect(toV1.writtenFiles).toContain(cardPath);
    }
    expect(await readFile(cardPath, "utf8")).toContain("VARIANT");

    const toV0 = await applyIterationVersionToSource(
      found,
      [iterDir],
      "comment-a",
      0,
      projectRoot
    );
    expect(toV0.ok).toBe(true);
    expect(await readFile(cardPath, "utf8")).toContain("BASELINE");
  });
});
