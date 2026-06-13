/**
 * Temporary on-disk fixture project helper for integration/e2e tests.
 *
 * Server flows in `forkdesign` mutate the *user's* source tree: comment markers
 * are written into `.tsx` files (see `src/server/comments/writer.ts`) and
 * iteration snapshots are persisted under `<projectRoot>/designs/iterations/`
 * (see `src/server/iterations/run-iteration.ts` and
 * `src/server/iterations/manifest.ts`). Baseline v0 artifacts are seeded under
 * `<projectRoot>/public/designs/iterations/` (see
 * `src/server/iterations/baseline.ts`). To exercise those round-trips safely we
 * copy a fixture project into a throwaway OS temp dir, point the server modules
 * at it via `projectRoot`, and tear it down afterwards.
 *
 * This module is Node-side only (uses `node:fs`/`node:os`/`node:path`); it is
 * NOT loaded in the happy-dom unit test environment.
 */

import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the canonical fixture tree copied for each test. */
const FIXTURE_PLAYGROUND_DIR = path.resolve(
  HERE,
  "..",
  "fixtures",
  "playground"
);

export interface TempProject {
  /**
   * Recursively delete the temp dir. Safe to call more than once. Wire this
   * into `afterEach` so no temp tree leaks between tests.
   */
  cleanup(): Promise<void>;
  /**
   * List every file currently present under `<root>/designs/` as POSIX-style
   * relative paths (relative to `designs/`), sorted for stable assertions.
   * Returns `[]` when no snapshots have been written yet.
   */
  listSnapshots(): Promise<string[]>;
  /**
   * Read a single iteration snapshot artifact, e.g.
   * `readSnapshot("iterations/<id>/v1.tsx")`. Convenience over `readSource`
   * with the `designs/` prefix baked in.
   */
  readSnapshot(relPathUnderDesigns: string): Promise<string>;
  /**
   * Read a project-relative `.tsx` (or any text) file's contents as utf8.
   * `relPath` is POSIX-style relative to `root` (e.g. `"src/App.tsx"`).
   */
  readSource(relPath: string): Promise<string>;
  /**
   * Absolute path to the temp project root. Pass this as `projectRoot` to
   * server functions (`runNewIteration`, `findCommentById`,
   * `applyIterationVersionToSource`, ...).
   */
  readonly root: string;
  /**
   * Resolve a project-relative POSIX path (e.g. `"src/App.tsx"`) to an absolute
   * path under `root`. Convenience for passing `absolutePath` to the writer or
   * asserting on a specific file.
   */
  srcFile(relPath: string): string;
  /**
   * Overwrite a project-relative text file (creating parent dirs as needed).
   * `relPath` is POSIX-style relative to `root`.
   */
  writeSource(relPath: string, contents: string): Promise<void>;
}

export interface CreateTempProjectOptions {
  /**
   * When false, do NOT auto-register the project for `afterEach` teardown — the
   * caller takes ownership of `cleanup()`. Defaults to true.
   */
  autoCleanup?: boolean;
  /**
   * Override the fixture tree to copy. Defaults to
   * `tests/fixtures/playground`. The contents are copied INTO a `src/`
   * subdirectory of the temp root (because `find-comment.ts` only scans `src/`).
   * Useful for tests that need a different starting source shape.
   */
  fixtureDir?: string;
}

// ---------------------------------------------------------------------------
// afterEach auto-cleanup registry
// ---------------------------------------------------------------------------

const liveProjects = new Set<TempProject>();
let afterEachWired = false;

function ensureAfterEachWired(): void {
  if (afterEachWired) {
    return;
  }
  afterEachWired = true;
  afterEach(async () => {
    await cleanupAllTempProjects();
  });
}

/** Tear down every still-live temp project. Swallows ENOENT. */
export async function cleanupAllTempProjects(): Promise<void> {
  const pending = [...liveProjects];
  liveProjects.clear();
  await Promise.all(pending.map((p) => p.cleanup()));
}

/**
 * `afterEach`-friendly registry: track every temp project created in a test and
 * remove them all in one call. `createTempProject` uses this internally, but it
 * is exported for tests that want explicit control.
 */
export function createTempProjectRegistry(): {
  track(project: TempProject): void;
  cleanupAll(): Promise<void>;
} {
  const tracked: TempProject[] = [];
  return {
    track(project: TempProject): void {
      tracked.push(project);
    },
    async cleanupAll(): Promise<void> {
      const pending = tracked.splice(0, tracked.length);
      await Promise.all(pending.map((p) => p.cleanup()));
    },
  };
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(full);
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Create a fresh temp project by copying the fixture tree into the `src/`
 * subdirectory of an OS temp dir.
 *
 * By default the returned project is registered for automatic `afterEach`
 * teardown (the helper wires a single `afterEach` the first time it is used),
 * so most tests never need to call `cleanup()` themselves. Pass
 * `{ autoCleanup: false }` to opt out.
 */
export async function createTempProject(
  options: CreateTempProjectOptions = {}
): Promise<TempProject> {
  const fixtureDir = options.fixtureDir ?? FIXTURE_PLAYGROUND_DIR;
  const autoCleanup = options.autoCleanup ?? true;

  const root = await mkdtemp(path.join(tmpdir(), "forkdesign-it-"));
  const srcDir = path.join(root, "src");
  await mkdir(srcDir, { recursive: true });
  // CRITICAL: fixture components must land under `<root>/src/` because
  // find-comment.ts only walks `SRC_REL = "src"`.
  await cp(fixtureDir, srcDir, { recursive: true });

  // Pre-create the snapshot roots so writes never race on an absent dir.
  await mkdir(path.join(root, "designs", "iterations"), { recursive: true });
  await mkdir(path.join(root, "public", "designs", "iterations"), {
    recursive: true,
  });

  const toAbs = (relPath: string): string =>
    path.resolve(root, relPath.split(path.posix.sep).join(path.sep));

  const designsDir = path.join(root, "designs");

  let cleaned = false;
  const project: TempProject = {
    root,
    srcFile(relPath: string): string {
      return toAbs(relPath);
    },
    readSource(relPath: string): Promise<string> {
      return readFile(toAbs(relPath), "utf8");
    },
    async writeSource(relPath: string, contents: string): Promise<void> {
      const abs = toAbs(relPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, contents, "utf8");
    },
    async listSnapshots(): Promise<string[]> {
      const files = await listFilesRecursive(designsDir);
      return files
        .map((abs) =>
          path.relative(designsDir, abs).split(path.sep).join(path.posix.sep)
        )
        .sort();
    },
    readSnapshot(relPathUnderDesigns: string): Promise<string> {
      const rel = relPathUnderDesigns.split(path.posix.sep).join(path.sep);
      return readFile(path.join(designsDir, rel), "utf8");
    },
    async cleanup(): Promise<void> {
      if (cleaned) {
        return;
      }
      cleaned = true;
      liveProjects.delete(project);
      await rm(root, { recursive: true, force: true });
    },
  };

  if (autoCleanup) {
    ensureAfterEachWired();
    liveProjects.add(project);
  }

  return project;
}
