/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW UNDER TEST: comment write → read round-trip against a REAL .tsx file
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This integration test exercises the comment-writing and comment-reading
 * server modules end-to-end against a REAL temporary project directory on
 * disk. The agent is NOT involved here (no network, no Claude calls).
 *
 * Real modules under test:
 *   - src/server/comments/writer.ts        (writeCommentToFile)
 *   - src/server/comments/reader.ts        (readCommentsFromFile / FromSource)
 *   - src/server/comments/find-comment.ts  (findCommentById)
 *
 * The writer mutates the file via recast (formatting-preserving) and writes
 * atomically. It stamps `data-comment-anchor="<uuid>"` on the target JSXElement
 * and inserts a sibling `{/* @comment id="..." anchor="..." ... *\/}` marker.
 * The reader parses with @babel/parser (jsx + typescript) and re-derives the
 * directive's attributes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { parse as parseBabel } from "@babel/parser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.ts";
import { findCommentById } from "../../src/server/comments/find-comment.ts";
import {
  readCommentsFromFile,
  readCommentsFromSource,
} from "../../src/server/comments/reader.ts";
import { WriteError } from "../../src/server/comments/writer-errors.ts";
import { writeCommentToFile } from "../../src/server/comments/writer.ts";

const PAGE_REL = "src/App.tsx";
const AUTHOR = "paulius.krutkis@oxylabs.io";

/** Assert source parses as valid TSX (throws on failure). */
function assertValidTsx(source: string): void {
  expect(() =>
    parseBabel(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    })
  ).not.toThrow();
}

/**
 * Locate the 1-indexed (line, column) of the `<` opening a given tag in source.
 * The writer's `findJsxElementAt` expects the 1-indexed column of the `<`.
 * Recomputing from the live source keeps coordinates correct after earlier
 * writes shift line numbers / insert attributes.
 */
function locateTag(
  source: string,
  tag: string,
  occurrence = 1
): { line: number; column: number } {
  const lines = source.split("\n");
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(`<${tag}`);
    if (idx >= 0) {
      seen += 1;
      if (seen === occurrence) {
        return { line: i + 1, column: idx + 1 };
      }
    }
  }
  throw new Error(`tag <${tag}> #${occurrence} not found in source`);
}

describe("integration: comment write→read round-trip", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let pagePath: string;

  beforeEach(async () => {
    project = await createTempProject();
    pagePath = project.srcFile(PAGE_REL);
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it("writes a marker, reads it back, and the file still parses as valid TSX", async () => {
    const original = await project.readSource(PAGE_REL);
    const { line, column } = locateTag(original, "h1");

    const result = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line,
      column,
      text: "Make the heading bigger",
      route: "/",
    });

    // Returned ids.
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.anchor).toMatch(/^[0-9a-f-]{36}$/i);
    expect(() => new Date(result.date).toISOString()).not.toThrow();
    expect(new Date(result.date).toISOString()).toBe(result.date);

    // Read back.
    const read = await readCommentsFromFile(pagePath);
    expect(read.warnings).toEqual([]);
    expect(read.comments).toHaveLength(1);
    const comment = read.comments[0];
    expect(comment.id).toBe(result.id);
    expect(comment.anchor).toBe(result.anchor);
    expect(comment.text).toBe("Make the heading bigger");
    expect(comment.author).toBe(AUTHOR);
    expect(comment.date).toBe(result.date);
    expect(comment.resolved).toBe(false);
    expect(comment.replies).toEqual([]);

    // Marker present in raw source.
    const updated = await project.readSource(PAGE_REL);
    expect(updated).toContain("@comment");
    expect(updated).toContain(`id="${result.id}"`);
    expect(updated).toContain(`anchor="${result.anchor}"`);
    expect(updated).toContain(`data-comment-anchor="${result.anchor}"`);

    // Still valid TSX.
    assertValidTsx(updated);

    // Directive survives a parse→print→parse cycle unchanged.
    const reread = readCommentsFromSource(updated);
    expect(reread.warnings).toEqual([]);
    expect(reread.comments).toEqual(read.comments);
  });

  it("findCommentById locates the just-written marker across the src/ tree", async () => {
    const original = await project.readSource(PAGE_REL);
    const { line, column } = locateTag(original, "h1");

    const { id, anchor } = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line,
      column,
      text: "Tweak this",
    });

    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    expect(found?.absolutePath).toBe(pagePath);
    expect(found?.relativePath).toBe(PAGE_REL);
    expect(found?.comment.id).toBe(id);
    expect(found?.comment.anchor).toBe(anchor);
    expect(found?.siblingIds).toEqual([]);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("supports multiple comments on the same file (distinct ids, shared anchor when same element)", async () => {
    // Comment A on <h1>.
    const src0 = await project.readSource(PAGE_REL);
    const h1a = locateTag(src0, "h1");
    const a = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line: h1a.line,
      column: h1a.column,
      text: "comment A",
    });

    // Comment B on the SAME <h1> element — recompute coords against the
    // post-A source so we hit the same (now-anchored) element. The writer must
    // reuse the existing data-comment-anchor, minting a fresh id only.
    const src1 = await project.readSource(PAGE_REL);
    const h1b = locateTag(src1, "h1");
    const b = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line: h1b.line,
      column: h1b.column,
      text: "comment B",
    });

    expect(b.id).not.toBe(a.id);
    expect(b.anchor).toBe(a.anchor);

    // Comment C on a DIFFERENT element (<button>) → distinct id AND anchor.
    const src2 = await project.readSource(PAGE_REL);
    const btn = locateTag(src2, "button");
    const c = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line: btn.line,
      column: btn.column,
      text: "comment C",
    });
    expect(c.id).not.toBe(a.id);
    expect(c.id).not.toBe(b.id);
    expect(c.anchor).not.toBe(a.anchor);

    // Read back: 3 comments; A & B share an anchor, C distinct; still valid TSX.
    const read = await readCommentsFromFile(pagePath);
    expect(read.warnings).toEqual([]);
    expect(read.comments).toHaveLength(3);
    const ids = read.comments.map((x) => x.id).sort();
    expect(ids).toEqual([a.id, b.id, c.id].sort());
    const byId = new Map(read.comments.map((x) => [x.id, x]));
    expect(byId.get(a.id)?.anchor).toBe(a.anchor);
    expect(byId.get(b.id)?.anchor).toBe(a.anchor);
    expect(byId.get(c.id)?.anchor).toBe(c.anchor);
    assertValidTsx(await project.readSource(PAGE_REL));

    // findCommentById for B reports the OTHER ids as siblings.
    const foundB = await findCommentById(project.root, b.id, []);
    expect(foundB?.siblingIds.sort()).toEqual([a.id, c.id].sort());
  });

  it("writes a comment onto a nested element without corrupting parents", async () => {
    const original = await project.readSource(PAGE_REL);
    // <button> is nested under <div> under <main data-view="playground">.
    const { line, column } = locateTag(original, "button");

    const { id, anchor } = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line,
      column,
      text: "nested comment",
    });

    const updated = await project.readSource(PAGE_REL);
    assertValidTsx(updated);

    // The nested element carries the anchor; the marker is a sibling (next
    // line after the button), not hoisted to the root.
    expect(updated).toContain(`<button type="button" data-comment-anchor="${anchor}">`);
    // Outer structure preserved (recast keeps untouched regions byte-stable).
    expect(updated).toContain('<main data-view="playground">');
    expect(updated).toContain('<div className="card">');

    // View resolution: walks ancestors for data-view.
    const read = await readCommentsFromFile(pagePath);
    expect(read.comments).toHaveLength(1);
    expect(read.comments[0].id).toBe(id);
    expect(read.comments[0].view).toBe("playground");
  });

  it("re-reading the same file is idempotent", async () => {
    const original = await project.readSource(PAGE_REL);
    const { line, column } = locateTag(original, "h1");
    await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line,
      column,
      text: "stable",
    });

    const first = await readCommentsFromFile(pagePath);
    const second = await readCommentsFromFile(pagePath);
    expect(first.warnings).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(second.comments).toEqual(first.comments);
  });

  it("throws WriteError(400) when no JSXElement exists at (line, column)", async () => {
    const before = await project.readSource(PAGE_REL);

    await expect(
      writeCommentToFile({
        absolutePath: pagePath,
        author: AUTHOR,
        line: 99,
        column: 99,
        text: "nowhere",
      })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("no JSXElement found at line:column"),
    });

    // Ensure it really was a WriteError, and the file is byte-for-byte unchanged.
    await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line: 99,
      column: 99,
      text: "nowhere",
    }).catch((err) => {
      expect(err).toBeInstanceOf(WriteError);
    });

    const after = await project.readSource(PAGE_REL);
    expect(after).toBe(before);
  });
});
