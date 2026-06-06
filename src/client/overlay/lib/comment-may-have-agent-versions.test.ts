import { describe, expect, it } from "vitest";
import { commentMayHaveAgentVersions } from "./comment-may-have-agent-versions.ts";

describe("commentMayHaveAgentVersions", () => {
  it("is false for a new comment with no agent replies", () => {
    expect(commentMayHaveAgentVersions({})).toBe(false);
  });

  it("is true when active is above baseline", () => {
    expect(
      commentMayHaveAgentVersions({
        active: 2,
      })
    ).toBe(true);
  });

  it("is true when any reply is version-stamped", () => {
    expect(
      commentMayHaveAgentVersions({
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
      commentMayHaveAgentVersions({
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
