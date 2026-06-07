import { existsSync, statSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteText } from "../platform/atomic-write.ts";
import { fromRelPosix } from "./source-files.ts";

/**
 * Per-version snapshots of files OTHER than the comment's primary file (which is
 * stored as `v{N}.tsx`). A version's `v{N}.files.json` maps posix-relative paths
 * to the content the agent produced for that variant; `null` means the file was
 * removed in that variant.
 *
 * `v0.files.json` is special: it holds the BASELINE content of every auxiliary
 * file any version has ever touched, so switching to a version that did NOT
 * touch a file can revert it. A `null` baseline means the file did not exist
 * before the agent ran (revert = delete).
 */

/** A `relPosix -> content|null` map. `null` = file absent (delete on restore). */
export type AuxFileMap = Record<string, string | null>;

export function auxFilesPath(iterDir: string, v: number): string {
  return path.join(iterDir, `v${v}.files.json`);
}

function parseAuxJson(raw: string): AuxFileMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  const out: AuxFileMap = {};
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof value === "string" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

/** Read a version's aux map, searching every iteration root. Empty when none. */
export async function readVersionAuxFiles(
  roots: string[],
  v: number
): Promise<AuxFileMap> {
  for (const iterDir of roots) {
    const filePath = auxFilesPath(iterDir, v);
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      try {
        return parseAuxJson(await readFile(filePath, "utf8"));
      } catch {
        return {};
      }
    }
  }
  return {};
}

export async function writeVersionAuxFiles(
  iterDir: string,
  v: number,
  files: AuxFileMap
): Promise<void> {
  if (Object.keys(files).length === 0) {
    return;
  }
  await writeFile(
    auxFilesPath(iterDir, v),
    `${JSON.stringify(files, null, 2)}\n`,
    "utf8"
  );
}

/**
 * Record baseline content for newly-seen auxiliary files into `v0.files.json`,
 * without overwriting baselines already captured (the first time we see a file
 * is the true pre-agent baseline).
 */
export async function mergeBaselineAuxFiles(
  iterDir: string,
  baseline: AuxFileMap
): Promise<void> {
  const filePath = auxFilesPath(iterDir, 0);
  let existing: AuxFileMap = {};
  if (existsSync(filePath)) {
    try {
      existing = parseAuxJson(await readFile(filePath, "utf8"));
    } catch {
      existing = {};
    }
  }
  let changed = false;
  for (const [rel, content] of Object.entries(baseline)) {
    if (!(rel in existing)) {
      existing[rel] = content;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(filePath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
  }
}

/**
 * Bring every auxiliary file on disk in line with version `v`: files `v`
 * changed get its content; files it did not touch revert to baseline (a `null`
 * value means delete). The baseline (`v0.files.json`) keys define the full set
 * of files any version has ever touched. Returns the absolute paths written or
 * removed, so the caller can trigger HMR for them.
 */
export async function restoreAuxFilesForVersion(
  projectRoot: string,
  roots: string[],
  v: number
): Promise<string[]> {
  const baseline = await readVersionAuxFiles(roots, 0);
  const target = v === 0 ? baseline : await readVersionAuxFiles(roots, v);
  const written: string[] = [];
  for (const rel of Object.keys(baseline)) {
    const content = rel in target ? target[rel] : baseline[rel];
    const abs = fromRelPosix(projectRoot, rel);
    if (content === null || content === undefined) {
      try {
        await unlink(abs);
        written.push(abs);
      } catch {
        // already absent — nothing to revert
      }
      continue;
    }
    await atomicWriteText(abs, content);
    written.push(abs);
  }
  return written;
}

export async function deleteVersionAuxFiles(
  roots: string[],
  v: number
): Promise<void> {
  for (const iterDir of roots) {
    const filePath = auxFilesPath(iterDir, v);
    try {
      await unlink(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw err;
      }
    }
  }
}
