import { describe, expect, it } from "vitest";
import { readCommentsFromSource } from "./reader.ts";

const SKIPPED_TEXT_RE = /skipped.*text/;
const ACTIVE_ABC_RE = /active.*abc/;

const wrap = (inside: string) => `export function P() {
  return (
    <div>
${inside}
    </div>
  );
}
`;

describe("readCommentsFromSource", () => {
  it("reads a simple @comment directive", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="too heavy" author="x@y.z" date="2026-05-01T00:00:00Z" */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: "c1",
      anchor: "a1",
      text: "too heavy",
      author: "x@y.z",
      date: "2026-05-01T00:00:00Z",
      resolved: false,
      replies: [],
    });
  });

  it("handles multiple comments on the same anchor", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="too heavy" author="x@y.z" date="2026-05-01T00:00:00Z" */}
      {/* @comment id="c2" anchor="a1" text="ghost style?" author="x@y.z" date="2026-05-23T00:00:00Z" */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(comments.every((c) => c.anchor === "a1")).toBe(true);
  });

  it("escapes survive a JSON-stringified text value", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="line1\\nline2 \\"quoted\\" \\\\back" author="x@y.z" date="2026-05-01T00:00:00Z" */}`
    );
    const { comments } = readCommentsFromSource(src);
    expect(comments[0]?.text).toBe('line1\nline2 "quoted" \\back');
  });

  it("resolves view from nearest data-view ancestor", () => {
    const src = `export function P() {
  return (
    <section data-view="my-view">
      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" */}
    </section>
  );
}
`;
    const { comments } = readCommentsFromSource(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.view).toBe("my-view");
  });

  it("view is null when no data-view ancestor is present", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" */}`
    );
    const { comments } = readCommentsFromSource(src);
    expect(comments[0]?.view).toBeNull();
  });

  it("skips and warns on missing required fields", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" author="x@y.z" date="2026-05-01T00:00:00Z" */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(comments).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(SKIPPED_TEXT_RE);
  });

  it("ignores non-directive block comments", () => {
    const src = wrap(
      `      <button>Save</button>
      {/* just a note */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(comments).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("reads optional resolved as bare flag", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" resolved */}`
    );
    const { comments } = readCommentsFromSource(src);
    expect(comments[0]?.resolved).toBe(true);
  });

  it("reads active=0 as the number 0", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" active=0 */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(warnings).toEqual([]);
    expect(comments[0]?.active).toBe(0);
  });

  it("reads active=3 as the number 3", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" active=3 */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(warnings).toEqual([]);
    expect(comments[0]?.active).toBe(3);
  });

  it("omits active entirely when the attribute is absent", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" */}`
    );
    const { comments } = readCommentsFromSource(src);
    // The contract: defaults to 0 elsewhere, but reader keeps it optional.
    expect(comments[0]?.active).toBeUndefined();
  });

  it("skips a malformed active=abc with a warning, comment still parses", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" active=abc */}`
    );
    const { comments, warnings } = readCommentsFromSource(src);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.active).toBeUndefined();
    expect(warnings.some((w) => ACTIVE_ABC_RE.test(w))).toBe(true);
  });

  it("reads replies as a JSON array", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" replies=[{"author":"u","date":"2026-05-02","text":"ack"}] */}`
    );
    const { comments } = readCommentsFromSource(src);
    expect(comments[0]?.replies).toEqual([
      { author: "u", date: "2026-05-02", text: "ack" },
    ]);
  });

  it("reads optional v on each reply", () => {
    const src = wrap(
      `      <button data-comment-anchor="a1">Save</button>
      {/* @comment id="c1" anchor="a1" text="hi" author="x@y.z" date="2026-05-01T00:00:00Z" replies=[{"author":"u","date":"2026-05-02","text":"ack","v":1}] */}`
    );
    const { comments } = readCommentsFromSource(src);
    expect(comments[0]?.replies).toEqual([
      { author: "u", date: "2026-05-02", text: "ack", v: 1 },
    ]);
  });
});
