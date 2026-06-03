import { describe, expect, it } from "vitest";
import type { IterationVersion } from "../hooks/use-iterations.ts";
import { buildTranscript } from "./build-transcript.ts";

const version = (
  overrides: Partial<IterationVersion> = {}
): IterationVersion => ({
  v: 0,
  png: "/p.png",
  tsx: "<div/>",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const baseArgs = {
  id: "c1",
  text: "make it bolder",
  author: "alice@example.com",
  date: "2026-01-01T10:00:00.000Z",
};

describe("buildTranscript", () => {
  it("returns just the comment when no fixes exist", () => {
    const entries = buildTranscript({
      ...baseArgs,
      versions: [version({ v: 0 })],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("comment");
  });

  it("pins the comment first and baseline second once fixes exist", () => {
    const entries = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "1970-01-01T00:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
      ],
    });
    expect(entries.map((e) => e.kind)).toEqual([
      "comment",
      "variants",
      "variants",
    ]);
    const baseline = entries[1];
    expect(baseline.kind === "variants" && baseline.isBaseline).toBe(true);
    const fix = entries[2];
    expect(fix.kind === "variants" && fix.isBaseline).toBe(false);
  });

  it("groups versions from one run (shared createdAt) into a single group", () => {
    const entries = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "1970-01-01T00:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 2, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 3, createdAt: "2026-01-01T10:05:00.000Z" }),
      ],
    });
    const groups = entries.filter((e) => e.kind === "variants");
    expect(groups).toHaveLength(2); // baseline + one fix run
    const fixGroup = groups.find((g) => g.kind === "variants" && !g.isBaseline);
    expect(
      fixGroup?.kind === "variants" && fixGroup.versions.map((v) => v.v)
    ).toEqual([1, 2, 3]);
  });

  it("interleaves replies with fix groups by date", () => {
    const entries = buildTranscript({
      ...baseArgs,
      replies: [
        {
          author: "alice@example.com",
          date: "2026-01-01T10:10:00.000Z",
          text: "closer",
          v: 1,
        },
      ],
      versions: [
        version({ v: 0, createdAt: "1970-01-01T00:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 2, createdAt: "2026-01-01T10:15:00.000Z" }),
      ],
    });
    // comment, baseline, fix@10:05, reply@10:10, fix@10:15
    expect(entries.map((e) => e.kind)).toEqual([
      "comment",
      "variants",
      "variants",
      "reply",
      "variants",
    ]);
  });
});
