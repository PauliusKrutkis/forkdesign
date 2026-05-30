import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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
 * Canonical iteration store used by Fix/activate/list APIs. Falls back to the
 * legacy `public/designs/iterations` tree created at comment POST time.
 */
export function resolveIterationsDir(
  projectRoot: string,
  id: string
): string | null {
  const primary = path.join(projectRoot, "designs", "iterations", id);
  if (existsSync(primary) && statSync(primary).isDirectory()) {
    return primary;
  }
  const legacy = path.join(projectRoot, "public", "designs", "iterations", id);
  if (existsSync(legacy) && statSync(legacy).isDirectory()) {
    return legacy;
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
