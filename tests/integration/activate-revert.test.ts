/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW UNDER TEST: activate a saved version, then full-revert to baseline
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ SAFETY-CRITICAL ⚠️
 * This is the MOST safety-critical flow in the project: it MUTATES THE USER'S
 * OWN SOURCE FILE. A regression here can silently corrupt or destroy a
 * developer's .tsx code. Every assertion that touches the live source must be
 * STRICT — prefer BYTE-FOR-BYTE equality (toBe on the exact string), not a
 * loose "contains" check. When in doubt, assert the full file contents.
 *
 * Flow:
 *   1. Plant a comment + seed v0 baseline (exact pre-iteration bytes).
 *   2. Run one or more STUBBED iterations producing v1.. (canned variants).
 *   3. ACTIVATE a version → the live source must reflect that variant's markup
 *      AND the marker's active=N must update.
 *   4. FULL-REVERT to baseline (v0) → the live source must return to the EXACT
 *      baseline bytes, and per spec the snapshots/manifest are cleaned up.
 *
 * Real modules under test (exact functions/paths exercised here):
 *   - src/server/iterations/activate-version.ts → applyIterationVersionToSource
 *   - src/server/api/comments/routes.ts → handleDelete (?revert=baseline →
 *       maybeRevertBeforeDelete → reads v0.tsx, atomicWriteText's it back, then
 *       deleteCommentMarker strips the marker + anchor, then rm -rf's the
 *       designs/ + public/designs/ iteration dirs).
 *   - src/server/api/iterations/routes.ts → handleIterationsDelete
 *   - src/server/iterations/manifest.ts → resolveIterationDirRoots,
 *       findVersionSnapshotPath, listCompleteIterationVersionsAllRoots.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDelete } from "../../src/server/api/comments/routes.ts";
import { handleIterationsDelete } from "../../src/server/api/iterations/routes.ts";
import { findCommentById } from "../../src/server/comments/find-comment.ts";
import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
import { writeCommentToFile } from "../../src/server/comments/writer.ts";
import { applyIterationVersionToSource } from "../../src/server/iterations/activate-version.ts";
import { seedBaselineIteration } from "../../src/server/iterations/baseline.ts";
import {
  findVersionSnapshotPath,
  listCompleteIterationVersionsAllRoots,
  resolveIterationDirRoots,
} from "../../src/server/iterations/manifest.ts";
import { runNewIteration } from "../../src/server/iterations/run-iteration.ts";
import {
  createJsonRequest,
  createMockResponse,
} from "../../src/server/platform/http-test-helpers.ts";
import { createTempProject, stubAgent } from "../helpers/index.ts";

const PAGE_REL = "src/App.tsx";
const AUTHOR = "dev@local";
const EXCLUDE: string[] = [];
const H1_TEXT_RE = /(<h1\b[^>]*>)[^<]*(<\/h1>)/;

/** A minimal but structurally-valid PNG (8-byte signature + IHDR). */
const TINY_PNG = Buffer.from([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a, // signature
  0x00,
  0x00,
  0x00,
  0x0d,
  0x49,
  0x48,
  0x44,
  0x52, // IHDR length + type
  0x00,
  0x00,
  0x00,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01, // 1x1
  0x08,
  0x06,
  0x00,
  0x00,
  0x00,
  0x1f,
  0x15,
  0xc4,
  0x89,
]);

/**
 * Locate the 1-indexed (line, column) of the `<` opening `tag` in `source`.
 * `writeCommentToFile` expects the 1-indexed column of the `<`. Coordinates
 * shift after every write, so callers must recompute against current source.
 */
function locateTag(
  source: string,
  tag: string
): { line: number; column: number } {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const idx = line.indexOf(`<${tag}`);
    if (idx >= 0) {
      return { line: i + 1, column: idx + 1 };
    }
  }
  throw new Error(`tag <${tag}> not found in source`);
}

/**
 * Build a "canned variant" from the current (marker-bearing) source by
 * replacing the heading text with a recognizable signature. The @comment
 * marker + data-comment-anchor are preserved verbatim so the iteration's
 * change-detection + active-stamping work and the snapshot can later be
 * activated via the element/full-design merge.
 */
function variantWithHeading(currentSource: string, signature: string): string {
  // The <h1> carries a data-comment-anchor after the marker write, so match its
  // opening tag (with any attributes) and rewrite only the text node.
  const replaced = currentSource.replace(H1_TEXT_RE, `$1${signature}$2`);
  if (replaced === currentSource) {
    throw new Error("variantWithHeading: <h1> text was not rewritten");
  }
  return replaced;
}

/** A hand-rolled NdjsonStream that simply collects emitted events. */
function makeStream() {
  const events: object[] = [];
  return {
    events,
    stream: {
      abortController: new AbortController(),
      clientGone: () => false,
      endStream: (final: object) => {
        events.push(final);
      },
      writeEvent: (event: object) => {
        events.push(event);
      },
    },
  };
}

describe("integration: activate version + full revert (SAFETY-CRITICAL)", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let agent: ReturnType<typeof stubAgent>;
  /** EXACT bytes of the page BEFORE any comment was written (pre-comment). */
  let preCommentBytes: string;
  /** EXACT bytes of the page WITH the freshly-written marker (== v0). */
  let baselineBytes: string;
  let id: string;
  let pagePath: string;

  beforeEach(async () => {
    project = await createTempProject();
    agent = stubAgent();
    pagePath = project.srcFile(PAGE_REL);

    // 1. Capture the pristine, pre-comment source EXACTLY.
    preCommentBytes = await readFile(pagePath, "utf8");

    // 2. Plant a comment on the <h1>.
    const { line, column } = locateTag(preCommentBytes, "h1");
    const written = await writeCommentToFile({
      absolutePath: pagePath,
      author: AUTHOR,
      line,
      column,
      text: "Make the heading pop",
      route: "/",
    });
    id = written.id;

    // 3. Capture the post-write source — this is what v0 must contain (WITH the
    //    marker). seedBaselineIteration persists it under
    //    public/designs/iterations/<id>/v0.tsx (+ v0.png + "Baseline" entry).
    baselineBytes = await readFile(pagePath, "utf8");
    await seedBaselineIteration(project.root, id, TINY_PNG, baselineBytes);
  });

  afterEach(async () => {
    await project.cleanup();
    agent.restore();
  });

  /** Run one stubbed iteration whose variant rewrites the heading. */
  async function runIterationWithHeading(signature: string): Promise<void> {
    const found = await findCommentById(project.root, id, EXCLUDE);
    if (!found) {
      throw new Error(`runIterationWithHeading: comment ${id} not found`);
    }
    const current = await readFile(pagePath, "utf8");
    agent.setVariant({ source: variantWithHeading(current, signature) });
    const { stream } = makeStream();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id,
      count: 1,
      model: "default",
      skills: [],
      stream,
    });
  }

  it("activating a version rewrites live source to that variant and sets active=N", async () => {
    await runIterationWithHeading("V1 HEADLINE");

    // After the iteration, finishSuccessfulBatch already left active=1 on the
    // live source. Refresh `found` against the post-iteration file.
    const roots = resolveIterationDirRoots(project.root, id);
    expect(findVersionSnapshotPath(roots, 1)).not.toBeNull();

    const foundBefore = await findCommentById(project.root, id, EXCLUDE);
    expect(foundBefore?.comment.active).toBe(1);
    if (!foundBefore) {
      throw new Error("comment not found after iteration");
    }
    const liveAfterIteration = await readFile(pagePath, "utf8");
    expect(liveAfterIteration).toContain("V1 HEADLINE");

    // ACT: explicitly (re-)activate v1 via the real activation function.
    const result = await applyIterationVersionToSource(
      foundBefore,
      roots,
      id,
      1,
      project.root
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.writtenFiles).toContain(pagePath);
    }

    // ASSERT: live source reflects v1's markup AND keeps an intact active=1
    // marker. Compare BYTE-FOR-BYTE to v1.tsx after normalizing the active
    // attribute (active is stamped onto the live file by activation).
    const live = await readFile(pagePath, "utf8");
    const v1Snapshot = await project.readSnapshot(`iterations/${id}/v1.tsx`);

    expect(live).toContain("V1 HEADLINE");
    expect(live).toContain(`id="${id}"`);
    expect(live).toContain("@comment");

    const stripActive = (s: string): string =>
      s.replace(/\s*active=-?[0-9]+/g, "");
    expect(stripActive(live)).toBe(stripActive(v1Snapshot));

    // active is exactly 1 on the live marker.
    const read = await readCommentsFromFile(pagePath);
    expect(read.comments.find((c) => c.id === id)?.active).toBe(1);
  });

  it("activating v0 restores the baseline markup while keeping the marker", async () => {
    await runIterationWithHeading("V1 HEADLINE");
    const roots = resolveIterationDirRoots(project.root, id);
    const found = await findCommentById(project.root, id, EXCLUDE);
    expect(found?.comment.active).toBe(1);
    if (!found) {
      throw new Error("comment not found after iteration");
    }

    // ACT: activate v0 (the seeded baseline, which INCLUDES the marker).
    const result = await applyIterationVersionToSource(
      found,
      roots,
      id,
      0,
      project.root
    );
    expect(result.ok).toBe(true);

    const live = await readFile(pagePath, "utf8");

    // The marker MUST survive — v0 was seeded WITH it; activating v0 must NOT
    // wipe the comment.
    expect(live).toContain("@comment");
    expect(live).toContain(`id="${id}"`);
    expect(live).not.toContain("V1 HEADLINE");

    // BYTE-FOR-BYTE to baselineBytes EXCEPT the marker's active attribute, now
    // stamped to 0 by setCommentActiveInSource. baselineBytes had NO active
    // attribute (a freshly-written marker defaults to active=0), so normalize
    // the active attribute out of both before comparing.
    const stripActive = (s: string): string =>
      s.replace(/\s*active=-?[0-9]+/g, "");
    expect(stripActive(live)).toBe(stripActive(baselineBytes));

    const read = await readCommentsFromFile(pagePath);
    expect(read.comments.find((c) => c.id === id)?.active).toBe(0);
  });

  it("FULL REVERT to baseline via DELETE ?revert=baseline returns source byte-for-byte and cleans up", async () => {
    await runIterationWithHeading("V1 HEADLINE");

    const found = await findCommentById(project.root, id, EXCLUDE);
    expect(found?.comment.active).toBe(1);
    // Sanity: the live file currently differs from the original.
    const liveBeforeRevert = await readFile(pagePath, "utf8");
    expect(liveBeforeRevert).toContain("V1 HEADLINE");

    // ACT: DELETE /<id>?revert=baseline. active>0 so maybeRevertBeforeDelete
    // reads v0.tsx and writes it back BEFORE deleteCommentMarker strips the
    // marker + (last-reference) anchor, then both iteration dirs are removed.
    const req = createJsonRequest(undefined, {
      method: "DELETE",
      url: `/${id}?revert=baseline`,
    });
    const res = createMockResponse();
    await handleDelete(req, res.res, project.root, EXCLUDE);

    // Response contract.
    expect(res.getStatus()).toBe(200);
    expect(res.getJson()).toEqual({
      ok: true,
      id,
      file: PAGE_REL,
      removedAnchor: true,
      reverted: true,
    });

    // BYTE-FOR-BYTE: revert restored v0 (== baselineBytes), then the marker AND
    // its now-unreferenced data-comment-anchor were removed, yielding EXACTLY
    // the original pre-comment bytes.
    // NOTE: the fixture's own JSDoc mentions "@comment"/"data-comment-anchor"
    // as prose, so a substring check is meaningless here — the authoritative
    // invariant is exact equality to the pristine pre-comment bytes.
    const live = await readFile(pagePath, "utf8");
    expect(live).toBe(preCommentBytes);
    // The actual JSX marker (an opening brace + `@comment` directive) is gone.
    expect(live).not.toContain("{/* @comment");
    // The marker's id/anchor uuids no longer appear in source.
    expect(live).not.toContain(`id="${id}"`);

    // Cleanup contract: both iteration dirs gone; no roots resolve.
    expect(existsSync(`${project.root}/designs/iterations/${id}`)).toBe(false);
    expect(existsSync(`${project.root}/public/designs/iterations/${id}`)).toBe(
      false
    );
    expect(resolveIterationDirRoots(project.root, id)).toEqual([]);
  });

  it("deleting a single version (not baseline) keeps the file valid and re-points active", async () => {
    await runIterationWithHeading("V1 HEADLINE");
    await runIterationWithHeading("V2 HEADLINE");

    const roots = resolveIterationDirRoots(project.root, id);
    expect(await listCompleteIterationVersionsAllRoots(roots)).toEqual([
      0, 1, 2,
    ]);
    const found = await findCommentById(project.root, id, EXCLUDE);
    expect(found?.comment.active).toBe(2);

    // Capture pre-mutation bytes to prove a failed v0 delete touches nothing.
    const beforeBaselineRejected = await readFile(pagePath, "utf8");

    // v0 cannot be deleted — parseDeleteVersionBody rejects v<1 BEFORE any
    // file mutation.
    {
      const req = createJsonRequest({ id, v: 0 }, { method: "POST", url: "/" });
      const res = createMockResponse();
      await handleIterationsDelete(req, res.res, project.root, EXCLUDE);
      expect(res.getStatus()).toBe(400);
      expect((res.getJson() as { error: string }).error).toContain(
        "baseline v0 cannot be deleted"
      );
      // The live source is untouched by the rejected request.
      expect(await readFile(pagePath, "utf8")).toBe(beforeBaselineRejected);
    }

    // ACT: delete the ACTIVE version (v2). The route activates the newest
    // remaining version (v1) onto the live source, then removes v2's artifacts.
    {
      const req = createJsonRequest({ id, v: 2 }, { method: "POST", url: "/" });
      const res = createMockResponse();
      await handleIterationsDelete(req, res.res, project.root, EXCLUDE);
      expect(res.getStatus()).toBe(200);
      expect(res.getJson()).toEqual({
        ok: true,
        id,
        file: PAGE_REL,
        deleted: 2,
        active: 1,
      });
    }

    // v2 artifacts gone; v0 + v1 remain.
    expect(findVersionSnapshotPath(roots, 2)).toBeNull();
    expect(await listCompleteIterationVersionsAllRoots(roots)).toEqual([0, 1]);

    // Live source re-pointed to v1 and is still valid TSX with the marker.
    const live = await readFile(pagePath, "utf8");
    expect(live).toContain("V1 HEADLINE");
    expect(live).not.toContain("V2 HEADLINE");
    const read = await readCommentsFromFile(pagePath);
    expect(read.warnings).toEqual([]);
    expect(read.comments.find((c) => c.id === id)?.active).toBe(1);
  });

  it("activating a non-existent version fails cleanly WITHOUT touching live source", async () => {
    await runIterationWithHeading("V1 HEADLINE");
    const roots = resolveIterationDirRoots(project.root, id);
    const found = await findCommentById(project.root, id, EXCLUDE);
    if (!found) {
      throw new Error("comment not found after iteration");
    }

    const before = await readFile(pagePath, "utf8");

    const result = await applyIterationVersionToSource(
      found,
      roots,
      id,
      99,
      project.root
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toContain("version snapshot not found: v99.tsx");
    }

    // CRITICAL: a failed activation must never half-write the user's file.
    const after = await readFile(pagePath, "utf8");
    expect(after).toBe(before);
  });
});
