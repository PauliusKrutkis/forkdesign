/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TIER 1 — DETERMINISTIC orchestration scenarios (agent STUBBED, zero tokens)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These are the scenarios that are painful to click through by hand: multiple
 * comments, on different components, with multi-variant batches and cross-file
 * edits, plus activate/revert, cancellation, and the concurrency guard. None of
 * this needs the real agent — `stubAgent` already models variants
 * (`variantIndex`), cross-file edits (`auxFiles`), and failures
 * (`setNextError`). The point is to lock down the ORCHESTRATION (which file gets
 * edited, which snapshot/manifest entry is written, which marker's `active=N`
 * flips, what stays untouched), NOT the quality of the model's output (not
 * tested — that's the model's job, not ours).
 *
 * Fixture layout note: `createTempProject()` copies tests/fixtures/playground →
 * the temp project's `src/`, so the playground's OWN `src/` ends up nested. The
 * relative paths the server sees are therefore:
 *   - src/App.tsx                       (top-level fixture: h1/div/button)
 *   - src/src/components/SiteNav.tsx     (mounts <Button>)
 *   - src/src/components/Pricing.tsx     (three near-identical tiers)
 *   - src/src/components/Button.tsx      (shared, imported by both → aux-file)
 * `findCommentById` walks all of `src/**`, so comments can live in any of them.
 *
 * Conventions (mirrors tests/integration/iteration-snapshot.test.ts):
 *   - Recompute tag coordinates against the LIVE source before every
 *     `writeCommentToFile` (each write shifts line/column) — `plantComment` does.
 *   - Drive runs via `runNewIteration({ projectRoot, found, id, count, model,
 *     skills: [], stream })` with a `createStreamCollector()`.
 *   - Assert on `resolveIterationDirRoots` / `findVersionSnapshotPath` /
 *     `readIterationsManifest` and `readActive(absolutePath, id)`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCommentById } from "../../src/server/comments/find-comment.ts";
import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
import { writeCommentToFile } from "../../src/server/comments/writer.ts";
import { applyIterationVersionToSource } from "../../src/server/iterations/activate-version.ts";
import { seedBaselineIteration } from "../../src/server/iterations/baseline.ts";
import {
  findVersionSnapshotPath,
  listCompleteIterationVersionsAllRoots,
  readIterationsManifest,
  resolveIterationDirRoots,
} from "../../src/server/iterations/manifest.ts";
import {
  type NdjsonStream,
  runNewIteration,
} from "../../src/server/iterations/run-iteration.ts";
import {
  finishIterationRun,
  hasActiveIterationRun,
  startIterationRun,
} from "../../src/server/iterations/runs.ts";
import { createTempProject, stubAgent } from "../helpers/index.ts";

// ── Fixture-relative paths (see layout note above) ───────────────────────────
const APP_REL = "src/App.tsx";
const SITENAV_REL = "src/src/components/SiteNav.tsx";
const PRICING_REL = "src/src/components/Pricing.tsx";
const BUTTON_REL = "src/src/components/Button.tsx";

const AUTHOR = "tester@example.com";
const EXCLUDE: string[] = [];
const model = "default" as const;

/** A tiny valid 1×1 PNG (transparent), used as the baseline screenshot. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

// Prior-approach summaries the orchestrator prefixes with "Variant N:".
const VARIANT_1_APPROACH_RE = /^Variant 1:/;
const VARIANT_2_APPROACH_RE = /^Variant 2:/;

// ── Test utilities ────────────────────────────────────────────────────────────

interface StreamCollector extends NdjsonStream {
  events: object[];
  final(): object | undefined;
  hasDone(): boolean;
}

/**
 * A hand-rolled NdjsonStream that records every emitted event. Unlike the
 * snapshot suite's collector, `clientGone()` reflects the REAL abort signal so
 * cancellation/concurrency tests can drive it. Pass an external AbortController
 * (e.g. one from the runs registry) to share cancellation state.
 */
function createStreamCollector(
  abortController: AbortController = new AbortController()
): StreamCollector {
  const events: object[] = [];
  return {
    events,
    abortController,
    clientGone(): boolean {
      return abortController.signal.aborted;
    },
    writeEvent(event: object): void {
      events.push(event);
    },
    endStream(finalEvent: object): void {
      events.push(finalEvent);
    },
    final(): object | undefined {
      return events.at(-1);
    },
    hasDone(): boolean {
      return events.some((e) => (e as { type?: string }).type === "done");
    },
  };
}

/**
 * Locate the 1-indexed (line, column) of the `<` that begins `needle` in the
 * CURRENT source. `needle` must start with `<` (e.g. `<h1` or
 * `<Button testId="tier-pro-cta"`). Coordinates shift after each write, so this
 * is recomputed against the live source by `plantComment`.
 */
function locateOpenTag(
  source: string,
  needle: string
): { line: number; column: number } {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i]?.indexOf(needle) ?? -1;
    if (idx >= 0) {
      return { line: i + 1, column: idx + 1 };
    }
  }
  throw new Error(`tag "${needle}" not found in source`);
}

interface PlantedComment {
  absolutePath: string;
  anchor: string;
  id: string;
  relPath: string;
}

/**
 * Write a comment marker onto the element identified by `needle` in `relPath`,
 * recomputing coordinates against the current (possibly already-marked) source.
 */
async function plantComment(
  project: Awaited<ReturnType<typeof createTempProject>>,
  relPath: string,
  needle: string,
  text: string
): Promise<PlantedComment> {
  const absolutePath = project.srcFile(relPath);
  const source = await project.readSource(relPath);
  const { line, column } = locateOpenTag(source, needle);
  const written = await writeCommentToFile({
    absolutePath,
    author: AUTHOR,
    column,
    line,
    text,
  });
  return { id: written.id, anchor: written.anchor, absolutePath, relPath };
}

/** Seed v0 (baseline) for `comment` from the file's CURRENT (post-write) bytes. */
async function seedBaseline(
  project: Awaited<ReturnType<typeof createTempProject>>,
  comment: PlantedComment
): Promise<string> {
  const baseline = await project.readSource(comment.relPath);
  await seedBaselineIteration(project.root, comment.id, TINY_PNG, baseline);
  return baseline;
}

/** Read the marker's `active` for a comment id from the live file (0 default). */
async function readActive(absolutePath: string, id: string): Promise<number> {
  const result = await readCommentsFromFile(absolutePath);
  const match = result.comments.find((c) => c.id === id);
  if (!match) {
    throw new Error(`comment id="${id}" not found in ${absolutePath}`);
  }
  return match.active ?? 0;
}

function designsIterDir(root: string, id: string): string {
  return path.join(root, "designs", "iterations", id);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("integration: multi-comment orchestration (stubbed agent)", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let agent: ReturnType<typeof stubAgent>;

  beforeEach(async () => {
    project = await createTempProject();
    agent = stubAgent();
  });

  afterEach(async () => {
    await project.cleanup();
    agent.restore();
  });

  // ── Multiple comments on DIFFERENT components stay isolated ────────────────
  it("iterating a comment on <Pricing> leaves <SiteNav> and <App> markers + snapshots untouched", async () => {
    const app = await plantComment(
      project,
      APP_REL,
      "<h1",
      "make the title pop"
    );
    const nav = await plantComment(
      project,
      SITENAV_REL,
      "<nav",
      "tighten the nav"
    );
    const pricing = await plantComment(
      project,
      PRICING_REL,
      '<Button testId="tier-pro-cta"',
      "make Pro stand out"
    );

    await seedBaseline(project, app);
    const navBaseline = await seedBaseline(project, nav);
    await seedBaseline(project, pricing);
    const appBaseline = await project.readSource(APP_REL);

    const found = await findCommentById(project.root, pricing.id, EXCLUDE);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }
    expect(found.relativePath).toBe(PRICING_REL);

    const pricingBaseline = await project.readSource(PRICING_REL);
    agent.setVariant({
      source: pricingBaseline.replace("Go Pro", "Go Pro — Upgraded"),
    });

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id: pricing.id,
      count: 1,
      model,
      skills: [],
      stream,
    });

    // Only the Pricing comment was dispatched, pointed at the Pricing file.
    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(agent.calls[0]?.file).toBe(PRICING_REL);

    // Pricing got v1; the other two ids have NO v1 snapshot anywhere.
    const pricingRoots = resolveIterationDirRoots(project.root, pricing.id);
    expect(findVersionSnapshotPath(pricingRoots, 1)).not.toBeNull();
    const v1 = await project.readSnapshot(`iterations/${pricing.id}/v1.tsx`);
    expect(v1).toContain("Go Pro — Upgraded");
    for (const c of [app, nav]) {
      const roots = resolveIterationDirRoots(project.root, c.id);
      expect(findVersionSnapshotPath(roots, 1)).toBeNull();
    }

    // active=1 only on Pricing; App + SiteNav stay at 0.
    expect(await readActive(pricing.absolutePath, pricing.id)).toBe(1);
    expect(await readActive(app.absolutePath, app.id)).toBe(0);
    expect(await readActive(nav.absolutePath, nav.id)).toBe(0);

    // The other two files were not touched on disk (byte-for-byte).
    expect(await project.readSource(APP_REL)).toBe(appBaseline);
    expect(await project.readSource(SITENAV_REL)).toBe(navBaseline);

    expect(stream.final()).toMatchObject({
      type: "done",
      ok: true,
      id: pricing.id,
      changed: true,
      v: 1,
      versions: [1],
    });
  });

  // ── Multiple comments on the SAME component, independent anchors ───────────
  it("two comments on sibling pricing tiers resolve to distinct anchors and snapshot independently", async () => {
    const free = await plantComment(
      project,
      PRICING_REL,
      '<Button testId="tier-free-cta"',
      "rename the free CTA"
    );
    // Second plant recomputes coordinates against the now-marked source.
    const pro = await plantComment(
      project,
      PRICING_REL,
      '<Button testId="tier-pro-cta"',
      "rename the pro CTA"
    );

    // Near-identical sibling markup still yields DISTINCT anchors.
    expect(free.anchor).not.toBe(pro.anchor);

    await seedBaseline(project, free);
    await seedBaseline(project, pro);

    // ── Iterate the FREE tier: only its CTA text changes. ──
    const freeBaseline = await project.readSource(PRICING_REL);
    const foundFree = await findCommentById(project.root, free.id, EXCLUDE);
    expect(foundFree).not.toBeNull();
    if (!foundFree) {
      return;
    }
    const freeEdited = freeBaseline.replace("Start free", "Start free now!!");
    expect(freeEdited).not.toBe(freeBaseline);
    agent.setVariant({ source: freeEdited });
    await runNewIteration({
      projectRoot: project.root,
      found: foundFree,
      id: free.id,
      count: 1,
      model,
      skills: [],
      stream: createStreamCollector(),
    });

    const vFree = await project.readSnapshot(`iterations/${free.id}/v1.tsx`);
    expect(vFree).toBe(freeEdited);
    // The pro tier's CTA is untouched in the free snapshot.
    expect(vFree).toContain("Go Pro");

    // ── Iterate the PRO tier: only its CTA text changes. ──
    const proBaseline = await project.readSource(PRICING_REL);
    const foundPro = await findCommentById(project.root, pro.id, EXCLUDE);
    expect(foundPro).not.toBeNull();
    if (!foundPro) {
      return;
    }
    const proEdited = proBaseline.replace("Go Pro", "Go Pro today!!");
    expect(proEdited).not.toBe(proBaseline);
    agent.setVariant({ source: proEdited });
    await runNewIteration({
      projectRoot: project.root,
      found: foundPro,
      id: pro.id,
      count: 1,
      model,
      skills: [],
      stream: createStreamCollector(),
    });

    const vPro = await project.readSnapshot(`iterations/${pro.id}/v1.tsx`);
    expect(vPro).toBe(proEdited);
    // The free tier's earlier edit survives — no cross-contamination, and the
    // pro run changed ONLY the pro CTA relative to its own baseline.
    expect(vPro).toContain("Start free now!!");

    // Each marker carries its own active=1, in the same file, independently.
    expect(await readActive(free.absolutePath, free.id)).toBe(1);
    expect(await readActive(pro.absolutePath, pro.id)).toBe(1);
  });

  // ── Multi-variant batch (count > 1) ────────────────────────────────────────
  // NOTE: the count=3 → v1..vN + activate-last case is covered by
  // iteration-snapshot.test.ts ("count>1 in a single run produces multiple
  // variants v1..vN in one batch"); only the prior-approaches threading below
  // remains uncovered.
  it("priorVariantApproaches is threaded into later variants of the same batch", async () => {
    const app = await plantComment(
      project,
      APP_REL,
      "<h1",
      "try a few headings"
    );
    const appBaseline = await seedBaseline(project, app);

    const found = await findCommentById(project.root, app.id, EXCLUDE);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    // The orchestrator threads ONE growing array through every variant, so we
    // must snapshot what each variant SAW at dispatch time (copy it now) rather
    // than inspect `agent.calls` afterward (which would alias the final array).
    const seen: (string[] | undefined)[] = [];
    agent.setVariant((input) => {
      seen.push(
        input.priorVariantApproaches
          ? [...input.priorVariantApproaches]
          : undefined
      );
      // Each variant makes a DISTINCT change (so each counts as a successful
      // variant whose approach gets summarized and fed to the next).
      return {
        source: appBaseline.replace(
          "ForkDesign Playground",
          `ForkDesign Playground v${input.variantIndex}`
        ),
      };
    });

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id: app.id,
      count: 3,
      model,
      skills: [],
      stream,
    });

    expect(agent.calls).toHaveLength(3);

    // Variant 1 saw no prior approaches; 2 saw [1]; 3 saw [1,2].
    expect(seen[0]).toBeUndefined();

    expect(seen[1]).toHaveLength(1);
    expect(seen[1]?.[0]).toMatch(VARIANT_1_APPROACH_RE);

    expect(seen[2]).toHaveLength(2);
    expect(seen[2]?.[0]).toMatch(VARIANT_1_APPROACH_RE);
    expect(seen[2]?.[1]).toMatch(VARIANT_2_APPROACH_RE);

    expect(stream.final()).toMatchObject({
      type: "done",
      ok: true,
      changed: true,
      versions: [1, 2, 3],
      v: 3,
    });
  });

  // ── Cross-file / aux-file edits ────────────────────────────────────────────
  it("an agent edit to a shared component is captured as an aux-file snapshot and reverts on version switch", async () => {
    const nav = await plantComment(
      project,
      SITENAV_REL,
      "<nav",
      "restyle the CTA"
    );
    const navBaseline = await seedBaseline(project, nav);
    const originalButton = await project.readSource(BUTTON_REL);

    // ── v1: edit the comment file AND the shared Button.tsx (aux file). ──
    const editedButton = originalButton.replace("btn btn-", "btn btn-edited-");
    expect(editedButton).not.toBe(originalButton);
    agent.setVariant({
      source: navBaseline.replace("Get started", "Get started V1"),
      auxFiles: { [BUTTON_REL]: editedButton },
    });

    const found1 = await findCommentById(project.root, nav.id, EXCLUDE);
    expect(found1).not.toBeNull();
    if (!found1) {
      return;
    }
    await runNewIteration({
      projectRoot: project.root,
      found: found1,
      id: nav.id,
      count: 1,
      model,
      skills: [],
      stream: createStreamCollector(),
    });

    // The aux edit is snapshotted in v1.files.json, with the pre-agent content
    // recorded in the v0 baseline map.
    const v1Aux = JSON.parse(
      await project.readSnapshot(`iterations/${nav.id}/v1.files.json`)
    ) as Record<string, string>;
    expect(v1Aux[BUTTON_REL]).toBe(editedButton);
    const v0Aux = JSON.parse(
      await project.readSnapshot(`iterations/${nav.id}/v0.files.json`)
    ) as Record<string, string>;
    expect(v0Aux[BUTTON_REL]).toBe(originalButton);

    // v1 active → the shared file on disk holds the edited content.
    expect(await project.readSource(BUTTON_REL)).toBe(editedButton);
    expect(await readActive(nav.absolutePath, nav.id)).toBe(1);

    // ── v2: edit ONLY the comment file (Button untouched). ──
    const navNow = await project.readSource(SITENAV_REL);
    agent.setVariant({
      source: navNow.replace("Get started V1", "Get started V2"),
    });
    const found2 = await findCommentById(project.root, nav.id, EXCLUDE);
    expect(found2).not.toBeNull();
    if (!found2) {
      return;
    }
    await runNewIteration({
      projectRoot: project.root,
      found: found2,
      id: nav.id,
      count: 1,
      model,
      skills: [],
      stream: createStreamCollector(),
    });
    const roots = resolveIterationDirRoots(project.root, nav.id);
    expect(findVersionSnapshotPath(roots, 2)).not.toBeNull();
    // v2 did not touch Button → it reverts to the recorded baseline.
    expect(await project.readSource(BUTTON_REL)).toBe(originalButton);
    expect(await readActive(nav.absolutePath, nav.id)).toBe(2);

    // ── Activate v1 again → the shared file is restored to v1's content. ──
    const found3 = await findCommentById(project.root, nav.id, EXCLUDE);
    if (!found3) {
      throw new Error("comment vanished before re-activating v1");
    }
    const apply1 = await applyIterationVersionToSource(
      found3,
      roots,
      nav.id,
      1,
      project.root
    );
    expect(apply1.ok).toBe(true);
    if (apply1.ok) {
      expect(apply1.writtenFiles).toContain(project.srcFile(BUTTON_REL));
    }
    expect(await project.readSource(BUTTON_REL)).toBe(editedButton);
    expect(await project.readSource(SITENAV_REL)).toContain("Get started V1");

    // ── Activate v2 → the shared file reverts to baseline again. ──
    const found4 = await findCommentById(project.root, nav.id, EXCLUDE);
    if (!found4) {
      throw new Error("comment vanished before re-activating v2");
    }
    const apply2 = await applyIterationVersionToSource(
      found4,
      roots,
      nav.id,
      2,
      project.root
    );
    expect(apply2.ok).toBe(true);
    expect(await project.readSource(BUTTON_REL)).toBe(originalButton);
    expect(await project.readSource(SITENAV_REL)).toContain("Get started V2");
  });

  // ── Cancellation / failure rollback (the bug class PRs #18/#20 were about) ─
  it("cancelling a run after the agent edits source restores the pre-run baseline and writes no snapshot", async () => {
    const app = await plantComment(project, APP_REL, "<h1", "rework the hero");
    const appBaseline = await seedBaseline(project, app);

    const found = await findCommentById(project.root, app.id, EXCLUDE);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    const stream = createStreamCollector();
    // The agent edits the file, but the client disconnects mid-run (abort fires
    // while the agent is "working") — the orchestrator must roll the edit back.
    agent.setVariant(() => {
      stream.abortController.abort();
      return {
        source: appBaseline.replace(
          "ForkDesign Playground",
          "ForkDesign Playground EDITED"
        ),
      };
    });

    await runNewIteration({
      projectRoot: project.root,
      found,
      id: app.id,
      count: 1,
      model,
      skills: [],
      stream,
    });

    // Live source is restored byte-for-byte to the pre-run baseline.
    expect(await project.readSource(APP_REL)).toBe(appBaseline);

    // No snapshot, no manifest entry, active unchanged.
    const roots = resolveIterationDirRoots(project.root, app.id);
    expect(findVersionSnapshotPath(roots, 1)).toBeNull();
    const manifest = await readIterationsManifest(
      designsIterDir(project.root, app.id)
    );
    expect(manifest?.versions["1"]).toBeUndefined();
    expect(await readActive(found.absolutePath, app.id)).toBe(0);

    // A cancelled run emits no terminal `done` event.
    expect(stream.hasDone()).toBe(false);
  });

  it("an agent failure (setNextError) leaves source + markers + snapshots unchanged", async () => {
    const app = await plantComment(project, APP_REL, "<h1", "make it bolder");
    const appBaseline = await seedBaseline(project, app);

    const found = await findCommentById(project.root, app.id, EXCLUDE);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    agent.setNextError("boom");

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id: app.id,
      count: 1,
      model,
      skills: [],
      stream,
    });

    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(stream.final()).toMatchObject({
      type: "done",
      ok: false,
      error: "boom",
    });

    // Nothing moved: source, snapshots, manifest, and active are all untouched.
    expect(await project.readSource(APP_REL)).toBe(appBaseline);
    const roots = resolveIterationDirRoots(project.root, app.id);
    expect(findVersionSnapshotPath(roots, 1)).toBeNull();
    const manifest = await readIterationsManifest(
      designsIterDir(project.root, app.id)
    );
    expect(manifest?.versions["1"]).toBeUndefined();
    expect(await readActive(found.absolutePath, app.id)).toBe(0);
  });

  // ── Concurrency guard ──────────────────────────────────────────────────────
  it("a second run for the same comment aborts the in-flight first, leaving exactly one consistent version", async () => {
    const app = await plantComment(project, APP_REL, "<h1", "iterate the hero");
    const appBaseline = await seedBaseline(project, app);
    const startedAt = Date.now();

    // Run A registers in the runs registry and starts iterating.
    const ctrlA = startIterationRun({
      anchor: app.anchor,
      commentId: app.id,
      count: 1,
      model,
      startedAt,
    });
    let ctrlB: AbortController | undefined;

    const streamA = createStreamCollector(ctrlA);
    const foundA = await findCommentById(project.root, app.id, EXCLUDE);
    expect(foundA).not.toBeNull();
    if (!foundA) {
      return;
    }

    // While A's agent is "working", a second run for the SAME comment starts —
    // startIterationRun aborts A's controller (last-run-wins). A's edit is then
    // rolled back; it must persist nothing.
    agent.setVariant(() => {
      ctrlB ??= startIterationRun({
        anchor: app.anchor,
        commentId: app.id,
        count: 1,
        model,
        startedAt: startedAt + 1,
      });
      return {
        source: appBaseline.replace(
          "ForkDesign Playground",
          "ForkDesign Playground A"
        ),
      };
    });

    await runNewIteration({
      projectRoot: project.root,
      found: foundA,
      id: app.id,
      count: 1,
      model,
      skills: [],
      stream: streamA,
    });

    expect(ctrlA.signal.aborted).toBe(true);
    expect(ctrlB?.signal.aborted).toBe(false);
    expect(streamA.hasDone()).toBe(false);

    // A wrote no version (only the public v0 baseline dir exists) and rolled
    // its edit back.
    const rootsAfterA = resolveIterationDirRoots(project.root, app.id);
    expect(findVersionSnapshotPath(rootsAfterA, 1)).toBeNull();
    expect(await project.readSource(APP_REL)).toBe(appBaseline);

    // Run B (the winner) completes normally from the restored baseline.
    if (!ctrlB) {
      throw new Error("second run never registered");
    }
    const streamB = createStreamCollector(ctrlB);
    const foundB = await findCommentById(project.root, app.id, EXCLUDE);
    if (!foundB) {
      throw new Error("comment vanished before run B");
    }
    agent.setVariant({
      source: appBaseline.replace(
        "ForkDesign Playground",
        "ForkDesign Playground B"
      ),
    });
    await runNewIteration({
      projectRoot: project.root,
      found: foundB,
      id: app.id,
      count: 1,
      model,
      skills: [],
      stream: streamB,
    });

    expect(streamB.final()).toMatchObject({
      type: "done",
      ok: true,
      changed: true,
      v: 1,
      versions: [1],
    });

    // Exactly ONE iteration version exists and the live source reflects B only —
    // the two overlapping runs did not interleave or corrupt the active state.
    // (Recompute roots: B is what first created the designs/ iteration dir.)
    const roots = resolveIterationDirRoots(project.root, app.id);
    expect(await listCompleteIterationVersionsAllRoots(roots)).toEqual([0, 1]);
    expect(findVersionSnapshotPath(roots, 2)).toBeNull();
    expect(await readActive(foundB.absolutePath, app.id)).toBe(1);
    const live = await project.readSource(APP_REL);
    expect(live).toContain("ForkDesign Playground B");
    expect(live).not.toContain("ForkDesign Playground A");

    // Registry hygiene: finishing the STALE controller is a no-op; only the
    // current run's controller clears the active slot.
    finishIterationRun(app.id, ctrlA);
    expect(hasActiveIterationRun(app.id)).toBe(true);
    finishIterationRun(app.id, ctrlB);
    expect(hasActiveIterationRun(app.id)).toBe(false);
  });
});
