import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readCommentsFromSource } from "./reader.ts";
import {
  appendCommentReply,
  deleteCommentMarker,
  deleteCommentReply,
  updateCommentActive,
  updateCommentReply,
  updateCommentResolved,
  updateCommentText,
  writeCommentToFile,
} from "./writer.ts";
import {
  extractDirectiveInner,
  injectExistingMarkerIntoSource,
  replaceCommentMarkerInSource,
} from "./writer-directive.ts";
import { WriteError } from "./writer-errors.ts";

const FRAGMENT_LABEL_RE = /<>\s*<label/;
const FRAGMENT_COMMENT_RE = /<\/label>[\s\S]*@comment[\s\S]*<\/>/;
const NONEXISTENT_UUID_RE = /nonexistent-uuid-deadbeef/;
const MISSING_ID_RE = /missing-id/;
const OUT_OF_RANGE_RE = /out of range/;
const DATA_COMMENT_ANCHOR_RE = /data-comment-anchor/;
const TRIPLE_BLANK_LINE_RE = /\n\s*\n\s*\n/;
const NOT_FOUND_RE = /not found/;
const RESOLVED_MARKER_RE = /\bresolved\b/;

const dir = mkdtempSync(path.join(tmpdir(), "babel-writer-test-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let file: string;

const SOURCE = `export function P() {
  return (
    <div>
      <button>Save</button>
    </div>
  );
}
`;

beforeEach(() => {
  file = path.join(
    dir,
    `t-${Date.now()}-${Math.random().toString(36).slice(2)}.tsx`
  );
  writeFileSync(file, SOURCE, "utf8");
});

describe("writeCommentToFile", () => {
  it("stamps data-comment-anchor and writes a sibling @comment block", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "too heavy",
      author: "dev@local",
    });

    const out = readFileSync(file, "utf8");
    expect(out).toContain(`data-comment-anchor="${result.anchor}"`);
    expect(out).toContain(`@comment id="${result.id}"`);
    expect(out).toContain(`text="too heavy"`);

    // Reader should round-trip the written marker.
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: result.id,
      anchor: result.anchor,
      text: "too heavy",
      author: "dev@local",
    });
  });

  it("reuses an existing data-comment-anchor instead of minting a new one", async () => {
    const initial = SOURCE.replace(
      "<button>",
      `<button data-comment-anchor="preset-uuid">`
    );
    writeFileSync(file, initial, "utf8");

    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "second take",
      author: "dev@local",
    });

    expect(result.anchor).toBe("preset-uuid");
    const out = readFileSync(file, "utf8");
    // Should not have stamped a second data-comment-anchor attribute.
    expect(out.match(/data-comment-anchor="preset-uuid"/g)?.length).toBe(1);
    expect(out).toContain(`anchor="preset-uuid"`);
  });

  it("escapes quotes and newlines in text via JSON encoding", async () => {
    await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: 'has "quotes"\nand a newline',
      author: "dev@local",
    });
    const out = readFileSync(file, "utf8");
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments[0]?.text).toBe('has "quotes"\nand a newline');
  });

  it("wraps target in a Fragment when it has no JSX parent (root return)", async () => {
    // No wrapper around the root <label> — its AST parent is a return statement,
    // not a JSX node. Sibling insertion can't work; writer should fall back to
    // wrapping the target in a JSX Fragment with the marker as a sibling.
    const rootlessSource = `import { useId } from "react";
export function Card() {
  const id = useId();
  return (
    <label htmlFor={id}>
      <input id={id} type="checkbox" />
      <span>Show</span>
    </label>
  );
}
`;
    writeFileSync(file, rootlessSource, "utf8");

    const result = await writeCommentToFile({
      absolutePath: file,
      line: 5,
      column: 5,
      text: "label feels heavy",
      author: "dev@local",
    });

    const out = readFileSync(file, "utf8");
    // Anchor was stamped on the root <label>.
    expect(out).toContain(`data-comment-anchor="${result.anchor}"`);
    // Marker exists in source.
    expect(out).toContain(`@comment id="${result.id}"`);
    expect(out).toContain(`text="label feels heavy"`);
    // The fragment wrap appears.
    expect(out).toMatch(FRAGMENT_LABEL_RE);
    expect(out).toMatch(FRAGMENT_COMMENT_RE);

    // Reader round-trip.
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      anchor: result.anchor,
      text: "label feels heavy",
    });
  });

  it("emits a screenshot attribute when provided, and round-trips through the reader", async () => {
    const screenshot = "/designs/iterations/abc-123/v0.png";
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "needs a redesign",
      author: "dev@local",
      screenshot,
    });

    const out = readFileSync(file, "utf8");
    expect(out).toContain(`screenshot="${screenshot}"`);
    expect(out).toContain(`@comment id="${result.id}"`);

    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: result.id,
      text: "needs a redesign",
      screenshot,
    });
  });

  it("omits the screenshot attribute when no screenshot is provided", async () => {
    await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "no shot",
      author: "dev@local",
    });
    const out = readFileSync(file, "utf8");
    expect(out).not.toContain("screenshot=");
    const { comments } = readCommentsFromSource(out);
    expect(comments[0]?.screenshot).toBeUndefined();
  });

  it("uses the caller-supplied id when one is passed", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "preallocated",
      author: "dev@local",
      id,
    });
    expect(result.id).toBe(id);
    const out = readFileSync(file, "utf8");
    expect(out).toContain(`@comment id="${id}"`);
  });

  it("appends a second comment as another sibling on the same anchor", async () => {
    const r1 = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "first",
      author: "dev@local",
    });
    const r2 = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "second",
      author: "dev@local",
    });
    expect(r2.anchor).toBe(r1.anchor);
    const out = readFileSync(file, "utf8");
    const { comments } = readCommentsFromSource(out);
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.text).sort()).toEqual(["first", "second"]);
  });
});

describe("updateCommentActive", () => {
  it("adds active=N to a marker that has none", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "needs an iteration",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 1,
    });
    const out = readFileSync(file, "utf8");
    expect(out).toContain("active=1");
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.active).toBe(1);
  });

  it("updates an existing active=2 to active=5", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "shifting iterations",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 2,
    });
    const mid = readFileSync(file, "utf8");
    // Sanity check that the writer stored 2 first.
    expect(mid).toContain("active=2");
    expect(mid).not.toContain("active=5");

    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 5,
    });
    const out = readFileSync(file, "utf8");
    expect(out).toContain("active=5");
    expect(out).not.toContain("active=2");
    // Only one active= occurrence — make sure we replaced, not appended.
    expect(out.match(/active=/g)?.length).toBe(1);
    const { comments } = readCommentsFromSource(out);
    expect(comments[0]?.active).toBe(5);
  });

  it("throws a meaningful error when the comment id is not found", async () => {
    await expect(
      updateCommentActive({
        absolutePath: file,
        commentId: "nonexistent-uuid-deadbeef",
        active: 1,
      })
    ).rejects.toThrow(NONEXISTENT_UUID_RE);
  });

  it("reader round-trip returns the new active value after update", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "roundtrip",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 7,
    });
    const out = readFileSync(file, "utf8");
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments[0]?.active).toBe(7);
  });
});

describe("updateCommentText", () => {
  it("updates the text attribute on an existing marker", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "original",
      author: "dev@local",
    });
    await updateCommentText({
      absolutePath: file,
      commentId: result.id,
      text: "updated body",
    });
    const out = readFileSync(file, "utf8");
    expect(out).toContain('text="updated body"');
    expect(out).not.toContain("original");
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments[0]?.text).toBe("updated body");
  });

  it("preserves JSON escaping for quotes and newlines", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "plain",
      author: "dev@local",
    });
    await updateCommentText({
      absolutePath: file,
      commentId: result.id,
      text: 'say "hi"\nand bye',
    });
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.text).toBe('say "hi"\nand bye');
  });

  it("throws when the comment id is not found", async () => {
    await expect(
      updateCommentText({
        absolutePath: file,
        commentId: "missing-id",
        text: "nope",
      })
    ).rejects.toThrow(MISSING_ID_RE);
  });
});

describe("updateCommentResolved", () => {
  it("sets and clears the resolved flag on an existing marker", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "fix me",
      author: "dev@local",
    });
    await updateCommentResolved({
      absolutePath: file,
      commentId: result.id,
      resolved: true,
    });
    let { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.resolved).toBe(true);
    expect(readFileSync(file, "utf8")).toMatch(RESOLVED_MARKER_RE);

    await updateCommentResolved({
      absolutePath: file,
      commentId: result.id,
      resolved: false,
    });
    ({ comments } = readCommentsFromSource(readFileSync(file, "utf8")));
    expect(comments[0]?.resolved).toBe(false);
    expect(readFileSync(file, "utf8")).not.toMatch(RESOLVED_MARKER_RE);
  });
});

describe("appendCommentReply", () => {
  it("adds replies=[...] when the marker has none", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "needs a reply",
      author: "dev@local",
    });
    const reply = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@local", text: "ack" },
    });
    expect(reply.author).toBe("reviewer@local");
    expect(reply.text).toBe("ack");
    expect(reply.date.length).toBeGreaterThan(0);
    expect(reply.v).toBe(0);
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.replies).toEqual([reply]);
  });

  it("stamps explicit v when provided", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "versioned thread",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 2,
    });
    const reply = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@local", text: "on v3", v: 2 },
    });
    expect(reply.v).toBe(2);
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.replies?.[0]?.v).toBe(2);
  });

  it("defaults v to marker active when omitted", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "versioned thread",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 1,
    });
    const reply = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@local", text: "follow-up" },
    });
    expect(reply.v).toBe(1);
  });

  it("appends to an existing replies array", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "thread",
      author: "dev@local",
    });
    const first = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "a@local", text: "first" },
    });
    const second = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "b@local", text: "second" },
    });
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.replies).toEqual([first, second]);
  });

  it("throws when the comment id is not found", async () => {
    await expect(
      appendCommentReply({
        absolutePath: file,
        commentId: "missing-id",
        reply: { author: "a@local", text: "nope" },
      })
    ).rejects.toThrow(MISSING_ID_RE);
  });
});

describe("updateCommentReply", () => {
  it("updates reply text while preserving author and date", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "thread",
      author: "dev@local",
    });
    const reply = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@local", text: "original" },
    });
    await updateCommentReply({
      absolutePath: file,
      commentId: result.id,
      replyIndex: 0,
      text: "updated",
    });
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.replies).toEqual([
      { author: reply.author, date: reply.date, text: "updated", v: 0 },
    ]);
  });

  it("throws when the reply index is out of range", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "thread",
      author: "dev@local",
    });
    await expect(
      updateCommentReply({
        absolutePath: file,
        commentId: result.id,
        replyIndex: 0,
        text: "nope",
      })
    ).rejects.toThrow(OUT_OF_RANGE_RE);
  });
});

describe("deleteCommentReply", () => {
  it("removes a reply by index", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "thread",
      author: "dev@local",
    });
    await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "a@local", text: "first" },
    });
    const second = await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "b@local", text: "second" },
    });
    await deleteCommentReply({
      absolutePath: file,
      commentId: result.id,
      replyIndex: 0,
    });
    const { comments } = readCommentsFromSource(readFileSync(file, "utf8"));
    expect(comments[0]?.replies).toEqual([second]);
  });

  it("throws when the reply index is out of range", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "thread",
      author: "dev@local",
    });
    await expect(
      deleteCommentReply({
        absolutePath: file,
        commentId: result.id,
        replyIndex: 0,
      })
    ).rejects.toThrow(OUT_OF_RANGE_RE);
  });
});

describe("injectExistingMarkerIntoSource", () => {
  // Models the legacy v0.tsx case: the anchor attribute survives but the
  // {/* @comment ... */} block was stripped (because v0 was captured BEFORE
  // the writer mutation).
  const anchor = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const id = "11111111-2222-4333-8444-555555555555";
  const SNAPSHOT_WITHOUT_MARKER = `export function P() {
  return (
    <div>
      <button data-comment-anchor="${anchor}">Save</button>
    </div>
  );
}
`;

  it("injects a pre-built directive into a snapshot missing the @comment block", () => {
    const directiveInner = ` @comment id="${id}" anchor="${anchor}" text="too heavy" author="dev@local" date="2026-05-24T00:00:00.000Z" `;
    const out = injectExistingMarkerIntoSource(
      SNAPSHOT_WITHOUT_MARKER,
      anchor,
      directiveInner
    );

    // The output must still carry the anchor and now contain the directive.
    expect(out).toContain(`data-comment-anchor="${anchor}"`);
    expect(out).toContain(`@comment id="${id}"`);
    expect(out).toContain(`text="too heavy"`);

    // Round-trip via the reader.
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id,
      anchor,
      text: "too heavy",
      author: "dev@local",
      date: "2026-05-24T00:00:00.000Z",
    });
  });

  it("preserves the original directive's text/author/date verbatim via round-trip", async () => {
    // Create a marker with a non-trivial author/date/screenshot, then yank
    // its directive inner from the live source and inject it into a fresh
    // (marker-less) snapshot. The reader must see identical attributes.
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: 'has "quotes" and a\nnewline',
      author: "alice@example.com",
      screenshot: "/designs/iterations/abc/v0.png",
    });
    const liveSource = readFileSync(file, "utf8");
    const directiveInner = extractDirectiveInner(liveSource, result.id);
    expect(directiveInner).not.toBeNull();

    // Build a snapshot that only has the anchor attribute (legacy v0 shape).
    const legacySnapshot = SOURCE.replace(
      "<button>",
      `<button data-comment-anchor="${result.anchor}">`
    );
    if (directiveInner === null) {
      throw new Error("expected directive inner");
    }
    const out = injectExistingMarkerIntoSource(
      legacySnapshot,
      result.anchor,
      directiveInner
    );
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      id: result.id,
      anchor: result.anchor,
      text: 'has "quotes" and a\nnewline',
      author: "alice@example.com",
      date: result.date,
      screenshot: "/designs/iterations/abc/v0.png",
    });
  });

  it("throws a 400 WriteError when the snapshot has no element bearing the anchor", () => {
    const directiveInner = ` @comment id="${id}" anchor="${anchor}" text="x" author="a" date="d" `;
    expect(() =>
      injectExistingMarkerIntoSource(
        SOURCE, // No data-comment-anchor anywhere.
        anchor,
        directiveInner
      )
    ).toThrow(DATA_COMMENT_ANCHOR_RE);
  });
});

describe("replaceCommentMarkerInSource", () => {
  it("replaces a stale snapshot marker with the live directive including replies", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "fix the button",
      author: "dev@local",
    });
    await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@co", text: "Looks good" },
    });
    const liveSource = readFileSync(file, "utf8");
    const liveInner = extractDirectiveInner(liveSource, result.id);
    expect(liveInner).toContain("replies=");

    if (liveInner === null) {
      throw new Error("expected live directive");
    }
    const staleSnapshot = liveSource.replace(
      liveInner,
      ` @comment id="${result.id}" anchor="${result.anchor}" text="fix the button" author="dev@local" date="${result.date}" `
    );
    const { comments: before } = readCommentsFromSource(staleSnapshot);
    expect(before[0]?.replies ?? []).toHaveLength(0);

    const out = replaceCommentMarkerInSource(
      staleSnapshot,
      result.id,
      liveInner
    );
    const { comments: after, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(after[0]?.replies).toEqual([
      expect.objectContaining({
        author: "reviewer@co",
        text: "Looks good",
        v: 0,
      }),
    ]);
  });

  it("preserves versioned replies when replacing a stale snapshot marker", async () => {
    const result = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "fix the button",
      author: "dev@local",
    });
    await updateCommentActive({
      absolutePath: file,
      commentId: result.id,
      active: 1,
    });
    await appendCommentReply({
      absolutePath: file,
      commentId: result.id,
      reply: { author: "reviewer@co", text: "On v2", v: 1 },
    });
    const liveSource = readFileSync(file, "utf8");
    const liveInner = extractDirectiveInner(liveSource, result.id);
    if (liveInner === null) {
      throw new Error("expected live directive");
    }
    const staleSnapshot = liveSource.replace(
      liveInner,
      ` @comment id="${result.id}" anchor="${result.anchor}" text="fix the button" author="dev@local" date="${result.date}" active=1 `
    );
    const out = replaceCommentMarkerInSource(
      staleSnapshot,
      result.id,
      liveInner
    );
    const { comments: after } = readCommentsFromSource(out);
    expect(after[0]?.replies?.[0]?.v).toBe(1);
  });
});

describe("deleteCommentMarker", () => {
  it("removes one of two sibling @comment blocks on the same anchor and keeps the anchor attribute", async () => {
    const r1 = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "first",
      author: "dev@local",
    });
    const r2 = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "second",
      author: "dev@local",
    });
    expect(r1.anchor).toBe(r2.anchor);

    const result = await deleteCommentMarker({
      absolutePath: file,
      commentId: r1.id,
    });
    expect(result.removedAnchor).toBe(false);

    const out = readFileSync(file, "utf8");
    // First marker is gone, second survives.
    expect(out).not.toContain(`id="${r1.id}"`);
    expect(out).toContain(`id="${r2.id}"`);
    // Anchor attribute stays — second comment still references it.
    expect(out).toContain(`data-comment-anchor="${r1.anchor}"`);

    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.id).toBe(r2.id);
  });

  it("removes the data-comment-anchor attribute when deleting the last marker on that anchor", async () => {
    const r = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "only one",
      author: "dev@local",
    });

    const result = await deleteCommentMarker({
      absolutePath: file,
      commentId: r.id,
    });
    expect(result.removedAnchor).toBe(true);

    const out = readFileSync(file, "utf8");
    expect(out).not.toContain("@comment");
    expect(out).not.toContain("data-comment-anchor=");
    // Source is parseable and has no orphaned whitespace breaking the reader.
    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments).toHaveLength(0);
  });

  it("leaves the file as valid JSX with no orphaned whitespace after deleting the sole comment", async () => {
    const r = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "ephemeral",
      author: "dev@local",
    });
    // Sanity: marker is currently on disk.
    expect(readFileSync(file, "utf8")).toContain(`@comment id="${r.id}"`);

    await deleteCommentMarker({
      absolutePath: file,
      commentId: r.id,
    });

    const out = readFileSync(file, "utf8");
    // No double blank lines left behind from the splice.
    expect(out).not.toMatch(TRIPLE_BLANK_LINE_RE);
    // Re-parsing has to succeed; if not, deleteCommentMarker itself would have
    // thrown WriteError(500). Read for good measure.
    const { warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
  });

  it("throws WriteError(404) when commentId is not in the file", async () => {
    // Pre-write a comment so the file isn't empty, then try to delete a
    // different id.
    await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "real one",
      author: "dev@local",
    });

    let caught: unknown = null;
    try {
      await deleteCommentMarker({
        absolutePath: file,
        commentId: "00000000-0000-4000-8000-000000000000",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WriteError);
    expect((caught as WriteError).status).toBe(404);
    expect((caught as Error).message).toMatch(NOT_FOUND_RE);
  });

  it("preserves the rest of the source verbatim when removing one of three siblings on different anchors", async () => {
    // Author three markers on three different elements so we can verify the
    // surrounding code stays untouched after a single delete. We write in
    // bottom-up order so each insertion doesn't shift the line numbers of
    // earlier targets.
    const multiSource = `export function P() {
  return (
    <section>
      <header>Top</header>
      <main>Middle</main>
      <footer>Bottom</footer>
    </section>
  );
}
`;
    writeFileSync(file, multiSource, "utf8");

    const rFooter = await writeCommentToFile({
      absolutePath: file,
      line: 6,
      column: 7,
      text: "footer note",
      author: "dev@local",
    });
    const rMain = await writeCommentToFile({
      absolutePath: file,
      line: 5,
      column: 7,
      text: "main note",
      author: "dev@local",
    });
    const rHeader = await writeCommentToFile({
      absolutePath: file,
      line: 4,
      column: 7,
      text: "header note",
      author: "dev@local",
    });

    const result = await deleteCommentMarker({
      absolutePath: file,
      commentId: rMain.id,
    });
    expect(result.removedAnchor).toBe(true);

    const out = readFileSync(file, "utf8");
    // The deleted marker is gone, the other two survive.
    expect(out).not.toContain(`id="${rMain.id}"`);
    expect(out).toContain(`id="${rHeader.id}"`);
    expect(out).toContain(`id="${rFooter.id}"`);
    // <main>'s anchor attribute is stripped; <header> and <footer>'s remain.
    expect(out).not.toContain(`data-comment-anchor="${rMain.anchor}"`);
    expect(out).toContain(`data-comment-anchor="${rHeader.anchor}"`);
    expect(out).toContain(`data-comment-anchor="${rFooter.anchor}"`);

    const { comments, warnings } = readCommentsFromSource(out);
    expect(warnings).toEqual([]);
    expect(comments.map((c) => c.id).sort()).toEqual(
      [rHeader.id, rFooter.id].sort()
    );
  });
});
