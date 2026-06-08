/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW UNDER TEST: run an agent iteration → snapshot files + manifest on disk
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * With a comment marker already present in a real .tsx file and the agent
 * STUBBED to return a canned variant (NO network / NO real Claude), running a
 * new iteration must:
 *   - write the version snapshot v{N}.tsx (and copy v0.png → v{N}.png) under
 *     designs/iterations/<commentId>/
 *   - patch the manifest.json with a VersionManifestEntry for that version
 *   - flip the comment marker's `active=N` to the last-created version
 *
 * Real modules under test:
 *   - src/server/iterations/run-iteration.ts
 *       export async function runNewIteration(input: RunNewIterationInput):
 *         Promise<void>
 *       (RunNewIterationInput: { count, found: FoundComment, hooks?, id,
 *         model, projectRoot, skills, stream: NdjsonStream })
 *       export function createNdjsonStream(req, res, opts): NdjsonStream
 *         — but for a pure integration test prefer a HAND-ROLLED NdjsonStream:
 *         { abortController: new AbortController(), clientGone: () => false,
 *           endStream: (final) => events.push(final),
 *           writeEvent: (e) => events.push(e) }
 *         so we can assert on the emitted progress/done events directly.
 *   - src/server/iterations/manifest.ts
 *       readIterationsManifest(iterDir), listCompleteIterationVersionsInDir,
 *       nextIterationVersion(iterDir), findVersionSnapshotPath(roots, v),
 *       resolveIterationDirRoots(projectRoot, id),
 *       manifestPath(iterDir), defaultSummaryForVersion(v).
 *   - src/server/iterations/baseline.ts
 *       seedBaselineIteration(projectRoot, commentId, screenshotBytes,
 *         baselineSource) — writes public/designs/iterations/<id>/v0.{tsx,png}
 *         and the "Baseline" manifest entry. Used to set up v0 before iterating.
 *   - src/server/comments/{writer,find-comment}.ts to plant the marker and
 *     resolve the FoundComment that runNewIteration consumes.
 *
 * NOTE ON DIRS: comment POST seeds v0 under public/designs/iterations/<id>/;
 *   the agent writes v{N>=1} under designs/iterations/<id>/. resolveIterationDirRoots
 *   merges both. runNewIteration copies a found v0.png into each v{N}.png.
 *
 * Helpers (owned by another agent — ASSUME THEY EXIST):
 *   import { createTempProject, stubAgent } from "../helpers";
 *     - stubAgent: vi.mock / dependency-injected stub of
 *       src/server/agent/index.ts `runAgent`. It must, on invocation, REWRITE
 *       the comment file on disk to a canned "variant" (e.g. change a className
 *       or text node) and resolve { ok: true, modelUsed, turnsUsed, toolCalls,
 *       attempts } — because runSingleAgentVariant re-reads found.absolutePath
 *       AFTER runAgent returns and diffs it to detect a change. A stub that
 *       returns ok:true WITHOUT editing the file yields changed:false and NO
 *       snapshot — tests must configure the canned edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
// TODO: import { createTempProject, stubAgent } from "../helpers";
// TODO: import { writeCommentToFile } from "../../src/server/comments/writer.ts";
// TODO: import { findCommentById } from "../../src/server/comments/find-comment.ts";
// TODO: import { seedBaselineIteration } from "../../src/server/iterations/baseline.ts";
// TODO: import { runNewIteration } from "../../src/server/iterations/run-iteration.ts";
// TODO: import {
//         resolveIterationDirRoots,
//         readIterationsManifest,
//         findVersionSnapshotPath,
//         listCompleteIterationVersionsInDir,
//       } from "../../src/server/iterations/manifest.ts";
// TODO: import { readCommentsFromFile } from "../../src/server/comments/reader.ts";

describe("integration: iteration snapshot + manifest", () => {
  // let project: Awaited<ReturnType<typeof createTempProject>>;
  // let agent: ReturnType<typeof stubAgent>;

  beforeEach(async () => {
    // TODO: project = await createTempProject();
    // TODO: agent = stubAgent();  // installs the runAgent mock; reset per test.
    // TODO: COMMON SETUP for most tests:
    //   1. writeCommentToFile(...) at a known coordinate → capture { id, anchor }.
    //   2. read post-write source → seedBaselineIteration(root, id,
    //        /* screenshotBytes */ <tiny valid PNG Buffer>, baselineSource)
    //      so v0.tsx + v0.png + a "Baseline" manifest entry exist BEFORE the
    //      agent runs (runNewIteration copies v0.png → v{N}.png).
    //   3. const found = await findCommentById(root, id, []);
  });

  afterEach(async () => {
    // TODO: await project.cleanup();
    // TODO: agent.restore(); // vi.restoreAllMocks();
  });

  it.todo(
    "running one iteration writes v1.tsx + v1.png, a manifest entry, and flips active=1",
    async () => {
      // ARRANGE: configure the stub so that when runAgent is called it edits
      //   the comment file on disk into a recognizable variant (e.g. replaces
      //   a heading's text). Build a hand-rolled NdjsonStream collecting events.
      //
      // ACT: await runNewIteration({ projectRoot: root, found, id, count: 1,
      //   model: "default", skills: [], stream });
      //
      // ASSERT (agent called): the stub was invoked exactly once with
      //   { projectRoot, file: found.relativePath, anchor, text, ... }.
      //
      // ASSERT (snapshot files on disk): under designs/iterations/<id>/ there
      //   is v1.tsx whose contents equal the agent-edited source, and v1.png
      //   exists (copied from v0.png). Use findVersionSnapshotPath(
      //   resolveIterationDirRoots(root, id), 1) !== null.
      //
      // ASSERT (manifest): readIterationsManifest(<designs iterDir>) has a
      //   versions["1"] entry with a non-empty summary, an ISO createdAt, and
      //   a runId of the form "<id>:<ts>". listCompleteIterationVersionsInDir
      //   (the designs dir) includes 1.
      //
      // ASSERT (active flipped): readCommentsFromFile(found.absolutePath) shows
      //   the marker's active === 1 (finishSuccessfulBatch sets it on the live
      //   file via setCommentActiveInSource).
      //
      // ASSERT (done event): the stream's final event is
      //   { type: "done", ok: true, id, changed: true, v: 1, versions: [1],
      //     tsx: "/designs/iterations/<id>/v1.tsx", png: <url> }.
    }
  );

  it.todo("agent makes no change → no snapshot, done.changed=false", async () => {
    // ARRANGE: stub runAgent to resolve ok:true WITHOUT editing the file.
    // ACT: runNewIteration count:1.
    // ASSERT: no v1.tsx is created; manifest has no "1" entry; the final event
    //   is { type:"done", ok:true, changed:false }; the marker's active stays 0.
  });

  // ── Multiple iterations accumulate versions ────────────────────────────────

  it.todo(
    "multiple sequential iterations accumulate v1, v2, v3 with ascending manifest keys",
    async () => {
      // ACT: run runNewIteration three times (each with count:1), giving the
      //   stub a DIFFERENT canned edit each time.
      // ASSERT (accumulation): designs/iterations/<id>/ contains v1.tsx, v2.tsx,
      //   v3.tsx (+ matching .png). nextIterationVersion(iterDir) would return 4.
      // ASSERT (manifest ordering): Object.keys(manifest.versions) sorted
      //   numerically === ["0","1","2","3"] (v0 from baseline). createdAt of
      //   each later version is >= the previous (monotonic per run).
      // ASSERT (active): after the 3rd run the marker's active === 3.
    }
  );

  it.todo(
    "count>1 in a single run produces multiple variants v1..vN in one batch",
    async () => {
      // ARRANGE: stub runAgent to produce a distinct edit per variantIndex
      //   (the stub receives variantIndex / variantCount). count: 3.
      // ACT: runNewIteration({ count: 3, ... }).
      // ASSERT: createdVersions in the done event === [1,2,3]; three v{N}.tsx
      //   snapshots exist; the LAST successful variant is the one left active
      //   on the live source (finishSuccessfulBatch uses createdVersions.at(-1)).
      // ASSERT: each variant started from the pre-agent baseline (the run resets
      //   the file to beforeSource before each variant — see
      //   runSingleAgentVariant), so snapshots are independent, not cumulative.
    }
  );

  // ── Baseline capture ───────────────────────────────────────────────────────

  it.todo(
    "baseline v0 is captured by seedBaselineIteration and survives iteration",
    async () => {
      // ARRANGE: after writeCommentToFile, call seedBaselineIteration with a
      //   real screenshot Buffer + the post-write source.
      // ASSERT (before iterating): public/designs/iterations/<id>/v0.tsx exists
      //   and CONTAINS the @comment marker (so activating v0 later preserves it,
      //   not wipes it — this is the documented invariant in routes.ts).
      //   v0.png exists; manifest versions["0"].summary === "Baseline".
      // ACT: run one iteration.
      // ASSERT (after): v0.tsx is UNCHANGED (iteration never overwrites v0);
      //   v1.tsx is new; both v0 and v1 appear in
      //   listCompleteIterationVersionsAllRoots(resolveIterationDirRoots(...)).
    }
  );
});
