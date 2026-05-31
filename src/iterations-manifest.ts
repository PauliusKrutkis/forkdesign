import { existsSync, statSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface VersionManifestEntry {
  createdAt: string;
  summary: string;
}

export interface IterationsManifest {
  versions: Record<string, VersionManifestEntry>;
}

const EMPTY_MANIFEST: IterationsManifest = { versions: {} };

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
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as { summary?: unknown; createdAt?: unknown };
    const summary =
      typeof entry.summary === "string" ? entry.summary.trim() : "";
    const createdAt =
      typeof entry.createdAt === "string" ? entry.createdAt : "";
    if (!(summary || createdAt)) {
      continue;
    }
    out[key] = {
      summary: summary || defaultSummaryForVersion(Number.parseInt(key, 10)),
      createdAt: createdAt || new Date(0).toISOString(),
    };
  }
  return { versions: out };
}

export function defaultSummaryForVersion(v: number): string {
  if (v === 0) {
    return "Baseline";
  }
  return "AI fix";
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
): { summary: string; createdAt: string } {
  const summary = manifestEntry?.summary?.trim() || defaultSummaryForVersion(v);
  let createdAt = manifestEntry?.createdAt;
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    createdAt =
      tsxMtimeMs !== null && tsxMtimeMs > 0
        ? new Date(tsxMtimeMs).toISOString()
        : new Date(0).toISOString();
  }
  return { summary, createdAt };
}

/**
 * All on-disk iteration directories for a comment. Baseline artifacts from
 * comment POST live under `public/designs/iterations/<id>/`; Fix snapshots
 * are written under `designs/iterations/<id>/`. Both may exist at once.
 */
export function resolveIterationDirRoots(
  projectRoot: string,
  id: string
): string[] {
  const roots: string[] = [];
  const primary = path.join(projectRoot, "designs", "iterations", id);
  const legacy = path.join(projectRoot, "public", "designs", "iterations", id);
  if (existsSync(primary) && statSync(primary).isDirectory()) {
    roots.push(primary);
  }
  if (existsSync(legacy) && statSync(legacy).isDirectory()) {
    if (!roots.includes(legacy)) {
      roots.push(legacy);
    }
  }
  return roots;
}

/**
 * Canonical iteration store used by Fix/activate/list APIs. Prefers the Fix
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
  const present = new Map<number, { tsx: boolean; png: boolean }>();
  for (const name of entries) {
    const m = name.match(/^v(\d+)\.(tsx|png)$/);
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
  return [...present.entries()]
    .filter(([, slot]) => slot.tsx && slot.png)
    .map(([n]) => n)
    .sort((a, b) => a - b);
}

/** Merges version slots across every iteration root for a comment. */
export async function listCompleteIterationVersionsAllRoots(
  roots: string[]
): Promise<number[]> {
  const present = new Map<number, { tsx: boolean; png: boolean }>();
  for (const iterDir of roots) {
    let entries: string[];
    try {
      entries = await readdir(iterDir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const m = name.match(/^v(\d+)\.(tsx|png)$/);
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
  return [...present.entries()]
    .filter(([, slot]) => slot.tsx && slot.png)
    .map(([n]) => n)
    .sort((a, b) => a - b);
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
