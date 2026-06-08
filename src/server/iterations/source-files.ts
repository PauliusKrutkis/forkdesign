import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Multi-file iteration support.
 *
 * Iteration snapshots used to capture only the comment's file. But a comment on
 * a *reused component* (a `.map()` list, a shared `<Card>`) is usually addressed
 * by editing the component's OWN file — a different file from the one the marker
 * lives in. Those edits were never snapshotted, so switching versions could not
 * toggle them and the design appeared frozen.
 *
 * To capture cross-file edits without depending on a specific agent strategy
 * (Claude SDK vs Cursor CLI report tool calls differently), we snapshot the
 * project's source tree before and after each variant and diff by content. This
 * is strategy-agnostic and catches every edit the agent makes.
 */

/** Directory names never worth scanning (deps, build output, VCS, our store). */
const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".vite",
  "coverage",
  ".idea",
  ".vscode",
]);

/** Source extensions an agent might edit to address visual feedback. */
const SOURCE_EXTENSIONS = new Set([
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".vue",
  ".svelte",
  ".astro",
]);

/** Skip files larger than this — generated bundles, lockfiles, etc. */
const MAX_SOURCE_FILE_BYTES = 512 * 1024;

/** A path is part of the iteration store and must never be snapshotted. */
function isIterationStorePath(relPosix: string): boolean {
  return (
    relPosix.startsWith("designs/iterations/") ||
    relPosix.startsWith("public/designs/iterations/")
  );
}

function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Normalize an absolute path under root to a posix project-relative key. */
export function toRelPosix(projectRoot: string, absPath: string): string {
  return path.relative(projectRoot, absPath).split(path.sep).join("/");
}

async function walk(
  dir: string,
  projectRoot: string,
  out: Map<string, string>
): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const relDir = toRelPosix(projectRoot, abs);
      if (isIterationStorePath(`${relDir}/`)) {
        continue;
      }
      await walk(abs, projectRoot, out);
      continue;
    }
    if (!(entry.isFile() && isSourceFile(entry.name))) {
      continue;
    }
    const rel = toRelPosix(projectRoot, abs);
    if (isIterationStorePath(rel)) {
      continue;
    }
    try {
      const info = await stat(abs);
      if (info.size > MAX_SOURCE_FILE_BYTES) {
        continue;
      }
      out.set(rel, await readFile(abs, "utf8"));
    } catch {
      // Unreadable file (perms, vanished mid-walk) — skip it.
    }
  }
}

/**
 * Snapshot every source file under `projectRoot` as a `relPosix -> content`
 * map. Skips dependency/build/VCS directories and the iteration store itself.
 */
export async function snapshotSourceFiles(
  projectRoot: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await walk(projectRoot, projectRoot, out);
  return out;
}

/**
 * Files whose content differs between `before` and `after` (added or changed).
 * Deleted files map to `null`. Returns posix-relative keys.
 */
export function diffSourceSnapshots(
  before: Map<string, string>,
  after: Map<string, string>
): Map<string, string | null> {
  const changed = new Map<string, string | null>();
  for (const [rel, content] of after) {
    if (before.get(rel) !== content) {
      changed.set(rel, content);
    }
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) {
      changed.set(rel, null);
    }
  }
  return changed;
}
