import { describe, expect, it } from "vitest";
import type { CommentData, CommentReply } from "../../types.ts";
import {
  appendReply,
  removeComment,
  removeReply,
  updateCommentText,
  updateReply,
} from "./comment-mutations.ts";

const baseComment = (overrides: Partial<CommentData> = {}): CommentData => ({
  id: "c1",
  anchor: "a1",
  author: "alice@example.com",
  date: "2026-01-01T00:00:00.000Z",
  text: "hello",
  ...overrides,
});

const sampleReply = (overrides: Partial<CommentReply> = {}): CommentReply => ({
  author: "bob@example.com",
  date: "2026-01-02T00:00:00.000Z",
  text: "reply one",
  ...overrides,
});

describe("updateCommentText", () => {
  it("updates text for matching id", () => {
    const comments = [baseComment(), baseComment({ id: "c2", text: "other" })];
    const next = updateCommentText(comments, "c1", "updated");
    expect(next[0]?.text).toBe("updated");
    expect(next[1]?.text).toBe("other");
    expect(comments[0]?.text).toBe("hello");
  });

  it("returns same array reference when id is missing", () => {
    const comments = [baseComment()];
    const next = updateCommentText(comments, "missing", "x");
    expect(next).toBe(comments);
  });
});

describe("appendReply", () => {
  it("appends to empty replies", () => {
    const reply = sampleReply();
    const next = appendReply([baseComment()], "c1", reply);
    expect(next[0]?.replies).toEqual([reply]);
  });

  it("appends to existing replies", () => {
    const first = sampleReply();
    const second = sampleReply({ text: "two" });
    const comments = [baseComment({ replies: [first] })];
    const next = appendReply(comments, "c1", second);
    expect(next[0]?.replies).toEqual([first, second]);
  });
});

describe("updateReply", () => {
  it("updates reply text at index", () => {
    const replies = [sampleReply(), sampleReply({ text: "two" })];
    const next = updateReply([baseComment({ replies })], "c1", 1, "edited");
    expect(next[0]?.replies?.[1]?.text).toBe("edited");
    expect(next[0]?.replies?.[0]?.text).toBe("reply one");
  });

  it("leaves comment unchanged when index is out of bounds", () => {
    const comments = [baseComment({ replies: [sampleReply()] })];
    const next = updateReply(comments, "c1", 5, "x");
    expect(next).toBe(comments);
  });
});

describe("removeReply", () => {
  it("removes reply at index", () => {
    const replies = [sampleReply(), sampleReply({ text: "two" })];
    const next = removeReply([baseComment({ replies })], "c1", 0);
    expect(next[0]?.replies).toEqual([replies[1]]);
  });

  it("clears replies when last one is removed", () => {
    const next = removeReply(
      [baseComment({ replies: [sampleReply()] })],
      "c1",
      0
    );
    expect(next[0]?.replies).toBeUndefined();
  });

  it("leaves comment unchanged when index is out of bounds", () => {
    const comments = [baseComment({ replies: [sampleReply()] })];
    const next = removeReply(comments, "c1", -1);
    expect(next).toBe(comments);
  });
});

describe("removeComment", () => {
  it("filters out comment by id", () => {
    const comments = [baseComment(), baseComment({ id: "c2" })];
    const next = removeComment(comments, "c1");
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe("c2");
  });
});
