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
 * See the original scaffold comment for the full contract. The agent is stubbed
 * via tests/helpers/stub-agent.ts (offline, deterministic).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findCommentById } from "../../src/server/comments/find-comment.ts";
import { readCommentsFromFile } from "../../src/server/comments/reader.ts";
import { writeCommentToFile } from "../../src/server/comments/writer.ts";
import { seedBaselineIteration } from "../../src/server/iterations/baseline.ts";
import {
  findVersionPngPath,
  findVersionSnapshotPath,
  listCompleteIterationVersionsAllRoots,
  listCompleteIterationVersionsInDir,
  nextIterationVersion,
  readIterationsManifest,
  resolveIterationDirRoots,
} from "../../src/server/iterations/manifest.ts";
import {
  type NdjsonStream,
  runNewIteration,
} from "../../src/server/iterations/run-iteration.ts";
import { createTempProject, stubAgent } from "../helpers/index.ts";

// ── Test utilities ──────────────────────────────────────────────────────────

/**
 * A hand-rolled NdjsonStream that records every emitted event so we can assert
 * on the progress/done sequence directly (no http req/res needed).
 */
interface StreamCollector extends NdjsonStream {
  events: object[];
  final(): object | undefined;
}

function createStreamCollector(): StreamCollector {
  const events: object[] = [];
  return {
    events,
    abortController: new AbortController(),
    clientGone(): boolean {
      return false;
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
  };
}

/** A tiny valid 1×1 PNG (transparent) used as the baseline screenshot. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const PLAYGROUND_HEADING_RE = /ForkDesign Playground[^<]*/;

/**
 * Locate a JSXElement opening tag by its name in the CURRENT source. Returns the
 * Babel-style 1-indexed (line, column) of the `<`. Coordinates shift after each
 * write (the writer adds a `data-comment-anchor` attr + a sibling marker), so we
 * must recompute against the live source before every `writeCommentToFile`.
 */
function locateTag(
  source: string,
  tag: string
): { line: number; column: number } {
  const needle = `<${tag}`;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const idx = lines[i]?.indexOf(needle) ?? -1;
    if (idx >= 0) {
      // column is the 1-indexed position of the `<`.
      return { line: i + 1, column: idx + 1 };
    }
  }
  throw new Error(`tag <${tag}> not found in source`);
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

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("integration: iteration snapshot + manifest", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let agent: ReturnType<typeof stubAgent>;
  let id: string;
  let anchor: string;
  let baselineSource: string; // post-write source (WITH the marker) → v0.tsx.
  const model = "default" as const;

  beforeEach(async () => {
    project = await createTempProject();
    agent = stubAgent();

    const appPath = project.srcFile("src/App.tsx");

    // 1. Plant a marker on the <h1>. Recompute coordinates against the current
    //    source (clean fixture here, but the helper keeps us honest).
    const pre = await project.readSource("src/App.tsx");
    const { line, column } = locateTag(pre, "h1");
    const written = await writeCommentToFile({
      absolutePath: appPath,
      author: "tester@example.com",
      column,
      line,
      text: "Make the heading bolder",
    });
    id = written.id;
    anchor = written.anchor;

    // 2. Capture post-write source and seed v0 baseline (v0.tsx + v0.png +
    //    "Baseline" manifest entry) under public/designs/iterations/<id>/.
    baselineSource = await project.readSource("src/App.tsx");
    await seedBaselineIteration(project.root, id, TINY_PNG, baselineSource);
  });

  afterEach(async () => {
    await project.cleanup();
    agent.restore();
  });

  it("running one iteration writes v1.tsx + v1.png, a manifest entry, and flips active=1", async () => {
    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    const editedSource = baselineSource.replace(
      "ForkDesign Playground",
      "ForkDesign Playground (v1)"
    );
    expect(editedSource).not.toBe(baselineSource);
    agent.setVariant({ source: editedSource });

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id,
      count: 1,
      model,
      skills: [],
      stream,
    });

    // ASSERT (agent called exactly once with the comment's file + anchor + text)
    expect(agent.runAgent).toHaveBeenCalledTimes(1);
    expect(agent.calls).toHaveLength(1);
    const call = agent.calls[0];
    expect(call?.file).toBe(found.relativePath);
    expect(call?.anchor).toBe(anchor);
    expect(call?.text).toBe("Make the heading bolder");
    expect(call?.model).toBe(model);
    expect(call?.projectRoot).toBe(project.root);
    expect(call?.variantIndex).toBe(1);
    expect(call?.variantCount).toBe(1);

    // ASSERT (snapshot files on disk): v1.tsx contents == agent-edited source,
    // v1.png exists (copied from v0.png).
    const roots = resolveIterationDirRoots(project.root, id);
    expect(findVersionSnapshotPath(roots, 1)).not.toBeNull();
    const v1Contents = await project.readSnapshot(`iterations/${id}/v1.tsx`);
    expect(v1Contents).toBe(editedSource);
    expect(findVersionPngPath(roots, 1)).not.toBeNull();

    // ASSERT (manifest): versions["1"] with non-empty summary, ISO createdAt,
    // and runId "<id>:<ts>".
    const designsIterDir = path.join(project.root, "designs", "iterations", id);
    const manifest = await readIterationsManifest(designsIterDir);
    expect(manifest).not.toBeNull();
    const entry = manifest?.versions["1"];
    expect(entry).toBeDefined();
    expect((entry?.summary ?? "").length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(entry?.createdAt ?? ""))).toBe(false);
    expect(entry?.runId).toMatch(new RegExp(`^${id}:\\d+$`));
    expect(await listCompleteIterationVersionsInDir(designsIterDir)).toContain(
      1
    );

    // ASSERT (active flipped on the live file).
    expect(await readActive(found.absolutePath, id)).toBe(1);

    // ASSERT (terminal done event).
    expect(stream.final()).toMatchObject({
      type: "done",
      ok: true,
      id,
      changed: true,
      v: 1,
      versions: [1],
      tsx: `/designs/iterations/${id}/v1.tsx`,
    });
    expect((stream.final() as { png?: string }).png).toContain(
      `/designs/iterations/${id}/v1.png`
    );
  });

  it("agent makes no change → no snapshot, done.changed=false", async () => {
    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    // Default variant has no `source` → stub leaves the file untouched.
    agent.setVariant({});

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id,
      count: 1,
      model,
      skills: [],
      stream,
    });

    expect(agent.runAgent).toHaveBeenCalledTimes(1);

    // No v1 snapshot anywhere.
    const roots = resolveIterationDirRoots(project.root, id);
    expect(findVersionSnapshotPath(roots, 1)).toBeNull();

    // designs/ manifest has no "1" entry (it may not exist at all — only
    // public/ got the baseline).
    const designsIterDir = path.join(project.root, "designs", "iterations", id);
    const manifest = await readIterationsManifest(designsIterDir);
    expect(manifest?.versions["1"]).toBeUndefined();

    // active stays 0 on the live file.
    expect(await readActive(found.absolutePath, id)).toBe(0);

    // Terminal done event reports no change.
    expect(stream.final()).toMatchObject({
      type: "done",
      ok: true,
      id,
      changed: false,
    });
  });

  it("multiple sequential iterations accumulate v1, v2, v3 with ascending manifest keys", async () => {
    const designsIterDir = path.join(project.root, "designs", "iterations", id);

    const labels = ["v1", "v2", "v3"];
    let prevCreatedAt = "";
    for (let i = 0; i < labels.length; i += 1) {
      const found = await findCommentById(project.root, id, []);
      expect(found).not.toBeNull();
      if (!found) {
        return;
      }
      // Each run starts from the CURRENT live source (the prior active version).
      const liveSource = await project.readSource("src/App.tsx");
      agent.setVariant({
        source: liveSource.replace(
          PLAYGROUND_HEADING_RE,
          `ForkDesign Playground ${labels[i]}`
        ),
      });

      const stream = createStreamCollector();
      await runNewIteration({
        projectRoot: project.root,
        found,
        id,
        count: 1,
        model,
        skills: [],
        stream,
      });

      const expectedV = i + 1;
      expect(stream.final()).toMatchObject({
        type: "done",
        ok: true,
        changed: true,
        v: expectedV,
      });

      // createdAt monotonic per run.
      const manifest = await readIterationsManifest(designsIterDir);
      const createdAt = manifest?.versions[String(expectedV)]?.createdAt ?? "";
      expect(createdAt).not.toBe("");
      if (prevCreatedAt) {
        expect(Date.parse(createdAt)).toBeGreaterThanOrEqual(
          Date.parse(prevCreatedAt)
        );
      }
      prevCreatedAt = createdAt;
    }

    // ASSERT (accumulation): v1/v2/v3 .tsx + .png all present.
    const roots = resolveIterationDirRoots(project.root, id);
    for (const v of [1, 2, 3]) {
      expect(findVersionSnapshotPath(roots, v)).not.toBeNull();
      expect(findVersionPngPath(roots, v)).not.toBeNull();
    }
    expect(await nextIterationVersion(designsIterDir)).toEqual({
      ok: true,
      nextV: 4,
    });

    // ASSERT (manifest ordering): the designs/ manifest holds exactly 1,2,3
    // (v0 lives in the public/ baseline manifest). All four are reachable
    // across roots.
    const manifest = await readIterationsManifest(designsIterDir);
    const keys = Object.keys(manifest?.versions ?? {})
      .map((k) => Number.parseInt(k, 10))
      .sort((a, b) => a - b);
    expect(keys).toEqual([1, 2, 3]);
    expect(await listCompleteIterationVersionsAllRoots(roots)).toEqual([
      0, 1, 2, 3,
    ]);

    // ASSERT (active advanced to 3).
    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    if (found) {
      expect(await readActive(found.absolutePath, id)).toBe(3);
    }
  });

  it("count>1 in a single run produces multiple variants v1..vN in one batch", async () => {
    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }

    // Distinct edit per variantIndex; each starts from the pre-agent baseline
    // (run-iteration resets the file to beforeSource before each variant).
    agent.setVariant((variantInput) => ({
      source: baselineSource.replace(
        "ForkDesign Playground",
        `ForkDesign Playground variant-${variantInput.variantIndex}`
      ),
    }));

    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id,
      count: 3,
      model,
      skills: [],
      stream,
    });

    expect(agent.runAgent).toHaveBeenCalledTimes(3);
    expect(agent.calls.map((c) => c.variantIndex)).toEqual([1, 2, 3]);
    expect(agent.calls.every((c) => c.variantCount === 3)).toBe(true);

    // createdVersions in the done event === [1,2,3].
    const done = stream.final() as {
      type: string;
      ok: boolean;
      changed: boolean;
      v: number;
      versions: number[];
    };
    expect(done.type).toBe("done");
    expect(done.ok).toBe(true);
    expect(done.changed).toBe(true);
    expect(done.versions).toEqual([1, 2, 3]);
    expect(done.v).toBe(3);

    // Three independent v{N}.tsx snapshots — each derived from the SAME baseline
    // (not cumulative): variant-1, variant-2, variant-3 respectively.
    for (const v of [1, 2, 3]) {
      const contents = await project.readSnapshot(`iterations/${id}/v${v}.tsx`);
      expect(contents).toBe(
        baselineSource.replace(
          "ForkDesign Playground",
          `ForkDesign Playground variant-${v}`
        )
      );
    }

    // The LAST successful variant (v3) is left active on the live source.
    expect(await readActive(found.absolutePath, id)).toBe(3);
    const live = await project.readSource("src/App.tsx");
    expect(live).toContain("ForkDesign Playground variant-3");
    expect(live).not.toContain("variant-1");
    expect(live).not.toContain("variant-2");
  });

  it("baseline v0 is captured by seedBaselineIteration and survives iteration", async () => {
    // ASSERT (before iterating): public v0.tsx exists, CONTAINS the marker;
    // v0.png exists; manifest versions["0"].summary === "Baseline".
    const v0Tsx = await project.readSource(
      `public/designs/iterations/${id}/v0.tsx`
    );
    expect(v0Tsx).toBe(baselineSource);
    expect(v0Tsx).toContain("@comment");
    expect(v0Tsx).toContain(`id="${id}"`);
    expect(
      existsSync(project.srcFile(`public/designs/iterations/${id}/v0.png`))
    ).toBe(true);

    const publicIterDir = path.join(
      project.root,
      "public",
      "designs",
      "iterations",
      id
    );
    const publicManifest = await readIterationsManifest(publicIterDir);
    expect(publicManifest?.versions["0"]?.summary).toBe("Baseline");

    // ACT: run one iteration.
    const found = await findCommentById(project.root, id, []);
    expect(found).not.toBeNull();
    if (!found) {
      return;
    }
    agent.setVariant({
      source: baselineSource.replace(
        "ForkDesign Playground",
        "ForkDesign Playground edited"
      ),
    });
    const stream = createStreamCollector();
    await runNewIteration({
      projectRoot: project.root,
      found,
      id,
      count: 1,
      model,
      skills: [],
      stream,
    });
    expect(stream.final()).toMatchObject({ type: "done", ok: true, v: 1 });

    // ASSERT (after): v0.tsx UNCHANGED (iteration never overwrites v0).
    const v0After = await project.readSource(
      `public/designs/iterations/${id}/v0.tsx`
    );
    expect(v0After).toBe(baselineSource);

    // v1.tsx is new; both v0 and v1 appear across all roots.
    const roots = resolveIterationDirRoots(project.root, id);
    expect(findVersionSnapshotPath(roots, 1)).not.toBeNull();
    expect(await listCompleteIterationVersionsAllRoots(roots)).toEqual([0, 1]);
  });
});
