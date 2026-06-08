/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FLOW UNDER TEST: atomic-write durability + path-safety containment
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The writer never writes the user's source in place — it writes to a sibling
 * tmp file then renames over the target, so a reader either sees the OLD
 * complete file or the NEW complete file, never a half-written one. These tests
 * stress that guarantee under concurrent / interleaved writes to the same file,
 * and verify that path-safety rejects any path that escapes the project root.
 *
 * Real modules under test:
 *   - src/server/platform/atomic-write.ts
 *       export async function atomicWriteText(absolutePath, content): Promise<void>
 *       export async function atomicWriteBytes(absolutePath, bytes: Buffer): Promise<void>
 *       Both write to a randomized sibling tmp file
 *       (`.${base}.${pid}.${randomUUID()}.tmp`) then fs.rename() onto the
 *       target, so concurrent same-target writes never share a tmp path (see
 *       the "interleaved writes" regression guard below).
 *   - src/server/platform/path-safety.ts
 *       export function isSafePathSegment(value): boolean   // ^[A-Za-z0-9_-]+$
 *       export function isSafeIterationScreenshotPath(value): boolean
 *       export function resolveSafeProjectRelativePath(projectRoot, relPosix):
 *         SafePathResult   // rejects absolute paths and any `..` traversal
 *       export function resolveSafePagePath(projectRoot, file, excludePrefixes):
 *         SafePathResult   // must be under src/, end in .tsx, no traversal
 *       export const SRC_REL = "src"
 *
 * Helpers (owned by another agent — ASSUME THEY EXIST):
 *   import { createTempProject } from "../helpers";
 *     (stubAgent not needed — no agent involved.)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicWriteBytes,
  atomicWriteText,
} from "../../src/server/platform/atomic-write.ts";
import {
  isSafeIterationScreenshotPath,
  isSafePathSegment,
  resolveSafePagePath,
  resolveSafeProjectRelativePath,
} from "../../src/server/platform/path-safety.ts";
import { createTempProject } from "../helpers/index.ts";

/** List leftover atomic-write tmp files for `base` in `dir`. */
async function listTmpResidue(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir);
  // The writer names tmp files `.${base}.${pid}.${randomUUID()}.tmp`.
  const prefix = `.${base}.`;
  return entries.filter(
    (name) => name.startsWith(prefix) && name.endsWith(".tmp")
  );
}

describe("integration: atomic writes never corrupt the target file", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let target: string; // absolute path to a writable file in the temp project.

  beforeEach(async () => {
    project = await createTempProject();
    target = project.srcFile("src/Scratch.tsx");
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it("a single atomicWriteText leaves exactly the new bytes and no .tmp residue", async () => {
    await atomicWriteText(target, "NEW CONTENT");

    expect(await readFile(target, "utf8")).toBe("NEW CONTENT");
    expect(
      await listTmpResidue(path.dirname(target), path.basename(target))
    ).toEqual([]);
  });

  it("concurrent writes to the same file never leave a partial/torn target (last successful rename wins)", async () => {
    // Build N large distinct payloads. Each is tagged with its index and made
    // large enough that a torn/interleaved write would be detectable as a
    // length mismatch or a mixed tag.
    const N = 50;
    const payloads = Array.from({ length: N }, (_, i) => {
      const tag = `payload-${String(i).padStart(3, "0")}`;
      const body = `${tag}:`.repeat(4096); // ~50KB+ per payload
      return `${tag}\n${body}\n${tag}-END`;
    });
    // Sanity: every payload is a distinct length-or-content value.
    expect(new Set(payloads).size).toBe(N);

    // Every concurrent write gets its own randomized tmp path, so all renames
    // succeed and the final target is whichever rename landed last. We still
    // use allSettled and assert no rejections so a future tmp-name regression
    // (colliding paths → ENOENT on rename) would surface here.
    const results = await Promise.allSettled(
      payloads.map((p) => atomicWriteText(target, p))
    );
    // No write is dropped: a unique tmp per call means no rename collisions.
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const finalContents = await readFile(target, "utf8");

    // CORE DURABILITY INVARIANT: the final state is EXACTLY one of the inputs —
    // not a concatenation, truncation, or splice of two payloads. This holds
    // even with the colliding tmp names because writeFile fully overwrites and
    // rename is atomic.
    expect(payloads).toContain(finalContents);
    const matching = payloads.find((p) => p === finalContents);
    if (matching === undefined) {
      throw new Error("final contents did not match any written payload");
    }
    expect(finalContents.length).toBe(matching.length);
    // Cross-check: the file must not contain two different payload tags spliced
    // together (a torn write between renames would leave a hybrid).
    const tagsPresent = new Set(
      [...finalContents.matchAll(/payload-(\d{3})/g)].map((m) => m[1])
    );
    expect(tagsPresent.size).toBe(1);

    // No tmp residue after the storm settles (every tmp was either renamed or
    // consumed by a colliding writer).
    expect(
      await listTmpResidue(path.dirname(target), path.basename(target))
    ).toEqual([]);
  });

  it("interleaved same-millisecond writes to one target all succeed (regression guard: tmp names are randomized)", async () => {
    // REGRESSION GUARD for a fixed durability bug.
    //
    // The atomic writer used to derive its tmp name from `process.pid` +
    // `Date.now()` with NO random component, so two writes to the SAME target
    // whose writeFile() calls landed in the same millisecond computed the SAME
    // tmp path: the first rename consumed it and every later rename rejected
    // with ENOENT (syscall: "rename"). In practice the large majority of
    // concurrent same-target writes failed. The fix appends crypto.randomUUID()
    // to the tmp name so concurrent writers never share a tmp path.
    //
    // We fire many same-target writes in a tight, un-awaited loop so their
    // Date.now() coincides — the exact condition that used to collide — and
    // assert that NONE reject.
    const N = 64;
    const payloads = Array.from({ length: N }, (_, i) => {
      const tag = `iv-${String(i).padStart(3, "0")}`;
      return `${tag}\n${`${tag}|`.repeat(2048)}\n${tag}-END`;
    });

    // Fire WITHOUT awaiting between starts so their Date.now() can coincide.
    const writes: Promise<void>[] = [];
    for (const p of payloads) {
      writes.push(atomicWriteText(target, p));
    }
    const results = await Promise.allSettled(writes);

    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );

    // THE FIX: every concurrent same-target write completes. If this regresses,
    // the rejections will be ENOENT-on-rename from colliding tmp paths.
    expect(rejected).toEqual([]);

    const finalContents = await readFile(target, "utf8");
    // Durability still holds: the survivor is exactly one untorn payload.
    expect(payloads).toContain(finalContents);
    const tagsPresent = new Set(
      [...finalContents.matchAll(/iv-(\d{3})/g)].map((m) => m[1])
    );
    expect(tagsPresent.size).toBe(1);

    // No leftover tmp files despite the collisions.
    expect(
      await listTmpResidue(path.dirname(target), path.basename(target))
    ).toEqual([]);
  });

  it("concurrent writes to DIFFERENT files all succeed with correct contents", async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      abs: project.srcFile(`src/concurrent/File${i}.tsx`),
      contents: `// file ${i}\n${`x${i}`.repeat(1000)}\nEND-${i}`,
    }));

    // Parent dir must exist for the tmp writes; create it via the helper.
    await project.writeSource("src/concurrent/.keep", "");

    await Promise.all(files.map((f) => atomicWriteText(f.abs, f.contents)));

    for (const f of files) {
      expect(await readFile(f.abs, "utf8")).toBe(f.contents);
      expect(
        await listTmpResidue(path.dirname(f.abs), path.basename(f.abs))
      ).toEqual([]);
    }
  });

  it("a binary atomicWriteBytes round-trips a PNG buffer exactly", async () => {
    const pngTarget = project.srcFile("src/pixel.png");
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
      "base64"
    );

    await atomicWriteBytes(pngTarget, png);

    const readBack = await readFile(pngTarget);
    expect(readBack.length).toBe(png.length);
    expect(Buffer.compare(readBack, png)).toBe(0);
    expect(
      await listTmpResidue(path.dirname(pngTarget), path.basename(pngTarget))
    ).toEqual([]);
  });
});

describe("integration: path-safety rejects traversal outside the project root", () => {
  let project: Awaited<ReturnType<typeof createTempProject>>;
  let projectRoot: string;

  beforeEach(async () => {
    project = await createTempProject();
    projectRoot = project.root;
  });

  afterEach(async () => {
    await project.cleanup();
  });

  it("isSafePathSegment accepts only [A-Za-z0-9_-]+", () => {
    expect(isSafePathSegment("abc")).toBe(true);
    expect(isSafePathSegment("A1_b-2")).toBe(true);
    // A real uuid contains dashes, which ARE allowed by ^[A-Za-z0-9_-]+$.
    expect(isSafePathSegment(randomUUID())).toBe(true);

    for (const bad of ["", "a/b", "a.b", "..", "a b", "foo/../bar", "."]) {
      expect(isSafePathSegment(bad)).toBe(false);
    }
  });

  it("resolveSafeProjectRelativePath rejects absolute paths and `..` escapes", () => {
    const absResult = resolveSafeProjectRelativePath(
      projectRoot,
      "/etc/passwd"
    );
    expect(absResult.ok).toBe(false);
    if (!absResult.ok) {
      expect(absResult.reason).toBe("path must be relative");
    }

    for (const bad of [
      "../../etc/passwd",
      "src/../../secret.tsx",
      "foo/../../bar",
      "..\\..\\win",
    ]) {
      const res = resolveSafeProjectRelativePath(projectRoot, bad);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe("path traversal rejected");
      }
    }

    for (const good of ["src/pages/Home.tsx", "designs/iterations/x/v1.tsx"]) {
      const res = resolveSafeProjectRelativePath(projectRoot, good);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.relativePath).toBe(good);
        expect(path.dirname(res.absolutePath).startsWith(projectRoot)).toBe(
          true
        );
        const rel = path.relative(projectRoot, res.absolutePath);
        expect(rel.startsWith("..")).toBe(false);
        expect(path.isAbsolute(rel)).toBe(false);
      }
    }
  });

  it("resolveSafePagePath only accepts .tsx under src/, honoring excludePrefixes", () => {
    const absRes = resolveSafePagePath(projectRoot, "/abs/src/x.tsx", []);
    expect(absRes.ok).toBe(false);
    if (!absRes.ok) {
      expect(absRes.reason).toBe("file must be a relative path");
    }

    const notSrc = resolveSafePagePath(projectRoot, "lib/x.tsx", []);
    expect(notSrc.ok).toBe(false);
    if (!notSrc.ok) {
      expect(notSrc.reason).toBe("file must be under src/");
    }

    const notTsx = resolveSafePagePath(projectRoot, "src/x.ts", []);
    expect(notTsx.ok).toBe(false);
    if (!notTsx.ok) {
      expect(notTsx.reason).toBe("file must end in .tsx");
    }

    // "src/../package.json" is not .tsx and not under src/ after the prefix
    // check — it must be rejected one way or another.
    const traversal = resolveSafePagePath(
      projectRoot,
      "src/../package.json",
      []
    );
    expect(traversal.ok).toBe(false);

    const excluded = resolveSafePagePath(projectRoot, "src/excluded/x.tsx", [
      "src/excluded/",
    ]);
    expect(excluded.ok).toBe(false);
    if (!excluded.ok) {
      expect(excluded.reason).toContain("excluded");
    }

    const ok = resolveSafePagePath(projectRoot, "src/App.tsx", []);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const srcRootAbs = path.resolve(projectRoot, "src");
      const rel = path.relative(srcRootAbs, ok.absolutePath);
      expect(rel.startsWith("..")).toBe(false);
      expect(path.isAbsolute(rel)).toBe(false);
    }
  });

  it("isSafeIterationScreenshotPath only matches /designs/iterations/<safe-id>/vN.png", () => {
    expect(
      isSafeIterationScreenshotPath("/designs/iterations/abc-123/v0.png")
    ).toBe(true);
    expect(
      isSafeIterationScreenshotPath("/designs/iterations/abc/v2.png?t=123")
    ).toBe(true);

    for (const bad of [
      "/designs/iterations/../../etc/v0.png",
      "/designs/iterations/a b/v0.png",
      "/etc/passwd",
      "/designs/iterations/x/v0.jpg",
    ]) {
      expect(isSafeIterationScreenshotPath(bad)).toBe(false);
    }
  });

  it("atomicWriteText composed with path-safety cannot write outside the root", async () => {
    // INTEGRATION GLUE: the server pattern resolves a caller-supplied relative
    // path FIRST, and only writes when the result is ok. path-safety gates the
    // write; atomicWrite itself trusts its absolute-path argument.
    const escapeRel = "../../escape.txt";
    const resolved = resolveSafeProjectRelativePath(projectRoot, escapeRel);
    expect(resolved.ok).toBe(false);

    // Because resolution failed, the production code must NOT call atomicWrite.
    if (resolved.ok) {
      // Unreachable: guarded so a regression that flips the result would still
      // not write outside the root from this test.
      await atomicWriteText(resolved.absolutePath, "PWNED");
    }

    // Nothing was written outside the root.
    expect(existsSync(path.join(projectRoot, "..", "..", "escape.txt"))).toBe(
      false
    );
    expect(existsSync(path.resolve(projectRoot, escapeRel))).toBe(false);
  });
});
