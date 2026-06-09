import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedBaselineIteration } from "./baseline.ts";
import { readIterationsManifest } from "./manifest.ts";

describe("seedBaselineIteration", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      const { rm } = await import("node:fs/promises");
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes v0 artifacts under public/designs/iterations", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "design-crit-baseline-"));
    const commentId = "abc-123";
    const source = `/** @comment id="${commentId}" anchor="x" */`;

    const url = await seedBaselineIteration(
      projectRoot,
      commentId,
      Buffer.from("png-bytes"),
      source
    );

    expect(url).toBe(`/designs/iterations/${commentId}/v0.png`);
    const iterDir = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      commentId
    );
    expect(readFileSync(path.join(iterDir, "v0.tsx"), "utf8")).toBe(source);
    expect(readFileSync(path.join(iterDir, "v0.png"), "utf8")).toBe(
      "png-bytes"
    );
    const manifest = await readIterationsManifest(iterDir);
    expect(manifest?.versions["0"]?.summary).toBe("Baseline");
  });

  it("returns null when there is nothing to persist", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "design-crit-baseline-"));
    const url = await seedBaselineIteration(projectRoot, "id", null, null);
    expect(url).toBeNull();
    expect(
      existsSync(
        path.join(projectRoot, "public", "designs", "iterations", "id")
      )
    ).toBe(false);
  });

  it("writes tsx-only baseline without screenshot", async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "design-crit-baseline-"));
    const commentId = "tsx-only";
    await seedBaselineIteration(projectRoot, commentId, null, "source");
    const tsxPath = path.join(
      projectRoot,
      "public",
      "designs",
      "iterations",
      commentId,
      "v0.tsx"
    );
    expect(existsSync(tsxPath)).toBe(true);
  });
});
