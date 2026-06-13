import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafePathSegment } from "../platform/path-safety.ts";

export interface VersionManifestEntry {
  createdAt: string;
  runId?: string;
  screenshotCaptured?: boolean;
  summary: string;
}

export interface IterationsManifest {
  versions: Record<string, VersionManifestEntry>;
}

const EMPTY_MANIFEST: IterationsManifest = { versions: {} };
const VERSION_ASSET_FILE_RE = /^v(\d+)\.(tsx|png)$/;
const VERSION_TSX_FILE_RE = /^v(\d+)\.tsx$/;

export type VersionSlotMap = Map<number, { tsx: boolean; png: boolean }>;

/** Merges v{N}.tsx/.png filenames from a directory listing into `present`. */
export function mergeVersionSlotsFromDirEntries(
  present: VersionSlotMap,
  entries: string[]
): void {
  for (const name of entries) {
    const m = name.match(VERSION_ASSET_FILE_RE);
    if (!m?.[1]) {
      continue;
    }
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n)) {
      continue;
    }
    const slot = present.get(n) ?? { tsx: false, png: false };
    if (m[2] === "tsx") {
      slot.tsx = true;
    } else {
      slot.png = true;
    }
    present.set(n, slot);
  }
}

function completeVersionIndices(present: VersionSlotMap): number[] {
  return [...present.entries()]
    .filter(([, slot]) => slot.tsx && slot.png)
    .map(([n]) => n)
    .sort((a, b) => a - b);
}

export function parseManifestJson(raw: string): IterationsManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_MANIFEST };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...EMPTY_MANIFEST };
  }
  const versions = (parsed as { versions?: unknown }).versions;
  if (!versions || typeof versions !== "object") {
    return { ...EMPTY_MANIFEST };
  }
  const out: Record<string, VersionManifestEntry> = {};
  for (const [key, value] of Object.entries(versions)) {
    const entry = parseManifestEntry(key, value);
    if (!entry) {
      continue;
    }
    out[key] = entry;
  }
  return { versions: out };
}

function parseManifestEntry(
  key: string,
  value: unknown
): VersionManifestEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as {
    createdAt?: unknown;
    runId?: unknown;
    screenshotCaptured?: unknown;
    summary?: unknown;
  };
  const summary = typeof entry.summary === "string" ? entry.summary.trim() : "";
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : "";
  if (!(summary || createdAt)) {
    return null;
  }
  return {
    summary: summary || defaultSummaryForVersion(Number.parseInt(key, 10)),
    createdAt: createdAt || new Date(0).toISOString(),
    ...(typeof entry.runId === "string" && entry.runId.trim()
      ? { runId: entry.runId.trim() }
      : {}),
    ...(typeof entry.screenshotCaptured === "boolean"
      ? { screenshotCaptured: entry.screenshotCaptured }
      : {}),
  };
}

export function defaultSummaryForVersion(v: number): string {
  if (v === 0) {
    return "Baseline";
  }
  return "AI edit";
}

export function mergeVersionEntry(
  manifest: IterationsManifest,
  v: number,
  entry: VersionManifestEntry
): IterationsManifest {
  return {
    versions: {
      ...manifest.versions,
      [String(v)]: entry,
    },
  };
}

export function removeVersionFromManifest(
  manifest: IterationsManifest,
  v: number
): IterationsManifest {
  const { [String(v)]: _removed, ...rest } = manifest.versions;
  return { versions: rest };
}

export function versionEntryFromManifest(
  manifest: IterationsManifest | null,
  v: number
): VersionManifestEntry | null {
  if (!manifest) {
    return null;
  }
  return manifest.versions[String(v)] ?? null;
}

export function enrichVersionMeta(
  v: number,
  manifestEntry: VersionManifestEntry | null,
  tsxMtimeMs: number | null
): {
  createdAt: string;
  runId?: string;
  screenshotCaptured?: boolean;
  summary: string;
} {
  const summary = manifestEntry?.summary?.trim() || defaultSummaryForVersion(v);
  let createdAt = manifestEntry?.createdAt;
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    createdAt =
      tsxMtimeMs !== null && tsxMtimeMs > 0
        ? new Date(tsxMtimeMs).toISOString()
        : new Date(0).toISOString();
  }
  return {
    summary,
    createdAt,
    ...(manifestEntry?.runId ? { runId: manifestEntry.runId } : {}),
    ...(typeof manifestEntry?.screenshotCaptured === "boolean"
      ? { screenshotCaptured: manifestEntry.screenshotCaptured }
      : {}),
  };
}

/**
 * All on-disk iteration directories for a comment. Baseline artifacts from
 * comment POST live under `public/designs/iterations/<id>/`; Agent snapshots
 * are written under `designs/iterations/<id>/`. Both may exist at once.
 */
export function resolveIterationDirRoots(
  projectRoot: string,
  id: string
): string[] {
  if (!isSafePathSegment(id)) {
    return [];
  }
  const roots: string[] = [];
  const primary = path.join(projectRoot, "designs", "iterations", id);
  const legacy = path.join(projectRoot, "public", "designs", "iterations", id);
  if (existsSync(primary) && statSync(primary).isDirectory()) {
    roots.push(primary);
  }
  if (
    existsSync(legacy) &&
    statSync(legacy).isDirectory() &&
    !roots.includes(legacy)
  ) {
    roots.push(legacy);
  }
  return roots;
}

/**
 * Canonical iteration store used by Agent/activate/list APIs. Prefers the agent
 * snapshot tree, then the legacy public tree from comment POST.
 */
export function resolveIterationsDir(
  projectRoot: string,
  id: string
): string | null {
  const roots = resolveIterationDirRoots(projectRoot, id);
  return roots[0] ?? null;
}

/** Version indices where both v{N}.tsx and v{N}.png exist in `iterDir`. */
export async function listCompleteIterationVersionsInDir(
  iterDir: string
): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(iterDir);
  } catch {
    return [];
  }
  const present: VersionSlotMap = new Map();
  mergeVersionSlotsFromDirEntries(present, entries);
  return completeVersionIndices(present);
}

/** Merges version slots across every iteration root for a comment. */
export async function listCompleteIterationVersionsAllRoots(
  roots: string[]
): Promise<number[]> {
  const present: VersionSlotMap = new Map();
  for (const iterDir of roots) {
    let entries: string[];
    try {
      entries = await readdir(iterDir);
    } catch {
      continue;
    }
    mergeVersionSlotsFromDirEntries(present, entries);
  }
  return completeVersionIndices(present);
}

/**
 * Next snapshot version index for Agent iterations under `iterDir`. Creates the
 * directory when absent; scans existing v{N}.tsx files for the high water mark.
 */
export async function nextIterationVersion(
  iterDir: string
): Promise<{ ok: true; nextV: number } | { ok: false; error: string }> {
  try {
    if (existsSync(iterDir) && statSync(iterDir).isDirectory()) {
      const entries = await readdir(iterDir);
      let max = -1;
      for (const name of entries) {
        const m = name.match(VERSION_TSX_FILE_RE);
        if (!m) {
          continue;
        }
        const version = m[1];
        if (version === undefined) {
          continue;
        }
        const n = Number.parseInt(version, 10);
        if (Number.isFinite(n) && n > max) {
          max = n;
        }
      }
      return { ok: true, nextV: max >= 0 ? max + 1 : 1 };
    }
    await mkdir(iterDir, { recursive: true });
    return { ok: true, nextV: 1 };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function findVersionSnapshotPath(
  roots: string[],
  v: number
): string | null {
  for (const iterDir of roots) {
    const snapshotPath = path.join(iterDir, `v${v}.tsx`);
    if (existsSync(snapshotPath) && statSync(snapshotPath).isFile()) {
      return snapshotPath;
    }
  }
  return null;
}

export function findVersionPngPath(roots: string[], v: number): string | null {
  for (const iterDir of roots) {
    const pngPath = path.join(iterDir, `v${v}.png`);
    if (existsSync(pngPath) && statSync(pngPath).isFile()) {
      return pngPath;
    }
  }
  return null;
}

export function manifestPath(iterDir: string): string {
  return path.join(iterDir, "manifest.json");
}

export async function readIterationsManifest(
  iterDir: string
): Promise<IterationsManifest | null> {
  const filePath = manifestPath(iterDir);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = await readFile(filePath, "utf8");
    return parseManifestJson(raw);
  } catch {
    return null;
  }
}

export async function writeIterationsManifest(
  iterDir: string,
  manifest: IterationsManifest
): Promise<void> {
  const filePath = manifestPath(iterDir);
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function patchIterationsManifest(
  iterDir: string,
  v: number,
  entry: VersionManifestEntry
): Promise<void> {
  const existing = (await readIterationsManifest(iterDir)) ?? {
    ...EMPTY_MANIFEST,
  };
  await writeIterationsManifest(iterDir, mergeVersionEntry(existing, v, entry));
}

export async function updateVersionScreenshotCaptured(
  iterDir: string,
  v: number,
  screenshotCaptured: boolean
): Promise<void> {
  const existing = await readIterationsManifest(iterDir);
  const entry = versionEntryFromManifest(existing, v);
  if (!(existing && entry)) {
    return;
  }
  await writeIterationsManifest(
    iterDir,
    mergeVersionEntry(existing, v, { ...entry, screenshotCaptured })
  );
}

export async function deleteVersionFromManifest(
  iterDir: string,
  v: number
): Promise<void> {
  const existing = await readIterationsManifest(iterDir);
  if (!existing) {
    return;
  }
  await writeIterationsManifest(
    iterDir,
    removeVersionFromManifest(existing, v)
  );
}

/** Remove v{N}.tsx/.png and manifest entry from every iteration root. */
export async function deleteVersionArtifactsAllRoots(
  roots: string[],
  v: number
): Promise<void> {
  for (const iterDir of roots) {
    for (const ext of ["tsx", "png"] as const) {
      const filePath = path.join(iterDir, `v${v}.${ext}`);
      try {
        await unlink(filePath);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw err;
        }
      }
    }
    await deleteVersionFromManifest(iterDir, v);
  }
}

export function tsxMtimeMs(iterDir: string, v: number): number | null {
  const tsxPath = path.join(iterDir, `v${v}.tsx`);
  if (!existsSync(tsxPath)) {
    return null;
  }
  try {
    return statSync(tsxPath).mtimeMs;
  } catch {
    return null;
  }
}

export function pngMtimeMs(roots: string[], v: number): number | null {
  const pngPath = findVersionPngPath(roots, v);
  if (!pngPath) {
    return null;
  }
  try {
    return statSync(pngPath).mtimeMs;
  } catch {
    return null;
  }
}

/** Cache-busted URL for an iteration screenshot (mtime busts stale img cache). */
export function iterationPngUrl(
  id: string,
  v: number,
  mtimeMs: number | null
): string {
  if (!isSafePathSegment(id)) {
    throw new Error("invalid iteration id");
  }
  const base = `/designs/iterations/${id}/v${v}.png`;
  if (mtimeMs === null || mtimeMs <= 0) {
    return base;
  }
  return `${base}?t=${Math.floor(mtimeMs)}`;
}
