import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultSummaryForVersion,
  enrichVersionMeta,
  mergeVersionEntry,
  parseManifestJson,
  patchIterationsManifest,
  readIterationsManifest,
  removeVersionFromManifest,
} from "./iterations-manifest.ts";

describe("parseManifestJson", () => {
  it("parses valid manifest", () => {
    const m = parseManifestJson(
      JSON.stringify({
        versions: {
          "0": { summary: "Baseline", createdAt: "2026-01-01T00:00:00.000Z" },
          "1": { summary: "Red CTA", createdAt: "2026-01-02T00:00:00.000Z" },
        },
      })
    );
    expect(m.versions["0"]?.summary).toBe("Baseline");
    expect(m.versions["1"]?.summary).toBe("Red CTA");
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
          "1": { summary: "Fix v1", createdAt: "2026-01-02T00:00:00.000Z" },
          "2": { summary: "Fix v2", createdAt: "2026-01-03T00:00:00.000Z" },
        },
      })
    );
    const next = removeVersionFromManifest(base, 1);
    expect(next.versions["0"]?.summary).toBe("Baseline");
    expect(next.versions["1"]).toBeUndefined();
    expect(next.versions["2"]?.summary).toBe("Fix v2");
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
      summary: "Fix v1",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    expect(next.versions["0"]?.summary).toBe("Baseline");
    expect(next.versions["1"]?.summary).toBe("Fix v1");
  });
});

describe("enrichVersionMeta", () => {
  it("uses manifest when present", () => {
    const meta = enrichVersionMeta(
      1,
      { summary: "Custom", createdAt: "2026-05-01T12:00:00.000Z" },
      1000
    );
    expect(meta.summary).toBe("Custom");
    expect(meta.createdAt).toBe("2026-05-01T12:00:00.000Z");
  });

  it("falls back to defaults and mtime", () => {
    const meta = enrichVersionMeta(0, null, 1_700_000_000_000);
    expect(meta.summary).toBe("Baseline");
    expect(meta.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it("defaultSummaryForVersion", () => {
    expect(defaultSummaryForVersion(0)).toBe("Baseline");
    expect(defaultSummaryForVersion(2)).toBe("AI fix");
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
