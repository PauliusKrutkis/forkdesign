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
 * Real modules under test:
 *   - src/server/iterations/activate-version.ts
 *       export async function applyIterationVersionToSource(found,
 *         iterationRoots, id, v, projectRoot): Promise<IterationApplyResult>
 *       // { ok:true, writtenFiles } | { ok:false, status, message }
 *       It reads found.absolutePath + the v{N}.tsx snapshot, merges (full design
 *       revert when safe, else element-only merge), sets active=v via
 *       setCommentActiveInSource, atomicWriteText's it, and restores aux files.
 *   - The "full revert to baseline" path is exercised via the API:
 *       src/server/api/comments/routes.ts handleDelete with `?revert=baseline`
 *       (maybeRevertBeforeDelete) — it reads v0.tsx and atomicWriteText's it
 *       back onto the live file BEFORE deleting the marker, then rm -rf's the
 *       iteration dirs (designs/ + public/designs/). There is NO standalone
 *       `activate-full-revert.ts` module — only activate-version.ts +
 *       runs.ts; the revert-to-baseline behavior lives in the comments route.
 *       (Test both: activating v0 via applyIterationVersionToSource AND the
 *       ?revert=baseline delete flow.)
 *   - src/server/iterations/manifest.ts: resolveIterationDirRoots,
 *       findVersionSnapshotPath, readIterationsManifest,
 *       deleteVersionArtifactsAllRoots, listCompleteIterationVersionsAllRoots.
 *
 * Helpers (owned by another agent — ASSUME THEY EXIST):
 *   import { createTempProject, stubAgent } from "../helpers";
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// TODO: import { createTempProject, stubAgent } from "../helpers";
// TODO: import { writeCommentToFile } from "../../src/server/comments/writer.ts";
// TODO: import { findCommentById } from "../../src/server/comments/find-comment.ts";
// TODO: import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
// TODO: import { seedBaselineIteration } from "../../src/server/iterations/baseline.ts";
// TODO: import { runNewIteration } from "../../src/server/iterations/run-iteration.ts";
// TODO: import { applyIterationVersionToSource } from "../../src/server/iterations/activate-version.ts";
// TODO: import { resolveIterationDirRoots, findVersionSnapshotPath, listCompleteIterationVersionsAllRoots }
//         from "../../src/server/iterations/manifest.ts";
// TODO: import { readFile } from "node:fs/promises";
// TODO: import { existsSync } from "node:fs";

describe("integration: activate version + full revert (SAFETY-CRITICAL)", () => {
  // let project: Awaited<ReturnType<typeof createTempProject>>;
  // let agent: ReturnType<typeof stubAgent>;
  // let baselineBytes: string;   // EXACT pre-iteration source, captured once.
  // let id: string;             // comment id.

  beforeEach(async () => {
    // TODO: project = await createTempProject(); agent = stubAgent();
    // TODO: write a comment, capture { id }.
    // TODO: baselineBytes = await readFile(found.absolutePath, "utf8");  // the
    //       source WITH the freshly-written marker — this is what v0 captures.
    // TODO: seedBaselineIteration(root, id, <png buffer>, baselineBytes).
    // TODO: NOTE: capture baselineBytes EXACTLY here; later reverts must match
    //       it byte-for-byte.
  });

  afterEach(async () => {
    // TODO: await project.cleanup(); agent.restore();
  });

  it.todo(
    "activating a version rewrites live source to that variant and sets active=N",
    async () => {
      // ARRANGE: stub the agent to produce a recognizable v1 edit; run one
      //   iteration so v1.tsx exists on disk.
      // PRE-ASSERT: the live source currently reflects v1 (finishSuccessfulBatch
      //   already left active=1). Re-read found via findCommentById.
      //
      // ACT: applyIterationVersionToSource(found, roots, id, 1, root).
      // ASSERT: result.ok === true; result.writtenFiles includes
      //   found.absolutePath.
      // ASSERT (source reflects variant): the live file contains the v1
      //   canned-edit signature AND the marker is intact with active=1.
      //   Compare the live file BYTE-FOR-BYTE to v1.tsx after normalizing only
      //   the directive's active attribute (active is stamped onto the live
      //   file, so the body must match v1.tsx but with active=1).
    }
  );

  it.todo(
    "activating v0 restores the baseline markup while keeping the marker",
    async () => {
      // ARRANGE: run an iteration (active becomes 1), refresh `found`.
      // ACT: applyIterationVersionToSource(found, roots, id, 0, root).
      // ASSERT: ok:true; the live file equals baselineBytes EXCEPT the marker's
      //   active attribute is now 0 (setCommentActiveInSource stamps active=0).
      //   The @comment marker MUST still be present (v0 was seeded WITH it) —
      //   activating v0 must NOT wipe the comment.
    }
  );

  it.todo(
    "FULL REVERT to baseline via DELETE ?revert=baseline returns source byte-for-byte and cleans up",
    async () => {
      // This drives the real comments route (handleDelete) — see api-routes
      // test for the http harness; here focus on the file-system invariants.
      //
      // ARRANGE: run an iteration so active=1 and v1.tsx exists; refresh found.
      // ACT: call handleDelete with url "/<id>?revert=baseline" (active>0 so
      //   maybeRevertBeforeDelete reads v0.tsx and writes it back BEFORE the
      //   marker is removed), then the route deletes the marker AND rm -rf's
      //   both iteration dirs.
      //
      // ASSERT (byte-for-byte to baseline THEN marker removed): the route
      //   first reverts to v0 (== baselineBytes), then deleteCommentMarker
      //   strips the @comment block AND the data-comment-anchor (since it was
      //   the last marker referencing the anchor). So the FINAL live source ==
      //   the ORIGINAL fixture bytes BEFORE any comment was written (i.e. the
      //   pre-comment source). ⇒ capture pre-comment bytes in beforeEach too
      //   and assert toBe against THAT, not baselineBytes (which includes the
      //   marker).
      //
      // ASSERT (cleanup per spec): after the delete,
      //   designs/iterations/<id>/ and public/designs/iterations/<id>/ no
      //   longer exist (existsSync === false); resolveIterationDirRoots(root,
      //   id) === []. The DELETE response body is
      //   { ok:true, id, file, removedAnchor:true, reverted:true }.
    }
  );

  it.todo(
    "deleting a single version (not baseline) keeps the file valid and re-points active",
    async () => {
      // ARRANGE: run two iterations (v1, v2; active=2). refresh found.
      // ACT: handleIterationsDelete { id, v: 2 } (the active one).
      // ASSERT: because v2 was active, the route first activates the newest
      //   remaining version (v1) onto the live source, THEN removes v2.tsx/.png
      //   + manifest entry + aux files. Response active === 1.
      // ASSERT: v0 cannot be deleted — parseDeleteVersionBody enforces v>=1
      //   (a { id, v: 0 } request is rejected 400 before any file mutation).
      // ASSERT: live source still parses as valid TSX after the re-point.
    }
  );

  it.todo(
    "activating a non-existent version fails cleanly WITHOUT touching live source",
    async () => {
      // ACT: applyIterationVersionToSource(found, roots, id, 99, root).
      // ASSERT: result.ok === false, result.status === 400, message mentions
      //   "version snapshot not found: v99.tsx". CRITICAL: the live source is
      //   unchanged byte-for-byte (read before & after, toBe). A failed
      //   activation must never leave the user's file half-written.
    }
  );
});
