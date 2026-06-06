import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultSummaryForVersion,
  deleteVersionArtifactsAllRoots,
  enrichVersionMeta,
  findVersionSnapshotPath,
  iterationPngUrl,
  listCompleteIterationVersionsAllRoots,
  mergeVersionEntry,
  mergeVersionSlotsFromDirEntries,
  nextIterationVersion,
  parseManifestJson,
  patchIterationsManifest,
  readIterationsManifest,
  removeVersionFromManifest,
} from "./manifest.ts";

describe("parseManifestJson", () => {
  it("parses valid manifest", () => {
    const m = parseManifestJson(
      JSON.stringify({
        versions: {
          "0": { summary: "Baseline", createdAt: "2026-01-01T00:00:00.000Z" },
          "1": {
            summary: "Red CTA",
            createdAt: "2026-01-02T00:00:00.000Z",
            runId: "run-a",
          },
        },
      })
    );
    expect(m.versions["0"]?.summary).toBe("Baseline");
    expect(m.versions["1"]?.summary).toBe("Red CTA");
    expect(m.versions["1"]?.runId).toBe("run-a");
  });

  it("returns empty versions for invalid json", () => {
    expect(parseManifestJson("not json").versions).toEqual({});
  });
});

describe("removeVersionFromManifest", () => {
  it("drops one version without removing others", () => {
    const base = parseManifestJson(
      JSON.stringify({
        versions: {
          "0": { summary: "Baseline", createdAt: "2026-01-01T00:00:00.000Z" },
          "1": { summary: "Agent v1", createdAt: "2026-01-02T00:00:00.000Z" },
          "2": { summary: "Agent v2", createdAt: "2026-01-03T00:00:00.000Z" },
        },
      })
    );
    const next = removeVersionFromManifest(base, 1);
    expect(next.versions["0"]?.summary).toBe("Baseline");
    expect(next.versions["1"]).toBeUndefined();
    expect(next.versions["2"]?.summary).toBe("Agent v2");
  });
});

describe("mergeVersionEntry", () => {
  it("merges without dropping other versions", () => {
    const base = parseManifestJson(
      JSON.stringify({
        versions: {
          "0": { summary: "Baseline", createdAt: "2026-01-01T00:00:00.000Z" },
        },
      })
    );
    const next = mergeVersionEntry(base, 1, {
      summary: "Agent v1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(next.versions["0"]?.summary).toBe("Baseline");
    expect(next.versions["1"]?.summary).toBe("Agent v1");
  });
});

describe("enrichVersionMeta", () => {
  it("uses manifest when present", () => {
    const meta = enrichVersionMeta(
      1,
      {
        summary: "Custom",
        createdAt: "2026-05-01T12:00:00.000Z",
        runId: "run-a",
      },
      1000
    );
    expect(meta.summary).toBe("Custom");
    expect(meta.createdAt).toBe("2026-05-01T12:00:00.000Z");
    expect(meta.runId).toBe("run-a");
  });

  it("falls back to defaults and mtime", () => {
    const meta = enrichVersionMeta(0, null, 1_700_000_000_000);
    expect(meta.summary).toBe("Baseline");
    expect(meta.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("defaultSummaryForVersion", () => {
    expect(defaultSummaryForVersion(0)).toBe("Baseline");
    expect(defaultSummaryForVersion(2)).toBe("AI edit");
  });
});

describe("iterationPngUrl", () => {
  it("appends mtime cache buster when present", () => {
    expect(iterationPngUrl("abc", 2, 1_700_000_000_123.7)).toBe(
      "/designs/iterations/abc/v2.png?t=1700000000123"
    );
  });

  it("returns bare path when mtime is missing", () => {
    expect(iterationPngUrl("abc", 1, null)).toBe(
      "/designs/iterations/abc/v1.png"
    );
  });
});

describe("deleteVersionArtifactsAllRoots", () => {
  it("removes version files from every iteration root", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "redline-iter-"));
    const primary = path.join(base, "designs");
    const legacy = path.join(base, "public");
    await mkdir(primary, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(primary, "v0.tsx"), "baseline", "utf8");
    await writeFile(path.join(primary, "v0.png"), "png0", "utf8");
    await writeFile(path.join(primary, "v1.tsx"), "fix1", "utf8");
    await writeFile(path.join(primary, "v1.png"), "png1", "utf8");
    await writeFile(path.join(legacy, "v1.png"), "legacy-png1", "utf8");
    await patchIterationsManifest(primary, 1, {
      summary: "Agent v1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await patchIterationsManifest(legacy, 1, {
      summary: "Agent v1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });

    await deleteVersionArtifactsAllRoots([primary, legacy], 1);

    expect(existsSync(path.join(primary, "v1.tsx"))).toBe(false);
    expect(existsSync(path.join(primary, "v1.png"))).toBe(false);
    expect(existsSync(path.join(legacy, "v1.png"))).toBe(false);
    expect(existsSync(path.join(primary, "v0.tsx"))).toBe(true);
    const manifest = await readIterationsManifest(primary);
    expect(manifest?.versions["1"]).toBeUndefined();
  });
});

describe("listCompleteIterationVersionsAllRoots", () => {
  it("merges tsx/png across split roots", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "redline-merge-"));
    const primary = path.join(base, "designs");
    const legacy = path.join(base, "public");
    await mkdir(primary, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(path.join(legacy, "v0.tsx"), "baseline", "utf8");
    await writeFile(path.join(legacy, "v0.png"), "png0", "utf8");
    await writeFile(path.join(primary, "v1.tsx"), "fix1", "utf8");
    await writeFile(path.join(primary, "v1.png"), "png1", "utf8");

    const versions = await listCompleteIterationVersionsAllRoots([
      primary,
      legacy,
    ]);
    expect(versions).toEqual([0, 1]);
    expect(findVersionSnapshotPath([primary, legacy], 0)).toBe(
      path.join(legacy, "v0.tsx")
    );
  });
});

describe("mergeVersionSlotsFromDirEntries", () => {
  it("merges tsx and png slots from filenames", () => {
    const present = new Map<number, { tsx: boolean; png: boolean }>();
    mergeVersionSlotsFromDirEntries(present, [
      "v0.tsx",
      "v0.png",
      "v1.tsx",
      "manifest.json",
    ]);
    expect(present.get(0)).toEqual({ tsx: true, png: true });
    expect(present.get(1)).toEqual({ tsx: true, png: false });
  });
});

describe("nextIterationVersion", () => {
  it("returns 1 for a new directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "redline-next-v-"));
    const result = await nextIterationVersion(dir);
    expect(result).toEqual({ ok: true, nextV: 1 });
  });

  it("increments from highest existing v{N}.tsx", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "redline-next-v-"));
    await writeFile(path.join(dir, "v0.tsx"), "baseline", "utf8");
    await writeFile(path.join(dir, "v2.tsx"), "fix", "utf8");
    const result = await nextIterationVersion(dir);
    expect(result).toEqual({ ok: true, nextV: 3 });
  });
});

describe("patchIterationsManifest", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "redline-manifest-"));
  });

  afterEach(async () => {
    // temp cleanup is best-effort; OS reclaims tmp dirs
  });

  it("writes and reads manifest on disk", async () => {
    await patchIterationsManifest(dir, 0, {
      summary: "Baseline",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await patchIterationsManifest(dir, 1, {
      summary: "Edit colors",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    const raw = await readFile(path.join(dir, "manifest.json"), "utf8");
    expect(raw).toContain("Edit colors");
    const read = await readIterationsManifest(dir);
    expect(read?.versions["1"]?.summary).toBe("Edit colors");
  });
});
