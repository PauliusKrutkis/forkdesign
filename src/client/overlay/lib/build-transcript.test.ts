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
  it("returns a single comment turn with no runs when there are no agent runs", () => {
    const { turns, baseline } = buildTranscript({
      ...baseArgs,
      versions: [version({ v: 0 })],
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.instruction.kind).toBe("comment");
    expect(turns[0]?.runs).toHaveLength(0);
    expect(baseline?.v).toBe(0);
  });

  it("attaches an auto-agent run to the original comment turn", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:00:05.000Z" }),
      ],
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.runs).toHaveLength(1);
    expect(turns[0]?.runs[0]?.versions.map((v) => v.v)).toEqual([1]);
  });

  it("groups versions from one run (shared createdAt) into a single run", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 2, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 3, createdAt: "2026-01-01T10:05:00.000Z" }),
      ],
    });
    expect(turns[0]?.runs).toHaveLength(1);
    expect(turns[0]?.runs[0]?.versions.map((v) => v.v)).toEqual([1, 2, 3]);
  });

  it("groups versions from one run by runId", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({
          v: 1,
          createdAt: "2026-01-01T10:05:00.000Z",
          runId: "run-a",
        }),
        version({
          v: 2,
          createdAt: "2026-01-01T10:06:00.000Z",
          runId: "run-a",
        }),
      ],
    });
    expect(turns[0]?.runs).toHaveLength(1);
    expect(turns[0]?.runs[0]?.versions.map((v) => v.v)).toEqual([1, 2]);
  });

  it("groups adjacent legacy versions saved close together", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 2, createdAt: "2026-01-01T10:06:30.000Z" }),
        version({ v: 3, createdAt: "2026-01-01T10:20:00.000Z" }),
      ],
    });
    expect(turns[0]?.runs).toHaveLength(2);
    expect(turns[0]?.runs[0]?.versions.map((v) => v.v)).toEqual([1, 2]);
    expect(turns[0]?.runs[1]?.versions.map((v) => v.v)).toEqual([3]);
  });

  it("pairs each reply with the run it triggered", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      replies: [
        {
          author: "alice@example.com",
          date: "2026-01-01T10:10:00.000Z",
          text: "more contrast",
          v: 1,
        },
      ],
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
        version({ v: 2, createdAt: "2026-01-01T10:10:05.000Z" }),
      ],
    });
    // comment turn owns the first run; the reply turn owns the run it triggered
    expect(turns).toHaveLength(2);
    expect(turns[0]?.instruction.kind).toBe("comment");
    expect(turns[0]?.runs[0]?.versions.map((v) => v.v)).toEqual([1]);
    expect(turns[1]?.instruction.kind).toBe("reply");
    expect(turns[1]?.runs[0]?.versions.map((v) => v.v)).toEqual([2]);
  });

  it("leaves a comment-mode reply (no run) as a turn with no runs", () => {
    const { turns } = buildTranscript({
      ...baseArgs,
      replies: [
        {
          author: "bob@example.com",
          date: "2026-01-01T10:20:00.000Z",
          text: "leaving this for Dana",
          v: 1,
        },
      ],
      versions: [
        version({ v: 0, createdAt: "2026-01-01T10:00:00.000Z" }),
        version({ v: 1, createdAt: "2026-01-01T10:05:00.000Z" }),
      ],
    });
    expect(turns).toHaveLength(2);
    expect(turns[1]?.runs).toHaveLength(0);
  });
});
