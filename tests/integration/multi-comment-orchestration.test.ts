/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TIER 1 — DETERMINISTIC orchestration scenarios (agent STUBBED, zero tokens)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are the scenarios that are painful to click through by hand: multiple
 * comments, on different components, with multi-variant batches and cross-file
 * edits, plus activate/revert and cancellation. None of this needs the real
 * agent — `stubAgent` already models variants (`variantIndex`), cross-file
 * edits (`auxFiles`), and failures (`setNextError`). The point is to lock down
 * the ORCHESTRATION (which file gets edited, which snapshot/manifest entry is
 * written, which marker's `active=N` flips, what stays untouched), NOT the
 * quality of the model's output (not tested — that's the model's job, not ours).
 *
 * Conventions to follow (see tests/integration/iteration-snapshot.test.ts):
 *   - `createTempProject()` copies tests/fixtures/playground → temp `src/`.
 *   - Recompute tag coordinates with a `locateTag(source, "Tag")` helper BEFORE
 *     every `writeCommentToFile` (each write shifts line/column).
 *   - Drive runs via `runNewIteration({ projectRoot, found, id, count, model,
 *     skills: [], stream })` with a StreamCollector (copy the one from
 *     iteration-snapshot.test.ts, or promote it into tests/helpers/).
 *   - Assert on `project.listSnapshots()`, `project.readSnapshot(...)`,
 *     `readActive(absolutePath, id)`, and the manifest readers from
 *     src/server/iterations/manifest.ts.
 *
 * PREREQUISITE (blocks every test below):
 * TODO(tier1): extend the fixture — flesh out src/components/SiteNav.tsx and
 *   src/components/Pricing.tsx and MOUNT them in src/fixtures.../src/App.tsx
 *   without removing existing title/card/cta elements. Promote `locateTag` and
 *   `createStreamCollector` into tests/helpers/ so this file and
 *   iteration-snapshot.test.ts share them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it } from "vitest";

describe("integration: multi-comment orchestration (stubbed agent)", () => {
  // ── Multiple comments on DIFFERENT components stay isolated ────────────────
  it.todo(
    "iterating a comment on <Pricing> leaves <SiteNav> and <App> markers + snapshots untouched"
    // TODO: place 3 comments (App.title, SiteNav.cta, Pricing.pro-cta), run an
    // iteration on ONLY the Pricing one, then assert:
    //   - designs/iterations/<pricingId>/v1.tsx exists; the other two ids have
    //     no v1 snapshot.
    //   - active=1 only on the Pricing marker; the other two stay active=0.
    //   - the agent was called with found.relativePath === Pricing's file.
  );

  // ── Multiple comments on the SAME component, independent anchors ───────────
  it.todo(
    "two comments on sibling pricing tiers resolve to distinct anchors and snapshot independently"
    // TODO: comment the "free" and "pro" tier CTAs (near-identical markup),
    // iterate each, assert each id's snapshot edited only its own element and
    // the two anchors differ (no cross-contamination from duplicate structure).
  );

  // ── Multi-variant batch (count > 1) ────────────────────────────────────────
  // NOTE: the count=3 → v1..vN + activate-last case is covered by
  // iteration-snapshot.test.ts ("count>1 in a single run produces multiple
  // variants v1..vN in one batch"); only the prior-approaches threading below
  // remains uncovered.
  it.todo(
    "priorVariantApproaches is threaded into later variants of the same batch"
    // TODO: assert agent.calls[1].priorVariantApproaches / [2] include the
    // approaches reported for earlier variants (divergent-variant contract).
  );

  // ── Cross-file / aux-file edits ────────────────────────────────────────────
  it.todo(
    "an agent edit to a shared component is captured as an aux-file snapshot and reverts on version switch"
    // TODO: stubAgent variant with auxFiles: { "src/components/Button.tsx": ... }
    // plus the comment-file source edit. Assert the aux file is snapshotted in
    // the version dir and that activating a DIFFERENT version restores/reverts
    // the shared file (aux-files.ts baseline-merge + restore path).
  );

  // ── Cancellation / failure rollback (the bug class PRs #18/#20 were about) ─
  it.todo(
    "cancelling a run after the agent edits source restores the pre-run baseline and writes no snapshot"
    // TODO: abort stream.abortController mid-run (or stubAgent that edits then a
    // hook that aborts before persist); assert the live source equals the
    // pre-run baseline, no v{N} snapshot/manifest entry was created, and the
    // marker's active is unchanged.
  );

  it.todo(
    "an agent failure (setNextError) leaves source + markers + snapshots unchanged"
    // TODO: agent.setNextError("boom"); run; assert done event ok:false, source
    // untouched, no snapshot written, active unchanged.
  );

  // ── Concurrency guard ──────────────────────────────────────────────────────
  it.todo(
    "a second run for the same comment while one is in-flight is rejected/queued, not interleaved"
    // TODO: model the runs registry behavior (src/server/iterations/runs.ts):
    // overlapping runs for the same id must not corrupt visible active state.
    // Cross-reference tests/integration/concurrent-writes.test.ts.
  );
});
