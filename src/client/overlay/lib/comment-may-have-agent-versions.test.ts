import { describe, expect, it } from "vitest";
import { commentMayHaveFixVersions } from "./comment-may-have-fix-versions.ts";

describe("commentMayHaveFixVersions", () => {
  it("is false for a new comment with no agent replies", () => {
    expect(
      commentMayHaveFixVersions({
        text: "note",
        author: "a@b.c",
        date: "2026-01-01T00:00:00.000Z",
        id: "c1",
        anchor: "a1",
      })
    ).toBe(false);
  });

  it("is true when active is above baseline", () => {
    expect(
      commentMayHaveFixVersions({
        text: "note",
        author: "a@b.c",
        date: "2026-01-01T00:00:00.000Z",
        id: "c1",
        anchor: "a1",
        active: 2,
      })
    ).toBe(true);
  });

  it("is true when any reply is version-stamped", () => {
    expect(
      commentMayHaveFixVersions({
        text: "note",
        author: "a@b.c",
        date: "2026-01-01T00:00:00.000Z",
        id: "c1",
        anchor: "a1",
        replies: [
          {
            author: "a@b.c",
            date: "2026-01-02T00:00:00.000Z",
            text: "more contrast",
            v: 0,
          },
        ],
      })
    ).toBe(true);
  });

  it("is false for comment-mode replies without v", () => {
    expect(
      commentMayHaveFixVersions({
        text: "note",
        author: "a@b.c",
        date: "2026-01-01T00:00:00.000Z",
        id: "c1",
        anchor: "a1",
        replies: [
          {
            author: "b@b.c",
            date: "2026-01-02T00:00:00.000Z",
            text: "fyi Dana",
          },
        ],
      })
    ).toBe(false);
  });
});
